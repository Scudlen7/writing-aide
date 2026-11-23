import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  blockText,
  type AiResult,
  type Decision,
  type Work,
} from '@writing/writing'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import { documentPath, documentsKey } from './api'
import { DocumentToolDialog, type ToolDialogControls } from './document-tools'

type PersonalReview = {
  id: string
  version: number
  task: 'outline' | 'revision'
  source: string
  result: AiResult
  decisions: Record<string, Decision>
}

export function WritingAdviceDialog({
  id,
  version,
  work,
  stage,
  canRequest,
  controls,
}: {
  id: string
  version: number
  work: Work
  stage: 'outline' | 'revise'
  canRequest: boolean
  controls: ToolDialogControls
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [paragraph, setParagraph] = useState('')
  const [draftDecisions, setDraftDecisions] = useState<
    Record<string, Decision>
  >({})
  const path = `${documentPath(id)}/ai-reviews`
  const key = [...documentsKey, path]
  const task = stage === 'outline' ? 'outline' : 'revision'
  const section = paragraph
    ? work.revision.content[Number(paragraph)]
    : undefined
  const source = (
    task === 'outline' ? work.outline : section ? blockText(section) : ''
  ).slice(0, 4000)
  const history = useQuery({
    queryKey: key,
    enabled: controls.open,
    queryFn: () => request<PersonalReview[]>(path),
  })
  const invalidate = () => client.invalidateQueries({ queryKey: key })
  const ai = useMutation({
    mutationFn: (data: {
      version: number
      task: PersonalReview['task']
      text: string
    }) => request(`${path}`, 'POST', data),
    onSuccess: invalidate,
  })
  const decision = useMutation({
    mutationFn: (data: {
      reviewId: string
      index: number
      decision: Decision
    }) => request(`${path}/${data.reviewId}`, 'PUT', data),
    onSuccess: invalidate,
  })
  const reviews = history.data
    ?.filter((review) => review.task === task)
    .reverse()

  return (
    <DocumentToolDialog
      tool='aiWriting'
      controls={controls}
      toolbar={
        <span className='text-sm text-muted-foreground'>
          {t(`stage.${stage}`)}
        </span>
      }
      footer={
        <form
          className='grid gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            if (canRequest && source.trim())
              ai.mutate({ version, task, text: source })
          }}
        >
          {task === 'revision' && (
            <Label className='grid gap-2'>
              {t('documents.selectQuote')}
              <select
                className='min-w-0 rounded-md border bg-background p-2'
                value={paragraph}
                onChange={(event) => setParagraph(event.target.value)}
              >
                <option value=''>{t('documents.paragraph')}</option>
                {work.revision.content.map((block, index) =>
                  blockText(block).trim() ? (
                    <option key={index} value={index}>
                      {index + 1} · {blockText(block).slice(0, 80)}
                    </option>
                  ) : null
                )}
              </select>
            </Label>
          )}
          {source && (
            <blockquote className='max-h-24 overflow-auto rounded-md bg-muted px-3 py-2 text-sm wrap-anywhere whitespace-pre-wrap'>
              {source}
            </blockquote>
          )}
          <Button
            className='justify-self-end'
            disabled={!canRequest || !source.trim() || ai.isPending}
          >
            {t('documents.sendToAi')}
          </Button>
        </form>
      }
    >
      <Problem error={history.error ?? ai.error ?? decision.error} />
      {history.isPending && <p role='status'>{t('loading')}</p>}
      {reviews?.length === 0 && !ai.isPending && (
        <p className='text-sm text-muted-foreground'>
          {t('documents.noWritingAdvice')}
        </p>
      )}
      <div
        role='log'
        aria-label={t('documents.aiWriting')}
        className='grid min-w-0 gap-5'
      >
        {reviews?.map((review) => (
          <article key={review.id} className='grid min-w-0 gap-3'>
            <div className='ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-4 py-3'>
              <p className='mb-1 text-xs font-medium text-muted-foreground'>
                {t('documents.version', { number: review.version })}
              </p>
              <p className='text-sm wrap-anywhere whitespace-pre-wrap'>
                {review.source}
              </p>
            </div>
            <div className='grid min-w-0 gap-3 border-s-2 ps-3 sm:ps-4'>
              <p className='text-xs font-medium text-muted-foreground'>
                {t('documents.aiWriting')}
              </p>
              <p className='wrap-anywhere whitespace-pre-wrap'>
                {review.result.summary}
              </p>
              {review.result.suggestions.map((suggestion, index) => {
                const key = `${review.id}:${index}`
                const draft = draftDecisions[key] ??
                  review.decisions[index] ?? { choice: 'accepted', reason: '' }
                const update = (value: Decision) =>
                  setDraftDecisions((previous) => ({
                    ...previous,
                    [key]: value,
                  }))
                return (
                  <section
                    className='space-y-2 rounded-md border p-3 text-sm wrap-anywhere'
                    key={index}
                  >
                    <p className='font-medium'>{suggestion.focus}</p>
                    <p>{suggestion.reason}</p>
                    <p>{suggestion.advice}</p>
                    <form
                      className='flex flex-wrap gap-2'
                      onSubmit={(event) => {
                        event.preventDefault()
                        decision.mutate({
                          reviewId: review.id,
                          index,
                          decision: draft,
                        })
                      }}
                    >
                      <select
                        className='rounded-md border bg-background p-2'
                        value={draft.choice}
                        aria-label={t('documents.recordDecision')}
                        onChange={(event) =>
                          update({
                            ...draft,
                            choice:
                              event.target.value === 'accepted'
                                ? 'accepted'
                                : 'declined',
                          })
                        }
                      >
                        <option value='accepted'>
                          {t('documents.decision.accepted')}
                        </option>
                        <option value='declined'>
                          {t('documents.decision.declined')}
                        </option>
                      </select>
                      <Input
                        required
                        maxLength={1000}
                        value={draft.reason}
                        onChange={(event) =>
                          update({ ...draft, reason: event.target.value })
                        }
                        placeholder={t('documents.reason')}
                        aria-label={t('documents.reason')}
                        className='w-auto min-w-28 flex-1'
                      />
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={decision.isPending}
                      >
                        {t('documents.recordDecision')}
                      </Button>
                    </form>
                  </section>
                )
              })}
            </div>
          </article>
        ))}
        {ai.isPending && ai.variables?.task === task && (
          <div className='grid gap-3'>
            <p className='ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-4 py-3 text-sm wrap-anywhere whitespace-pre-wrap'>
              {ai.variables.text}
            </p>
            <p role='status' className='text-sm text-muted-foreground'>
              {t('documents.aiResponding')}
            </p>
          </div>
        )}
      </div>
    </DocumentToolDialog>
  )
}
