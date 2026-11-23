import { z } from 'zod'
import { Document, Packer } from 'docx'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  max,
  or,
  sql,
} from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Readable } from 'node:stream'
import {
  documentTags,
  documentTitle,
  documentTypes,
  searchText,
  uploadFormats,
  type DocumentFormat,
} from '../shared/documents.ts'
import { config } from './config.ts'
import { db, type Transaction } from './db.ts'
import { parseDocument, startDocumentJobs } from './document-parser.ts'
import {
  readFileRange,
  releaseFile,
  storeFile,
  type StoredFile,
} from './document-storage.ts'
import { ApiError, read } from './errors.ts'
import { identity } from './identity.ts'
import {
  personalDocument as document,
  personalDocumentFile as file,
  personalDocumentVersion as version,
  personalFileCleanup,
  reviewParticipant,
  reviewThread,
  user,
} from './schema.ts'

const idParam = z.object({ id: z.uuid() })
const versionNumber = z.coerce.number().int().min(1).max(2147483647)
const versionParam = idParam.extend({ number: versionNumber })
const filenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((name) => !/[\\/\p{Cc}]/u.test(name))
const baseVersion = z.object({ base: versionNumber })
const current = and(
  eq(document.id, version.documentId),
  eq(document.currentVersion, version.number)
)
const itemFields = {
  id: document.id,
  title: document.title,
  source: document.source,
  tags: document.tags,
  currentVersion: document.currentVersion,
  updatedAt: document.updatedAt,
  trashedAt: document.trashedAt,
  filename: version.filename,
  format: file.format,
  indexStatus: file.indexStatus,
  indexError: file.indexError,
}

export async function ownedDocument(
  ownerId: string,
  id: string,
  trashed = false
) {
  const [entry] = await db
    .select(itemFields)
    .from(document)
    .innerJoin(version, current)
    .innerJoin(file, eq(file.id, version.fileId))
    .where(
      and(
        eq(document.id, id),
        eq(document.ownerId, ownerId),
        trashed ? undefined : isNull(document.trashedAt)
      )
    )
  if (!entry) throw new ApiError(404, 'notFound')
  return entry
}

export async function documentVersion(
  id: string,
  number: number,
  connection: Transaction | typeof db = db
) {
  const [row] = await connection
    .select({ ...versionFields, fileId: file.id, text: file.indexText })
    .from(version)
    .innerJoin(file, eq(file.id, version.fileId))
    .innerJoin(user, eq(user.id, version.authorId))
    .where(and(eq(version.documentId, id), eq(version.number, number)))
  if (!row) throw new ApiError(404, 'notFound')
  return row
}

async function lockOwner(tx: Transaction, owner: string) {
  const [actor] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, owner), eq(user.disabled, false)))
    .for('update')
  if (!actor) throw new ApiError(403, 'forbidden')
}

export async function lockDocument(
  tx: Transaction,
  owner: string,
  id: string,
  trashed = false
) {
  await lockOwner(tx, owner)
  const [entry] = await tx
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, id),
        eq(document.ownerId, owner),
        trashed ? isNotNull(document.trashedAt) : isNull(document.trashedAt)
      )
    )
  if (!entry) throw new ApiError(404, 'notFound')
  return entry
}

function requireCurrent(entry: { currentVersion: number }, base: number) {
  if (entry.currentVersion !== base)
    throw new ApiError(409, 'documentVersionConflict')
}

export async function insertFile(
  tx: Transaction,
  owner: string,
  id: string,
  candidate: StoredFile
) {
  const [duplicate] = await tx
    .select({ id: file.id })
    .from(file)
    .where(
      and(
        eq(file.documentId, id),
        eq(file.digest, candidate.digest),
        eq(file.format, candidate.format)
      )
    )
  if (duplicate) return duplicate.id
  const [usage] = await tx
    .select({ bytes: sql<string>`coalesce(sum(${file.bytes}), 0)` })
    .from(file)
    .innerJoin(document, eq(document.id, file.documentId))
    .where(eq(document.ownerId, owner))
  if (Number(usage.bytes) + candidate.bytes > config.DOCUMENT_ACCOUNT_BYTES)
    throw new ApiError(413, 'documentQuotaExceeded')
  const [reservation] = await tx
    .delete(personalFileCleanup)
    .where(eq(personalFileCleanup.id, candidate.id))
    .returning()
  if (!reservation) throw new ApiError(409, 'documentUploadExpired')
  await tx.insert(file).values({ ...candidate, documentId: id })
  return candidate.id
}

