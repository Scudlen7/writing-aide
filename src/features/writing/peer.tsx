import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { PeerReviewDirectory, PeerReviewItem } from '@writing/peer'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  ReviewerPicker,
  type ReviewerSelection,
} from '@/features/documents/reviewer-picker'
import { ReviewList } from '@/features/documents/reviews'
import { request } from './api'
import { PaperText } from './editor'
import { selectField } from './management-ui'
import { Field, Problem } from './ui'

export function PeerPanel({
  assignmentId,
  personId,
}: {
  assignmentId: string
  personId: string
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [submissionId, setSubmissionId] = useState('')
  const [reviewers, setReviewers] = useState<ReviewerSelection>({
    query: '',
    selected: [],
  })
  const [confirm, setConfirm] = useState<{
    action: 'decline' | 'revoke'
    reviewId: string
  } | null>(null)
  const path = `/api/assignments/${assignmentId}/peers`
  const key = ['peer-feedback', personId, path]
  const data = useQuery({
    enabled: open,
    queryKey: key,
    queryFn: () => request<PeerReviewDirectory>(path),
  })
  const target = data.data?.submissions?.find(
    (item) => item.id === submissionId
  )
  const change = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      request(path, 'POST', payload),
    onSuccess: async (_result, action) => {
      setConfirm(null)
      if (action.action === 'assign') setReviewers({ query: '', selected: [] })
      await client.invalidateQueries({ queryKey: key })
    },
  })
  const discussion = useMutation({
    mutationFn: (peerId: string) =>
      request<{ id: string }>(
        `/api/assignments/${assignmentId}/review-discussions`,
        'POST',
        { peerId }
      ),
    onSuccess: ({ id }) => {
      void navigate({
        to: '/review-discussions/$threadId',
        params: { threadId: id },
      })
    },
  })
  return (
    <details
      className='rounded-xl border bg-card'
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className='cursor-pointer px-4 py-3 text-sm font-semibold'>
        {t('peerFeedback')}
      </summary>
      {open && (
        <div className='space-y-4 border-t p-4 text-sm'>
          {data.isPending && <p role='status'>{t('loading')}</p>}
          <Problem error={data.error} />
          {!confirm && <Problem error={change.error ?? discussion.error} />}
          {data.data?.students && !data.data.readOnly && (
            <form
              className='grid gap-3'
              onSubmit={(event) => {
                event.preventDefault()
                const reviewer = reviewers.selected[0]
                if (target && reviewer && !change.isPending)
                  change.mutate({
                    action: 'assign',
                    submissionId: target.id,
                    version: target.version,
                    reviewerId: reviewer.id,
                  })
              }}
            >
              <Field label={t('peerAuthor')}>
                <select
                  className={selectField}
                  value={submissionId}
                  onChange={(event) => {
                    setSubmissionId(event.target.value)
                    setReviewers({ query: '', selected: [] })
                  }}
                  required
                >
                  <option value='' disabled>
                    {t('selectDecision')}
                  </option>
                  {data.data.submissions?.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <ReviewerPicker
                scope={
                  target
                    ? {
                        assignmentId,
                        submissionId: target.id,
                        version: target.version,
                      }
                    : undefined
                }
                value={reviewers}
                onChange={setReviewers}
                limit={1}
                disabled={change.isPending}
              />
              <Button
                type='submit'
                disabled={
                  change.isPending || !target || !reviewers.selected.length
                }
              >
                {t('assignPeer')}
              </Button>
            </form>
          )}
          {data.data?.reviews.length === 0 && (
            <p className='text-muted-foreground'>{t('noPeerReviews')}</p>
          )}
          {data.data?.reviews.map((review) => (
            <div key={review.id} className='grid gap-2'>
              <PeerReview
                review={review}
                busy={change.isPending || data.data!.readOnly}
                onAction={(action, fields = {}) =>
                  change.mutate({ reviewId: review.id, action, ...fields })
                }
                onConfirm={(action) => {
                  change.reset()
                  setConfirm({ action, reviewId: review.id })
                }}
              />
              {!data.data!.readOnly &&
                ['assigned', 'submitted'].includes(review.status) && (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => discussion.mutate(review.id)}
                    disabled={discussion.isPending}
                  >
                    {t('documents.openDiscussion')}
                  </Button>
                )}
            </div>
          ))}
          <ReviewList
            assignment={assignmentId}
            courseOptions={
              !data.data?.readOnly &&
              data.data?.students &&
              data.data?.submissions
                ? {
                    students: data.data.students,
                    submissions: data.data.submissions,
                  }
                : data.data?.authorDebate
            }
          />
          <ConfirmDialog
            open={Boolean(confirm)}
            onOpenChange={(value) => {
              if (!value && !change.isPending) setConfirm(null)
            }}
            title={t(
              confirm?.action === 'revoke' ? 'revokePeer' : 'declinePeer'
            )}
            desc={t('peerDecisionHint')}
            confirmText={t('confirm')}
            cancelBtnText={t('cancel')}
            isLoading={change.isPending}
            handleConfirm={() => {
              if (confirm) change.mutate(confirm)
            }}
          >
            <Problem error={change.error} />
          </ConfirmDialog>
        </div>
      )}
    </details>
  )
}

