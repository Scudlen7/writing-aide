import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import '@/styles/index.css'
import {
  emptyWork,
  type AiReview,
  type Assignment,
  type Submission,
} from '@writing/writing'
import i18n from 'i18next'
import { beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page as browserPage, userEvent } from 'vitest/browser'
import { request, RequestError } from './api'
import { GradingPage } from './grading'
import './i18n'
import { ReviewPanel } from './reviews'
import { Workspace } from './workspace'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useBlocker: vi.fn(),
}))
vi.mock('./api', { spy: true })

const api = vi.mocked(request)
const assignment = {
  id: 'assignment',
  classroomId: 'class',
  classroomName: 'Course',
  title: 'Test paper',
  instructions: 'Explain your argument.',
  dueAt: '2099-01-01T00:00:00.000Z',
  minLength: 3,
  maxLength: 5,
  archived: false,
  updatedAt: null,
  checklist: [],
  rubric: [{ label: 'Evidence', description: '', max: 10 }],
} satisfies Omit<Assignment, 'language'>

function reflection(revision: string): Submission {
  return {
    id: 'submission',
    status: 'draft',
    stage: 'reflect',
    openedStage: 'reflect',
    version: 5,
    grade: null,
    submittedAt: null,
    requirements: null,
    work: {
      ...emptyWork,
      title: 'Test paper',
      reflection: 'I revised my argument.',
      revision: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: revision }] },
        ],
      },
    },
  }
}

beforeEach(() => {
  api.mockReset()
})

it('restores a grading draft and asks for confirmation before publishing', async () => {
  await i18n.changeLanguage('en')
  const submitted = {
    ...reflection('Three valid words.'),
    status: 'submitted' as const,
    studentName: 'Test student',
  }
  const input = {
    scores: [8],
    criteriaFeedback: ['Saved criterion feedback'],
    feedback: 'Saved overall feedback',
    annotations: [],
  }
  api.mockResolvedValue({ ...submitted, status: 'graded', grade: input })
  const client = new QueryClient()
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <GradingPage
          detail={{
            assignment: { ...assignment, language: 'en' },
            submission: submitted,
            gradeDraft: {
              version: 3,
              submissionVersion: submitted.version,
              input,
            },
            reviews: [],
            aiEnabled: false,
          }}
        />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const page = await render(<RouterProvider router={router} />)
  await expect
    .element(
      page.getByRole('spinbutton', { name: `Evidence · ${i18n.t('score')}` })
    )
    .toHaveValue(8)
  await expect
    .element(
      page.getByRole('textbox', { name: i18n.t('feedback'), exact: true })
    )
    .toHaveValue(input.feedback)
  await userEvent.click(
    page.getByRole('button', { name: i18n.t('publishGrade'), exact: true })
  )
  const dialog = page.getByRole('alertdialog')
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog.getByText(/Total 8 \/ 10/)).toBeVisible()
  expect(api).not.toHaveBeenCalled()
  await userEvent.click(
    dialog.getByRole('button', { name: i18n.t('publishGrade') })
  )
  await expect
    .element(page.getByText(i18n.t('finalScore'), { exact: false }))
    .toBeVisible()
  expect(api).toHaveBeenCalledWith(
    '/api/assignments/assignment/submissions/submission/grade',
    'PUT',
    { ...input, submissionVersion: submitted.version, draftVersion: 3 }
  )
})

