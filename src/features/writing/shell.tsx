import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouter } from '@tanstack/react-router'
import type { Identity } from '@writing/writing'
import { BookOpen, LayoutGrid, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Header } from '@/components/layout/header'
import { request } from './api'
import { LanguageSwitch, Problem, WritingThemeSwitch } from './ui'

export function WritingShell({ person }: { person: Identity }) {
  const { t } = useTranslation()
  const router = useRouter()
  const queries = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    setError(null)
    try {
      await request('/api/auth/sign-out', 'POST', {})
      queries.clear()
      await router.navigate({
        to: '/sign-in',
        replace: true,
        ignoreBlocker: true,
      })
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  return (
    <SidebarProvider className='writing-app'>
      <a
        className='sr-only focus:not-sr-only focus:absolute focus:z-60 focus:bg-background focus:p-2'
        href='#writing-main'
      >
        {t('skipToMain')}
      </a>
      <Sidebar collapsible='icon' className='border-r'>
        <SidebarHeader className='px-3 py-5'>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size='lg'>
                <Link to='/' className='font-semibold'>
                  <span className='grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground'>
                    <BookOpen size={17} />
                  </span>
                  <span className='truncate'>{t('brand')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className='px-3'>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive tooltip={t('home')}>
                <Link to='/'>
                  <LayoutGrid />
                  {t('home')}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className='border-t px-3 py-4'>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size='lg' asChild>
                <div>
                  <span className='grid size-8 shrink-0 place-items-center rounded-full bg-muted font-medium'>
                    {Array.from(person.name)[0]?.toUpperCase()}
                  </span>
                  <div className='grid min-w-0 text-start'>
                    <span className='truncate font-medium'>{person.name}</span>
                    <span className='text-xs text-muted-foreground'>
                      {t(person.role)}
                    </span>
                  </div>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className='@container/content min-w-0 bg-background'>
        <Header className='border-b bg-card' triggerLabel={t('toggleSidebar')}>
          <span className='hidden font-medium sm:inline'>{t('home')}</span>
          <div className='ms-auto flex items-center gap-1 sm:gap-2'>
            <LanguageSwitch />
            <WritingThemeSwitch />
            <Button
              variant='ghost'
              size='icon'
              disabled={pending}
              aria-label={t('signOut')}
              title={t('signOut')}
              onClick={() => void signOut()}
            >
              <LogOut />
            </Button>
          </div>
        </Header>
        {error != null && (
          <div className='mx-auto mt-4 w-full max-w-6xl px-4'>
            <Problem error={error} />
          </div>
        )}
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