export async function appendVersion(
  tx: Transaction,
  entry: typeof document.$inferSelect,
  fileId: string,
  filename: string,
  sourceVersion: number,
  conflict = false,
  makeCurrent = true
) {
  const [latest] = await tx
    .select({ number: max(version.number) })
    .from(version)
    .where(eq(version.documentId, entry.id))
  const number = (latest.number ?? entry.currentVersion) + 1
  await tx.insert(version).values({
    documentId: entry.id,
    fileId,
    filename,
    number,
    sourceVersion,
    conflict,
    authorId: entry.ownerId,
  })
  if (!conflict && makeCurrent)
    await tx
      .update(document)
      .set({ currentVersion: number, updatedAt: new Date() })
      .where(eq(document.id, entry.id))
  return { id: entry.id, currentVersion: number }
}

export async function createDocument(
  owner: string,
  title: string,
  filename: string,
  source: typeof document.$inferSelect.source,
  candidate: StoredFile
) {
  try {
    return await db.transaction(async (tx) => {
      await lockOwner(tx, owner)
      const [entry] = await tx
        .insert(document)
        .values({ ownerId: owner, title, source })
        .returning()
      const fileId = await insertFile(tx, owner, entry.id, candidate)
      await tx.insert(version).values({
        documentId: entry.id,
        fileId,
        filename,
        authorId: owner,
        number: 1,
      })
      return { id: entry.id, currentVersion: 1 }
    })
  } finally {
    await releaseFile(candidate.id)
  }
}

export async function saveDocument(
  owner: string,
  id: string,
  base: number,
  filename: string,
  candidate: StoredFile,
  allowed: (previous: DocumentFormat, next: DocumentFormat) => boolean = (
    previous,
    next
  ) => previous === next || (previous === 'doc' && next === 'docx')
) {
  try {
    return await db.transaction(async (tx) => {
      const entry = await lockDocument(tx, owner, id)
      const [previous] = await tx
        .select({ id: file.id, digest: file.digest, format: file.format })
        .from(version)
        .innerJoin(file, eq(file.id, version.fileId))
        .where(
          and(
            eq(version.documentId, id),
            eq(version.number, entry.currentVersion)
          )
        )
      if (
        previous.digest === candidate.digest &&
        previous.format === candidate.format
      )
        return { id, currentVersion: entry.currentVersion }
      requireCurrent(entry, base)
      if (!allowed(previous.format, candidate.format))
        throw new ApiError(422, 'documentFormatMismatch')
      const fileId = await insertFile(tx, owner, id, candidate)
      return appendVersion(tx, entry, fileId, filename, base)
    })
  } finally {
    await releaseFile(candidate.id)
  }
}

const versionFields = {
  number: version.number,
  sourceVersion: version.sourceVersion,
  filename: version.filename,
  conflict: version.conflict,
  author: user.name,
  bytes: file.bytes,
  format: file.format,
  createdAt: version.createdAt,
  indexStatus: file.indexStatus,
  indexError: file.indexError,
}

