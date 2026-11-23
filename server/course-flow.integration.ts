import { eq } from 'drizzle-orm'
import type { HTTPMethods } from 'fastify'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import {
  chatPageSize,
  type ChatContact,
  type ChatConversation,
  type ChatHistory,
  type ChatMessage,
} from '../shared/chat.ts'
import type { ReviewerCandidate } from '../shared/discussions.ts'
import type { PeerReviewDirectory } from '../shared/peer.ts'
import type {
  AiReview,
  Assignment,
  AssignmentInput,
  AssignmentListItem,
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
  let modelFailure: 'rateLimit' | 'empty' | 'badExcerpt' | 'timeout' | null =
    null
  let modelCalls = 0
  const realFetch = globalThis.fetch
  let doiRequests = 0
  globalThis.fetch = (input, init) => {
    const url = String(input)
    if (modelFailure === 'timeout' && url.endsWith('/chat/completions'))
      return Promise.reject(
        new DOMException('Fixture timed out', 'TimeoutError')
      )
    if (!url.startsWith('https://api.crossref.org/'))
      return realFetch(input, init)
    doiRequests++
    assert.equal(
      url,
      'https://api.crossref.org/works/10.1234%2Fsynthetic-course-example'
    )
    return Promise.resolve(
      Response.json({
        message: {
          title: ['Synthetic source'],
          type: 'journal-article',
          author: [{ family: 'Lee', given: 'Ada' }],
          published: { 'date-parts': [[2024]] },
          'container-title': ['Test Journal'],
        },
      })
    )
  }
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const model = createServer(async (request, response) => {
    modelCalls++
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
          ...(system.includes('tentative grade')
            ? { criterion: 0, reason: 'Uses a specific example.' }
            : {}),
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

  const [
    { createApp },
    { db, pool },
    { chatMessage, user },
    { blockText, countWriting },
  ] = await Promise.all([
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

  await t.test(
    'private messages follow active shared classes and keep history on restoration',
    async () => {
      const chats = '/api/chats'
      const thread = (person: { id: string }) => `${chats}/${person.id}`
      const send = (
        from: { cookie: string },
        to: { id: string },
        body: string,
        status = 201,
        clientId = randomUUID()
      ) =>
        call<ChatMessage>('POST', `${thread(to)}/messages`, {
          cookie: from.cookie,
          status,
          payload: { clientId, body },
        })
      const unread = async (person: { cookie: string }) =>
        (
          await call<{ count: number }>('GET', `${chats}/unread`, {
            cookie: person.cookie,
          })
        ).body.count

      const unrelated = await signUp('Student in another class')
      const { body: anotherClass } = await call<Classroom>(
        'POST',
        '/api/classes',
        {
          cookie: outsider.cookie,
          payload: { name: 'Another class' },
          status: 201,
        }
      )
      await call('POST', '/api/classes/join', {
        cookie: unrelated.cookie,
        payload: { code: anotherClass.joinCode },
      })
      await call('GET', chats, { status: 401 })
      await call('GET', chats, { cookie: admin.cookie, status: 403 })
      await call('GET', thread(student), { cookie: admin.cookie, status: 403 })
      await call('GET', thread(peer), { cookie: unrelated.cookie, status: 404 })
      await send(student, unrelated, 'Cross-class contact', 404)
      await send(student, student, 'Self-chat', 404)
      await send(student, peer, '   ', 400)
      await send(student, peer, 'x'.repeat(2001), 400)

      const { body: contacts } = await call<ChatContact[]>(
        'GET',
        `${chats}/contacts`,
        { cookie: student.cookie }
      )
      assert.deepEqual(
        new Set(contacts.map(({ id }) => id)),
        new Set([teacher.id, peer.id])
      )
      assert.ok(
        contacts.every(
          (contact) =>
            contact.classrooms.includes('Renamed class') &&
            !('email' in contact)
        )
      )

      const clientId = randomUUID()
      const [first, duplicate] = await Promise.all([
        send(peer, student, '同班私信测试', 201, clientId),
        send(peer, student, '同班私信测试', 201, clientId),
      ])
      assert.equal(first.body.id, duplicate.body.id)
      const { body: teacherNote } = await send(
        teacher,
        student,
        'Teacher feedback fixture'
      )
      await send(student, teacher, 'Acknowledged')
      assert.equal(await unread(student), 2)
      const { body: inbox } = await call<ChatConversation[]>('GET', chats, {
        cookie: student.cookie,
      })
      assert.equal(inbox.length, 2)
      assert.equal(
        inbox.find(({ contact }) => contact.id === peer.id)?.unread,
        1
      )
      const { body: history } = await call<ChatHistory>('GET', thread(peer), {
        cookie: student.cookie,
      })
      assert.deepEqual(history.messages, [first.body])
      assert.deepEqual(history.unreadIds, [first.body.id])
      await call('PUT', `${thread(peer)}/read`, {
        cookie: student.cookie,
        payload: { ids: [first.body.id, teacherNote.id] },
      })
      assert.equal(await unread(student), 1)
      await call('PUT', `${thread(teacher)}/read`, {
        cookie: student.cookie,
        payload: { ids: [teacherNote.id] },
      })
      assert.equal(await unread(student), 0)

      await call('DELETE', `${coursePath}/students/${peer.id}`, {
        cookie: teacher.cookie,
        payload: { confirmed: true },
      })
      await call('GET', thread(peer), { cookie: student.cookie, status: 404 })
      await call('PUT', `${thread(peer)}/read`, {
        cookie: student.cookie,
        payload: { ids: [first.body.id] },
        status: 404,
      })
      const { body: hidden } = await call<ChatConversation[]>('GET', chats, {
        cookie: student.cookie,
      })
      assert.deepEqual(
        hidden.map(({ contact }) => contact.id),
        [teacher.id]
      )
      await send(peer, student, 'Removed student', 404)
      await call('POST', `${coursePath}/students`, {
        cookie: teacher.cookie,
        payload: { email: peer.email },
      })

      for (const person of [student, peer]) {
        await call('POST', '/api/classes/join', {
          cookie: person.cookie,
          payload: { code: anotherClass.joinCode },
        })
      }
      const archive = (classId: string, teacherId: string, archived: boolean) =>
        call('PATCH', `/api/admin/classes/${classId}`, {
          cookie: admin.cookie,
          payload: { teacherId, archived, confirmed: true },
        })
      await archive(course.id, teacher.id, true)
      const { body: shared } = await call<ChatHistory>('GET', thread(peer), {
        cookie: student.cookie,
      })
      assert.deepEqual(shared.messages, [first.body])
      await call('GET', thread(teacher), {
        cookie: student.cookie,
        status: 404,
      })
      await archive(anotherClass.id, outsider.id, true)
      await call('GET', thread(peer), { cookie: student.cookie, status: 404 })
      await archive(course.id, teacher.id, false)
      const { body: restored } = await call<ChatHistory>('GET', thread(peer), {
        cookie: student.cookie,
      })
      assert.deepEqual(restored.messages, [first.body])

      await db.insert(chatMessage).values(
        Array.from({ length: chatPageSize }, (_, index) => ({
          senderId: student.id,
          recipientId: peer.id,
          clientId: randomUUID(),
          body: `Page fixture ${index}`,
        }))
      )
      const { body: latest } = await call<ChatHistory>('GET', thread(peer), {
        cookie: student.cookie,
      })
      assert.equal(latest.messages.length, chatPageSize)
      assert.equal(latest.hasOlder, true)
      const { body: earlier } = await call<ChatHistory>(
        'GET',
        `${thread(peer)}?before=${latest.messages[0].id}`,
        { cookie: student.cookie }
      )
      assert.deepEqual(earlier.messages, [first.body])
      assert.equal(earlier.hasOlder, false)
    }
  )

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
      aiPolicy: ['outline', 'revision', 'assessment'],
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
    const { body: manual } = await call<{ id: string }>(
      'POST',
      '/api/assignments',
      {
        cookie: teacher.cookie,
        payload: { ...assignmentInput, classroomId: course.id, aiPolicy: [] },
        status: 201,
      }
    )
    const beforeDenied = modelCalls
    await call('POST', `/api/assignments/${manual.id}/reviews`, {
      cookie: student.cookie,
      payload: { task: 'outline' },
      status: 403,
    })
    assert.equal(modelCalls, beforeDenied)
    for (const [account, goal] of [
      [student, 'Find an example'],
      [peer, 'Compare two sources'],
    ] as const) {
      const { body: individual } = await call<Submission>(
        'PUT',
        `/api/assignments/${manual.id}/work`,
        {
          cookie: account.cookie,
          payload: {
            stage: 'goals',
            action: 'advance',
            version: 0,
            changes: { personalGoals: { writing: [goal], ai: [] } },
          },
        }
      )
      assert.equal(individual.stage, 'outline')
    }
    for (const [account, goal] of [
      [student, 'Find an example'],
      [peer, 'Compare two sources'],
    ] as const) {
      const { body: individual } = await call<{ submission: Submission }>(
        'GET',
        `/api/assignments/${manual.id}`,
        { cookie: account.cookie }
      )
      assert.deepEqual(individual.submission.work.personalGoals, {
        writing: [goal],
        ai: [],
      })
    }
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
    if (language === 'zh-CN') {
      const lookup = `${path}/reference-doi`
      const payload = {
        doi: 'https://doi.org/10.1234/SYNTHETIC-COURSE-EXAMPLE',
      }
      await call('POST', lookup, {
        cookie: outsider.cookie,
        payload,
        status: 403,
      })
      const { body: record } = await call<{
        title: string
        verified: boolean
        authors: { family: string }[]
      }>('POST', lookup, { cookie: student.cookie, payload })
      assert.equal(record.title, 'Synthetic source')
      assert.equal(record.authors[0].family, 'Lee')
      assert.equal(record.verified, false)
      await call('POST', lookup, {
        cookie: student.cookie,
        payload,
        status: 429,
      })
      assert.equal(doiRequests, 1)
    }
    const finalDocument = paragraph(
      language === 'en' ? 'Evidence supports the claim.' : '证据支持论点。'
    )
    const source = {
      id: randomUUID(),
      kind: 'article',
      title: 'Synthetic bilingual course sample',
      authors: [{ family: 'Lee', given: 'Ada' }],
      year: '2024',
      venue: 'Example Journal',
      volume: '1',
      issue: '2',
      pages: '3–4',
      url: 'https://example.org/evidence',
      doi: '',
      evidence: 'Supports the claim',
      locator: 'p. 3',
      verified: true,
    }
    finalDocument.content[0].content?.push({
      type: 'citation',
      attrs: { sourceId: source.id, locator: source.locator },
    })
    assert.equal(
      countWriting(finalDocument, language),
      language === 'en' ? 4 : 6
    )
    const updated = await save('revise', 'save', edit.version, {
      revision: finalDocument,
      revisionTitle: 'Independent final title',
      checked: [0],
      sources: [source],
    })
    await save('revise', 'save', updated.version, { sources: [] }, 400)
    await call('POST', `${path}/reviews`, {
      cookie: student.cookie,
      payload: { task: 'revision', block: 1 },
      status: 400,
    })
    for (const failure of [
      'rateLimit',
      'empty',
      'badExcerpt',
      'timeout',
    ] as const) {
      modelFailure = failure
      const { body: failureResponse } = await call<{ code: string }>(
        'POST',
        `${path}/reviews`,
        {
          cookie: student.cookie,
          payload: { task: 'revision', version: updated.version, block: 0 },
          status: 502,
        }
      )
      if (failure === 'timeout')
        assert.equal(failureResponse.code, 'aiTimedOut')
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
    await save('reflect', 'submit', rechecked.version, {}, 400)
    let submitted = await save('reflect', 'submit', rechecked.version, {
      aiDeclaration: {
        used: true,
        description: 'Used the course coach to find missing evidence.',
      },
    })
    assert.equal(submitted.status, 'submitted')
    const dashboardAssignment = async (cookie: string) => {
      const { body } = await call<{ assignments: AssignmentListItem[] }>(
        'GET',
        '/api/dashboard',
        { cookie }
      )
      return body.assignments.find((item) => item.id === assignment.id)
    }
    assert.equal(
      (await dashboardAssignment(teacher.cookie))?.pendingSubmissions,
      1
    )
    assert.equal(
      (await dashboardAssignment(student.cookie))?.pendingSubmissions,
      undefined
    )
    assert.equal(await dashboardAssignment(outsider.cookie), undefined)
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
    await call('GET', `${submissionPath}/export`, {
      cookie: outsider.cookie,
      status: 404,
    })
    const exported = await app.inject({
      method: 'GET',
      url: `${submissionPath}/export`,
      headers: { origin, cookie: teacher.cookie },
    })
    assert.equal(exported.statusCode, 200)
    assert.match(exported.headers['content-type'] ?? '', /wordprocessingml/)
    assert.equal(exported.rawPayload.subarray(0, 2).toString(), 'PK')
    const draftGrade = {
      submissionVersion: submitted.version,
      version: 0,
      input: {
        scores: [null],
        feedback: 'Review in progress',
        criteriaFeedback: ['Check evidence'],
        annotations: [{ block: 0, criterion: 0, text: 'Draft comment.' }],
      },
    }
    const draftPath = `${submissionPath}/grade-draft`
    await call('PUT', draftPath, {
      cookie: peer.cookie,
      payload: draftGrade,
      status: 403,
    })
    await call('PUT', draftPath, {
      cookie: outsider.cookie,
      payload: draftGrade,
      status: 404,
    })
    await call('PUT', draftPath, {
      cookie: teacher.cookie,
      payload: draftGrade,
    })
    await call('PUT', draftPath, {
      cookie: teacher.cookie,
      payload: draftGrade,
      status: 409,
    })
    const { body: reopenedGrade } = await call<{ gradeDraft: unknown }>(
      'GET',
      submissionPath,
      { cookie: teacher.cookie }
    )
    assert.deepEqual(reopenedGrade.gradeDraft, { ...draftGrade, version: 1 })
    const { body: studentView } = await call<{ submission: Submission }>(
      'GET',
      path,
      { cookie: student.cookie }
    )
    assert.equal(studentView.submission.grade, null)
    assert.equal('gradeDraft' in studentView.submission, false)
    await call('PUT', draftPath, {
      cookie: teacher.cookie,
      payload: {
        ...draftGrade,
        version: 1,
        input: { ...draftGrade.input, scores: [8] },
      },
    })
    const { body: assessment } = await call<AiReview>(
      'POST',
      `${path}/reviews`,
      {
        cookie: teacher.cookie,
        payload: {
          task: 'assessment',
          submissionId: submitted.id,
          calibrate: true,
        },
        status: 201,
      }
    )
    assert.deepEqual(assessment.result.scores, [7])
    assert.equal(assessment.result.suggestions[0].criterion, 0)
    assert.deepEqual(assessment.calibration, {
      baseline: [8],
      evidence: [null],
    })
    const calibrationPath = `${path}/reviews/${assessment.id}/calibration`
    await call('PUT', calibrationPath, {
      cookie: peer.cookie,
      payload: { evidence: [true] },
      status: 403,
    })
    await call('PUT', calibrationPath, {
      cookie: teacher.cookie,
      payload: { evidence: [true] },
    })
    const peers = `${path}/peers`
    await call('GET', peers, { cookie: outsider.cookie, status: 404 })
    const reviewerSearch = `${path}/reviewers?${new URLSearchParams({ query: peer.email.slice(0, 12).toUpperCase(), submissionId: submitted.id, version: String(submitted.version) })}`
    const teacherMatches = (
      await call<ReviewerCandidate[]>('GET', reviewerSearch, {
        cookie: teacher.cookie,
      })
    ).body
    assert.deepEqual(
      teacherMatches.map(({ id }) => id),
      [peer.id]
    )
    assert.notEqual(teacherMatches[0].emailHint, peer.email)
    assert.deepEqual(
      (
        await call<ReviewerCandidate[]>('GET', reviewerSearch, {
          cookie: student.cookie,
        })
      ).body,
      []
    )
    await call('GET', reviewerSearch, { cookie: outsider.cookie, status: 404 })
    await call('GET', reviewerSearch, { cookie: peer.cookie, status: 404 })
    const { body: pairing } = await call<{ id: string }>('POST', peers, {
      cookie: teacher.cookie,
      payload: {
        action: 'assign',
        submissionId: submitted.id,
        reviewerId: teacherMatches[0].id,
        version: submitted.version,
      },
    })
    const assignedMatches = (
      await call<ReviewerCandidate[]>('GET', reviewerSearch, {
        cookie: student.cookie,
      })
    ).body
    assert.deepEqual(
      assignedMatches.map(({ id }) => id),
      [peer.id]
    )
    const readPeers = async (cookie: string) =>
      (await call<PeerReviewDirectory>('GET', peers, { cookie })).body
    assert.deepEqual(
      (await readPeers(peer.cookie)).reviews[0].paper?.doc,
      finalDocument
    )
    assert.equal(
      (await readPeers(peer.cookie)).reviews[0].paper?.references[0].evidence,
      ''
    )
    assert.equal((await readPeers(student.cookie)).reviews[0].paper, undefined)
    const feedback = {
      action: 'feedback',
      reviewId: pairing.id,
      feedback: {
        criterion: 0,
        comment: 'The evidence is clear.',
        improvement: 'Add a second example.',
      },
    }
    await call('POST', peers, {
      cookie: student.cookie,
      payload: feedback,
      status: 409,
    })
    await call('POST', peers, { cookie: peer.cookie, payload: feedback })
    assert.deepEqual(
      (await readPeers(student.cookie)).reviews[0].feedback,
      feedback.feedback
    )
    await call('POST', peers, {
      cookie: student.cookie,
      payload: {
        action: 'report',
        reviewId: pairing.id,
        reason: 'Check the example.',
      },
    })
    assert.equal((await readPeers(student.cookie)).reviews[0].feedback, null)
    assert.equal(
      (await readPeers(teacher.cookie)).reviews[0].reportReason,
      'Check the example.'
    )
    await call('POST', peers, {
      cookie: teacher.cookie,
      payload: { action: 'resolve', reviewId: pairing.id },
    })
    assert.deepEqual(
      (await readPeers(student.cookie)).reviews[0].feedback,
      feedback.feedback
    )

    const returnPath = `${submissionPath}/return`
    const returnData = {
      version: submitted.version,
      draftVersion: 2,
      reason: 'Explain the source more clearly.',
      dueAt: new Date(Date.now() + 10800_000).toISOString(),
    }
    await call('POST', returnPath, {
      cookie: outsider.cookie,
      payload: returnData,
      status: 404,
    })
    await call('POST', returnPath, {
      cookie: teacher.cookie,
      payload: returnData,
    })
    await call('POST', returnPath, {
      cookie: teacher.cookie,
      payload: returnData,
      status: 409,
    })
    const { body: reopened } = await call<{
      assignment: Assignment
      submission: Submission
      previousReviews: AiReview[]
    }>('GET', path, { cookie: student.cookie })
    assert.equal(reopened.assignment.dueAt, returnData.dueAt)
    assert.equal(reopened.submission.stage, 'revise')
    assert.deepEqual(reopened.submission.returned?.work.revision, finalDocument)
    assert.equal(reopened.previousReviews[0].decisions[0].choice, 'accepted')
    assert.equal(
      (await dashboardAssignment(teacher.cookie))?.progress?.draft,
      1
    )
    const secondDocument = structuredClone(finalDocument)
    secondDocument.content[0].content?.push({
      type: 'text',
      text: language === 'en' ? ' A second example.' : ' 补充例证。',
    })
    const secondReflect = await save(
      'revise',
      'advance',
      reopened.submission.version,
      { revision: secondDocument }
    )
    submitted = await save('reflect', 'submit', secondReflect.version, {
      reflection: 'I added a second example.',
      aiDeclaration: { used: false, description: '' },
    })
    assert.deepEqual(submitted.returned?.work.revision, finalDocument)
    assert.deepEqual(submitted.work.revision, secondDocument)
    await call('POST', returnPath, {
      cookie: teacher.cookie,
      payload: { ...returnData, version: submitted.version, draftVersion: 0 },
      status: 409,
    })
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
    const publish = {
      ...grade,
      submissionVersion: submitted.version,
      draftVersion: 0,
    }
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: 'PUT',
          url: `${submissionPath}/grade`,
          headers: { origin, cookie: teacher.cookie },
          payload: publish,
        })
      )
    )
    assert.deepEqual(
      concurrent.map((reply) => reply.statusCode).sort(),
      [200, 409]
    )
    const [gradeMessage, ...duplicates] = (
      await readNotifications(student.cookie, assignment.id)
    ).filter((item) => item.kind === 'grade')
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
      (await readNotifications(student.cookie, assignment.id)).find(
        (item) => item.id === gradeMessage.id
      )?.readAt
    )
    const { body: graded } = await call<{ submission: Submission }>(
      'GET',
      path,
      { cookie: student.cookie }
    )
    assert.equal(graded.submission.status, 'graded')
    assert.equal(
      (await dashboardAssignment(teacher.cookie))?.pendingSubmissions,
      0
    )
    assert.deepEqual(graded.submission.grade, grade)
    assert.deepEqual(graded.submission.work.draft, firstDocument)
    assert.deepEqual(graded.submission.work.revision, secondDocument)
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
  await call('GET', '/api/admin/diagnostics', {
    cookie: teacher.cookie,
    status: 403,
  })
  const { body: diagnostics } = await call<{ model: { outcome: string }[] }>(
    'GET',
    '/api/admin/diagnostics',
    { cookie: admin.cookie }
  )
  assert.ok(diagnostics.model.some((item) => item.outcome === 'aiRateLimited'))
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
