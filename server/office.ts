import { z } from 'zod'
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { setTimeout } from 'node:timers/promises'
import { config } from './config.ts'
import { db } from './db.ts'
import { parseDocument } from './document-parser.ts'
import { releaseFile, storeFile } from './document-storage.ts'
import {
  appendVersion,
  documentVersion,
  insertFile,
  lockDocument,
  ownedDocument,
  sendDocumentFile,
} from './documents.ts'
import { ApiError, read } from './errors.ts'
import { identity } from './identity.ts'
import {
  officeSession as session,
  personalDocument as document,
  user,
} from './schema.ts'

const id = z.object({ id: z.uuid() })
const expiry = () => new Date(Date.now() + 30 * 60_000)
const saveDeadline = () => new Date(Date.now() - 90_000)
const tokenLifetime = () => Math.floor(Date.now() / 1000) + 300
const compact = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')
const header = compact({ alg: 'HS256', typ: 'JWT' })

function office() {
  if (!config.OFFICE_URL || !config.OFFICE_APP_URL || !config.OFFICE_SECRET)
    throw new ApiError(503, 'officeUnavailable')
  const service = new URL(config.OFFICE_URL)
  const app = new URL(config.OFFICE_APP_URL)
  if (
    [service, app].some(
      (url) =>
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
    )
  )
    throw new ApiError(503, 'officeUnavailable')
  const mac = (message: string) =>
    createHmac('sha256', config.OFFICE_SECRET!).update(message).digest()
  const sign = (body: Record<string, unknown>) => {
    const encoded = `${header}.${compact({ ...body, exp: tokenLifetime() })}`
    return `${encoded}.${mac(encoded).toString('base64url')}`
  }
  const token = (request: FastifyRequest, operation: string): unknown => {
    try {
      const match = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/i.exec(
        request.headers.authorization ?? ''
      )
      if (!match) throw new Error()
      const [, head, payload, signature] = match
      const expected = mac(`${head}.${payload}`)
      const actual = Buffer.from(signature, 'base64url')
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      )
        throw new Error()
      if (JSON.parse(Buffer.from(head, 'base64url').toString()).alg !== 'HS256')
        throw new Error()
      const content = JSON.parse(Buffer.from(payload, 'base64url').toString())
      if (
        content.operation !== operation ||
        typeof content.exp !== 'number' ||
        content.exp < Date.now() / 1000
      )
        throw new Error()
      return content.payload
    } catch {
      throw new ApiError(403, 'forbidden')
    }
  }
  return { service, app, sign, token }
}

const fileUrl = (app: URL, sessionId: string) =>
  new URL(`/api/office/file/${sessionId}`, app).href

async function activeSession(sessionId: string) {
  const [current] = await db
    .select({ config: session })
    .from(session)
    .innerJoin(user, eq(user.id, session.ownerId))
    .innerJoin(document, eq(document.id, session.documentId))
    .where(
      and(
        eq(session.id, sessionId),
        gt(session.expiresAt, new Date()),
        eq(user.disabled, false),
        isNull(document.trashedAt)
      )
    )
  if (!current) throw new ApiError(404, 'notFound')
  return current.config
}

type EditorSession = Awaited<ReturnType<typeof activeSession>>

