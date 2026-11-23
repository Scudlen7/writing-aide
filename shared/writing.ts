import { z } from 'zod'
import { referenceSchema } from './references.ts'

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

export function stageComplete(stage: Stage, work: Work) {
  switch (stage) {
    case 'goals':
      return work.personalGoals
        ? work.personalGoals.writing.some((goal) => goal.trim())
        : Boolean(work.goal.trim())
    case 'outline':
      return Boolean(work.outline.trim())
    case 'draft':
      return Boolean(work.title.trim() && documentText(work.draft).trim())
    case 'revise':
      return Boolean(
        (work.revisionTitle ?? work.title).trim() &&
        documentText(work.revision).trim()
      )
    case 'reflect':
      return Boolean(work.reflection.trim())
  }
}

export function incompleteBefore(target: Stage, work: Work) {
  return stages
    .slice(0, stages.indexOf(target))
    .find((step) => !stageComplete(step, work))
}

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
  z.object({
    type: z.literal('citation'),
    attrs: z.object({
      sourceId: z.uuid(),
      locator: z.string().trim().max(80).optional(),
    }),
  }),
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

export function blockText(block: WritingDocument['content'][number]) {
  return (
    block.content
      ?.map((item) =>
        item.type === 'text'
          ? item.text
          : item.type === 'hardBreak'
            ? '\n'
            : ' '
      )
      .join('') ?? ''
  )
}

export function documentText(doc: WritingDocument) {
  return doc.content.map(blockText).join('\n')
}

export function citedSources(doc: WritingDocument) {
  return new Set(
    doc.content.flatMap(
      (block) =>
        block.content?.flatMap((item) =>
          item.type === 'citation' ? [item.attrs.sourceId] : []
        ) ?? []
    )
  )
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

export const aiTasks = ['outline', 'revision', 'assessment'] as const
export type AiTask = (typeof aiTasks)[number]
export const writingFocuses = ['argument', 'structure', 'language'] as const
export type WritingFocus = (typeof writingFocuses)[number]

const rubricSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000),
  max: z.number().int().min(1).max(100),
  levels: z.string().trim().max(1500).optional(),
  example: z.string().trim().max(1500).optional(),
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
    aiDebate: z.boolean().optional(),
    aiPolicy: z
      .array(z.enum(aiTasks))
      .max(aiTasks.length)
      .refine((tasks) => new Set(tasks).size === tasks.length)
      .nullable()
      .optional(),
  })
  .refine((value) => value.minLength <= value.maxLength)
export type AssignmentInput = z.infer<typeof assignmentInput>

const goals = z.array(z.string().max(4000)).max(12)
export const workSchema = z.object({
  goal: z.string().max(4000),
  aiGoal: z.string().max(4000),
  personalGoals: z.object({ writing: goals, ai: goals }).optional(),
  completedGoals: z.array(z.string().max(4020)).max(24).optional(),
  sources: z.array(referenceSchema).max(40).optional(),
  outline: z.string().max(12000),
  title: z.string().max(240),
  revisionTitle: z.string().max(240).optional(),
  draft: documentSchema,
  revision: documentSchema,
  reflection: z.string().max(8000),
  aiDeclaration: z
    .object({ used: z.boolean(), description: z.string().max(2000) })
    .optional(),
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
  action: z.enum(['save', 'advance', 'submit', 'reviseAgain', 'navigate']),
  target: z.enum(stages).optional(),
  changes: workSchema.partial(),
})

export const annotationInput = z.object({
  block: z.number().int().min(0).max(1999),
  criterion: z.number().int().min(0).max(11).optional(),
  text: z.string().trim().min(1).max(2000),
})
export type Annotation = z.infer<typeof annotationInput>

export const gradeInput = z.object({
  scores: z.array(z.number().int().min(0).max(100)).min(1).max(12),
  feedback: z.string().trim().min(1).max(10000),
  nextStep: z.string().trim().max(2000).optional(),
  criteriaFeedback: z.array(z.string().trim().max(2000)).max(12).optional(),
  annotations: z.array(annotationInput).max(100).optional(),
})
export type GradeInput = z.infer<typeof gradeInput>

