import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { documentTitle } from '../shared/documents.ts'
import { personalWriting } from '../shared/personal-writing.ts'
import { doiSchema } from '../shared/references.ts'
import {
  blockText,
  decisionSchema,
  emptyWork,
  languageSchema,
} from '../shared/writing.ts'
import { reviewWriting } from './ai.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import { filePath, releaseFile, storeFile } from './document-storage.ts'
import {
  appendVersion,
  createDocument,
  documentVersion,
  insertFile,
  lockDocument,
  ownedDocument,
  saveDocument,
} from './documents.ts'
import { ApiError, read } from './errors.ts'
import { identity } from './identity.ts'
import { exportPaper } from './paper-export.ts'
import { lookupReference } from './references.ts'
import {
  aiRequestEvent,
  personalAiReview,
  personalDocumentFile as file,
  personalDocumentVersion as version,
} from './schema.ts'

const id = z.object({ id: z.uuid() })
const versionNumber = z.coerce.number().int().min(1).max(2147483647)
const pending = new Set<string>()

export async function loadPersonalWriting(documentId: string, number: number) {
  const row = await documentVersion(documentId, number)
  if (row.format !== 'writing') throw new ApiError(404, 'notFound')
  return personalWriting.parse(
    JSON.parse(await readFile(filePath(row.fileId), 'utf8'))
  )
}

