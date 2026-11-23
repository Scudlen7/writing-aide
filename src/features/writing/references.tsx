import { useState, type FormEvent } from 'react'
import {
  doiSchema,
  referenceKinds,
  referenceReady,
  referenceSchema,
  referenceUrl,
  type ReferenceSource,
} from '@writing/references'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { request, RequestError } from './api'
import type { CitationInput } from './editor'
import { Field, Problem } from './ui'

export function ReferencesPanel({
  assignmentId,
  lookupPath,
  sources,
  cited,
  onChange,
  onInsert,
}: {
  assignmentId?: string
  lookupPath?: string
  sources: ReferenceSource[]
  cited: Set<string>
  onChange: (sources: ReferenceSource[]) => void
  onInsert: (citation: CitationInput) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<ReferenceSource | null>(null)
  const [error, setError] = useState<unknown>(null)
  return (
    <details className='rounded-xl border bg-card'>
      <summary className='cursor-pointer px-4 py-3 text-sm font-semibold'>
        {t('referencesPanel')}
      </summary>
      <div className='space-y-3 border-t p-4 text-sm'>
        <p className='text-muted-foreground'>{t('referencesHint')}</p>
        {sources.map((source) => (
          <div className='space-y-2 rounded-md border p-2' key={source.id}>
            <p className='font-medium wrap-break-word'>
              {source.title || t('referenceUntitled')}
            </p>
            <p className='text-xs text-muted-foreground'>
              {t(
                referenceReady(source)
                  ? 'referenceVerified'
                  : 'referenceUnverified'
              )}
            </p>
            {source.evidence && (
              <p className='wrap-break-word whitespace-pre-wrap'>
                {source.evidence}
              </p>
            )}
            {referenceUrl(source) && (
              <a
                href={referenceUrl(source)}
                target='_blank'
                rel='noreferrer'
                className='text-primary underline'
              >
                {t('openReference')}
              </a>
            )}
            <div className='flex flex-wrap gap-1.5'>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={!referenceReady(source)}
                onClick={() =>
                  onInsert({ sourceId: source.id, locator: source.locator })
                }
              >
                {t('insertCitation')}
              </Button>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() => {
                  setError(null)
                  setEditing(source)
                }}
              >
                {t('edit')}
              </Button>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() => {
                  if (cited.has(source.id))
                    setError(new RequestError(400, 'unavailableReference'))
                  else {
                    setError(null)
                    onChange(sources.filter((item) => item.id !== source.id))
                  }
                }}
              >
                {t('remove')}
              </Button>
            </div>
          </div>
        ))}
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={sources.length >= 40}
          onClick={() => {
            setError(null)
            setEditing({
              id: crypto.randomUUID(),
              kind: 'webpage',
              title: '',
              authors: [],
              year: '',
              venue: '',
              volume: '',
              issue: '',
              pages: '',
              url: '',
              doi: '',
              evidence: '',
              locator: '',
              verified: false,
            })
          }}
        >
          {t('addReference')}
        </Button>
        <Problem error={error} />
      </div>
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent className='max-h-[min(85dvh,42rem)] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('referenceDetails')}</DialogTitle>
            <DialogDescription>{t('referenceDetailsHint')}</DialogDescription>
          </DialogHeader>
          {editing && (
            <ReferenceForm
              lookupPath={
                lookupPath ?? `/api/assignments/${assignmentId}/reference-doi`
              }
              initial={editing}
              onSave={(source) => {
                if (
                  source.doi &&
                  sources.some(
                    (item) => item.id !== source.id && item.doi === source.doi
                  )
                )
                  throw new RequestError(400, 'duplicateReference')
                if (cited.has(source.id) && !referenceReady(source))
                  throw new RequestError(400, 'unavailableReference')
                onChange(
                  sources.some((item) => item.id === source.id)
                    ? sources.map((item) =>
                        item.id === source.id ? source : item
                      )
                    : [...sources, source]
                )
                setEditing(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </details>
  )
}

function ReferenceForm({
  lookupPath,
  initial,
  onSave,
}: {
  lookupPath: string
  initial: ReferenceSource
  onSave: (source: ReferenceSource) => void
}) {
  const { t } = useTranslation()
  const [source, setSource] = useState(initial)
  const names = (authors: ReferenceSource['authors']) =>
    authors
      .map(({ family, given }) => (given ? `${family}, ${given}` : family))
      .join('\n')
  const [authors, setAuthors] = useState(() => names(initial.authors))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = referenceSchema.safeParse({
      ...source,
      authors: authors
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [, family, given] = /^([^,]+)(?:,(.*))?$/.exec(line) ?? []
          return { family, given: given ?? '' }
        }),
    })
    if (!parsed.success) {
      setError(new RequestError(400, 'invalidReference'))
      return
    }
    try {
      onSave(parsed.data)
    } catch (cause) {
      setError(cause)
    }
  }

  async function lookup() {
    setError(null)
    const doi = doiSchema.safeParse(source.doi)
    if (!doi.success) {
      setError(new RequestError(400, 'invalidReference'))
      return
    }
    setLoading(true)
    try {
      const fetched = await request<ReferenceSource>(lookupPath, 'POST', {
        doi: doi.data,
      })
      setSource((previous) => ({
        ...fetched,
        id: previous.id,
        evidence: previous.evidence,
        locator: previous.locator,
      }))
      setAuthors(names(fetched.authors))
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }

  const textFields = [
    ['title', 'referenceTitle', 500],
    ['year', 'referenceYear', 4],
    ['venue', 'referenceVenue', 300],
    ...(source.kind === 'article'
      ? ([
          ['volume', 'referenceVolume', 40],
          ['issue', 'referenceIssue', 40],
          ['pages', 'referencePages', 60],
        ] as const)
      : []),
    ['url', 'referenceUrl', 2048],
    ['locator', 'referenceLocator', 80],
  ] as const
  return (
    <form className='grid gap-3' onSubmit={submit}>
      <div className='flex items-end gap-2'>
        <div className='min-w-0 flex-1'>
          <Field label={t('referenceDoi')}>
            <Input
              value={source.doi}
              maxLength={400}
              onChange={(event) =>
                setSource({
                  ...source,
                  doi: event.target.value,
                  verified: false,
                })
              }
            />
          </Field>
        </div>
        <Button
          type='button'
          variant='outline'
          disabled={loading}
          onClick={() => void lookup()}
        >
          {t(loading ? 'loading' : 'lookupDoi')}
        </Button>
      </div>
      <Field label={t('referenceKind')}>
        <select
          className='h-9 rounded-md border border-input bg-background px-2'
          value={source.kind}
          onChange={(event) =>
            setSource({
              ...source,
              kind: event.target.value as ReferenceSource['kind'],
            })
          }
        >
          {referenceKinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`referenceType.${kind}`)}
            </option>
          ))}
        </select>
      </Field>
      {textFields.map(([field, label, maxLength]) => (
        <Field key={field} label={t(label)}>
          <Input
            value={source[field]}
            maxLength={maxLength}
            onChange={(event) =>
              setSource({
                ...source,
                [field]: event.target.value,
                ...(field === 'url' ? { verified: false } : {}),
              })
            }
          />
        </Field>
      ))}
      <Field label={t('referenceAuthors')}>
        <Textarea
          rows={2}
          value={authors}
          maxLength={12000}
          onChange={(event) => setAuthors(event.target.value)}
        />
      </Field>
      <Field label={t('referenceEvidence')}>
        <Textarea
          value={source.evidence}
          rows={2}
          maxLength={2000}
          onChange={(event) =>
            setSource({ ...source, evidence: event.target.value })
          }
        />
      </Field>
      <label className='flex items-center gap-2 text-sm'>
        <Checkbox
          checked={source.verified}
          onCheckedChange={(verified) =>
            setSource({ ...source, verified: verified === true })
          }
        />
        {t('verifyReference')}
      </label>
      <Problem error={error} />
      <Button type='submit' disabled={loading}>
        {t('save')}
      </Button>
    </form>
  )
}
