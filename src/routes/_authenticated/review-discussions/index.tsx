import { createFileRoute } from '@tanstack/react-router'
import { Main } from '@/components/layout/main'
import { ReviewList } from '@/features/documents/reviews'

export const Route = createFileRoute('/_authenticated/review-discussions/')({
  component: function ReviewInbox() {
    return (
      <Main id='writing-main'>
        <ReviewList />
      </Main>
    )
  },
})
