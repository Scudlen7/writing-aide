import { eq } from 'drizzle-orm'
import {
  accountInput,
  createAccount,
  lockAccountManagement,
} from './accounts.ts'
import { db, pool } from './db.ts'
import { ApiError } from './errors.ts'
import { user } from './schema.ts'

try {
  const input = accountInput.safeParse({
    name: process.env.ADMIN_NAME,
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  })
  if (!input.success)
    throw new Error(
      'Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (10–128 characters).'
    )
  await db.transaction(async (tx) => {
    await lockAccountManagement(tx)
    const [existing] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, 'admin'))
      .limit(1)
    if (existing) throw new Error('An administrator already exists.')
    await createAccount(tx, input.data, 'admin')
  })
  process.stdout.write('Administrator created.\n')
} catch (error) {
  const message =
    error instanceof ApiError
      ? 'This email already has an account. Use a new address.'
      : error instanceof Error && !('query' in error)
        ? error.message
        : 'Could not create administrator.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
} finally {
  await pool.end()
}
