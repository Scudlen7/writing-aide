import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from './auth.ts'
import { db, pool } from './db.ts'
import { user } from './schema.ts'

try {
  const input = z
    .object({
      TEACHER_NAME: z.string().trim().min(1).max(100),
      TEACHER_EMAIL: z.email(),
      TEACHER_PASSWORD: z.string().min(10).max(128),
    })
    .safeParse(process.env)
  if (!input.success)
    throw new Error(
      'Set TEACHER_NAME, TEACHER_EMAIL and TEACHER_PASSWORD (10–128 characters).'
    )
  const email = input.data.TEACHER_EMAIL.toLowerCase()
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
  if (existing)
    throw new Error('This email already has an account. Use a new address.')
  const created = await auth.api.signUpEmail({
    body: {
      name: input.data.TEACHER_NAME,
      email,
      password: input.data.TEACHER_PASSWORD,
    },
  })
  await db
    .update(user)
    .set({ role: 'teacher' })
    .where(eq(user.id, created.user.id))
  process.stdout.write(`Teacher account created for ${email}\n`)
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Could not create teacher'}\n`
  )
  process.exitCode = 1
} finally {
  await pool.end()
}