export function sendDocumentFile(
  reply: FastifyReply,
  request: FastifyRequest,
  row: {
    fileId: string
    bytes: number
    format: DocumentFormat
    filename: string
  },
  inline = false
) {
  const data = readFileRange(
    row.fileId,
    row.bytes,
    row.format === 'pdf' ? request.headers.range : undefined
  )
  if (!data)
    return reply
      .code(416)
      .header('Content-Range', `bytes */${row.bytes}`)
      .send()
  const filename = encodeURIComponent(row.filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16)}`
  )
  if (data.range) reply.code(206).header('Content-Range', data.range)
  if (row.format === 'pdf') reply.header('Accept-Ranges', 'bytes')
  return reply
    .type(documentTypes[row.format])
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "sandbox; default-src 'none'")
    .header(
      'Content-Disposition',
      `${inline && row.format === 'md' ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`
    )
    .header('Content-Length', data.length)
    .send(data.stream)
}

async function uploaded(request: FastifyRequest, filename: string) {
  const ext = filename.split('.').at(-1)?.toLowerCase()
  const parsed = z
    .enum(uploadFormats)
    .safeParse(ext === 'markdown' ? 'md' : ext)
  if (!parsed.success) throw new ApiError(415, 'documentUnsupportedFormat')
  if (!(request.body instanceof Readable))
    throw new ApiError(400, 'invalidInput')
  if (Number(request.headers['content-length']) > config.DOCUMENT_FILE_BYTES)
    throw new ApiError(413, 'documentFileTooLarge')
  const stream = Readable.from(
    request.body.iterator({ destroyOnReturn: false })
  )
  const candidate = await storeFile(stream, parsed.data)
  try {
    await parseDocument(candidate.id, candidate.format, 'validate')
    return candidate
  } catch (error) {
    await releaseFile(candidate.id)
    throw error
  }
}

export async function documentRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    'application/octet-stream',
    (_request, payload, done) => done(null, payload)
  )
  startDocumentJobs(app)

  app.get('/api/documents', async (request) => {
    const { id: owner } = await identity(request)
    const input = read(
      z.object({
        q: z.string().max(180).default(''),
        tag: z.string().max(40).optional(),
        format: z.enum([...uploadFormats, 'writing']).optional(),
        trash: z.enum(['0', '1']).default('0'),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
        updatedAfter: z.iso.date().optional(),
      }),
      request.query
    )
    const query = searchText(input.q)
    const isEnglishWord = /^[a-z\d]+$/u.test(query)
    const bodyHit = isEnglishWord
      ? sql`${file.searchText} ~ ${`\\m${query}\\M`}`
      : sql`strpos(${file.searchText}, ${query}) > 0`
    const all = and(
      eq(document.ownerId, owner),
      input.trash === '1'
        ? isNotNull(document.trashedAt)
        : isNull(document.trashedAt),
      input.format ? eq(file.format, input.format) : undefined,
      input.tag ? sql`${input.tag} = any(${document.tags})` : undefined,
      input.updatedAfter
        ? gt(document.updatedAt, new Date(`${input.updatedAfter}T00:00:00Z`))
        : undefined,
      query
        ? or(
            sql`strpos(lower(normalize(${document.title} || ' ' || ${version.filename} || ' ' || array_to_string(${document.tags}, ' '), NFKC)), ${query}) > 0`,
            input.trash === '0' ? bodyHit : undefined
          )
        : undefined
    )
    const order =
      input.sort === 'title'
        ? asc(document.title)
        : input.sort === 'oldest'
          ? asc(document.updatedAt)
          : desc(document.updatedAt)
    const excerpt =
      query && input.trash === '0'
        ? sql<
            string | null
          >`case when ${bodyHit} then substr(${file.searchText}, greatest(strpos(${file.searchText}, ${query}) - 48, 1), ${Math.max(120, query.length + 80)}) else null end`
        : sql<null>`null`
    const entries = db
      .select({ ...itemFields, excerpt })
      .from(document)
      .innerJoin(version, current)
      .innerJoin(file, eq(file.id, version.fileId))
      .where(all)
    const [items, [count], tagRows] = await Promise.all([
      entries
        .orderBy(order, asc(document.id))
        .limit(24)
        .offset((input.page - 1) * 24),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(document)
        .innerJoin(version, current)
        .innerJoin(file, eq(file.id, version.fileId))
        .where(all),
      db
        .selectDistinct({ tag: sql<string>`unnest(${document.tags})` })
        .from(document)
        .where(
          and(
            eq(document.ownerId, owner),
            input.trash === '1'
              ? isNotNull(document.trashedAt)
              : isNull(document.trashedAt)
          )
        )
        .orderBy(sql`1`),
    ])
    return { items, total: count.total, tags: tagRows.map(({ tag }) => tag) }
  })

  app.post('/api/documents/upload', async (request, reply) => {
    const { id: owner } = await identity(request)
    const { filename } = read(
      z.object({ filename: filenameSchema }),
      request.query
    )
    const title =
      filename
        .replace(/\.[^.]+$/, '')
        .trim()
        .slice(0, 180) || filename.slice(0, 180)
    const candidate = await uploaded(request, filename)
    return reply
      .code(201)
      .send(await createDocument(owner, title, filename, 'upload', candidate))
  })

  app.post('/api/documents/word', async (request, reply) => {
    const { id: owner } = await identity(request)
    const { title } = read(z.object({ title: documentTitle }), request.body)
    const buffer = await Packer.toBuffer(
      new Document({ title, sections: [{ children: [] }] })
    )
    const candidate = await storeFile(Readable.from([buffer]), 'docx')
    return reply
      .code(201)
      .send(
        await createDocument(
          owner,
          title,
          `${title.replace(/[\\/\p{Cc}]/gu, '_')}.docx`,
          'word',
          candidate
        )
      )
  })

  app.get('/api/documents/:id', async (request) => {
    const { id: owner } = await identity(request)
    const { id } = read(idParam, request.params)
    const entry = await ownedDocument(owner, id, true)
    const [row] = await db
      .select({ reviewCount: sql<number>`count(*)::int` })
      .from(reviewThread)
      .where(eq(reviewThread.documentId, id))
    return { ...entry, reviewCount: row.reviewCount }
  })

  app.patch('/api/documents/:id', async (request) => {
    const { id: owner } = await identity(request)
    const { id } = read(idParam, request.params)
    const changes = read(
      z.object({
        title: documentTitle.optional(),
        tags: documentTags.optional(),
      }),
      request.body
    )
    await db.transaction(async (tx) => {
      await lockDocument(tx, owner, id)
      await tx
        .update(document)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(document.id, id))
    })
    return ownedDocument(owner, id)
  })

  app.put('/api/documents/:id/trash', async (request) => {
    const { id: owner } = await identity(request)
    const { id } = read(idParam, request.params)
    const { trash } = read(z.object({ trash: z.boolean() }), request.body)
    await db.transaction(async (tx) => {
      await lockDocument(tx, owner, id, !trash)
      const now = new Date()
      if (trash)
        await tx
          .update(reviewParticipant)
          .set({ state: 'revoked', updatedAt: now })
          .where(
            sql`${reviewParticipant.threadId} in (${tx.select({ id: reviewThread.id }).from(reviewThread).where(eq(reviewThread.documentId, id))})`
          )
      await tx
        .update(document)
        .set({ trashedAt: trash ? now : null, updatedAt: now })
        .where(eq(document.id, id))
    })
    return { id }
  })

  app.delete('/api/documents/:id', async (request) => {
    const { id: owner } = await identity(request)
    const { id } = read(idParam, request.params)
    await db.transaction(async (tx) => {
      await lockDocument(tx, owner, id, true)
      const objects = await tx
        .select({ id: file.id })
        .from(file)
        .where(eq(file.documentId, id))
      if (objects.length) await tx.insert(personalFileCleanup).values(objects)
      await tx.delete(version).where(eq(version.documentId, id))
      await tx.delete(document).where(eq(document.id, id))
    })
    return { id }
  })

  app.get('/api/documents/:id/versions', async (request) => {
    const { id: owner } = await identity(request)
    const { id } = read(idParam, request.params)
    await ownedDocument(owner, id, true)
    return db
      .select(versionFields)
      .from(version)
      .innerJoin(file, eq(file.id, version.fileId))
      .innerJoin(user, eq(user.id, version.authorId))
      .where(eq(version.documentId, id))
      .orderBy(desc(version.number))
  })

  app.post('/api/documents/:id/versions', async (request) => {
    const { id: owner } = await identity(request)
    const { id } = read(idParam, request.params)
    const { filename, base } = read(
      baseVersion.extend({ filename: filenameSchema }),
      request.query
    )
    const entry = await ownedDocument(owner, id)
    if (entry.source === 'writing')
      throw new ApiError(409, 'documentWritingSource')
    return saveDocument(
      owner,
      id,
      base,
      filename,
      await uploaded(request, filename)
    )
  })

  app.get(
    '/api/documents/:id/versions/:number/file',
    async (request, reply) => {
      const { id: owner } = await identity(request)
      const { id, number } = read(versionParam, request.params)
      await ownedDocument(owner, id, true)
      return sendDocumentFile(reply, request, await documentVersion(id, number))
    }
  )

  app.post('/api/documents/:id/versions/:number/restore', async (request) => {
    const { id: owner } = await identity(request)
    const { id, number } = read(versionParam, request.params)
    const { base } = read(baseVersion, request.body)
    return db.transaction(async (tx) => {
      const entry = await lockDocument(tx, owner, id)
      requireCurrent(entry, base)
      const past = await documentVersion(id, number, tx)
      if (entry.source === 'writing' && past.format !== 'writing')
        throw new ApiError(409, 'documentWritingSource')
      if (entry.currentVersion === number) return { id, currentVersion: number }
      return appendVersion(tx, entry, past.fileId, past.filename, number)
    })
  })

  app.post('/api/documents/:id/versions/:number/index', async (request) => {
    const { id: owner } = await identity(request)
    const { id, number } = read(versionParam, request.params)
    await ownedDocument(owner, id)
    const row = await documentVersion(id, number)
    await db
      .update(file)
      .set({ indexStatus: 'pending', indexError: null })
      .where(and(eq(file.id, row.fileId), eq(file.indexStatus, 'failed')))
    return { id }
  })
}
