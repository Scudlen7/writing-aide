import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  aiRoles,
  type DebateExcerpt,
  type DebateRun,
  type DebateStep,
  type DebateTarget,
} from '@writing/debate'
import type { ReviewSummary } from '@writing/discussions'
import type { DocumentVersion } from '@writing/documents'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import { discussionsKey, discussionsPath } from './api'
import { DebateSelection } from './debate-selection'
import { DocumentToolDialog, type ToolDialogControls } from './document-tools'

const base = '/api/ai-debates'

export function DebatePanel({ target }: { target: DebateTarget }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <CardHeader className='flex flex-wrap items-center justify-between gap-2'>
        <CardTitle>{t('documents.aiDebate')}</CardTitle>
        <Button
          variant='outline'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t(open ? 'documents.hideDebate' : 'documents.openDebate')}
        </Button>
      </CardHeader>
      {open && (
        <CardContent>
          <DebateEditor key={JSON.stringify(target)} target={target} />
        </CardContent>
      )}
    </Card>
  )
}

export function DocumentDebateDialog({
  documentId,
  version,
  currentVersion,
  versions,
  controls,
}: {
  documentId: string
  version: number
  currentVersion: number
  versions: DocumentVersion[]
  controls: ToolDialogControls
}) {
  return (
    <DebateEditor
      target={{ documentId, version }}
      controls={controls}
      currentVersion={currentVersion}
      versions={versions}
    />
  )
}

