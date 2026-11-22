import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useBlocker, useRouter } from '@tanstack/react-router'
import {
  blockText,
  aiAllowed,
  type AiReview,
  type Annotation,
  type GradeDraft,
  type GradeDraftInput,
  type Submission,
} from '@writing/writing'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Main } from '@/components/layout/main'
import { dashboardKey, request, RequestError, type GradingDetail } from './api'
import { AssignmentHeading } from './assignment'
import { ReviewPanel } from './reviews'
import { Field, Problem, Requirements, StatusBadge } from './ui'
import { GradeResult, PriorSubmission, WrittenWork } from './workspace'

export function GradingPage({ detail }: { detail: GradingDetail }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const router = useRouter()
  const { assignment } = detail
  const [submission, setSubmission] = useState(detail.submission)
  const [reviews, setReviews] = useState(detail.reviews)
  const [previousReviews, setPreviousReviews] = useState(
    detail.previousReviews ?? []
  )
  const [draft, setDraft] = useState<GradeDraftInput>(
    () =>
      detail.gradeDraft?.input ?? {
        scores: assignment.rubric.map(() => null),
        criteriaFeedback: assignment.rubric.map(() => ''),
        feedback: '',
        annotations: [],
      }
  )
  const [saved, setSaved] = useState(() => JSON.stringify(draft))
  const [draftVersion, setDraftVersion] = useState(
    detail.gradeDraft?.version ?? 0
  )
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const busy = useRef(false)
  const grading = submission.status === 'submitted'
  const dirty = grading && JSON.stringify(draft) !== saved
  const path = `/api/assignments/${assignment.id}/submissions/${submission.id}`
  const completeScores = draft.scores.filter((score) => score !== null).length
  const totalScore = draft.scores.reduce<number>(
    (sum, score) => sum + (score ?? 0),
    0
  )

  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      dirty &&
      !window.confirm(t('leaveGradeDraft')),
    enableBeforeUnload: dirty,
    disabled: !dirty,
  })

  async function save(publish: boolean) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      if (publish) {
        const result = await request<Submission>(`${path}/grade`, 'PUT', {
          ...draft,
          submissionVersion: submission.version,
          draftVersion,
        })
        setSubmission({ ...result, studentName: submission.studentName })
        setConfirm(false)
        void client.invalidateQueries({ queryKey: dashboardKey })
      } else {
        const result = await request<GradeDraft>(`${path}/grade-draft`, 'PUT', {
          version: draftVersion,
          submissionVersion: submission.version,
          input: draft,
        })
        setDraftVersion(result.version)
        setSaved(JSON.stringify(draft))
      }
    } catch (cause) {
      setError(cause)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function assess(calibrate = false) {
    const result = await request<AiReview>(
      `/api/assignments/${assignment.id}/reviews`,
      'POST',
      {
        task: 'assessment',
        submissionId: submission.id,
        calibrate,
      }
    )
    setReviews((previous) => [result, ...previous])
  }
  const assessments = reviews.filter((item) => item.task === 'assessment')
  const pastAssessments = previousReviews.filter(
    (item) =>
      item.task === 'assessment' &&
      !assessments.some((review) => review.id === item.id)
  )
  const canCalibrate =
    !dirty &&
    draftVersion > 0 &&
    completeScores === assignment.rubric.length &&
    !assessments.length

  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl space-y-6 px-4 py-7 sm:px-8'
    >
      <AssignmentHeading assignment={assignment} backToAssignment />
      <div className='flex flex-wrap items-center gap-3'>
        <p className='font-medium wrap-break-word'>{submission.studentName}</p>
        <StatusBadge status={submission.status} dueAt={assignment.dueAt} />
      </div>
      <div className='grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)]'>
        <div className='space-y-3'>
          {grading && !submission.returned && !assignment.archived && (
            <ReturnPaper
              path={path}
              version={submission.version}
              draftVersion={draftVersion}
              disabled={dirty || pending}
              onReturned={async () => {
                await client.invalidateQueries({ queryKey: dashboardKey })
                await router.invalidate()
              }}
            />
          )}
          <Button asChild variant='outline' size='sm'>
            <a href={`${path}/export`}>{t('exportSubmitted')}</a>
          </Button>
          <WrittenWork work={submission.work} reviews={reviews} anchors />
          {submission.returned && (
            <PriorSubmission
              assignment={assignment}
              returned={submission.returned}
              reviews={previousReviews}
              exportHref={`${path}/export?previous=1`}
            />
          )}
          <Requirements assignment={assignment} />
          <ReviewPanel
            reviews={reviews.filter((item) => item.task !== 'assessment')}
            work={submission.work}
          />
        </div>
        <div className='min-w-0 space-y-3'>
          <section className='rounded-xl border bg-card p-4 sm:p-5'>
            <h2 className='mb-4 text-lg font-semibold'>{t('result')}</h2>
            {submission.grade ? (
              <GradeResult assignment={assignment} grade={submission.grade} />
            ) : grading ? (
              <form
                className='space-y-4'
                onSubmit={(event) => {
                  event.preventDefault()
                  setError(null)
                  setConfirm(true)
                }}
              >
                {assignment.rubric.map((criterion, index) => (
                  <div
                    className='grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 border-b pb-3'
                    key={index}
                  >
                    <div className='min-w-0'>
                      <p className='text-sm font-medium wrap-break-word'>
                        {criterion.label}
                      </p>
                      {criterion.description && (
                        <p className='mt-1 text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground'>
                          {criterion.description}
                        </p>
                      )}
                    </div>
                    <Field label={`${t('score')} / ${criterion.max}`}>
                      <Input
                        aria-label={`${criterion.label} · ${t('score')}`}
                        type='number'
                        required
                        min={0}
                        max={criterion.max}
                        step={1}
                        value={draft.scores[index] ?? ''}
                        onChange={(event) => {
                          const score =
                            event.target.value === ''
                              ? null
                              : event.target.valueAsNumber
                          setDraft((previous) => ({
                            ...previous,
                            scores: previous.scores.map((value, position) =>
                              position === index ? score : value
                            ),
                          }))
                        }}
                      />
                    </Field>
                    <div className='col-span-full'>
                      <Field
                        label={`${criterion.label} · ${t('criterionFeedback')}`}
                      >
                        <Textarea
                          value={draft.criteriaFeedback[index] ?? ''}
                          onChange={(event) => {
                            const feedback = event.target.value
                            setDraft((previous) => ({
                              ...previous,
                              criteriaFeedback: previous.criteriaFeedback.map(
                                (value, position) =>
                                  position === index ? feedback : value
                              ),
                            }))
                          }}
                          rows={2}
                          maxLength={2000}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
                <AnnotationsEditor
                  work={submission.work}
                  rubric={assignment.rubric}
                  notes={draft.annotations}
                  onChange={(annotations) =>
                    setDraft((previous) => ({ ...previous, annotations }))
                  }
                />
                <Field label={t('feedback')}>
                  <Textarea
                    value={draft.feedback}
                    onChange={(event) => {
                      const feedback = event.target.value
                      setDraft((previous) => ({ ...previous, feedback }))
                    }}
                    rows={5}
                    required
                    maxLength={10000}
                  />
                </Field>
                <Field label={t('nextWritingStep')}>
                  <Textarea
                    rows={2}
                    maxLength={2000}
                    value={draft.nextStep ?? ''}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        nextStep: event.target.value,
                      }))
                    }
                  />
                </Field>
                {!confirm && <Problem error={error} />}
                <div className='flex flex-wrap items-center gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    disabled={pending || !dirty}
                    onClick={() => void save(false)}
                  >
                    {t('saveGradeDraft')}
                  </Button>
                  <Button type='submit' disabled={pending}>
                    {t('publishGrade')}
                  </Button>
                  <span className='text-xs text-muted-foreground' role='status'>
                    {pending
                      ? t('saving')
                      : dirty
                        ? t('unsaved')
                        : draftVersion > 0
                          ? t('saved')
                          : ''}
                  </span>
                </div>
                <ConfirmDialog
                  open={confirm}
                  onOpenChange={(open) => {
                    if (!pending) setConfirm(open)
                  }}
                  title={t('publishGrade')}
                  desc={t('gradeConfirm')}
                  cancelBtnText={t('cancel')}
                  confirmText={t('publishGrade')}
                  isLoading={pending}
                  disabled={
                    completeScores !== assignment.rubric.length ||
                    !draft.feedback.trim()
                  }
                  handleConfirm={() => void save(true)}
                >
                  <div className='grid gap-1 text-sm'>
                    <strong>
                      {submission.work.revisionTitle ?? submission.work.title}
                    </strong>
                    <p>
                      {t('gradePreview', {
                        score: totalScore,
                        max: assignment.rubric.reduce(
                          (sum, item) => sum + item.max,
                          0
                        ),
                        filled: completeScores,
                        total: assignment.rubric.length,
                        annotations: draft.annotations.length,
                      })}
                    </p>
                  </div>
                  <Problem error={error} />
                </ConfirmDialog>
              </form>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('returnedPaper')}
              </p>
            )}
            {detail.priorGradeDraft && (
              <details className='mt-3 space-y-2 rounded-md border p-3 text-sm'>
                <summary className='cursor-pointer font-medium'>
                  {t('priorGradeDraft')}
                </summary>
                {detail.priorGradeDraft.input.scores.map((score, index) => (
                  <div key={index} className='space-y-1 border-t pt-2'>
                    <p>
                      {assignment.rubric[index]?.label} · {score ?? '—'}
                    </p>
                    <p className='whitespace-pre-wrap'>
                      {detail.priorGradeDraft?.input.criteriaFeedback[index]}
                    </p>
                  </div>
                ))}
                <p className='whitespace-pre-wrap'>
                  {detail.priorGradeDraft.input.feedback}
                </p>
                {detail.priorGradeDraft.input.annotations.map((note, index) => (
                  <p key={index} className='whitespace-pre-wrap'>
                    {t('paragraphNumber', { number: note.block + 1 })} ·{' '}
                    {note.text}
                  </p>
                ))}
              </details>
            )}
          </section>
          <ReviewPanel
            reviews={assessments}
            enabled={detail.aiEnabled}
            disabled={pending}
            label='aiAssessment'
            onReview={
              !grading || !aiAllowed(assignment, 'assessment')
                ? undefined
                : () => assess(canCalibrate)
            }
            options={
              !assessments.length && (
                <p className='text-xs text-muted-foreground'>
                  {t(canCalibrate ? 'calibrationReady' : 'calibrationHint')}
                </p>
              )
            }
            onUseScores={
              !grading
                ? undefined
                : (scores) => setDraft((previous) => ({ ...previous, scores }))
            }
          />
          {assessments
            .filter((review) => Boolean(review.calibration))
            .map((review) => (
              <AssessmentComparison
                key={review.id}
                assignment={assignment}
                review={review}
                onSaved={(updated) =>
                  setReviews((items) =>
                    items.map((item) =>
                      item.id === updated.id ? updated : item
                    )
                  )
                }
              />
            ))}
          {pastAssessments.length > 0 && (
            <details className='space-y-3 rounded-xl border bg-card p-3 text-sm'>
              <summary className='cursor-pointer font-semibold'>
                {t('priorPaper')} · {t('aiAssessment')}
              </summary>
              <ReviewPanel reviews={pastAssessments} />
              {pastAssessments
                .filter((review) => review.calibration)
                .map((review) => (
                  <AssessmentComparison
                    key={review.id}
                    assignment={assignment}
                    review={review}
                    onSaved={(updated) =>
                      setPreviousReviews((items) =>
                        items.map((item) =>
                          item.id === updated.id ? updated : item
                        )
                      )
                    }
                  />
                ))}
            </details>
          )}
        </div>
      </div>
    </Main>
  )
}

