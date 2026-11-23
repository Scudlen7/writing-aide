import { createFileRoute } from '@tanstack/react-router'
import { ReviewDiscussionPage } from '@/features/documents/reviews'

export const Route = createFileRoute(
  '/_authenticated/review-discussions/$threadId'
)({
  component: function ReviewRoute() {
    const { threadId } = Route.useParams()
    return <ReviewDiscussionPage key={threadId} id={threadId} />
  },
})
