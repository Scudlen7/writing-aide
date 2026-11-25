import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import '@/styles/index.css'
import type { DebateRun } from '@writing/debate'
import type { DocumentItem, DocumentVersion } from '@writing/documents'
import i18n from 'i18next'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page as browserPage, userEvent } from 'vitest/browser'
import '@/features/writing/i18n'
import { DocumentDetail } from './detail'
import PdfPreview from './pdf'

it('shows document details on hover and opens the details and history dialogs', async () => {
  await i18n.changeLanguage('en')
  const { entry, versions } = documentFixture()
  const fetchDocument = vi
    .spyOn(window, 'fetch')
    .mockImplementation(async (url, init) => {
      switch (url) {
        case '/api/documents/fixture':
          if (init?.method === 'PATCH')
            Object.assign(entry, JSON.parse(String(init.body)))
          return Response.json(entry)
        case '/api/documents/fixture/versions':
          return Response.json(versions)
        case '/api/documents/fixture/versions/1/restore':
          return Response.json(
            { code: 'documentVersionConflict' },
            { status: 409 }
          )
        case '/api/documents/fixture/versions/1/file':
          return new Response('# Original evidence')
        case '/api/documents/fixture/versions/2/file':
          return new Response('Updated evidence')
        default:
          throw new Error(`Unexpected request: ${String(url)}`)
      }
    })
  const { page, cleanup } = await renderDocument('/#document-versions')
  try {
    const detailsButton = page.getByRole('button', { name: 'Document details' })
    const historyButton = page.getByRole('button', { name: 'Version history' })
    const history = page.getByRole('dialog', { name: 'Version history' })
    await expect.element(history.getByRole('table')).toBeVisible()
    await history.getByRole('button', { name: 'Close' }).click()
    await expect.element(history).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('textbox', { name: 'Markdown source' }))
      .toHaveValue('Updated evidence')
    await expect.element(page.getByRole('table')).not.toBeInTheDocument()
    await detailsButton.hover()
    const tooltip = page.getByRole('tooltip')
    await expect.element(tooltip).toHaveTextContent('Evidence notes')
    await expect.element(tooltip).toHaveTextContent('Research')
    await detailsButton.click()
    const details = page.getByRole('dialog', { name: 'Document details' })
    await details.getByRole('textbox', { name: 'Title' }).fill('Revised notes')
    await details.getByRole('textbox', { name: 'Tags' }).fill('Draft，Evidence')
    await details.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.element(details).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('heading', { name: 'Revised notes' }))
      .toBeVisible()
    expect(entry.tags).toEqual(['Draft', 'Evidence'])

    await historyButton.click()
    await expect.element(history.getByRole('table')).toBeVisible()
    const restore = history.getByRole('button', { name: 'Restore version' })
    await restore.click()
    const confirmation = page.getByRole('alertdialog', {
      name: 'Restore version',
    })
    await expect.element(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Restore version' }).click()
    await expect.element(confirmation.getByRole('alert')).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(restore).toHaveFocus()
    await history
      .getByRole('button', { name: 'Version 1', exact: true })
      .click()
    await expect.element(history).not.toBeInTheDocument()
    await expect.element(historyButton).toHaveFocus()
    await expect
      .element(page.getByRole('heading', { name: 'Original evidence' }))
      .toBeVisible()
    await page.getByRole('button', { name: 'Back to current version' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'Markdown source' }))
      .toHaveValue('Updated evidence')
  } finally {
    await cleanup()
    fetchDocument.mockRestore()
  }
})

