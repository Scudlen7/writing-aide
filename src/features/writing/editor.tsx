import { createElement } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { WritingDocument } from '@writing/writing'
import { Bold, Heading2, Italic, Pilcrow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

const extensions = [
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

export function PaperEditor({
  value,
  onChange,
}: {
  value: WritingDocument
  onChange: (doc: WritingDocument) => void
}) {
  const { t } = useTranslation()
  const editor = useEditor({
    extensions,
    content: value,
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
    }),
  })
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
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

export function PaperText({ doc }: { doc: WritingDocument }) {
  return (
    <div className='paper-prose'>
      {doc.content.map((block, index) =>
        createElement(
          block.type === 'heading'
            ? block.attrs?.level === 3
              ? 'h3'
              : 'h2'
            : 'p',
          { key: index },
          block.content?.map((item, position) => {
            if (item.type === 'hardBreak') return <br key={position} />
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
    </div>
  )
}
