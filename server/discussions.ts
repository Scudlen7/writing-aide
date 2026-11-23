import { z } from 'zod'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  discussionAnchor,
  discussionDecisions,
  discussionRoles,
  reviewInvitationLimit,
  type ReviewerCandidate,
} from '../shared/discussions.ts'
import { blockText, type Identity } from '../shared/writing.ts'
import { accessibleAssignment, assignmentForWrite } from './assignments.ts'
import { config } from './config.ts'
import { db, type Transaction } from './db.ts'
import {
  documentVersion,
  lockDocument,
  ownedDocument,
  sendDocumentFile,
} from './documents.ts'
import { ApiError, read } from './errors.ts'
import { identity } from './identity.ts'
import { loadPersonalWriting } from './personal-writing.ts'
import {
  enrollment,
  notification,
  peerReview,
  personalDocument,
  reviewMessage,
  reviewParticipant,
  reviewThread,
  submission,
  user,
} from './schema.ts'

const id = z.object({ id: z.uuid() })
const version = z.number().int().min(1).max(2147483647)
const topic = z.string().trim().min(1).max(2000)
const debateInput = z.object({
  version,
  topic,
  mode: z.enum(['review', 'debate']),
})
const reviewerQuery = z.object({ query: z.string().trim().min(1).max(254) })
const reviewerId = z.string().min(1).max(128)
const discussionChange = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['accept', 'reject']) }),
  z.object({
    action: z.literal('post'),
    body: topic,
    role: z.enum(discussionRoles).optional(),
    anchor: discussionAnchor.optional(),
    replyTo: z.uuid().optional(),
    criterion: z.number().int().min(0).max(11).optional(),
  }),
  z.object({
    action: z.literal('decision'),
    message: z.uuid(),
    choice: z.enum(discussionDecisions),
    reason: z.string().trim().min(1).max(1000),
    version: version.optional(),
  }),
  z
    .object({
      action: z.literal('revoke'),
      person: reviewerId.optional(),
      people: z.array(reviewerId).min(1).max(reviewInvitationLimit).optional(),
    })
    .refine(({ person, people }) => Boolean(person) !== Boolean(people)),
  z.object({ action: z.literal('end'), resolution: topic }),
  z.object({
    action: z.literal('report'),
    message: z.uuid(),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({ action: z.literal('resolve'), message: z.uuid() }),
])

type Connection = typeof db | Transaction

async function findReviewers(
  query: string,
  scope: SQL | undefined
): Promise<ReviewerCandidate[]> {
  const name = sql`lower(normalize(${user.name}, NFKC))`
  const email = sql`lower(normalize(${user.email}, NFKC))`
  const needle = sql`lower(normalize(${query}, NFKC))`
  const matches = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      and(
        scope,
        eq(user.disabled, false),
        or(
          sql`strpos(${name}, ${needle}) > 0`,
          sql`strpos(${email}, ${needle}) > 0`
        )
      )
    )
    .orderBy(
      sql`case when ${email} = ${needle} then 0 when ${name} = ${needle} then 1 else 2 end`,
      asc(user.name),
      asc(user.id)
    )
    .limit(20)
  return matches.map(({ id, name, email }) => {
    const at = email.lastIndexOf('@')
    const local = email.slice(0, at)
    const hint =
      local.length > 4
        ? `${local.slice(0, 2)}…${local.slice(-2)}`
        : `${local[0] ?? ''}…`
    return { id, name, emailHint: `${hint}${email.slice(at)}` }
  })
}

function assignedReviewers(
  conn: Connection,
  submissionId: string,
  number: number
) {
  return conn
    .select({ id: peerReview.reviewerId })
    .from(peerReview)
    .where(
      and(
        eq(peerReview.submissionId, submissionId),
        eq(peerReview.submissionVersion, number),
        inArray(peerReview.status, ['assigned', 'submitted'])
      )
    )
}

