import { z } from 'zod'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { displayName } from './accounts.ts'
import { db } from './db.ts'
import { ApiError, read } from './errors.ts'
import { identity, identityFields } from './identity.ts'
import { assignment, notification, user } from './schema.ts'

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/me', async (request) => identity(request))

  app.patch('/api/me', async (request) => {
    const person = await identity(request)
    const changes = read(
      z.object({
        name: displayName.optional(),
        submissionNotifications: z.boolean().optional(),
      }),
      request.body
    )
    if (
      changes.submissionNotifications !== undefined &&
      person.role !== 'teacher'
    )
      throw new ApiError(403, 'forbidden')
    const [updated] = await db
      .update(user)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(user.id, person.id))
      .returning(identityFields)
    return updated
  })

  app.get('/api/notifications/unread', async (request) => {
    const person = await identity(request)
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notification)
      .where(
        and(
          eq(notification.recipientId, person.id),
          isNull(notification.readAt)
        )
      )
    return row
  })

  app.get('/api/notifications', async (request) => {
    const person = await identity(request)
    return db
      .select({
        id: notification.id,
        kind: notification.kind,
        assignmentId: notification.assignmentId,
        assignmentTitle: assignment.title,
        submissionId: notification.submissionId,
        createdAt: notification.createdAt,
        readAt: notification.readAt,
      })
      .from(notification)
      .innerJoin(assignment, eq(assignment.id, notification.assignmentId))
      .where(eq(notification.recipientId, person.id))
      .orderBy(desc(notification.createdAt), desc(notification.id))
  })

  app.put('/api/notifications/:id/read', async (request) => {
    const person = await identity(request)
    const { id } = read(z.object({ id: z.uuid() }), request.params)
    const [updated] = await db
      .update(notification)
      .set({ readAt: sql`coalesce(${notification.readAt}, now())` })
      .where(
        and(eq(notification.id, id), eq(notification.recipientId, person.id))
      )
      .returning({ id: notification.id })
    if (!updated) throw new ApiError(404, 'notFound')
    return updated
  })
}