it('inserts a verified citation at the writing cursor without changing the word count', async () => {
  await i18n.changeLanguage('en')
  const submission = reflection('Three valid words.')
  submission.stage = 'revise'
  const sourceId = '99e3347e-9650-4df7-9b00-5d4c161df7fe'
  submission.work.sources = [
    {
      id: sourceId,
      kind: 'webpage',
      title: 'Public source',
      authors: [{ family: 'Lee', given: 'Ada' }],
      year: '2024',
      venue: 'Test Library',
      volume: '',
      issue: '',
      pages: '',
      url: 'https://example.org/source',
      doi: '',
      evidence: '',
      locator: 'p. 3',
      verified: true,
    },
  ]
  api.mockImplementation(async (_path, _method, body) => ({
    ...submission,
    work: { ...submission.work, ...(body as { changes: object }).changes },
  }))
  const page = await render(
    <Workspace
      assignment={{ ...assignment, language: 'en' }}
      submission={submission}
      reviews={[]}
      aiEnabled={false}
    />
  )
  await userEvent.click(
    page.getByText('Sources and citations', { exact: true })
  )
  await userEvent.click(page.getByRole('button', { name: 'Insert citation' }))
  await expect
    .element(page.getByText('(Lee, 2024, p. 3)', { exact: true }))
    .toBeVisible()
  await expect.element(page.getByText(/^3 words ·/)).toBeVisible()
  await expect
    .poll(() => api.mock.calls[0]?.[2])
    .toMatchObject({
      changes: {
        revision: {
          content: [
            expect.objectContaining({
              content: expect.arrayContaining([
                { type: 'citation', attrs: { sourceId, locator: 'p. 3' } },
              ]),
            }),
          ],
        },
      },
    })
})

it('supports keyboard reflection and conflict recovery in a narrow dark workspace', async () => {
  await i18n.changeLanguage('en')
  const submission = reflection('Three valid words.')
  submission.work.reflection = ''
  api.mockImplementation(() => {
    throw new RequestError(409, 'versionConflict')
  })
  const viewport = [window.innerWidth, window.innerHeight] as const
  await browserPage.viewport(390, 844)
  try {
    const page = await render(
      <div className='dark'>
        <main className='writing-app bg-background p-4'>
          <Workspace
            assignment={{ ...assignment, language: 'en' }}
            submission={submission}
            reviews={[]}
            aiEnabled={false}
          />
        </main>
      </div>
    )
    const area = page.getByRole('main').element()
    expect(area.scrollWidth).toBeLessThanOrEqual(area.clientWidth)
    const submit = page.getByRole('button', {
      name: 'Submit paper',
      exact: true,
    })
    await expect.element(submit).toBeDisabled()
    const prompt = page.getByRole('button', { name: 'Complete reflection' })
    await expect.element(prompt).toBeVisible()
    const promptButton = prompt.element() as HTMLButtonElement
    promptButton.focus()
    await userEvent.keyboard('{Enter}')
    const field = page.getByRole('textbox', { name: 'Writing reflection' })
    await expect.element(field).toHaveFocus()
    await userEvent.fill(field, 'My unsaved changes')
    await expect
      .element(page.getByText('Save failed', { exact: true }))
      .toBeVisible()
    await expect.element(submit).toBeDisabled()
    await userEvent.click(page.getByText('Copy unsaved text', { exact: true }))
    await expect
      .element(page.getByRole('textbox', { name: 'Unsaved text' }))
      .toHaveValue('My unsaved changes')
    expect(area.scrollWidth).toBeLessThanOrEqual(area.clientWidth)
    expect(api).toHaveBeenCalledTimes(1)
  } finally {
    await browserPage.viewport(...viewport)
  }
})

