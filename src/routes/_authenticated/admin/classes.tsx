import { createFileRoute } from '@tanstack/react-router'
import { AdminWorkbench } from '@/features/writing/admin'

export const Route = createFileRoute('/_authenticated/admin/classes')({
  component: () => <AdminWorkbench section='classes' />,
})