export async function personalWritingRoutes(app: FastifyInstance) {
  app.post('/api/documents/:id/reference-doi', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const { doi } = read(z.object({ doi: doiSchema }), request.body)
    const entry = await ownedDocument(person.id, input.id)
    if (entry.source !== 'writing') throw new ApiError(404, 'notFound')
    return lookupReference(person.id, doi)
  })

  app.get('/api/documents/:id/ai-reviews', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    await ownedDocument(person.id, input.id)
    return db
      .select({
        id: personalAiReview.id,
        version: personalAiReview.version,
        task: personalAiReview.task,
        source: personalAiReview.source,
        result: personalAiReview.result,
        decisions: personalAiReview.decisions,
      })
      .from(personalAiReview)
      .where(eq(personalAiReview.documentId, input.id))
      .orderBy(desc(personalAiReview.createdAt), desc(personalAiReview.id))
      .limit(100)
  })

  app.post('/api/documents/:id/ai-reviews', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const selection = read(
      z.object({
        version: versionNumber,
        task: z.enum(['outline', 'revision']),
        text: z.string().min(1).max(4000),
      }),
      request.body
    )
    const entry = await ownedDocument(person.id, input.id)
    const draft = await loadPersonalWriting(input.id, selection.version)
    const valid =
      selection.task === 'outline'
        ? draft.work.outline.includes(selection.text)
        : draft.work.revision.content.some((paragraph) =>
            blockText(paragraph).includes(selection.text)
          )
    if (!valid) throw new ApiError(422, 'saveBeforeReview')
    const digest = createHash('sha256').update(selection.text).digest('hex')
    const [cached] = await db
      .select()
      .from(personalAiReview)
      .where(
        and(
          eq(personalAiReview.documentId, input.id),
          eq(personalAiReview.version, selection.version),
          eq(personalAiReview.task, selection.task),
          eq(personalAiReview.digest, digest)
        )
      )
    if (cached) return cached
    if (pending.has(person.id) || pending.size >= 4)
      throw new ApiError(409, 'reviewInProgress')
    pending.add(person.id)
    const start = Date.now()
    let outcome = 'aiFailed'
    try {
      const result = await reviewWriting(
        selection.task,
        {
          title: entry.title,
          instructions: '',
          rubric: [],
          language: draft.language,
        },
        selection.text
      )
      const saved = await db.transaction(async (tx) => {
        await lockDocument(tx, person.id, entry.id)
        const [row] = await tx
          .insert(personalAiReview)
          .values({
            documentId: input.id,
            version: selection.version,
            task: selection.task,
            source: selection.text,
            digest,
            result,
          })
          .returning()
        return row
      })
      outcome = 'success'
      return saved
    } finally {
      pending.delete(person.id)
      await db.insert(aiRequestEvent).values({
        task: selection.task,
        model: config.AI_MODEL ?? '',
        outcome,
        durationMs: Date.now() - start,
      })
    }
  })

  app.put('/api/documents/:id/ai-reviews/:reviewId', async (request) => {
    const person = await identity(request)
    const input = read(id.extend({ reviewId: z.uuid() }), request.params)
    const { decision, index } = read(
      z.object({
        decision: decisionSchema,
        index: z.number().int().min(0).max(7),
      }),
      request.body
    )
    return db.transaction(async (tx) => {
      await lockDocument(tx, person.id, input.id)
      const [row] = await tx
        .select()
        .from(personalAiReview)
        .where(
          and(
            eq(personalAiReview.id, input.reviewId),
            eq(personalAiReview.documentId, input.id)
          )
        )
      if (!row?.result.suggestions[index]) throw new ApiError(404, 'notFound')
      await tx
        .update(personalAiReview)
        .set({ decisions: { ...row.decisions, [index]: decision } })
        .where(eq(personalAiReview.id, row.id))
      return input
    })
  })
  app.post('/api/documents/writing', async (request, reply) => {
    const person = await identity(request)
    const input = read(
      z.object({ title: documentTitle, language: languageSchema }),
      request.body
    )
    const draft = {
      language: input.language,
      work: { ...emptyWork, title: input.title },
    }
    const candidate = await storeFile(
      Readable.from([JSON.stringify(draft)]),
      'writing'
    )
    return reply
      .code(201)
      .send(
        await createDocument(
          person.id,
          input.title,
          'writing.json',
          'writing',
          candidate
        )
      )
  })

  app.get('/api/documents/:id/writing', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const query = read(
      z.object({ version: versionNumber.optional() }),
      request.query
    )
    const entry = await ownedDocument(person.id, input.id, true)
    return loadPersonalWriting(input.id, query.version ?? entry.currentVersion)
  })

  app.put(
    '/api/documents/:id/writing',
    { bodyLimit: 3 * 1024 * 1024 },
    async (request) => {
      const person = await identity(request)
      const input = read(id, request.params)
      const { base, ...draft } = read(
        personalWriting.extend({ base: versionNumber }),
        request.body
      )
      const entry = await ownedDocument(person.id, input.id)
      if (entry.source !== 'writing') throw new ApiError(404, 'notFound')
      const current = await loadPersonalWriting(input.id, base)
      if (draft.language !== current.language)
        throw new ApiError(400, 'invalidInput')
      const candidate = await storeFile(
        Readable.from([JSON.stringify(draft)]),
        'writing'
      )
      return saveDocument(person.id, input.id, base, 'writing.json', candidate)
    }
  )

  app.post('/api/documents/:id/generate', async (request) => {
    const person = await identity(request)
    const input = read(id, request.params)
    const { base, copyTitle } = read(
      z.object({ base: versionNumber, copyTitle: documentTitle.optional() }),
      request.body
    )
    const entry = await ownedDocument(person.id, input.id)
    if (entry.currentVersion !== base)
      throw new ApiError(409, 'documentVersionConflict')
    const draft = await loadPersonalWriting(input.id, base)
    const generated = exportPaper(draft.work, draft.language, null, false)
    const candidate = await storeFile(
      Readable.from([await generated.buffer]),
      'docx'
    )
    const filename = decodeURIComponent(generated.filename).replace(
      /[\\/\p{Cc}]/gu,
      '_'
    )
    if (copyTitle)
      return createDocument(person.id, copyTitle, filename, 'word', candidate)
    try {
      return await db.transaction(async (tx) => {
        const latest = await lockDocument(tx, person.id, input.id)
        if (latest.currentVersion !== base)
          throw new ApiError(409, 'documentVersionConflict')
        const [duplicate] = await tx
          .select({ number: version.number })
          .from(version)
          .innerJoin(file, eq(file.id, version.fileId))
          .where(
            and(
              eq(version.documentId, input.id),
              eq(version.sourceVersion, base),
              eq(file.format, 'docx')
            )
          )
          .limit(1)
        if (duplicate) return { id: input.id, currentVersion: duplicate.number }
        const fileId = await insertFile(tx, person.id, input.id, candidate)
        return appendVersion(tx, latest, fileId, filename, base, false, false)
      })
    } finally {
      await releaseFile(candidate.id)
    }
  })
}
