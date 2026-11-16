import { z } from 'zod'
import { fromNodeHeaders } from 'better-auth/node'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import {
  aiTasks,
  assignmentInput,
  countWriting,
  decisionSchema,
  documentText,
  emptyWork,
  gradeInput,
  saveInput,
  stages,
  type Identity,
  type Stage,
  type Work,
} from '../shared/writing.ts'
import { aiEnabled, reviewWriting } from './ai.ts'
import { auth } from './auth.ts'
import { db } from './db.ts'
import { ApiError, read } from './errors.ts'
import {
  aiReview,
  assignment,
  classroom,
  enrollment,
  submission,
  user,
} from './schema.ts'

const uuid = z.uuid()
const assignmentParams = z.object({ id: uuid })
const submissionParams = assignmentParams.extend({ submissionId: uuid })
const reviewParams = assignmentParams.extend({
  reviewId: uuid,
  index: z.coerce.number().int().min(0).max(7),
})
const pendingReviews = new Set<string>()

async function identity(
  request: FastifyRequest,
  role?: Identity['role']
): Promise<Identity> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  })
  if (!session) throw new ApiError(401, 'signInRequired')
  const [person] = await db
    .select({ id: user.id, name: user.name, role: user.role })
    .from(user)
    .where(eq(user.id, session.user.id))
  if (!person) throw new ApiError(401, 'signInRequired')
  if (role && person.role !== role) throw new ApiError(403, 'forbidden')
  return person
}

async function accessibleAssignment(id: string, person: Identity) {
  const [row] = await db
    .select({ ...assignmentFields, classroomName: classroom.name })
    .from(assignment)
    .innerJoin(classroom, eq(classroom.id, assignment.classroomId))
    .leftJoin(
      enrollment,
      and(
        eq(enrollment.classroomId, classroom.id),
        eq(enrollment.studentId, person.id)
      )
    )
    .where(
      and(
        eq(assignment.id, id),
        person.role === 'teacher'
          ? eq(classroom.teacherId, person.id)
          : eq(enrollment.studentId, person.id)
      )
    )
  if (!row) throw new ApiError(404, 'notFound')
  return row
}

const assignmentFields = {
  id: assignment.id,
  classroomId: assignment.classroomId,
  title: assignment.title,
  instructions: assignment.instructions,
  language: assignment.language,
  dueAt: assignment.dueAt,
  minLength: assignment.minLength,
  maxLength: assignment.maxLength,
  checklist: assignment.checklist,
  rubric: assignment.rubric,
}
const submissionFields = {
  id: submission.id,
  stage: submission.stage,
  status: submission.status,
  version: submission.version,
  work: submission.work,
  grade: submission.grade,
  submittedAt: submission.submittedAt,
}
const reviewFields = {
  id: aiReview.id,
  task: aiReview.task,
  result: aiReview.result,
  decisions: aiReview.decisions,
  createdAt: aiReview.createdAt,
}

function ownSubmission(id: string, studentId: string) {
  return and(
    eq(submission.assignmentId, id),
    eq(submission.studentId, studentId)
  )
}

function visibleSubmission(id: string, submissionId: string) {
  return and(
    eq(submission.id, submissionId),
    eq(submission.assignmentId, id),
    ne(submission.status, 'draft')
  )
}

function reviewsFor(submissionId: string, includeAssessment = true) {
  return db
    .select(reviewFields)
    .from(aiReview)
    .where(
      and(
        eq(aiReview.submissionId, submissionId),
        includeAssessment ? undefined : ne(aiReview.task, 'assessment')
      )
    )
    .orderBy(desc(aiReview.createdAt))
}

const editable: Record<Stage, readonly (keyof Work)[]> = {
  goals: ['goal', 'aiGoal'],
  outline: ['outline'],
  draft: ['title', 'draft', 'checked'],
  revise: ['title', 'revision', 'checked'],
  reflect: ['reflection'],
}

function validateStage(stage: Stage, work: Work) {
  const complete = {
    goals: work.goal.trim(),
    outline: work.outline.trim(),
    draft: work.title.trim() && documentText(work.draft).trim(),
    revise: work.title.trim() && documentText(work.revision).trim(),
    reflect: work.reflection.trim(),
  }
  if (!complete[stage]) throw new ApiError(400, 'incompleteStage')
}

