import { createFileRoute } from '@tanstack/react-router'
import { AdminWorkbench } from '@/features/writing/admin'

export const Route = createFileRoute('/_authenticated/admin/users')({
  component: () => <AdminWorkbench section='users' />,
})
