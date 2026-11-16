import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { WritingSignIn } from '@/features/writing/sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-in')({
  component: function SignInRoute() {
    return <WritingSignIn redirectTo={Route.useSearch().redirect} />
  },
  validateSearch: searchSchema,
})
