import { z } from 'zod'

export const languages = ['zh-CN', 'en'] as const
export const languageSchema = z.enum(languages)
export type Language = z.infer<typeof languageSchema>

export const stages = [
  'goals',
  'outline',
  'draft',
  'revise',
  'reflect',
] as const
export type Stage = (typeof stages)[number]

const inline = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string().max(30000),
    marks: z
      .array(z.object({ type: z.enum(['bold', 'italic']) }))
      .max(2)
      .optional(),
  }),
  z.object({ type: z.literal('hardBreak') }),
])
const block = z.object({
  type: z.enum(['paragraph', 'heading']),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }).optional(),
  content: z.array(inline).max(2000).optional(),
})
const documentShape = z.object({
  type: z.literal('doc'),
  content: z.array(block).min(1).max(2000),
})
export type WritingDocument = z.infer<typeof documentShape>
export const documentSchema = documentShape.refine(
  (doc) => documentText(doc).length <= 50000
)
export const emptyDocument: WritingDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

export function documentText(doc: WritingDocument) {
  return doc.content
    .map(
      (node) =>
        node.content
          ?.map((item) => (item.type === 'text' ? item.text : '\n'))
          .join('') ?? ''
    )
    .join('\n')
}

export function countWriting(doc: WritingDocument, language: Language) {
  const text = documentText(doc)
  if (language === 'zh-CN') {
    return (
      (text.match(/\p{Script=Han}/gu) ?? []).length +
      (
        text
          .replace(/\p{Script=Han}/gu, ' ')
          .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
      ).length
    )
  }
  return Array.from(
    new Intl.Segmenter('en', { granularity: 'word' }).segment(text)
  ).filter((segment) => segment.isWordLike).length
}

const rubricSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000),
  max: z.number().int().min(1).max(100),
})
export const assignmentInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    instructions: z.string().trim().min(1).max(10000),
    language: languageSchema,
    dueAt: z.iso.datetime(),
    minLength: z.number().int().min(1).max(30000),
    maxLength: z.number().int().min(1).max(30000),
    checklist: z.array(z.string().trim().min(1).max(250)).max(12),
    rubric: z.array(rubricSchema).min(1).max(12),
  })
  .refine((value) => value.minLength <= value.maxLength)
export type AssignmentInput = z.infer<typeof assignmentInput>

export const workSchema = z.object({
  goal: z.string().max(4000),
  aiGoal: z.string().max(4000),
  outline: z.string().max(12000),
  title: z.string().max(240),
  draft: documentSchema,
  revision: documentSchema,
  reflection: z.string().max(8000),
  checked: z.array(z.number().int().min(0).max(11)).max(12),
})
export type Work = z.infer<typeof workSchema>
export const emptyWork: Work = {
  goal: '',
  aiGoal: '',
  outline: '',
  title: '',
  draft: emptyDocument,
  revision: emptyDocument,
  reflection: '',
  checked: [],
}

export const saveInput = z.object({
  version: z.number().int().min(0),
  stage: z.enum(stages),
  action: z.enum(['save', 'advance', 'submit', 'reviseAgain']),
  changes: workSchema.partial(),
})

export const gradeInput = z.object({
  scores: z.array(z.number().int().min(0).max(100)).min(1).max(12),
  feedback: z.string().trim().min(1).max(10000),
})
export type GradeInput = z.infer<typeof gradeInput>

export const aiTasks = ['outline', 'revision', 'assessment'] as const
export type AiTask = (typeof aiTasks)[number]
export const aiResultSchema = z.object({
  summary: z.string().trim().min(1).max(3000),
  suggestions: z
    .array(
      z.object({
        focus: z.string().trim().min(1).max(500),
        advice: z.string().trim().min(1).max(1800),
      })
    )
    .max(8),
  scores: z.array(z.number().int().min(0).max(100)).max(12).optional(),
})
export type AiResult = z.infer<typeof aiResultSchema>
export const decisionSchema = z.object({
  choice: z.enum(['accepted', 'declined']),
  reason: z.string().trim().min(1).max(1000),
})
export type Decision = z.infer<typeof decisionSchema>

export interface Identity {
  id: string
  name: string
  role: 'teacher' | 'student'
}
export interface Classroom {
  id: string
  name: string
  joinCode?: string
}
export interface Assignment extends AssignmentInput {
  id: string
  classroomId: string
  classroomName: string
}
export interface Submission {
  id: string
  stage: Stage
  status: 'draft' | 'submitted' | 'graded'
  version: number
  work: Work
  grade: GradeInput | null
  submittedAt: string | null
}
export interface SubmissionSummary {
  id: string
  studentName: string
  status: 'submitted' | 'graded'
  submittedAt: string
  title: string
}
export interface AiReview {
  id: string
  task: AiTask
  result: AiResult
  decisions: Record<string, Decision>
  createdAt: string
}
export type AssignmentListItem = Assignment & {
  status: Submission['status'] | null
  stage: Stage | null
}
