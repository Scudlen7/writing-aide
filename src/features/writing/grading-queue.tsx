import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { dashboardOptions } from './api'
import { Deadline, Problem } from './ui'

export function GradingQueue({ personId }: { personId: string }) {
  const { t } = useTranslation()
  const dashboard = useQuery(dashboardOptions(personId))
  const assignments =
    dashboard.data?.assignments.filter((item) => item.pendingSubmissions) ?? []

  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl space-y-6 px-4 py-7 sm:px-8'
    >
      <h1 className='text-3xl font-semibold tracking-tight'>
        {t('gradingQueue')}
      </h1>
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
            {t('nothingToGrade')}
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
                          {t('pendingGrading', {
                            count: item.pendingSubmissions,
                          })}
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