async function coursePeople(classroomId: string, tx: Connection) {
  return tx
    .select({ id: user.id, name: user.name })
    .from(enrollment)
    .innerJoin(user, eq(user.id, enrollment.studentId))
    .where(
      and(
        eq(enrollment.classroomId, classroomId),
        eq(enrollment.removed, false),
        eq(user.disabled, false),
        eq(user.role, 'student')
      )
    )
}

export async function reviewAccess(
  threadId: string,
  person: Identity,
  tx: Connection = db,
  lock?: Transaction
) {
  const [thread] = await tx
    .select()
    .from(reviewThread)
    .where(eq(reviewThread.id, threadId))
  if (!thread) throw new ApiError(404, 'notFound')
  let teacher = false
  let archived = false
  if (thread.documentId) {
    if (lock) await lockDocument(lock, thread.authorId, thread.documentId)
    const [target] = await tx
      .select({ id: personalDocument.id })
      .from(personalDocument)
      .innerJoin(user, eq(personalDocument.ownerId, user.id))
      .where(
        and(
          eq(personalDocument.id, thread.documentId),
          isNull(personalDocument.trashedAt),
          eq(user.disabled, false)
        )
      )
    if (!target) throw new ApiError(404, 'notFound')
  } else {
    const [target] = await tx
      .select()
      .from(submission)
      .where(eq(submission.id, thread.submissionId!))
    if (!target || person.role === 'admin') throw new ApiError(404, 'notFound')
    const assignment = lock
      ? await assignmentForWrite(lock, target.assignmentId, person)
      : await accessibleAssignment(target.assignmentId, person, tx)
    teacher = person.role === 'teacher'
    archived = assignment.archived
    if (!teacher) {
      const active = await coursePeople(assignment.classroomId, tx)
      if (archived || !active.some((member) => member.id === thread.authorId))
        throw new ApiError(404, 'notFound')
    }
    if (thread.peerId && !teacher) {
      const [peer] = await tx
        .select()
        .from(peerReview)
        .where(eq(peerReview.id, thread.peerId))
      if (
        !peer ||
        !['assigned', 'submitted'].includes(peer.status) ||
        !(await coursePeople(assignment.classroomId, tx)).some(
          (member) => member.id === peer.reviewerId
        )
      )
        throw new ApiError(404, 'notFound')
    }
  }
  const [fresh] = lock
    ? await lock
        .select()
        .from(reviewThread)
        .where(eq(reviewThread.id, threadId))
        .for('update')
    : [thread]
  if (!fresh) throw new ApiError(404, 'notFound')
  const [membership] = await tx
    .select()
    .from(reviewParticipant)
    .where(
      and(
        eq(reviewParticipant.threadId, threadId),
        eq(reviewParticipant.personId, person.id)
      )
    )
  const owner = thread.authorId === person.id
  const status = owner ? 'owner' : teacher ? 'teacher' : membership?.state
  if (
    thread.submissionId &&
    thread.mode === 'debate' &&
    thread.hostId === thread.authorId &&
    !owner &&
    !teacher
  ) {
    const [assigned] = await tx
      .select({ id: peerReview.id })
      .from(peerReview)
      .where(
        and(
          eq(peerReview.submissionId, thread.submissionId),
          eq(peerReview.submissionVersion, thread.version),
          eq(peerReview.reviewerId, person.id),
          inArray(peerReview.status, ['assigned', 'submitted'])
        )
      )
    if (!assigned) throw new ApiError(404, 'notFound')
  }
  if (
    !status ||
    status === 'revoked' ||
    status === 'rejected' ||
    (status === 'pending' &&
      membership.expiresAt &&
      membership.expiresAt <= new Date())
  )
    throw new ApiError(404, 'notFound')
  return {
    thread: fresh,
    status,
    canRead: status !== 'pending',
    canWrite: status !== 'pending' && !fresh.endedAt && !archived,
    canManage: !archived && (owner || teacher || fresh.hostId === person.id),
    canDecide: owner && !archived,
  }
}

