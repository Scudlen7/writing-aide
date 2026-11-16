import { createFileRoute } from '@tanstack/react-router'
import { WritingSignIn } from '@/features/writing/sign-in'

export const Route = createFileRoute('/(auth)/sign-up')({
  component: () => <WritingSignIn register />,
})
