import { useQuery } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import type { Assignment, Identity } from '@writing/writing'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { dashboardOptions, type AssignmentDetail } from './api'
import { AssignmentDialog } from './dashboard'
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
  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl space-y-6 px-4 py-7 sm:px-8'
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
          <Requirements assignment={assignment} open />
        </div>
      ) : (
        <Workspace
          key={assignment.id}
          assignment={assignment}
          submission={detail.submission}
          reviews={detail.reviews}
          aiEnabled={detail.aiEnabled}
        />
      )}
    </Main>
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