it('starts a personal debate with excerpts selected across paragraphs', async () => {
  await i18n.changeLanguage('en')
  const viewport = [window.innerWidth, window.innerHeight] as const
  await browserPage.viewport(1440, 900)
  const { entry, versions } = documentFixture()
  const longWord = 'e'.repeat(3100)
  const oversizedWord = 'z'.repeat(3200)
  const paragraphs = [
    'Opening.\r\nExact first line.',
    'Exact second line. Trailing text.',
    'Intervening untouched paragraph.',
    longWord,
    'End of full range.',
    oversizedWord,
    'Keyword for a temporary passage. Keyword again.',
  ]
  const exact = 'Exact first line.\nExact second line.'
  const full = `${longWord}\n${paragraphs[4]}`
  const ranges = [
    {
      start: { paragraph: 0, offset: 'Opening.\r\n'.length },
      end: { paragraph: 1, offset: 'Exact second line.'.length },
    },
    {
      start: { paragraph: 3, offset: 0 },
      end: { paragraph: 4, offset: paragraphs[4].length },
    },
  ]
  const legacy: DebateRun = {
    id: 'legacy',
    topic: 'Legacy topic',
    version: 2,
    anchor: { paragraph: 0, offset: 0, quote: 'Legacy excerpt' },
    steps: [],
  }
  let submitted: unknown
  const created = {
    id: 'created',
    topic: 'Compare the evidence',
    version: 2,
    anchor: { ...ranges[0].start, quote: 'Exact first line.' },
    excerpts: ranges.map((range, index) => ({
      ...range,
      text: [exact, full][index],
    })),
    steps: [] as DebateRun['steps'],
  }
  const fetchDebate = vi
    .spyOn(window, 'fetch')
    .mockImplementation(async (url, init) => {
      switch (url) {
        case '/api/documents/fixture':
          return Response.json(entry)
        case '/api/documents/fixture/versions':
          return Response.json(versions)
        case '/api/documents/fixture/versions/2/file':
          return new Response('Evidence')
        case '/api/ai-debates':
          submitted = JSON.parse(String(init?.body))
          return Response.json({ id: created.id })
        case '/api/ai-debates?documentId=fixture&version=1':
          return Response.json({
            enabled: true,
            paragraphs: ['Old evidence'],
            runs: [],
          })
        case '/api/ai-debates?documentId=fixture&version=2':
          return Response.json({
            enabled: true,
            paragraphs,
            runs: submitted ? [created, legacy] : [legacy],
          })
        case '/api/ai-debates/legacy':
          return Response.json(legacy)
        case '/api/ai-debates/created':
          return Response.json(created)
        case '/api/ai-debates/created/step': {
          const { round, role, question } = JSON.parse(String(init?.body))
          const step = {
            id: `reply-${role}`,
            round,
            role,
            question,
            body: 'AI response',
            state: 'ready',
          } as const
          created.steps.push(step)
          return Response.json(step)
        }
        case '/api/review-discussions?document=fixture':
          return Response.json([])
        default:
          throw new Error(`Unexpected request: ${String(url)}`)
      }
    })
  const { page, cleanup } = await renderDocument('/')
  try {
    await page.getByRole('button', { name: 'AI debate', exact: true }).click()
    const debate = page.getByRole('dialog', { name: 'AI debate' })
    await expect.element(debate.getByText('Legacy excerpt')).toBeVisible()
    expect(debate.element().clientWidth).toBeGreaterThan(900)

    const newTopic = debate.getByRole('button', { name: 'New topic' })
    await newTopic.click()
    const source = debate.getByRole('textbox', { name: 'Source text' })
    await expect.element(source).toBeVisible()
    const textarea = source.element() as HTMLTextAreaElement
    const addText = debate.getByRole('button', { name: 'Add selected text' })
    const firstPassage = debate.getByRole('button', {
      name: 'Remove passage 1',
    })
    await debate
      .getByRole('searchbox', { name: 'Find in source text' })
      .fill('Keyword')
    await debate.getByRole('button', { name: 'Next match' }).click()
    await expect
      .poll(() =>
        textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
      )
      .toBe('Keyword')
    expect(textarea.scrollTop).toBeGreaterThan(0)
    await userEvent.keyboard('{Enter}')
    await expect.element(debate.getByText('Match 2 of 2')).toBeVisible()
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await expect.element(debate.getByText('Match 1 of 2')).toBeVisible()
    await addText.click()
    await expect.element(firstPassage).toBeVisible()

    const version = debate.getByRole('combobox', { name: 'Version history' })
    await version.selectOptions('1')
    await expect.element(source).not.toBeInTheDocument()
    await version.selectOptions('2')
    await expect.element(debate.getByText('Legacy excerpt')).toBeVisible()
    await newTopic.click()
    await expect.element(firstPassage).not.toBeInTheDocument()
    await expect.element(source).toBeVisible()
    const newSource = source.element() as HTMLTextAreaElement

    selectSource(newSource, 'Exact first line.', 'Exact second line.')
    await addText.click()
    selectSource(newSource, longWord)
    await debate.getByRole('button', { name: 'Set start paragraph' }).click()
    selectSource(newSource, paragraphs[4])
    await debate
      .getByRole('button', { name: 'Add through current paragraph' })
      .click()
    const preview = debate.getByText(full, { exact: true })
    await expect.element(preview).toBeVisible()
    await expect
      .poll(() => preview.element().scrollWidth - preview.element().clientWidth)
      .toBeLessThanOrEqual(1)

    selectSource(newSource, oversizedWord)
    await addText.click()
    await expect
      .element(debate.getByRole('alert'))
      .toHaveTextContent(/6[,.]?000/u)
    const thirdPassage = debate.getByRole('button', {
      name: 'Remove passage 3',
    })
    await expect.element(thirdPassage).not.toBeInTheDocument()
    selectSource(newSource, 'Keyword')
    await addText.click()
    await thirdPassage.click()
    await expect.element(thirdPassage).not.toBeInTheDocument()

    await browserPage.viewport(390, 844)
    await expect
      .poll(() => debate.element().clientWidth)
      .toBeLessThanOrEqual(390)
    await expect
      .poll(() => debate.element().scrollWidth - debate.element().clientWidth)
      .toBeLessThanOrEqual(1)
    await expect
      .poll(() => newSource.scrollWidth - newSource.clientWidth)
      .toBeLessThanOrEqual(1)
    await expect
      .poll(() => preview.element().scrollWidth - preview.element().clientWidth)
      .toBeLessThanOrEqual(1)
    await debate
      .getByRole('textbox', { name: 'Topic or question for reviewers' })
      .fill(created.topic)
    await debate
      .getByRole('button', { name: 'Send and start round one' })
      .click()
    await expect
      .poll(() => submitted)
      .toEqual({
        topic: created.topic,
        language: 'en',
        target: { documentId: 'fixture', version: 2 },
        ranges,
      })
    const conversation = debate.getByRole('log', { name: 'AI debate' })
    await expect
      .element(conversation.getByText(exact, { exact: true }))
      .toBeVisible()
    await expect
      .element(conversation.getByText(full, { exact: true }))
      .toBeVisible()
    await expect
      .poll(
        () =>
          conversation.getByText('AI response', { exact: true }).elements()
            .length
      )
      .toBe(3)
  } finally {
    await cleanup()
    fetchDebate.mockRestore()
    await browserPage.viewport(...viewport)
  }
})

