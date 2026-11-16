import { createFileRoute } from '@tanstack/react-router'
import { request, type AssignmentDetail } from '@/features/writing/api'
import { AssignmentPage } from '@/features/writing/assignment'

export const Route = createFileRoute(
  '/_authenticated/assignments/$assignmentId/'
)({
  loader: ({ params }) =>
    request<AssignmentDetail>(`/api/assignments/${params.assignmentId}`),
  gcTime: 0,
  component: function AssignmentRoute() {
    return (
      <AssignmentPage
        detail={Route.useLoaderData()}
        person={Route.useRouteContext().person}
      />
    )
  },
})
