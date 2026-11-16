import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { request } from '@/features/writing/api'

export const chatListKey = (personId: string) => ['writing-chats', personId]
export const chatHistoryKey = (personId: string, peerId: string) => [
  'writing-chat-history',
  personId,
  peerId,
]
export const chatPath = (peerId: string) =>
  `/api/chats/${encodeURIComponent(peerId)}`

export function chatUnreadOptions(personId: string) {
  return queryOptions({
    queryKey: [...chatListKey(personId), 'unread'],
    queryFn: () => request<{ count: number }>('/api/chats/unread'),
    refetchInterval: 15000,
    refetchOnWindowFocus: 'always',
  })
}

export function refreshChats(
  client: QueryClient,
  personId: string,
  peerId: string
) {
  return Promise.all([
    client.invalidateQueries({ queryKey: chatListKey(personId) }),
    client.invalidateQueries({ queryKey: chatHistoryKey(personId, peerId) }),
  ])
}
