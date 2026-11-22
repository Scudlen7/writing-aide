import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import {
  courseProgresses,
  type Assignment,
  type CourseProgress,
  type CourseProgressStudent,
  type Identity,
} from '@writing/writing'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { dashboardOptions, type AssignmentDetail } from './api'
import { AssignmentDialog } from './dashboard'
import { selectField } from './management-ui'
import { PeerPanel } from './peer'
import { Deadline, PaperLanguage, Requirements, StatusBadge } from './ui'
import { Workspace } from './workspace'

export function AssignmentHeading({
  assignment,
  backToAssignment = false,
}: {
  assignment: Assignment
  backToAssignment?: boolean
}) {
  const { t, i18n } = useTranslation()
  return (
    <div className='space-y-3'>
      {backToAssignment ? (
        <Link
          className='inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground'
          to='/assignments/$assignmentId'
          params={{ assignmentId: assignment.id }}
        >
          <ArrowLeft size={16} />
          {t('backAssignment')}
        </Link>
      ) : (
        <Link
          className='inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground'
          to='/'
        >
          <ArrowLeft size={16} />
          {t('back')}
        </Link>
      )}
      <h1 className='text-3xl font-semibold tracking-tight wrap-break-word'>
        {assignment.title}
      </h1>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground'>
        <PaperLanguage language={assignment.language} />
        <span className='wrap-break-word'>{assignment.classroomName}</span>
        <Deadline dueAt={assignment.dueAt} />
        {assignment.archived && <span>{t('archived')}</span>}
        {assignment.updatedAt && (
          <time dateTime={assignment.updatedAt}>
            {t('updatedAt', {
              date: new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(assignment.updatedAt)),
            })}
          </time>
        )}
      </div>
    </div>
  )
}

export function AssignmentPage({
  detail,
  person,
}: {
  detail: AssignmentDetail
  person: Identity
}) {
  const { t } = useTranslation()
  const { assignment } = detail
  const student = person.role === 'student'
  return (
    <Main
      id='writing-main'
      fluid
      tabIndex={student ? -1 : undefined}
      className={cn(
        'w-full px-4',
        student
          ? 'flex min-h-0 flex-1 flex-col gap-4 py-4 sm:px-6 lg:overflow-hidden'
          : 'mx-auto max-w-6xl space-y-6 py-7 sm:px-8'
      )}
    >
      <AssignmentHeading assignment={assignment} />
      {'submissions' in detail && (
        <AssignmentActions
          assignment={assignment}
          started={detail.started}
          person={person}
        />
      )}
      {'submissions' in detail ? (
        <div className='grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]'>
          <section className='min-w-0 rounded-xl border bg-card'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
              <h2 className='font-semibold'>{t('submissions')}</h2>
              <span className='text-sm text-muted-foreground'>
                {t('entryCount', { count: detail.submissions.length })}
              </span>
            </div>
            {detail.submissions.length ? (
              <ul className='divide-y'>
                {detail.submissions.map((item) => (
                  <li
                    className='flex flex-wrap items-center justify-between gap-3 px-4 py-3'
                    key={item.id}
                  >
                    <div className='min-w-0'>
                      <p className='font-medium wrap-break-word'>
                        {item.studentName}
                      </p>
                      <p className='text-sm wrap-break-word text-muted-foreground'>
                        {item.title}
                      </p>
                    </div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <StatusBadge
                        status={item.status}
                        dueAt={assignment.dueAt}
                      />
                      <Button asChild variant='outline' size='sm'>
                        <Link
                          to='/assignments/$assignmentId/submissions/$submissionId'
                          params={{
                            assignmentId: assignment.id,
                            submissionId: item.id,
                          }}
                        >
                          {t('reviewSubmission')}
                          <ArrowRight />
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='p-5 text-sm text-muted-foreground'>
                {t('noSubmissions')}
              </p>
            )}
          </section>
          <aside className='space-y-3'>
            <Requirements assignment={assignment} open />
            <PeerPanel assignmentId={assignment.id} personId={person.id} />
            {!assignment.archived && (
              <CourseProgressList
                assignmentId={assignment.id}
                students={detail.students ?? []}
              />
            )}
          </aside>
        </div>
      ) : (
        <Workspace
          key={assignment.id}
          assignment={assignment}
          submission={detail.submission}
          reviews={detail.reviews}
          previousReviews={detail.previousReviews}
          aiEnabled={detail.aiEnabled}
          personId={person.id}
        />
      )}
    </Main>
  )
}

function CourseProgressList({
  assignmentId,
  students,
}: {
  assignmentId: string
  students: CourseProgressStudent[]
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<CourseProgress | ''>('')
  const filtered = status
    ? students.filter((student) => student.status === status)
    : students
  return (
    <details className='rounded-xl border bg-card'>
      <summary className='cursor-pointer px-4 py-3 text-sm font-semibold'>
        {t('courseTasks')}
      </summary>
      <div className='space-y-3 border-t p-4 text-sm'>
        <select
          aria-label={t('courseTasks')}
          className={selectField}
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as CourseProgress | '')
          }
        >
          <option value=''>{t('allProgress')}</option>
          {courseProgresses.map((item) => (
            <option key={item} value={item}>
              {t(item === 'draft' ? 'draftStatus' : item)} ·{' '}
              {students.filter((student) => student.status === item).length}
            </option>
          ))}
        </select>
        {filtered.length ? (
          <ul className='divide-y'>
            {filtered.map((student) => (
              <li
                key={student.id}
                className='flex flex-wrap justify-between gap-2 py-2'
              >
                {student.submissionId ? (
                  <Link
                    className='text-primary underline'
                    to='/assignments/$assignmentId/submissions/$submissionId'
                    params={{
                      assignmentId,
                      submissionId: student.submissionId,
                    }}
                  >
                    {student.name}
                  </Link>
                ) : (
                  <span>{student.name}</span>
                )}
                <span className='text-muted-foreground'>
                  {t(
                    student.status === 'draft' ? 'draftStatus' : student.status
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-muted-foreground'>{t('noProgressMatches')}</p>
        )}
      </div>
    </details>
  )
}

function AssignmentActions({
  assignment,
  started,
  person,
}: {
  assignment: Assignment
  started: boolean
  person: Identity
}) {
  const router = useRouter()
  const classes = useQuery(dashboardOptions(person.id))
  const targets = classes.data?.classes.filter((item) => !item.archived) ?? []
  return (
    <div className='flex flex-wrap gap-2'>
      <AssignmentDialog
        classes={[
          { id: assignment.classroomId, name: assignment.classroomName },
        ]}
        initial={assignment}
        mode='edit'
        frozen={started}
        onSaved={() => router.invalidate()}
      />
      {targets.length > 0 && (
        <AssignmentDialog classes={targets} initial={assignment} mode='copy' />
      )}
    </div>
  )
}
