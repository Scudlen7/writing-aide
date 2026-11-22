import { z } from 'zod'

export function normalizeDoi(input: string) {
  return input
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
    .toLowerCase()
}

export const doiSchema = z
  .string()
  .max(400)
  .transform(normalizeDoi)
  .pipe(
    z
      .string()
      .regex(/^10\.\d{4,9}\/[^\s<>]+$/i)
      .max(300)
  )

const sourceUrl = z
  .string()
  .trim()
  .max(2048)
  .transform((value, ctx) => {
    if (!value) return ''
    try {
      const url = new URL(value)
      if (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      )
        return url.href
    } catch {
      // The form can be saved with an empty URL while metadata is incomplete.
    }
    ctx.addIssue({ code: 'custom', message: 'Invalid reference URL' })
    return z.NEVER
  })

export const referenceKinds = ['article', 'book', 'webpage'] as const
const names = z.string().trim().max(120)
export const referenceSchema = z.object({
  id: z.uuid(),
  kind: z.enum(referenceKinds),
  title: z.string().trim().max(500),
  authors: z.array(z.object({ family: names.min(1), given: names })).max(50),
  year: z
    .string()
    .trim()
    .regex(/^(?:\d{4})?$/),
  venue: z.string().trim().max(300),
  volume: z.string().trim().max(40),
  issue: z.string().trim().max(40),
  pages: z.string().trim().max(60),
  url: sourceUrl,
  doi: z.union([z.literal(''), doiSchema]),
  evidence: z.string().trim().max(2000),
  locator: z.string().trim().max(80),
  verified: z.boolean(),
})
export type ReferenceSource = z.infer<typeof referenceSchema>

export function referenceUrl(source: Pick<ReferenceSource, 'url' | 'doi'>) {
  return source.doi
    ? `https://doi.org/${source.doi.split('/').map(encodeURIComponent).join('/')}`
    : source.url
}

export function referenceReady(source: ReferenceSource) {
  return Boolean(
    source.title &&
    referenceUrl(source) &&
    source.verified &&
    (source.kind !== 'article' || source.venue)
  )
}

function initials(given: string) {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((name) =>
      name
        .split('-')
        .map((part) => (part ? `${Array.from(part)[0]}.` : ''))
        .join('-')
    )
    .join(' ')
}

function authorLabel(source: ReferenceSource) {
  const [first, second] = source.authors
  if (!first)
    return source.kind === 'article' ? `“${source.title}”` : source.title
  if (!second) return first.family
  return source.authors.length === 2
    ? `${first.family} & ${second.family}`
    : `${first.family} et al.`
}

function referenceAuthors(source: ReferenceSource) {
  const authors = source.authors.map(({ family, given }) =>
    given ? `${family}, ${initials(given)}` : family
  )
  if (authors.length <= 1) return authors[0] ?? ''
  if (authors.length > 20)
    return `${authors.slice(0, 19).join(', ')}, … ${authors.at(-1)}`
  return `${authors.slice(0, -1).join(', ')}, & ${authors.at(-1)}`
}

export type ReferenceEntry = { source: ReferenceSource; date: string }

export function referenceEntries(
  sources: ReferenceSource[],
  used: Set<string>
): ReferenceEntry[] {
  const selected = sources
    .filter((source) => used.has(source.id))
    .sort(
      (a, b) =>
        (referenceAuthors(a) || a.title).localeCompare(
          referenceAuthors(b) || b.title,
          'en'
        ) ||
        a.year.localeCompare(b.year) ||
        a.title.localeCompare(b.title, 'en')
    )
  const groups = new Map<string, ReferenceSource[]>()
  for (const source of selected) {
    const key = `${authorLabel(source)}\n${source.year}`
    const group = groups.get(key) ?? []
    group.push(source)
    groups.set(key, group)
  }
  return selected.map((source) => {
    const group = groups.get(`${authorLabel(source)}\n${source.year}`)!
    const position = group.indexOf(source)
    const suffix =
      group.length > 1
        ? `${position >= 26 ? 'a' : ''}${String.fromCharCode(97 + (position % 26))}`
        : ''
    return {
      source,
      date: source.year
        ? `${source.year}${suffix}`
        : `n.d.${suffix ? `-${suffix}` : ''}`,
    }
  })
}

export function inTextReference(
  { source, date }: ReferenceEntry,
  locator?: string
) {
  return `(${authorLabel(source)}, ${date}${locator ? `, ${locator}` : ''})`
}

export function referenceParts({ source, date }: ReferenceEntry) {
  const authors = referenceAuthors(source)
  const parts: { text: string; italic?: boolean; url?: string }[] = []
  const title = { text: source.title, italic: source.kind !== 'article' }
  const period = /[.?!]$/.test(source.title) ? ' ' : '. '
  if (authors)
    parts.push(
      { text: `${authors}${authors.endsWith('.') ? ' ' : '. '}(${date}). ` },
      title,
      { text: period }
    )
  else parts.push(title, { text: `${period}(${date}). ` })
  if (source.kind === 'article' && source.venue) {
    parts.push({ text: source.venue, italic: true })
    if (source.volume) parts.push({ text: `, ${source.volume}`, italic: true })
    if (source.issue) parts.push({ text: `(${source.issue})` })
    if (source.pages) parts.push({ text: `, ${source.pages}` })
    parts.push({ text: '. ' })
  } else if (source.venue && source.venue !== authors)
    parts.push({ text: `${source.venue}. ` })
  const url = referenceUrl(source)
  if (url) parts.push({ text: url, url })
  return parts
}
