import { z } from 'zod'
import { discussionAnchor, type DiscussionAnchor } from './discussions.ts'

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

export const debateExcerptLimit = 6000
const debatePosition = discussionAnchor.pick({ paragraph: true, offset: true })
export const debateRange = z.object({
  start: debatePosition,
  end: debatePosition,
})
export type DebateRange = z.infer<typeof debateRange>
export type DebateExcerpt = DebateRange & { text: string }

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
  excerpts?: DebateExcerpt[]
  steps: DebateStep[]
}
