import { and, eq, lte } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DocumentFormat } from '../shared/documents.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import { ApiError } from './errors.ts'
import { personalDocumentFile, personalFileCleanup } from './schema.ts'

const storage = path.resolve(config.DOCUMENT_STORAGE)
export const filePath = (id: string) => path.join(storage, id)
export type StoredFile = Awaited<ReturnType<typeof storeFile>>

export async function storeFile(stream: Readable, format: DocumentFormat) {
  const id = randomUUID()
  await mkdir(storage, { recursive: true, mode: 0o700 })
  await db.insert(personalFileCleanup).values({
    id,
    after: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })
  const temporary = filePath(`${id}.part`)
  const hash = createHash('sha256')
  let bytes = 0
  const count = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > config.DOCUMENT_FILE_BYTES) {
        callback(new ApiError(413, 'documentFileTooLarge'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })

  try {
    await pipeline(
      stream,
      count,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      { signal: AbortSignal.timeout(120_000) }
    )
    const handle = await open(temporary, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, filePath(id))
    if (process.platform !== 'win32') {
      const directory = await open(storage, 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    }
    return { id, format, bytes, digest: hash.digest('hex') }
  } catch (error) {
    await db
      .update(personalFileCleanup)
      .set({ after: new Date() })
      .where(eq(personalFileCleanup.id, id))
    throw error
  }
}

export async function releaseFile(id: string) {
  await db
    .update(personalFileCleanup)
    .set({ after: new Date() })
    .where(eq(personalFileCleanup.id, id))
}

export async function cleanFiles() {
  const files = await db
    .select({ id: personalFileCleanup.id })
    .from(personalFileCleanup)
    .where(lte(personalFileCleanup.after, new Date()))
    .limit(50)
  for (const { id } of files) {
    await db.transaction(async (tx) => {
      const [claim] = await tx
        .select({ id: personalFileCleanup.id })
        .from(personalFileCleanup)
        .where(
          and(
            eq(personalFileCleanup.id, id),
            lte(personalFileCleanup.after, new Date())
          )
        )
        .for('update', { skipLocked: true })
      if (!claim) return
      const [live] = await tx
        .select({ id: personalDocumentFile.id })
        .from(personalDocumentFile)
        .where(eq(personalDocumentFile.id, id))
      if (!live) {
        await rm(filePath(id), { force: true })
        await rm(filePath(`${id}.part`), { force: true })
      }
      await tx.delete(personalFileCleanup).where(eq(personalFileCleanup.id, id))
    })
  }
}

export function readFileRange(id: string, bytes: number, range?: string) {
  if (!range) return { stream: createReadStream(filePath(id)), length: bytes }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  const start = match?.[1]
    ? Number(match[1])
    : Math.max(0, bytes - Number(match?.[2]))
  const end =
    match?.[1] && match[2] ? Math.min(bytes - 1, Number(match[2])) : bytes - 1
  if (!match || !Number.isSafeInteger(start) || start > end || start >= bytes)
    return null
  return {
    stream: createReadStream(filePath(id), { start, end }),
    length: end - start + 1,
    range: `bytes ${start}-${end}/${bytes}`,
  }
}
