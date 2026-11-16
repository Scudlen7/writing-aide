import { createFileRoute } from '@tanstack/react-router'
import { AdminWorkbench } from '@/features/writing/admin'
import { RequestError } from '@/features/writing/api'

export const Route = createFileRoute('/_authenticated/admin')({
  beforeLoad: ({ context }) => {
    if (context.person.role !== 'admin')
      throw new RequestError(403, 'forbidden')
  },
  component: AdminWorkbench,
})
