import { createFileRoute } from '@tanstack/react-router'
import { PasswordSettings } from '@/features/writing/settings'

export const Route = createFileRoute('/_authenticated/settings/account')({
  component: PasswordSettings,
})
