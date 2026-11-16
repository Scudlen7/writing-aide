import { createFileRoute, redirect } from '@tanstack/react-router'
import { WritingDashboard } from '@/features/writing/dashboard'

export const Route = createFileRoute('/_authenticated/')({
  beforeLoad: ({ context }) => {
    if (context.person.role === 'admin') throw redirect({ to: '/admin' })
  },
  component: function DashboardRoute() {
    return <WritingDashboard person={Route.useRouteContext().person} />
  },
})
