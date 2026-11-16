import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  maxMessageLength,
  type ChatHistory,
  type ChatMessage,
} from '@writing/chat'
import { ArrowLeft, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, getDisplayNameInitials } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RequestError, request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import { chatHistoryKey, chatPath, refreshChats } from '../api'

export function ChatThread({
  personId,
  peerId,
}: {
  personId: string
  peerId: string
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [sendError, setSendError] = useState<unknown>(null)
  const sending = useRef(false)
  const draftKey = useRef<{ clientId: string; body: string } | null>(null)
  const messageList = useRef<HTMLDivElement>(null)
  const stickToLatest = useRef(true)
  const path = chatPath(peerId)
  const history = useInfiniteQuery({
    queryKey: chatHistoryKey(personId, peerId),
    queryFn: ({ pageParam }) =>
      request<ChatHistory>(
        `${chatPath(peerId)}${pageParam ? `?before=${pageParam}` : ''}`
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasOlder ? lastPage.messages[0]?.id : undefined,
    refetchInterval: 5000,
    refetchOnWindowFocus: 'always',
    retry: (count, error) =>
      count < 2 && !(error instanceof RequestError && error.status < 500),
  })
  const pages = history.isSuccess ? history.data.pages : undefined
  const contact = pages?.[0]?.contact
  const messages = [...(pages ?? [])].reverse().flatMap((page) => page.messages)
  const lastMessageId = messages.at(-1)?.id

  useEffect(() => {
    const list = messageList.current
    if (list && lastMessageId !== undefined && stickToLatest.current)
      list.scrollTop = list.scrollHeight
  }, [lastMessageId])

  useEffect(() => {
    const batches = (pages ?? [])
      .map((page) => page.unreadIds)
      .filter((ids) => ids.length > 0)
    if (!batches.length) return
    let reading = false
    async function markRead() {
      if (
        reading ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus()
      )
        return
      reading = true
      try {
        await Promise.all(
          batches.map((ids) => request(`${path}/read`, 'PUT', { ids }))
        )
        await refreshChats(client, personId, peerId)
      } catch (error) {
        if (error instanceof RequestError && error.status === 404)
          void refreshChats(client, personId, peerId)
      } finally {
        reading = false
      }
    }
    void markRead()
    window.addEventListener('focus', markRead)
    document.addEventListener('visibilitychange', markRead)
    return () => {
      window.removeEventListener('focus', markRead)
      document.removeEventListener('visibilitychange', markRead)
    }
  }, [client, pages, path, peerId, personId])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = body.trim()
    if (!content || !contact || sending.current) return
    if (draftKey.current?.body !== content)
      draftKey.current = { body: content, clientId: window.crypto.randomUUID() }
    sending.current = true
    setPending(true)
    setSendError(null)
    try {
      await request<ChatMessage>(`${path}/messages`, 'POST', draftKey.current)
      setBody('')
      draftKey.current = null
      stickToLatest.current = true
      await refreshChats(client, personId, peerId)
    } catch (error) {
      setSendError(error)
      if (error instanceof RequestError && error.status === 404)
        void refreshChats(client, personId, peerId)
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  return (
    <section
      className='flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card'
      aria-label={t('chatConversation')}
    >
      <header className='flex shrink-0 items-center gap-3 border-b p-3'>
        <Button asChild variant='ghost' size='icon' className='sm:hidden'>
          <Link to='/chats' search={{}} aria-label={t('backToChats')}>
            <ArrowLeft />
          </Link>
        </Button>
        {contact ? (
          <>
            <Avatar className='size-9 shrink-0'>
              <AvatarFallback>
                {getDisplayNameInitials(contact.name)}
              </AvatarFallback>
            </Avatar>
            <div className='min-w-0'>
              <h2 className='truncate font-semibold'>{contact.name}</h2>
              <p className='truncate text-xs text-muted-foreground'>
                {t(contact.role)} · {contact.classrooms.join(' · ')}
              </p>
            </div>
          </>
        ) : (
          <h2 className='font-semibold'>{t('chatConversation')}</h2>
        )}
      </header>
      {history.isPending && (
        <p role='status' className='p-4 text-sm text-muted-foreground'>
          {t('loading')}
        </p>
      )}
      {history.isError && (
        <div className='space-y-3 p-4'>
          <Problem error={history.error} />
          <Button
            variant='outline'
            size='sm'
            onClick={() => void history.refetch()}
          >
            {t('retry')}
          </Button>
        </div>
      )}
      {contact && (
        <>
          <div
            ref={messageList}
            role='log'
            aria-label={t('chatHistory')}
            className='flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-4'
            onScroll={(event) => {
              const { scrollHeight, clientHeight, scrollTop } =
                event.currentTarget
              stickToLatest.current =
                scrollHeight - clientHeight - scrollTop < 72
            }}
          >
            {history.hasNextPage && (
              <Button
                className='mx-auto mb-4'
                variant='outline'
                size='sm'
                disabled={history.isFetching}
                onClick={() => void history.fetchNextPage()}
              >
                {t(history.isFetchingNextPage ? 'loading' : 'loadOlderChats')}
              </Button>
            )}
            {messages.length ? (
              <MessageBubbles messages={messages} personId={personId} />
            ) : (
              <p className='m-auto text-center text-sm text-muted-foreground'>
                {t('emptyChat')}
              </p>
            )}
          </div>
          <form
            onSubmit={(event) => void send(event)}
            className='shrink-0 space-y-2 border-t p-3'
          >
            <Problem error={sendError} />
            <div className='flex items-end gap-2'>
              <Textarea
                className='max-h-32 min-h-11 resize-none'
                rows={1}
                aria-label={t('chatMessage')}
                placeholder={t('chatMessage')}
                value={body}
                maxLength={maxMessageLength}
                readOnly={pending}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <Button
                type='submit'
                size='icon'
                className='size-11 shrink-0'
                disabled={pending || !body.trim()}
                aria-label={t('sendChatMessage')}
                title={t('sendChatMessage')}
              >
                <Send />
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}

function MessageBubbles({
  messages,
  personId,
}: {
  messages: ChatMessage[]
  personId: string
}) {
  const { i18n } = useTranslation()
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' })
  return (
    <ol className='mt-auto flex flex-col gap-2'>
      {messages.map((message, index) => {
        const previous = messages[index - 1]
        const date = new Date(message.createdAt)
        const label = day.format(date)
        const own = message.senderId === personId
        return (
          <li key={message.id} className='flex flex-col gap-2'>
            {(!previous ||
              day.format(new Date(previous.createdAt)) !== label) && (
              <time
                className='my-1 text-center text-xs text-muted-foreground'
                dateTime={message.createdAt}
              >
                {label}
              </time>
            )}
            <div
              className={cn(
                'max-w-[85%] px-3 py-2 text-sm wrap-break-word shadow-xs sm:max-w-[75%]',
                own
                  ? 'self-end rounded-[16px_16px_0_16px] bg-primary text-primary-foreground'
                  : 'self-start rounded-[16px_16px_16px_0] bg-muted'
              )}
            >
              <p className='whitespace-pre-wrap'>{message.body}</p>
              <time
                dateTime={message.createdAt}
                className={cn(
                  'mt-1 block text-end text-xs',
                  own ? 'text-primary-foreground/80' : 'text-muted-foreground'
                )}
              >
                {time.format(date)}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
