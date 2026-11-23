import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  discussionDecisions,
  discussionRoles,
  type DiscussionAnchor,
  type ReviewDiscussion,
  type ReviewMessage,
  type ReviewSummary,
} from '@writing/discussions'
import type { DocumentVersion } from '@writing/documents'
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Main } from '@/components/layout/main'
import { request, RequestError } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import { discussionsKey, discussionsPath, documentPath } from './api'
import {
  DocumentToolDialog,
  DocumentToolSummary,
  type ToolDialogControls,
} from './document-tools'
import { ReviewerPicker, type ReviewerSelection } from './reviewer-picker'

export function ReviewList({
  document,
  assignment,
  versions,
  selectedVersion,
  courseOptions,
  dialog,
  showInvite = false,
}: {
  document?: string
  assignment?: string
  versions?: DocumentVersion[]
  selectedVersion?: number
  dialog?: ToolDialogControls
  showInvite?: boolean
  courseOptions?: {
    students: { id: string; name: string }[]
    submissions: { id: string; version: number; name: string }[]
  }
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(showInvite)
  const [draft, setDraft] = useState({
    mode: 'review',
    version: '',
    topic: '',
  })
  const [reviewers, setReviewers] = useState<ReviewerSelection>({
    query: '',
    selected: [],
  })
  const [submissionId, setSubmissionId] = useState('')
  const submission =
    courseOptions?.submissions.find((item) => item.id === submissionId) ??
    courseOptions?.submissions[0]
  const minimum = document && draft.mode === 'review' ? 1 : 2
  const client = useQueryClient()
  const navigate = useNavigate()
  const query = new URLSearchParams(
    document ? { document } : assignment ? { assignment } : {}
  )
  const list = useQuery({
    queryKey: [...discussionsKey, query.toString()],
    enabled: !dialog || dialog.open,
    queryFn: () => request<ReviewSummary[]>(`${discussionsPath}?${query}`),
  })
  const create = useMutation({
    mutationFn: (form: FormData) => {
      const topic = String(form.get('topic'))
      const reviewerIds = reviewers.selected.map((person) => person.id)
      if (document)
        return request<{ id: string }>(
          `${documentPath(document)}/review-discussions`,
          'POST',
          {
            mode: form.get('mode'),
            topic,
            version: Number(form.get('version')),
            reviewerIds,
          }
        )
      return request<{ id: string }>(
        `/api/assignments/${assignment}/review-discussions`,
        'POST',
        {
          mode: 'debate',
          topic,
          submissionId: submission?.id,
          version: submission?.version,
          students: reviewerIds,
        }
      )
    },
    onSuccess: ({ id }) => {
      setOpen(false)
      setDraft({ mode: 'review', version: '', topic: '' })
      setReviewers({ query: '', selected: [] })
      void client.invalidateQueries({ queryKey: discussionsKey })
      if (dialog && !dialog.open) return
      void navigate({
        to: '/review-discussions/$threadId',
        params: { threadId: id },
      })
    },
  })
  const canCreate = Boolean(
    document ||
    (courseOptions &&
      courseOptions.students.length >= 2 &&
      courseOptions.submissions.length)
  )
  const inviteButton = canCreate && (
    <Button
      variant='outline'
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {t(document ? 'documents.invite' : 'documents.humanDebate')}
    </Button>
  )
  const content = (
    <>
      {open && (
        <form
          className='grid gap-3 rounded-md border p-4'
          onSubmit={(event) => {
            event.preventDefault()
            if (reviewers.selected.length >= minimum && !create.isPending)
              create.mutate(new FormData(event.currentTarget))
          }}
        >
          {document ? (
            <>
              <Label className='grid gap-2'>
                {t('documents.mode')}
                <select
                  className='rounded-md border bg-background p-2'
                  name='mode'
                  value={draft.mode}
                  onChange={(event) =>
                    setDraft({ ...draft, mode: event.target.value })
                  }
                >
                  <option value='review'>{t('documents.discussions')}</option>
                  <option value='debate'>{t('documents.humanDebate')}</option>
                </select>
              </Label>
              <Label className='grid gap-2'>
                {t('documents.versions')}
                <select
                  className='rounded-md border bg-background p-2'
                  name='version'
                  value={draft.version || selectedVersion}
                  onChange={(event) =>
                    setDraft({ ...draft, version: event.target.value })
                  }
                >
                  {versions?.map(({ number, filename }) => (
                    <option key={number} value={number}>
                      {t('documents.version', { number })} · {filename}
                    </option>
                  ))}
                </select>
              </Label>
            </>
          ) : (
            <>
              <Label className='grid gap-2'>
                {t('manuscript')}
                <select
                  className='rounded-md border bg-background p-2'
                  required
                  value={submission?.id ?? ''}
                  onChange={(event) => {
                    setSubmissionId(event.target.value)
                    setReviewers({ query: '', selected: [] })
                  }}
                >
                  {courseOptions?.submissions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ·{' '}
                      {t('documents.version', { number: item.version })}
                    </option>
                  ))}
                </select>
              </Label>
            </>
          )}
          <ReviewerPicker
            scope={
              document
                ? { documentId: document }
                : assignment && submission
                  ? {
                      assignmentId: assignment,
                      submissionId: submission.id,
                      version: submission.version,
                    }
                  : undefined
            }
            value={reviewers}
            onChange={setReviewers}
            disabled={create.isPending}
          />
          {minimum === 2 && reviewers.selected.length < 2 && (
            <p className='text-sm text-muted-foreground'>
              {t('documents.debateReviewersRequired')}
            </p>
          )}
          <Label className='grid gap-2'>
            {t('documents.topic')}
            <Textarea
              name='topic'
              required
              maxLength={2000}
              value={document ? draft.topic : undefined}
              onChange={
                document
                  ? (event) => setDraft({ ...draft, topic: event.target.value })
                  : undefined
              }
            />
          </Label>
          <Button
            className='justify-self-start'
            disabled={create.isPending || reviewers.selected.length < minimum}
          >
            {t('documents.sendInvite')}
          </Button>
        </form>
      )}
      <Problem error={list.error ?? create.error} />
      {list.isPending && <p role='status'>{t('loading')}</p>}
      {list.data?.length === 0 && (
        <p className='text-sm text-muted-foreground'>
          {t('documents.noReviews')}
        </p>
      )}
      {list.data?.map((thread) => (
        <div
          className='flex flex-wrap items-center gap-2 rounded-md border p-3'
          key={thread.id}
        >
          <Link
            className='font-medium hover:underline'
            to='/review-discussions/$threadId'
            params={{ threadId: thread.id }}
          >
            {thread.topic || thread.title}
          </Link>
          <Badge variant='outline'>
            {t('documents.version', { number: thread.version })}
          </Badge>
          <Badge variant='secondary'>
            {t(
              thread.mode === 'debate'
                ? 'documents.humanDebate'
                : 'documents.discussions'
            )}
          </Badge>
          {thread.status === 'pending' && (
            <Badge>{t('documents.invitationPending')}</Badge>
          )}
        </div>
      ))}
    </>
  )
  return dialog ? (
    <DocumentToolDialog
      tool='discussions'
      controls={dialog}
      toolbar={<div className='flex justify-end'>{inviteButton}</div>}
    >
      {content}
    </DocumentToolDialog>
  ) : (
    <Card>
      <CardHeader className='flex flex-wrap items-center justify-between gap-2'>
        <CardTitle>
          {t(
            document || assignment
              ? 'documents.discussions'
              : 'documents.reviewInbox'
          )}
        </CardTitle>
        {inviteButton}
      </CardHeader>
      <CardContent className='grid gap-3'>{content}</CardContent>
    </Card>
  )
}

