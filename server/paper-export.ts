import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import {
  inTextReference,
  referenceEntries,
  referenceParts,
} from '../shared/references.ts'
import { citedSources, type Language, type Work } from '../shared/writing.ts'

export function exportPaper(
  work: Work,
  language: Language,
  submittedAt: Date | null,
  includeExportStatus = true
) {
  const zh = language === 'zh-CN'
  const hasRevision = Boolean(
    work.revisionTitle ||
    work.revision.content.some((block) => block.content?.length)
  )
  const paper = hasRevision ? work.revision : work.draft
  const title =
    (hasRevision ? (work.revisionTitle ?? work.title) : work.title) ||
    (zh ? '稿件' : 'Paper')
  const generatedAt = new Date().toISOString()
  const status = submittedAt
    ? zh
      ? '已提交稿'
      : 'Submitted paper'
    : zh
      ? '已保存草稿'
      : 'Saved draft'
  const entries = referenceEntries(work.sources ?? [], citedSources(paper))
  const references = new Map(entries.map((item) => [item.source.id, item]))
  const blocks = paper.content.map(
    (block) =>
      new Paragraph({
        heading:
          block.type === 'heading'
            ? block.attrs?.level === 3
              ? HeadingLevel.HEADING_3
              : HeadingLevel.HEADING_2
            : undefined,
        children: block.content?.map((inline) => {
          if (inline.type === 'hardBreak') return new TextRun({ break: 1 })
          if (inline.type === 'citation') {
            const entry = references.get(inline.attrs.sourceId)
            return new TextRun(
              entry ? inTextReference(entry, inline.attrs.locator) : ''
            )
          }
          return new TextRun({
            text: inline.text,
            bold: inline.marks?.some((mark) => mark.type === 'bold'),
            italics: inline.marks?.some((mark) => mark.type === 'italic'),
          })
        }),
      })
  )
  const bibliography = entries.map(
    (entry) =>
      new Paragraph({
        indent: { left: 360, hanging: 360 },
        children: referenceParts(entry).map((part) =>
          part.url
            ? new ExternalHyperlink({
                link: part.url,
                children: [
                  new TextRun({ text: part.text, style: 'Hyperlink' }),
                ],
              })
            : new TextRun({ text: part.text, italics: part.italic })
        ),
      })
  )
  const file = new Document({
    title,
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
          ...(includeExportStatus
            ? [
                new Paragraph(
                  `${status} · ${zh ? '导出时间' : 'Exported'} ${generatedAt}`
                ),
              ]
            : []),
          ...blocks,
          ...(bibliography.length
            ? [
                new Paragraph({
                  text: zh ? '参考文献' : 'References',
                  heading: HeadingLevel.HEADING_2,
                }),
                ...bibliography,
              ]
            : []),
        ],
      },
    ],
  })
  const filename = encodeURIComponent(
    `${Array.from(title).slice(0, 80).join('')}.docx`
  ).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)
  return { buffer: Packer.toBuffer(file), filename }
}
