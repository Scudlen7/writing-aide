import { createFileRoute } from '@tanstack/react-router'
import { RequestError } from '@/features/writing/api'
import { ClassPage } from '@/features/writing/classes'

export const Route = createFileRoute('/_authenticated/classes/$classId')({
  beforeLoad: ({ context }) => {
    if (context.person.role === 'student')
      throw new RequestError(403, 'forbidden')
  },
  component: function ClassRoute() {
    const { classId } = Route.useParams()
    const { person } = Route.useRouteContext()
    return <ClassPage key={classId} classId={classId} person={person} />
  },
})
