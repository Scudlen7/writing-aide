import { personalGoalItems, type AiReview, type Work } from '@writing/writing'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Field } from './ui'

export function PersonalGoalsEditor({
  work,
  onChange,
}: {
  work: Work
  onChange: (goals: NonNullable<Work['personalGoals']>) => void
}) {
  const { t } = useTranslation()
  const values = work.personalGoals ?? {
    writing: [work.goal],
    ai: [work.aiGoal],
  }
  return (['writing', 'ai'] as const).map((kind) => (
    <fieldset key={kind} className='grid gap-2 rounded-lg border p-3'>
      <legend className='px-1 text-sm font-medium'>
        {t(kind === 'writing' ? 'goal' : 'aiGoal')}
      </legend>
      {values[kind].map((goal, index) => (
        <div className='flex items-start gap-2' key={index}>
          <Textarea
            aria-label={t(
              kind === 'writing' ? 'writingGoalNumber' : 'aiGoalNumber',
              { number: index + 1 }
            )}
            value={goal}
            maxLength={4000}
            rows={2}
            onChange={(event) =>
              onChange({
                ...values,
                [kind]: values[kind].map((item, position) =>
                  position === index ? event.target.value : item
                ),
              })
            }
          />
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() =>
              onChange({
                ...values,
                [kind]: values[kind].filter(
                  (_, position) => position !== index
                ),
              })
            }
          >
            {t('remove')}
          </Button>
        </div>
      ))}
      <Button
        type='button'
        size='sm'
        variant='outline'
        className='justify-self-start'
        disabled={values[kind].length >= 12}
        onClick={() => onChange({ ...values, [kind]: [...values[kind], ''] })}
      >
        {t('addGoal')}
      </Button>
    </fieldset>
  ))
}

export function WritingProcess({
  work,
  reviews = [],
  onCheck,
  onReflect,
}: {
  work: Work
  reviews?: AiReview[]
  onCheck?: (keys: string[]) => void
  onReflect?: (prompt: string) => void
}) {
  const { t } = useTranslation()
  const goals = personalGoalItems(work)
  const checked = work.completedGoals ?? []
  const visibleReviews = reviews.filter(
    (review) => review.task !== 'assessment'
  )
  const declaration = work.aiDeclaration
  return (
    <section className='space-y-3 rounded-lg border bg-card p-4 text-sm'>
      <h3 className='font-semibold'>
        {t(onCheck && !onReflect ? 'personalGoals' : 'processSummary')}
      </h3>
      {goals.length ? (
        <ul className='space-y-2'>
          {goals.map(({ key, kind, text }) => (
            <li key={key} className='space-y-1'>
              <label className='flex items-start gap-2 wrap-break-word'>
                {onCheck ? (
                  <Checkbox
                    className='mt-0.5'
                    checked={checked.includes(key)}
                    onCheckedChange={(value) =>
                      onCheck(
                        value
                          ? [...checked, key]
                          : checked.filter((item) => item !== key)
                      )
                    }
                  />
                ) : null}
                <span className='min-w-0 whitespace-pre-wrap'>
                  {kind === 'ai' ? `${t('ai')} · ` : ''}
                  {text}
                  {!onCheck && checked.includes(key)
                    ? ` · ${t('goalDone')}`
                    : ''}
                </span>
              </label>
              {onReflect && (
                <Button
                  type='button'
                  size='sm'
                  variant='link'
                  className='h-auto p-0'
                  onClick={() => onReflect(text)}
                >
                  {t('reflectOnThis')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-muted-foreground'>{t('noPersonalGoals')}</p>
      )}
      {declaration && (
        <p className='wrap-break-word whitespace-pre-wrap'>
          <strong>{t('aiDeclaration')}</strong> ·{' '}
          {declaration.used
            ? declaration.description || t('aiUsed')
            : t('aiNotUsed')}
        </p>
      )}
      {(!onCheck || onReflect) && (
        <details className='space-y-2 rounded-md border p-2'>
          <summary className='cursor-pointer font-medium'>
            {t('aiHistory')}
          </summary>
          {!visibleReviews.length && (
            <p className='text-muted-foreground'>{t('noProcessReviews')}</p>
          )}
          {visibleReviews.map((review) => (
            <div key={review.id} className='space-y-1 border-t pt-2'>
              <p>
                {t(review.task === 'outline' ? 'aiOutline' : 'aiRevision')}
                {review.source &&
                  ` · ${t('reviewSource', { version: review.source.version })}`}
              </p>
              {Object.entries(review.decisions).map(([index, decision]) => {
                const advice =
                  review.result.suggestions[Number(index)]?.advice ?? ''
                return (
                  <div
                    key={index}
                    className='wrap-break-word whitespace-pre-wrap'
                  >
                    <p>
                      {t(decision.choice)} · {decision.reason}
                    </p>
                    {onReflect && (
                      <Button
                        type='button'
                        size='sm'
                        variant='link'
                        className='h-auto p-0'
                        onClick={() => onReflect(advice)}
                      >
                        {t('reflectOnThis')}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

export function AiDeclaration({
  value,
  onChange,
}: {
  value?: Work['aiDeclaration']
  onChange: (value: NonNullable<Work['aiDeclaration']>) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='space-y-2'>
      <Field label={t('aiDeclaration')}>
        <select
          className='h-9 rounded-md border border-input bg-background px-2'
          value={value ? (value.used ? 'used' : 'none') : ''}
          onChange={(event) =>
            onChange({
              used: event.target.value === 'used',
              description: value?.description ?? '',
            })
          }
        >
          <option value='' disabled>
            {t('selectDecision')}
          </option>
          <option value='none'>{t('aiNotUsed')}</option>
          <option value='used'>{t('aiUsed')}</option>
        </select>
      </Field>
      {value?.used && (
        <Field label={t('aiDeclarationDetails')}>
          <Textarea
            value={value.description}
            onChange={(event) =>
              onChange({ used: true, description: event.target.value })
            }
            maxLength={2000}
            rows={3}
          />
        </Field>
      )}
    </div>
  )
}
