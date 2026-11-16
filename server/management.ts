import { z } from 'zod'
import { and, asc, count, eq, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { assignmentInput, roles, type Identity } from '../shared/writing.ts'
import {
  accountInput,
  createAccount,
  displayName,
  emailAddress,
  lockAccountManagement,
} from './accounts.ts'
import {
  assignmentFields,
  assignmentForWrite,
  updateAssignment,
} from './assignments.ts'
import { db, type Transaction } from './db.ts'
import { ApiError, read } from './errors.ts'
import { identity, identityFields } from './identity.ts'
import {
  assignment,
  classroom,
  enrollment,
  managementAudit,
  session,
  submission,
  user,
} from './schema.ts'

const idParam = z.object({ id: z.uuid() })
const memberParams = idParam.extend({ studentId: z.string().min(1).max(128) })
const userParam = z.object({ id: z.string().min(1).max(128) })
const confirmed = z.object({ confirmed: z.literal(true) })
const nameInput = z.object({ name: displayName })

async function manager(request: Parameters<typeof identity>[0]) {
  const person = await identity(request)
  if (person.role === 'student') throw new ApiError(403, 'forbidden')
  return person
}

async function audit(
  tx: Transaction,
  actor: Identity,
  targetId: string,
  action: string
) {
  if (actor.role === 'admin')
    await tx
      .insert(managementAudit)
      .values({ actorId: actor.id, targetId, action })
}

async function managedClass(id: string, person: Identity, tx?: Transaction) {
  const query = (tx ?? db)
    .select()
    .from(classroom)
    .where(
      and(
        eq(classroom.id, id),
        person.role === 'teacher'
          ? eq(classroom.teacherId, person.id)
          : undefined
      )
    )
  const [row] = await (tx ? query.for('update') : query)
  if (!row) throw new ApiError(404, 'notFound')
  return row
}

async function activeTeacher(tx: Transaction, id: string) {
  const [teacher] = await tx
    .select({ id: user.id })
    .from(user)
    .where(
      and(eq(user.id, id), eq(user.role, 'teacher'), eq(user.disabled, false))
    )
  if (!teacher) throw new ApiError(400, 'activeTeacherRequired')
}

export const studentCount = sql<number>`(
  select count(*)::int from enrollment as e
  where e.classroom_id = ${classroom.id} and not e.removed
)`

export async function managementRoutes(app: FastifyInstance) {
  app.get('/api/classes/:id', async (request) => {
    const person = await manager(request)
    const { id } = read(idParam, request.params)
    const row = await managedClass(id, person)
    const students = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(enrollment)
      .innerJoin(user, eq(user.id, enrollment.studentId))
      .where(and(eq(enrollment.classroomId, id), eq(enrollment.removed, false)))
      .orderBy(asc(user.name), asc(user.email))
    return { classroom: row, students }
  })

  app.post('/api/classes', async (request, reply) => {
    const person = await manager(request)
    const { name, teacherId } = read(
      nameInput.extend({ teacherId: z.string().min(1).optional() }),
      request.body
    )
    const owner = person.role === 'teacher' ? person.id : teacherId
    if (!owner) throw new ApiError(400, 'activeTeacherRequired')
    const row = await db.transaction(async (tx) => {
      await lockAccountManagement(tx)
      await activeTeacher(tx, owner)
      const [created] = await tx
        .insert(classroom)
        .values({
          name,
          teacherId: owner,
          joinCode: randomBytes(8).toString('hex').toUpperCase(),
        })
        .returning()
      await audit(tx, person, created.id, 'classroom.created')
      return created
    })
    return reply.code(201).send(row)
  })

  app.patch('/api/classes/:id', async (request) => {
    const person = await manager(request)
    const { id } = read(idParam, request.params)
    const { name } = read(nameInput, request.body)
    return db.transaction(async (tx) => {
      const row = await managedClass(id, person, tx)
      if (name !== row.name) {
        await tx.update(classroom).set({ name }).where(eq(classroom.id, id))
        await audit(tx, person, id, 'classroom.renamed')
      }
      return { ok: true }
    })
  })

  app.post('/api/classes/:id/students', async (request) => {
    const person = await manager(request)
    const { id } = read(idParam, request.params)
    const { email } = read(z.object({ email: emailAddress }), request.body)
    return db.transaction(async (tx) => {
      await lockAccountManagement(tx)
      await managedClass(id, person, tx)
      const [student] = await tx
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            eq(user.email, email),
            eq(user.role, 'student'),
            eq(user.disabled, false)
          )
        )
      if (!student) throw new ApiError(404, 'studentNotFound')
      const changed = await tx
        .insert(enrollment)
        .values({ classroomId: id, studentId: student.id })
        .onConflictDoUpdate({
          target: [enrollment.classroomId, enrollment.studentId],
          set: { removed: false },
          setWhere: eq(enrollment.removed, true),
        })
        .returning({ id: enrollment.studentId })
      if (changed.length)
        await audit(tx, person, `${id}/${student.id}`, 'classroom.memberAdded')
      return { ok: true }
    })
  })

  app.delete('/api/classes/:id/students/:studentId', async (request) => {
    const person = await manager(request)
    const { id, studentId } = read(memberParams, request.params)
    read(confirmed, request.body)
    return db.transaction(async (tx) => {
      await managedClass(id, person, tx)
      const changed = await tx
        .update(enrollment)
        .set({ removed: true })
        .where(
          and(
            eq(enrollment.classroomId, id),
            eq(enrollment.studentId, studentId),
            eq(enrollment.removed, false)
          )
        )
        .returning({ id: enrollment.studentId })
      if (changed.length)
        await audit(tx, person, `${id}/${studentId}`, 'classroom.memberRemoved')
      return { ok: true }
    })
  })

  app.patch('/api/assignments/:id', async (request) => {
    const person = await manager(request)
    const { id } = read(idParam, request.params)
    const input = read(assignmentInput, request.body)
    const { classroomId } = read(
      z.object({ classroomId: z.uuid().optional() }),
      request.body
    )
    return db.transaction(async (tx) => {
      if (await updateAssignment(tx, id, person, input, classroomId))
        await audit(tx, person, id, 'assignment.edited')
      return { ok: true }
    })
  })

  app.get('/api/admin/users', async (request) => {
    await identity(request, 'admin')
    return db
      .select({
        ...identityFields,
        disabled: user.disabled,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(asc(user.name), asc(user.email))
  })

  app.post('/api/admin/users', async (request, reply) => {
    const actor = await identity(request, 'admin')
    const input = read(
      accountInput.extend({ role: z.enum(['student', 'teacher']) }),
      request.body
    )
    const created = await db.transaction(async (tx) => {
      await lockAccountManagement(tx)
      const row = await createAccount(tx, input, input.role)
      await audit(tx, actor, row.id, 'user.created')
      return row
    })
    return reply.code(201).send(created)
  })

  app.patch('/api/admin/users/:id', async (request) => {
    const actor = await identity(request, 'admin')
    const { id } = read(userParam, request.params)
    const input = read(
      confirmed.extend({
        name: displayName,
        role: z.enum(roles),
        disabled: z.boolean(),
      }),
      request.body
    )
    return db.transaction(async (tx) => {
      await lockAccountManagement(tx)
      const [current] = await tx
        .select()
        .from(user)
        .where(eq(user.id, id))
        .for('update')
      if (!current) throw new ApiError(404, 'notFound')
      const { name, role, disabled } = input
      if (current.role === 'teacher' && (role !== 'teacher' || disabled)) {
        const [owned] = await tx
          .select({ id: classroom.id })
          .from(classroom)
          .where(eq(classroom.teacherId, id))
          .limit(1)
        if (owned) throw new ApiError(409, 'teacherOwnsClasses')
      }
      if (
        current.role === 'admin' &&
        !current.disabled &&
        (role !== 'admin' || disabled)
      ) {
        const [other] = await tx
          .select({ id: user.id })
          .from(user)
          .where(
            and(
              ne(user.id, id),
              eq(user.role, 'admin'),
              eq(user.disabled, false)
            )
          )
          .limit(1)
        if (!other) throw new ApiError(409, 'lastAdmin')
      }
      if (
        name !== current.name ||
        role !== current.role ||
        disabled !== current.disabled
      ) {
        await tx
          .update(user)
          .set({ name, role, disabled, updatedAt: new Date() })
          .where(eq(user.id, id))
        if (disabled) await tx.delete(session).where(eq(session.userId, id))
        if (name !== current.name) await audit(tx, actor, id, 'user.renamed')
        if (role !== current.role)
          await audit(tx, actor, id, 'user.roleChanged')
        if (disabled !== current.disabled)
          await audit(
            tx,
            actor,
            id,
            disabled ? 'user.disabled' : 'user.restored'
          )
      }
      return { ok: true }
    })
  })

  app.get('/api/admin/classes', async (request) => {
    await identity(request, 'admin')
    return db
      .select({ classroom, teacherName: user.name, studentCount })
      .from(classroom)
      .innerJoin(user, eq(user.id, classroom.teacherId))
      .orderBy(asc(classroom.name))
  })

  app.patch('/api/admin/classes/:id', async (request) => {
    const actor = await identity(request, 'admin')
    const { id } = read(idParam, request.params)
    const changes = read(
      confirmed.extend({ teacherId: z.string().min(1), archived: z.boolean() }),
      request.body
    )
    return db.transaction(async (tx) => {
      await lockAccountManagement(tx)
      const current = await managedClass(id, actor, tx)
      await activeTeacher(tx, changes.teacherId)
      const { teacherId, archived } = changes
      if (teacherId !== current.teacherId || archived !== current.archived) {
        await tx
          .update(classroom)
          .set({ teacherId, archived })
          .where(eq(classroom.id, id))
        if (teacherId !== current.teacherId)
          await audit(tx, actor, id, 'classroom.teacherChanged')
        if (archived !== current.archived)
          await audit(
            tx,
            actor,
            id,
            archived ? 'classroom.archived' : 'classroom.restored'
          )
      }
      return { ok: true }
    })
  })

  app.get('/api/admin/assignments', async (request) => {
    await identity(request, 'admin')
    return db
      .select({
        ...assignmentFields,
        classroomName: classroom.name,
        teacherId: classroom.teacherId,
        teacherName: user.name,
        assignmentArchived: assignment.archived,
        submissionCount: count(submission.id),
        started: sql<boolean>`exists (select 1 from submission s where s.assignment_id = ${assignment.id} and s.version > 0)`,
      })
      .from(assignment)
      .innerJoin(classroom, eq(classroom.id, assignment.classroomId))
      .innerJoin(user, eq(user.id, classroom.teacherId))
      .leftJoin(
        submission,
        and(
          eq(submission.assignmentId, assignment.id),
          ne(submission.status, 'draft')
        )
      )
      .groupBy(assignment.id, classroom.id, user.id)
      .orderBy(asc(assignment.title))
  })

  app.patch('/api/admin/assignments/:id', async (request) => {
    const actor = await identity(request, 'admin')
    const { id } = read(idParam, request.params)
    const { archived } = read(
      confirmed.extend({ archived: z.boolean() }),
      request.body
    )
    return db.transaction(async (tx) => {
      await assignmentForWrite(tx, id, actor)
      const changed = await tx
        .update(assignment)
        .set({ archived })
        .where(and(eq(assignment.id, id), ne(assignment.archived, archived)))
        .returning({ id: assignment.id })
      if (changed.length)
        await audit(
          tx,
          actor,
          id,
          archived ? 'assignment.archived' : 'assignment.restored'
        )
      return { ok: true }
    })
  })
}