function DebateEditor({
  target,
  controls,
  currentVersion,
  versions,
}: {
  target: DebateTarget
  controls?: ToolDialogControls
  currentVersion?: number
  versions?: DocumentVersion[]
}) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const stopped = useRef(false)
  const [selection, setSelection] = useState<string | null | undefined>(
    controls ? undefined : null
  )
  const [version, setVersion] = useState(target.version)
  const [topic, setTopic] = useState('')
  const [language, setLanguage] = useState(
    i18n.language === 'en' ? 'en' : 'zh-CN'
  )
  const [paragraph, setParagraph] = useState('')
  const [quote, setQuote] = useState({ text: '', offset: 0 })
  const [excerpts, setExcerpts] = useState<DebateExcerpt[]>([])
  const [followUp, setFollowUp] = useState('')
  const [pending, setPending] = useState(false)
  const [waiting, setWaiting] = useState<{
    round: number
    role: number
    question: string
  } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const isDocument = 'documentId' in target
  const selectedTarget = { ...target, version }
  const query = new URLSearchParams(
    Object.entries(selectedTarget).map(([key, value]) => [key, String(value)])
  )
  const reviewsQuery =
    'documentId' in target
      ? `document=${target.documentId}`
      : `assignment=${target.assignmentId}`
  const options = useQuery({
    queryKey: ['debates', query.toString()],
    queryFn: () =>
      request<{
        enabled: boolean
        paragraphs: string[]
        runs: Omit<DebateRun, 'steps'>[]
      }>(`${base}?${query}`),
  })
  const active = selection === undefined ? options.data?.runs[0]?.id : selection
  if (selection === undefined && active) setSelection(active)
  const run = useQuery({
    queryKey: ['debate', active],
    enabled: !!active,
    queryFn: () => request<DebateRun>(`${base}/${active}`),
  })
  const discussions = useQuery({
    queryKey: [...discussionsKey, reviewsQuery],
    enabled: !!active,
    queryFn: () =>
      request<ReviewSummary[]>(`${discussionsPath}?${reviewsQuery}`),
  })
  const sameVersion =
    discussions.data?.filter(
      (thread) => thread.version === version && thread.status === 'owner'
    ) ?? []
  const data = run.data
  const complete =
    data?.steps.filter((item) => item.state === 'ready').length ?? 0
  const round = Math.floor(complete / 3) + 1
  const role = complete % 3

  async function perform(
    runId: string,
    round: number,
    firstRole: number,
    question: string
  ) {
    stopped.current = false
    for (
      let role = firstRole;
      role < aiRoles.length && !stopped.current;
      role++
    ) {
      setWaiting({ round, role, question })
      try {
        await request<DebateStep>(`${base}/${runId}/step`, 'POST', {
          round,
          role,
          question,
        })
      } finally {
        await client.invalidateQueries({ queryKey: ['debate', runId] })
        setWaiting(null)
      }
    }
  }

  async function act(fn: () => Promise<void>) {
    setPending(true)
    setError(null)
    try {
      await fn()
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  function changeSelection(
    id: string | null | undefined,
    nextVersion = version
  ) {
    setSelection(id)
    setVersion(nextVersion)
    setError(null)
    setFollowUp('')
    setTopic('')
    setParagraph('')
    setQuote({ text: '', offset: 0 })
    setExcerpts([])
  }

  const messages = (
    <>
      <Problem error={error ?? options.error ?? run.error} />
      {options.isPending && <p role='status'>{t('loading')}</p>}
      {options.data && !options.data.enabled && (
        <p role='status'>{t('documents.debateUnavailable')}</p>
      )}
      {!controls && !!options.data?.runs.length && (
        <Label>
          {t('documents.debateHistory')}
          <select
            className='rounded-md border bg-background p-2'
            disabled={pending}
            value={active ?? ''}
            onChange={(event) => {
              changeSelection(event.target.value || null)
            }}
          >
            <option value=''>{t('documents.newDebate')}</option>
            {options.data.runs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.topic}
              </option>
            ))}
          </select>
        </Label>
      )}
      {controls &&
        options.data?.enabled &&
        selection === undefined &&
        !active && (
          <p className='text-sm text-muted-foreground'>
            {t('documents.noDebates')}
          </p>
        )}
      {options.data?.enabled && selection === null && (
        <form
          className='grid min-w-0 grid-cols-1 gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            void act(async () => {
              const created = await request<{ id: string }>(base, 'POST', {
                target: selectedTarget,
                topic,
                ...(isDocument
                  ? {
                      ranges: excerpts.map(({ start, end }) => ({
                        start,
                        end,
                      })),
                    }
                  : {
                      anchor: {
                        paragraph: Number(paragraph),
                        offset: quote.offset,
                        quote: quote.text,
                      },
                    }),
                language,
              })
              setSelection(created.id)
              await options.refetch()
              await perform(created.id, 1, 0, '')
            })
          }}
        >
          <Label className='grid min-w-0 gap-2'>
            {t('documents.topic')}
            <Input
              name='topic'
              required
              maxLength={1000}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
          </Label>
          <Label className='grid min-w-0 gap-2'>
            {t('documents.paperLanguage')}
            <select
              name='language'
              className='rounded-md border bg-background p-2'
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value='zh-CN'>简体中文</option>
              <option value='en'>English</option>
            </select>
          </Label>
          {isDocument ? (
            options.data.paragraphs.some((text) => text.trim()) ? (
              <DebateSelection
                key={version}
                paragraphs={options.data.paragraphs}
                ranges={excerpts}
                onChange={setExcerpts}
              />
            ) : (
              <p role='status' className='text-sm text-muted-foreground'>
                {t('documents.debateNoSource')}
              </p>
            )
          ) : (
            <>
              <Label className='grid min-w-0 gap-2'>
                {t('documents.paragraph')}
                <select
                  className='min-w-0 rounded-md border bg-background p-2'
                  required
                  value={paragraph}
                  onChange={(event) => {
                    setParagraph(event.target.value)
                    const text = event.target.value
                      ? options.data!.paragraphs[Number(event.target.value)]
                      : ''
                    setQuote({ text: text.slice(0, 2000), offset: 0 })
                  }}
                >
                  <option value=''>{t('documents.selectQuote')}</option>
                  {options.data.paragraphs.map((text, position) =>
                    text.trim() ? (
                      <option key={position} value={position}>
                        {position + 1} · {text.slice(0, 100)}
                      </option>
                    ) : null
                  )}
                </select>
              </Label>
              {paragraph && (
                <Textarea
                  readOnly
                  value={options.data.paragraphs[Number(paragraph)]}
                  aria-label={t('documents.selectQuote')}
                  onSelect={(event) => {
                    const item = event.currentTarget
                    if (item.selectionStart !== item.selectionEnd)
                      setQuote({
                        text: item.value
                          .slice(item.selectionStart, item.selectionEnd)
                          .slice(0, 2000),
                        offset: item.selectionStart,
                      })
                  }}
                />
              )}
              {quote.text && (
                <div>
                  <p className='text-sm font-medium'>
                    {t('documents.modelInput')}
                  </p>
                  <blockquote className='border-s-2 ps-3 text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground'>
                    {quote.text}
                  </blockquote>
                </div>
              )}
            </>
          )}
          <Button
            className='justify-self-start'
            disabled={
              pending || (isDocument ? excerpts.length === 0 : !quote.text)
            }
          >
            {t('documents.startDebate')}
          </Button>
        </form>
      )}
      {active && run.isPending && (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('loading')}
        </p>
      )}
      {data && (
        <section
          role={controls ? 'log' : undefined}
          aria-label={controls ? t('documents.aiDebate') : undefined}
          className='grid min-w-0 gap-4'
        >
          <header
            className={
              controls
                ? 'ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-4 py-3'
                : undefined
            }
          >
            <p className='font-medium wrap-anywhere'>{data.topic}</p>
            <div className='mt-2 grid gap-2'>
              {(
                data.excerpts?.map(({ text }) => text) ?? [data.anchor.quote]
              ).map((text, index) => (
                <blockquote
                  key={index}
                  className='border-s-2 ps-3 text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground'
                >
                  {text}
                </blockquote>
              ))}
            </div>
          </header>
          {data.steps.map((step, position) => (
            <div key={step.id} className='grid min-w-0 gap-3'>
              {controls &&
                step.question &&
                data.steps[position - 1]?.round !== step.round && (
                  <p className='ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-4 py-3 wrap-anywhere whitespace-pre-wrap'>
                    {step.question}
                  </p>
                )}
              <section
                className={
                  controls
                    ? 'grid min-w-0 gap-2 border-s-2 ps-3 sm:ps-4'
                    : 'grid gap-2 rounded-md border p-3'
                }
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge>{t('documents.aiDebate')}</Badge>
                  <span>{t(`documents.role.${aiRoles[step.role]}`)}</span>
                  <span className='text-sm text-muted-foreground'>
                    {t('documents.round', { round: step.round })}
                  </span>
                </div>
                <p className='wrap-anywhere whitespace-pre-wrap'>
                  {step.body ??
                    t(
                      step.state === 'failed'
                        ? 'documents.stepFailed'
                        : 'documents.saving'
                    )}
                </p>
                {step.body && sameVersion.length > 0 && (
                  <form
                    className='flex flex-wrap gap-2'
                    onSubmit={(event) => {
                      event.preventDefault()
                      const threadId = new FormData(event.currentTarget).get(
                        'thread'
                      )
                      void act(async () => {
                        await request(`${base}/${active}/share`, 'POST', {
                          threadId,
                          stepId: step.id,
                        })
                        await client.invalidateQueries({
                          queryKey: discussionsKey,
                        })
                      })
                    }}
                  >
                    <select
                      className='max-w-full min-w-0 rounded-md border bg-background p-2'
                      name='thread'
                      aria-label={t('documents.discussions')}
                    >
                      {sameVersion.map((thread) => (
                        <option key={thread.id} value={thread.id}>
                          {thread.topic || thread.title}
                        </option>
                      ))}
                    </select>
                    <Button variant='outline' disabled={pending}>
                      {t('documents.shareAi')}
                    </Button>
                  </form>
                )}
              </section>
            </div>
          ))}
          {waiting && (
            <>
              {controls &&
                waiting.question &&
                !data.steps.some((step) => step.round === waiting.round) && (
                  <p className='ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-4 py-3 wrap-anywhere whitespace-pre-wrap'>
                    {waiting.question}
                  </p>
                )}
              <p
                role='status'
                className='border-s-2 ps-3 text-sm text-muted-foreground'
              >
                <span className='font-medium'>
                  {t(`documents.role.${aiRoles[waiting.role]}`)}
                </span>
                {' · '}
                {t('documents.aiResponding')}
              </p>
            </>
          )}
        </section>
      )}
      {!data && waiting && (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('documents.aiResponding')}
        </p>
      )}
    </>
  )

  const composer =
    data && options.data?.enabled && round <= 4 ? (
      <form
        className='grid gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          void act(async () => {
            await perform(data.id, round, role, followUp)
            setFollowUp('')
          })
        }}
      >
        {round > 1 &&
          role === 0 &&
          !data.steps.some((step) => step.round === round) && (
            <Label className='grid gap-2'>
              {t('documents.followUp')}
              <Textarea
                value={followUp}
                onChange={(event) => setFollowUp(event.target.value)}
                required
                maxLength={1600}
              />
            </Label>
          )}
        <div className='flex flex-wrap gap-2'>
          <Button disabled={pending}>
            {t(
              role || data.steps.some((step) => step.round === round)
                ? 'documents.resumeDebate'
                : 'documents.nextRound'
            )}
          </Button>
          {pending && (
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                stopped.current = true
              }}
            >
              {t('documents.stopDebate')}
            </Button>
          )}
        </div>
      </form>
    ) : null

  if (!controls)
    return (
      <div className='grid gap-3'>
        {messages}
        {composer}
      </div>
    )

  return (
    <DocumentToolDialog
      tool='aiDebate'
      controls={controls}
      followConversation={selection !== null}
      footer={composer}
      toolbar={
        <div className='flex flex-wrap items-center gap-2'>
          <select
            aria-label={t('documents.versions')}
            value={version}
            disabled={pending}
            className='max-w-full rounded-md border bg-background px-2 py-1.5 text-sm'
            onChange={(event) =>
              changeSelection(undefined, Number(event.target.value))
            }
          >
            {versions?.map((item) => (
              <option key={item.number} value={item.number}>
                {t('documents.version', { number: item.number })}
              </option>
            ))}
          </select>
          {!!options.data?.runs.length && (
            <select
              aria-label={t('documents.debateHistory')}
              value={active ?? ''}
              disabled={pending}
              className='min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm'
              onChange={(event) => changeSelection(event.target.value || null)}
            >
              {selection === null && (
                <option value=''>{t('documents.debateDraft')}</option>
              )}
              {options.data.runs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.topic}
                </option>
              ))}
            </select>
          )}
          <Button
            className='ms-auto'
            type='button'
            size='sm'
            variant='outline'
            disabled={pending || !options.data?.enabled}
            onClick={() => changeSelection(null, currentVersion)}
          >
            {t('documents.newDebate')}
          </Button>
        </div>
      }
    >
      {messages}
    </DocumentToolDialog>
  )
}
