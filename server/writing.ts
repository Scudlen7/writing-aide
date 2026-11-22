import { z } from 'zod'
import { and, desc, eq, isNotNull, ne, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { doiSchema, referenceReady } from '../shared/references.ts'
import {
  aiTasks,
  aiAllowed,
  assignmentInput,
  blockText,
  citedSources,
  countWriting,
  decisionSchema,
  documentText,
  emptyWork,
  gradeDraftInput,
  gradeInput,
  incompleteBefore,
  personalGoalItems,
  saveInput,
  stages,
  writingFocuses,
  type AssignmentInput,
  type CourseProgress,
  type GradeDraftInput,
  type GradeInput,
  type Identity,
  type ReturnedPaper,
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
import { config } from './config.ts'
import { db, type Transaction } from './db.ts'
import { ApiError, read } from './errors.ts'
import { identity } from './identity.ts'
import { studentCount } from './management.ts'
import { exportPaper } from './paper-export.ts'
import { lookupReference } from './references.ts'
import {
  aiReview,
  aiRequestEvent,
  assignment,
  classroom,
  enrollment,
  managementAudit,
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
  returned: submission.returned,
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

function submittedOrReturned(id: string, submissionId: string) {
  return and(
    eq(submission.id, submissionId),
    eq(submission.assignmentId, id),
    or(ne(submission.status, 'draft'), isNotNull(submission.returned))
  )
}

function writingDeadline(
  dueAt: Date,
  returned: ReturnedPaper | null | undefined
) {
  return returned ? new Date(returned.dueAt) : dueAt
}

async function gradeTarget(
  tx: Transaction,
  id: string,
  submissionId: string,
  teacher: Identity
) {
  const row = await assignmentForWrite(tx, id, teacher)
  const [selected] = await tx
    .select()
    .from(submission)
    .where(visibleSubmission(id, submissionId))
    .for('update')
  if (selected?.status !== 'submitted')
    throw new ApiError(409, 'gradeUnavailable')
  return { selected, rubric: selected.requirements?.rubric ?? row.rubric }
}

function validateGrade(
  grade: GradeInput | GradeDraftInput,
  work: Work,
  rubric: AssignmentInput['rubric']
) {
  if (
    grade.scores.length !== rubric.length ||
    grade.scores.some(
      (score, index) => score !== null && score > rubric[index].max
    ) ||
    (grade.criteriaFeedback && grade.criteriaFeedback.length !== rubric.length)
  )
    throw new ApiError(400, 'invalidScore')
  if (
    grade.annotations?.some(({ block, criterion }) => {
      const paragraph = work.revision.content[block]
      return (
        paragraph?.type !== 'paragraph' ||
        !blockText(paragraph).trim() ||
        (criterion !== undefined && criterion >= rubric.length)
      )
    })
  )
    throw new ApiError(400, 'invalidAnnotation')
}

function reviewsFor(
  submissionId: string,
  includeAssessment = true,
  attempt = 1,
  teacher = false
) {
  return db
    .select({
      ...reviewFields,
      ...(teacher ? { calibration: aiReview.calibration } : {}),
    })
    .from(aiReview)
    .where(
      and(
        eq(aiReview.submissionId, submissionId),
        eq(aiReview.attempt, attempt),
        includeAssessment ? undefined : ne(aiReview.task, 'assessment')
      )
    )
    .orderBy(desc(aiReview.createdAt))
}

const editable: Record<Stage, readonly (keyof Work)[]> = {
  goals: ['goal', 'aiGoal', 'personalGoals'],
  outline: ['outline'],
  draft: ['title', 'draft', 'checked', 'completedGoals', 'sources'],
  revise: [
    'title',
    'revisionTitle',
    'revision',
    'checked',
    'completedGoals',
    'sources',
  ],
  reflect: ['reflection', 'aiDeclaration', 'completedGoals'],
}

export async function writingRoutes(app: FastifyInstance) {
  app.get('/api/admin/diagnostics', async (request) => {
    await identity(request, 'admin')
    const [model, changes] = await Promise.all([
      db
        .select()
        .from(aiRequestEvent)
        .orderBy(desc(aiRequestEvent.createdAt))
        .limit(30),
      db
        .select({
          id: managementAudit.id,
          actor: user.name,
          action: managementAudit.action,
          targetId: managementAudit.targetId,
          createdAt: managementAudit.createdAt,
        })
        .from(managementAudit)
        .innerJoin(user, eq(managementAudit.actorId, user.id))
        .orderBy(desc(managementAudit.createdAt))
        .limit(30),
    ])
    return { model, changes }
  })
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
            progress: sql<Record<CourseProgress, number>>`(
              select json_build_object(
                'notStarted', count(*) filter (where ${submission.id} is null),
                'draft', count(*) filter (where ${submission.status} = 'draft'),
                'submitted', count(*) filter (where ${submission.status} = 'submitted'),
                'graded', count(*) filter (where ${submission.status} = 'graded')
              ) from ${enrollment}
              join ${user} on ${user.id} = ${enrollment.studentId}
              left join ${submission} on ${submission.studentId} = ${enrollment.studentId} and ${submission.assignmentId} = ${assignment.id}
              where ${enrollment.classroomId} = ${classroom.id}
                and not ${enrollment.removed} and not ${user.disabled} and ${user.role} = 'student'
            )`,
          })
          .from(assignment)
          .innerJoin(classroom, eq(classroom.id, assignment.classroomId))
          .where(eq(classroom.teacherId, person.id))
          .orderBy(assignment.dueAt),
      ])
      return {
        classes,
        assignments: assignments.map(({ progress, ...row }) => ({
          ...row,
          ...(row.archived
            ? { pendingSubmissions: 0 }
            : { progress, pendingSubmissions: progress.submitted }),
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
          dueAt:
            sql<Date>`coalesce((${submission.returned}->>'dueAt')::timestamptz, ${assignment.dueAt})`.mapWith(
              assignment.dueAt
            ),
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
        .values({
          ...input,
          aiPolicy: input.aiPolicy ?? [...aiTasks],
          classroomId,
          dueAt,
        })
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
          submittedAt: sql<string>`coalesce(${submission.submittedAt}::text, ${submission.returned}->>'submittedAt')`,
          returned: sql<boolean>`${submission.returned} is not null`,
          title: sql<string>`case when ${submission.status} = 'draft' then coalesce(${submission.returned}->'work'->>'revisionTitle', ${submission.returned}->'work'->>'title') else coalesce(${submission.work}->>'revisionTitle', ${submission.work}->>'title') end`,
        })
        .from(submission)
        .innerJoin(user, eq(user.id, submission.studentId))
        .where(
          and(
            eq(submission.assignmentId, id),
            or(ne(submission.status, 'draft'), isNotNull(submission.returned))
          )
        )
        .orderBy(desc(submission.submittedAt))
      const students = row.archived
        ? []
        : await db
            .select({
              id: user.id,
              name: user.name,
              status: sql<CourseProgress>`coalesce(${submission.status}, 'notStarted')`,
              submissionId: sql<
                string | null
              >`case when ${submission.status} <> 'draft' or ${submission.returned} is not null then ${submission.id} else null end`,
            })
            .from(enrollment)
            .innerJoin(user, eq(user.id, enrollment.studentId))
            .leftJoin(
              submission,
              and(
                eq(submission.assignmentId, id),
                eq(submission.studentId, user.id)
              )
            )
            .where(
              and(
                eq(enrollment.classroomId, row.classroomId),
                eq(enrollment.removed, false),
                eq(user.disabled, false),
                eq(user.role, 'student')
              )
            )
            .orderBy(user.name)
      return {
        assignment: row,
        submissions,
        students,
        started: await startedWriting(id),
      }
    }
    const [own] = await db
      .select(submissionFields)
      .from(submission)
      .where(ownSubmission(id, person.id))
    return {
      assignment: {
        ...row,
        ...own?.requirements,
        ...(own?.returned && own.status === 'draft'
          ? { dueAt: own.returned.dueAt }
          : {}),
      },
      submission: own ?? null,
      reviews: own
        ? await reviewsFor(
            own.id,
            own.status === 'graded',
            own.returned ? 2 : 1
          )
        : [],
      previousReviews: own?.returned ? await reviewsFor(own.id, false) : [],
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
      const dueAt = writingDeadline(row.dueAt, own.returned)
      if (own.status !== 'draft' || row.archived || dueAt <= new Date())
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
      if (work.sources || changes.draft || changes.revision) {
        const sources = new Map(work.sources?.map((item) => [item.id, item]))
        const dois = (work.sources ?? []).flatMap((item) =>
          item.doi ? [item.doi] : []
        )
        if (
          sources.size !== (work.sources?.length ?? 0) ||
          new Set(dois).size !== dois.length
        )
          throw new ApiError(400, 'duplicateReference')
        for (const id of [
          ...citedSources(work.draft),
          ...citedSources(work.revision),
        ]) {
          const source = sources.get(id)
          if (!source || !referenceReady(source))
            throw new ApiError(400, 'unavailableReference')
        }
      }
      if (work.completedGoals) {
        const available = new Set(
          personalGoalItems(work).map((goal) => goal.key)
        )
        if (changes.completedGoals?.some((key) => !available.has(key)))
          throw new ApiError(400, 'invalidInput')
        work.completedGoals = [
          ...new Set(work.completedGoals.filter((key) => available.has(key))),
        ]
      }
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
        if (
          row.aiPolicy !== null &&
          (!work.aiDeclaration ||
            (work.aiDeclaration.used && !work.aiDeclaration.description.trim()))
        )
          throw new ApiError(400, 'aiDeclarationRequired')
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
            status === 'submitted'
              ? assignmentRequirements({ ...row, dueAt })
              : null,
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
              eventKey: `submission:${saved.id}${saved.returned ? ':2' : ''}`,
            })
            .onConflictDoNothing()
      }
      return saved
    })
  })

  app.post('/api/assignments/:id/reference-doi', async (request) => {
    const student = await identity(request, 'student')
    const { id } = read(assignmentParams, request.params)
    const { doi } = read(z.object({ doi: doiSchema }), request.body)
    const row = await accessibleAssignment(id, student)
    const [own] = await db
      .select()
      .from(submission)
      .where(ownSubmission(id, student.id))
    if (
      own?.status !== 'draft' ||
      row.archived ||
      writingDeadline(row.dueAt, own.returned) <= new Date()
    )
      throw new ApiError(409, 'writingClosed')
    return lookupReference(student.id, doi)
  })

  app.get('/api/assignments/:id/export', async (request, reply) => {
    const student = await identity(request, 'student')
    const { id } = read(assignmentParams, request.params)
    const { previous } = read(
      z.object({ previous: z.literal('1').optional() }),
      request.query
    )
    const row = await accessibleAssignment(id, student)
    const [own] = await db
      .select(submissionFields)
      .from(submission)
      .where(ownSubmission(id, student.id))
    if (!own) throw new ApiError(404, 'notFound')
    if (previous && !own.returned) throw new ApiError(404, 'notFound')
    const attempt = previous ? own.returned : null
    const file = exportPaper(
      attempt?.work ?? own.work,
      attempt?.requirements.language ??
        own.requirements?.language ??
        row.language,
      attempt ? new Date(attempt.submittedAt) : own.submittedAt
    )
    return reply
      .header('Cache-Control', 'private, no-store')
      .header(
        'Content-Disposition',
        `attachment; filename="paper.docx"; filename*=UTF-8''${file.filename}`
      )
      .type(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      .send(await file.buffer)
  })

  app.get(
    '/api/assignments/:id/submissions/:submissionId/export',
    async (request, reply) => {
      const teacher = await identity(request, 'teacher')
      const { id, submissionId } = read(submissionParams, request.params)
      const query = read(
        z.object({ previous: z.literal('1').optional() }),
        request.query
      )
      const row = await accessibleAssignment(id, teacher)
      const [selected] = await db
        .select(submissionFields)
        .from(submission)
        .where(submittedOrReturned(id, submissionId))
      if (!selected) throw new ApiError(404, 'notFound')
      if (query.previous && !selected.returned)
        throw new ApiError(404, 'notFound')
      const previous =
        query.previous || selected.status === 'draft' ? selected.returned : null
      const file = exportPaper(
        previous?.work ?? selected.work,
        previous?.requirements.language ??
          selected.requirements?.language ??
          row.language,
        previous ? new Date(previous.submittedAt) : selected.submittedAt
      )
      return reply
        .header('Cache-Control', 'private, no-store')
        .header(
          'Content-Disposition',
          `attachment; filename="paper.docx"; filename*=UTF-8''${file.filename}`
        )
        .type(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
        .send(await file.buffer)
    }
  )

  app.get('/api/assignments/:id/submissions/:submissionId', async (request) => {
    const teacher = await identity(request, 'teacher')
    const { id, submissionId } = read(submissionParams, request.params)
    const row = await accessibleAssignment(id, teacher)
    const [selected] = await db
      .select({
        ...submissionFields,
        gradeDraft: submission.gradeDraft,
        priorGradeDraft: submission.priorGradeDraft,
        studentName: user.name,
      })
      .from(submission)
      .innerJoin(user, eq(user.id, submission.studentId))
      .where(submittedOrReturned(id, submissionId))
    if (!selected) throw new ApiError(404, 'notFound')
    const { gradeDraft, priorGradeDraft, ...visible } = selected
    const history = visible.status === 'draft' ? visible.returned : null
    return {
      assignment: {
        ...row,
        ...(history?.requirements ?? selected.requirements),
      },
      submission: history
        ? {
            ...visible,
            version: history.version,
            work: history.work,
            submittedAt: history.submittedAt,
            requirements: history.requirements,
          }
        : visible,
      gradeDraft,
      priorGradeDraft,
      previousReviews: selected.returned
        ? await reviewsFor(selected.id, true, 1, true)
        : [],
      reviews: await reviewsFor(
        selected.id,
        true,
        selected.returned && !history ? 2 : 1,
        true
      ),
      aiEnabled,
    }
  })

  app.post(
    '/api/assignments/:id/submissions/:submissionId/return',
    async (request) => {
      const teacher = await identity(request, 'teacher')
      const { id, submissionId } = read(submissionParams, request.params)
      const { version, draftVersion, reason, dueAt } = read(
        z.object({
          version: z.number().int().min(1),
          draftVersion: z.number().int().min(0),
          reason: z.string().trim().min(1).max(2000),
          dueAt: z.iso.datetime(),
        }),
        request.body
      )
      return db.transaction(async (tx) => {
        const row = await assignmentForWrite(tx, id, teacher)
        const [selected] = await tx
          .select()
          .from(submission)
          .where(visibleSubmission(id, submissionId))
          .for('update')
        const now = new Date()
        if (Date.parse(dueAt) <= now.getTime())
          throw new ApiError(400, 'invalidDeadline')
        if (
          row.archived ||
          selected?.status !== 'submitted' ||
          selected.returned ||
          !selected.submittedAt
        )
          throw new ApiError(409, 'returnUnavailable')
        if (
          selected.version !== version ||
          (selected.gradeDraft?.version ?? 0) !== draftVersion
        )
          throw new ApiError(409, 'gradeDraftConflict')
        const [active] = await tx
          .select({ id: user.id })
          .from(enrollment)
          .innerJoin(user, eq(user.id, enrollment.studentId))
          .where(
            and(
              eq(enrollment.classroomId, row.classroomId),
              eq(enrollment.studentId, selected.studentId),
              eq(enrollment.removed, false),
              eq(user.disabled, false),
              eq(user.role, 'student')
            )
          )
        if (!active) throw new ApiError(409, 'returnUnavailable')
        const returned: ReturnedPaper = {
          version,
          reason,
          dueAt,
          returnedAt: now.toISOString(),
          submittedAt: selected.submittedAt.toISOString(),
          work: selected.work,
          requirements: selected.requirements ?? assignmentRequirements(row),
        }
        await tx
          .update(submission)
          .set({
            status: 'draft',
            stage: 'revise',
            version: version + 1,
            returned,
            submittedAt: null,
            requirements: null,
            priorGradeDraft: selected.gradeDraft,
            gradeDraft: null,
            work: {
              ...selected.work,
              reflection: '',
              aiDeclaration: undefined,
            },
          })
          .where(eq(submission.id, selected.id))
        await tx.insert(notification).values({
          recipientId: selected.studentId,
          assignmentId: id,
          submissionId,
          kind: 'returned',
          eventKey: `returned:${submissionId}`,
        })
        return returned
      })
    }
  )

  app.put(
    '/api/assignments/:id/submissions/:submissionId/grade-draft',
    async (request) => {
      const teacher = await identity(request, 'teacher')
      const { id, submissionId } = read(submissionParams, request.params)
      const draft = read(
        z.object({
          version: z.number().int().min(0),
          submissionVersion: z.number().int().min(1),
          input: gradeDraftInput,
        }),
        request.body
      )
      return db.transaction(async (tx) => {
        const { selected, rubric } = await gradeTarget(
          tx,
          id,
          submissionId,
          teacher
        )
        if (
          selected.version !== draft.submissionVersion ||
          (selected.gradeDraft?.version ?? 0) !== draft.version
        )
          throw new ApiError(409, 'gradeDraftConflict')
        validateGrade(draft.input, selected.work, rubric)
        const saved = { ...draft, version: draft.version + 1 }
        await tx
          .update(submission)
          .set({ gradeDraft: saved })
          .where(eq(submission.id, submissionId))
        return saved
      })
    }
  )

  app.put(
    '/api/assignments/:id/submissions/:submissionId/grade',
    async (request) => {
      const teacher = await identity(request, 'teacher')
      const { id, submissionId } = read(submissionParams, request.params)
      const { submissionVersion, draftVersion, ...grade } = read(
        gradeInput.extend({
          submissionVersion: z.number().int().min(1).optional(),
          draftVersion: z.number().int().min(0).optional(),
        }),
        request.body
      )
      return db.transaction(async (tx) => {
        const { selected, rubric } = await gradeTarget(
          tx,
          id,
          submissionId,
          teacher
        )
        validateGrade(grade, selected.work, rubric)
        if (
          ((submissionVersion !== undefined || selected.returned) &&
            selected.version !== submissionVersion) ||
          (selected.gradeDraft?.version ?? 0) !== (draftVersion ?? 0)
        )
          throw new ApiError(409, 'gradeDraftConflict')
        const [graded] = await tx
          .update(submission)
          .set({ grade, gradeDraft: null, status: 'graded' })
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
    const {
      task,
      submissionId,
      block,
      version,
      focus,
      includeGoals,
      calibrate,
    } = read(
      z
        .object({
          task: z.enum(aiTasks),
          submissionId: uuid.optional(),
          block: z.number().int().min(0).max(1999).optional(),
          version: z.number().int().min(0).optional(),
          focus: z.enum(writingFocuses).optional(),
          includeGoals: z.boolean().optional(),
          calibrate: z.boolean().optional(),
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
    if (!aiAllowed(row, task)) throw new ApiError(403, 'aiPolicyDenied')
    const scope =
      task === 'assessment' && submissionId
        ? visibleSubmission(id, submissionId)
        : ownSubmission(id, person.id)
    const [target] = await db.select().from(submission).where(scope)
    if (!target) throw new ApiError(409, 'saveBeforeReview')
    if (!aiAllowed(target.requirements ?? row, task))
      throw new ApiError(403, 'aiPolicyDenied')
    if (task === 'assessment' && target.status !== 'submitted')
      throw new ApiError(409, 'gradeUnavailable')
    const attempt = target.returned ? 2 : 1
    const baseline = target.gradeDraft?.input.scores.filter(
      (score) => score !== null
    )
    if (
      calibrate &&
      (task !== 'assessment' ||
        baseline?.length !==
          (target.requirements?.rubric ?? row.rubric).length ||
        (await reviewsFor(target.id, true, attempt)).some(
          (review) => review.task === 'assessment'
        ))
    )
      throw new ApiError(409, 'calibrationUnavailable')

    const studentTask = task === 'outline' || task === 'revision'
    if (studentTask) {
      if (
        target.status !== 'draft' ||
        row.archived ||
        writingDeadline(row.dueAt, target.returned) <= new Date()
      )
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
          ...(focus ? { focus } : {}),
          ...(task === 'revision' ? { block } : {}),
        }
      : null
    if (pendingReviews.has(target.id))
      throw new ApiError(429, 'reviewInProgress')
    pendingReviews.add(target.id)
    try {
      const startedAt = performance.now()
      let outcome = 'success'
      const result = await reviewWriting(
        task,
        target.requirements ?? row,
        content,
        studentTask && includeGoals
          ? personalGoalItems(target.work).map(({ kind, text }) => ({
              kind,
              text,
            }))
          : undefined,
        focus
      )
        .catch((error: unknown) => {
          outcome = error instanceof ApiError ? error.code : 'aiFailed'
          throw error
        })
        .finally(async () => {
          await db
            .insert(aiRequestEvent)
            .values({
              task,
              model: config.AI_MODEL ?? '',
              outcome,
              durationMs: Math.round(performance.now() - startedAt),
            })
            .catch(() =>
              request.log.warn(
                { task, outcome },
                'Could not record model request status'
              )
            )
        })
      const review = await db.transaction(async (tx) => {
        const latest = await assignmentForWrite(tx, id, person)
        const [current] = await tx
          .select()
          .from(submission)
          .where(eq(submission.id, target.id))
          .for('update')
        if (!aiAllowed(current?.requirements ?? latest, task))
          throw new ApiError(403, 'aiPolicyDenied')
        if (
          studentTask &&
          (current?.status !== 'draft' ||
            latest.archived ||
            writingDeadline(latest.dueAt, current.returned) <= new Date())
        )
          throw new ApiError(409, 'writingClosed')
        if (Boolean(current?.returned) !== Boolean(target.returned))
          throw new ApiError(409, 'versionConflict')
        if (
          task === 'assessment' &&
          (current?.status !== 'submitted' ||
            current.version !== target.version)
        )
          throw new ApiError(409, 'gradeUnavailable')
        const [created] = await tx
          .insert(aiReview)
          .values({
            submissionId: target.id,
            task,
            result,
            source,
            attempt,
            ...(calibrate && baseline
              ? {
                  calibration: { baseline, evidence: baseline.map(() => null) },
                }
              : {}),
          })
          .returning({
            ...reviewFields,
            ...(task === 'assessment'
              ? { calibration: aiReview.calibration }
              : {}),
          })
        return created
      })
      return reply.code(201).send(review)
    } finally {
      pendingReviews.delete(target.id)
    }
  })

  app.put(
    '/api/assignments/:id/reviews/:reviewId/calibration',
    async (request) => {
      const teacher = await identity(request, 'teacher')
      const { id, reviewId } = read(
        assignmentParams.extend({ reviewId: uuid }),
        request.params
      )
      const { evidence } = read(
        z.object({ evidence: z.array(z.boolean().nullable()).min(1).max(12) }),
        request.body
      )
      return db.transaction(async (tx) => {
        await assignmentForWrite(tx, id, teacher)
        const [found] = await tx
          .select({ record: aiReview.calibration })
          .from(aiReview)
          .innerJoin(submission, eq(aiReview.submissionId, submission.id))
          .where(
            and(
              eq(aiReview.id, reviewId),
              eq(submission.assignmentId, id),
              eq(aiReview.task, 'assessment')
            )
          )
        if (!found?.record) throw new ApiError(404, 'notFound')
        if (evidence.length !== found.record.baseline.length)
          throw new ApiError(400, 'invalidInput')
        const calibration = { ...found.record, evidence }
        await tx
          .update(aiReview)
          .set({ calibration })
          .where(eq(aiReview.id, reviewId))
        return calibration
      })
    }
  )

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
          writingDeadline(row.dueAt, own.returned) <= new Date()
        )
          throw new ApiError(409, 'writingClosed')
        const [review] = await tx
          .select()
          .from(aiReview)
          .where(
            and(
              eq(aiReview.id, reviewId),
              eq(aiReview.submissionId, own.id),
              eq(aiReview.attempt, own.returned ? 2 : 1),
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
