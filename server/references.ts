import { z } from 'zod'
import { doiSchema, referenceSchema } from '../shared/references.ts'
import { ApiError } from './errors.ts'

const pending = new Set<string>()
const metadata = z.object({
  message: z.object({
    title: z.array(z.string()).optional(),
    type: z.string().optional(),
    author: z
      .array(
        z.object({
          family: z.string().optional(),
          given: z.string().optional(),
          name: z.string().optional(),
        })
      )
      .optional(),
    published: z
      .object({ 'date-parts': z.array(z.array(z.number())) })
      .optional(),
    'container-title': z.array(z.string()).optional(),
    publisher: z.string().optional(),
    volume: z.string().optional(),
    issue: z.string().optional(),
    page: z.string().optional(),
    'article-number': z.string().optional(),
  }),
})

export async function lookupReference(studentId: string, doi: string) {
  if (pending.has(studentId)) throw new ApiError(429, 'referenceRateLimited')
  pending.add(studentId)
  try {
    const response = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      { signal: AbortSignal.timeout(5000), redirect: 'error' }
    )
    if (response.status === 404) throw new ApiError(404, 'referenceNotFound')
    if (!response.ok) throw new ApiError(502, 'referenceLookupFailed')
    const { message: data } = metadata.parse(await response.json())
    const kind =
      data.type === 'journal-article'
        ? 'article'
        : data.type?.includes('book')
          ? 'book'
          : 'webpage'
    return referenceSchema.parse({
      id: crypto.randomUUID(),
      kind,
      title: (data.title?.[0] ?? '').slice(0, 500),
      authors: (data.author ?? [])
        .flatMap((author) => {
          const family = (author.family ?? author.name ?? '')
            .trim()
            .slice(0, 120)
          return family
            ? [{ family, given: (author.given ?? '').slice(0, 120) }]
            : []
        })
        .slice(0, 50),
      year: String(data.published?.['date-parts'][0]?.[0] ?? ''),
      venue: (
        (kind === 'article' ? data['container-title']?.[0] : data.publisher) ??
        ''
      ).slice(0, 300),
      volume: (data.volume ?? '').slice(0, 40),
      issue: (data.issue ?? '').slice(0, 40),
      pages: (
        data.page ??
        (data['article-number'] ? `Article ${data['article-number']}` : '')
      ).slice(0, 60),
      doi: doiSchema.parse(doi),
      url: '',
      evidence: '',
      locator: '',
      verified: false,
    })
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(502, 'referenceLookupFailed')
  } finally {
    setTimeout(() => pending.delete(studentId), 2000).unref()
  }
}
