import { z } from 'zod'
import { and, desc, eq, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  peerFeedback,
  type PeerReviewDirectory,
  type PeerReviewItem,
} from '../shared/peer.ts'
import { citedSources } from '../shared/writing.ts'
import { assignmentForWrite } from './assignments.ts'
import { db, type Transaction } from './db.ts'
import { ApiError, read } from './errors.ts'
import { identity } from './identity.ts'
import { enrollment, peerReview, submission, user } from './schema.ts'

function roster(classroomId: string, conn: typeof db | Transaction = db) {
  return conn
    .select({ id: user.id, name: user.name })
    .from(enrollment)
    .innerJoin(user, eq(enrollment.studentId, user.id))
    .where(
      and(
        eq(enrollment.classroomId, classroomId),
        eq(enrollment.removed, false),
        eq(user.disabled, false),
        eq(user.role, 'student')
      )
    )
    .orderBy(user.name)
}

const reviewId = z.object({ reviewId: z.uuid() })
const actions = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('assign'),
    submissionId: z.uuid(),
    version: z.number().int().min(1),
    reviewerId: z.string().min(1).max(128),
  }),
  reviewId.extend({ action: z.literal('feedback'), feedback: peerFeedback }),
  reviewId.extend({ action: z.literal('decline') }),
  reviewId.extend({
    action: z.literal('report'),
    reason: z.string().trim().min(1).max(1000),
  }),
  reviewId.extend({ action: z.literal('resolve') }),
  reviewId.extend({ action: z.literal('revoke') }),
])

