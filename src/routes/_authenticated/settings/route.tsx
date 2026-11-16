import { createFileRoute } from '@tanstack/react-router'
import { WritingSettings } from '@/features/writing/settings'

export const Route = createFileRoute('/_authenticated/settings')({
  component: WritingSettings,
})
