import { createFileRoute } from '@tanstack/react-router'
import { ProfileSettings } from '@/features/writing/settings'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: function ProfileRoute() {
    return <ProfileSettings person={Route.useRouteContext().person} />
  },
})