export async function peerRoutes(app: FastifyInstance) {
  app.get(
    '/api/assignments/:id/peers',
    async (request): Promise<PeerReviewDirectory> => {
      const person = await identity(request)
      if (person.role === 'admin') throw new ApiError(403, 'forbidden')
      const { id } = read(z.object({ id: z.uuid() }), request.params)
      return db.transaction(async (tx) => {
        const row = await assignmentForWrite(tx, id, person)
        const teacher = person.role === 'teacher'
        if (row.archived && !teacher) return { reviews: [], readOnly: true }
        const students = await roster(row.classroomId, tx)
        const rows = await tx
          .select({ item: peerReview, target: submission, author: user.name })
          .from(peerReview)
          .innerJoin(submission, eq(peerReview.submissionId, submission.id))
          .innerJoin(user, eq(submission.studentId, user.id))
          .where(eq(submission.assignmentId, id))
          .orderBy(desc(peerReview.createdAt))
        const submissions = teacher
          ? await tx
              .select({
                id: submission.id,
                version: submission.version,
                name: user.name,
                studentId: submission.studentId,
              })
              .from(submission)
              .innerJoin(user, eq(submission.studentId, user.id))
              .where(
                and(
                  eq(submission.assignmentId, id),
                  ne(submission.status, 'draft')
                )
              )
          : []
        const active = new Map(
          students.map((student) => [student.id, student.name])
        )
        const reviews: PeerReviewItem[] = []
        const ownAssignments = rows.filter(
          ({ item, target }) =>
            target.studentId === person.id &&
            target.status !== 'draft' &&
            target.version === item.submissionVersion &&
            ['assigned', 'submitted'].includes(item.status) &&
            active.has(item.reviewerId)
        )
        const authorDebate =
          ownAssignments.length >= 2
            ? {
                students: ownAssignments.map(({ item }) => ({
                  id: item.reviewerId,
                  name: active.get(item.reviewerId)!,
                })),
                submissions: [
                  {
                    id: ownAssignments[0].target.id,
                    version: ownAssignments[0].target.version,
                    name: person.name,
                  },
                ],
              }
            : undefined
        for (const { item, target, author } of rows) {
          const current =
            target.version === item.submissionVersion &&
            target.status !== 'draft'
          const role = teacher
            ? 'teacher'
            : person.id === item.reviewerId
              ? 'reviewer'
              : person.id === target.studentId
                ? 'author'
                : null
          if (
            !role ||
            (!teacher &&
              (!active.has(item.reviewerId) ||
                !active.has(target.studentId) ||
                item.status === 'revoked'))
          )
            continue
          const reported = Boolean(item.report && !item.report.resolved)
          const required = current
            ? target.requirements
            : target.returned?.requirements
          const rubric = required?.rubric ?? row.rubric
          const cited = citedSources(target.work.revision)
          reviews.push({
            id: item.id,
            role,
            author,
            reviewer: active.get(item.reviewerId) ?? '',
            status:
              !current && item.status === 'assigned' ? 'revoked' : item.status,
            reported,
            canReport:
              role !== 'teacher' && item.status === 'submitted' && !item.report,
            rubric,
            feedback: teacher || !reported ? item.feedback : null,
            ...(teacher && item.report
              ? { reportReason: item.report.reason }
              : {}),
            ...(role === 'reviewer' && current && item.status === 'assigned'
              ? {
                  paper: {
                    title: target.work.revisionTitle ?? target.work.title,
                    doc: target.work.revision,
                    rubric,
                    references: (target.work.sources ?? [])
                      .filter((source) => cited.has(source.id))
                      .map((source) => ({
                        ...source,
                        evidence: '',
                        locator: '',
                      })),
                  },
                }
              : {}),
          })
        }
        return {
          reviews,
          readOnly: row.archived,
          ...(authorDebate ? { authorDebate } : {}),
          ...(teacher
            ? {
                students,
                submissions: submissions
                  .filter((item) => active.has(item.studentId))
                  .map(({ id, version, name }) => ({ id, version, name })),
              }
            : {}),
        }
      })
    }
  )

  app.post('/api/assignments/:id/peers', async (request) => {
    const person = await identity(request)
    if (person.role === 'admin') throw new ApiError(403, 'forbidden')
    const { id } = read(z.object({ id: z.uuid() }), request.params)
    const change = read(actions, request.body)
    const teacherAction = ['assign', 'resolve', 'revoke'].includes(
      change.action
    )
    if (teacherAction !== (person.role === 'teacher'))
      throw new ApiError(403, 'forbidden')
    return db.transaction(async (tx) => {
      const row = await assignmentForWrite(tx, id, person)
      if (row.archived) throw new ApiError(409, 'peerUnavailable')
      const active = new Set(
        (await roster(row.classroomId, tx)).map((item) => item.id)
      )
      if (change.action === 'assign') {
        const [target] = await tx
          .select()
          .from(submission)
          .where(
            and(
              eq(submission.id, change.submissionId),
              eq(submission.assignmentId, id)
            )
          )
        if (
          !target ||
          target.status === 'draft' ||
          target.version !== change.version ||
          !active.has(target.studentId) ||
          !active.has(change.reviewerId) ||
          target.studentId === change.reviewerId
        )
          throw new ApiError(409, 'peerUnavailable')
        const [created] = await tx
          .insert(peerReview)
          .values({
            reviewerId: change.reviewerId,
            submissionId: target.id,
            submissionVersion: target.version,
          })
          .onConflictDoNothing()
          .returning({ id: peerReview.id })
        if (!created) throw new ApiError(409, 'peerUnavailable')
        return created
      }
      const [found] = await tx
        .select({ item: peerReview, target: submission })
        .from(peerReview)
        .innerJoin(submission, eq(peerReview.submissionId, submission.id))
        .where(
          and(
            eq(peerReview.id, change.reviewId),
            eq(submission.assignmentId, id)
          )
        )
      if (!found) throw new ApiError(404, 'notFound')
      const { item, target } = found
      if (
        !teacherAction &&
        (!active.has(item.reviewerId) ||
          !active.has(target.studentId) ||
          ![item.reviewerId, target.studentId].includes(person.id))
      )
        throw new ApiError(404, 'notFound')
      if (item.status === 'revoked') throw new ApiError(409, 'peerUnavailable')
      let update: Partial<typeof peerReview.$inferInsert>
      switch (change.action) {
        case 'feedback': {
          const rubric = target.requirements?.rubric ?? row.rubric
          if (
            person.id !== item.reviewerId ||
            item.status !== 'assigned' ||
            target.status === 'draft' ||
            target.version !== item.submissionVersion ||
            change.feedback.criterion >= rubric.length
          )
            throw new ApiError(409, 'peerUnavailable')
          update = { status: 'submitted', feedback: change.feedback }
          break
        }
        case 'decline':
          if (item.status !== 'assigned')
            throw new ApiError(409, 'peerUnavailable')
          update = { status: 'declined' }
          break
        case 'report':
          if (item.status !== 'submitted' || item.report)
            throw new ApiError(409, 'peerUnavailable')
          update = {
            report: { by: person.id, reason: change.reason, resolved: false },
          }
          break
        case 'resolve':
          if (!item.report || item.report.resolved)
            throw new ApiError(409, 'peerUnavailable')
          update = { report: { ...item.report, resolved: true } }
          break
        case 'revoke':
          update = { status: 'revoked' }
          break
      }
      await tx.update(peerReview).set(update).where(eq(peerReview.id, item.id))
      return { id: item.id }
    })
  })
}
