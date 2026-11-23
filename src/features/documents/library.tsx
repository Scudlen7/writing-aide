import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { uploadFormats, type DocumentItem } from '@writing/documents'
import {
  FileText,
  FolderOpen,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Main } from '@/components/layout/main'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import {
  documentPath,
  documentsKey,
  uploadDocument,
  versionFile,
  type DocumentList,
  type SavedDocument,
} from './api'

type UploadJob = { id: string; file: File; progress: number; error?: unknown }

export function DocumentLibrary({ personId }: { personId: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const picker = useRef<HTMLInputElement>(null)
  const [layout, setLayout] = useState<'cards' | 'list'>('cards')
  const [trash, setTrash] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [search, setSearch] = useState('')
  const [format, setFormat] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('newest')
  const [updatedAfter, setUpdatedAfter] = useState('')
  const [page, setPage] = useState(1)
  const [uploads, setUploads] = useState<UploadJob[]>([])
  const [creating, setCreating] = useState<'word' | 'writing' | null>(null)
  const query = new URLSearchParams({
    q: search,
    page: String(page),
    sort,
    trash: trash ? '1' : '0',
  })
  if (format) query.set('format', format)
  if (tag) query.set('tag', tag)
  if (updatedAfter) query.set('updatedAfter', updatedAfter)
  const entries = useQuery({
    queryKey: [...documentsKey, personId, query.toString()],
    queryFn: () => request<DocumentList>(`${documentPath()}?${query}`),
    refetchInterval: (state) =>
      state.state.data?.items.some((entry) => entry.indexStatus === 'pending')
        ? 3000
        : false,
  })

  async function send(job: UploadJob) {
    const update = (changes: Partial<UploadJob>) =>
      setUploads((items) =>
        items.map((item) =>
          item.id === job.id ? { ...item, ...changes } : item
        )
      )
    update({ progress: 0, error: undefined })
    try {
      await uploadDocument(job.file, job.file.name, undefined, (progress) =>
        update({ progress })
      )
      setUploads((items) => items.filter((item) => item.id !== job.id))
      await queryClient.invalidateQueries({ queryKey: documentsKey })
    } catch (error) {
      update({ error })
    }
  }

  async function upload(files: FileList) {
    const jobs = Array.from(files, (file) => ({
      file,
      id: crypto.randomUUID(),
      progress: 0,
    }))
    setUploads((items) => [...items, ...jobs])
    for (const job of jobs) await send(job)
  }

  function metadata(entry: DocumentItem) {
    return (
      <div className='flex flex-wrap gap-1.5'>
        <Badge variant='secondary'>
          {t(`documents.format.${entry.format}`)}
        </Badge>
        {entry.tags.map((label) => (
          <Badge variant='outline' key={label}>
            {label}
          </Badge>
        ))}
      </div>
    )
  }

  return (
    <Main id='writing-main' className='grid grid-cols-1 content-start gap-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className='text-2xl font-semibold tracking-tight'>
          {t(trash ? 'documents.trash' : 'documents.title')}
        </h1>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='ghost'
            onClick={() => {
              setTrash(!trash)
              setTag('')
              setPage(1)
            }}
          >
            {trash ? <FolderOpen /> : <Trash2 />}
            {t(trash ? 'documents.title' : 'documents.trash')}
          </Button>
          {!trash && (
            <>
              <Button variant='outline' onClick={() => picker.current?.click()}>
                <Upload />
                {t('documents.upload')}
              </Button>
              <Button variant='outline' onClick={() => setCreating('writing')}>
                {t('documents.createWriting')}
              </Button>
              <Button onClick={() => setCreating('word')}>
                <Plus />
                {t('documents.createWord')}
              </Button>
            </>
          )}
        </div>
      </header>
      <input
        type='file'
        hidden
        ref={picker}
        multiple
        accept='.docx,.doc,.pdf,.md,.markdown'
        onChange={(event) => {
          if (event.target.files) void upload(event.target.files)
          event.target.value = ''
        }}
      />
      <section className='grid gap-3' aria-label={t('documents.filters')}>
        <div className='flex flex-wrap gap-2'>
          <Input
            type='search'
            className='min-w-48 flex-1'
            aria-label={t('documents.search')}
            placeholder={t('documents.search')}
            value={search}
            maxLength={180}
            onChange={(event) => {
              setPage(1)
              setSearch(event.target.value)
            }}
          />
          <div className='flex gap-1'>
            <Button
              variant={layout === 'cards' ? 'secondary' : 'ghost'}
              size='icon'
              aria-pressed={layout === 'cards'}
              aria-label={t('documents.cards')}
              onClick={() => setLayout('cards')}
            >
              <LayoutGrid />
            </Button>
            <Button
              variant={layout === 'list' ? 'secondary' : 'ghost'}
              size='icon'
              aria-pressed={layout === 'list'}
              aria-label={t('documents.list')}
              onClick={() => setLayout('list')}
            >
              <List />
            </Button>
          </div>
        </div>
        <div className='flex flex-wrap gap-2 text-sm'>
          <select
            className='rounded-md border bg-background px-2'
            aria-label={t('documents.formats')}
            value={format}
            onChange={(event) => {
              setFormat(event.target.value)
              setPage(1)
            }}
          >
            <option value=''>{t('documents.formats')}</option>
            {[...uploadFormats, 'writing'].map((value) => (
              <option key={value} value={value}>
                {t(`documents.format.${value}`)}
              </option>
            ))}
          </select>
          <select
            className='rounded-md border bg-background px-2'
            aria-label={t('documents.tags')}
            value={tag}
            onChange={(event) => {
              setTag(event.target.value)
              setPage(1)
            }}
          >
            <option value=''>{t('documents.allTags')}</option>
            {entries.data?.tags.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            className='rounded-md border bg-background px-2'
            aria-label={t('documents.sort')}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value)
              setPage(1)
            }}
          >
            {['newest', 'oldest', 'title'].map((value) => (
              <option key={value} value={value}>
                {t(
                  value === 'title'
                    ? 'documents.titleOrder'
                    : `documents.${value}`
                )}
              </option>
            ))}
          </select>
          <Label className='flex gap-2'>
            {t('documents.updatedAfter')}
            <Input
              type='date'
              className='w-auto'
              value={updatedAfter}
              onChange={(event) => {
                setUpdatedAfter(event.target.value)
                setPage(1)
              }}
            />
          </Label>
        </div>
      </section>
      <div
        className='grid grid-cols-1 gap-4'
        onDragOver={(event) => {
          if (trash || !event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!trash) void upload(event.dataTransfer.files)
        }}
      >
        {!trash && (
          <Button
            className={`h-16 border-dashed ${dragging ? 'border-primary bg-accent' : ''}`}
            variant='outline'
            onClick={() => picker.current?.click()}
          >
            <Upload />
            {t('documents.drop')}
          </Button>
        )}
        {uploads.map((job) => (
          <Card key={job.id}>
            <CardContent className='grid gap-2 break-all'>
              <p>{job.file.name}</p>
              {job.error ? (
                <>
                  <Problem error={job.error} />
                  <Button variant='outline' onClick={() => void send(job)}>
                    {t('retry')}
                  </Button>
                </>
              ) : (
                <progress
                  aria-label={t('documents.upload')}
                  className='w-full'
                  max={100}
                  value={job.progress}
                >
                  {job.progress}%
                </progress>
              )}
            </CardContent>
          </Card>
        ))}
        <Problem error={entries.error} />
        {entries.isPending && <p role='status'>{t('loading')}</p>}
        {entries.data?.items.length === 0 && (
          <p className='rounded-lg border p-8 text-center text-muted-foreground'>
            {t('documents.empty')}
          </p>
        )}
        {!!entries.data?.items.length && layout === 'cards' && (
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {entries.data.items.map((entry) => (
              <Card key={entry.id} className='min-w-0'>
                <CardContent className='grid gap-3'>
                  <FileText aria-hidden className='size-8 text-primary' />
                  <Link
                    className='font-medium break-words hover:underline'
                    to='/documents/$documentId'
                    params={{ documentId: entry.id }}
                  >
                    {entry.title}
                  </Link>
                  {metadata(entry)}
                  {entry.excerpt && (
                    <p className='line-clamp-3 text-sm text-muted-foreground'>
                      {entry.excerpt}
                    </p>
                  )}
                  <p className='text-sm text-muted-foreground'>
                    {new Date(entry.updatedAt).toLocaleString(i18n.language)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {!!entries.data?.items.length && layout === 'list' && (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('documents.name')}</TableHead>
                  <TableHead>{t('documents.formats')}</TableHead>
                  <TableHead>{t('documents.updated')}</TableHead>
                  <TableHead>
                    <span className='sr-only'>{t('documents.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className='max-w-xs whitespace-normal'>
                      <Link
                        className='font-medium hover:underline'
                        to='/documents/$documentId'
                        params={{ documentId: entry.id }}
                      >
                        {entry.title}
                      </Link>
                      {entry.excerpt && (
                        <p className='line-clamp-2 text-sm text-muted-foreground'>
                          {entry.excerpt}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{metadata(entry)}</TableCell>
                    <TableCell>
                      {new Date(entry.updatedAt).toLocaleString(i18n.language)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='ghost'
                            size='icon'
                            aria-label={`${t('documents.actions')} · ${entry.title}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          {entry.format !== 'writing' && (
                            <DropdownMenuItem asChild>
                              <a
                                href={versionFile(
                                  entry.id,
                                  entry.currentVersion
                                )}
                                download
                              >
                                {t('documents.download')}
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem asChild>
                            <Link
                              to='/documents/$documentId'
                              params={{ documentId: entry.id }}
                              hash='document-versions'
                            >
                              {t('documents.versions')}
                            </Link>
                          </DropdownMenuItem>
                          {!entry.trashedAt && (
                            <>
                              <DropdownMenuItem asChild>
                                <Link
                                  to='/documents/$documentId'
                                  params={{ documentId: entry.id }}
                                  hash='document-details'
                                >
                                  {t('documents.renameTags')}
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link
                                  to='/documents/$documentId'
                                  params={{ documentId: entry.id }}
                                  search={{ open: 'review' }}
                                >
                                  {t('documents.invite')}
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link
                                  to='/documents/$documentId'
                                  params={{ documentId: entry.id }}
                                  search={{ open: 'trash' }}
                                >
                                  {t('documents.moveToTrash')}
                                </Link>
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      {entries.data && (
        <nav
          className='flex flex-wrap items-center justify-end gap-2'
          aria-label={t('documents.pagination')}
        >
          <span className='text-sm text-muted-foreground'>
            {t('documents.count', { count: entries.data.total })}
          </span>
          <Button
            variant='outline'
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('documents.previous')}
          </Button>
          <Button
            variant='outline'
            disabled={page * 24 >= entries.data.total}
            onClick={() => setPage(page + 1)}
          >
            {t('documents.next')}
          </Button>
        </nav>
      )}
      <Dialog
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
      >
        {creating && (
          <CreateDocument
            kind={creating}
            onCreated={(id) => {
              const open = creating === 'word' ? 'word' : undefined
              setCreating(null)
              void queryClient.invalidateQueries({ queryKey: documentsKey })
              void navigate({
                to: '/documents/$documentId',
                params: { documentId: id },
                search: { open },
              })
            }}
          />
        )}
      </Dialog>
    </Main>
  )
}

function CreateDocument({
  kind,
  onCreated,
}: {
  kind: 'word' | 'writing'
  onCreated: (id: string) => void
}) {
  const { t, i18n } = useTranslation()
  const create = useMutation({
    mutationFn: (data: { title: string; language: string }) =>
      request<SavedDocument>(`${documentPath()}/${kind}`, 'POST', data),
    onSuccess: (entry) => onCreated(entry.id),
  })
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {t(
            kind === 'word' ? 'documents.createWord' : 'documents.createWriting'
          )}
        </DialogTitle>
      </DialogHeader>
      <form
        className='grid gap-4'
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          create.mutate({
            title: String(data.get('title')),
            language: String(data.get('language') ?? ''),
          })
        }}
      >
        <Label className='grid gap-2'>
          {t('documents.name')}
          <Input name='title' required maxLength={180} autoFocus />
        </Label>
        {kind === 'writing' && (
          <Label>
            {t('documents.paperLanguage')}
            <select
              className='rounded-md border bg-background p-2'
              name='language'
              defaultValue={i18n.language === 'en' ? 'en' : 'zh-CN'}
            >
              <option value='zh-CN'>简体中文</option>
              <option value='en'>English</option>
            </select>
          </Label>
        )}
        <Problem error={create.error} />
        <DialogFooter>
          <Button disabled={create.isPending}>{t('documents.create')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
