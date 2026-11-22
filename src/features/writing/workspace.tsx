import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import {
  countWriting,
  blockText,
  emptyWork,
  incompleteBefore,
  stageComplete,
  stages,
  type AiReview,
  type AiTask,
  type Assignment,
  type Stage,
  type Submission,
  type Work,
} from '@writing/writing'
import { ArrowRight, Check, ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { request, RequestError } from './api'
import { PaperEditor, PaperText } from './editor'
import { ReviewPanel } from './reviews'
import { Field, Problem, Requirements } from './ui'

type Action = 'save' | 'advance' | 'submit' | 'navigate'

const writingColumns =
  'grid min-h-0 gap-4 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_clamp(21rem,32vw,40rem)] lg:grid-rows-[minmax(0,1fr)]'
const writingPane =
  'min-w-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain'

function StageTrack({
  stage,
  opened,
  work,
  locked,
  pending,
  go,
}: {
  stage: Stage
  opened: Stage
  work: Work
  locked?: boolean
  pending?: boolean
  go?: (step: Stage) => void
}) {
  const { t } = useTranslation()
  const current = stages.indexOf(stage)
  const openedIndex = stages.indexOf(opened)
  return (
    <ol
      className='grid shrink-0 grid-cols-5 gap-1 rounded-xl border bg-card p-2 sm:gap-2 sm:p-3'
      aria-label={t('writingStages')}
    >
      {stages.map((step, index) => {
        const missing =
          index > current ? incompleteBefore(step, work) : undefined
        const reachable =
          !missing &&
          (index <= openedIndex ||
            (current === openedIndex && index === openedIndex + 1))
        const status =
          index === current
            ? 'currentStage'
            : !reachable
              ? 'unavailableStage'
              : index <= openedIndex && stageComplete(step, work)
                ? 'completedStage'
                : 'openStage'
        const hint =
          !reachable && missing
            ? t('completeFirst', { stage: t(`stage.${missing}`) })
            : t(status)
        return (
          <li key={step} aria-current={index === current ? 'step' : undefined}>
            <Button
              type='button'
              variant='ghost'
              className={cn(
                'h-auto w-full flex-col gap-1 px-1 py-2 text-center whitespace-normal sm:px-2',
                index === current && 'bg-primary/10'
              )}
              disabled={pending}
              aria-disabled={locked || !reachable || index === current}
              title={hint}
              aria-label={`${t(`stage.${step}`)} · ${hint}`}
              onClick={() => {
                if (reachable && index !== current) go?.(step)
              }}
            >
              <span className='grid size-5 shrink-0 place-items-center rounded-full border text-xs'>
                {status === 'completedStage' ? (
                  <Check size={13} aria-hidden='true' />
                ) : (
                  index + 1
                )}
              </span>
              <span className='text-xs wrap-break-word'>
                {t(`stage.${step}`)}
              </span>
              <span className='text-[0.65rem] text-muted-foreground'>
                {t(status)}
              </span>
            </Button>
          </li>
        )
      })}
    </ol>
  )
}

export function Workspace({
  assignment,
  submission,
  reviews,
  aiEnabled,
}: {
  assignment: Assignment
  submission: Submission | null
  reviews: AiReview[]
  aiEnabled: boolean
}) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(submission)
  const [allReviews, setReviews] = useState(reviews)
  const [openedAt] = useState(Date.now)
  const stage = current?.stage ?? 'goals'
  const closed =
    assignment.archived || new Date(assignment.dueAt).getTime() <= openedAt
  const submitted = current && current.status !== 'draft'

  function upsertReview(next: AiReview) {
    setReviews((previous) =>
      previous.some((item) => item.id === next.id)
        ? previous.map((item) => (item.id === next.id ? next : item))
        : [next, ...previous]
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4'>
      {submitted || closed ? (
        <>
          <StageTrack
            stage={stage}
            opened={current?.openedStage ?? stage}
            work={current?.work ?? emptyWork}
            locked
          />
          <div className={writingColumns}>
            <section
              aria-label={t('writingArea')}
              tabIndex={0}
              className={cn('space-y-4', writingPane)}
            >
              <section
                id='grade-feedback'
                tabIndex={-1}
                className='scroll-mt-24 space-y-3 rounded-xl border bg-card p-4 sm:p-6'
              >
                <h2 className='text-xl font-semibold'>
                  {t(submitted ? 'result' : 'writingClosed')}
                </h2>
                {current?.grade ? (
                  <GradeResult assignment={assignment} grade={current.grade} />
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t(
                      submitted
                        ? 'waiting'
                        : assignment.archived
                          ? 'archivedWritingNote'
                          : 'deadlineNote'
                    )}
                  </p>
                )}
              </section>
              {current && (
                <WrittenWork
                  work={current.work}
                  anchors={Boolean(current.grade)}
                />
              )}
            </section>
            <aside
              aria-label={t('writingReferences')}
              tabIndex={0}
              className={cn('space-y-3', writingPane)}
            >
              <Requirements assignment={assignment} />
              <ReviewPanel
                reviews={allReviews.filter(
                  (item) =>
                    item.task !== 'assessment' || current?.status === 'graded'
                )}
                work={current?.work}
              />
            </aside>
          </div>
        </>
      ) : (
        <StageEditor
          key={stage}
          assignment={assignment}
          stage={stage}
          submission={current}
          onSaved={setCurrent}
          reviews={allReviews}
          aiEnabled={aiEnabled}
          onReviewSaved={upsertReview}
        />
      )}
    </div>
  )
}

