import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { Identity, Notification } from '@writing/writing'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { notificationsKey, request } from './api'
import { Problem } from './ui'

export function NotificationsPage({ person }: { person: Identity }) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const key = notificationsKey(person.id)
  const inbox = useQuery({
    queryKey: [...key, 'inbox'],
    queryFn: () => request<Notification[]>('/api/notifications'),
    refetchInterval: 30000,
  })
  const read = useMutation({
    mutationFn: (id: string) => request(`/api/notifications/${id}/read`, 'PUT'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key })
    },
    onError: () => toast.error(t('error.default')),
  })
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl space-y-5 px-4 py-7 sm:px-8'
    >
      <h1 className='text-3xl font-semibold tracking-tight'>
        {t('notifications')}
      </h1>
      {inbox.isPending && <p role='status'>{t('loading')}</p>}
      {inbox.isError && (
        <div className='space-y-3'>
          <Problem error={inbox.error} />
          <Button variant='outline' onClick={() => void inbox.refetch()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {inbox.data &&
        (inbox.data.length === 0 ? (
          <p className='rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>
            {t('emptyNotifications')}
          </p>
        ) : (
          <ul className='divide-y rounded-xl border bg-card'>
            {inbox.data.map((item) => {
              const onOpen = () => {
                if (!item.readAt) read.mutate(item.id)
              }
              return (
                <li
                  key={item.id}
                  className='flex flex-wrap items-center justify-between gap-3 p-4'
                >
                  <div className='min-w-0 space-y-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      {item.kind === 'submission' && item.submissionId ? (
                        <Link
                          className='font-medium wrap-break-word hover:underline'
                          to='/assignments/$assignmentId/submissions/$submissionId'
                          params={{
                            assignmentId: item.assignmentId,
                            submissionId: item.submissionId,
                          }}
                          onClick={onOpen}
                        >
                          {t(`notification.${item.kind}`, {
                            title: item.assignmentTitle,
                          })}
                        </Link>
                      ) : (
                        <Link
                          className='font-medium wrap-break-word hover:underline'
                          to='/assignments/$assignmentId'
                          params={{ assignmentId: item.assignmentId }}
                          hash={
                            item.kind === 'grade' ? 'grade-feedback' : undefined
                          }
                          onClick={onOpen}
                        >
                          {t(`notification.${item.kind}`, {
                            title: item.assignmentTitle,
                          })}
                        </Link>
                      )}
                      {!item.readAt && (
                        <Badge variant='secondary'>{t('unread')}</Badge>
                      )}
                    </div>
                    <time
                      className='text-xs text-muted-foreground'
                      dateTime={item.createdAt}
                    >
                      {date.format(new Date(item.createdAt))}
                    </time>
                  </div>
                  {!item.readAt && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => read.mutate(item.id)}
                      disabled={read.isPending}
                    >
                      {t('markRead')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        ))}
    </Main>
  )
}
