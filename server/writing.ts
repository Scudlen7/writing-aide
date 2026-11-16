import { z } from 'zod'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  aiTasks,
  assignmentInput,
  blockText,
  countWriting,
  decisionSchema,
  documentText,
  emptyWork,
  gradeInput,
  incompleteBefore,
  saveInput,
  stages,
  type Stage,
  type Work,
} from '../shared/writing.ts'
import { aiEnabled, reviewWriting } from './ai.ts'
import {
  accessibleAssignment,
  assignmentFields,
  assignmentForWrite,
  assignmentRequirements,
  startedWriting,
} from './assignments.ts'
import { db } from './db.ts'
import { ApiError, read } from './errors.ts'
import { identity } from './identity.ts'
import { studentCount } from './management.ts'
import {
  aiReview,
  assignment,
  classroom,
  enrollment,
  notification,
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

const submissionFields = {
  id: submission.id,
  stage: submission.stage,
  openedStage: submission.openedStage,
  status: submission.status,
  version: submission.version,
  work: submission.work,
  grade: submission.grade,
  submittedAt: submission.submittedAt,
  requirements: submission.requirements,
}
const reviewFields = {
  id: aiReview.id,
  task: aiReview.task,
  result: aiReview.result,
  source: aiReview.source,
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
  revise: ['title', 'revisionTitle', 'revision', 'checked'],
  reflect: ['reflection'],
}

export async function writingRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (request) => {
    const person = await identity(request)
    if (person.role === 'admin') throw new ApiError(403, 'forbidden')
    if (person.role === 'teacher') {
      const [classes, assignments] = await Promise.all([
        db
          .select({
            id: classroom.id,
            name: classroom.name,
            joinCode: classroom.joinCode,
            archived: classroom.archived,
            studentCount,
          })
          .from(classroom)
          .where(eq(classroom.teacherId, person.id))
          .orderBy(classroom.name),
        db
          .select({
            ...assignmentFields,
            classroomName: classroom.name,
            pendingSubmissions: sql<number>`(
              select count(*)::int from ${submission}
              where ${submission.assignmentId} = ${assignment.id}
                and ${submission.status} = 'submitted'
            )`,
          })
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
        .where(
          and(
            eq(enrollment.studentId, person.id),
            eq(enrollment.removed, false)
          )
        )
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
            eq(enrollment.studentId, person.id),
            eq(enrollment.removed, false)
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
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: classroom.id, name: classroom.name })
        .from(classroom)
        .where(and(eq(classroom.joinCode, code), eq(classroom.archived, false)))
        .for('update')
      if (!row) throw new ApiError(404, 'invalidJoinCode')
      const [member] = await tx
        .select({ removed: enrollment.removed })
        .from(enrollment)
        .where(
          and(
            eq(enrollment.classroomId, row.id),
            eq(enrollment.studentId, student.id)
          )
        )
      if (member?.removed) throw new ApiError(403, 'membershipRemoved')
      await tx
        .insert(enrollment)
        .values({ classroomId: row.id, studentId: student.id })
        .onConflictDoNothing()
      return row
    })
  })

  app.post('/api/assignments', async (request, reply) => {
    const teacher = await identity(request, 'teacher')
    const { classroomId } = read(z.object({ classroomId: uuid }), request.body)
    const input = read(assignmentInput, request.body)
    const dueAt = new Date(input.dueAt)
    if (dueAt <= new Date()) throw new ApiError(400, 'invalidDeadline')
    const row = await db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: classroom.id })
        .from(classroom)
        .where(
          and(
            eq(classroom.id, classroomId),
            eq(classroom.teacherId, teacher.id),
            eq(classroom.archived, false)
          )
        )
        .for('update')
      if (!owned) throw new ApiError(404, 'notFound')
      const [created] = await tx
        .insert(assignment)
        .values({ ...input, classroomId, dueAt })
        .returning({ id: assignment.id })
      return created
    })
    return reply.code(201).send(row)
  })

  app.get('/api/assignments/:id', async (request) => {
    const person = await identity(request)
    if (person.role === 'admin') throw new ApiError(403, 'forbidden')
    const { id } = read(assignmentParams, request.params)
    const row = await accessibleAssignment(id, person)
    if (person.role === 'teacher') {
      const submissions = await db
        .select({
          id: submission.id,
          studentName: user.name,
          status: submission.status,
          submittedAt: submission.submittedAt,
          title: sql<string>`coalesce(${submission.work}->>'revisionTitle', ${submission.work}->>'title')`,
        })
        .from(submission)
        .innerJoin(user, eq(user.id, submission.studentId))
        .where(
          and(eq(submission.assignmentId, id), ne(submission.status, 'draft'))
        )
        .orderBy(desc(submission.submittedAt))
      return { assignment: row, submissions, started: await startedWriting(id) }
    }
    const [own] = await db
      .select(submissionFields)
      .from(submission)
      .where(ownSubmission(id, person.id))
    return {
      assignment: { ...row, ...own?.requirements },
      submission: own ?? null,
      reviews: own ? await reviewsFor(own.id, own.status === 'graded') : [],
      aiEnabled,
    }
  })

  app.put('/api/assignments/:id/work', async (request) => {
    const person = await identity(request, 'student')
    const { id } = read(assignmentParams, request.params)
    const { stage, version, action, target, changes } = read(
      saveInput,
      request.body
    )

    return db.transaction(async (tx) => {
      const row = await assignmentForWrite(tx, id, person)
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
      if (own.status !== 'draft' || row.archived || row.dueAt <= new Date())
        throw new ApiError(409, 'writingClosed')
      if (
        Object.keys(changes).some(
          (key) => !editable[stage].includes(key as keyof Work)
        )
      )
        throw new ApiError(400, 'invalidInput')
      const work: Work = { ...own.work, ...changes }
      if (stage === 'revise' && changes.title !== undefined) {
        work.revisionTitle = changes.revisionTitle ?? changes.title
        work.title = own.work.title
      }
      if (work.checked.some((index) => index >= row.checklist.length))
        throw new ApiError(400, 'invalidInput')
      let nextStage = target ?? stage
      let openedStage = own.openedStage
      let status: 'draft' | 'submitted' = 'draft'
      if (action === 'advance') {
        if (stage === 'reflect') throw new ApiError(400, 'invalidInput')
        nextStage = stages[stages.indexOf(stage) + 1]
      }
      if (action === 'reviseAgain') {
        if (stage !== 'reflect') throw new ApiError(400, 'invalidInput')
        nextStage = 'revise'
      }
      if ((action === 'navigate') !== Boolean(target))
        throw new ApiError(400, 'invalidInput')
      if (nextStage !== stage) {
        const index = stages.indexOf(nextStage)
        const opened = stages.indexOf(openedStage)
        if (
          index > opened + 1 ||
          (index > opened && stages.indexOf(stage) !== opened)
        )
          throw new ApiError(400, 'incompleteStage')
        if (index > stages.indexOf(stage) && incompleteBefore(nextStage, work))
          throw new ApiError(400, 'incompleteStage')
        if (index > opened) {
          openedStage = nextStage
          if (nextStage === 'revise') {
            work.revision = work.draft
            work.revisionTitle = work.title
          }
        }
      }
      if (action === 'submit') {
        if (stage !== 'reflect') throw new ApiError(400, 'invalidInput')
        if (incompleteBefore('reflect', work) || !work.reflection.trim())
          throw new ApiError(400, 'incompleteStage')
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
          openedStage,
          status,
          version: version + 1,
          submittedAt: status === 'submitted' ? new Date() : null,
          requirements:
            status === 'submitted' ? assignmentRequirements(row) : null,
        })
        .where(eq(submission.id, own.id))
        .returning(submissionFields)
      if (status === 'submitted') {
        const [recipient] = await tx
          .select({ id: user.id })
          .from(classroom)
          .innerJoin(user, eq(user.id, classroom.teacherId))
          .where(
            and(
              eq(classroom.id, row.classroomId),
              eq(user.submissionNotifications, true)
            )
          )
        if (recipient)
          await tx
            .insert(notification)
            .values({
              recipientId: recipient.id,
              assignmentId: id,
              submissionId: saved.id,
              kind: 'submission',
              eventKey: `submission:${saved.id}`,
            })
            .onConflictDoNothing()
      }
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
      assignment: { ...row, ...selected.requirements },
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
      const grade = read(gradeInput, request.body)
      return db.transaction(async (tx) => {
        const row = await assignmentForWrite(tx, id, teacher)
        const [selected] = await tx
          .select()
          .from(submission)
          .where(visibleSubmission(id, submissionId))
          .for('update')
        if (selected?.status !== 'submitted')
          throw new ApiError(409, 'gradeUnavailable')
        const rubric = selected.requirements?.rubric ?? row.rubric
        if (
          grade.scores.length !== rubric.length ||
          grade.scores.some((score, index) => score > rubric[index].max) ||
          (grade.criteriaFeedback &&
            grade.criteriaFeedback.length !== rubric.length)
        )
          throw new ApiError(400, 'invalidScore')
        if (
          grade.annotations?.some(({ block, criterion }) => {
            const paragraph = selected.work.revision.content[block]
            return (
              paragraph?.type !== 'paragraph' ||
              !blockText(paragraph).trim() ||
              (criterion !== undefined && criterion >= rubric.length)
            )
          })
        )
          throw new ApiError(400, 'invalidAnnotation')
        const [graded] = await tx
          .update(submission)
          .set({ grade, status: 'graded' })
          .where(eq(submission.id, selected.id))
          .returning(submissionFields)
        await tx
          .insert(notification)
          .values({
            recipientId: selected.studentId,
            assignmentId: id,
            submissionId,
            kind: 'grade',
            eventKey: `grade:${submissionId}`,
          })
          .onConflictDoNothing()
        return graded
      })
    }
  )

  app.post('/api/assignments/:id/reviews', async (request, reply) => {
    const { id } = read(assignmentParams, request.params)
    const { task, submissionId, block, version } = read(
      z
        .object({
          task: z.enum(aiTasks),
          submissionId: uuid.optional(),
          block: z.number().int().min(0).max(1999).optional(),
          version: z.number().int().min(0).optional(),
        })
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
      if (target.status !== 'draft' || row.archived || row.dueAt <= new Date())
        throw new ApiError(409, 'writingClosed')
      if (version !== undefined && version !== target.version)
        throw new ApiError(409, 'versionConflict')
      if (
        task === 'outline' &&
        (target.stage !== 'outline' || !target.work.outline.trim())
      )
        throw new ApiError(400, 'incompleteStage')
      if (task === 'revision' && target.stage !== 'revise')
        throw new ApiError(400, 'incompleteStage')
    }
    const paragraph =
      block === undefined ? undefined : target.work.revision.content[block]
    if (
      task === 'revision' &&
      (paragraph?.type !== 'paragraph' || !blockText(paragraph).trim())
    )
      throw new ApiError(400, 'selectParagraph')
    const content =
      task === 'outline'
        ? target.work.outline
        : task === 'revision' && paragraph
          ? blockText(paragraph)
          : documentText(target.work.revision)
    const source = studentTask
      ? {
          version: target.version,
          text: content,
          ...(task === 'revision' ? { block } : {}),
        }
      : null
    if (pendingReviews.has(target.id))
      throw new ApiError(429, 'reviewInProgress')
    pendingReviews.add(target.id)
    try {
      const result = await reviewWriting(
        task,
        target.requirements ?? row,
        content
      )
      const review = await db.transaction(async (tx) => {
        const latest = await assignmentForWrite(tx, id, person)
        const [current] = await tx
          .select()
          .from(submission)
          .where(eq(submission.id, target.id))
          .for('update')
        if (
          studentTask &&
          (current?.status !== 'draft' ||
            latest.archived ||
            latest.dueAt <= new Date())
        )
          throw new ApiError(409, 'writingClosed')
        if (task === 'assessment' && current?.status !== 'submitted')
          throw new ApiError(409, 'gradeUnavailable')
        const [created] = await tx
          .insert(aiReview)
          .values({ submissionId: target.id, task, result, source })
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
      return db.transaction(async (tx) => {
        const row = await assignmentForWrite(tx, id, student)
        const [own] = await tx
          .select()
          .from(submission)
          .where(ownSubmission(id, student.id))
          .for('update')
        if (
          !own ||
          own.status !== 'draft' ||
          (own.stage !== 'revise' && own.stage !== 'outline') ||
          row.archived ||
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
              eq(aiReview.task, own.stage === 'revise' ? 'revision' : 'outline')
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
