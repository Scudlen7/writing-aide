import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SaxesParser } from 'saxes'
import yauzl from 'yauzl'
import type { DocumentFormat } from '../shared/documents.ts'

const maxText = 400_000
const activeParts =
  /(^|\/)(?:vba[^/]*|embeddings|activex|afchunk[^/]*)($|[/.])/i
const wordMain =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const wrongFormat = 'documentFormatMismatch'
const damaged = 'documentDamaged'

async function zipEntries(filename: string) {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(
      filename,
      { lazyEntries: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) return reject(new Error(wrongFormat))
        const names = new Set<string>()
        let size = 0
        let main = false
        const fail = (cause: unknown) => {
          zip.close()
          reject(cause)
        }
        zip.on('error', fail)
        zip.on('end', () => {
          if (
            !main ||
            !names.has('word/document.xml') ||
            !names.has('_rels/.rels')
          )
            reject(new Error(wrongFormat))
          else resolve()
        })
        zip.on('entry', (entry: yauzl.Entry) => {
          const name = entry.fileName
          size += entry.uncompressedSize
          if (
            size > 150 * 1024 * 1024 ||
            names.size >= 4096 ||
            names.has(name.toLowerCase()) ||
            entry.isEncrypted()
          )
            return fail(new Error(damaged))
          if (activeParts.test(name))
            return fail(new Error('documentActiveContent'))
          names.add(name.toLowerCase())
          if (name.endsWith('/')) return zip.readEntry()
          zip.openReadStream(entry, (cause, stream) => {
            if (cause || !stream) return fail(new Error(damaged))
            const xml =
              name === '[Content_Types].xml' ||
              name.endsWith('.rels') ||
              name === 'word/document.xml'
            const parser = xml ? new SaxesParser() : null
            parser?.on('doctype', () => {
              throw new Error('documentActiveContent')
            })
            parser?.on('opentag', ({ name: tag, attributes }) => {
              if (
                name === '[Content_Types].xml' &&
                tag === 'Override' &&
                attributes.PartName === '/word/document.xml' &&
                attributes.ContentType === wordMain
              )
                main = true
              if (
                name.endsWith('.rels') &&
                attributes.TargetMode === 'External' &&
                !attributes.Type?.endsWith('/hyperlink')
              )
                throw new Error('documentActiveContent')
              if (
                name === 'word/document.xml' &&
                /(^|:)(altChunk|object|control)$/u.test(tag)
              )
                throw new Error('documentActiveContent')
            })
            if (parser) stream.setEncoding('utf8')
            void (async () => {
              for await (const chunk of stream) parser?.write(chunk as string)
              parser?.close()
              zip.readEntry()
            })().catch(fail)
          })
        })
        zip.readEntry()
      }
    )
  })
}

async function parse(filename: string, format: DocumentFormat, mode: string) {
  if (format === 'docx') {
    if (mode === 'validate') return zipEntries(filename).then(() => '')
    const { default: mammoth } = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filename })
    return result.value.slice(0, maxText)
  }

  const data = await readFile(filename)
  if (format === 'doc') {
    if (mode !== 'validate') return ''
    if (!data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
      throw new Error(wrongFormat)
    const { default: cfb } = await import('cfb')
    if (!cfb.find(cfb.read(data, { type: 'buffer' }), 'WordDocument'))
      throw new Error(wrongFormat)
    return ''
  }
  if (format === 'md' || format === 'writing') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    if (text.includes('\u0000')) throw new Error(wrongFormat)
    return mode === 'index' ? text.slice(0, maxText) : ''
  }

  if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-')))
    throw new Error(wrongFormat)
  const { getDocument, PasswordException } =
    await import('pdfjs-dist/legacy/build/pdf.mjs')
  const assets = (name: string) =>
    fileURLToPath(import.meta.resolve(`pdfjs-dist/${name}/`)).replaceAll(
      '\\',
      '/'
    ) + '/'
  const task = getDocument({
    data: Uint8Array.from(data),
    cMapUrl: assets('cmaps'),
    standardFontDataUrl: assets('standard_fonts'),
    useSystemFonts: false,
    stopAtErrors: true,
  })
  try {
    const pdf = await task.promise
    if (mode === 'validate') return ''
    let text = ''
    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages && text.length < maxText;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      text +=
        content.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''
          )
          .join('') + '\n'
      page.cleanup()
    }
    return text.slice(0, maxText)
  } catch (error) {
    if (error instanceof PasswordException) {
      if (mode === 'validate') return ''
      throw new Error('documentPasswordProtected', { cause: error })
    }
    throw error
  } finally {
    await task.destroy()
  }
}

// Parser diagnostics may include document text. Only send the result to the parent.
// eslint-disable-next-line no-console
console.log = console.warn = console.error = () => {}
const [, , filename, format, mode] = process.argv
try {
  process.stdout.write(
    JSON.stringify({
      text: await parse(filename, format as DocumentFormat, mode),
    })
  )
} catch (error) {
  const known = [
    wrongFormat,
    'documentActiveContent',
    'documentPasswordProtected',
  ]
  process.stdout.write(
    JSON.stringify({
      error:
        error instanceof Error && known.includes(error.message)
          ? error.message
          : damaged,
    })
  )
}