export async function reviewParagraphs(
  target: Pick<
    typeof reviewThread.$inferSelect,
    'documentId' | 'version' | 'courseParagraphs'
  >
) {
  if (!target.documentId) return target.courseParagraphs ?? []
  const row = await documentVersion(target.documentId, target.version)
  if (row.format === 'writing') {
    const { work } = await loadPersonalWriting(
      target.documentId,
      target.version
    )
    return (
      work.revision.content.some((block) => blockText(block).trim())
        ? work.revision
        : work.draft
    ).content.map(blockText)
  }
  return row.text?.split('\n') ?? []
}

async function notifyReview(
  tx: Transaction,
  threadId: string,
  recipients: string[],
  kind: 'reviewInvited' | 'reviewComment' | 'reviewReply',
  eventKey: string
) {
  const distinct = [...new Set(recipients)]
  if (distinct.length)
    await tx
      .insert(notification)
      .values(
        distinct.map((recipientId) => ({
          recipientId,
          reviewThreadId: threadId,
          kind,
          eventKey,
        }))
      )
      .onConflictDoNothing()
}

async function invite(
  tx: Transaction,
  threadId: string,
  participants: string[],
  pending: boolean
) {
  const expiresAt = pending
    ? new Date(Date.now() + config.DOCUMENT_INVITE_DAYS * 86400_000)
    : null
  await tx.insert(reviewParticipant).values(
    participants.map((personId) => ({
      threadId,
      personId,
      state: pending ? ('pending' as const) : ('accepted' as const),
      expiresAt,
    }))
  )
  await notifyReview(
    tx,
    threadId,
    participants,
    'reviewInvited',
    `review:${threadId}:invite`
  )
}

