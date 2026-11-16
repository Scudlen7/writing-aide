import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { Assignment, Language, Submission } from '@writing/writing'
import { Check, Languages, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/context/theme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RequestError } from './api'

export function LanguageSwitch() {
  const { t, i18n } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' aria-label={t('language')}>
          <Languages />
          {i18n.language === 'en' ? 'English' : '简体中文'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {(['zh-CN', 'en'] as const).map((option) => (
          <DropdownMenuItem
            key={option}
            lang={option}
            onSelect={() => void i18n.changeLanguage(option)}
          >
            {option === 'en' ? 'English' : '简体中文'}
            {i18n.language === option && <Check className='ms-auto' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WritingThemeSwitch() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' aria-label={t('theme')}>
          <Sun className='dark:hidden' />
          <Moon className='hidden dark:block' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {(['light', 'dark', 'system'] as const).map((option) => (
          <DropdownMenuItem key={option} onSelect={() => setTheme(option)}>
            {t(option)} {theme === option && <Check className='ms-auto' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className='grid gap-2 text-sm font-medium'>
      {label}
      {children}
    </label>
  )
}

export function Problem({
  error,
  fallback = 'default',
}: {
  error: unknown
  fallback?: string
}) {
  const { t } = useTranslation()
  if (!error) return null
  const code = error instanceof RequestError ? error.code : fallback
  return (
    <p
      className='rounded-md bg-destructive/10 p-3 text-sm text-destructive'
      role='alert'
    >
      {t([`error.${code}`, `error.${fallback}`])}
    </p>
  )
}

export function WritingRouteProblem({
  error,
  reset,
}: {
  error?: unknown
  reset?: () => void
}) {
  const { t } = useTranslation()
  const forbidden =
    error instanceof RequestError &&
    (error.status === 403 || error.status === 404)
  return (
    <main
      id='writing-main'
      className='mx-auto grid w-full max-w-lg gap-4 px-5 py-12'
    >
      <Problem error={error ?? new RequestError(404, 'notFound')} />
      <div className='flex flex-wrap gap-2'>
        <Button variant='outline' asChild>
          <Link to='/'>{t('back')}</Link>
        </Button>
        {reset && !forbidden && <Button onClick={reset}>{t('retry')}</Button>}
      </div>
    </main>
  )
}

export function PaperLanguage({ language }: { language: Language }) {
  const { t } = useTranslation()
  return (
    <Badge variant='secondary'>
      {t(language === 'en' ? 'english' : 'chinese')}
    </Badge>
  )
}

export function Deadline({ dueAt }: { dueAt: string }) {
  const { t, i18n } = useTranslation()
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dueAt))
  return (
    <span>
      {t('due')} · <time dateTime={dueAt}>{date}</time>
    </span>
  )
}

export function StatusBadge({
  status,
  dueAt,
}: {
  status: Submission['status'] | null
  dueAt: string
}) {
  const { t } = useTranslation()
  const [now] = useState(Date.now)
  if (status === 'graded')
    return (
      <Badge className='border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100'>
        {t('graded')}
      </Badge>
    )
  if (status === 'submitted')
    return <Badge variant='secondary'>{t('submitted')}</Badge>
  if (new Date(dueAt).getTime() <= now)
    return <Badge variant='secondary'>{t('overdue')}</Badge>
  return (
    <Badge variant='outline'>
      {t(status === 'draft' ? 'draftStatus' : 'notStarted')}
    </Badge>
  )
}

export function Requirements({
  assignment,
  open = false,
}: {
  assignment: Assignment
  open?: boolean
}) {
  const { t } = useTranslation()
  const unit = t(assignment.language === 'en' ? 'words' : 'characters')
  return (
    <details open={open || undefined} className='rounded-xl border bg-card'>
      <summary className='cursor-pointer px-4 py-3 text-sm font-semibold'>
        {t('instructions')}
      </summary>
      <div className='space-y-4 border-t p-4 text-sm'>
        <p className='wrap-break-word whitespace-pre-wrap'>
          {assignment.instructions}
        </p>
        <div>
          <p className='font-medium'>
            {t('lengthRule', {
              min: assignment.minLength,
              max: assignment.maxLength,
              unit,
            })}
          </p>
          <p className='text-xs text-muted-foreground'>
            {t(assignment.language === 'en' ? 'countRuleEn' : 'countRuleZh')}
          </p>
        </div>
        <h3 className='font-semibold'>{t('rubric')}</h3>
        <ul className='space-y-2'>
          {assignment.rubric.map((item, index) => (
            <li key={index}>
              <div className='flex justify-between gap-3'>
                <span className='font-medium break-all'>{item.label}</span>
                <span>{item.max}</span>
              </div>
              {item.description && (
                <p className='wrap-break-word whitespace-pre-wrap text-muted-foreground'>
                  {item.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
