import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ChatConversation } from '@writing/chat'
import { MessagesSquare, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, getDisplayNameInitials } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Main } from '@/components/layout/main'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import { chatListKey } from './api'
import { ChatThread } from './components/chat-thread'
import { NewChat } from './components/new-chat'

export function Chats({ personId, peer }: { personId: string; peer?: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [newChatOpen, setNewChatOpen] = useState(false)
  const inbox = useQuery({
    queryKey: [...chatListKey(personId), 'inbox'],
    queryFn: () => request<ChatConversation[]>('/api/chats'),
    refetchInterval: 10000,
    refetchOnWindowFocus: 'always',
  })
  const filtered =
    inbox.data?.filter(({ contact }) =>
      contact.name
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase())
    ) ?? []
  const date = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
  })

  return (
    <Main
      id='writing-main'
      fixed
      fluid
      className='mx-auto w-full max-w-7xl px-4 py-4 sm:px-6'
    >
      <div className='flex h-[calc(100dvh-6rem)] min-h-72 gap-4 overflow-hidden'>
        <section
          className={cn(
            'flex min-w-0 flex-1 flex-col gap-3 sm:max-w-64 lg:max-w-80',
            peer && 'hidden sm:flex'
          )}
          aria-labelledby='chat-heading'
        >
          <div className='flex items-center justify-between gap-2'>
            <h1
              id='chat-heading'
              className='flex items-center gap-2 text-2xl font-semibold'
            >
              {t('chats')}{' '}
              <MessagesSquare className='size-5' aria-hidden='true' />
            </h1>
            <NewChat
              personId={personId}
              open={newChatOpen}
              onOpenChange={setNewChatOpen}
              onSelect={(contact) => {
                setNewChatOpen(false)
                void navigate({
                  to: '/chats',
                  search: { peer: contact.id },
                  resetScroll: false,
                })
              }}
            />
          </div>
          <div className='relative'>
            <Search className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              type='search'
              aria-label={t('searchChats')}
              placeholder={t('searchChats')}
              className='ps-9'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {inbox.isPending && (
            <p role='status' className='text-sm text-muted-foreground'>
              {t('loading')}
            </p>
          )}
          {inbox.isError && (
            <div className='space-y-2'>
              <Problem error={inbox.error} />
              <Button
                variant='outline'
                size='sm'
                onClick={() => void inbox.refetch()}
              >
                {t('retry')}
              </Button>
            </div>
          )}
          {inbox.isSuccess &&
            (filtered.length ? (
              <ul className='min-h-0 grow divide-y overflow-y-auto'>
                {filtered.map(({ contact, lastMessage, unread }) => (
                  <li key={contact.id} className='py-1'>
                    <Link
                      to='/chats'
                      search={{ peer: contact.id }}
                      resetScroll={false}
                      aria-current={peer === contact.id ? 'page' : undefined}
                      activeOptions={{ exact: true, includeSearch: true }}
                      className={cn(
                        'flex min-w-0 gap-2 rounded-md px-2 py-2.5 text-sm hover:bg-accent',
                        peer === contact.id && 'bg-muted'
                      )}
                    >
                      <Avatar className='size-9 shrink-0'>
                        <AvatarFallback>
                          {getDisplayNameInitials(contact.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center justify-between gap-2'>
                          <span className='truncate font-medium'>
                            {contact.name}
                          </span>
                          <time
                            className='shrink-0 text-xs text-muted-foreground'
                            dateTime={lastMessage.createdAt}
                          >
                            {date.format(new Date(lastMessage.createdAt))}
                          </time>
                        </div>
                        <div className='flex items-center gap-2'>
                          <p className='truncate text-muted-foreground'>
                            {lastMessage.senderId === personId
                              ? t('ownChatPreview', { body: lastMessage.body })
                              : lastMessage.body}
                          </p>
                          {unread > 0 && (
                            <Badge
                              className='ms-auto shrink-0'
                              aria-label={t('unreadChats', { count: unread })}
                            >
                              {unread}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='px-2 py-4 text-sm text-muted-foreground'>
                {t(search.trim() ? 'noMatches' : 'noChats')}
              </p>
            ))}
        </section>
        {peer ? (
          <ChatThread key={peer} personId={personId} peerId={peer} />
        ) : (
          <div className='hidden min-w-0 flex-1 place-content-center rounded-lg border bg-card p-6 text-center sm:grid'>
            <p className='text-sm text-muted-foreground'>{t('chooseChat')}</p>
          </div>
        )}
      </div>
    </Main>
  )
}