it.each([
  {
    language: 'en',
    ui: 'zh-CN',
    invalid: 'Two words.',
    valid: 'One two three.',
    hint: '还差 1 词',
    range: '当前篇幅 2 词',
    required: '要求 3–5 词',
  },
  {
    language: 'zh-CN',
    ui: 'en',
    invalid: '一二三四五六七。',
    valid: '一二三四五。',
    hint: 'Over the limit by 2 characters',
    range: 'Current length: 7 characters',
    required: 'Required: 3–5 characters',
  },
] as const)(
  'checks the final draft length for a $language paper before confirmation',
  async ({ language, ui, invalid, valid, hint, range, required }) => {
    await i18n.changeLanguage(ui)
    const submission = reflection(invalid)
    api.mockResolvedValueOnce({ ...submission, stage: 'revise' })
    const props = {
      assignment: { ...assignment, language },
      reviews: [],
      aiEnabled: false,
    }
    const page = await render(<Workspace {...props} submission={submission} />)

    await expect
      .element(
        page.getByRole('button', { name: i18n.t('submit'), exact: true })
      )
      .toBeDisabled()
    await expect.element(page.getByText(range, { exact: true })).toBeVisible()
    await expect
      .element(page.getByText(required, { exact: true }))
      .toBeVisible()
    await expect.element(page.getByText(hint, { exact: true })).toBeVisible()
    expect(api).not.toHaveBeenCalled()
    await userEvent.click(
      page.getByRole('button', { name: i18n.t('reviseAgain'), exact: true })
    )
    expect(api).toHaveBeenCalledWith(
      '/api/assignments/assignment/work',
      'PUT',
      {
        action: 'navigate',
        target: 'revise',
        stage: 'reflect',
        version: submission.version,
        changes: { reflection: submission.work.reflection },
      }
    )
    await page.unmount()

    const corrected = reflection(valid)
    api.mockResolvedValueOnce({ ...corrected, status: 'submitted' })
    const ready = await render(<Workspace {...props} submission={corrected} />)
    await userEvent.click(
      ready.getByRole('button', { name: i18n.t('submit'), exact: true })
    )
    const dialog = ready.getByRole('alertdialog')
    await expect.element(dialog).toBeVisible()
    await userEvent.click(
      dialog.getByRole('button', { name: i18n.t('confirmSubmit') })
    )
    await expect
      .element(ready.getByText(i18n.t('waiting'), { exact: true }))
      .toBeVisible()
    expect(api).toHaveBeenLastCalledWith(
      '/api/assignments/assignment/work',
      'PUT',
      expect.objectContaining({ action: 'submit' })
    )
  }
)

it.each([
  { ui: 'zh-CN', choice: 'accepted' },
  { ui: 'en', choice: 'declined' },
] as const)(
  'requires an explicit AI decision and restores the saved $choice decision',
  async ({ ui, choice }) => {
    await i18n.changeLanguage(ui)
    const review: AiReview = {
      id: 'review',
      task: 'revision',
      result: {
        summary: 'Feedback',
        suggestions: [{ focus: 'Argument', advice: 'Add evidence.' }],
      },
      decisions: {},
      createdAt: '2026-11-22T00:00:00.000Z',
      source: null,
    }
    const decision = { choice, reason: 'I checked the source.' }
    const saved = { ...review, decisions: { 0: decision } }
    api.mockResolvedValueOnce(saved)
    const decisions = { assignmentId: assignment.id, onSaved: vi.fn() }
    const page = await render(
      <ReviewPanel reviews={[review]} decisions={decisions} />
    )
    const select = page.getByRole('combobox')
    const save = page.getByRole('button', { name: i18n.t('saveDecision') })

    await userEvent.fill(
      page.getByRole('textbox', { name: i18n.t('reason') }),
      decision.reason
    )
    await userEvent.click(save)
    expect(api).not.toHaveBeenCalled()
    await expect.element(select).toHaveFocus()
    await expect.element(select).toHaveValue('')

    await userEvent.selectOptions(select, choice)
    await userEvent.click(save)
    expect(api).toHaveBeenCalledExactlyOnceWith(
      '/api/assignments/assignment/reviews/review/decisions/0',
      'PUT',
      decision
    )
    expect(decisions.onSaved).toHaveBeenCalledWith(saved)
    await page.unmount()

    const reopened = await render(
      <ReviewPanel reviews={[saved]} decisions={decisions} />
    )
    await expect.element(reopened.getByRole('combobox')).toHaveValue(choice)
    await expect
      .element(reopened.getByRole('textbox', { name: i18n.t('reason') }))
      .toHaveValue(decision.reason)
  }
)
