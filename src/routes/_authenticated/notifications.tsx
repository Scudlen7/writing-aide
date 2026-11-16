import { createFileRoute } from '@tanstack/react-router'
import { NotificationsPage } from '@/features/writing/notifications'

export const Route = createFileRoute('/_authenticated/notifications')({
  component: function NotificationsRoute() {
    return <NotificationsPage person={Route.useRouteContext().person} />
  },
})
