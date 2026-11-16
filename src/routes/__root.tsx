import { type QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { WritingRouteProblem } from '@/features/writing/ui'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: ({ location }) => {
    const path = location.pathname.replace(/\/$/, '') || '/'
    if (
      ![
        '/',
        '/sign-in',
        '/sign-up',
        '/admin',
        '/admin/users',
        '/admin/classes',
        '/admin/assignments',
        '/classes',
        '/grading',
        '/chats',
        '/notifications',
        '/settings',
        '/settings/account',
        '/settings/appearance',
        '/settings/notifications',
      ].includes(path) &&
      !path.startsWith('/assignments/') &&
      !path.startsWith('/classes/')
    ) {
      throw redirect({ to: '/' })
    }
  },
  component: () => {
    return (
      <>
        <NavigationProgress />
        <Outlet />
        <Toaster duration={5000} />
        {import.meta.env.DEV &&
          import.meta.env.VITE_SHOW_DEVTOOLS === 'true' && (
            <>
              <ReactQueryDevtools buttonPosition='bottom-left' />
              <TanStackRouterDevtools position='bottom-right' />
            </>
          )}
      </>
    )
  },
  notFoundComponent: () => <WritingRouteProblem />,
  errorComponent: WritingRouteProblem,
})
