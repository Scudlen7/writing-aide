import { createFileRoute } from '@tanstack/react-router'
import { request, type GradingDetail } from '@/features/writing/api'
import { GradingPage } from '@/features/writing/grading'

export const Route = createFileRoute(
  '/_authenticated/assignments/$assignmentId/submissions/$submissionId'
)({
  loader: ({ params }) =>
    request<GradingDetail>(
      `/api/assignments/${params.assignmentId}/submissions/${params.submissionId}`
    ),
  gcTime: 0,
  component: function GradingRoute() {
    return (
      <GradingPage
        key={Route.useParams().submissionId}
        detail={Route.useLoaderData()}
      />
    )
  },
})
