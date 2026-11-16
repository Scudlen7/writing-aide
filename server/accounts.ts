import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Role } from '../shared/writing.ts'
import { auth } from './auth.ts'
import type { Transaction } from './db.ts'
import { ApiError } from './errors.ts'
import { account, user } from './schema.ts'

export const displayName = z.string().trim().min(1).max(100)
export const emailAddress = z.string().trim().toLowerCase().pipe(z.email())
export const passwordInput = z.string().min(10).max(128)
export const accountInput = z.object({
  name: displayName,
  email: emailAddress,
  password: passwordInput,
})

export async function lockAccountManagement(tx: Transaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(72061017)`)
}

export async function createAccount(
  tx: Transaction,
  { name, email, password }: z.infer<typeof accountInput>,
  role: Role
) {
  const hash = await (await auth.$context).password.hash(password)
  const [created] = await tx
    .insert(user)
    .values({ id: randomUUID(), name, email, role })
    .onConflictDoNothing({ target: user.email })
    .returning({ id: user.id })
  if (!created) throw new ApiError(409, 'emailTaken')
  await tx.insert(account).values({
    id: randomUUID(),
    providerId: 'credential',
    accountId: created.id,
    userId: created.id,
    password: hash,
  })
  return created
}
