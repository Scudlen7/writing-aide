import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { DocumentItem, DocumentVersion } from '@writing/documents'
import type { Stage } from '@writing/writing'
import {
  ArrowLeft,
  Download,
  MessagesSquare,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Main } from '@/components/layout/main'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import { documentPath, documentsKey, uploadDocument, versionFile } from './api'
import { DocumentDebateDialog } from './debate'
import {
  DocumentToolSummary,
  type DocumentTool,
  type ToolDialogControls,
} from './document-tools'
import { MarkdownDocument } from './markdown'
import { ReviewList } from './reviews'
import { WordEditor } from './word'
import { PersonalWritingEditor } from './writing'

const PdfPreview = lazy(() => import('./pdf'))

export function DocumentDetail({
  id,
  personId,
  openWord,
  openTrash,
  openReview,
}: {
  id: string
  personId: string
  openWord?: boolean
  openTrash?: boolean
  openReview?: boolean
}) {
  const { t } = useTranslation()
  const detail = useQuery({
    queryKey: [...documentsKey, personId, id, 'detail'],
    queryFn: () =>
      request<DocumentItem & { reviewCount?: number }>(documentPath(id)),
    refetchInterval: (query) =>
      query.state.data?.indexStatus === 'pending' ? 3000 : false,
  })
  const versions = useQuery({
    queryKey: [...documentsKey, personId, id, 'versions'],
    queryFn: () => request<DocumentVersion[]>(`${documentPath(id)}/versions`),
    refetchInterval: (query) =>
      query.state.data?.some((version) => version.indexStatus === 'pending')
        ? 3000
        : false,
  })
  return (
    <Main id='writing-main' className='grid grid-cols-1 gap-5'>
      <div>
        <Button variant='ghost' asChild>
          <Link to='/documents'>
            <ArrowLeft />
            {t('documents.title')}
          </Link>
        </Button>
      </div>
      <Problem error={detail.error ?? versions.error} />
      {(detail.isPending || versions.isPending) && (
        <p role='status'>{t('loading')}</p>
      )}
      {detail.data && versions.data && (
        <DocumentWorkspace
          entry={detail.data}
          versions={versions.data}
          openWord={openWord}
          openTrash={openTrash}
          openReview={openReview}
        />
      )}
    </Main>
  )
}

