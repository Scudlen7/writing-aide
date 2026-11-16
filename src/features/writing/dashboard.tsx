import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type {
  AssignmentInput,
  Assignment,
  Classroom,
  Identity,
  Language,
} from '@writing/writing'
import { ArrowRight, Copy, GraduationCap, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Main } from '@/components/layout/main'
import { dashboardKey, dashboardOptions, RequestError, request } from './api'
import { Deadline, Field, PaperLanguage, Problem, StatusBadge } from './ui'

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export function WritingDashboard({
  person,
  classesOnly = false,
}: {
  person: Identity
  classesOnly?: boolean
}) {
  const { t } = useTranslation()
  const [now] = useState(Date.now)
  const [classSearch, setClassSearch] = useState('')
  const teacher = person.role === 'teacher'
  const data = useQuery(dashboardOptions(person.id))
  const activeClasses =
    data.data?.classes.filter((item) => !item.archived) ?? []
  const visibleClasses =
    data.data?.classes.filter((item) =>
      item.name
        .toLocaleLowerCase()
        .includes(classSearch.trim().toLocaleLowerCase())
    ) ?? []

  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl space-y-10 px-4 py-7 sm:px-8 sm:py-10'
    >
      <section className='flex flex-wrap items-end justify-between gap-4 border-b pb-6'>
        <div>
          <h1 className='text-3xl font-semibold tracking-tight'>
            {t(
              classesOnly
                ? 'classManagement'
                : teacher
                  ? 'assignments'
                  : 'yourAssignments'
            )}
          </h1>
          {!classesOnly && (
            <p className='mt-2 text-sm text-muted-foreground'>
              {t(teacher ? 'teacherIntro' : 'studentIntro')}
            </p>
          )}
        </div>
        {classesOnly && data.isSuccess && <ClassDialog teacher />}
        {!classesOnly && teacher && activeClasses.length > 0 && (
          <AssignmentDialog classes={activeClasses} />
        )}
      </section>
      {data.isPending && <p role='status'>{t('loading')}</p>}
      {data.isError && (
        <div className='space-y-3'>
          <Problem error={data.error} />
          <Button variant='outline' onClick={() => void data.refetch()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {data.isSuccess && (
        <>
          {!classesOnly && (
            <section
              aria-label={t(teacher ? 'assignments' : 'yourAssignments')}
            >
              {data.data.assignments.length ? (
                <ul className='grid gap-3'>
                  {data.data.assignments.map((item) => (
                    <li key={item.id}>
                      <Card className='gap-0 py-4 shadow-none'>
                        <CardContent className='flex flex-wrap items-center justify-between gap-4 px-4 sm:px-5'>
                          <div className='min-w-0 space-y-2'>
                            <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                              <p className='font-semibold wrap-break-word'>
                                {item.title}
                              </p>
                              <PaperLanguage language={item.language} />
                              {item.archived && (
                                <span className='text-xs text-muted-foreground'>
                                  {t('archived')}
                                </span>
                              )}
                              {!teacher && (
                                <StatusBadge
                                  status={item.status}
                                  dueAt={item.dueAt}
                                />
                              )}
                            </div>
                            <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground'>
                              <span className='wrap-break-word'>
                                {item.classroomName}
                              </span>
                              <Deadline dueAt={item.dueAt} />
                              {!teacher &&
                                item.stage &&
                                item.status === 'draft' && (
                                  <span>{t(`stage.${item.stage}`)}</span>
                                )}
                            </div>
                          </div>
                          <Button variant='outline' size='sm' asChild>
                            <Link
                              to='/assignments/$assignmentId'
                              params={{ assignmentId: item.id }}
                            >
                              {t(
                                teacher ||
                                  item.archived ||
                                  item.status === 'graded' ||
                                  item.status === 'submitted' ||
                                  new Date(item.dueAt).getTime() <= now
                                  ? 'openAssignment'
                                  : item.status === 'draft'
                                    ? 'continueWriting'
                                    : 'startWriting'
                              )}
                              <ArrowRight />
                            </Link>
                          </Button>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>
                  {t(teacher ? 'noTeacherAssignments' : 'noStudentAssignments')}
                </p>
              )}
            </section>
          )}
          <section aria-label={t('classes')}>
            {!classesOnly && (
              <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
                <div className='flex items-center gap-2'>
                  <GraduationCap size={19} className='text-muted-foreground' />
                  <h2 className='font-semibold'>{t('classes')}</h2>
                </div>
                <ClassDialog teacher={teacher} />
              </div>
            )}
            {teacher && data.data.classes.length > 0 && (
              <Input
                className='mb-3 max-w-sm'
                type='search'
                aria-label={t('searchClasses')}
                placeholder={t('searchClasses')}
                value={classSearch}
                onChange={(event) => setClassSearch(event.target.value)}
              />
            )}
            {visibleClasses.length ? (
              <ul className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                {visibleClasses.map((item) => (
                  <li
                    key={item.id}
                    className='min-w-0 rounded-xl border bg-card p-4'
                  >
                    <p className='font-medium wrap-break-word'>{item.name}</p>
                    {teacher && (
                      <p className='mt-1 text-sm text-muted-foreground'>
                        {t('studentCount', { count: item.studentCount ?? 0 })}
                        {item.archived && ` · ${t('archived')}`}
                      </p>
                    )}
                    {item.joinCode && (
                      <div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
                        <div>
                          <p className='text-xs text-muted-foreground'>
                            {t('joinCode')}
                          </p>
                          <code className='text-sm tracking-wide'>
                            {item.joinCode}
                          </code>
                        </div>
                        <Button
                          size='icon'
                          variant='ghost'
                          aria-label={t('copyCode')}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(item.joinCode!)
                              .then(() => toast.success(t('copied')))
                              .catch(() => toast.error(t('error.default')))
                          }}
                        >
                          <Copy />
                        </Button>
                      </div>
                    )}
                    {teacher && (
                      <Button
                        asChild
                        variant='outline'
                        size='sm'
                        className='mt-3'
                      >
                        <Link
                          to='/classes/$classId'
                          params={{ classId: item.id }}
                        >
                          {t('classDetails')}
                          <ArrowRight />
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className='rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>
                {t(
                  classSearch
                    ? 'noMatches'
                    : teacher
                      ? 'noTeacherClasses'
                      : 'noStudentClasses'
                )}
              </p>
            )}
          </section>
        </>
      )}
    </Main>
  )
}

function ClassDialog({ teacher }: { teacher: boolean }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const label = t(teacher ? 'addClass' : 'joinClass')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    setPending(true)
    setError(null)
    try {
      await request(
        teacher ? '/api/classes' : '/api/classes/join',
        'POST',
        fields
      )
      await client.invalidateQueries({ queryKey: dashboardKey })
      setOpen(false)
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value)
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size='sm' variant='outline'>
          <Plus />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {t(teacher ? 'noTeacherClasses' : 'noStudentClasses')}
          </DialogDescription>
        </DialogHeader>
        <form className='grid gap-4' onSubmit={(event) => void submit(event)}>
          <Field label={t(teacher ? 'className' : 'joinCode')}>
            <Input
              name={teacher ? 'name' : 'code'}
              maxLength={teacher ? 100 : 16}
              required
            />
          </Field>
          <Problem error={error} />
          <Button disabled={pending} type='submit'>
            {pending ? t('saving') : label}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AssignmentDialog({
  classes,
  initial,
  mode = 'create',
  frozen = false,
  onSaved,
}: {
  classes: Classroom[]
  initial?: Assignment
  mode?: 'create' | 'copy' | 'edit'
  frozen?: boolean
  onSaved?: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const label = t(
    mode === 'edit'
      ? 'editAssignment'
      : mode === 'copy'
        ? 'copyAssignment'
        : 'newAssignment'
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value)
      }}
    >
      <DialogTrigger asChild>
        <Button variant={mode === 'create' ? 'default' : 'outline'}>
          {mode === 'create' && <Plus />}
          {mode === 'copy' && <Copy />}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        className='max-h-[90dvh] overflow-y-auto sm:max-w-2xl'
        closeLabel={t('close')}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <AssignmentForm
          classes={classes}
          pending={pending}
          setPending={setPending}
          initial={initial}
          mode={mode}
          frozen={frozen}
          onSaved={async () => {
            setOpen(false)
            await onSaved?.()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function AssignmentForm({
  classes,
  pending,
  setPending,
  initial,
  mode,
  frozen,
  onSaved,
}: {
  classes: Classroom[]
  pending: boolean
  setPending: (pending: boolean) => void
  initial?: Assignment
  mode: 'create' | 'copy' | 'edit'
  frozen: boolean
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [language, setLanguage] = useState<Language>(
    initial?.language ?? 'zh-CN'
  )
  const [rubric, setRubric] = useState<AssignmentInput['rubric']>(
    () =>
      initial?.rubric ??
      (
        ['contentCriterion', 'structureCriterion', 'languageCriterion'] as const
      ).map((key) => ({ label: t(key), max: 10, description: '' }))
  )
  const editing = mode === 'edit' && initial
  const due = editing ? new Date(initial.dueAt) : null
  const localDue = due
    ? new Date(due.valueOf() - due.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : ''

  function updateCriterion(
    index: number,
    change: Partial<AssignmentInput['rubric'][number]>
  ) {
    setRubric((items) =>
      items.map((item, position) =>
        position === index ? { ...item, ...change } : item
      )
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setError(null)
    setPending(true)
    try {
      const enteredDue = String(values.get('dueAt'))
      const deadline =
        due && enteredDue === localDue ? due : new Date(enteredDue)
      if (
        !Number.isFinite(deadline.getTime()) ||
        (deadline !== due && deadline.getTime() <= Date.now())
      ) {
        throw new RequestError(400, 'invalidDeadline')
      }
      const result = await request<{ id: string }>(
        editing ? `/api/assignments/${initial.id}` : '/api/assignments',
        editing ? 'PATCH' : 'POST',
        {
          classroomId: editing
            ? initial.classroomId
            : values.get('classroomId'),
          title: values.get('title'),
          instructions: values.get('instructions'),
          dueAt: deadline.toISOString(),
          language,
          minLength: frozen
            ? initial?.minLength
            : Number(values.get('minLength')),
          maxLength: frozen
            ? initial?.maxLength
            : Number(values.get('maxLength')),
          checklist: frozen
            ? initial?.checklist
            : String(values.get('checklist'))
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
          rubric,
        }
      )
      await client.invalidateQueries({ queryKey: dashboardKey })
      toast.success(t(editing ? 'saved' : 'assignmentPublished'))
      await onSaved()
      if (!editing)
        await navigate({
          to: '/assignments/$assignmentId',
          params: { assignmentId: result.id },
        })
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  return (
    <form className='grid gap-4' onSubmit={(event) => void submit(event)}>
      <Field label={t('assignmentTitle')}>
        <Input
          name='title'
          maxLength={160}
          required
          defaultValue={initial?.title}
        />
      </Field>
      <div className='grid gap-3 sm:grid-cols-2'>
        <Field label={t('classroom')}>
          <select
            name='classroomId'
            disabled={Boolean(editing)}
            required
            defaultValue={
              editing
                ? initial.classroomId
                : mode === 'copy'
                  ? ''
                  : classes[0]?.id
            }
            aria-label={t('classroom')}
            className={selectClass}
          >
            {mode === 'copy' && (
              <option value='' disabled>
                {t('chooseClass')}
              </option>
            )}
            {classes.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('writingLanguage')}>
          <select
            aria-label={t('writingLanguage')}
            className={selectClass}
            value={language}
            disabled={frozen}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value='zh-CN'>{t('chinese')}</option>
            <option value='en'>{t('english')}</option>
          </select>
        </Field>
      </div>
      <Field label={t('due')}>
        <Input
          name='dueAt'
          type='datetime-local'
          required
          defaultValue={localDue}
        />
      </Field>
      <Field label={t('instructions')}>
        <Textarea
          name='instructions'
          rows={4}
          maxLength={10000}
          required
          defaultValue={initial?.instructions}
        />
      </Field>
      {frozen && (
        <p className='text-sm text-muted-foreground'>
          {t('error.assignmentFieldsFrozen')}
        </p>
      )}
      <fieldset disabled={frozen} className='grid gap-4'>
        <div className='grid gap-3 sm:grid-cols-2'>
          {(['minLength', 'maxLength'] as const).map((key, index) => (
            <Field
              key={key}
              label={`${t(key)} (${t(language === 'en' ? 'words' : 'characters')})`}
            >
              <Input
                name={key}
                type='number'
                min={1}
                max={30000}
                defaultValue={initial?.[key] ?? (index ? 1200 : 200)}
                required
              />
            </Field>
          ))}
        </div>
        <Field label={t('checklist')}>
          <Textarea
            name='checklist'
            placeholder={t('checklistHint')}
            rows={2}
            maxLength={3012}
            defaultValue={initial?.checklist.join('\n')}
          />
        </Field>
        <fieldset className='grid gap-3 rounded-xl border p-3'>
          <legend className='px-1 text-sm font-semibold'>{t('rubric')}</legend>
          {rubric.map((item, index) => (
            <div key={index} className='grid gap-2 rounded-md bg-muted/45 p-3'>
              <div className='grid grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2'>
                <Field label={t('criterion')}>
                  <Input
                    required
                    value={item.label}
                    maxLength={80}
                    onChange={(event) =>
                      updateCriterion(index, { label: event.target.value })
                    }
                  />
                </Field>
                <Field label={t('maxScore')}>
                  <Input
                    required
                    type='number'
                    min={1}
                    max={100}
                    value={item.max || ''}
                    onChange={(event) =>
                      updateCriterion(index, {
                        max: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Button
                  size='sm'
                  type='button'
                  variant='ghost'
                  disabled={rubric.length === 1}
                  onClick={() =>
                    setRubric(
                      rubric.filter((_, position) => position !== index)
                    )
                  }
                >
                  {t('remove')}
                </Button>
              </div>
              <Field label={t('criterionDescription')}>
                <Textarea
                  rows={2}
                  value={item.description}
                  maxLength={1000}
                  onChange={(event) =>
                    updateCriterion(index, { description: event.target.value })
                  }
                />
              </Field>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={rubric.length >= 12}
            className='justify-self-start'
            onClick={() =>
              setRubric([...rubric, { label: '', max: 10, description: '' }])
            }
          >
            <Plus />
            {t('addCriterion')}
          </Button>
        </fieldset>
      </fieldset>
      <Problem error={error} />
      <Button disabled={pending} type='submit'>
        {t(pending ? 'saving' : editing ? 'saveChanges' : 'publish')}
      </Button>
    </form>
  )
}
