import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
} from 'react'
import {
  EditorContent,
  mergeAttributes,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type NodeViewProps,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  inTextReference,
  referenceEntries,
  referenceParts,
  type ReferenceEntry,
  type ReferenceSource,
} from '@writing/references'
import { blockText, citedSources, type WritingDocument } from '@writing/writing'
import { Bold, Heading2, Italic, Pilcrow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

const Citations = createContext<Map<string, ReferenceEntry>>(new Map())

function CitationView({ node }: NodeViewProps) {
  const { t } = useTranslation()
  const entry = useContext(Citations).get(node.attrs.sourceId)
  return (
    <NodeViewWrapper as='span' contentEditable={false} className='text-primary'>
      {entry
        ? inTextReference(entry, node.attrs.locator)
        : t('missingReference')}
    </NodeViewWrapper>
  )
}

const citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      sourceId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-source-id'),
        renderHTML: (attrs: Record<string, string>) => ({
          'data-source-id': attrs.sourceId,
        }),
      },
      locator: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-locator') ?? '',
        renderHTML: (attrs: Record<string, string>) => ({
          'data-locator': attrs.locator,
        }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-citation][data-source-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-citation': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CitationView, { as: 'span' })
  },
})

const extensions = [
  citation,
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: false,
    heading: { levels: [2, 3] },
  }),
]

export type TextLocation = { block: number; offset: number; text: string }
export type CitationInput = { sourceId: string; locator: string }

