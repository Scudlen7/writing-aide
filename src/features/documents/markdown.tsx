import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import type { DocumentItem } from '@writing/documents'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Problem } from '@/features/writing/ui'
import { readMarkdown, uploadDocument } from './api'

export function MarkdownDocument({
  entry,
  version,
  editable,
  onSaved,
}: {
  entry: DocumentItem
  version: number
  editable: boolean
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [openedVersion] = useState(version)
  const source = useQuery({
    queryKey: ['markdown-source', entry.id, openedVersion],
    queryFn: () => readMarkdown(entry.id, openedVersion),
    staleTime: Infinity,
  })
  if (source.isPending) return <p role='status'>{t('loading')}</p>
  if (source.isError) return <Problem error={source.error} />
  return (
    <MarkdownEditor
      initial={source.data}
      entry={entry}
      version={openedVersion}
      editable={editable}
      onSaved={onSaved}
    />
  )
}

function MarkdownEditor({
  initial,
  entry,
  version,
  editable,
  onSaved,
}: {
  initial: string
  entry: DocumentItem
  version: number
  editable: boolean
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState({ text: initial, version })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const changed = value !== saved.text
  useBlocker({
    shouldBlockFn: () =>
      changed && !window.confirm(t('documents.leaveUnsaved')),
    enableBeforeUnload: changed,
  })

  useEffect(() => {
    if (!editable || !changed || pending || error) return
    const timer = window.setTimeout(persist, 1400)
    return () => window.clearTimeout(timer)

    function persist() {
      setPending(true)
      const blob = new Blob([value], { type: 'text/plain;charset=utf-8' })
      void uploadDocument(blob, entry.filename, {
        id: entry.id,
        currentVersion: saved.version,
      })
        .then((result) => {
          setSaved({ text: value, version: result.currentVersion })
          onSaved()
        }, setError)
        .finally(() => setPending(false))
    }
  }, [
    editable,
    changed,
    pending,
    error,
    value,
    entry.id,
    entry.filename,
    saved.version,
    onSaved,
  ])

  return (
    <Tabs defaultValue={editable ? 'edit' : 'preview'}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <TabsList className={editable ? 'lg:hidden' : undefined}>
          <TabsTrigger value='edit'>
            {t('documents.markdownSource')}
          </TabsTrigger>
          <TabsTrigger value='preview'>{t('documents.preview')}</TabsTrigger>
        </TabsList>
        {editable && (
          <p role='status' className='text-sm text-muted-foreground lg:ms-auto'>
            {t(
              pending
                ? 'documents.saving'
                : changed
                  ? 'documents.unsaved'
                  : 'saved'
            )}
          </p>
        )}
      </div>
      <Problem error={error} />
      {!!error && (
        <div className='flex flex-wrap gap-2'>
          <Button variant='outline' onClick={() => setError(null)}>
            {t('retry')}
          </Button>
          <Button
            variant='outline'
            onClick={() =>
              void uploadDocument(new Blob([value]), entry.filename).then(
                ({ id }) => {
                  onSaved()
                  void navigate({
                    to: '/documents/$documentId',
                    params: { documentId: id },
                    ignoreBlocker: true,
                  })
                },
                setError
              )
            }
          >
            {t('documents.saveCopy')}
          </Button>
        </div>
      )}
      <div className={cn('grid min-w-0 gap-4', editable && 'lg:grid-cols-2')}>
        <TabsContent
          value='edit'
          forceMount
          className={cn(
            'min-w-0 data-[state=inactive]:hidden',
            editable && 'lg:data-[state=inactive]:block'
          )}
        >
          {editable && (
            <p className='mb-2 hidden text-sm font-medium lg:block'>
              {t('documents.markdownSource')}
            </p>
          )}
          <Textarea
            className={cn(
              'min-h-80 font-mono',
              editable && 'lg:h-[clamp(24rem,58dvh,44rem)] lg:resize-none'
            )}
            aria-label={t('documents.markdownSource')}
            value={value}
            readOnly={!editable}
            onChange={(event) => {
              const next = event.target.value
              setValue(
                initial.includes('\r\n') &&
                  !initial.replaceAll('\r\n', '').includes('\n')
                  ? next.replaceAll('\n', '\r\n')
                  : next
              )
            }}
          />
        </TabsContent>
        <TabsContent
          value='preview'
          forceMount={editable ? true : undefined}
          className={cn(
            'min-w-0',
            editable &&
              'data-[state=inactive]:hidden lg:data-[state=inactive]:block'
          )}
        >
          {editable && (
            <p className='mb-2 hidden text-sm font-medium lg:block'>
              {t('documents.preview')}
            </p>
          )}
          <div
            className={cn(
              'paper-prose min-h-40 overflow-auto rounded-md border bg-card p-4 [&_a]:underline [&_blockquote]:border-s-4 [&_blockquote]:ps-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc [&_ul]:ps-5',
              editable && 'lg:h-[clamp(24rem,58dvh,44rem)]'
            )}
          >
            <Markdown
              skipHtml
              disallowedElements={['img']}
              remarkPlugins={[remarkGfm]}
            >
              {value}
            </Markdown>
          </div>
        </TabsContent>
      </div>
    </Tabs>
  )
}
