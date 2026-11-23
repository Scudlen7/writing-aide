import { useEffect, useState, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  useLocation,
  useMatch,
  useRouter,
} from '@tanstack/react-router'
import type { Identity } from '@writing/writing'
import {
  ArrowLeft,
  Bell,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  LayoutGrid,
  LogOut,
  MessagesSquare,
  Settings,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { NavGroup } from '@/components/layout/nav-group'
import { NavUser } from '@/components/layout/nav-user'
import type { NavLink } from '@/components/layout/types'
import { chatUnreadOptions } from '@/features/chats/api'
import { DocumentToolSlot } from '@/features/documents/document-tool-slot'
import {
  dashboardOptions,
  identityKey,
  notificationsKey,
  request,
  session,
} from './api'
import { LanguageSwitch, Problem, WritingThemeSwitch } from './ui'

export function WritingShell({ person }: { person: Identity }) {
  const { t } = useTranslation()
  const assignment = useMatch({
    from: '/_authenticated/assignments/$assignmentId/',
    shouldThrow: false,
  })
  const section = useLocation({
    select: ({ pathname }) => pathname.split('/')[1],
  })
  const [summarySlot, setSummarySlot] = useState<HTMLDivElement | null>(null)

  if (section === 'documents' || section === 'review-discussions') {
    return (
      <DocumentToolSlot value={summarySlot}>
        <div className='writing-app @container/content flex min-h-dvh flex-col bg-background'>
          <SkipToMain />
          <WritingHeader
            personalSection={section}
            showSidebarTrigger={false}
            summarySlotRef={setSummarySlot}
          />
          <Outlet />
        </div>
      </DocumentToolSlot>
    )
  }

  if (person.role === 'student' && assignment) {
    return (
      <div className='writing-app flex min-h-dvh flex-col bg-background lg:h-dvh lg:min-h-[36rem]'>
        <SkipToMain />
        <WritingHeader
          title={t('writingWorkspace')}
          showSidebarTrigger={false}
        />
        <Outlet />
      </div>
    )
  }

  return <CourseShell person={person} />
}

function SkipToMain() {
  const { t } = useTranslation()
  return (
    <a
      className='sr-only focus:not-sr-only focus:absolute focus:z-60 focus:bg-background focus:p-2'
      href='#writing-main'
    >
      {t('skipToMain')}
    </a>
  )
}

function WritingHeader({
  title,
  showSidebarTrigger,
  personalSection,
  summarySlotRef,
}: {
  title?: string
  showSidebarTrigger?: boolean
  personalSection?: 'documents' | 'review-discussions'
  summarySlotRef?: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()
  return (
    <Header
      fixed={Boolean(personalSection)}
      className={cn(
        'shrink-0 border-b bg-card',
        personalSection && 'h-auto sm:h-16 [&>div]:flex-wrap [&>div]:gap-y-2'
      )}
      triggerLabel={t('toggleSidebar')}
      showSidebarTrigger={showSidebarTrigger}
    >
      {personalSection ? (
        <>
          <Button asChild variant='ghost' size='icon' className='shrink-0'>
            <Link to='/' aria-label={t('documents.backToWorkspace')}>
              <ArrowLeft />
            </Link>
          </Button>
          <nav
            aria-label={t('documents.personal')}
            className='order-last flex basis-full gap-1 sm:order-none sm:basis-auto'
          >
            <Button
              asChild
              size='sm'
              variant={personalSection === 'documents' ? 'secondary' : 'ghost'}
            >
              <Link
                to='/documents'
                aria-current={
                  personalSection === 'documents' ? 'location' : undefined
                }
              >
                {t('documents.title')}
              </Link>
            </Button>
            <Button
              asChild
              size='sm'
              variant={
                personalSection === 'review-discussions' ? 'secondary' : 'ghost'
              }
            >
              <Link
                to='/review-discussions'
                aria-current={
                  personalSection === 'review-discussions'
                    ? 'location'
                    : undefined
                }
              >
                {t('documents.reviewInbox')}
              </Link>
            </Button>
          </nav>
        </>
      ) : (
        <span className='hidden font-medium sm:inline'>{title}</span>
      )}
      <div className='ms-auto flex items-center gap-1 sm:gap-2'>
        <LanguageSwitch />
        <WritingThemeSwitch />
        {personalSection && (
          <div ref={summarySlotRef} className='empty:hidden' />
        )}
      </div>
    </Header>
  )
}

function CourseShell({ person }: { person: Identity }) {
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
      <SkipToMain />
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
          <WritingNavigation person={person} />
          <NavGroup
            title={t('documents.personal')}
            items={[
              {
                title: t('documents.title'),
                url: '/documents',
                icon: BookOpen,
                activePrefix: '/documents',
              },
              {
                title: t('documents.reviewInbox'),
                url: '/review-discussions',
                icon: MessagesSquare,
                activePrefix: '/review-discussions',
              },
            ]}
          />
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
        <WritingHeader
          title={t(pathname.replace(/\/$/, '') === '/chats' ? 'chats' : home)}
        />
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

function WritingNavigation({ person }: { person: Identity }) {
  const { t } = useTranslation()
  const unread = useQuery({
    ...chatUnreadOptions(person.id),
    enabled: person.role !== 'admin',
  })
  const chatLink: NavLink = {
    title: t('chats'),
    url: '/chats',
    icon: MessagesSquare,
    badge:
      unread.isSuccess && unread.data.count
        ? String(unread.data.count)
        : undefined,
  }
  if (person.role === 'admin') {
    return (
      <>
        <NavGroup
          title={t('overviewNavigation')}
          items={[
            { title: t('adminWorkbench'), url: '/admin', icon: LayoutGrid },
          ]}
        />
        <NavGroup
          title={t('platformManagement')}
          items={[
            { title: t('userManagement'), url: '/admin/users', icon: Users },
            {
              title: t('classManagement'),
              url: '/admin/classes',
              icon: GraduationCap,
              activePrefix: '/classes',
            },
            {
              title: t('assignmentManagement'),
              url: '/admin/assignments',
              icon: BookOpen,
            },
          ]}
        />
      </>
    )
  }
  if (person.role === 'teacher') {
    return (
      <NavGroup
        title={t('teachingNavigation')}
        items={[
          { title: t('home'), url: '/', icon: LayoutGrid },
          {
            title: t('classManagement'),
            url: '/classes',
            icon: GraduationCap,
            activePrefix: '/classes',
          },
          {
            title: t('gradingQueue'),
            url: '/grading',
            icon: ClipboardCheck,
            activePrefix: '/assignments',
          },
          chatLink,
        ]}
      />
    )
  }
  return <StudentNavigation personId={person.id} chatLink={chatLink} />
}

function StudentNavigation({
  personId,
  chatLink,
}: {
  personId: string
  chatLink: NavLink
}) {
  const { t } = useTranslation()
  const dashboard = useQuery(dashboardOptions(personId))
  return (
    <NavGroup
      title={t('courseNavigation')}
      items={[
        { title: t('home'), url: '/', icon: LayoutGrid },
        {
          title: t('yourAssignments'),
          icon: BookOpen,
          activePrefix: '/assignments',
          items: dashboard.isSuccess
            ? dashboard.data.assignments.map((assignment) => ({
                title: assignment.title,
                url: `/assignments/${assignment.id}`,
              }))
            : [],
          emptyLabel: t(
            dashboard.isPending
              ? 'loading'
              : dashboard.isError
                ? 'assignmentsUnavailable'
                : 'noStudentAssignments'
          ),
        },
        chatLink,
      ]}
    />
  )
}

function CloseSidebarOnNavigation({ pathname }: { pathname: string }) {
  const { setOpenMobile } = useSidebar()
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])
  return null
}
