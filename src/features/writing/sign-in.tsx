import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { request } from './api'
import { Field, LanguageSwitch, Problem, WritingThemeSwitch } from './ui'

export function WritingSignIn({
  register = false,
  redirectTo,
}: {
  register?: boolean
  redirectTo?: string
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(form: HTMLFormElement) {
    setPending(true)
    setError(null)
    try {
      await request(
        register ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email',
        'POST',
        Object.fromEntries(new FormData(form))
      )
      const validPath =
        redirectTo &&
        /^\/assignments\/[\da-f-]+\/?(?:submissions\/[\da-f-]+\/?)?$/i.test(
          redirectTo
        )
      await router.navigate({
        href: validPath ? redirectTo : '/',
        replace: true,
      })
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className='writing-app grid min-h-svh bg-background lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]'>
      <div className='relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-12 text-slate-50 lg:flex'>
        <div className='pointer-events-none absolute -end-28 bottom-4 size-[35rem] rounded-full bg-sky-500/20 blur-[125px]' />
        <span className='relative flex items-center gap-3 text-lg font-semibold'>
          <BookOpen />
          {t('brand')}
        </span>
        <div className='relative max-w-xl py-16'>
          <p className='text-5xl leading-[1.14] font-semibold tracking-tight xl:text-6xl'>
            {t('welcome')}
          </p>
          <p className='mt-5 max-w-sm text-base leading-7 text-slate-300'>
            {t('welcomeBody')}
          </p>
        </div>
        <div className='relative h-px max-w-xs bg-slate-600' />
      </div>
      <div className='flex min-h-svh flex-col'>
        <header className='flex items-center justify-end gap-2 p-5 sm:p-7'>
          <span className='me-auto flex items-center gap-2 font-semibold lg:hidden'>
            <BookOpen size={20} />
            {t('brand')}
          </span>
          <LanguageSwitch />
          <WritingThemeSwitch />
        </header>
        <main className='m-auto w-full max-w-md px-6 py-12'>
          <h1 className='mb-7 text-3xl font-semibold tracking-tight'>
            {t(register ? 'signUp' : 'signIn')}
          </h1>
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault()
              void submit(event.currentTarget)
            }}
          >
            {register && (
              <Field label={t('name')}>
                <Input
                  name='name'
                  required
                  maxLength={100}
                  autoComplete='name'
                />
              </Field>
            )}
            <Field label={t('email')}>
              <Input
                type='email'
                name='email'
                required
                maxLength={254}
                autoComplete='email'
              />
            </Field>
            <Field label={t('password')}>
              <Input
                type='password'
                name='password'
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={register ? 10 : undefined}
                maxLength={128}
              />
            </Field>
            {register && (
              <p className='text-xs text-muted-foreground'>
                {t('passwordHint')}
              </p>
            )}
            <Problem error={error} fallback={register ? 'signup' : 'login'} />
            <Button className='w-full' type='submit' disabled={pending}>
              {pending
                ? t('loading')
                : t(register ? 'createAccount' : 'signIn')}
            </Button>
          </form>
          <p className='mt-6 text-sm text-muted-foreground'>
            {t(register ? 'haveAccount' : 'needAccount')}{' '}
            <Link
              className='font-medium text-foreground underline underline-offset-4'
              to={register ? '/sign-in' : '/sign-up'}
            >
              {t(register ? 'signIn' : 'signUp')}
            </Link>
          </p>
        </main>
      </div>
    </div>
  )
}
