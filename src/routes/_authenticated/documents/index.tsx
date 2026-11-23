import { createFileRoute } from '@tanstack/react-router'
import { DocumentLibrary } from '@/features/documents/library'

export const Route = createFileRoute('/_authenticated/documents/')({
  component: function DocumentsRoute() {
    return <DocumentLibrary personId={Route.useRouteContext().person.id} />
  },
})
