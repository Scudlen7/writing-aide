import {
  emptyWork,
  type AiReview,
  type Assignment,
  type Submission,
} from '@writing/writing'
import i18n from 'i18next'
import { beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { request } from './api'
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

beforeEach(() => api.mockReset())

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
