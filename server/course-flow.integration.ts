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
  Notification,
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
  let modelFailure: 'rateLimit' | 'empty' | 'badExcerpt' | null = null
  const model = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString())
    const system: string = input.messages[0].content
    const content: string = JSON.parse(input.messages[1].content).content
    if (modelFailure === 'rateLimit') {
      response.writeHead(429).end()
      return
    }
    const result = {
      summary: system.includes('Simplified Chinese')
        ? '请补充证据。'
        : 'Add evidence.',
      suggestions: [
        {
          focus:
            modelFailure === 'badExcerpt'
              ? 'Missing excerpt'
              : content.slice(0, 24),
          advice: system.includes('Simplified Chinese')
            ? '补充一个实例。'
            : 'Give a concrete example.',
        },
      ],
      ...(system.includes('tentative grade') ? { scores: [7] } : {}),
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: modelFailure === 'empty' ? '  ' : JSON.stringify(result),
            },
          },
        ],
      })
    )
  })
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
  t.after(() => model.close())
  const address = model.address()
  assert.ok(address && typeof address === 'object')
  process.env.AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`

  const [{ createApp }, { db, pool }, { user }, { blockText, countWriting }] =
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
    const email = `${randomUUID()}@example.test`
    const { body, cookie } = await call<{ user: { id: string } }>(
      'POST',
      '/api/auth/sign-up/email',
      {
        payload: {
          name,
          email,
          password: 'Test-passphrase-2026',
          role: 'admin',
        },
        remoteAddress: `192.0.2.${nextAddress++}`,
      }
    )
    assert.ok(cookie)
    return { id: body.user.id, email, cookie: `${cookie.name}=${cookie.value}` }
  }
  const teacher = await signUp('Teacher')
  const outsider = await signUp('Other teacher')
  const student = await signUp('Student')
  const peer = await signUp('Peer')
  const admin = await signUp('Administrator')
  await db.update(user).set({ role: 'admin' }).where(eq(user.id, admin.id))
  for (const person of [teacher, outsider]) {
    await db.update(user).set({ role: 'teacher' }).where(eq(user.id, person.id))
  }
  const { body: self } = await call<Identity>('GET', '/api/me', {
    cookie: student.cookie,
  })
  assert.equal(self.role, 'student')
  for (const person of [student, teacher]) {
    await call('GET', '/api/admin/users', {
      cookie: person.cookie,
      status: 403,
    })
    const { body: profile } = await call<Identity>('PATCH', '/api/me', {
      cookie: person.cookie,
      payload: { name: 'Updated display name', role: 'admin' },
    })
    assert.equal(profile.name, 'Updated display name')
    assert.equal(profile.role, person === student ? 'student' : 'teacher')
  }
  await call('PATCH', '/api/me', {
    cookie: teacher.cookie,
    payload: { submissionNotifications: true },
  })
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
  const coursePath = `/api/classes/${course.id}`
  await call('GET', coursePath, { cookie: outsider.cookie, status: 404 })
  await call('GET', coursePath, { cookie: student.cookie, status: 403 })
  await call('PATCH', coursePath, {
    cookie: teacher.cookie,
    payload: { name: 'Renamed class' },
  })
  await call('POST', `${coursePath}/students`, {
    cookie: teacher.cookie,
    payload: { email: outsider.email },
    status: 404,
  })
  await call('POST', `${coursePath}/students`, {
    cookie: teacher.cookie,
    payload: { email: student.email },
  })
  const { body: roster } = await call<{
    classroom: Classroom
    students: Identity[]
  }>('GET', coursePath, { cookie: teacher.cookie })
  assert.equal(roster.classroom.name, 'Renamed class')
  assert.equal(roster.students.length, 2)
  const { body: auditedUsers } = await call<Identity[]>(
    'GET',
    '/api/admin/users',
    { cookie: admin.cookie }
  )
  assert.ok(
    auditedUsers.some(
      (person) => person.id === student.id && person.role === 'student'
    )
  )
  const { body: targetClass } = await call<Classroom>('POST', '/api/classes', {
    cookie: admin.cookie,
    payload: { name: 'Target class', teacherId: teacher.id },
    status: 201,
  })
  const readNotifications = async (cookie: string, assignmentId: string) =>
    (
      await call<Notification[]>('GET', '/api/notifications', { cookie })
    ).body.filter((item) => item.assignmentId === assignmentId)

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
      status = 200,
      target?: Submission['stage']
    ) =>
      (
        await call<Submission>('PUT', `${path}/work`, {
          cookie: student.cookie,
          payload: { stage, action, version, changes, target },
          status,
        })
      ).body
    const goals = await save('goals', 'save', 0, { goal: 'Support each claim' })
    await call('PATCH', path, {
      cookie: teacher.cookie,
      payload: {
        ...assignmentInput,
        rubric: [{ ...assignmentInput.rubric[0], max: 9 }],
      },
      status: 409,
    })
    await call('PATCH', path, {
      cookie: outsider.cookie,
      payload: assignmentInput,
      status: 404,
    })
    await call('PATCH', path, {
      cookie: admin.cookie,
      payload: { ...assignmentInput, classroomId: targetClass.id },
      status: 400,
    })
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
    await save(
      'draft',
      'navigate',
      draft.version,
      { title: 'Title only' },
      400,
      'revise'
    )
    await save(
      'draft',
      'navigate',
      draft.version,
      { title: 'Title only' },
      400,
      'reflect'
    )
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
      revisionTitle: 'Independent final title',
      checked: [0],
    })
    await call('POST', `${path}/reviews`, {
      cookie: student.cookie,
      payload: { task: 'revision', block: 1 },
      status: 400,
    })
    for (const failure of ['rateLimit', 'empty', 'badExcerpt'] as const) {
      modelFailure = failure
      await call('POST', `${path}/reviews`, {
        cookie: student.cookie,
        payload: { task: 'revision', version: updated.version, block: 0 },
        status: 502,
      })
    }
    modelFailure = null
    const { body: review } = await call<AiReview>('POST', `${path}/reviews`, {
      cookie: student.cookie,
      payload: { task: 'revision', version: updated.version, block: 0 },
      status: 201,
    })
    assert.equal(review.source?.text, blockText(finalDocument.content[0]))
    assert.equal(review.source?.version, updated.version)
    const { body: decided } = await call<AiReview>(
      'PUT',
      `${path}/reviews/${review.id}/decisions/0`,
      {
        cookie: student.cookie,
        payload: { choice: 'accepted', reason: 'Useful feedback' },
      }
    )
    assert.equal(decided.decisions[0].choice, 'accepted')
    const back = await save(
      'revise',
      'navigate',
      updated.version,
      {},
      200,
      'outline'
    )
    const blank = await save('outline', 'save', back.version, { outline: '' })
    await save('outline', 'navigate', blank.version, {}, 400, 'reflect')
    const newDraft = await save(
      'outline',
      'navigate',
      blank.version,
      { outline: 'Updated outline' },
      200,
      'draft'
    )
    const rechecked = await save(
      'draft',
      'navigate',
      newDraft.version,
      { title: 'Independent first title' },
      200,
      'reflect'
    )
    assert.equal(rechecked.openedStage, 'reflect')
    assert.equal(rechecked.work.revisionTitle, 'Independent final title')
    assert.deepEqual(rechecked.work.revision, finalDocument)
    assert.equal(rechecked.work.reflection, 'Added evidence')
    const submitted = await save('reflect', 'submit', rechecked.version, {})
    assert.equal(submitted.status, 'submitted')
    assert.deepEqual(submitted.requirements, assignmentInput)
    assert.equal(
      (await readNotifications(teacher.cookie, assignment.id)).filter(
        (item) => item.kind === 'submission'
      ).length,
      1
    )
    const edited = {
      ...assignmentInput,
      instructions: 'Updated requirements after submission.',
      dueAt: new Date(Date.now() + 7200_000).toISOString(),
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await call('PATCH', path, { cookie: teacher.cookie, payload: edited })
    }
    assert.equal(
      (await readNotifications(student.cookie, assignment.id)).length,
      0
    )
    assert.equal(
      (await readNotifications(peer.cookie, assignment.id)).filter(
        (item) => item.kind === 'assignmentChanged'
      ).length,
      1
    )
    const { body: updatedForPeer } = await call<{ assignment: Assignment }>(
      'GET',
      path,
      { cookie: peer.cookie }
    )
    assert.equal(updatedForPeer.assignment.instructions, edited.instructions)
    const { body: copied } = await call<Assignment>(
      'POST',
      '/api/assignments',
      {
        cookie: teacher.cookie,
        payload: { ...edited, classroomId: targetClass.id },
        status: 201,
      }
    )
    const { body: copy } = await call<{
      assignment: Assignment
      submissions: Submission[]
    }>('GET', `/api/assignments/${copied.id}`, { cookie: teacher.cookie })
    assert.equal(copy.assignment.classroomId, targetClass.id)
    assert.equal(copy.submissions.length, 0)
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
    const { body: submittedDetail } = await call<{ assignment: Assignment }>(
      'GET',
      submissionPath,
      { cookie: teacher.cookie }
    )
    assert.equal(
      submittedDetail.assignment.instructions,
      assignmentInput.instructions
    )
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
      payload: {
        scores: [8],
        feedback: 'Feedback',
        annotations: [{ block: 1, text: 'Wrong block' }],
      },
      status: 400,
    })
    const grade = {
      scores: [8],
      feedback: 'Feedback',
      criteriaFeedback: ['Strong evidence'],
      annotations: [{ block: 0, criterion: 0, text: 'Explain this evidence.' }],
    }
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: 'PUT',
          url: `${submissionPath}/grade`,
          headers: { origin, cookie: teacher.cookie },
          payload: grade,
        })
      )
    )
    assert.deepEqual(
      concurrent.map((reply) => reply.statusCode).sort(),
      [200, 409]
    )
    const [gradeMessage, ...duplicates] = await readNotifications(
      student.cookie,
      assignment.id
    )
    assert.equal(gradeMessage.kind, 'grade')
    assert.equal(gradeMessage.readAt, null)
    assert.equal(duplicates.length, 0)
    assert.equal(
      (await readNotifications(peer.cookie, assignment.id)).some(
        (item) => item.kind === 'grade'
      ),
      false
    )
    await call('PUT', `/api/notifications/${gradeMessage.id}/read`, {
      cookie: peer.cookie,
      status: 404,
    })
    await call('PUT', `/api/notifications/${gradeMessage.id}/read`, {
      cookie: student.cookie,
    })
    assert.ok(
      (await readNotifications(student.cookie, assignment.id))[0].readAt
    )
    const { body: graded } = await call<{ submission: Submission }>(
      'GET',
      path,
      { cookie: student.cookie }
    )
    assert.equal(graded.submission.status, 'graded')
    assert.deepEqual(graded.submission.grade, grade)
    assert.deepEqual(graded.submission.work.draft, firstDocument)
    assert.deepEqual(graded.submission.work.revision, finalDocument)
    await call('DELETE', `${coursePath}/students/${student.id}`, {
      cookie: teacher.cookie,
      payload: { confirmed: true },
    })
    await call('POST', '/api/classes/join', {
      cookie: student.cookie,
      payload: { code: course.joinCode },
      status: 403,
    })
    await call('GET', path, { cookie: student.cookie, status: 404 })
    await call('GET', submissionPath, { cookie: teacher.cookie })
    await call('POST', `${coursePath}/students`, {
      cookie: teacher.cookie,
      payload: { email: student.email },
    })
    await call('GET', path, { cookie: student.cookie })
    await call('PATCH', `/api/admin/assignments/${assignment.id}`, {
      cookie: admin.cookie,
      payload: { archived: true, confirmed: true },
    })
    await call('PUT', `${path}/work`, {
      cookie: peer.cookie,
      payload: {
        stage: 'goals',
        action: 'save',
        version: 0,
        changes: { goal: 'Blocked' },
      },
      status: 409,
    })
    await call('GET', path, { cookie: student.cookie })
    await call('PATCH', `/api/admin/assignments/${assignment.id}`, {
      cookie: admin.cookie,
      payload: { archived: false, confirmed: true },
    })
  }
  const { body: assigned } = await call<
    { id: string; submissionCount: number }[]
  >('GET', '/api/admin/assignments', { cookie: admin.cookie })
  assert.ok(assigned.some((item) => item.submissionCount === 1))
  await call('PATCH', `/api/admin/users/${teacher.id}`, {
    cookie: admin.cookie,
    payload: {
      name: 'Teacher',
      role: 'student',
      disabled: false,
      confirmed: true,
    },
    status: 409,
  })
  await call('PATCH', `/api/admin/classes/${course.id}`, {
    cookie: admin.cookie,
    payload: { teacherId: outsider.id, archived: true, confirmed: true },
  })
  await call('GET', coursePath, { cookie: teacher.cookie, status: 404 })
  await call('GET', coursePath, { cookie: outsider.cookie })
  const studentState = { name: 'Student', role: 'student', confirmed: true }
  await call('PATCH', `/api/admin/users/${student.id}`, {
    cookie: admin.cookie,
    payload: { ...studentState, disabled: true },
  })
  await call('GET', '/api/me', { cookie: student.cookie, status: 401 })
  await call('POST', '/api/auth/sign-in/email', {
    payload: { email: student.email, password: 'Test-passphrase-2026' },
    status: 403,
  })
  await call('PATCH', `/api/admin/users/${student.id}`, {
    cookie: admin.cookie,
    payload: { ...studentState, disabled: false },
  })
  await call('POST', '/api/auth/sign-in/email', {
    payload: { email: student.email, password: 'Test-passphrase-2026' },
  })
  const { body: created } = await call<{ id: string }>(
    'POST',
    '/api/admin/users',
    {
      cookie: admin.cookie,
      payload: {
        name: 'Managed teacher',
        email: `${randomUUID()}@example.test`,
        password: 'Test-passphrase-2026',
        role: 'teacher',
      },
      status: 201,
    }
  )
  assert.ok(created.id)
})
