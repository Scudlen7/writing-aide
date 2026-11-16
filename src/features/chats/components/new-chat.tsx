import { useQuery } from '@tanstack/react-query'
import type { ChatContact } from '@writing/chat'
import { PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'

export function NewChat({
  personId,
  open,
  onOpenChange,
  onSelect,
}: {
  personId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (contact: ChatContact) => void
}) {
  const { t } = useTranslation()
  const contacts = useQuery({
    queryKey: ['writing-chat-contacts', personId],
    queryFn: () => request<ChatContact[]>('/api/chats/contacts'),
    enabled: open,
    refetchOnWindowFocus: 'always',
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          aria-label={t('newChat')}
          title={t('newChat')}
        >
          <PenLine />
        </Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t('close')}
        aria-describedby={undefined}
        className='sm:max-w-lg'
      >
        <DialogHeader>
          <DialogTitle>{t('newChat')}</DialogTitle>
        </DialogHeader>
        {contacts.isPending && (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('loading')}
          </p>
        )}
        {contacts.isError && (
          <>
            <Problem error={contacts.error} />
            <Button variant='outline' onClick={() => void contacts.refetch()}>
              {t('retry')}
            </Button>
          </>
        )}
        {contacts.isSuccess &&
          (contacts.data.length ? (
            <Command className='rounded-md border'>
              <CommandInput
                placeholder={t('searchContacts')}
                aria-label={t('searchContacts')}
              />
              <CommandList>
                <CommandEmpty>{t('noMatches')}</CommandEmpty>
                <CommandGroup>
                  {contacts.data.map((contact) => (
                    <CommandItem
                      key={contact.id}
                      value={contact.id}
                      keywords={[
                        contact.name,
                        t(contact.role),
                        ...contact.classrooms,
                      ]}
                      onSelect={() => onSelect(contact)}
                      className='items-start gap-2'
                    >
                      <div className='min-w-0 space-y-0.5'>
                        <p className='font-medium wrap-break-word'>
                          {contact.name}
                        </p>
                        <p className='text-xs wrap-break-word text-muted-foreground'>
                          {t(contact.role)} · {contact.classrooms.join(' · ')}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('noChatContacts')}
            </p>
          ))}
      </DialogContent>
    </Dialog>
  )
}
