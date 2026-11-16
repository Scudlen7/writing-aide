import { createFileRoute } from '@tanstack/react-router'
import { WritingDashboard } from '@/features/writing/dashboard'

export const Route = createFileRoute('/_authenticated/')({
  component: function DashboardRoute() {
    return <WritingDashboard person={Route.useRouteContext().person} />
  },
})