function AssessmentComparison({
  assignment,
  review,
  onSaved,
}: {
  assignment: GradingDetail['assignment']
  review: AiReview
  onSaved: (review: AiReview) => void
}) {
  const { t } = useTranslation()
  const calibration = review.calibration!
  const [evidence, setEvidence] = useState(calibration.evidence)
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  return (
    <form
      className='space-y-3 rounded-xl border bg-card p-4 text-sm'
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        setPending(true)
        try {
          const saved = await request<NonNullable<AiReview['calibration']>>(
            `/api/assignments/${assignment.id}/reviews/${review.id}/calibration`,
            'PUT',
            { evidence }
          )
          onSaved({ ...review, calibration: saved })
        } catch (cause) {
          setError(cause)
        } finally {
          setPending(false)
        }
      }}
    >
      <h3 className='font-semibold'>{t('calibrationResults')}</h3>
      {calibration.baseline.map((baseline, index) => {
        const ai = review.result.scores?.[index]
        if (ai === undefined) return null
        const difference = ai - baseline
        return (
          <div key={index} className='space-y-2 border-t pt-2'>
            <p className='font-medium'>{assignment.rubric[index]?.label}</p>
            <p>
              {t('calibrationScores', {
                baseline,
                ai,
                difference: difference > 0 ? `+${difference}` : difference,
                absolute: Math.abs(difference),
              })}
            </p>
            {review.result.suggestions
              .filter((item) => item.criterion === index)
              .map((item, position) => (
                <p
                  key={position}
                  className='wrap-break-word whitespace-pre-wrap'
                >
                  {item.focus} · {item.reason ?? item.advice}
                </p>
              ))}
            <Field label={t('calibrationEvidence')}>
              <select
                className='h-8 rounded-md border bg-background px-2'
                value={evidence[index] === null ? '' : String(evidence[index])}
                onChange={(event) => {
                  const selected = event.target.value
                  setEvidence((values) =>
                    values.map((value, i) =>
                      i === index
                        ? selected === ''
                          ? null
                          : selected === 'true'
                        : value
                    )
                  )
                }}
              >
                <option value=''>{t('selectDecision')}</option>
                <option value='true'>{t('evidenceSupported')}</option>
                <option value='false'>{t('evidenceUnsupported')}</option>
              </select>
            </Field>
          </div>
        )
      })}
      <Problem error={error} />
      <Button
        size='sm'
        variant='outline'
        type='submit'
        disabled={
          pending ||
          evidence.every(
            (value, index) => value === calibration.evidence[index]
          )
        }
      >
        {t('saveCalibration')}
      </Button>
    </form>
  )
}

