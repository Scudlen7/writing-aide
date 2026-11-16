import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useLocation, useRouter } from '@tanstack/react-router'
import type { Identity } from '@writing/writing'
import { Bell, BookOpen, LayoutGrid, LogOut, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
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
  useSidebar,
} from '@/components/ui/sidebar'
import { Header } from '@/components/layout/header'
import { NavUser } from '@/components/layout/nav-user'
import { identityKey, notificationsKey, request, session } from './api'
import { LanguageSwitch, Problem, WritingThemeSwitch } from './ui'

export function WritingShell({ person }: { person: Identity }) {
  const { t } = useTranslation()
  const router = useRouter()
  const queries = useQueryClient()
  const pathname = useLocation({ select: (location) => location.pathname })
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  const account = useQuery({
    queryKey: identityKey(person.id),
    queryFn: session,
    initialData: person,
  })
  const unread = useQuery({
    queryKey: [...notificationsKey(person.id), 'unread'],
    queryFn: () => request<{ count: number }>('/api/notifications/unread'),
    refetchInterval: 30000,
    refetchOnWindowFocus: 'always',
    refetchOnMount: 'always',
  })
  const home = person.role === 'admin' ? 'adminWorkbench' : 'home'
  const { refetch: refreshUnread } = unread

  useEffect(() => {
    if (pathname === '/' || pathname === '/admin') void refreshUnread()
  }, [pathname, refreshUnread])

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
      <CloseSidebarOnNavigation pathname={pathname} />
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
              <SidebarMenuButton asChild tooltip={t(home)}>
                <Link to='/'>
                  <LayoutGrid />
                  {t(home)}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className='border-t px-3 py-4'>
          <NavUser
            user={{
              name: account.data.name,
              email: account.data.email,
              avatar: account.data.image ?? '',
            }}
            label={t('accountMenu')}
            role={t(account.data.role)}
            menu={
              <>
                <DropdownMenuItem asChild>
                  <Link to='/settings'>
                    <Settings />
                    {t('personalSettings')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to='/notifications'>
                    <Bell />
                    {t('notifications')}
                    {Boolean(unread.data?.count) && (
                      <Badge variant='secondary' className='ms-auto'>
                        {unread.data?.count}
                      </Badge>
                    )}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant='destructive'
                  disabled={pending}
                  onSelect={() => void signOut()}
                >
                  <LogOut />
                  {t('signOut')}
                </DropdownMenuItem>
              </>
            }
          />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className='@container/content min-w-0 bg-background'>
        <Header className='border-b bg-card' triggerLabel={t('toggleSidebar')}>
          <span className='hidden font-medium sm:inline'>{t(home)}</span>
          <div className='ms-auto flex items-center gap-1 sm:gap-2'>
            <LanguageSwitch />
            <WritingThemeSwitch />
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

function CloseSidebarOnNavigation({ pathname }: { pathname: string }) {
  const { setOpenMobile } = useSidebar()
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])
  return null
}
