import { createFileRoute } from '@tanstack/react-router'
import { RequestError } from '@/features/writing/api'
import { GradingQueue } from '@/features/writing/grading-queue'

export const Route = createFileRoute('/_authenticated/grading')({
  beforeLoad: ({ context }) => {
    if (context.person.role !== 'teacher')
      throw new RequestError(403, 'forbidden')
  },
  component: function TeacherGradingRoute() {
    return <GradingQueue personId={Route.useRouteContext().person.id} />
  },
})
