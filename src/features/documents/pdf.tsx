import { useEffect, useRef, useState } from 'react'
import { searchText } from '@writing/documents'
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

GlobalWorkerOptions.workerSrc = workerUrl

const assets = import.meta.glob(
  '../../../node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm,iccs}/*',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>
const files = new Map(
  Object.entries(assets).map(([name, url]) => [name.split('/').at(-1), url])
)
type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>

export default function PdfPreview({ url }: { url: string }) {
  const { t } = useTranslation()
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState(false)
  const [password, setPassword] = useState<((value: string) => void) | null>(
    null
  )
  const [wrongPassword, setWrongPassword] = useState(false)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [outline, setOutline] = useState<Outline>([])
  const [pageWidth, setPageWidth] = useState(800)
  const [term, setTerm] = useState('')
  const [match, setMatch] = useState<'missing' | 'searching' | 'found' | null>(
    null
  )
  const wrapper = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const search = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    const task = getDocument({
      url,
      useWorkerFetch: false,
      cMapUrl: './',
      standardFontDataUrl: './',
      wasmUrl: './',
      iccUrl: './',
      BinaryDataFactory: class {
        async fetch({ filename }: { filename: string }) {
          const asset = files.get(filename.split('/').at(-1))
          if (!asset) throw new Error('PDF asset unavailable')
          const response = await fetch(asset)
          if (!response.ok) throw new Error('PDF asset unavailable')
          return new Uint8Array(await response.arrayBuffer())
        }
      },
    })
    task.onPassword = (update: (value: string) => void, reason: number) => {
      if (!live) return
      setWrongPassword(reason === 2)
      setPassword(() => update)
    }
    void task.promise.then(
      async (document) => {
        if (!live) return
        setPdf(document)
        setPassword(null)
        const toc = await document.getOutline().catch(() => null)
        if (live) setOutline(toc ?? [])
      },
      () => {
        if (live) setError(true)
      }
    )
    return () => {
      live = false
      search.current?.abort()
      void task.destroy().catch(() => {})
    }
  }, [url])

  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    const observer = new ResizeObserver(([item]) =>
      setPageWidth(Math.max(250, item.contentRect.width - 20))
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [pdf])

  useEffect(() => {
    const target = canvas.current
    const text = layer.current
    if (!pdf || !target || !text) return
    let live = true
    let render: RenderTask | undefined
    let textLayer: TextLayer | undefined
    void (async () => {
      const data = await pdf.getPage(page)
      if (!live) return
      const original = data.getViewport({ scale: 1 })
      const view = data.getViewport({
        scale: Math.min(1.5, pageWidth / original.width) * zoom,
      })
      const ratio = Math.min(
        window.devicePixelRatio,
        2,
        4000 / Math.max(view.width, view.height)
      )
      target.width = Math.round(view.width * ratio)
      target.height = Math.round(view.height * ratio)
      target.style.width = `${view.width}px`
      target.style.height = `${view.height}px`
      text.style.setProperty('--scale-factor', String(view.scale))
      text.style.setProperty('--total-scale-factor', String(view.scale))
      render = data.render({
        canvas: target,
        viewport: view,
        transform: [ratio, 0, 0, ratio, 0, 0],
      })
      await render.promise
      if (!live) return
      textLayer = new TextLayer({
        textContentSource: data.streamTextContent(),
        container: text,
        viewport: view,
      })
      await textLayer.render()
    })().catch(() => {
      if (live) setError(true)
    })
    return () => {
      live = false
      render?.cancel()
      textLayer?.cancel()
      text.replaceChildren()
    }
  }, [pdf, page, zoom, pageWidth])

  async function find() {
    const needle = searchText(term)
    if (!pdf || !needle) return
    search.current?.abort()
    const task = new AbortController()
    search.current = task
    setMatch('searching')
    try {
      for (
        let offset = 1;
        offset <= pdf.numPages && !task.signal.aborted;
        offset++
      ) {
        const next = ((page - 1 + offset) % pdf.numPages) + 1
        const p = await pdf.getPage(next)
        const content = await p.getTextContent()
        if (task.signal.aborted) return
        const text = content.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''
          )
          .join('')
        if (searchText(text).includes(needle)) {
          setPage(next)
          setMatch('found')
          return
        }
      }
      if (!task.signal.aborted) setMatch('missing')
    } catch {
      if (!task.signal.aborted) setError(true)
    }
  }

  async function jump(destination: Outline[number]['dest']) {
    if (!pdf || !destination) return
    const dest =
      typeof destination === 'string'
        ? await pdf.getDestination(destination)
        : destination
    if (!dest) return
    const target = dest[0]
    const index =
      typeof target === 'number' ? target : await pdf.getPageIndex(target)
    setPage(index + 1)
  }

  function contents(items: Outline) {
    return (
      <ul className='ms-3 grid gap-1'>
        {items.map((item, index) => (
          <li key={index}>
            {item.dest ? (
              <Button
                className='h-auto justify-start px-2 text-start whitespace-normal'
                variant='ghost'
                onClick={() => void jump(item.dest).catch(() => setError(true))}
              >
                {item.title}
              </Button>
            ) : (
              <span>{item.title}</span>
            )}
            {item.items.length > 0 && contents(item.items)}
          </li>
        ))}
      </ul>
    )
  }

  if (error)
    return (
      <p
        role='alert'
        className='rounded-md bg-destructive/10 p-3 text-destructive'
      >
        {t('documents.pdfError')}
      </p>
    )
  if (password)
    return (
      <form
        className='flex flex-wrap items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          password(String(data.get('password')))
          event.currentTarget.reset()
        }}
      >
        <Input
          className='w-auto'
          type='password'
          name='password'
          aria-label={t('documents.pdfPassword')}
          placeholder={t('documents.pdfPassword')}
          autoComplete='off'
          required
        />
        <Button>{t('documents.pdfUnlock')}</Button>
        {wrongPassword && <p role='alert'>{t('documents.wrongPdfPassword')}</p>}
      </form>
    )
  if (!pdf) return <p role='status'>{t('loading')}</p>
  return (
    <section className='min-w-0 space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          {t('documents.previous')}
        </Button>
        <Input
          className='w-20'
          type='number'
          min={1}
          max={pdf.numPages}
          value={page}
          aria-label={t('documents.page')}
          onChange={(event) => {
            const number = event.target.valueAsNumber
            if (
              Number.isInteger(number) &&
              number >= 1 &&
              number <= pdf.numPages
            )
              setPage(number)
          }}
        />
        <span className='text-sm'>/ {pdf.numPages}</span>
        <Button
          size='sm'
          variant='outline'
          disabled={page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          {t('documents.next')}
        </Button>
        <Button
          size='sm'
          variant='outline'
          aria-label={t('documents.zoomOut')}
          disabled={zoom <= 0.5}
          onClick={() => setZoom(zoom - 0.25)}
        >
          −
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => setZoom(1)}
          aria-label={t('documents.fitPage')}
        >
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          size='sm'
          variant='outline'
          aria-label={t('documents.zoomIn')}
          disabled={zoom >= 3}
          onClick={() => setZoom(zoom + 0.25)}
        >
          +
        </Button>
      </div>
      <form
        className='flex flex-wrap items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          void find()
        }}
      >
        <Input
          className='w-auto'
          type='search'
          aria-label={t('documents.pdfFind')}
          placeholder={t('documents.pdfFind')}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value)
            search.current?.abort()
            setMatch(null)
          }}
          maxLength={180}
        />
        <Button
          variant='outline'
          disabled={!term.trim() || match === 'searching'}
        >
          {t('documents.pdfFind')}
        </Button>
        {match && (
          <span role='status' className='text-sm'>
            {t(`documents.pdfMatch.${match}`)}
          </span>
        )}
      </form>
      {outline.length > 0 && (
        <details className='rounded-md border p-2'>
          <summary>{t('documents.outline')}</summary>
          {contents(outline)}
        </details>
      )}
      <div
        ref={wrapper}
        className='overflow-auto rounded-md border bg-muted p-2'
      >
        <div className='relative mx-auto w-fit'>
          <canvas
            ref={canvas}
            aria-label={`${t('documents.page')} ${page}`}
            className='block bg-white'
          />
          <div className='textLayer' ref={layer} />
        </div>
      </div>
    </section>
  )
}
