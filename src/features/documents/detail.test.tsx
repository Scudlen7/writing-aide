import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import '@/styles/index.css'
import type { DocumentItem, DocumentVersion } from '@writing/documents'
import i18n from 'i18next'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page as browserPage } from 'vitest/browser'
import '@/features/writing/i18n'
import { DocumentDetail } from './detail'
import PdfPreview from './pdf'

it('shows document details on hover and opens the details and history dialogs', async () => {
  await i18n.changeLanguage('en')
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
  const client = new QueryClient()
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <DocumentDetail id={entry.id} personId='fixture-owner' />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/documents' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/#document-versions'] }),
  })
  const page = await render(<RouterProvider router={router} />)
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
    await page.unmount()
    client.clear()
    fetchDocument.mockRestore()
  }
})

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
