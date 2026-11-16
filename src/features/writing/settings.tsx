import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import type { Identity } from '@writing/writing'
import { Bell, KeyRound, Palette, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Main } from '@/components/layout/main'
import { ContentSection } from '@/features/settings/components/content-section'
import { SidebarNav } from '@/features/settings/components/sidebar-nav'
import { identityKey, request } from './api'
import { Field, Problem } from './ui'

const fieldSelect =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export function WritingSettings() {
  const { t } = useTranslation()
  const items = [
    { href: '/settings', title: t('profile'), icon: <UserRound size={16} /> },
    {
      href: '/settings/account',
      title: t('account'),
      icon: <KeyRound size={16} />,
    },
    {
      href: '/settings/appearance',
      title: t('appearance'),
      icon: <Palette size={16} />,
    },
    {
      href: '/settings/notifications',
      title: t('notifications'),
      icon: <Bell size={16} />,
    },
  ]
  return (
    <Main
      id='writing-main'
      fluid
      className='mx-auto w-full max-w-6xl px-4 py-7 sm:px-8'
    >
      <h1 className='text-3xl font-semibold tracking-tight'>
        {t('personalSettings')}
      </h1>
      <Separator className='my-5' />
      <div className='flex flex-col gap-4 lg:flex-row lg:gap-10'>
        <aside className='lg:w-1/5'>
          <SidebarNav items={items} label={t('personalSettings')} />
        </aside>
        <div className='flex min-w-0 flex-1 p-1'>
          <Outlet />
        </div>
      </div>
    </Main>
  )
}

export function ProfileSettings({ person }: { person: Identity }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = new FormData(event.currentTarget).get('name')
    setPending(true)
    setError(null)
    try {
      const result = await request<Identity>('/api/me', 'PATCH', { name })
      client.setQueryData(identityKey(person.id), result)
      toast.success(t('saved'))
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }
  return (
    <ContentSection title={t('profile')}>
      <form className='grid gap-4' onSubmit={(event) => void save(event)}>
        <Field label={t('name')}>
          <Input
            name='name'
            defaultValue={person.name}
            required
            maxLength={100}
            autoComplete='name'
          />
        </Field>
        <Field label={t('email')}>
          <Input readOnly value={person.email} />
        </Field>
        <Field label={t('role')}>
          <Input readOnly value={t(person.role)} />
        </Field>
        <Problem error={error} />
        <Button className='justify-self-start' disabled={pending}>
          {t(pending ? 'saving' : 'saveChanges')}
        </Button>
      </form>
    </ContentSection>
  )
}

export function PasswordSettings() {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = Object.fromEntries(new FormData(form))
    setPending(true)
    setError(null)
    try {
      await request('/api/auth/change-password', 'POST', {
        ...fields,
        revokeOtherSessions: true,
      })
      form.reset()
      toast.success(t('passwordUpdated'))
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }
  return (
    <ContentSection title={t('account')}>
      <form className='grid gap-4' onSubmit={(event) => void save(event)}>
        <Field label={t('currentPassword')}>
          <Input
            name='currentPassword'
            type='password'
            required
            autoComplete='current-password'
          />
        </Field>
        <Field label={t('newPassword')}>
          <Input
            name='newPassword'
            type='password'
            required
            minLength={10}
            maxLength={128}
            autoComplete='new-password'
          />
        </Field>
        <Problem error={error} fallback='changePassword' />
        <Button className='justify-self-start' disabled={pending}>
          {t(pending ? 'saving' : 'changePassword')}
        </Button>
      </form>
    </ContentSection>
  )
}

export function AppearanceSettings() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  return (
    <ContentSection title={t('appearance')}>
      <div className='grid gap-4'>
        <Field label={t('language')}>
          <select
            className={fieldSelect}
            value={i18n.language}
            onChange={(event) => void i18n.changeLanguage(event.target.value)}
          >
            <option lang='zh-CN' value='zh-CN'>
              简体中文
            </option>
            <option lang='en' value='en'>
              English
            </option>
          </select>
        </Field>
        <Field label={t('theme')}>
          <select
            className={fieldSelect}
            value={theme}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'light' || value === 'dark' || value === 'system')
                setTheme(value)
            }}
          >
            {(['light', 'dark', 'system'] as const).map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </ContentSection>
  )
}

export function NotificationSettings({ person }: { person: Identity }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [notify, setNotify] = useState(person.submissionNotifications)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function save(value: boolean) {
    setPending(true)
    setError(null)
    try {
      const result = await request<Identity>('/api/me', 'PATCH', {
        submissionNotifications: value,
      })
      setNotify(result.submissionNotifications)
      client.setQueryData(identityKey(person.id), result)
      toast.success(t('saved'))
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }
  return (
    <ContentSection title={t('notifications')}>
      <div className='grid gap-4'>
        {person.role === 'teacher' ? (
          <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm font-medium'>
            {t('submissionNotifications')}
            <Switch
              checked={notify}
              disabled={pending}
              onCheckedChange={(value) => void save(value)}
            />
          </label>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t(
              person.role === 'student'
                ? 'studentNotifications'
                : 'noNotificationSettings'
            )}
          </p>
        )}
        <Problem error={error} />
      </div>
    </ContentSection>
  )
}
