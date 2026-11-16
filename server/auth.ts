import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { roles } from '../shared/writing.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import * as schema from './schema.ts'

export const auth = betterAuth({
  appName: 'Writing Aide',
  baseURL: config.APP_ORIGIN,
  secret: config.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  user: {
    additionalFields: {
      role: {
        type: [...roles],
        defaultValue: 'student',
        input: false,
        required: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const [person] = await db
            .select({ disabled: schema.user.disabled })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
          if (person?.disabled) throw new APIError('FORBIDDEN')
        },
      },
    },
  },
  rateLimit: { enabled: true },
  advanced: { ipAddress: { ipAddressHeaders: ['x-writing-client-ip'] } },
})