export function PaperEditor({
  value,
  onChange,
  onParagraph,
  autofocus = false,
  location,
  sources = [],
  insertion,
}: {
  value: WritingDocument
  onChange: (doc: WritingDocument) => void
  onParagraph?: (block: number | null) => void
  autofocus?: boolean
  location?: TextLocation
  sources?: ReferenceSource[]
  insertion?: CitationInput
}) {
  const { t } = useTranslation()
  const editor = useEditor({
    extensions,
    content: value,
    autofocus: autofocus ? 'start' : false,
    editorProps: {
      attributes: {
        class: 'paper-prose min-h-60 p-4 focus:outline-none sm:p-6',
        role: 'textbox',
        'aria-label': t('manuscript'),
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as WritingDocument),
  })
  const marks = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold'),
      italic: editor?.isActive('italic'),
      heading: editor?.isActive('heading', { level: 2 }),
      paragraph: editor?.isActive('paragraph'),
      selectedBlock: editor && editor.state.selection.$from.index(0),
      selectedEnd: editor && editor.state.selection.$to.index(0),
    }),
  })
  useEffect(() => {
    if (!editor || !location) return
    editor.state.doc.forEach((node, position, index) => {
      if (index !== location.block || node.type.name !== 'paragraph') return
      const from = position + 1 + location.offset
      const to = from + location.text.length
      if (
        to > position + node.nodeSize - 1 ||
        editor.state.doc.textBetween(from, to, '', (leaf) =>
          leaf.type.name === 'hardBreak' ? '\n' : ' '
        ) !== location.text
      )
        return
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .scrollIntoView()
        .run()
    })
  }, [editor, location])
  useEffect(() => {
    if (!editor || !insertion) return
    if (editor.state.selection.$to.parent.type.name !== 'paragraph')
      editor.chain().focus('end').insertContent({ type: 'paragraph' }).run()
    const { $to, to } = editor.state.selection
    const before = $to.parent.textBetween(0, $to.parentOffset, '', ' ')
    const after = $to.parent.textBetween(
      $to.parentOffset,
      $to.parent.content.size,
      '',
      ' '
    )
    editor
      .chain()
      .focus()
      .setTextSelection(to)
      .insertContent([
        ...(before && !/\s$/.test(before) ? [{ type: 'text', text: ' ' }] : []),
        { type: 'citation', attrs: insertion },
        ...(after && !/^\s/.test(after) ? [{ type: 'text', text: ' ' }] : []),
      ])
      .run()
  }, [editor, insertion])
  if (!editor) return null

  return (
    <div className='overflow-hidden rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/35'>
      <div className='flex gap-1 border-b bg-muted/45 p-1.5'>
        <Button
          type='button'
          variant={marks?.paragraph ? 'secondary' : 'ghost'}
          size='icon'
          className='size-8'
          aria-label={t('paragraph')}
          title={t('paragraph')}
          onClick={() => editor.chain().focus().setParagraph().run()}
        >
          <Pilcrow />
        </Button>
        <Button
          type='button'
          variant={marks?.heading ? 'secondary' : 'ghost'}
          size='icon'
          className='size-8'
          aria-label={t('heading')}
          title={t('heading')}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 />
        </Button>
        <Button
          type='button'
          variant={marks?.bold ? 'secondary' : 'ghost'}
          size='icon'
          className='size-8'
          aria-label={t('bold')}
          aria-pressed={marks?.bold}
          title={t('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </Button>
        <Button
          type='button'
          variant={marks?.italic ? 'secondary' : 'ghost'}
          size='icon'
          className='size-8'
          aria-label={t('italic')}
          aria-pressed={marks?.italic}
          title={t('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </Button>
        {onParagraph && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='ms-auto h-8'
            disabled={
              !marks?.paragraph ||
              marks.selectedBlock == null ||
              marks.selectedBlock !== marks.selectedEnd ||
              !blockText(
                value.content[marks.selectedBlock] ?? { type: 'paragraph' }
              ).trim()
            }
            onClick={() => onParagraph(marks?.selectedBlock ?? null)}
          >
            {t('useParagraph')}
          </Button>
        )}
      </div>
      <Citations.Provider
        value={
          new Map(
            referenceEntries(sources, citedSources(value)).map((entry) => [
              entry.source.id,
              entry,
            ])
          )
        }
      >
        <EditorContent editor={editor} />
      </Citations.Provider>
    </div>
  )
}

export function PaperText({
  doc,
  anchors = false,
  sources = [],
}: {
  doc: WritingDocument
  anchors?: boolean
  sources?: ReferenceSource[]
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const entries = referenceEntries(sources, citedSources(doc))
  const references = new Map(entries.map((entry) => [entry.source.id, entry]))
  return (
    <div className='paper-prose'>
      {doc.content.map((block, index) =>
        createElement(
          block.type === 'heading'
            ? block.attrs?.level === 3
              ? 'h3'
              : 'h2'
            : 'p',
          {
            key: index,
            ...(anchors
              ? {
                  id: `paper-paragraph-${index}`,
                  tabIndex: -1,
                  className: 'scroll-mt-24 rounded-sm target:bg-primary/10',
                }
              : {}),
          },
          block.content?.map((item, position) => {
            if (item.type === 'hardBreak') return <br key={position} />
            if (item.type === 'citation') {
              const entry = references.get(item.attrs.sourceId)
              return entry ? (
                <a
                  key={position}
                  className='text-primary underline'
                  href={`#${prefix}-${entry.source.id}`}
                >
                  {inTextReference(entry, item.attrs.locator)}
                </a>
              ) : (
                <span key={position}>{t('missingReference')}</span>
              )
            }
            return (
              <span
                key={position}
                className={[
                  item.marks?.some((mark) => mark.type === 'bold')
                    ? 'font-bold'
                    : '',
                  item.marks?.some((mark) => mark.type === 'italic')
                    ? 'italic'
                    : '',
                ].join(' ')}
              >
                {item.text}
              </span>
            )
          })
        )
      )}
      {entries.length > 0 && (
        <section className='mt-4 space-y-2 border-t pt-3'>
          <h3>{t('bibliography')}</h3>
          <ul className='space-y-2'>
            {entries.map((entry) => (
              <li
                key={entry.source.id}
                id={`${prefix}-${entry.source.id}`}
                tabIndex={-1}
                className='scroll-mt-24 wrap-break-word'
              >
                {referenceParts(entry).map((part, index) =>
                  part.url ? (
                    <a
                      key={index}
                      href={part.url}
                      target='_blank'
                      rel='noreferrer'
                      className='text-primary underline'
                    >
                      {part.text}
                    </a>
                  ) : (
                    <span
                      key={index}
                      className={part.italic ? 'italic' : undefined}
                    >
                      {part.text}
                    </span>
                  )
                )}
                {entry.source.evidence && (
                  <p className='text-sm whitespace-pre-wrap text-muted-foreground'>
                    {entry.source.evidence}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