export async function writingRoutes(app: FastifyInstance) {
  app.get('/api/me', async (request) => identity(request))

  app.get('/api/dashboard', async (request) => {
    const person = await identity(request)
    if (person.role === 'teacher') {
      const [classes, assignments] = await Promise.all([
        db
          .select({
            id: classroom.id,
            name: classroom.name,
            joinCode: classroom.joinCode,
          })
          .from(classroom)
          .where(eq(classroom.teacherId, person.id))
          .orderBy(classroom.name),
        db
          .select({ ...assignmentFields, classroomName: classroom.name })
          .from(assignment)
          .innerJoin(classroom, eq(classroom.id, assignment.classroomId))
          .where(eq(classroom.teacherId, person.id))
          .orderBy(assignment.dueAt),
      ])
      return {
        classes,
        assignments: assignments.map((row) => ({
          ...row,
          status: null,
          stage: null,
        })),
      }
    }
    const [classes, assignments] = await Promise.all([
      db
        .select({ id: classroom.id, name: classroom.name })
        .from(classroom)
        .innerJoin(enrollment, eq(enrollment.classroomId, classroom.id))
        .where(eq(enrollment.studentId, person.id))
        .orderBy(classroom.name),
      db
        .select({
          ...assignmentFields,
          classroomName: classroom.name,
          status: submission.status,
          stage: submission.stage,
        })
        .from(assignment)
        .innerJoin(classroom, eq(classroom.id, assignment.classroomId))
        .innerJoin(
          enrollment,
          and(
            eq(enrollment.classroomId, classroom.id),
            eq(enrollment.studentId, person.id)
          )
        )
        .leftJoin(
          submission,
          and(
            eq(submission.assignmentId, assignment.id),
            eq(submission.studentId, person.id)
          )
        )
        .orderBy(assignment.dueAt),
    ])
    return { classes, assignments }
  })

  app.post('/api/classes', async (request, reply) => {
    const teacher = await identity(request, 'teacher')
    const { name } = read(
      z.object({ name: z.string().trim().min(1).max(100) }),
      request.body
    )
    const [row] = await db
      .insert(classroom)
      .values({
        name,
        teacherId: teacher.id,
        joinCode: randomBytes(8).toString('hex').toUpperCase(),
      })
      .returning({
        id: classroom.id,
        name: classroom.name,
        joinCode: classroom.joinCode,
      })
    return reply.code(201).send(row)
  })

  app.post('/api/classes/join', async (request) => {
    const student = await identity(request, 'student')
    const { code } = read(
      z.object({
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-F\d]{16}$/),
      }),
      request.body
    )
    const [row] = await db
      .select({ id: classroom.id, name: classroom.name })
      .from(classroom)
      .where(eq(classroom.joinCode, code))
    if (!row) throw new ApiError(404, 'invalidJoinCode')
    await db
      .insert(enrollment)
      .values({ classroomId: row.id, studentId: student.id })
      .onConflictDoNothing()
    return row
  })

  app.post('/api/assignments', async (request, reply) => {
    const teacher = await identity(request, 'teacher')
    const { classroomId } = read(z.object({ classroomId: uuid }), request.body)
    const input = read(assignmentInput, request.body)
    const dueAt = new Date(input.dueAt)
    if (dueAt <= new Date()) throw new ApiError(400, 'invalidDeadline')
    const [owned] = await db
      .select({ id: classroom.id })
      .from(classroom)
      .where(
        and(eq(classroom.id, classroomId), eq(classroom.teacherId, teacher.id))
      )
    if (!owned) throw new ApiError(404, 'notFound')
    const [row] = await db
      .insert(assignment)
      .values({ ...input, classroomId, dueAt })
      .returning({ id: assignment.id })
    return reply.code(201).send(row)
  })

  app.get('/api/assignments/:id', async (request) => {
    const person = await identity(request)
    const { id } = read(assignmentParams, request.params)
    const row = await accessibleAssignment(id, person)
    if (person.role === 'teacher') {
      const submissions = await db
        .select({
          id: submission.id,
          studentName: user.name,
          status: submission.status,
          submittedAt: submission.submittedAt,
          title: sql<string>`${submission.work}->>'title'`,
        })
        .from(submission)
        .innerJoin(user, eq(user.id, submission.studentId))
        .where(
          and(eq(submission.assignmentId, id), ne(submission.status, 'draft'))
        )
        .orderBy(desc(submission.submittedAt))
      return { assignment: row, submissions }
    }
    const [own] = await db
      .select(submissionFields)
      .from(submission)
      .where(ownSubmission(id, person.id))
    return {
      assignment: row,
      submission: own ?? null,
      reviews: own ? await reviewsFor(own.id, own.status === 'graded') : [],
      aiEnabled,
    }
  })

  app.put('/api/assignments/:id/work', async (request) => {
    const person = await identity(request, 'student')
    const { id } = read(assignmentParams, request.params)
    const row = await accessibleAssignment(id, person)
    const { stage, version, action, changes } = read(saveInput, request.body)

    return db.transaction(async (tx) => {
      if (version === 0) {
        await tx
          .insert(submission)
          .values({ assignmentId: id, studentId: person.id, work: emptyWork })
          .onConflictDoNothing()
      }
      const [own] = await tx
        .select()
        .from(submission)
        .where(ownSubmission(id, person.id))
        .for('update')
      if (!own || own.version !== version || own.stage !== stage)
        throw new ApiError(409, 'versionConflict')
      if (own.status !== 'draft' || row.dueAt <= new Date())
        throw new ApiError(409, 'writingClosed')
      if (
        Object.keys(changes).some(
          (key) => !editable[stage].includes(key as keyof Work)
        )
      )
        throw new ApiError(400, 'invalidInput')
      const work: Work = { ...own.work, ...changes }
      if (work.checked.some((index) => index >= row.checklist.length))
        throw new ApiError(400, 'invalidInput')
      if (action === 'advance' || action === 'submit')
        validateStage(stage, work)

      let nextStage = stage
      let status: 'draft' | 'submitted' = 'draft'
      if (action === 'advance') {
        if (stage === 'reflect') throw new ApiError(400, 'invalidInput')
        nextStage = stages[stages.indexOf(stage) + 1]
        if (stage === 'draft') work.revision = work.draft
      }
      if (action === 'reviseAgain') {
        if (stage !== 'reflect') throw new ApiError(400, 'invalidInput')
        nextStage = 'revise'
      }
      if (action === 'submit') {
        if (stage !== 'reflect') throw new ApiError(400, 'invalidInput')
        const count = countWriting(work.revision, row.language)
        if (count < row.minLength || count > row.maxLength)
          throw new ApiError(400, 'lengthOutsideRange')
        status = 'submitted'
      }
      const [saved] = await tx
        .update(submission)
        .set({
          work,
          stage: nextStage,
          status,
          version: version + 1,
          submittedAt: status === 'submitted' ? new Date() : null,
        })
        .where(eq(submission.id, own.id))
        .returning(submissionFields)
      return saved
    })
  })

  app.get('/api/assignments/:id/submissions/:submissionId', async (request) => {
    const teacher = await identity(request, 'teacher')
    const { id, submissionId } = read(submissionParams, request.params)
    const row = await accessibleAssignment(id, teacher)
    const [selected] = await db
      .select({ ...submissionFields, studentName: user.name })
      .from(submission)
      .innerJoin(user, eq(user.id, submission.studentId))
      .where(visibleSubmission(id, submissionId))
    if (!selected) throw new ApiError(404, 'notFound')
    return {
      assignment: row,
      submission: selected,
      reviews: await reviewsFor(selected.id),
      aiEnabled,
    }
  })

  app.put(
    '/api/assignments/:id/submissions/:submissionId/grade',
    async (request) => {
      const teacher = await identity(request, 'teacher')
      const { id, submissionId } = read(submissionParams, request.params)
      const row = await accessibleAssignment(id, teacher)
      const grade = read(gradeInput, request.body)
      if (
        grade.scores.length !== row.rubric.length ||
        grade.scores.some((score, index) => score > row.rubric[index].max)
      ) {
        throw new ApiError(400, 'invalidScore')
      }
      const [graded] = await db
        .update(submission)
        .set({ grade, status: 'graded' })
        .where(
          and(
            visibleSubmission(id, submissionId),
            eq(submission.status, 'submitted')
          )
        )
        .returning(submissionFields)
      if (!graded) throw new ApiError(409, 'gradeUnavailable')
      return graded
    }
  )

  app.post('/api/assignments/:id/reviews', async (request, reply) => {
    const { id } = read(assignmentParams, request.params)
    const { task, submissionId } = read(
      z
        .object({ task: z.enum(aiTasks), submissionId: uuid.optional() })
        .refine((input) =>
          input.task === 'assessment'
            ? Boolean(input.submissionId)
            : input.submissionId === undefined
        ),
      request.body
    )
    const person = await identity(
      request,
      task === 'assessment' ? 'teacher' : 'student'
    )
    const row = await accessibleAssignment(id, person)
    const scope =
      task === 'assessment' && submissionId
        ? visibleSubmission(id, submissionId)
        : ownSubmission(id, person.id)
    const [target] = await db.select().from(submission).where(scope)
    if (!target) throw new ApiError(409, 'saveBeforeReview')
    if (task === 'assessment' && target.status !== 'submitted')
      throw new ApiError(409, 'gradeUnavailable')

    const studentTask = task === 'outline' || task === 'revision'
    if (studentTask) {
      if (target.status !== 'draft' || row.dueAt <= new Date())
        throw new ApiError(409, 'writingClosed')
      if (
        task === 'outline' &&
        (target.stage !== 'outline' || !target.work.outline.trim())
      )
        throw new ApiError(400, 'incompleteStage')
      if (
        task === 'revision' &&
        (target.stage !== 'revise' ||
          !documentText(target.work.revision).trim())
      )
        throw new ApiError(400, 'incompleteStage')
    }
    if (pendingReviews.has(target.id))
      throw new ApiError(429, 'reviewInProgress')
    pendingReviews.add(target.id)
    try {
      const result = await reviewWriting(task, row, target.work)
      const review = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(submission)
          .where(eq(submission.id, target.id))
          .for('update')
        if (
          studentTask &&
          (current?.version !== target.version || row.dueAt <= new Date())
        )
          throw new ApiError(409, 'versionConflict')
        if (task === 'assessment' && current?.status !== 'submitted')
          throw new ApiError(409, 'gradeUnavailable')
        const [created] = await tx
          .insert(aiReview)
          .values({ submissionId: target.id, task, result })
          .returning(reviewFields)
        return created
      })
      return reply.code(201).send(review)
    } finally {
      pendingReviews.delete(target.id)
    }
  })

  app.put(
    '/api/assignments/:id/reviews/:reviewId/decisions/:index',
    async (request) => {
      const student = await identity(request, 'student')
      const { id, reviewId, index } = read(reviewParams, request.params)
      const decision = read(decisionSchema, request.body)
      const row = await accessibleAssignment(id, student)
      return db.transaction(async (tx) => {
        const [own] = await tx
          .select()
          .from(submission)
          .where(ownSubmission(id, student.id))
          .for('update')
        if (
          !own ||
          own.status !== 'draft' ||
          own.stage !== 'revise' ||
          row.dueAt <= new Date()
        )
          throw new ApiError(409, 'writingClosed')
        const [review] = await tx
          .select()
          .from(aiReview)
          .where(
            and(
              eq(aiReview.id, reviewId),
              eq(aiReview.submissionId, own.id),
              eq(aiReview.task, 'revision')
            )
          )
          .for('update')
        if (!review?.result.suggestions[index])
          throw new ApiError(404, 'notFound')
        const [updated] = await tx
          .update(aiReview)
          .set({ decisions: { ...review.decisions, [index]: decision } })
          .where(eq(aiReview.id, reviewId))
          .returning(reviewFields)
        return updated
      })
    }
  )
}
