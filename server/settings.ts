import { z } from 'zod'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { displayName } from './accounts.ts'
import { db } from './db.ts'
import { reviewAccess } from './discussions.ts'
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
    const rows = await db
      .select({ reviewThreadId: notification.reviewThreadId })
      .from(notification)
      .where(
        and(
          eq(notification.recipientId, person.id),
          isNull(notification.readAt)
        )
      )
    let count = 0
    for (const row of rows)
      if (
        !row.reviewThreadId ||
        (await visibleReview(row.reviewThreadId, person))
      )
        count++
    return { count }
  })

  app.get('/api/notifications', async (request) => {
    const person = await identity(request)
    const rows = await db
      .select({
        id: notification.id,
        kind: notification.kind,
        assignmentId: notification.assignmentId,
        assignmentTitle: assignment.title,
        submissionId: notification.submissionId,
        reviewThreadId: notification.reviewThreadId,
        createdAt: notification.createdAt,
        readAt: notification.readAt,
      })
      .from(notification)
      .leftJoin(assignment, eq(assignment.id, notification.assignmentId))
      .where(eq(notification.recipientId, person.id))
      .orderBy(desc(notification.createdAt), desc(notification.id))
    const items = []
    for (const row of rows) {
      const { reviewThreadId, ...item } = row
      if (!reviewThreadId) items.push(item)
      else {
        const review = await visibleReview(reviewThreadId, person)
        if (review)
          items.push({
            id: item.id,
            kind: item.kind,
            createdAt: item.createdAt,
            readAt: item.readAt,
            reviewThreadId,
            reviewTitle: review.thread.title,
          })
      }
    }
    return items
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

async function visibleReview(
  id: string,
  person: Awaited<ReturnType<typeof identity>>
) {
  try {
    return await reviewAccess(id, person)
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null
    throw error
  }
}