export const gradeDraftInput = gradeInput.extend({
  scores: gradeInput.shape.scores.element.nullable().array().min(1).max(12),
  feedback: z.string().max(10000),
  criteriaFeedback: z.array(z.string().max(2000)).max(12),
  annotations: gradeInput.shape.annotations.unwrap(),
})
export type GradeDraftInput = z.infer<typeof gradeDraftInput>
export interface GradeDraft {
  version: number
  submissionVersion: number
  input: GradeDraftInput
}

export const aiResultSchema = z.object({
  summary: z.string().trim().min(1).max(3000),
  suggestions: z
    .array(
      z.object({
        focus: z.string().trim().min(1).max(500),
        advice: z.string().trim().min(1).max(1800),
        reason: z.string().trim().min(1).max(1000).optional(),
        offset: z.number().int().min(0).max(50000).optional(),
        criterion: z.number().int().min(0).max(11).optional(),
      })
    )
    .max(8),
  scores: z.array(z.number().int().min(0).max(100)).max(12).optional(),
})
export type AiResult = z.infer<typeof aiResultSchema>

export function personalGoalItems(
  work: Pick<Work, 'goal' | 'aiGoal' | 'personalGoals'>
) {
  const goals = work.personalGoals ?? {
    writing: [work.goal],
    ai: [work.aiGoal],
  }
  return (['writing', 'ai'] as const).flatMap((kind) =>
    [...new Set(goals[kind].map((goal) => goal.trim()).filter(Boolean))].map(
      (text) => ({ kind, text, key: `${kind}:${text}` })
    )
  )
}

export function aiAllowed(
  assignment: Pick<AssignmentInput, 'aiPolicy'>,
  task: AiTask
) {
  return assignment.aiPolicy?.includes(task) ?? true
}
export const decisionSchema = z.object({
  choice: z.enum(['accepted', 'declined']),
  reason: z.string().trim().min(1).max(1000),
})
export type Decision = z.infer<typeof decisionSchema>

export const roles = ['student', 'teacher', 'admin'] as const
export type Role = (typeof roles)[number]

export interface Identity {
  id: string
  name: string
  role: Role
  email: string
  image: string | null
  submissionNotifications: boolean
}
export interface Classroom {
  id: string
  name: string
  joinCode?: string
  studentCount?: number
  archived?: boolean
}
export interface Assignment extends AssignmentInput {
  id: string
  classroomId: string
  classroomName: string
  archived: boolean
  updatedAt: string | null
}
export interface Submission {
  id: string
  stage: Stage
  openedStage: Stage
  status: 'draft' | 'submitted' | 'graded'
  version: number
  work: Work
  grade: GradeInput | null
  submittedAt: string | null
  requirements: AssignmentInput | null
  returned?: ReturnedPaper | null
}
export interface ReturnedPaper {
  version: number
  reason: string
  returnedAt: string
  dueAt: string
  submittedAt: string
  work: Work
  requirements: AssignmentInput
}
export interface SubmissionSummary {
  id: string
  studentName: string
  status: Submission['status']
  submittedAt: string
  title: string
  returned?: boolean
}
export interface AiReview {
  id: string
  task: AiTask
  result: AiResult
  decisions: Record<string, Decision>
  createdAt: string
  source: ReviewSource | null
  calibration?: AssessmentCalibration | null
}
export interface AssessmentCalibration {
  baseline: number[]
  evidence: (boolean | null)[]
}
export interface ReviewSource {
  version: number
  text: string
  block?: number
  focus?: WritingFocus
}

export const notificationKinds = [
  'returned',
  'grade',
  'assignmentChanged',
  'submission',
  'reviewInvited',
  'reviewComment',
  'reviewReply',
] as const
export type Notification = {
  id: string
  createdAt: string
  readAt: string | null
} & (
  | {
      kind: 'reviewInvited' | 'reviewComment' | 'reviewReply'
      reviewThreadId: string
      reviewTitle: string
      assignmentId?: never
    }
  | {
      kind: 'grade' | 'returned' | 'assignmentChanged' | 'submission'
      assignmentId: string
      assignmentTitle: string
      submissionId: string | null
    }
)
export type AssignmentListItem = Assignment & {
  status: Submission['status'] | null
  stage: Stage | null
  pendingSubmissions?: number
  progress?: Record<CourseProgress, number>
}
export const courseProgresses = [
  'notStarted',
  'draft',
  'submitted',
  'graded',
] as const
export type CourseProgress = (typeof courseProgresses)[number]
export type CourseProgressStudent = {
  id: string
  name: string
  status: CourseProgress
  submissionId: string | null
}
