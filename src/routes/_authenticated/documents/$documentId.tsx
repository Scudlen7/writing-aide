import { createFileRoute } from '@tanstack/react-router'
import { DocumentDetail } from '@/features/documents/detail'

export const Route = createFileRoute('/_authenticated/documents/$documentId')({
  component: function DocumentRoute() {
    const { documentId } = Route.useParams()
    const { open } = Route.useSearch()
    return (
      <DocumentDetail
        key={documentId}
        id={documentId}
        personId={Route.useRouteContext().person.id}
        openWord={open === 'word'}
        openTrash={open === 'trash'}
        openReview={open === 'review'}
      />
    )
  },
  validateSearch: (
    search: Record<string, unknown>
  ): { open?: 'word' | 'trash' | 'review' } => {
    return search.open === 'word' ||
      search.open === 'trash' ||
      search.open === 'review'
      ? { open: search.open }
      : {}
  },
})
