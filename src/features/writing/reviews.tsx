import { useState } from 'react'
import type { AiReview, Decision } from '@writing/writing'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { request } from './api'
import { Field, Problem } from './ui'

export function ReviewPanel({
  reviews,
  enabled,
  disabled,
  label,
  onReview,
  decisions,
  onUseScores,
}: {
  reviews: AiReview[]
  enabled?: boolean
  disabled?: boolean
  label?: string
  onReview?: () => Promise<unknown>
  decisions?: { assignmentId: string; onSaved: (review: AiReview) => void }
  onUseScores?: (scores: number[]) => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function run() {
    setPending(true)
    setError(null)
    try {
      await onReview?.()
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  if (!onReview && reviews.length === 0) return null
  return (
    <details
      className='rounded-xl border bg-card'
      open={!onReview || undefined}
    >
      <summary className='cursor-pointer px-4 py-3 text-sm font-semibold'>
        {t(onReview ? 'ai' : 'aiHistory')}
      </summary>
      <div className='space-y-3 border-t p-4 text-sm'>
        {onReview && (
          <>
            <p className='text-xs text-muted-foreground'>
              {t(enabled ? 'aiNotice' : 'aiUnavailable')}
            </p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={!enabled || pending || disabled}
              onClick={() => void run()}
            >
              <Sparkles />
              {t(pending ? 'aiWorking' : (label ?? 'ai'))}
            </Button>
          </>
        )}
        <Problem error={error} />
        {reviews.map((review, index) => (
          <details
            key={review.id}
            open={index === 0 || undefined}
            className='rounded-lg border p-3'
          >
            <summary className='cursor-pointer font-medium wrap-break-word'>
              {t(
                review.task === 'outline'
                  ? 'aiOutline'
                  : review.task === 'revision'
                    ? 'aiRevision'
                    : 'aiAssessment'
              )}
            </summary>
            <p className='mt-2 wrap-break-word whitespace-pre-wrap'>
              {review.result.summary}
            </p>
            {review.result.scores && (
              <div className='mt-2 flex flex-wrap items-center gap-2'>
                <span className='text-muted-foreground'>
                  {t('aiScore')} · {review.result.scores.join(' / ')}
                </span>
                {onUseScores && (
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={() => onUseScores(review.result.scores!)}
                  >
                    {t('useSuggested')}
                  </Button>
                )}
              </div>
            )}
            {review.result.suggestions.length > 0 && (
              <ol className='mt-3 space-y-3'>
                {review.result.suggestions.map((suggestion, position) => (
                  <li key={position} className='space-y-1 border-t pt-2'>
                    <p className='font-medium wrap-break-word'>
                      {suggestion.focus}
                    </p>
                    <p className='wrap-break-word whitespace-pre-wrap text-muted-foreground'>
                      {suggestion.advice}
                    </p>
                    {decisions && review.task === 'revision' ? (
                      <DecisionForm
                        review={review}
                        index={position}
                        {...decisions}
                      />
                    ) : (
                      review.decisions[position] && (
                        <p className='mt-2 wrap-break-word'>
                          <span className='font-medium'>
                            {t(review.decisions[position].choice)}
                          </span>{' '}
                          · {review.decisions[position].reason}
                        </p>
                      )
                    )}
                  </li>
                ))}
              </ol>
            )}
          </details>
        ))}
      </div>
    </details>
  )
}

function DecisionForm({
  review,
  index,
  assignmentId,
  onSaved,
}: {
  review: AiReview
  index: number
  assignmentId: string
  onSaved: (review: AiReview) => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const previous = review.decisions[index]
  return (
    <form
      className='mt-3 grid gap-2'
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        setError(null)
        const data = Object.fromEntries(
          new FormData(event.currentTarget)
        ) as unknown as Decision
        try {
          const updated = await request<AiReview>(
            `/api/assignments/${assignmentId}/reviews/${review.id}/decisions/${index}`,
            'PUT',
            data
          )
          onSaved(updated)
        } catch (cause) {
          setError(cause)
        } finally {
          setPending(false)
        }
      }}
    >
      <select
        name='choice'
        aria-label={t('aiDecisions')}
        defaultValue={previous?.choice ?? 'accepted'}
        className='h-8 rounded-md border border-input bg-background px-2'
      >
        <option value='accepted'>{t('accepted')}</option>
        <option value='declined'>{t('declined')}</option>
      </select>
      <Field label={t('reason')}>
        <Textarea
          name='reason'
          rows={2}
          maxLength={1000}
          defaultValue={previous?.reason ?? ''}
          required
        />
      </Field>
      <Problem error={error} />
      <Button
        variant='outline'
        size='sm'
        className='justify-self-start'
        disabled={pending}
        type='submit'
      >
        {t(pending ? 'saving' : previous ? 'saved' : 'saveDecision')}
      </Button>
    </form>
  )
}