function PeerReview({
  review,
  busy,
  onAction,
  onConfirm,
}: {
  review: PeerReviewItem
  busy: boolean
  onAction: (action: string, fields?: Record<string, unknown>) => void
  onConfirm: (action: 'decline' | 'revoke') => void
}) {
  const { t } = useTranslation()
  return (
    <section className='space-y-2 rounded-md border p-3'>
      <p className='font-medium break-words'>
        {t('peerAuthor')} {review.author} · {t('peerReviewer')}{' '}
        {review.reviewer}
      </p>
      <p className='text-xs text-muted-foreground'>
        {t(`peerState.${review.status}`)}
      </p>
      {review.paper && (
        <details className='space-y-2'>
          <summary className='cursor-pointer font-medium'>
            {review.paper.title || t('finalDraft')}
          </summary>
          <PaperText doc={review.paper.doc} sources={review.paper.references} />
        </details>
      )}
      {review.paper && review.status === 'assigned' && (
        <form
          className='grid gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            const fields = new FormData(event.currentTarget)
            onAction('feedback', {
              feedback: {
                criterion: Number(fields.get('criterion')),
                comment: fields.get('comment'),
                improvement: fields.get('improvement'),
              },
            })
          }}
        >
          <Field label={t('criterion')}>
            <select className={selectField} name='criterion' required>
              {review.paper.rubric.map((criterion, index) => (
                <option value={index} key={index}>
                  {criterion.label}
                  {criterion.description ? ` · ${criterion.description}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('peerComment')}>
            <Textarea name='comment' rows={2} required maxLength={2000} />
          </Field>
          <Field label={t('peerImprovement')}>
            <Textarea name='improvement' rows={2} required maxLength={2000} />
          </Field>
          <Button type='submit' size='sm' disabled={busy}>
            {t('submitPeer')}
          </Button>
        </form>
      )}
      {review.feedback && (
        <div className='space-y-1 wrap-break-word whitespace-pre-wrap'>
          <p className='font-medium'>
            {review.rubric?.[review.feedback.criterion]?.label}
          </p>
          <p>{review.feedback.comment}</p>
          <p>
            {t('peerImprovement')} · {review.feedback.improvement}
          </p>
        </div>
      )}
      {review.reported && (
        <p className='whitespace-pre-wrap text-destructive'>
          {t('peerReported')}
          {review.reportReason && ` · ${review.reportReason}`}
        </p>
      )}
      {review.canReport && (
        <details className='space-y-2'>
          <summary className='cursor-pointer'>{t('reportPeer')}</summary>
          <form
            className='grid gap-2'
            onSubmit={(event) => {
              event.preventDefault()
              onAction('report', {
                reason: new FormData(event.currentTarget).get('reason'),
              })
            }}
          >
            <Field label={t('reason')}>
              <Textarea name='reason' required rows={2} maxLength={1000} />
            </Field>
            <Button size='sm' type='submit' disabled={busy}>
              {t('reportPeer')}
            </Button>
          </form>
        </details>
      )}
      {review.role !== 'teacher' && review.status === 'assigned' && (
        <Button
          type='button'
          size='sm'
          variant='ghost'
          disabled={busy}
          onClick={() => onConfirm('decline')}
        >
          {t('declinePeer')}
        </Button>
      )}
      {review.role === 'teacher' && review.status !== 'revoked' && (
        <div className='flex flex-wrap gap-1.5'>
          {review.reported && (
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={busy}
              onClick={() => onAction('resolve')}
            >
              {t('resolvePeer')}
            </Button>
          )}
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={busy}
            onClick={() => onConfirm('revoke')}
          >
            {t('revokePeer')}
          </Button>
        </div>
      )}
    </section>
  )
}
