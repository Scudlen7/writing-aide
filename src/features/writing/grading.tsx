import { useState, type FormEvent } from 'react'
import {
  blockText,
  type AiReview,
  type Annotation,
  type Submission,
} from '@writing/writing'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Main } from '@/components/layout/main'
import { request, type GradingDetail } from './api'
import { AssignmentHeading } from './assignment'
import { ReviewPanel } from './reviews'
import { Field, Problem, Requirements, StatusBadge } from './ui'
import { GradeResult, WrittenWork } from './workspace'

export function GradingPage({ detail }: { detail: GradingDetail }) {
  const { t } = useTranslation()
  const { assignment } = detail
  const [submission, setSubmission] = useState(detail.submission)
  const [reviews, setReviews] = useState(detail.reviews)
  const [scores, setScores] = useState(() => assignment.rubric.map(() => ''))
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const feedback = form.get('feedback')
    setPending(true)
    setError(null)
    try {
      const result = await request<Submission>(
        `/api/assignments/${assignment.id}/submissions/${submission.id}/grade`,
        'PUT',
        {
          scores: scores.map(Number),
          feedback,
          criteriaFeedback: assignment.rubric.map((_, index) =>
            form.get(`feedback-${index}`)
          ),
          annotations,
        }
      )
      setSubmission({ ...result, studentName: submission.studentName })
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  async function assess() {
    const result = await request<AiReview>(
      `/api/assignments/${assignment.id}/reviews`,
      'POST',
      {
        task: 'assessment',
        submissionId: submission.id,
      }
    )
    setReviews((previous) => [result, ...previous])
  }

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
          <WrittenWork work={submission.work} anchors />
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
            ) : (
              <form
                className='space-y-4'
                onSubmit={(event) => void publish(event)}
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
                        value={scores[index]}
                        onChange={(event) => {
                          const score = event.target.value
                          setScores((values) =>
                            values.map((value, position) =>
                              position === index ? score : value
                            )
                          )
                        }}
                      />
                    </Field>
                    <div className='col-span-full'>
                      <Field label={t('criterionFeedback')}>
                        <Textarea
                          name={`feedback-${index}`}
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
                  notes={annotations}
                  onChange={setAnnotations}
                />
                <Field label={t('feedback')}>
                  <Textarea
                    name='feedback'
                    rows={5}
                    required
                    maxLength={10000}
                  />
                </Field>
                <p className='text-xs text-muted-foreground'>
                  {t('gradeConfirm')}
                </p>
                <Problem error={error} />
                <Button type='submit' className='w-full' disabled={pending}>
                  {t(pending ? 'saving' : 'publishGrade')}
                </Button>
              </form>
            )}
          </section>
          <ReviewPanel
            reviews={reviews.filter((item) => item.task === 'assessment')}
            enabled={detail.aiEnabled}
            disabled={pending}
            label='aiAssessment'
            onReview={submission.grade ? undefined : assess}
            onUseScores={
              submission.grade
                ? undefined
                : (values) => setScores(values.map(String))
            }
          />
        </div>
      </div>
    </Main>
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
