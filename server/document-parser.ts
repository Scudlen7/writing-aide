import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { searchText, type DocumentFormat } from '../shared/documents.ts'
import { db } from './db.ts'
import { cleanFiles, filePath } from './document-storage.ts'
import { ApiError } from './errors.ts'
import { personalDocumentFile as file } from './schema.ts'

const run = promisify(execFile)
const worker = fileURLToPath(
  new URL('./document-parser-worker.ts', import.meta.url)
)
const dependencies = path.resolve(path.dirname(worker), '../node_modules')
const limit = 2
let running = 0

export async function parseDocument(
  id: string,
  format: DocumentFormat,
  mode: 'validate' | 'index'
) {
  if (running >= limit) throw new ApiError(503, 'documentParserBusy')
  running++
  try {
    const { stdout } = await run(
      process.execPath,
      [
        '--max-old-space-size=256',
        '--permission',
        '--allow-addons',
        `--allow-fs-read=${worker}`,
        `--allow-fs-read=${dependencies}`,
        `--allow-fs-read=${filePath(id)}`,
        worker,
        filePath(id),
        format,
        mode,
      ],
      {
        timeout: 30_000,
        maxBuffer: 3 * 1024 * 1024,
        windowsHide: true,
        env: {},
      }
    )
    const result = JSON.parse(stdout) as { text?: string; error?: string }
    if (result.error) throw new ApiError(422, result.error)
    return result.text ?? ''
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(503, 'documentParserFailed')
  } finally {
    running--
  }
}

export function startDocumentJobs(app: FastifyInstance) {
  let busy = false
  const timer = setInterval(async () => {
    if (busy || running >= limit) return
    busy = true
    try {
      await cleanFiles()
      const available = and(
        eq(file.indexStatus, 'pending'),
        or(
          isNull(file.indexLease),
          lt(file.indexLease, new Date(Date.now() - 60_000))
        )
      )
      const [next] = await db
        .select({ id: file.id })
        .from(file)
        .where(available)
        .limit(1)
      if (!next) return
      const [job] = await db
        .update(file)
        .set({ indexLease: new Date() })
        .where(and(eq(file.id, next.id), available))
        .returning()
      if (!job?.indexLease) return
      const lease = and(
        eq(file.id, job.id),
        eq(file.indexLease, job.indexLease)
      )
      try {
        const text = (
          await parseDocument(job.id, job.format, 'index')
        ).replaceAll('\u0000', '')
        await db
          .update(file)
          .set({
            indexStatus: text.trim() ? 'ready' : 'empty',
            indexText: text,
            searchText: searchText(text),
            indexLease: null,
            indexError: null,
          })
          .where(lease)
      } catch (error) {
        await db
          .update(file)
          .set({
            indexStatus: 'failed',
            indexLease: null,
            indexError:
              error instanceof ApiError ? error.code : 'documentParserFailed',
          })
          .where(lease)
      }
    } catch (error) {
      // Migrations can be applied while the local development server is watching.
      if (
        !(
          error instanceof Error &&
          'cause' in error &&
          (error.cause as { code?: string } | null)?.code === '42P01'
        )
      ) {
        app.log.warn('Personal document maintenance will retry')
      }
    } finally {
      busy = false
    }
  }, 2500)
  timer.unref()
  app.addHook('onClose', async () => clearInterval(timer))
}
