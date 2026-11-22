import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { courseProgresses, type CourseProgress } from '@writing/writing'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { dashboardOptions } from './api'
import { selectField } from './management-ui'
import { Deadline, Problem } from './ui'

export function GradingQueue({ personId }: { personId: string }) {
  const { t } = useTranslation()
  const dashboard = useQuery(dashboardOptions(personId))
  const [status, setStatus] = useState<CourseProgress>('submitted')
  const [classroomId, setClassroomId] = useState('')
  const assignments =
    dashboard.data?.assignments.filter(
      (item) =>
        item.progress?.[status] &&
        (!classroomId || item.classroomId === classroomId)
    ) ?? []

  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl space-y-6 px-4 py-7 sm:px-8'
    >
      <h1 className='text-3xl font-semibold tracking-tight'>
        {t('gradingQueue')}
      </h1>
      {dashboard.isSuccess && (
        <div className='flex flex-wrap gap-2'>
          <select
            aria-label={t('courseTasks')}
            className={selectField}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as CourseProgress)
            }
          >
            {courseProgresses.map((item) => (
              <option key={item} value={item}>
                {t(item === 'draft' ? 'draftStatus' : item)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('classes')}
            className={selectField}
            value={classroomId}
            onChange={(event) => setClassroomId(event.target.value)}
          >
            <option value=''>{t('allCourses')}</option>
            {dashboard.data.classes
              .filter((item) => !item.archived)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </div>
      )}
      {dashboard.isPending && <p role='status'>{t('loading')}</p>}
      {dashboard.isError && (
        <div className='space-y-3'>
          <Problem error={dashboard.error} />
          <Button variant='outline' onClick={() => void dashboard.refetch()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {dashboard.isSuccess &&
        (assignments.length === 0 ? (
          <p className='rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>
            {t(status === 'submitted' ? 'nothingToGrade' : 'noProgressMatches')}
          </p>
        ) : (
          <ul className='grid gap-3'>
            {assignments.map((item) => (
              <li key={item.id}>
                <Card className='gap-0 py-4 shadow-none'>
                  <CardContent className='flex flex-wrap items-center justify-between gap-4 px-4 sm:px-5'>
                    <div className='min-w-0 space-y-2'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <h2 className='font-semibold wrap-break-word'>
                          {item.title}
                        </h2>
                        <Badge variant='secondary'>
                          {t(status === 'draft' ? 'draftStatus' : status)} ·{' '}
                          {item.progress?.[status]}
                        </Badge>
                      </div>
                      <div className='flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground'>
                        <span className='wrap-break-word'>
                          {item.classroomName}
                        </span>
                        <Deadline dueAt={item.dueAt} />
                      </div>
                    </div>
                    <Button variant='outline' size='sm' asChild>
                      <Link
                        to='/assignments/$assignmentId'
                        params={{ assignmentId: item.id }}
                      >
                        {t('viewSubmissions')}
                        <ArrowRight />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ))}
    </Main>
  )
}
