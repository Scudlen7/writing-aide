import { createFileRoute, Outlet } from '@tanstack/react-router'
import { RequestError } from '@/features/writing/api'

export const Route = createFileRoute('/_authenticated/admin')({
  beforeLoad: ({ context }) => {
    if (context.person.role !== 'admin')
      throw new RequestError(403, 'forbidden')
  },
  component: Outlet,
})