export async function discussionRoutes(app: FastifyInstance) {
  app.get('/api/documents/:id/reviewers', async (request) => {
    const person = await identity(request)
    const { id: documentId } = read(id, request.params)
    const { query } = read(reviewerQuery, request.query)
    await ownedDocument(person.id, documentId)
    return findReviewers(query, ne(user.id, person.id))
  })

  app.get('/api/assignments/:id/reviewers', async (request) => {
    const person = await identity(request)
    if (person.role === 'admin') throw new ApiError(404, 'notFound')
    const { id: assignmentId } = read(id, request.params)
    const {
      query,
      submissionId,
      version: number,
    } = read(
      reviewerQuery.extend({
        submissionId: z.uuid(),
        version: z.coerce.number().pipe(version),
      }),
      request.query
    )
    const assignment = await accessibleAssignment(assignmentId, person)
    if (assignment.archived) throw new ApiError(409, 'peerUnavailable')
    const [target] = await db
      .select({
        studentId: submission.studentId,
        version: submission.version,
        status: submission.status,
        returned: submission.returned,
      })
      .from(submission)
      .where(
        and(
          eq(submission.id, submissionId),
          eq(submission.assignmentId, assignmentId)
        )
      )
    const active = await coursePeople(assignment.classroomId, db)
    if (
      !target ||
      !active.some((member) => member.id === target.studentId) ||
      (person.role !== 'teacher' && person.id !== target.studentId)
    )
      throw new ApiError(404, 'notFound')
    if (
      !(target.version === number && target.status !== 'draft') &&
      target.returned?.version !== number
    )
      throw new ApiError(409, 'peerUnavailable')
    return findReviewers(
      query,
      and(
        inArray(
          user.id,
          active.map((member) => member.id)
        ),
        ne(user.id, target.studentId),
        person.role === 'teacher'
          ? undefined
          : inArray(user.id, assignedReviewers(db, submissionId, number))
      )
    )
  })

  app.get('/api/review-discussions', async (request) => {
    const person = await identity(request)
    const filter = read(
      z.object({
        document: z.uuid().optional(),
        assignment: z.uuid().optional(),
      }),
      request.query
    )
    const candidates = await db
      .select({ id: reviewThread.id })
      .from(reviewThread)
      .leftJoin(
        reviewParticipant,
        and(
          eq(reviewParticipant.threadId, reviewThread.id),
          eq(reviewParticipant.personId, person.id)
        )
      )
      .leftJoin(submission, eq(reviewThread.submissionId, submission.id))
      .where(
        and(
          filter.document
            ? eq(reviewThread.documentId, filter.document)
            : undefined,
          filter.assignment
            ? eq(submission.assignmentId, filter.assignment)
            : undefined,
          person.role === 'teacher' && filter.assignment
            ? undefined
            : or(
                eq(reviewThread.authorId, person.id),
                eq(reviewParticipant.personId, person.id),
                eq(reviewThread.hostId, person.id)
              )
        )
      )
      .orderBy(desc(reviewThread.createdAt))
      .limit(100)
    const items = []
    for (const candidate of candidates) {
      try {
        const { thread, status } = await reviewAccess(candidate.id, person)
        items.push({
          id: thread.id,
          title: thread.title,
          topic: thread.topic,
          mode: thread.mode,
          status,
          version: thread.version,
        })
      } catch (error) {
        if (!(error instanceof ApiError) || error.statusCode !== 404)
          throw error
      }
    }
    return items
  })

  app.post('/api/documents/:id/review-discussions', async (request) => {
    const person = await identity(request)
    const { id: documentId } = read(id, request.params)
    const input = read(
      z.union([
        debateInput.extend({
          reviewerIds: z.array(reviewerId).min(1).max(reviewInvitationLimit),
        }),
        debateInput.extend({
          emails: z.array(z.email().max(254)).min(1).max(reviewInvitationLimit),
        }),
      ]),
      request.body
    )
    return db.transaction(async (tx) => {
      const entry = await lockDocument(tx, person.id, documentId)
      await documentVersion(documentId, input.version, tx)
      const reviewerIds =
        'reviewerIds' in input ? [...new Set(input.reviewerIds)] : null
      const recipients =
        'emails' in input
          ? [...new Set(input.emails.map((email) => email.toLowerCase()))]
          : []
      const participants = await tx
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            reviewerIds
              ? inArray(user.id, reviewerIds)
              : inArray(sql<string>`lower(${user.email})`, recipients),
            eq(user.disabled, false)
          )
        )
      if (
        participants.length !== (reviewerIds ?? recipients).length ||
        participants.some((candidate) => candidate.id === person.id) ||
        (input.mode === 'debate' && participants.length < 2)
      )
        throw new ApiError(422, 'reviewInviteUnavailable')
      const [thread] = await tx
        .insert(reviewThread)
        .values({
          documentId,
          version: input.version,
          mode: input.mode,
          topic: input.topic,
          title: entry.title,
          authorId: person.id,
          hostId: person.id,
        })
        .returning({ id: reviewThread.id })
      await invite(
        tx,
        thread.id,
        participants.map((candidate) => candidate.id),
        true
      )
      return thread
    })
  })

  app.post('/api/assignments/:id/review-discussions', async (request) => {
    const person = await identity(request)
    const { id: assignmentId } = read(id, request.params)
    const input = read(
      z.union([
        z.object({ peerId: z.uuid() }),
        debateInput.extend({
          mode: z.literal('debate'),
          submissionId: z.uuid(),
          students: z.array(reviewerId).min(2).max(reviewInvitationLimit),
        }),
      ]),
      request.body
    )
    if (person.role === 'admin') throw new ApiError(404, 'notFound')
    return db.transaction(async (tx) => {
      const assignment = await assignmentForWrite(tx, assignmentId, person)
      if (assignment.archived) throw new ApiError(409, 'peerUnavailable')
      const active = await coursePeople(assignment.classroomId, tx)
      const [peer] =
        'peerId' in input
          ? await tx
              .select()
              .from(peerReview)
              .where(eq(peerReview.id, input.peerId))
          : []
      if ('peerId' in input && !peer) throw new ApiError(404, 'notFound')
      const [target] = await tx
        .select()
        .from(submission)
        .where(
          and(
            eq(
              submission.id,
              'submissionId' in input ? input.submissionId : peer!.submissionId
            ),
            eq(submission.assignmentId, assignmentId)
          )
        )
      if (!target || !active.some((member) => member.id === target.studentId))
        throw new ApiError(404, 'notFound')
      if (
        person.role !== 'teacher' &&
        person.id !== target.studentId &&
        person.id !== peer?.reviewerId
      )
        throw new ApiError(404, 'notFound')
      const number =
        'version' in input ? input.version : peer!.submissionVersion
      const students =
        'students' in input ? [...new Set(input.students)] : [peer!.reviewerId]
      if (
        students.some(
          (student) =>
            student === target.studentId ||
            !active.some((member) => member.id === student)
        )
      )
        throw new ApiError(422, 'reviewInviteUnavailable')
      if (peer) {
        if (!['assigned', 'submitted'].includes(peer.status))
          throw new ApiError(409, 'peerUnavailable')
        const [existing] = await tx
          .select({ id: reviewThread.id })
          .from(reviewThread)
          .where(eq(reviewThread.peerId, peer.id))
        if (existing) return existing
      } else {
        if (students.length < 2)
          throw new ApiError(422, 'reviewInviteUnavailable')
        if (person.role !== 'teacher') {
          const assigned = await assignedReviewers(tx, target.id, number)
          if (
            students.some(
              (student) => !assigned.some((member) => member.id === student)
            )
          )
            throw new ApiError(422, 'reviewInviteUnavailable')
        }
      }
      const returned =
        target.returned?.version === number ? target.returned : null
      const work =
        target.version === number && target.status !== 'draft'
          ? target.work
          : returned?.work
      if (!work) throw new ApiError(409, 'peerUnavailable')
      const [thread] = await tx
        .insert(reviewThread)
        .values({
          submissionId: target.id,
          peerId: peer?.id,
          mode: 'mode' in input ? 'debate' : 'review',
          topic: 'topic' in input ? input.topic : '',
          version: number,
          title: work.revisionTitle ?? work.title,
          courseParagraphs: work.revision.content.map(blockText),
          criteria: (
            returned?.requirements.rubric ??
            target.requirements?.rubric ??
            assignment.rubric
          ).map((criterion) => criterion.label),
          authorId: target.studentId,
          hostId:
            peer && person.role !== 'teacher' ? target.studentId : person.id,
        })
        .returning({ id: reviewThread.id })
      await invite(tx, thread.id, students, !peer)
      if (person.id !== target.studentId)
        await notifyReview(
          tx,
          thread.id,
          [target.studentId],
          'reviewInvited',
          `review:${thread.id}:invite`
        )
      return thread
    })
  })

  app.get('/api/review-discussions/:id', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const { thread, status, canRead, canWrite, canManage, canDecide } =
      await reviewAccess(input.id, person)
    const summary = {
      id: thread.id,
      status,
      title: thread.title,
      mode: thread.mode,
      topic: thread.topic,
      version: thread.version,
      endedAt: thread.endedAt,
      resolution: canRead ? thread.resolution : null,
      canWrite,
      canManage,
      canDecide,
      criteria: canRead ? thread.criteria : [],
    }
    if (!canRead) return { ...summary, participants: [], messages: [] }
    const format = thread.documentId
      ? (await documentVersion(thread.documentId, thread.version)).format
      : null
    const [participants, messages, paragraphs] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          state: reviewParticipant.state,
        })
        .from(user)
        .leftJoin(
          reviewParticipant,
          and(
            eq(reviewParticipant.threadId, thread.id),
            eq(reviewParticipant.personId, user.id)
          )
        )
        .where(
          or(
            inArray(user.id, [thread.authorId, thread.hostId]),
            ne(reviewParticipant.state, 'revoked')
          )
        )
        .orderBy(asc(user.name), asc(user.id)),
      db
        .select({ message: reviewMessage, author: user.name })
        .from(reviewMessage)
        .innerJoin(user, eq(user.id, reviewMessage.authorId))
        .where(eq(reviewMessage.threadId, thread.id))
        .orderBy(asc(reviewMessage.createdAt), asc(reviewMessage.id))
        .limit(1000),
      reviewParagraphs(thread),
    ])
    return {
      ...summary,
      paragraphs,
      file:
        format && format !== 'writing'
          ? { format, url: `/api/review-discussions/${thread.id}/file` }
          : undefined,
      participants: participants.map(({ id, name, state }) => ({
        id,
        name,
        state:
          id === thread.authorId
            ? 'author'
            : id === thread.hostId
              ? 'host'
              : state,
      })),
      messages: messages.map(({ message, author }) => {
        const reported = Boolean(message.report && !message.report.resolved)
        const hidden = reported && status !== 'teacher'
        return {
          id: message.id,
          author,
          body: hidden ? '' : message.body,
          anchor: hidden ? null : message.anchor,
          role: message.role,
          replyTo: message.replyTo,
          decision: hidden ? null : message.decision,
          ai: message.ai,
          criterion: message.criterion,
          reported,
          reportReason:
            status === 'teacher' ? message.report?.reason : undefined,
          createdAt: message.createdAt,
        }
      }),
    }
  })

  app.get('/api/review-discussions/:id/file', async (request, reply) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const { thread, canRead } = await reviewAccess(input.id, person)
    if (!canRead || !thread.documentId) throw new ApiError(404, 'notFound')
    const file = await documentVersion(thread.documentId, thread.version)
    if (file.format === 'writing') throw new ApiError(404, 'notFound')
    return sendDocumentFile(reply, request, file)
  })

  app.post('/api/review-discussions/:id', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const change = read(discussionChange, request.body)
    return db.transaction(async (tx) => {
      const { thread, status, canWrite, canManage, canDecide } =
        await reviewAccess(input.id, person, tx, tx)
      const member = (personId: string) =>
        and(
          eq(reviewParticipant.threadId, thread.id),
          eq(reviewParticipant.personId, personId)
        )
      if (change.action === 'accept' || change.action === 'reject') {
        if (
          status !== 'pending' ||
          (change.action === 'accept' && thread.endedAt)
        )
          throw new ApiError(409, 'peerUnavailable')
        await tx
          .update(reviewParticipant)
          .set({
            state: change.action === 'accept' ? 'accepted' : 'rejected',
            updatedAt: new Date(),
          })
          .where(member(person.id))
      } else if (change.action === 'revoke') {
        if (!canManage) throw new ApiError(403, 'forbidden')
        const people = change.people ?? [change.person!]
        await tx
          .update(reviewParticipant)
          .set({ state: 'revoked', updatedAt: new Date() })
          .where(
            and(
              eq(reviewParticipant.threadId, thread.id),
              inArray(reviewParticipant.personId, people),
              ne(reviewParticipant.personId, thread.authorId),
              ne(reviewParticipant.personId, thread.hostId),
              inArray(reviewParticipant.state, ['pending', 'accepted'])
            )
          )
      } else if (change.action === 'end') {
        if (!canManage || thread.endedAt) throw new ApiError(403, 'forbidden')
        await tx
          .update(reviewThread)
          .set({ endedAt: new Date(), resolution: change.resolution })
          .where(eq(reviewThread.id, thread.id))
      } else if (change.action === 'post') {
        if (!canWrite) throw new ApiError(403, 'forbidden')
        if (
          change.criterion !== undefined &&
          change.criterion >= thread.criteria.length
        )
          throw new ApiError(422, 'invalidInput')
        if (change.anchor) {
          const paragraphs = await reviewParagraphs(thread)
          if (
            !paragraphs[change.anchor.paragraph]?.startsWith(
              change.anchor.quote,
              change.anchor.offset
            )
          )
            throw new ApiError(422, 'invalidAnnotation')
        }
        const [parent] = change.replyTo
          ? await tx
              .select()
              .from(reviewMessage)
              .where(
                and(
                  eq(reviewMessage.id, change.replyTo),
                  eq(reviewMessage.threadId, thread.id)
                )
              )
          : []
        if (
          change.replyTo &&
          (!parent ||
            (parent.report && !parent.report.resolved && status !== 'teacher'))
        )
          throw new ApiError(404, 'notFound')
        const [message] = await tx
          .insert(reviewMessage)
          .values({
            threadId: thread.id,
            authorId: person.id,
            body: change.body,
            anchor: change.anchor,
            role: change.role,
            replyTo: change.replyTo,
            criterion: change.criterion,
          })
          .returning({ id: reviewMessage.id })
        const recipients = parent
          ? [parent.authorId, thread.authorId]
          : person.id === thread.authorId
            ? (
                await tx
                  .select({ id: reviewParticipant.personId })
                  .from(reviewParticipant)
                  .where(
                    and(
                      eq(reviewParticipant.threadId, thread.id),
                      eq(reviewParticipant.state, 'accepted')
                    )
                  )
              ).map(({ id }) => id)
            : [thread.authorId]
        await notifyReview(
          tx,
          thread.id,
          recipients.filter((id) => id !== person.id),
          parent ? 'reviewReply' : 'reviewComment',
          `review:${thread.id}:${message.id}`
        )
      } else if (
        change.action === 'decision' ||
        change.action === 'report' ||
        change.action === 'resolve'
      ) {
        const [message] = await tx
          .select()
          .from(reviewMessage)
          .where(
            and(
              eq(reviewMessage.id, change.message),
              eq(reviewMessage.threadId, thread.id)
            )
          )
        if (!message) throw new ApiError(404, 'notFound')
        if (change.action === 'decision') {
          if (!canDecide || (message.report && !message.report.resolved))
            throw new ApiError(403, 'forbidden')
          if (change.version) {
            if (change.version <= thread.version)
              throw new ApiError(422, 'invalidInput')
            if (thread.documentId)
              await documentVersion(thread.documentId, change.version, tx)
            else {
              const [latest] = await tx
                .select()
                .from(submission)
                .where(eq(submission.id, thread.submissionId!))
              if (
                latest?.version !== change.version &&
                latest?.returned?.version !== change.version
              )
                throw new ApiError(404, 'notFound')
            }
          }
          await tx
            .update(reviewMessage)
            .set({
              decision: {
                choice: change.choice,
                reason: change.reason,
                version: change.version,
              },
            })
            .where(eq(reviewMessage.id, message.id))
        } else {
          if (!thread.submissionId || status === 'pending')
            throw new ApiError(403, 'forbidden')
          if (
            change.action === 'report' &&
            !message.report &&
            status !== 'teacher'
          )
            await tx
              .update(reviewMessage)
              .set({
                report: {
                  reason: change.reason,
                  by: person.id,
                  resolved: false,
                },
              })
              .where(eq(reviewMessage.id, message.id))
          else if (
            change.action === 'resolve' &&
            status === 'teacher' &&
            message.report &&
            !message.report.resolved
          )
            await tx
              .update(reviewMessage)
              .set({ report: { ...message.report, resolved: true } })
              .where(eq(reviewMessage.id, message.id))
          else throw new ApiError(409, 'peerUnavailable')
        }
      }
      return input
    })
  })
}
