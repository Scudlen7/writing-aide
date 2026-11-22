import { and, eq, ne, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { AssignmentInput, Identity } from '../shared/writing.ts'
import { db, type Transaction } from './db.ts'
import { ApiError } from './errors.ts'
import {
  assignment,
  classroom,
  enrollment,
  notification,
  submission,
  user,
} from './schema.ts'

export const assignmentFields = {
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
  aiPolicy: assignment.aiPolicy,
  archived: sql<boolean>`(${assignment.archived} or ${classroom.archived})`,
  updatedAt: assignment.updatedAt,
}

export async function accessibleAssignment(
  id: string,
  person: Identity,
  conn: typeof db | Transaction = db
) {
  const [row] = await conn
    .select({ ...assignmentFields, classroomName: classroom.name })
    .from(assignment)
    .innerJoin(classroom, eq(classroom.id, assignment.classroomId))
    .leftJoin(
      enrollment,
      and(
        eq(enrollment.classroomId, classroom.id),
        eq(enrollment.studentId, person.id),
        eq(enrollment.removed, false)
      )
    )
    .where(
      and(
        eq(assignment.id, id),
        person.role === 'admin'
          ? undefined
          : person.role === 'teacher'
            ? eq(classroom.teacherId, person.id)
            : eq(enrollment.studentId, person.id)
      )
    )
  if (!row) throw new ApiError(404, 'notFound')
  return row
}

export async function assignmentForWrite(
  tx: Transaction,
  id: string,
  person: Identity
) {
  const [parent] = await tx
    .select({ id: assignment.classroomId })
    .from(assignment)
    .where(eq(assignment.id, id))
  if (!parent) throw new ApiError(404, 'notFound')
  await tx
    .select({ id: classroom.id })
    .from(classroom)
    .where(eq(classroom.id, parent.id))
    .for('update')
  return accessibleAssignment(id, person, tx)
}

export function assignmentRequirements(
  row: {
    dueAt: Date
  } & Omit<AssignmentInput, 'dueAt'>
): AssignmentInput {
  const {
    title,
    instructions,
    language,
    dueAt,
    minLength,
    maxLength,
    checklist,
    rubric,
    aiPolicy,
  } = row
  return {
    title,
    instructions,
    language,
    dueAt: dueAt.toISOString(),
    minLength,
    maxLength,
    checklist,
    rubric,
    ...(aiPolicy ? { aiPolicy } : {}),
  }
}

export function startedWriting(id: string, conn: typeof db | Transaction = db) {
  return conn
    .select({ id: submission.id })
    .from(submission)
    .where(and(eq(submission.assignmentId, id), sql`${submission.version} > 0`))
    .limit(1)
    .then((rows) => rows.length > 0)
}

export async function updateAssignment(
  tx: Transaction,
  id: string,
  person: Identity,
  input: AssignmentInput,
  classroomId?: string
) {
  const row = await assignmentForWrite(tx, id, person)
  if (classroomId !== undefined && classroomId !== row.classroomId)
    throw new ApiError(400, 'fixedClassroom')
  const current = assignmentRequirements(row)
  input = { ...input, aiPolicy: input.aiPolicy ?? current.aiPolicy }
  if (!input.aiPolicy) delete input.aiPolicy
  const dueAt = new Date(input.dueAt)
  if (isDeepStrictEqual(current, { ...input, dueAt: dueAt.toISOString() }))
    return false
  const deadlineChanged = row.dueAt.getTime() !== dueAt.getTime()
  if (deadlineChanged && dueAt <= new Date())
    throw new ApiError(400, 'invalidDeadline')
  const frozen = [
    'language',
    'minLength',
    'maxLength',
    'checklist',
    'rubric',
    'aiPolicy',
  ] as const
  if (
    frozen.some((key) => !isDeepStrictEqual(current[key], input[key])) &&
    (await startedWriting(id, tx))
  )
    throw new ApiError(409, 'assignmentFieldsFrozen')
  await tx
    .update(assignment)
    .set({ ...input, dueAt, updatedAt: new Date() })
    .where(eq(assignment.id, id))
  if (
    !row.archived &&
    (deadlineChanged || current.instructions !== input.instructions)
  ) {
    const recipients = await tx
      .select({ id: enrollment.studentId })
      .from(enrollment)
      .innerJoin(user, eq(user.id, enrollment.studentId))
      .where(
        and(
          eq(enrollment.classroomId, row.classroomId),
          eq(enrollment.removed, false),
          eq(user.disabled, false),
          eq(user.role, 'student'),
          sql`not exists (${tx
            .select({ id: submission.id })
            .from(submission)
            .where(
              and(
                eq(submission.assignmentId, id),
                eq(submission.studentId, enrollment.studentId),
                ne(submission.status, 'draft')
              )
            )})`
        )
      )
    const eventKey = `assignment:${randomUUID()}`
    if (recipients.length)
      await tx.insert(notification).values(
        recipients.map(({ id: recipientId }) => ({
          recipientId,
          assignmentId: id,
          kind: 'assignmentChanged' as const,
          eventKey,
        }))
      )
  }
  return true
}