function selectSource(
  textarea: HTMLTextAreaElement,
  first: string,
  last = first
) {
  const start = textarea.value.indexOf(first)
  const finish = textarea.value.indexOf(last, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(finish).toBeGreaterThanOrEqual(start)
  textarea.focus()
  textarea.setSelectionRange(start, finish + last.length)
  document.dispatchEvent(new Event('selectionchange'))
}

function documentFixture() {
  const now = '2026-11-24T00:00:00.000Z'
  const entry: DocumentItem = {
    id: 'fixture',
    title: 'Evidence notes',
    source: 'upload',
    tags: ['Research'],
    currentVersion: 2,
    updatedAt: now,
    trashedAt: null,
    filename: 'notes.md',
    format: 'md',
    indexStatus: 'ready',
    indexError: null,
  }
  const versions: DocumentVersion[] = [2, 1].map((number) => ({
    number,
    sourceVersion: number === 1 ? null : 1,
    conflict: false,
    filename: entry.filename,
    format: entry.format,
    author: 'Fixture author',
    bytes: 20,
    createdAt: now,
    indexStatus: 'ready',
    indexError: null,
  }))
  return { entry, versions }
}

async function renderDocument(location: string) {
  const client = new QueryClient()
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <DocumentDetail id='fixture' personId='fixture-owner' />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/documents' }),
    ]),
    history: createMemoryHistory({ initialEntries: [location] }),
  })
  const page = await render(<RouterProvider router={router} />)
  return {
    page,
    cleanup: async () => {
      await page.unmount()
      client.clear()
    },
  }
}

it('scrolls between PDF pages and keeps page navigation and search in sync', async () => {
  await i18n.changeLanguage('en')
  const viewport = [window.innerWidth, window.innerHeight] as const
  await browserPage.viewport(900, 760)
  const url = URL.createObjectURL(twoPagePdf())
  const page = await render(<PdfPreview url={url} />)
  try {
    const number = page.getByRole('spinbutton', { name: 'Page' })
    const reader = page.getByRole('region', { name: 'PDF', exact: true })
    await expect.element(number).toHaveValue(1)
    await expect.element(page.getByText('Continuous first page')).toBeVisible()
    await reader.wheel({ delta: { y: 1250 } })
    await expect.element(number).toHaveValue(2)
    await expect.element(page.getByText('Continuous second page')).toBeVisible()
    await reader.wheel({ delta: { y: -1250 } })
    await expect.element(number).toHaveValue(1)
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.element(number).toHaveValue(2)
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect.element(number).toHaveValue(1)
    await page
      .getByRole('searchbox', { name: 'Find in PDF' })
      .fill('second page')
    await page.getByRole('button', { name: 'Find in PDF' }).click()
    await expect.element(number).toHaveValue(2)
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Fit width' }))
      .toHaveTextContent('125%')
    await expect.element(number).toHaveValue(2)
    await number.fill('1')
    await expect.element(number).toHaveValue(1)
    await expect.poll(() => reader.element().scrollTop).toBe(0)
  } finally {
    await page.unmount()
    URL.revokeObjectURL(url)
    await browserPage.viewport(...viewport)
  }
})

function twoPagePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    ...['first', 'second'].flatMap((name, index) => {
      const text = `BT /F1 18 Tf 40 720 Td (Continuous ${name} page) Tj ET`
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
        `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
      ]
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let contents = '%PDF-1.4\n'
  const offsets = ['0000000000 65535 f \n']
  for (const [index, object] of objects.entries()) {
    offsets.push(`${String(contents.length).padStart(10, '0')} 00000 n \n`)
    contents += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  return new Blob(
    [
      `${contents}xref\n0 ${offsets.length}\n${offsets.join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${contents.length}\n%%EOF\n`,
    ],
    { type: 'application/pdf' }
  )
}
