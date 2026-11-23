import { z } from 'zod'
import type { ReferenceSource } from './references.ts'
import type { AssignmentInput, WritingDocument } from './writing.ts'

export const peerStates = [
  'assigned',
  'submitted',
  'declined',
  'revoked',
] as const
export const peerFeedback = z.object({
  criterion: z.number().int().min(0).max(11),
  comment: z.string().trim().min(1).max(2000),
  improvement: z.string().trim().min(1).max(2000),
})
export type PeerFeedback = z.infer<typeof peerFeedback>
export type PeerReport = { by: string; reason: string; resolved: boolean }
export interface PeerReviewItem {
  id: string
  reviewer: string
  author: string
  role: 'teacher' | 'reviewer' | 'author'
  status: (typeof peerStates)[number]
  paper?: {
    title: string
    doc: WritingDocument
    references: ReferenceSource[]
    rubric: AssignmentInput['rubric']
  }
  rubric?: AssignmentInput['rubric']
  feedback: PeerFeedback | null
  reported: boolean
  canReport: boolean
  reportReason?: string
}
export interface PeerReviewDirectory {
  reviews: PeerReviewItem[]
  students?: { id: string; name: string }[]
  submissions?: { id: string; version: number; name: string }[]
  authorDebate?: {
    students: { id: string; name: string }[]
    submissions: { id: string; version: number; name: string }[]
  }
  readOnly: boolean
}
