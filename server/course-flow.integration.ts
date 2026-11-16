import { eq } from 'drizzle-orm'
import type { HTTPMethods } from 'fastify'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type {
  AiReview,
  Assignment,
  AssignmentInput,
  Classroom,
  Identity,
  Submission,
  WritingDocument,
} from '../shared/writing.ts'

test('Chinese and English course papers from class creation to feedback', async (t) => {
  const database = process.env.TEST_DATABASE_URL
  assert.ok(database, 'Set TEST_DATABASE_URL to a migrated test database')
  assert.match(
    new URL(database).pathname,
    /_test$/,
    'Use a dedicated database ending in _test'
  )
  process.env.DATABASE_URL = database
  process.env.BETTER_AUTH_SECRET = 'integration-test-secret-for-local-run-only'
  process.env.APP_ORIGIN = 'http://localhost:5173'
  process.env.AI_API_KEY = 'local-fixture'
  process.env.AI_MODEL = 'fixture'
  const model = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString())
    const system: string = input.messages[0].content
    const result = {
      summary: system.includes('Simplified Chinese')
        ? '请补充证据。'
        : 'Add evidence.',
      suggestions: [{ focus: 'Opening', advice: 'Give a concrete example.' }],
      ...(system.includes('tentative grade') ? { scores: [7] } : {}),
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
      })
    )
  })
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
  t.after(() => model.close())
  const address = model.address()
  assert.ok(address && typeof address === 'object')
  process.env.AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`

  const [{ createApp }, { db, pool }, { user }, { countWriting }] =
    await Promise.all([
      import('./app.ts'),
      import('./db.ts'),
      import('./schema.ts'),
      import('../shared/writing.ts'),
    ])
  const app = createApp()
  t.after(async () => {
    await app.close()
    await pool.end()
  })
  const origin = process.env.APP_ORIGIN

  async function call<T>(
    method: HTTPMethods,
    url: string,
    options: {
      cookie?: string
      payload?: Record<string, unknown>
      status?: number
      origin?: string
      remoteAddress?: string
    } = {}
  ) {
    const response = await app.inject({
      method,
      url,
      payload: options.payload,
      headers: {
        origin: options.origin ?? origin,
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      remoteAddress: options.remoteAddress,
    })
    assert.equal(
      response.statusCode,
      options.status ?? 200,
      `${method} ${url}: ${response.body}`
    )
    return { body: response.json<T>(), cookie: response.cookies[0] }
  }

  let nextAddress = 1
  async function signUp(name: string) {
    const { body, cookie } = await call<{ user: { id: string } }>(
      'POST',
      '/api/auth/sign-up/email',
      {
        payload: {
          name,
          email: `${randomUUID()}@example.test`,
          password: 'Test-passphrase-2026',
        },
        remoteAddress: `192.0.2.${nextAddress++}`,
      }
    )
    assert.ok(cookie)
    return { id: body.user.id, cookie: `${cookie.name}=${cookie.value}` }
  }
  const teacher = await signUp('Teacher')
  const outsider = await signUp('Other teacher')
  const student = await signUp('Student')
  const peer = await signUp('Peer')
  for (const person of [teacher, outsider]) {
    await db.update(user).set({ role: 'teacher' }).where(eq(user.id, person.id))
  }
  const { body: self } = await call<Identity>('GET', '/api/me', {
    cookie: student.cookie,
  })
  assert.equal(self.role, 'student')
  await call('GET', '/api/dashboard', { status: 401 })
  await call('POST', '/api/classes', {
    cookie: teacher.cookie,
    payload: { name: 'Blocked' },
    origin: 'https://other.example',
    status: 403,
  })
  await call('POST', '/api/classes', {
    cookie: student.cookie,
    payload: { name: 'Blocked' },
    status: 403,
  })
  const { body: course } = await call<Classroom>('POST', '/api/classes', {
    cookie: teacher.cookie,
    payload: { name: 'Course' },
    status: 201,
  })
  for (const person of [student, peer]) {
    await call('POST', '/api/classes/join', {
      cookie: person.cookie,
      payload: { code: course.joinCode },
    })
  }

  for (const language of ['zh-CN', 'en'] as const) {
    const assignmentInput: AssignmentInput = {
      title: language === 'en' ? 'Course paper' : '课程论文',
      instructions: 'Support your claim with evidence.',
      language,
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      minLength: 4,
      maxLength: 20,
      rubric: [
        { label: 'Evidence', description: 'Support the argument', max: 10 },
      ],
      checklist: ['I named my sources'],
    }
    const { body: assignment } = await call<Assignment>(
      'POST',
      '/api/assignments',
      {
        cookie: teacher.cookie,
        payload: { ...assignmentInput, classroomId: course.id },
        status: 201,
      }
    )
    const path = `/api/assignments/${assignment.id}`
    await call('GET', path, { cookie: outsider.cookie, status: 404 })
    const save = async (
      stage: Submission['stage'],
      action: string,
      version: number,
      changes: Record<string, unknown>,
      status = 200
    ) =>
      (
        await call<Submission>('PUT', `${path}/work`, {
          cookie: student.cookie,
          payload: { stage, action, version, changes },
          status,
        })
      ).body
    const goals = await save('goals', 'save', 0, { goal: 'Support each claim' })
    await save('goals', 'advance', 0, { goal: 'Stale overwrite' }, 409)
    await save(
      'goals',
      'advance',
      goals.version,
      { draft: { type: 'doc', content: [{ type: 'paragraph' }] } },
      400
    )
    const outline = await save('goals', 'advance', goals.version, {})
    const outlineSaved = await save('outline', 'save', outline.version, {
      outline: 'Claim, evidence, conclusion',
    })
    await call('GET', `${path}/submissions/${outlineSaved.id}`, {
      cookie: teacher.cookie,
      status: 404,
    })
    const { body: outlineReview } = await call<AiReview>(
      'POST',
      `${path}/reviews`,
      {
        cookie: student.cookie,
        payload: { task: 'outline' },
        status: 201,
      }
    )
    assert.equal(
      outlineReview.result.summary,
      language === 'en' ? 'Add evidence.' : '请补充证据。'
    )
    const draft = await save('outline', 'advance', outlineSaved.version, {})
    const paragraph = (text: string): WritingDocument => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    const firstDocument = paragraph(language === 'en' ? 'Too short.' : '过短。')
    const revise = await save('draft', 'advance', draft.version, {
      title: assignmentInput.title,
      draft: firstDocument,
    })
    assert.deepEqual(revise.work.revision, firstDocument)
    const reflect = await save('revise', 'advance', revise.version, {})
    await save(
      'reflect',
      'submit',
      reflect.version,
      { reflection: 'Added evidence' },
      400
    )
    const edit = await save('reflect', 'reviseAgain', reflect.version, {
      reflection: 'Added evidence',
    })
    const finalDocument = paragraph(
      language === 'en' ? 'Evidence supports the claim.' : '证据支持论点。'
    )
    assert.equal(
      countWriting(finalDocument, language),
      language === 'en' ? 4 : 6
    )
    const updated = await save('revise', 'save', edit.version, {
      revision: finalDocument,
      checked: [0],
    })
    const { body: review } = await call<AiReview>('POST', `${path}/reviews`, {
      cookie: student.cookie,
      payload: { task: 'revision' },
      status: 201,
    })
    const { body: decided } = await call<AiReview>(
      'PUT',
      `${path}/reviews/${review.id}/decisions/0`,
      {
        cookie: student.cookie,
        payload: { choice: 'accepted', reason: 'Useful feedback' },
      }
    )
    assert.equal(decided.decisions[0].choice, 'accepted')
    const rechecked = await save('revise', 'advance', updated.version, {})
    assert.equal(rechecked.work.reflection, 'Added evidence')
    const submitted = await save('reflect', 'submit', rechecked.version, {})
    assert.equal(submitted.status, 'submitted')
    await save(
      'reflect',
      'save',
      submitted.version,
      { reflection: 'Unwanted edit' },
      409
    )
    const { body: peerWork } = await call<{ submission: Submission | null }>(
      'GET',
      path,
      { cookie: peer.cookie }
    )
    assert.equal(peerWork.submission, null)
    const submissionPath = `${path}/submissions/${submitted.id}`
    await call('GET', submissionPath, { cookie: peer.cookie, status: 403 })
    await call('GET', submissionPath, { cookie: outsider.cookie, status: 404 })
    const { body: assessment } = await call<AiReview>(
      'POST',
      `${path}/reviews`,
      {
        cookie: teacher.cookie,
        payload: { task: 'assessment', submissionId: submitted.id },
        status: 201,
      }
    )
    assert.deepEqual(assessment.result.scores, [7])
    await call('PUT', `${submissionPath}/grade`, {
      cookie: teacher.cookie,
      payload: { scores: [11], feedback: 'Feedback' },
      status: 400,
    })
    await call('PUT', `${submissionPath}/grade`, {
      cookie: teacher.cookie,
      payload: { scores: [8], feedback: 'Feedback' },
    })
    const { body: graded } = await call<{ submission: Submission }>(
      'GET',
      path,
      { cookie: student.cookie }
    )
    assert.equal(graded.submission.status, 'graded')
    assert.deepEqual(graded.submission.grade, {
      scores: [8],
      feedback: 'Feedback',
    })
    assert.deepEqual(graded.submission.work.draft, firstDocument)
    assert.deepEqual(graded.submission.work.revision, finalDocument)
  }
})
