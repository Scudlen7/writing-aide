import { fromNodeHeaders } from 'better-auth/node'
import { and, eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Identity, Role } from '../shared/writing.ts'
import { auth } from './auth.ts'
import { db } from './db.ts'
import { ApiError } from './errors.ts'
import { user } from './schema.ts'

export const identityFields = {
  id: user.id,
  name: user.name,
  role: user.role,
  email: user.email,
  image: user.image,
  submissionNotifications: user.submissionNotifications,
}

export async function identity(
  request: FastifyRequest,
  role?: Role
): Promise<Identity> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  })
  if (!session) throw new ApiError(401, 'signInRequired')
  const [person] = await db
    .select(identityFields)
    .from(user)
    .where(and(eq(user.id, session.user.id), eq(user.disabled, false)))
  if (!person) throw new ApiError(401, 'signInRequired')
  if (role && person.role !== role) throw new ApiError(403, 'forbidden')
  return person
}
