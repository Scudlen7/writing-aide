import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
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
        type: ['student', 'teacher'],
        defaultValue: 'student',
        input: false,
        required: false,
      },
    },
  },
  rateLimit: { enabled: true },
  advanced: { ipAddress: { ipAddressHeaders: ['x-writing-client-ip'] } },
})