function stageFields(stage: Stage, work: Work): Partial<Work> {
  switch (stage) {
    case 'goals':
      return { goal: work.goal, aiGoal: work.aiGoal }
    case 'outline':
      return { outline: work.outline }
    case 'draft':
      return { title: work.title, draft: work.draft, checked: work.checked }
    case 'revise':
      return {
        revisionTitle: work.revisionTitle ?? work.title,
        revision: work.revision,
        checked: work.checked,
      }
    case 'reflect':
      return { reflection: work.reflection }
  }
}

function StageEditor({
  assignment,
  stage,
  submission,
  onSaved,
  reviews,
  aiEnabled,
  onReviewSaved,
}: {
  assignment: Assignment
  stage: Stage
  submission: Submission | null
  onSaved: (submission: Submission) => void
  reviews: AiReview[]
  aiEnabled: boolean
  onReviewSaved: (review: AiReview) => void
}) {
  const { t } = useTranslation()
  const work = submission?.work ?? emptyWork
  const [fields, setFields] = useState(() => stageFields(stage, work))
  const [savedFields, setSavedFields] = useState(() =>
    JSON.stringify(stageFields(stage, work))
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [reviewing, setReviewing] = useState(false)
  const [selected, setSelected] = useState<{
    block: number
    text: string
  } | null>(null)
  const busy = useRef(false)
  const dirty = JSON.stringify(fields) !== savedFields
  const version = submission?.version ?? 0
  const stageDoc = fields.draft ?? fields.revision ?? work.revision
  const count = countWriting(stageDoc, assignment.language)
  const unitKey = assignment.language === 'en' ? 'words' : 'characters'
  const unit = t(unitKey)
  const tooShort = count < assignment.minLength
  const lengthOutsideRange = tooShort || count > assignment.maxLength
  const lengthDifference = tooShort
    ? assignment.minLength - count
    : count - assignment.maxLength
  const hasDoc = stage === 'draft' || stage === 'revise'
  const selectionValid =
    selected &&
    stageDoc.content[selected.block]?.type === 'paragraph' &&
    selected.text === blockText(stageDoc.content[selected.block])
  const stepIndex = stages.indexOf(stage)

  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      dirty &&
      !window.confirm(t('leavePrompt')),
    enableBeforeUnload: dirty,
    disabled: !dirty,
  })

  const persist = useCallback(
    async (action: Action, target?: Stage) => {
      if (busy.current) return false
      if (action === 'save' && !dirty) return version
      busy.current = true
      setPending(true)
      setError(null)
      try {
        const saved = await request<Submission>(
          `/api/assignments/${assignment.id}/work`,
          'PUT',
          {
            version,
            stage,
            action,
            target,
            changes: fields,
          }
        )
        setSavedFields(JSON.stringify(fields))
        onSaved(saved)
        return saved.version
      } catch (cause) {
        setError(cause)
        return false
      } finally {
        busy.current = false
        setPending(false)
      }
    },
    [assignment.id, dirty, fields, stage, version, onSaved]
  )

  useEffect(() => {
    if (!dirty || pending || error) return
    const timer = window.setTimeout(() => void persist('save'), 700)
    return () => window.clearTimeout(timer)
  }, [dirty, pending, error, persist])

  function update(change: Partial<Work>) {
    if (error instanceof RequestError && error.code === 'versionConflict') {
      setFields((previous) => ({ ...previous, ...change }))
      return
    }
    setError(null)
    setFields((previous) => ({ ...previous, ...change }))
  }

  async function generate(task: AiTask) {
    setReviewing(true)
    try {
      const savedVersion = await persist('save')
      if (savedVersion === false) return
      const result = await request<AiReview>(
        `/api/assignments/${assignment.id}/reviews`,
        'POST',
        {
          task,
          version: savedVersion,
          block: task === 'revision' ? selected?.block : undefined,
        }
      )
      onReviewSaved(result)
    } finally {
      setReviewing(false)
    }
  }

  const reviewTask =
    stage === 'outline' ? 'outline' : stage === 'revise' ? 'revision' : null
  const taskReviews = reviews.filter((item) =>
    reviewTask ? item.task === reviewTask : true
  )

  return (
    <>
      <StageTrack
        stage={stage}
        opened={submission?.openedStage ?? stage}
        work={{ ...work, ...fields }}
        pending={pending || reviewing}
        go={(step) => void persist('navigate', step)}
      />
      <div className={writingColumns}>
        <section
          aria-label={t('writingArea')}
          tabIndex={0}
          className={cn(
            'space-y-5 rounded-xl border bg-card p-4 sm:p-6',
            writingPane
          )}
        >
          <div>
            <h2 className='text-xl font-semibold tracking-tight'>
              {t(`stage.${stage}`)}
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              {t(`stageHelp.${stage}`)}
            </p>
          </div>
          {stage === 'goals' && (
            <>
              <Field label={t('goal')}>
                <Textarea
                  value={fields.goal}
                  rows={5}
                  maxLength={4000}
                  onChange={(event) => update({ goal: event.target.value })}
                />
              </Field>
              <Field label={t('aiGoal')}>
                <Textarea
                  value={fields.aiGoal}
                  rows={3}
                  maxLength={4000}
                  onChange={(event) => update({ aiGoal: event.target.value })}
                />
              </Field>
            </>
          )}
          {stage === 'outline' && (
            <Field label={t('outline')}>
              <Textarea
                value={fields.outline}
                rows={16}
                className='min-h-64 resize-y sm:min-h-96'
                maxLength={12000}
                onChange={(event) => update({ outline: event.target.value })}
              />
            </Field>
          )}
          {hasDoc && (
            <>
              <Field label={t('paperTitle')}>
                <Input
                  value={
                    stage === 'draft' ? fields.title : fields.revisionTitle
                  }
                  maxLength={240}
                  onChange={(event) =>
                    update(
                      stage === 'draft'
                        ? { title: event.target.value }
                        : { revisionTitle: event.target.value }
                    )
                  }
                />
              </Field>
              <div>
                <div className='mb-2 flex flex-wrap justify-between gap-2 text-sm'>
                  <span className='font-medium'>{t('manuscript')}</span>
                  <span className='text-muted-foreground tabular-nums'>
                    {t('wordCount', { count, unit })} ·{' '}
                    {t('lengthRule', {
                      min: assignment.minLength,
                      max: assignment.maxLength,
                      unit,
                    })}
                  </span>
                </div>
                <PaperEditor
                  value={stageDoc}
                  onChange={(doc) =>
                    update(
                      stage === 'draft' ? { draft: doc } : { revision: doc }
                    )
                  }
                  onParagraph={
                    stage === 'revise'
                      ? (block) => {
                          if (block !== null)
                            setSelected({
                              block,
                              text: blockText(stageDoc.content[block]),
                            })
                        }
                      : undefined
                  }
                />
              </div>
              {stage === 'revise' && (
                <details className='rounded-lg border p-3'>
                  <summary className='cursor-pointer text-sm font-medium'>
                    {t('viewDraft')}
                  </summary>
                  <p className='mt-2 font-medium'>{work.title}</p>
                  <PaperText doc={work.draft} />
                </details>
              )}
              {assignment.checklist.length > 0 && (
                <fieldset className='grid gap-2 rounded-lg border p-3'>
                  <legend className='px-1 text-sm font-medium'>
                    {t('checklist')}
                  </legend>
                  {assignment.checklist.map((item, index) => (
                    <label
                      key={index}
                      className='flex items-start gap-2 text-sm'
                    >
                      <input
                        type='checkbox'
                        className='mt-1 accent-primary'
                        checked={fields.checked?.includes(index)}
                        onChange={(event) => {
                          const checked = fields.checked ?? []
                          update({
                            checked: event.target.checked
                              ? [...checked, index]
                              : checked.filter(
                                  (position) => position !== index
                                ),
                          })
                        }}
                      />
                      {item}
                    </label>
                  ))}
                </fieldset>
              )}
            </>
          )}
          {stage === 'reflect' && (
            <>
              <Field label={t('reflection')}>
                <Textarea
                  value={fields.reflection}
                  rows={6}
                  maxLength={8000}
                  onChange={(event) =>
                    update({ reflection: event.target.value })
                  }
                />
              </Field>
              <details className='rounded-lg border p-3'>
                <summary className='cursor-pointer text-sm font-medium'>
                  {t('finalDraft')}
                </summary>
                <PaperText doc={work.revision} />
              </details>
              <div className='space-y-1 text-sm tabular-nums'>
                <div className='flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground'>
                  <span>
                    {t('currentLength', { count, unit: t(unitKey, { count }) })}
                  </span>
                  <span>
                    {t('requiredLength', {
                      range: t('lengthRule', {
                        min: assignment.minLength,
                        max: assignment.maxLength,
                        unit,
                      }),
                    })}
                  </span>
                </div>
                {lengthOutsideRange && (
                  <p className='text-destructive'>
                    {t(tooShort ? 'draftTooShort' : 'draftTooLong', {
                      count: lengthDifference,
                      unit: t(unitKey, { count: lengthDifference }),
                    })}
                  </p>
                )}
              </div>
            </>
          )}
          <Problem error={error} />
          <div className='flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={pending || !dirty || reviewing}
                onClick={() => void persist('save')}
              >
                {t('save')}
              </Button>
              <span className='text-xs text-muted-foreground' role='status'>
                {t(pending ? 'saving' : dirty ? 'unsaved' : 'saved')}
              </span>
            </div>
            <div className='flex flex-wrap gap-2'>
              {stepIndex > 0 && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={pending || reviewing}
                  onClick={() =>
                    void persist('navigate', stages[stepIndex - 1])
                  }
                >
                  <ChevronLeft />
                  {t(stage === 'reflect' ? 'reviseAgain' : 'previousStage')}
                </Button>
              )}
              {stage === 'reflect' ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type='button'
                      disabled={pending || reviewing || lengthOutsideRange}
                    >
                      {t('submit')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('submitTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('submitDescription')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void persist('submit')}>
                        {t('confirmSubmit')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button
                  type='button'
                  disabled={pending || reviewing}
                  onClick={() => void persist('advance')}
                >
                  {t('next')}
                  <ArrowRight />
                </Button>
              )}
            </div>
          </div>
        </section>
        <aside
          aria-label={t('writingReferences')}
          tabIndex={0}
          className={cn('space-y-3', writingPane)}
        >
          <Requirements assignment={assignment} open={stage === 'goals'} />
          {stage !== 'goals' && work.outline.trim() && stage !== 'outline' && (
            <details className='rounded-xl border bg-card p-4'>
              <summary className='cursor-pointer text-sm font-semibold'>
                {t('outline')}
              </summary>
              <p className='mt-3 text-sm wrap-break-word whitespace-pre-wrap'>
                {work.outline}
              </p>
            </details>
          )}
          <ReviewPanel
            reviews={taskReviews}
            enabled={aiEnabled}
            disabled={
              pending || reviewing || (stage === 'revise' && !selectionValid)
            }
            selected={
              stage === 'revise'
                ? selectionValid
                  ? selected.text
                  : ''
                : undefined
            }
            work={{ ...work, ...fields }}
            label={reviewTask === 'outline' ? 'aiOutline' : 'aiRevision'}
            onReview={reviewTask ? () => generate(reviewTask) : undefined}
            decisions={
              stage === 'revise' || stage === 'outline'
                ? { assignmentId: assignment.id, onSaved: onReviewSaved }
                : undefined
            }
          />
        </aside>
      </div>
    </>
  )
}

