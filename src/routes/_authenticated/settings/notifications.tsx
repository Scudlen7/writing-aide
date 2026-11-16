import { createFileRoute } from '@tanstack/react-router'
import { NotificationSettings } from '@/features/writing/settings'

export const Route = createFileRoute('/_authenticated/settings/notifications')({
  component: function NotificationSettingsRoute() {
    return <NotificationSettings person={Route.useRouteContext().person} />
  },
})
