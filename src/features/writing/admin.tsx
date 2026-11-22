import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { roles, type Assignment, type Identity } from '@writing/writing'
import { BookOpen, GraduationCap, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Main } from '@/components/layout/main'
import { classesKey, request } from './api'
import type { ManagedClass } from './classes'
import { AssignmentDialog } from './dashboard'
import { ManagementDialog, ManagementTable, selectField } from './management-ui'
import { Deadline, Field, Problem, Requirements } from './ui'

type DirectoryUser = Identity & { disabled: boolean; createdAt: string }
type DirectoryClass = {
  classroom: ManagedClass
  teacherName: string
  studentCount: number
}
type DirectoryAssignment = Assignment & {
  teacherId: string
  teacherName: string
  assignmentArchived: boolean
  submissionCount: number
  started: boolean
}
type Diagnostics = {
  model: {
    id: string
    task: 'outline' | 'revision' | 'assessment'
    model: string
    outcome: string
    durationMs: number
    createdAt: string
  }[]
  changes: {
    id: string
    actor: string
    action: string
    targetId: string
    createdAt: string
  }[]
}

export function AdminWorkbench({
  section,
}: {
  section?: 'users' | 'classes' | 'assignments'
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const router = useRouter()
  const users = useQuery({
    queryKey: ['writing-admin', 'users'],
    queryFn: () => request<DirectoryUser[]>('/api/admin/users'),
  })
  const classes = useQuery({
    queryKey: ['writing-admin', 'classes'],
    queryFn: () => request<DirectoryClass[]>('/api/admin/classes'),
    enabled: section !== 'users',
  })
  const assignments = useQuery({
    queryKey: ['writing-admin', 'assignments'],
    queryFn: () => request<DirectoryAssignment[]>('/api/admin/assignments'),
    enabled: !section || section === 'assignments',
  })

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['writing-admin'] }),
      client.invalidateQueries({ queryKey: classesKey }),
    ])
  }

  const teachers =
    users.data?.filter(
      (person) => person.role === 'teacher' && !person.disabled
    ) ?? []
  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl space-y-6 px-4 py-7 sm:px-8'
    >
      <h1 className='text-3xl font-semibold tracking-tight'>
        {t(
          section === 'users'
            ? 'userManagement'
            : section === 'classes'
              ? 'classManagement'
              : section === 'assignments'
                ? 'assignmentManagement'
                : 'adminWorkbench'
        )}
      </h1>
      {!section && (
        <div className='grid gap-3 sm:grid-cols-3'>
          {(
            [
              ['userManagement', '/admin/users', Users, users.data?.length],
              [
                'classManagement',
                '/admin/classes',
                GraduationCap,
                classes.data?.length,
              ],
              [
                'assignmentManagement',
                '/admin/assignments',
                BookOpen,
                assignments.data?.length,
              ],
            ] as const
          ).map(([label, path, Icon, total]) => (
            <Link to={path} key={path} className='rounded-xl outline-offset-4'>
              <Card className='gap-2 transition-colors hover:bg-accent/50'>
                <CardHeader className='flex items-center justify-between'>
                  <CardTitle className='text-sm font-medium'>
                    {t(label)}
                  </CardTitle>
                  <Icon size={16} className='text-muted-foreground' />
                </CardHeader>
                <CardContent className='text-2xl font-semibold tabular-nums'>
                  {total ?? '–'}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {!section && <AdminDiagnostics />}
      {section === 'users' && (
        <>
          <QueryStatus query={users} />
          {users.isSuccess && (
            <UsersDirectory
              rows={users.data}
              refresh={async () => {
                await refresh()
                await router.invalidate()
              }}
            />
          )}
        </>
      )}
      {section === 'classes' && (
        <>
          <QueryStatus query={users} />
          <QueryStatus query={classes} />
          {classes.isSuccess && users.isSuccess && (
            <ClassesDirectory
              rows={classes.data}
              teachers={teachers}
              refresh={refresh}
            />
          )}
        </>
      )}
      {section === 'assignments' && (
        <>
          <QueryStatus query={users} />
          <QueryStatus query={classes} />
          <QueryStatus query={assignments} />
          {assignments.isSuccess && classes.isSuccess && users.isSuccess && (
            <AssignmentsDirectory
              rows={assignments.data}
              classes={classes.data}
              teachers={teachers}
              refresh={refresh}
            />
          )}
        </>
      )}
    </Main>
  )
}

function AdminDiagnostics() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const diagnostics = useQuery({
    enabled: open,
    queryKey: ['writing-admin', 'diagnostics'],
    queryFn: () => request<Diagnostics>('/api/admin/diagnostics'),
  })
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className='rounded-xl border bg-card'
    >
      <summary className='cursor-pointer px-4 py-3 font-semibold'>
        {t('adminDiagnostics')}
      </summary>
      {open && (
        <div className='grid gap-4 border-t p-4 text-sm md:grid-cols-2'>
          <QueryStatus query={diagnostics} />
          {diagnostics.data && (
            <>
              <section className='min-w-0 space-y-2'>
                <h2 className='font-medium'>
                  {t('recentModelRequests', {
                    count: diagnostics.data.model.length,
                  })}
                </h2>
                <ul className='space-y-1'>
                  {diagnostics.data.model.map((item) => (
                    <li key={item.id} className='wrap-break-word'>
                      {date.format(new Date(item.createdAt))} ·{' '}
                      {t(`aiTask.${item.task}`)} · {item.model || '—'} ·{' '}
                      {item.outcome === 'success'
                        ? t('modelRequestSuccess')
                        : t([`error.${item.outcome}`, 'error.aiFailed'])}{' '}
                      · {item.durationMs} ms
                    </li>
                  ))}
                </ul>
              </section>
              <section className='min-w-0 space-y-2'>
                <h2 className='font-medium'>
                  {t('recentAdminChanges', {
                    count: diagnostics.data.changes.length,
                  })}
                </h2>
                <ul className='space-y-1'>
                  {diagnostics.data.changes.map((item) => (
                    <li key={item.id} className='wrap-break-word'>
                      {date.format(new Date(item.createdAt))} · {item.actor} ·{' '}
                      {item.action} · {item.targetId}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      )}
    </details>
  )
}

function QueryStatus({
  query,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => Promise<unknown> }
}) {
  const { t } = useTranslation()
  if (query.isPending) return <p role='status'>{t('loading')}</p>
  if (!query.error) return null
  return (
    <div className='space-y-3'>
      <Problem error={query.error} />
      <Button variant='outline' onClick={() => void query.refetch()}>
        {t('retry')}
      </Button>
    </div>
  )
}

function UsersDirectory({
  rows,
  refresh,
}: {
  rows: DirectoryUser[]
  refresh: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const term = search.trim().toLocaleLowerCase()
  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='max-w-sm'
          type='search'
          aria-label={t('searchPeople')}
          placeholder={t('searchPeople')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label={t('role')}
          className={`${selectField} w-auto`}
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value=''>{t('allRoles')}</option>
          {roles.map((item) => (
            <option key={item} value={item}>
              {t(item)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('status')}
          className={`${selectField} w-auto`}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value=''>{t('allStatuses')}</option>
          <option value='active'>{t('active')}</option>
          <option value='disabled'>{t('disabled')}</option>
        </select>
        <ManagementDialog
          title={t('addUser')}
          refresh={refresh}
          save={(form) =>
            request('/api/admin/users', 'POST', Object.fromEntries(form))
          }
        >
          <Field label={t('name')}>
            <Input name='name' required maxLength={100} />
          </Field>
          <Field label={t('email')}>
            <Input name='email' type='email' required />
          </Field>
          <Field label={t('password')}>
            <Input
              name='password'
              type='password'
              autoComplete='new-password'
              minLength={10}
              maxLength={128}
              required
            />
          </Field>
          <Field label={t('role')}>
            <select name='role' className={selectField}>
              <option value='student'>{t('student')}</option>
              <option value='teacher'>{t('teacher')}</option>
            </select>
          </Field>
        </ManagementDialog>
      </div>
      <ManagementTable
        rows={rows.filter(
          (item) =>
            (!role || item.role === role) &&
            (!status || item.disabled === (status === 'disabled')) &&
            (item.name.toLocaleLowerCase().includes(term) ||
              item.email.toLocaleLowerCase().includes(term))
        )}
        columns={[
          { accessorKey: 'name', header: t('name') },
          { accessorKey: 'email', header: t('email') },
          {
            accessorKey: 'role',
            header: t('role'),
            cell: ({ row }) => t(row.original.role),
          },
          {
            accessorKey: 'disabled',
            header: t('status'),
            cell: ({ row }) => (
              <Badge variant='outline'>
                {t(row.original.disabled ? 'disabled' : 'active')}
              </Badge>
            ),
          },
          {
            id: 'actions',
            header: t('actions'),
            cell: ({ row: { original: item } }) => (
              <ManagementDialog
                title={t('manageUser')}
                confirm={t('manageUserConfirm', { name: item.name })}
                refresh={refresh}
                save={(form) =>
                  request(
                    `/api/admin/users/${encodeURIComponent(item.id)}`,
                    'PATCH',
                    {
                      name: form.get('name'),
                      role: form.get('role'),
                      disabled: form.get('status') === 'disabled',
                      confirmed: true,
                    }
                  )
                }
              >
                <p className='text-sm wrap-break-word text-muted-foreground'>
                  {item.email} ·{' '}
                  {t('accountCreatedAt', {
                    date: new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'medium',
                    }).format(new Date(item.createdAt)),
                  })}
                </p>
                <Field label={t('name')}>
                  <Input
                    name='name'
                    required
                    maxLength={100}
                    defaultValue={item.name}
                  />
                </Field>
                <Field label={t('role')}>
                  <select
                    name='role'
                    className={selectField}
                    defaultValue={item.role}
                  >
                    {roles.map((value) => (
                      <option key={value} value={value}>
                        {t(value)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('status')}>
                  <select
                    name='status'
                    className={selectField}
                    defaultValue={item.disabled ? 'disabled' : 'active'}
                  >
                    <option value='active'>{t('active')}</option>
                    <option value='disabled'>{t('disabled')}</option>
                  </select>
                </Field>
              </ManagementDialog>
            ),
          },
        ]}
      />
    </div>
  )
}

function ClassesDirectory({
  rows,
  teachers,
  refresh,
}: {
  rows: DirectoryClass[]
  teachers: DirectoryUser[]
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const term = search.trim().toLocaleLowerCase()
  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='max-w-sm'
          type='search'
          aria-label={t('searchClasses')}
          placeholder={t('searchClasses')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <ManagementDialog
          title={t('addClass')}
          refresh={refresh}
          save={(form) =>
            request('/api/classes', 'POST', Object.fromEntries(form))
          }
        >
          <Field label={t('className')}>
            <Input name='name' required maxLength={100} />
          </Field>
          <TeacherSelect teachers={teachers} />
        </ManagementDialog>
      </div>
      <ManagementTable
        rows={rows.flatMap(({ classroom, teacherName, studentCount }) =>
          classroom.name.toLocaleLowerCase().includes(term) ||
          teacherName.toLocaleLowerCase().includes(term)
            ? [{ ...classroom, teacherName, studentCount }]
            : []
        )}
        columns={[
          {
            accessorKey: 'name',
            header: t('className'),
            cell: ({ row: { original: item } }) => (
              <Link
                to='/classes/$classId'
                params={{ classId: item.id }}
                className='font-medium hover:underline'
              >
                {item.name}
              </Link>
            ),
          },
          { accessorKey: 'teacherName', header: t('teacher') },
          { accessorKey: 'studentCount', header: t('students') },
          {
            accessorKey: 'archived',
            header: t('status'),
            cell: ({ row }) => t(row.original.archived ? 'archived' : 'active'),
          },
          {
            id: 'actions',
            header: t('actions'),
            cell: ({ row: { original: item } }) => (
              <ManagementDialog
                title={t('manageClass')}
                confirm={t('manageClassConfirm', { name: item.name })}
                refresh={refresh}
                save={(form) =>
                  request(`/api/admin/classes/${item.id}`, 'PATCH', {
                    teacherId: form.get('teacherId'),
                    archived: form.get('status') === 'archived',
                    confirmed: true,
                  })
                }
              >
                <TeacherSelect teachers={teachers} initial={item.teacherId} />
                <Field label={t('status')}>
                  <select
                    name='status'
                    className={selectField}
                    defaultValue={item.archived ? 'archived' : 'active'}
                  >
                    <option value='active'>{t('active')}</option>
                    <option value='archived'>{t('archived')}</option>
                  </select>
                </Field>
              </ManagementDialog>
            ),
          },
        ]}
      />
    </div>
  )
}

function TeacherSelect({
  teachers,
  initial = '',
}: {
  teachers: DirectoryUser[]
  initial?: string
}) {
  const { t } = useTranslation()
  return (
    <Field label={t('teacher')}>
      <select
        name='teacherId'
        required
        className={selectField}
        defaultValue={initial}
      >
        <option value='' disabled>
          {t('chooseTeacher')}
        </option>
        {teachers.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · {item.email}
          </option>
        ))}
      </select>
    </Field>
  )
}

function AssignmentsDirectory({
  rows,
  classes,
  teachers,
  refresh,
}: {
  rows: DirectoryAssignment[]
  classes: DirectoryClass[]
  teachers: DirectoryUser[]
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [classId, setClass] = useState('')
  const [teacherId, setTeacher] = useState('')
  const [status, setStatus] = useState('')
  const [now] = useState(Date.now)
  const stateOf = (item: DirectoryAssignment) =>
    item.archived
      ? 'archived'
      : new Date(item.dueAt).getTime() <= now
        ? 'overdue'
        : 'active'
  return (
    <div className='space-y-3'>
      <div className='grid gap-2 sm:grid-cols-3'>
        <select
          aria-label={t('classroom')}
          className={selectField}
          value={classId}
          onChange={(event) => setClass(event.target.value)}
        >
          <option value=''>{t('allClasses')}</option>
          {classes.map(({ classroom }) => (
            <option key={classroom.id} value={classroom.id}>
              {classroom.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('teacher')}
          className={selectField}
          value={teacherId}
          onChange={(event) => setTeacher(event.target.value)}
        >
          <option value=''>{t('allTeachers')}</option>
          {teachers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('status')}
          className={selectField}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value=''>{t('allStatuses')}</option>
          {['active', 'overdue', 'archived'].map((item) => (
            <option key={item} value={item}>
              {t(item)}
            </option>
          ))}
        </select>
      </div>
      <ManagementTable
        rows={rows.filter(
          (item) =>
            (!classId || item.classroomId === classId) &&
            (!teacherId || item.teacherId === teacherId) &&
            (!status || stateOf(item) === status)
        )}
        columns={[
          {
            accessorKey: 'title',
            header: t('assignmentTitle'),
            cell: ({ row }) => (
              <details className='min-w-40 whitespace-normal'>
                <summary className='cursor-pointer font-medium'>
                  {row.original.title}
                </summary>
                <div className='mt-2 space-y-2'>
                  <Deadline dueAt={row.original.dueAt} />
                  <Requirements assignment={row.original} open />
                </div>
              </details>
            ),
          },
          { accessorKey: 'classroomName', header: t('classroom') },
          { accessorKey: 'teacherName', header: t('teacher') },
          { accessorKey: 'submissionCount', header: t('submissions') },
          {
            id: 'status',
            header: t('status'),
            cell: ({ row }) => t(stateOf(row.original)),
          },
          {
            id: 'actions',
            header: t('actions'),
            cell: ({ row: { original: item } }) => (
              <div className='flex flex-wrap items-center gap-2'>
                <AssignmentDialog
                  mode='edit'
                  initial={item}
                  frozen={item.started}
                  onSaved={refresh}
                  classes={[{ id: item.classroomId, name: item.classroomName }]}
                />
                <ManagementDialog
                  title={t(item.assignmentArchived ? 'restore' : 'archive')}
                  confirm={t(
                    item.assignmentArchived
                      ? 'restoreAssignmentConfirm'
                      : 'archiveAssignmentConfirm',
                    { name: item.title }
                  )}
                  destructive={!item.assignmentArchived}
                  refresh={refresh}
                  save={() =>
                    request(`/api/admin/assignments/${item.id}`, 'PATCH', {
                      archived: !item.assignmentArchived,
                      confirmed: true,
                    })
                  }
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
