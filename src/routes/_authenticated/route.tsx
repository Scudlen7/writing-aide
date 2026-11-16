import { createFileRoute, redirect } from '@tanstack/react-router'
import { RequestError, session } from '@/features/writing/api'
import { WritingShell } from '@/features/writing/shell'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    try {
      return { person: await session() }
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) {
        throw redirect({
          to: '/sign-in',
          search: { redirect: location.pathname },
          replace: true,
        })
      }
      throw error
    }
  },
  component: function AuthenticatedRoute() {
    return <WritingShell person={Route.useRouteContext().person} />
  },
})
