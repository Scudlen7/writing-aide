import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  courseProgresses,
  type CourseProgress,
  type Identity,
} from '@writing/writing'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Main } from '@/components/layout/main'
import { classesKey, dashboardKey, dashboardOptions, request } from './api'
import { ManagementDialog, ManagementTable, selectField } from './management-ui'
import { Field, Problem } from './ui'

export type Member = { id: string; name: string; email: string }
export type ManagedClass = {
  id: string
  name: string
  joinCode: string
  teacherId: string
  archived: boolean
}
type ClassroomDetail = { classroom: ManagedClass; students: Member[] }

export function ClassPage({
  classId,
  person,
}: {
  classId: string
  person: Identity
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const detail = useQuery({
    queryKey: [...classesKey, person.id, classId],
    queryFn: () => request<ClassroomDetail>(`/api/classes/${classId}`),
    retry: false,
  })
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: classesKey }),
      client.invalidateQueries({ queryKey: dashboardKey }),
    ])
  }
  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl space-y-5 px-4 py-7 sm:px-8'
    >
      <Button asChild size='sm' variant='ghost'>
        <Link to={person.role === 'admin' ? '/admin/classes' : '/classes'}>
          {t('backToClasses')}
        </Link>
      </Button>
      {detail.isPending && <p role='status'>{t('loading')}</p>}
      {detail.isError && (
        <div className='space-y-3'>
          <Problem error={detail.error} />
          <Button variant='outline' onClick={() => void detail.refetch()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {detail.isSuccess && (
        <>
          <ClassRoster detail={detail.data} refresh={refresh} />
          {person.role === 'teacher' && !detail.data.classroom.archived && (
            <ClassProgress classId={classId} personId={person.id} />
          )}
        </>
      )}
    </Main>
  )
}

function ClassProgress({
  classId,
  personId,
}: {
  classId: string
  personId: string
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<CourseProgress>('submitted')
  const dashboard = useQuery(dashboardOptions(personId))
  const assignments =
    dashboard.data?.assignments.filter(
      (item) => item.classroomId === classId && item.progress?.[status]
    ) ?? []
  return (
    <section className='space-y-3 rounded-xl border bg-card p-4'>
      <h2 className='font-semibold'>{t('courseTasks')}</h2>
      <select
        aria-label={t('courseTasks')}
        className={selectField}
        value={status}
        onChange={(event) => setStatus(event.target.value as CourseProgress)}
      >
        {courseProgresses.map((item) => (
          <option key={item} value={item}>
            {t(item === 'draft' ? 'draftStatus' : item)}
          </option>
        ))}
      </select>
      {dashboard.isPending ? (
        <p role='status'>{t('loading')}</p>
      ) : dashboard.isError ? (
        <Problem error={dashboard.error} />
      ) : assignments.length ? (
        <ul className='divide-y'>
          {assignments.map((item) => (
            <li
              key={item.id}
              className='flex justify-between gap-2 py-2 text-sm'
            >
              <Link
                className='text-primary underline'
                to='/assignments/$assignmentId'
                params={{ assignmentId: item.id }}
              >
                {item.title}
              </Link>
              <span>{item.progress?.[status]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('noProgressMatches')}
        </p>
      )}
    </section>
  )
}

function ClassRoster({
  detail,
  refresh,
}: {
  detail: ClassroomDetail
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { classroom, students } = detail
  const path = `/api/classes/${classroom.id}`
  const term = search.trim().toLocaleLowerCase()
  const rows = students.filter(
    (person) =>
      person.name.toLocaleLowerCase().includes(term) ||
      person.email.toLocaleLowerCase().includes(term)
  )
  return (
    <>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-3'>
          <h1 className='text-3xl font-semibold tracking-tight wrap-break-word'>
            {classroom.name}
          </h1>
          <p className='text-sm text-muted-foreground'>
            {t('studentCount', { count: students.length })}
            {classroom.archived && ` · ${t('archived')}`}
          </p>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            {t('joinCode')} <code>{classroom.joinCode}</code>
            <Button
              variant='ghost'
              size='icon'
              aria-label={t('copyCode')}
              onClick={() =>
                void navigator.clipboard
                  .writeText(classroom.joinCode)
                  .then(() => toast.success(t('copied')))
                  .catch(() => toast.error(t('error.default')))
              }
            >
              <Copy />
            </Button>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <ManagementDialog
            title={t('renameClass')}
            refresh={refresh}
            save={(form) => request(path, 'PATCH', { name: form.get('name') })}
          >
            <Field label={t('className')}>
              <Input
                name='name'
                required
                maxLength={100}
                defaultValue={classroom.name}
              />
            </Field>
          </ManagementDialog>
          <ManagementDialog
            title={t('addStudent')}
            refresh={refresh}
            save={(form) =>
              request(`${path}/students`, 'POST', { email: form.get('email') })
            }
          >
            <Field label={t('email')}>
              <Input name='email' type='email' required />
            </Field>
          </ManagementDialog>
        </div>
      </div>
      <Input
        className='max-w-sm'
        type='search'
        aria-label={t('searchPeople')}
        placeholder={t('searchPeople')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ManagementTable
        rows={rows}
        columns={[
          { accessorKey: 'name', header: t('name') },
          { accessorKey: 'email', header: t('email') },
          {
            id: 'actions',
            header: t('actions'),
            cell: ({ row }) => (
              <ManagementDialog
                title={t('removeStudent')}
                confirm={t('removeStudentConfirm', { name: row.original.name })}
                destructive
                refresh={refresh}
                save={() =>
                  request(
                    `${path}/students/${encodeURIComponent(row.original.id)}`,
                    'DELETE',
                    { confirmed: true }
                  )
                }
              />
            ),
          },
        ]}
      />
    </>
  )
}