async function officeRequest(
  service: ReturnType<typeof office>,
  operation: 'command' | 'converter',
  data: Record<string, unknown>
) {
  try {
    const response = await fetch(new URL(`/${operation}`, service.service), {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...data,
        token: service.sign({ ...data, operation }),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error()
    return (await response.json()) as {
      error?: number
      endConvert?: boolean
      fileUrl?: string
    }
  } catch {
    throw new ApiError(503, 'officeUnavailable')
  }
}

async function savedFile(service: URL, url: string) {
  const target = new URL(url)
  if (
    target.origin !== service.origin ||
    target.username ||
    target.password ||
    !target.pathname.startsWith('/cache/files/')
  )
    throw new ApiError(403, 'forbidden')
  const response = await fetch(target, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok || !response.body)
    throw new ApiError(503, 'officeUnavailable')
  const candidate = await storeFile(
    Readable.fromWeb(response.body as ReadableStream),
    'docx'
  )
  try {
    await parseDocument(candidate.id, 'docx', 'validate')
    return candidate
  } catch (error) {
    await releaseFile(candidate.id)
    throw error
  }
}

const callback = z.object({
  key: z.uuid(),
  status: z.number().int(),
  url: z.url().optional(),
  userdata: z.string().optional(),
})

function accepts(current: EditorSession, event: z.infer<typeof callback>) {
  return (
    !current.finishedAt &&
    (event.status !== 6 ||
      (current.pendingSave !== null && current.pendingSave === event.userdata))
  )
}

export async function officeRoutes(app: FastifyInstance) {
  app.post('/api/documents/:id/office', async (request) => {
    const service = office()
    const person = await identity(request)
    const { id: documentId } = read(id, request.params)
    const input = read(
      z.object({
        version: z.number().int().positive(),
        edit: z.boolean(),
        mobile: z.boolean().default(false),
        language: z.enum(['zh-CN', 'en']),
      }),
      request.body
    )
    const entry = await ownedDocument(person.id, documentId)
    const version = await documentVersion(documentId, input.version)
    if (version.format !== 'docx')
      throw new ApiError(422, 'documentFormatMismatch')
    if (
      input.edit &&
      (entry.source === 'writing' || entry.currentVersion !== input.version)
    )
      throw new ApiError(409, 'documentVersionConflict')
    const [editor] = await db
      .insert(session)
      .values({
        documentId,
        version: input.version,
        ownerId: person.id,
        mode: input.edit ? 'edit' : 'view',
        expiresAt: expiry(),
      })
      .returning()
    const settings = {
      documentType: 'word',
      type: input.mobile && !input.edit ? 'mobile' : 'desktop',
      width: '100%',
      height: '100%',
      document: {
        key: editor.id,
        fileType: 'docx',
        title: version.filename,
        url: fileUrl(service.app, editor.id),
        permissions: { edit: input.edit, review: false },
      },
      editorConfig: {
        lang: input.language === 'zh-CN' ? 'zh' : 'en',
        mode: editor.mode,
        callbackUrl: new URL(`/api/office/callback/${editor.id}`, service.app)
          .href,
        user: { id: person.id, name: person.name },
        customization: {
          autosave: true,
          forcesave: false,
          macros: false,
          macrosMode: 'disable',
          plugins: false,
        },
      },
    }
    return {
      id: editor.id,
      api: new URL('/web-apps/apps/api/documents/api.js', service.service).href,
      settings: { ...settings, token: service.sign(settings) },
    }
  })

  app.get('/api/office/session/:id', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const current = await activeSession(input.id)
    if (current.ownerId !== person.id) throw new ApiError(404, 'notFound')
    const timedOut = current.pendingAt && current.pendingAt < saveDeadline()
    return {
      state: current.pendingSave && timedOut ? 'failed' : current.state,
      savedVersion: current.savedVersion,
      pending: !!current.pendingSave && !timedOut,
      finished: !!current.finishedAt,
    }
  })

  app.put('/api/office/session/:id', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const current = await activeSession(input.id)
    if (current.ownerId !== person.id || current.finishedAt)
      throw new ApiError(404, 'notFound')
    await db
      .update(session)
      .set({ expiresAt: expiry() })
      .where(and(eq(session.id, input.id), isNull(session.finishedAt)))
    return { id: input.id }
  })

  app.post('/api/office/session/:id/save', async (request) => {
    const service = office()
    const person = await identity(request)
    const input = read(id, request.params)
    const current = await activeSession(input.id)
    if (
      current.ownerId !== person.id ||
      current.mode !== 'edit' ||
      current.finishedAt
    )
      throw new ApiError(404, 'notFound')
    const userdata = randomUUID()
    const [pending] = await db
      .update(session)
      .set({ pendingSave: userdata, pendingAt: new Date() })
      .where(
        and(
          eq(session.id, input.id),
          isNull(session.finishedAt),
          or(isNull(session.pendingSave), lt(session.pendingAt, saveDeadline()))
        )
      )
      .returning()
    if (!pending) throw new ApiError(409, 'officeSavePending')
    try {
      const command = { c: 'forcesave', key: input.id, userdata }
      let result = await officeRequest(service, 'command', command)
      // A click can arrive just before the editor sends its last local changes.
      for (let retry = 0; retry < 3 && result.error === 4; retry++) {
        await setTimeout(1000)
        result = await officeRequest(service, 'command', command)
      }
      if (result.error === 4) {
        await db
          .update(session)
          .set({ pendingSave: null })
          .where(
            and(eq(session.id, input.id), eq(session.pendingSave, userdata))
          )
      } else if (result.error !== 0) throw new ApiError(503, 'officeSaveFailed')
      return { id: input.id }
    } catch (error) {
      await db
        .update(session)
        .set({ pendingSave: null })
        .where(and(eq(session.id, input.id), eq(session.pendingSave, userdata)))
      throw error
    }
  })

  app.get('/api/office/file/:id', async (request, reply) => {
    const service = office()
    const input = read(id, request.params)
    const { url } = read(
      z.object({ url: z.url() }),
      service.token(request, 'download')
    )
    if (url !== fileUrl(service.app, input.id))
      throw new ApiError(403, 'forbidden')
    const current = await activeSession(input.id)
    if (current.finishedAt) throw new ApiError(404, 'notFound')
    return sendDocumentFile(
      reply,
      request,
      await documentVersion(current.documentId, current.version)
    )
  })

  app.post('/api/office/callback/:id', async (request, reply) => {
    const service = office()
    const input = read(id, request.params)
    const event = read(callback, service.token(request, 'callback'))
    const body = read(callback, request.body)
    if (
      event.key !== input.id ||
      event.key !== body.key ||
      event.status !== body.status ||
      event.url !== body.url ||
      event.userdata !== body.userdata
    )
      throw new ApiError(403, 'forbidden')
    const current = await activeSession(input.id)
    if (!accepts(current, event)) return { error: 0 }
    if (event.status === 1) return { error: 0 }
    if (event.status === 4 || event.status === 3 || event.status === 7) {
      await db
        .update(session)
        .set({
          state:
            event.status === 4 && !current.savedVersion
              ? 'closed'
              : event.status === 4
                ? current.state
                : 'failed',
          pendingSave: null,
          finishedAt: event.status === 7 ? null : new Date(),
        })
        .where(and(eq(session.id, input.id), isNull(session.finishedAt)))
      return { error: 0 }
    }
    if (
      current.mode !== 'edit' ||
      !event.url ||
      (event.status !== 2 && event.status !== 6)
    )
      throw new ApiError(403, 'forbidden')
    let candidate: Awaited<ReturnType<typeof savedFile>> | undefined
    try {
      candidate = await savedFile(service.service, event.url)
      const saved = candidate
      await db.transaction(async (tx) => {
        const entry = await lockDocument(
          tx,
          current.ownerId,
          current.documentId
        )
        const [fresh] = await tx
          .select()
          .from(session)
          .where(
            and(eq(session.id, input.id), gt(session.expiresAt, new Date()))
          )
          .for('update')
        if (!fresh) throw new ApiError(403, 'forbidden')
        if (!accepts(fresh, event)) return
        const base = fresh.savedVersion ?? fresh.version
        const previous = await documentVersion(entry.id, base, tx)
        const fileId = await insertFile(tx, entry.ownerId, entry.id, saved)
        const conflict = entry.currentVersion !== base
        const result =
          fileId === previous.fileId
            ? { currentVersion: base }
            : await appendVersion(
                tx,
                entry,
                fileId,
                previous.filename,
                base,
                conflict
              )
        await tx
          .update(session)
          .set({
            savedVersion: result.currentVersion,
            state: conflict ? 'conflict' : 'saved',
            pendingSave: null,
            finishedAt: event.status === 2 ? new Date() : null,
          })
          .where(eq(session.id, input.id))
      })
      return { error: 0 }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 403) throw error
      await db
        .update(session)
        .set({ state: 'failed', pendingSave: null })
        .where(and(eq(session.id, input.id), isNull(session.finishedAt)))
      return reply.send({ error: 1 })
    } finally {
      if (candidate) await releaseFile(candidate.id)
    }
  })

  app.post('/api/documents/:id/convert', async (request) => {
    const service = office()
    const person = await identity(request)
    const input = read(id, request.params)
    const entry = await ownedDocument(person.id, input.id)
    if (entry.format !== 'doc')
      throw new ApiError(422, 'documentFormatMismatch')
    const [job] = await db
      .insert(session)
      .values({
        documentId: entry.id,
        ownerId: person.id,
        version: entry.currentVersion,
        mode: 'convert',
        expiresAt: expiry(),
      })
      .returning()
    let candidate: Awaited<ReturnType<typeof savedFile>> | undefined
    try {
      const result = await officeRequest(service, 'converter', {
        async: false,
        filetype: 'doc',
        outputtype: 'docx',
        key: job.id,
        url: fileUrl(service.app, job.id),
      })
      if (!result.endConvert || !result.fileUrl || result.error)
        throw new ApiError(422, 'officeConversionFailed')
      const incoming = await savedFile(service.service, result.fileUrl)
      candidate = incoming
      return await db.transaction(async (tx) => {
        const latest = await lockDocument(tx, person.id, entry.id)
        if (latest.currentVersion !== job.version)
          throw new ApiError(409, 'documentVersionConflict')
        const fileId = await insertFile(tx, person.id, entry.id, incoming)
        const saved = await appendVersion(
          tx,
          latest,
          fileId,
          entry.filename.replace(/\.doc$/iu, '.docx'),
          job.version
        )
        await tx
          .update(session)
          .set({
            state: 'saved',
            savedVersion: saved.currentVersion,
            finishedAt: new Date(),
          })
          .where(eq(session.id, job.id))
        return saved
      })
    } catch (error) {
      await db
        .update(session)
        .set({ state: 'failed', finishedAt: new Date() })
        .where(eq(session.id, job.id))
      throw error
    } finally {
      if (candidate) await releaseFile(candidate.id)
    }
  })
}
