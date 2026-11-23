import { z } from 'zod'

export const reviewInvitationLimit = 8

export interface ReviewerCandidate {
  id: string
  name: string
  emailHint: string
}

export const discussionRoles = [
  'support',
  'challenge',
  'clarify',
  'summarize',
] as const
export const discussionDecisions = [
  'pending',
  'accepted',
  'partial',
  'declined',
] as const
export const discussionAnchor = z.object({
  paragraph: z.number().int().min(0).max(400_000),
  offset: z.number().int().min(0).max(400_000),
  quote: z.string().min(1).max(2000),
})
export type DiscussionAnchor = z.infer<typeof discussionAnchor>
export type DiscussionDecision = {
  choice: (typeof discussionDecisions)[number]
  reason: string
  version?: number
}

export interface ReviewSummary {
  id: string
  title: string
  topic: string
  mode: 'review' | 'debate'
  status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'owner' | 'teacher'
  version: number
}

export interface ReviewMessage {
  id: string
  author: string
  body: string
  role: (typeof discussionRoles)[number] | null
  replyTo: string | null
  anchor: DiscussionAnchor | null
  decision: DiscussionDecision | null
  ai: boolean
  criterion: number | null
  reported: boolean
  reportReason?: string | null
  createdAt: string
}

export interface ReviewDiscussion extends ReviewSummary {
  paragraphs?: string[]
  file?: { format: string; url: string }
  endedAt: string | null
  resolution: string | null
  canWrite: boolean
  canManage: boolean
  canDecide: boolean
  criteria: string[]
  participants: {
    id: string
    name: string
    state: 'author' | 'host' | 'pending' | 'accepted' | 'rejected'
  }[]
  messages: ReviewMessage[]
}
