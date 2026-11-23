import { z } from 'zod'
import type { DiscussionAnchor } from './discussions.ts'

export const aiRoles = ['support', 'challenge', 'summarize'] as const
export const debateTarget = z.union([
  z.object({
    documentId: z.uuid(),
    version: z.coerce.number().int().positive(),
  }),
  z.object({
    assignmentId: z.uuid(),
    version: z.coerce.number().int().positive(),
  }),
])
export type DebateTarget = z.infer<typeof debateTarget>

export interface DebateStep {
  id: string
  round: number
  role: number
  question: string
  body: string | null
  state: 'running' | 'ready' | 'failed'
}

export interface DebateRun {
  id: string
  topic: string
  version: number
  anchor: DiscussionAnchor
  steps: DebateStep[]
}