function ReturnPaper({
  path,
  version,
  draftVersion,
  disabled,
  onReturned,
}: {
  path: string
  version: number
  draftVersion: number
  disabled: boolean
  onReturned: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  return (
    <>
      <Button
        type='button'
        variant='outline'
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {t('returnPaper')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('returnPaper')}</DialogTitle>
            <DialogDescription>{t('returnPaperHint')}</DialogDescription>
          </DialogHeader>
          <form
            className='grid gap-3'
            onSubmit={async (event) => {
              event.preventDefault()
              if (pending) return
              const values = new FormData(event.currentTarget)
              setPending(true)
              setError(null)
              try {
                const due = new Date(String(values.get('dueAt')))
                if (!(due.getTime() > Date.now()))
                  throw new RequestError(400, 'invalidDeadline')
                await request(`${path}/return`, 'POST', {
                  reason: values.get('reason'),
                  dueAt: due.toISOString(),
                  version,
                  draftVersion,
                })
                setOpen(false)
                await onReturned()
              } catch (cause) {
                setError(cause)
              } finally {
                setPending(false)
              }
            }}
          >
            <Field label={t('returnReason')}>
              <Textarea name='reason' rows={4} maxLength={2000} required />
            </Field>
            <Field label={t('resubmitDue')}>
              <Input name='dueAt' type='datetime-local' required />
            </Field>
            <Problem error={error} />
            <Button type='submit' disabled={pending}>
              {t('returnPaper')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AnnotationsEditor({
  work,
  rubric,
  notes,
  onChange,
}: {
  work: Submission['work']
  rubric: GradingDetail['assignment']['rubric']
  notes: Annotation[]
  onChange: (notes: Annotation[]) => void
}) {
  const { t } = useTranslation()
  const paragraphs = work.revision.content.flatMap((item, block) => {
    const text = blockText(item).trim()
    return item.type === 'paragraph' && text ? [{ block, text }] : []
  })
  const [block, selectBlock] = useState(paragraphs[0]?.block ?? 0)
  const [criterion, selectCriterion] = useState('')
  const [text, setText] = useState('')
  if (paragraphs.length === 0) return null
  return (
    <fieldset className='grid gap-3 rounded-lg border p-3'>
      <legend className='px-1 text-sm font-medium'>{t('annotations')}</legend>
      {notes.map((note, index) => (
        <div className='grid gap-1 rounded border p-2 text-sm' key={index}>
          <a
            className='font-medium text-primary underline'
            href={`#paper-paragraph-${note.block}`}
          >
            {t('paragraphNumber', { number: note.block + 1 })}
          </a>
          {note.criterion !== undefined && (
            <p>{rubric[note.criterion].label}</p>
          )}
          <p className='wrap-break-word whitespace-pre-wrap'>{note.text}</p>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='justify-self-start'
            onClick={() => onChange(notes.filter((_, item) => item !== index))}
          >
            {t('remove')}
          </Button>
        </div>
      ))}
      <Field label={t('targetParagraph')}>
        <select
          className='h-9 w-full rounded-md border border-input bg-background px-2'
          value={block}
          onChange={(event) => selectBlock(Number(event.target.value))}
        >
          {paragraphs.map((item) => (
            <option key={item.block} value={item.block}>
              {t('paragraphNumber', { number: item.block + 1 })} ·{' '}
              {item.text.slice(0, 80)}
            </option>
          ))}
        </select>
      </Field>
      <a
        href={`#paper-paragraph-${block}`}
        className='text-xs text-primary underline'
      >
        {t('locateParagraph')}
      </a>
      <Field label={t('linkedCriterion')}>
        <select
          className='h-9 w-full rounded-md border border-input bg-background px-2'
          value={criterion}
          onChange={(event) => selectCriterion(event.target.value)}
        >
          <option value=''>{t('noCriterion')}</option>
          {rubric.map((item, index) => (
            <option key={index} value={index}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('annotationText')}>
        <Textarea
          rows={2}
          value={text}
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='justify-self-start'
        disabled={!text.trim() || notes.length >= 100}
        onClick={() => {
          onChange([
            ...notes,
            {
              block,
              criterion: criterion === '' ? undefined : Number(criterion),
              text: text.trim(),
            },
          ])
          setText('')
        }}
      >
        {t('addAnnotation')}
      </Button>
    </fieldset>
  )
}