function DocumentWorkspace({
  entry,
  versions,
  openWord,
  openTrash,
  openReview,
}: {
  entry: DocumentItem & { reviewCount?: number }
  versions: DocumentVersion[]
  openWord?: boolean
  openTrash?: boolean
  openReview?: boolean
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<number | null>(null)
  const [stage, setStage] = useState<Stage>('goals')
  const [adviceStage, setAdviceStage] = useState<'outline' | 'revise'>(
    'outline'
  )
  const [activeTool, setActiveTool] = useState<DocumentTool | null>(
    openReview && !entry.trashedAt ? 'discussions' : null
  )
  const [minimized, setMinimized] = useState<DocumentTool[]>([])
  const [debateVersion, setDebateVersion] = useState<number | null>(null)
  const [returnFocus, setReturnFocus] = useState('document-tool-summary')
  const [confirmation, setConfirmation] = useState<
    'trash' | 'delete' | DocumentVersion | null
  >(openTrash && !entry.trashedAt ? 'trash' : null)
  const [chosenFile, setChosenFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const path = documentPath(entry.id)
  const selected =
    versions.find(
      (version) => version.number === (selection ?? entry.currentVersion)
    ) ?? versions[0]
  const original = versions.find((version) => version.number === 1)
  const editable = !entry.trashedAt && selection === null
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: documentsKey })
  }, [client])
  const mutate = useMutation({
    mutationFn: ({
      suffix,
      method,
      data,
    }: {
      suffix: string
      method: string
      data?: unknown
    }) => request(`${path}${suffix}`, method, data),
    onSuccess: (_data, operation) => {
      setConfirmation(null)
      if (operation.suffix.endsWith('/restore')) setSelection(null)
      refresh()
      if (operation.method === 'DELETE') void navigate({ to: '/documents' })
    },
  })
  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadDocument(file, file.name, entry, setProgress),
    onMutate: () => setProgress(0),
    onSuccess: () => {
      setChosenFile(null)
      setSelection(null)
      refresh()
    },
  })
  const copy = useMutation({
    mutationFn: (file: File) => uploadDocument(file, file.name),
    onSuccess: () => {
      setChosenFile(null)
      upload.reset()
      refresh()
    },
  })

  function openTool(tool: DocumentTool, fromSummary = false) {
    setReturnFocus(
      fromSummary ? 'document-tool-summary' : `document-tool-${tool}`
    )
    if (tool === 'aiDebate' && debateVersion === null)
      setDebateVersion(selected.number)
    setMinimized((items) => items.filter((item) => item !== tool))
    setActiveTool(tool)
  }

  function controls(tool: DocumentTool): ToolDialogControls {
    return {
      open: activeTool === tool,
      close: () => setActiveTool(null),
      minimize: () => {
        setReturnFocus('document-tool-summary')
        setMinimized((items) => [...items, tool])
        setActiveTool(null)
      },
      restoreFocus: () =>
        (
          document.getElementById(returnFocus) ??
          document.getElementById('document-tool-summary')
        )?.focus(),
    }
  }

  function chooseVersion(number: number | null) {
    if (selection === number) return
    setSelection(number)
    setStage('goals')
    setMinimized((items) => items.filter((item) => item !== 'aiWriting'))
  }

  return (
    <>
      <header className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0 space-y-2'>
          <h1 className='text-2xl font-semibold wrap-break-word'>
            {entry.title}
          </h1>
          <div className='flex items-center gap-2'>
            <Badge>{t(`documents.format.${selected.format}`)}</Badge>
            <span className='text-sm text-muted-foreground'>
              {t('documents.version', { number: selected.number })}
            </span>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          {!entry.trashedAt && (
            <>
              {selected.format === 'writing' &&
                editable &&
                (stage === 'outline' || stage === 'revise') && (
                  <Button
                    variant='outline'
                    id='document-tool-aiWriting'
                    onClick={() => {
                      setAdviceStage(stage)
                      openTool('aiWriting')
                    }}
                  >
                    <Sparkles />
                    {t('documents.aiWriting')}
                  </Button>
                )}
              <Button
                variant='outline'
                id='document-tool-discussions'
                onClick={() => openTool('discussions')}
              >
                <MessagesSquare />
                {t('documents.discussions')}
              </Button>
              <Button
                variant='outline'
                id='document-tool-aiDebate'
                onClick={() => openTool('aiDebate')}
              >
                {t('documents.aiDebate')}
              </Button>
            </>
          )}
          {selected.format !== 'writing' && (
            <Button variant='outline' asChild>
              <a href={versionFile(entry.id, selected.number)} download>
                <Download />
                {t('documents.download')}
              </a>
            </Button>
          )}
          {original &&
            original.format !== 'writing' &&
            original.number !== selected.number && (
              <Button variant='outline' asChild>
                <a href={versionFile(entry.id, original.number)} download>
                  {t('documents.downloadOriginal')}
                </a>
              </Button>
            )}
          {entry.trashedAt ? (
            <>
              <Button
                variant='outline'
                onClick={() =>
                  mutate.mutate({
                    suffix: '/trash',
                    method: 'PUT',
                    data: { trash: false },
                  })
                }
              >
                <RotateCcw />
                {t('documents.restoreTrash')}
              </Button>
              <Button
                variant='destructive'
                onClick={() => setConfirmation('delete')}
              >
                {t('documents.delete')}
              </Button>
            </>
          ) : (
            <Button variant='ghost' onClick={() => setConfirmation('trash')}>
              <Trash2 />
              {t('documents.moveToTrash')}
            </Button>
          )}
        </div>
      </header>
      {selection && (
        <div className='flex items-center gap-2'>
          <Badge variant='outline'>{t('documents.history')}</Badge>
          <Button variant='ghost' onClick={() => chooseVersion(null)}>
            {t('documents.backToCurrent')}
          </Button>
        </div>
      )}
      <Problem error={mutate.error} />
      <section
        key={`${entry.id}:${selection ?? 'current'}`}
        className='min-w-0'
        aria-label={t('documents.preview')}
      >
        {selected.format === 'md' && (
          <MarkdownDocument
            entry={entry}
            version={selected.number}
            editable={editable}
            onSaved={refresh}
          />
        )}
        {selected.format === 'pdf' && (
          <Suspense fallback={<p role='status'>{t('loading')}</p>}>
            <PdfPreview
              key={selected.number}
              url={versionFile(entry.id, selected.number)}
            />
          </Suspense>
        )}
        {selected.format === 'docx' && !entry.trashedAt && (
          <WordEditor
            id={entry.id}
            version={selected.number}
            canEdit={editable && entry.source !== 'writing'}
            autoOpen={openWord && selection === null && selected.number === 1}
            onSaved={refresh}
          />
        )}
        {selected.format === 'doc' && (
          <div className='grid gap-2'>
            <p className='text-sm text-muted-foreground'>
              {t('documents.convertHint')}
            </p>
            {editable && (
              <div>
                <Button
                  disabled={mutate.isPending}
                  onClick={() =>
                    mutate.mutate({
                      suffix: '/convert',
                      method: 'POST',
                      data: {},
                    })
                  }
                >
                  {t('documents.convert')}
                </Button>
              </div>
            )}
          </div>
        )}
        {selected.format === 'writing' && (
          <PersonalWritingEditor
            entry={entry}
            version={selected.number}
            editable={editable}
            versions={versions}
            stage={stage}
            onStageChange={setStage}
            advice={controls('aiWriting')}
            adviceStage={adviceStage}
            onSaved={refresh}
          />
        )}
        {selected.indexStatus === 'failed' && (
          <div className='mt-3 space-y-2'>
            <p className='text-sm text-muted-foreground'>
              {t([
                `error.${selected.indexError}`,
                'error.documentParserFailed',
              ])}
            </p>
            {!entry.trashedAt && (
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  mutate.mutate({
                    suffix: `/versions/${selected.number}/index`,
                    method: 'POST',
                  })
                }
              >
                {t('documents.retryIndex')}
              </Button>
            )}
          </div>
        )}
        {selected.indexStatus === 'empty' && selected.format === 'pdf' && (
          <p className='mt-3 text-sm text-muted-foreground'>
            {t('documents.noText')}
          </p>
        )}
      </section>
      {!entry.trashedAt && (
        <>
          <DocumentToolSummary
            items={minimized}
            onRestore={(tool) => openTool(tool, true)}
          />
          <ReviewList
            document={entry.id}
            versions={versions}
            selectedVersion={selected.number}
            dialog={controls('discussions')}
            showInvite={openReview}
          />
          {debateVersion !== null && (
            <DocumentDebateDialog
              documentId={entry.id}
              version={debateVersion}
              currentVersion={selected.number}
              versions={versions}
              controls={controls('aiDebate')}
            />
          )}
          <Card id='document-details'>
            <CardHeader>
              <CardTitle>{t('documents.details')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className='grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end'
                key={JSON.stringify([entry.title, entry.tags])}
                onSubmit={(event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  mutate.mutate({
                    suffix: '',
                    method: 'PATCH',
                    data: {
                      title: form.get('title'),
                      tags: String(form.get('tags'))
                        .split(/[,，]/u)
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    },
                  })
                }}
              >
                <Label className='grid gap-2'>
                  {t('documents.name')}
                  <Input
                    name='title'
                    defaultValue={entry.title}
                    maxLength={180}
                    required
                  />
                </Label>
                <Label className='grid gap-2'>
                  {t('documents.tags')}
                  <Input
                    name='tags'
                    defaultValue={entry.tags.join(', ')}
                    placeholder={t('documents.tagsHint')}
                  />
                </Label>
                <Button variant='outline' disabled={mutate.isPending}>
                  {t('documents.saveDetails')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
      <Card id='document-versions'>
        <CardHeader className='flex flex-wrap items-center justify-between gap-2'>
          <CardTitle>{t('documents.versions')}</CardTitle>
          {!entry.trashedAt && entry.source !== 'writing' && (
            <Button
              variant='outline'
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <Upload />
              {t('documents.uploadVersion')}
            </Button>
          )}
        </CardHeader>
        <CardContent className='space-y-3'>
          <input
            type='file'
            ref={input}
            hidden
            accept='.docx,.doc,.pdf,.md,.markdown'
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                setChosenFile(file)
                upload.mutate(file)
              }
              event.target.value = ''
            }}
          />
          <Problem error={copy.error ?? upload.error} />
          {upload.error && chosenFile && (
            <div className='flex gap-2'>
              <Button
                variant='outline'
                onClick={() => upload.mutate(chosenFile)}
              >
                {t('retry')}
              </Button>
              <Button
                variant='outline'
                disabled={copy.isPending}
                onClick={() => copy.mutate(chosenFile)}
              >
                {t('documents.saveCopy')}
              </Button>
            </div>
          )}
          {upload.isPending && (
            <progress
              aria-label={t('documents.upload')}
              max={100}
              value={progress}
              className='w-full'
            >
              {progress}%
            </progress>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('documents.versions')}</TableHead>
                <TableHead>{t('documents.name')}</TableHead>
                <TableHead>{t('documents.updated')}</TableHead>
                <TableHead>{t('documents.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((version) => (
                <TableRow key={version.number}>
                  <TableCell>
                    <Button
                      variant='link'
                      onClick={() =>
                        chooseVersion(
                          version.number === entry.currentVersion
                            ? null
                            : version.number
                        )
                      }
                    >
                      {t('documents.version', { number: version.number })}
                    </Button>
                    {version.conflict && (
                      <Badge variant='destructive'>
                        {t('documents.conflict')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {version.filename}{' '}
                    <span className='ms-2 text-muted-foreground'>
                      {version.author}
                    </span>
                  </TableCell>
                  <TableCell>
                    {new Date(version.createdAt).toLocaleString(i18n.language)}
                  </TableCell>
                  <TableCell>
                    <div className='flex gap-2'>
                      {version.format !== 'writing' && (
                        <Button asChild variant='ghost' size='sm'>
                          <a
                            href={versionFile(entry.id, version.number)}
                            download
                          >
                            {t('documents.download')}
                          </a>
                        </Button>
                      )}
                      {!entry.trashedAt &&
                        version.number !== entry.currentVersion &&
                        (entry.source !== 'writing' ||
                          version.format === 'writing') && (
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => setConfirmation(version)}
                          >
                            {t('documents.restoreVersion')}
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <ConfirmDialog
        cancelBtnText={t('cancel')}
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
        title={t(
          confirmation === 'delete'
            ? 'documents.delete'
            : confirmation === 'trash'
              ? 'documents.moveToTrash'
              : 'documents.restoreVersion'
        )}
        desc={t(
          confirmation === 'delete'
            ? 'documents.deleteConfirm'
            : confirmation === 'trash'
              ? 'documents.trashConfirm'
              : 'documents.restoreConfirm',
          { count: entry.reviewCount ?? 0 }
        )}
        confirmText={t(
          confirmation === 'delete'
            ? 'documents.delete'
            : confirmation === 'trash'
              ? 'documents.moveToTrash'
              : 'documents.restoreVersion'
        )}
        destructive={confirmation === 'delete' || confirmation === 'trash'}
        isLoading={mutate.isPending}
        handleConfirm={() => {
          if (confirmation === 'delete')
            mutate.mutate({ suffix: '', method: 'DELETE' })
          else if (confirmation === 'trash')
            mutate.mutate({
              suffix: '/trash',
              method: 'PUT',
              data: { trash: true },
            })
          else if (confirmation)
            mutate.mutate({
              suffix: `/versions/${confirmation.number}/restore`,
              method: 'POST',
              data: { base: entry.currentVersion },
            })
        }}
      />
    </>
  )
}
