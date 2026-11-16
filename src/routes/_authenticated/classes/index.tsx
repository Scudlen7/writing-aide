import { createFileRoute } from '@tanstack/react-router'
import { RequestError } from '@/features/writing/api'
import { WritingDashboard } from '@/features/writing/dashboard'

export const Route = createFileRoute('/_authenticated/classes/')({
  beforeLoad: ({ context }) => {
    if (context.person.role !== 'teacher')
      throw new RequestError(403, 'forbidden')
  },
  component: function TeacherClassesRoute() {
    return (
      <WritingDashboard person={Route.useRouteContext().person} classesOnly />
    )
  },
})