function ReviewSource({
  data,
  anchor,
  onQuote,
}: {
  data: ReviewDiscussion
  anchor: DiscussionAnchor | null
  onQuote: (anchor: DiscussionAnchor) => void
}) {
  const { t } = useTranslation()
  const source = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!data.canWrite) return
    function selectQuote() {
      const selection = window.getSelection()
      if (!selection?.rangeCount || selection.isCollapsed) return
      const range = selection.getRangeAt(0)
      const { startContainer, endContainer, startOffset } = range
      const paragraph = startContainer.parentElement
      if (
        startContainer !== endContainer ||
        !paragraph?.hasAttribute('data-review-paragraph') ||
        !source.current?.contains(paragraph)
      )
        return
      const quote = range.toString().slice(0, 2000)
      if (quote.trim())
        onQuote({
          paragraph: Number(paragraph.dataset.reviewParagraph),
          offset: startOffset,
          quote,
        })
    }
    document.addEventListener('selectionchange', selectQuote)
    return () => document.removeEventListener('selectionchange', selectQuote)
  }, [data.canWrite, onQuote])

  return (
    <section
      aria-labelledby='review-source-heading'
      className='min-w-0 lg:sticky lg:top-20'
    >
      <Card className='max-h-[65dvh] gap-0 overflow-hidden py-0 lg:max-h-[calc(100dvh-6rem)]'>
        <CardHeader className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b p-4'>
          <h2 id='review-source-heading' className='font-semibold'>
            {t('documents.reviewText')}
          </h2>
          {data.file && (
            <Button asChild variant='outline' size='sm'>
              <a href={data.file.url} download>
                {t('documents.downloadOriginal')}
              </a>
            </Button>
          )}
        </CardHeader>
        <CardContent
          className='min-h-0 overflow-y-auto p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:p-6'
          tabIndex={0}
          ref={source}
        >
          {data.paragraphs?.some((text) => text.trim()) ? (
            <ol className='grid gap-4'>
              {data.paragraphs.map(
                (text, index) =>
                  text.trim() && (
                    <li
                      key={index}
                      className='grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 sm:gap-3'
                    >
                      {data.canWrite ? (
                        <Button
                          variant={
                            anchor?.paragraph === index ? 'secondary' : 'ghost'
                          }
                          size='sm'
                          className='h-7 min-w-8 px-1.5 text-xs tabular-nums'
                          aria-label={t('documents.quoteParagraph', {
                            number: index + 1,
                          })}
                          title={t('documents.quoteParagraph', {
                            number: index + 1,
                          })}
                          onClick={() =>
                            onQuote({
                              paragraph: index,
                              offset: 0,
                              quote: text.slice(0, 2000),
                            })
                          }
                        >
                          {index + 1}
                        </Button>
                      ) : (
                        <span className='min-w-8 py-1.5 text-center text-xs text-muted-foreground tabular-nums'>
                          {index + 1}
                        </span>
                      )}
                      <p
                        className='leading-7 wrap-anywhere whitespace-pre-wrap'
                        data-review-paragraph={index}
                      >
                        {text}
                      </p>
                    </li>
                  )
              )}
            </ol>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('documents.noText')}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

export function ReviewDiscussionPage({ id }: { id: string }) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<DiscussionAnchor | null>(null)
  const [reply, setReply] = useState<ReviewMessage | null>(null)
  const [comment, setComment] = useState('')
  const [resolution, setResolution] = useState(false)
  const [participantsPanel, setParticipantsPanel] = useState<
    'open' | 'minimized' | 'closed'
  >('closed')
  const [selectedPeople, setSelectedPeople] = useState<string[]>([])
  const participantsButton = useRef<HTMLButtonElement>(null)
  const restoreToSummary = useRef(false)
  const path = `${discussionsPath}/${id}`
  const thread = useQuery({
    queryKey: [...discussionsKey, path],
    queryFn: () => request<ReviewDiscussion>(path),
    refetchInterval: 15000,
  })
  const change = useMutation({
    mutationFn: (data: Record<string, unknown>) => request(path, 'POST', data),
    onSuccess: async (_result, data) => {
      if (data.action === 'post') {
        setComment('')
        setAnchor(null)
        setReply(null)
      }
      if (data.action === 'revoke') setSelectedPeople([])
      if (data.action === 'reject')
        await navigate({ to: '/review-discussions' })
      await client.invalidateQueries({ queryKey: discussionsKey })
    },
  })
  const accessLost =
    thread.error instanceof RequestError &&
    [401, 403, 404].includes(thread.error.status)
  const data = accessLost ? undefined : thread.data
  const revocable =
    data?.participants.filter(
      ({ state }) => state === 'accepted' || state === 'pending'
    ) ?? []
  const checkedPeople = selectedPeople.filter((person) =>
    revocable.some(({ id }) => id === person)
  )

  function openParticipants(fromSummary: boolean) {
    restoreToSummary.current = fromSummary
    setParticipantsPanel('open')
  }

  return (
    <Main id='writing-main' className='grid gap-4'>
      <div>
        <Button asChild variant='ghost'>
          <Link to='/review-discussions'>{t('documents.reviewInbox')}</Link>
        </Button>
      </div>
      <Problem
        error={thread.error ?? (participantsPanel !== 'open' && change.error)}
      />
      {thread.isPending && <p role='status'>{t('loading')}</p>}
      {data && (
        <>
          <header className='flex flex-wrap items-start justify-between gap-4'>
            <div className='grid min-w-0 gap-2'>
              <h1 className='text-2xl font-semibold wrap-break-word'>
                {data.title}
              </h1>
              {data.topic && (
                <p className='wrap-break-word whitespace-pre-wrap'>
                  {data.topic}
                </p>
              )}
              <div className='flex gap-2'>
                <Badge>
                  {t('documents.version', { number: data.version })}
                </Badge>
                {data.endedAt && (
                  <Badge variant='outline'>{t('documents.ended')}</Badge>
                )}
              </div>
            </div>
            {data.status !== 'pending' && (
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  variant='outline'
                  ref={participantsButton}
                  onClick={() => openParticipants(false)}
                >
                  <Users />
                  {t('documents.discussionParticipants')}
                </Button>
                {data.canManage && !data.endedAt && (
                  <Button
                    variant='outline'
                    aria-expanded={resolution}
                    onClick={() => setResolution(!resolution)}
                  >
                    {t('documents.end')}
                  </Button>
                )}
              </div>
            )}
          </header>
          {data.status === 'pending' ? (
            <div className='flex gap-2'>
              <Button
                onClick={() => change.mutate({ action: 'accept' })}
                disabled={change.isPending || Boolean(data.endedAt)}
              >
                {t('documents.accept')}
              </Button>
              <Button
                variant='outline'
                onClick={() => change.mutate({ action: 'reject' })}
                disabled={change.isPending}
              >
                {t('documents.reject')}
              </Button>
            </div>
          ) : (
            <>
              {data.canManage && resolution && !data.endedAt && (
                <form
                  className='grid gap-2 rounded-md border bg-card p-4'
                  onSubmit={(event) => {
                    event.preventDefault()
                    change.mutate({
                      action: 'end',
                      resolution: new FormData(event.currentTarget).get(
                        'resolution'
                      ),
                    })
                  }}
                >
                  <Label className='grid gap-2'>
                    {t('documents.resolution')}
                    <Textarea name='resolution' maxLength={2000} required />
                  </Label>
                  <Button
                    className='justify-self-start'
                    disabled={change.isPending}
                  >
                    {t('documents.end')}
                  </Button>
                </form>
              )}
              <DocumentToolSummary
                items={
                  participantsPanel === 'minimized'
                    ? ['discussionParticipants']
                    : []
                }
                onRestore={() => openParticipants(true)}
              />
              <DocumentToolDialog
                tool='discussionParticipants'
                controls={{
                  open: participantsPanel === 'open',
                  close: () => setParticipantsPanel('closed'),
                  minimize: () => {
                    restoreToSummary.current = true
                    setParticipantsPanel('minimized')
                  },
                  restoreFocus: () =>
                    (restoreToSummary.current
                      ? document.getElementById('document-tool-summary')
                      : participantsButton.current
                    )?.focus({ preventScroll: true }),
                }}
                footer={
                  data.canManage &&
                  revocable.length > 0 && (
                    <Button
                      variant='destructive'
                      disabled={!checkedPeople.length || change.isPending}
                      onClick={() =>
                        change.mutate({
                          action: 'revoke',
                          people: checkedPeople,
                        })
                      }
                    >
                      {t('documents.revokeSelected')}
                    </Button>
                  )
                }
              >
                <Problem error={change.error} />
                <ul className='divide-y rounded-md border'>
                  {data.participants.map(({ id, name, state }) => (
                    <li
                      className='flex items-center justify-between gap-3 px-3 py-2.5'
                      key={id}
                    >
                      {data.canManage &&
                      (state === 'pending' || state === 'accepted') ? (
                        <Label className='min-w-0 cursor-pointer gap-3'>
                          <Checkbox
                            checked={selectedPeople.includes(id)}
                            disabled={change.isPending}
                            onCheckedChange={(checked) =>
                              setSelectedPeople((people) =>
                                checked === true
                                  ? [...people, id]
                                  : people.filter((person) => person !== id)
                              )
                            }
                          />
                          <span className='wrap-anywhere'>{name}</span>
                        </Label>
                      ) : (
                        <span className='min-w-0 text-sm wrap-anywhere'>
                          {name}
                        </span>
                      )}
                      <Badge variant='outline' className='shrink-0'>
                        {t(`documents.member.${state}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </DocumentToolDialog>
              {data.resolution && (
                <p className='rounded-md border p-3 whitespace-pre-wrap'>
                  {data.resolution}
                </p>
              )}
              <div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start'>
                <ReviewSource data={data} anchor={anchor} onQuote={setAnchor} />
                <section
                  aria-labelledby='review-discussion-heading'
                  className='grid min-w-0 gap-3'
                >
                  <h2 id='review-discussion-heading' className='font-semibold'>
                    {t('documents.discussionArea')}
                  </h2>
                  {data.messages.length === 0 && (
                    <p className='text-sm text-muted-foreground'>
                      {t('documents.noDiscussionMessages')}
                    </p>
                  )}
                  {data.messages.map((message) => (
                    <Card key={message.id} id={`message-${message.id}`}>
                      <CardContent className='space-y-3'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='font-medium'>{message.author}</span>
                          {message.ai && (
                            <Badge>{t('documents.aiDebate')}</Badge>
                          )}
                          {message.role && (
                            <Badge variant='outline'>
                              {t(`documents.role.${message.role}`)}
                            </Badge>
                          )}
                          {message.criterion !== null && (
                            <Badge variant='outline'>
                              {data.criteria[message.criterion]}
                            </Badge>
                          )}
                          <time className='text-xs text-muted-foreground'>
                            {new Date(message.createdAt).toLocaleString(
                              i18n.language
                            )}
                          </time>
                        </div>
                        {message.replyTo && (
                          <a
                            href={`#message-${message.replyTo}`}
                            className='text-sm text-primary underline'
                          >
                            {t('documents.reply')}
                          </a>
                        )}
                        {message.anchor && (
                          <blockquote className='border-s-2 ps-3 wrap-anywhere whitespace-pre-wrap text-muted-foreground'>
                            {message.anchor.quote}
                          </blockquote>
                        )}
                        <p className='wrap-break-word whitespace-pre-wrap'>
                          {message.reported && !message.body
                            ? t('documents.reported')
                            : message.body}
                        </p>
                        {message.decision && (
                          <div>
                            <Badge variant='secondary'>
                              {t(
                                `documents.decision.${message.decision.choice}`
                              )}
                            </Badge>{' '}
                            <span>{message.decision.reason}</span>
                            {message.decision.version && (
                              <span className='ms-2 text-muted-foreground'>
                                {t('documents.version', {
                                  number: message.decision.version,
                                })}
                              </span>
                            )}
                          </div>
                        )}
                        <div className='flex flex-wrap gap-2'>
                          {data.canWrite &&
                            !(message.reported && !message.body) && (
                              <Button
                                size='sm'
                                variant='outline'
                                onClick={() => setReply(message)}
                              >
                                {t('documents.reply')}
                              </Button>
                            )}
                          {message.reported && message.reportReason && (
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={() =>
                                change.mutate({
                                  action: 'resolve',
                                  message: message.id,
                                })
                              }
                            >
                              {t('documents.resolveReport')}
                            </Button>
                          )}
                        </div>
                        {data.canDecide && !message.reported && (
                          <details>
                            <summary className='cursor-pointer text-sm'>
                              {t('documents.recordDecision')}
                            </summary>
                            <form
                              className='mt-2 grid gap-2'
                              onSubmit={(event) => {
                                event.preventDefault()
                                const form = new FormData(event.currentTarget)
                                change.mutate({
                                  action: 'decision',
                                  message: message.id,
                                  choice: form.get('choice'),
                                  reason: form.get('reason'),
                                  version:
                                    Number(form.get('version')) || undefined,
                                })
                              }}
                            >
                              <select
                                name='choice'
                                aria-label={t('documents.recordDecision')}
                                className='rounded-md border bg-background p-2'
                                defaultValue={message.decision?.choice}
                              >
                                {discussionDecisions.map((choice) => (
                                  <option key={choice} value={choice}>
                                    {t(`documents.decision.${choice}`)}
                                  </option>
                                ))}
                              </select>
                              <Input
                                name='reason'
                                aria-label={t('documents.reason')}
                                placeholder={t('documents.reason')}
                                required
                                maxLength={1000}
                                defaultValue={message.decision?.reason}
                              />
                              <Input
                                name='version'
                                type='number'
                                min={data.version + 1}
                                aria-label={t('documents.followUpVersion')}
                                placeholder={t('documents.followUpVersion')}
                                defaultValue={message.decision?.version}
                              />
                              <Button
                                size='sm'
                                variant='outline'
                                disabled={change.isPending}
                              >
                                {t('documents.saveDetails')}
                              </Button>
                            </form>
                          </details>
                        )}
                        {data.criteria.length > 0 &&
                          !message.reported &&
                          data.status !== 'teacher' && (
                            <details>
                              <summary className='cursor-pointer text-sm'>
                                {t('documents.report')}
                              </summary>
                              <form
                                className='flex gap-2'
                                onSubmit={(event) => {
                                  event.preventDefault()
                                  change.mutate({
                                    action: 'report',
                                    message: message.id,
                                    reason: new FormData(
                                      event.currentTarget
                                    ).get('reason'),
                                  })
                                }}
                              >
                                <Input
                                  name='reason'
                                  required
                                  maxLength={1000}
                                  aria-label={t('documents.reason')}
                                />
                                <Button variant='outline' size='sm'>
                                  {t('documents.report')}
                                </Button>
                              </form>
                            </details>
                          )}
                      </CardContent>
                    </Card>
                  ))}
                  {data.canWrite && (
                    <form
                      className='grid gap-3 rounded-md border p-4'
                      onSubmit={(event) => {
                        event.preventDefault()
                        const form = new FormData(event.currentTarget)
                        const criterion = form.get('criterion')
                        change.mutate({
                          action: 'post',
                          body: comment,
                          role: form.get('role') || undefined,
                          criterion: criterion ? Number(criterion) : undefined,
                          anchor: anchor ?? undefined,
                          replyTo: reply?.id,
                        })
                      }}
                    >
                      <details>
                        <summary>{t('documents.commentPrompts')}</summary>
                        <p className='text-sm text-muted-foreground'>
                          {t('documents.prompts')}
                        </p>
                      </details>
                      {(anchor || reply) && (
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='min-w-0 text-sm wrap-anywhere'>
                            {anchor?.quote ??
                              `${t('documents.reply')} · ${reply?.author}`}
                          </span>
                          <Button
                            size='sm'
                            variant='ghost'
                            type='button'
                            onClick={() => {
                              setAnchor(null)
                              setReply(null)
                            }}
                          >
                            {t('cancel')}
                          </Button>
                        </div>
                      )}
                      {!anchor && !reply && (
                        <span className='text-sm text-muted-foreground'>
                          {t('documents.wholeDocument')}
                        </span>
                      )}
                      <Label className='grid gap-2'>
                        {t('documents.comment')}
                        <Textarea
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          maxLength={2000}
                          required
                        />
                      </Label>
                      {data.mode === 'debate' && (
                        <Label>
                          {t('documents.roleLabel')}
                          <select
                            name='role'
                            className='rounded-md border bg-background p-2'
                          >
                            <option value=''>{t('documents.freeReply')}</option>
                            {discussionRoles.map((role) => (
                              <option key={role} value={role}>
                                {t(`documents.role.${role}`)}
                              </option>
                            ))}
                          </select>
                        </Label>
                      )}
                      {!!data.criteria.length && (
                        <Label>
                          {t('documents.rubricItem')}
                          <select
                            name='criterion'
                            className='rounded-md border bg-background p-2'
                          >
                            <option value=''>
                              {t('documents.wholeDocument')}
                            </option>
                            {data.criteria.map((label, index) => (
                              <option value={index} key={index}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Label>
                      )}
                      <Button disabled={change.isPending}>
                        {t('documents.comment')}
                      </Button>
                    </form>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}
    </Main>
  )
}