export function GradeResult({
  assignment,
  grade,
}: {
  assignment: Assignment
  grade: NonNullable<Submission['grade']>
}) {
  const { t } = useTranslation()
  const points = grade.scores.reduce((sum, value) => sum + value, 0)
  const total = assignment.rubric.reduce(
    (sum, criterion) => sum + criterion.max,
    0
  )
  return (
    <div className='space-y-3'>
      <p className='text-sm text-muted-foreground'>
        {t('finalScore')}{' '}
        <strong className='ms-2 text-xl text-foreground tabular-nums'>
          {points} / {total}
        </strong>
      </p>
      <dl className='grid gap-2'>
        {assignment.rubric.map((item, index) => (
          <div
            key={index}
            className='flex justify-between gap-3 border-b py-2 text-sm'
          >
            <dt className='wrap-break-word'>
              {item.label}
              {grade.criteriaFeedback?.[index] && (
                <p className='mt-1 whitespace-pre-wrap text-muted-foreground'>
                  {grade.criteriaFeedback[index]}
                </p>
              )}
            </dt>
            <dd className='shrink-0 tabular-nums'>
              {grade.scores[index]} / {item.max}
            </dd>
          </div>
        ))}
      </dl>
      <h3 className='text-sm font-semibold'>{t('feedback')}</h3>
      <p className='text-sm wrap-break-word whitespace-pre-wrap'>
        {grade.feedback}
      </p>
      {Boolean(grade.annotations?.length) && (
        <div className='space-y-2'>
          <h3 className='text-sm font-semibold'>{t('annotations')}</h3>
          {grade.annotations?.map((note, index) => (
            <div className='rounded-md border p-3 text-sm' key={index}>
              <a
                className='font-medium text-primary underline'
                href={`#paper-paragraph-${note.block}`}
              >
                {t('paragraphNumber', { number: note.block + 1 })}
              </a>
              {note.criterion !== undefined && (
                <span> · {assignment.rubric[note.criterion]?.label}</span>
              )}
              <p className='mt-1 wrap-break-word whitespace-pre-wrap'>
                {note.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function WrittenWork({
  work,
  anchors = false,
}: {
  work: Work
  anchors?: boolean
}) {
  const { t } = useTranslation()
  const finalDoc = work.revision.content.some((item) => item.content?.length)
    ? work.revision
    : work.draft
  return (
    <section className='min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6'>
      <div>
        <p className='text-sm text-muted-foreground'>{t('finalDraft')}</p>
        <h2 className='text-xl font-semibold tracking-tight wrap-break-word'>
          {(finalDoc === work.revision
            ? (work.revisionTitle ?? work.title)
            : work.title) || t('emptyText')}
        </h2>
      </div>
      <PaperText doc={finalDoc} anchors={anchors} />
      <div className='grid gap-2 border-t pt-3 text-sm'>
        <details>
          <summary className='cursor-pointer font-medium'>{t('goal')}</summary>
          <p className='mt-2 wrap-break-word whitespace-pre-wrap'>
            {work.goal || t('emptyText')}
          </p>
          {work.aiGoal && (
            <p className='mt-2 wrap-break-word whitespace-pre-wrap'>
              {t('aiGoal')} · {work.aiGoal}
            </p>
          )}
        </details>
        <details>
          <summary className='cursor-pointer font-medium'>
            {t('outline')}
          </summary>
          <p className='mt-2 wrap-break-word whitespace-pre-wrap'>
            {work.outline || t('emptyText')}
          </p>
        </details>
        <details>
          <summary className='cursor-pointer font-medium'>
            {t('initialDraft')}
          </summary>
          <p className='mt-2 font-medium'>{work.title}</p>
          <PaperText doc={work.draft} />
        </details>
        <details>
          <summary className='cursor-pointer font-medium'>
            {t('reflection')}
          </summary>
          <p className='mt-2 wrap-break-word whitespace-pre-wrap'>
            {work.reflection || t('emptyText')}
          </p>
        </details>
      </div>
    </section>
  )
}
