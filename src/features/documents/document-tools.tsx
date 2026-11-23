import {
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { LayoutList, Minus, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { DocumentToolSlot } from './document-tool-slot'

export type DocumentTool = 'aiWriting' | 'discussions' | 'aiDebate'
type DialogTool = DocumentTool | 'discussionParticipants'

export type ToolDialogControls = {
  open: boolean
  close: () => void
  minimize: () => void
  restoreFocus: () => void
}

export function DocumentToolDialog({
  tool,
  controls,
  toolbar,
  children,
  footer,
}: {
  tool: DialogTool
  controls: ToolDialogControls
  toolbar?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const { t } = useTranslation()
  const title = useRef<HTMLHeadingElement>(null)
  const scrollTop = useRef(0)
  const followsConversation = tool === 'aiWriting' || tool === 'aiDebate'
  const scrollToEnd = useRef(followsConversation)
  const scrollObserver = useRef<ResizeObserver | null>(null)
  const attachScroll = useCallback((viewport: HTMLDivElement | null) => {
    scrollObserver.current?.disconnect()
    if (!viewport) return
    const moveToEnd = () => {
      if (scrollToEnd.current) viewport.scrollTop = viewport.scrollHeight
    }
    viewport.scrollTop = scrollTop.current
    moveToEnd()
    const content = viewport.firstElementChild
    if (content) {
      scrollObserver.current = new ResizeObserver(moveToEnd)
      scrollObserver.current.observe(content)
    }
  }, [])

  return (
    <Dialog
      open={controls.open}
      onOpenChange={(open) => {
        if (!open) controls.close()
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          title.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          controls.restoreFocus()
        }}
        className='flex h-[min(46rem,calc(100dvh-2rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl'
      >
        <DialogHeader className='flex shrink-0 flex-row items-center justify-between gap-2 border-b px-4 py-2 sm:px-5'>
          <DialogTitle
            tabIndex={-1}
            ref={title}
            className='text-start focus:outline-none'
          >
            {t(`documents.${tool}`)}
          </DialogTitle>
          <div className='flex shrink-0 gap-1'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t('documents.minimizeTool')}
              title={t('documents.minimizeTool')}
              onClick={controls.minimize}
            >
              <Minus />
            </Button>
            <DialogClose asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label={t('documents.closeTool')}
                title={t('documents.closeTool')}
              >
                <X />
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>
        {toolbar && (
          <div className='shrink-0 border-b px-4 py-2 sm:px-5'>{toolbar}</div>
        )}
        <div
          className='min-h-0 flex-1 overflow-y-auto overscroll-contain'
          ref={attachScroll}
          onScroll={(event) => {
            const element = event.currentTarget
            scrollTop.current = element.scrollTop
            scrollToEnd.current =
              followsConversation &&
              element.scrollHeight - element.clientHeight - element.scrollTop <
                32
          }}
        >
          <div className='mx-auto grid max-w-2xl min-w-0 gap-4 px-4 py-4 sm:px-5'>
            {children}
          </div>
        </div>
        {footer && (
          <div className='max-h-[45%] shrink-0 overflow-y-auto border-t bg-background px-4 py-3 sm:px-5'>
            <div className='mx-auto max-w-2xl'>{footer}</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function DocumentToolSummary<Tool extends DialogTool>({
  items,
  onRestore,
}: {
  items: Tool[]
  onRestore: (tool: Tool) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const slot = useContext(DocumentToolSlot)
  if (!slot) return null
  return createPortal(
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id='document-tool-summary'
          variant='outline'
          size='sm'
          aria-label={t('documents.toolSummary')}
        >
          <LayoutList />
          <span className='hidden sm:inline'>{t('documents.toolSummary')}</span>
          {items.length > 0 && (
            <Badge variant='secondary' className='px-1.5'>
              {items.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='grid gap-2'>
        <p className='text-sm font-medium'>{t('documents.toolSummary')}</p>
        {items.length === 0 && (
          <p className='text-sm text-muted-foreground'>
            {t('documents.noMinimizedTools')}
          </p>
        )}
        {items.map((tool) => (
          <Button
            key={tool}
            variant='secondary'
            className='justify-start'
            onClick={() => {
              setOpen(false)
              onRestore(tool)
            }}
          >
            {t(`documents.${tool as DialogTool}`)}
          </Button>
        ))}
      </PopoverContent>
    </Popover>,
    slot
  )
}
