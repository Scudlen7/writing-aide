import { useState, type FormEvent, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePagination } from '@/components/data-table'
import { Problem } from './ui'

export const selectField =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export function ManagementTable<T extends { id: string }>({
  rows,
  columns,
}: {
  rows: T[]
  columns: ColumnDef<T>[]
}) {
  const { t } = useTranslation()
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })
  return (
    <div className='space-y-3'>
      <div className='rounded-md border bg-card'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center text-muted-foreground'
                >
                  {t('noMatches')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {rows.length > 0 && <DataTablePagination table={table} />}
    </div>
  )
}

export function ManagementDialog({
  title,
  children,
  save,
  refresh,
  confirm,
  destructive = false,
  actionLabel,
}: {
  title: string
  children?: ReactNode
  save: (fields: FormData) => Promise<unknown>
  refresh: () => void | Promise<unknown>
  confirm?: string
  destructive?: boolean
  actionLabel?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [queued, setQueued] = useState<FormData | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)

  async function apply(fields: FormData) {
    setQueued(null)
    setError(null)
    setPending(true)
    try {
      await save(fields)
      setOpen(false)
      toast.success(t('saved'))
      await refresh()
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    if (confirm && children) setQueued(fields)
    else void apply(fields)
  }

  const trigger = (
    <Button variant='outline' size='sm' type='button'>
      {title}
    </Button>
  )
  const confirmation = confirm && (
    <ConfirmDialog
      open={Boolean(queued)}
      onOpenChange={(value) => {
        if (!value) setQueued(null)
      }}
      title={title}
      desc={confirm}
      cancelBtnText={t('cancel')}
      confirmText={t('confirm')}
      destructive={destructive}
      handleConfirm={() => {
        if (queued) void apply(queued)
      }}
    />
  )
  if (!children && confirm)
    return (
      <div className='space-y-2'>
        <Button
          variant='outline'
          size='sm'
          type='button'
          disabled={pending}
          onClick={() => setQueued(new FormData())}
        >
          {title}
        </Button>
        {confirmation}
        <Problem error={error} />
      </div>
    )
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value)
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={t('close')} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className='grid gap-4' onSubmit={submit}>
          {children}
          <Problem error={error} />
          <Button disabled={pending}>
            {pending ? t('saving') : (actionLabel ?? t('saveChanges'))}
          </Button>
        </form>
        {confirmation}
      </DialogContent>
    </Dialog>
  )
}
