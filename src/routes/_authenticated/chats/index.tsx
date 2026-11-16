import { createFileRoute } from '@tanstack/react-router'
import { Chats } from '@/features/chats'
import { RequestError } from '@/features/writing/api'

export const Route = createFileRoute('/_authenticated/chats/')({
  beforeLoad: ({ context }) => {
    if (context.person.role === 'admin')
      throw new RequestError(403, 'forbidden')
  },
  validateSearch: (search: Record<string, unknown>): { peer?: string } => ({
    peer:
      typeof search.peer === 'string' && search.peer.length <= 128
        ? search.peer || undefined
        : undefined,
  }),
  component: function ChatsRoute() {
    return (
      <Chats
        personId={Route.useRouteContext().person.id}
        peer={Route.useSearch().peer}
      />
    )
  },
})
