import { createFileRoute } from '@tanstack/react-router'
import { AppearanceSettings } from '@/features/writing/settings'

export const Route = createFileRoute('/_authenticated/settings/appearance')({
  component: AppearanceSettings,
})
