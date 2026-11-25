import { Document, Packer, Paragraph } from 'docx'
import type { HTTPMethods } from 'fastify'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'

test('private document versions, search, invitations and debate recovery', async (t) => {
  const database = process.env.TEST_DATABASE_URL
  assert.ok(database)
  assert.match(new URL(database).pathname, /_test$/u)
  process.env.DATABASE_URL = database
  process.env.BETTER_AUTH_SECRET = 'fixture-personal-documents-test-secret'
  process.env.APP_ORIGIN = 'http://localhost:5173'
  process.env.AI_BASE_URL = 'http://localhost:18291'
  process.env.AI_API_KEY = 'fixture-only'
  process.env.AI_MODEL = 'fixture-debate'
  process.env.OFFICE_URL = 'http://localhost:18292'
  process.env.OFFICE_APP_URL = 'http://localhost:5173'
  process.env.OFFICE_SECRET = 'fixture-office-callback-secret-for-tests'
  const storage = await mkdtemp(path.join(tmpdir(), 'writing-aide-documents-'))
  process.env.DOCUMENT_STORAGE = storage
  const realFetch = globalThis.fetch
  let failOnce = true
  const prompts: string[] = []
  const officeFiles = new Map<string, Buffer>()
  globalThis.fetch = (input, init) => {
    const officeFile = officeFiles.get(String(input))
    if (officeFile)
      return Promise.resolve(new Response(new Uint8Array(officeFile)))
    if (!String(input).startsWith('http://localhost:18291/'))
      return realFetch(input, init)
    prompts.push(String(init?.body))
    if (prompts.length === 2 && failOnce) {
      failOnce = false
      return Promise.resolve(new Response(null, { status: 502 }))
    }
    return Promise.resolve(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: `Fixture evidence ${prompts.length}`,
              }),
            },
          },
        ],
      })
    )
  }
  const [{ createApp }, { pool }] = await Promise.all([
    import('./app.ts'),
    import('./db.ts'),
  ])
  const app = createApp()
  t.after(async () => {
    globalThis.fetch = realFetch
    await app.close()
    await pool.end()
    await rm(storage, { recursive: true, force: true })
  })
  const origin = process.env.APP_ORIGIN
  const unique = randomUUID()
  async function signup(name: string, account = name) {
    const email = `${account}.${unique}@example.org`
    const result = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin },
      payload: { name, email, password: `Example-${unique}` },
      remoteAddress: `127.0.0.${account.length}`,
    })
    assert.equal(result.statusCode, 200, result.body)
    return {
      id: result.json<{ user: { id: string } }>().user.id,
      email,
      cookie: ([] as string[])
        .concat(result.headers['set-cookie'] ?? [])
        .map((value) => value.split(';')[0])
        .join('; '),
    }
  }
  const owner = await signup('author')
  const namesake = `林同学 ${unique}`
  const reviewer = await signup(namesake, 'reviewer')
  const outsider = await signup(namesake, 'outsider')
  const disabled = await signup(namesake, 'inactive')
  await pool.query('update "user" set disabled = true where id = $1', [
    disabled.id,
  ])
  const call = (
    person: typeof owner,
    method: HTTPMethods,
    url: string,
    payload?: object | Buffer
  ) =>
    app.inject({
      method,
      url,
      payload,
      headers: {
        origin,
        cookie: person.cookie,
        ...(Buffer.isBuffer(payload)
          ? { 'content-type': 'application/octet-stream' }
          : {}),
      },
    })
  const source = `字體繁體與中文短語😀\nEvidence supports the claim.\r\n${'x'.repeat(6001)}`
  const md = await call(
    owner,
    'POST',
    '/api/documents/upload?filename=evidence.markdown',
    Buffer.from(source)
  )
  assert.equal(md.statusCode, 201, md.body)
  const { id } = md.json<{ id: string }>()
  const base = `/api/documents/${id}`
  const original = `${base}/versions/1/file`
  assert.equal((await call(owner, 'GET', original)).body, source)
  assert.equal((await call(outsider, 'GET', original)).statusCode, 404)
  const wrong = await call(
    owner,
    'POST',
    '/api/documents/upload?filename=bad.docx',
    Buffer.from(source)
  )
  assert.equal(wrong.statusCode, 422, wrong.body)

  const word = await Packer.toBuffer(
    new Document({
      sections: [{ children: [new Paragraph('中文短語 and proof.')] }],
    })
  )
  const wordUpload = await call(
    owner,
    'POST',
    '/api/documents/upload?filename=word.docx',
    word
  )
  assert.equal(wordUpload.statusCode, 201, wordUpload.body)
  const blank = await call(reviewer, 'POST', '/api/documents/word', {
    title: 'Untitled',
  })
  assert.equal(blank.statusCode, 201, blank.body)
  const pdf = createPdf()
  const pdfUpload = await call(
    owner,
    'POST',
    '/api/documents/upload?filename=text.pdf',
    pdf
  )
  assert.equal(pdfUpload.statusCode, 201, pdfUpload.body)
  const { id: pdfId } = pdfUpload.json<{ id: string }>()
  const range = await app.inject({
    url: `/api/documents/${pdfId}/versions/1/file`,
    headers: { cookie: owner.cookie, range: 'bytes=0-4' },
  })
  assert.equal(range.statusCode, 206)
  assert.equal(range.body, '%PDF-')

  async function search(query: string, total: number) {
    let count = -1
    for (let attempt = 0; attempt < 60 && count !== total; attempt++) {
      const result = await call(
        owner,
        'GET',
        `/api/documents?q=${encodeURIComponent(query)}`
      )
      assert.equal(result.statusCode, 200, result.body)
      count = result.json<{ total: number }>().total
      if (count !== total) await setTimeout(250)
    }
    assert.equal(count, total, query)
  }
  await search('中文短語', 2)
  await search('ＰＲＯＯＦ', 2)
  await search('vidence', 1) // The filename matches, but a partial English word in the PDF does not.
  assert.equal(
    (await call(outsider, 'GET', '/api/documents?q=proof')).json().total,
    0
  )

  const blankId = blank.json().id
  const blankPath = `/api/documents/${blankId}`
  const editor = async () => {
    const result = await call(reviewer, 'POST', `${blankPath}/office`, {
      version: 1,
      edit: true,
      language: 'en',
    })
    assert.equal(result.statusCode, 200, result.body)
    return result.json<{ id: string }>().id
  }
  const [windowA, windowB] = await Promise.all([editor(), editor()])
  const fileA = `${process.env.OFFICE_URL}/cache/files/window-a.docx`
  const fileB = `${process.env.OFFICE_URL}/cache/files/window-b.docx`
  officeFiles.set(fileA, word)
  officeFiles.set(
    fileB,
    await Packer.toBuffer(
      new Document({
        sections: [{ children: [new Paragraph('Independent window edits')] }],
      })
    )
  )
  function officeSave(key: string, url: string, signed = true, status = 2) {
    const payload = { key, url, status }
    const compact = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = `${compact({ alg: 'HS256' })}.${compact({ operation: 'callback', exp: Math.floor(Date.now() / 1000) + 60, payload })}`
    const signature = createHmac('sha256', process.env.OFFICE_SECRET!)
      .update(token)
      .digest('base64url')
    return app.inject({
      method: 'POST',
      url: `/api/office/callback/${key}`,
      headers: signed ? { authorization: `Bearer ${token}.${signature}` } : {},
      payload,
    })
  }
  assert.equal((await officeSave(windowA, fileA, false)).statusCode, 403)
  assert.equal((await officeSave(windowA, fileA)).json().error, 0)
  assert.equal((await officeSave(windowA, fileA)).json().error, 0)
  assert.equal((await officeSave(windowA, fileB, true, 6)).json().error, 0)
  assert.equal((await officeSave(windowB, fileB)).json().error, 0)
  const officeVersions = (
    await call(reviewer, 'GET', `${blankPath}/versions`)
  ).json()
  assert.deepEqual(
    officeVersions.map((entry: { number: number; conflict: boolean }) => [
      entry.number,
      entry.conflict,
    ]),
    [
      [3, true],
      [2, false],
      [1, false],
    ]
  )
  assert.equal(
    (await call(reviewer, 'GET', blankPath)).json().currentVersion,
    2
  )

  const [first, second] = await Promise.all(
    ['second version', 'concurrent version'].map((text) =>
      call(
        owner,
        'POST',
        `${base}/versions?filename=evidence.markdown&base=1`,
        Buffer.from(text)
      )
    )
  )
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409])
  const restore = await call(owner, 'POST', `${base}/versions/1/restore`, {
    base: 2,
  })
  assert.equal(restore.statusCode, 200, restore.body)
  assert.equal(
    (await call(owner, 'GET', `${base}/versions/3/file`)).body,
    source
  )

  const searchReviewers = (person: typeof owner, query: string) =>
    call(person, 'GET', `${base}/reviewers?${new URLSearchParams({ query })}`)
  const matchingNames = await searchReviewers(
    owner,
    namesake.slice(0, -4).toUpperCase()
  )
  assert.equal(matchingNames.statusCode, 200, matchingNames.body)
  const candidates =
    matchingNames.json<{ id: string; name: string; emailHint: string }[]>()
  assert.deepEqual(
    candidates.map((candidate) => candidate.id).sort(),
    [reviewer.id, outsider.id].sort()
  )
  assert.equal(
    new Set(candidates.map((candidate) => candidate.emailHint)).size,
    2
  )
  assert.ok(
    candidates.every(
      (candidate) => candidate.name === namesake && !('email' in candidate)
    )
  )
  const emailMatches = await searchReviewers(
    owner,
    reviewer.email.slice(3).toUpperCase()
  )
  assert.deepEqual(
    emailMatches.json().map((candidate: { id: string }) => candidate.id),
    [reviewer.id]
  )
  assert.deepEqual((await searchReviewers(owner, owner.email)).json(), [])
  assert.deepEqual((await searchReviewers(owner, '%')).json(), [])
  assert.equal((await searchReviewers(outsider, namesake)).statusCode, 404)
  assert.equal(
    (await app.inject({ url: `${base}/reviewers?query=reviewer` })).statusCode,
    401
  )
  const invitePath = `${base}/review-discussions`
  assert.equal(
    (
      await call(owner, 'POST', invitePath, {
        version: 1,
        mode: 'review',
        topic: 'Inactive reviewer',
        reviewerIds: [disabled.id],
      })
    ).statusCode,
    422
  )
  assert.equal(
    (
      await call(owner, 'POST', invitePath, {
        version: 1,
        mode: 'debate',
        topic: 'Duplicate reviewer',
        reviewerIds: [reviewer.id, reviewer.id],
      })
    ).statusCode,
    422
  )
  const pendingReviewer = await signup('pending reviewer', 'awaiting-review')
  const invited = await call(owner, 'POST', invitePath, {
    version: 1,
    mode: 'debate',
    topic: 'Evaluate evidence',
    reviewerIds: [reviewer.id, outsider.id, pendingReviewer.id],
  })
  assert.equal(invited.statusCode, 200, invited.body)
  const review = `/api/review-discussions/${invited.json().id}`
  const pending = (await call(pendingReviewer, 'GET', review)).json()
  assert.deepEqual(pending.participants, [])
  assert.equal(pending.paragraphs, undefined)
  assert.equal((await call(reviewer, 'GET', `${review}/file`)).statusCode, 404)
  assert.equal(
    (await call(reviewer, 'GET', '/api/notifications')).json()[0].kind,
    'reviewInvited'
  )
  assert.equal(
    (await call(reviewer, 'POST', review, { action: 'accept' })).statusCode,
    200
  )
  assert.equal(
    (await call(outsider, 'POST', review, { action: 'accept' })).statusCode,
    200
  )
  assert.equal((await call(reviewer, 'GET', `${review}/file`)).body, source)
  const accepted = (await call(reviewer, 'GET', review)).json()
  assert.equal(accepted.canManage, false)
  assert.equal(accepted.paragraphs[1].trim(), 'Evidence supports the claim.')
  assert.deepEqual(
    Object.fromEntries(
      accepted.participants.map(
        ({ id, state }: { id: string; state: string }) => [id, state]
      )
    ),
    {
      [owner.id]: 'author',
      [reviewer.id]: 'accepted',
      [outsider.id]: 'accepted',
      [pendingReviewer.id]: 'pending',
    }
  )
  assert.equal(
    (
      await call(reviewer, 'POST', review, {
        action: 'revoke',
        people: [outsider.id],
      })
    ).statusCode,
    403
  )
  assert.equal(
    (await call(reviewer, 'GET', `${base}/versions/3/file`)).statusCode,
    404
  )
  const post = await call(reviewer, 'POST', review, {
    action: 'post',
    body: 'Evidence needs a source.',
    role: 'challenge',
    anchor: { paragraph: 1, offset: 0, quote: 'Evidence' },
  })
  assert.equal(post.statusCode, 200, post.body)
  const messages = (await call(outsider, 'GET', review)).json().messages
  assert.equal(messages[0].anchor.quote, 'Evidence')
  assert.equal(
    (
      await call(owner, 'POST', review, {
        action: 'decision',
        message: messages[0].id,
        choice: 'partial',
        version: 3,
        reason: 'Add a verifiable source',
      })
    ).statusCode,
    200
  )

  const debate = await call(owner, 'POST', '/api/ai-debates', {
    target: { documentId: id, version: 1 },
    topic: 'Evaluate evidence',
    anchor: { paragraph: 1, offset: 0, quote: 'Evidence supports the claim.' },
    language: 'en',
  })
  assert.equal(debate.statusCode, 200, debate.body)
  const run = `/api/ai-debates/${debate.json().id}`
  assert.equal((await call(reviewer, 'GET', run)).statusCode, 404)
  assert.equal((await call(owner, 'GET', run)).json().excerpts, undefined)
  const step = (role: number) =>
    call(owner, 'POST', `${run}/step`, { round: 1, role })
  assert.equal((await step(1)).statusCode, 409)
  assert.equal((await step(0)).statusCode, 200)
  assert.equal((await step(1)).statusCode, 502)
  assert.equal((await step(1)).statusCode, 200)
  const synthesis = await step(2)
  assert.equal(synthesis.statusCode, 200, synthesis.body)
  assert.equal((await step(2)).json().id, synthesis.json().id)
  assert.match(prompts[3], /Fixture evidence 1/u)
  assert.match(prompts[3], /Fixture evidence 3/u)
  assert.equal(
    JSON.parse(JSON.parse(prompts[3]).messages[1].content).excerpt,
    'Evidence supports the claim.'
  )
  assert.equal(
    (
      await call(owner, 'POST', `${run}/share`, {
        threadId: invited.json().id,
        stepId: synthesis.json().id,
      })
    ).statusCode,
    200
  )

  const ranges = [
    { start: { paragraph: 0, offset: 9 }, end: { paragraph: 1, offset: 8 } },
    { start: { paragraph: 1, offset: 22 }, end: { paragraph: 1, offset: 28 } },
  ]
  const multiInput = {
    target: { documentId: id, version: 1 },
    topic: 'Compare evidence across paragraphs',
    language: 'en',
  }
  const multi = await call(owner, 'POST', '/api/ai-debates', {
    ...multiInput,
    ranges: ranges.toReversed(),
  })
  assert.equal(multi.statusCode, 200, multi.body)
  const multiPath = `/api/ai-debates/${multi.json().id}`
  const saved = (await call(owner, 'GET', multiPath)).json()
  assert.equal(saved.version, 1)
  assert.deepEqual(saved.excerpts, [
    { ...ranges[0], text: '😀\nEvidence' },
    { ...ranges[1], text: 'claim.' },
  ])
  const shareAnchor = { paragraph: 0, offset: 9, quote: '😀' }
  assert.deepEqual(saved.anchor, shareAnchor)
  const { runs } = (
    await call(owner, 'GET', `/api/ai-debates?documentId=${id}&version=1`)
  ).json()
  assert.deepEqual(
    runs.find((entry: { id: string }) => entry.id === multi.json().id),
    {
      id: multi.json().id,
      topic: multiInput.topic,
      version: 1,
      anchor: shareAnchor,
    }
  )
  const answer = await call(owner, 'POST', `${multiPath}/step`, {
    round: 1,
    role: 0,
  })
  assert.equal(answer.statusCode, 200, answer.body)
  const input = JSON.parse(JSON.parse(prompts.at(-1)!).messages[1].content)
  assert.deepEqual(input.excerpts, ['😀\nEvidence', 'claim.'])
  const shared = await call(owner, 'POST', `${multiPath}/share`, {
    threadId: invited.json().id,
    stepId: answer.json().id,
  })
  assert.equal(shared.statusCode, 200, shared.body)
  const { messages: updated } = (await call(owner, 'GET', review)).json()
  assert.deepEqual(
    updated.find((message: { id: string }) => message.id === shared.json().id)
      .anchor,
    shareAnchor
  )

  const longRange = {
    start: { paragraph: 2, offset: 0 },
    end: { paragraph: 2, offset: 6000 },
  }
  const fullBudget = await call(owner, 'POST', '/api/ai-debates', {
    ...multiInput,
    ranges: [longRange],
  })
  assert.equal(fullBudget.statusCode, 200, fullBudget.body)
  const full = (
    await call(owner, 'GET', `/api/ai-debates/${fullBudget.json().id}`)
  ).json()
  assert.equal(full.excerpts[0].text.length, 6000)
  assert.equal(full.anchor.quote.length, 2000)
  for (const invalid of [
    [longRange, ranges[0]],
    [ranges[0], ranges[0]],
    [{ start: ranges[0].end, end: ranges[0].start }],
    [{ ...ranges[0], end: { paragraph: 4, offset: 0 } }],
    [{ ...ranges[0], start: { paragraph: 0, offset: 10 } }],
  ]) {
    const rejected = await call(owner, 'POST', '/api/ai-debates', {
      ...multiInput,
      ranges: invalid,
    })
    assert.equal(rejected.statusCode, 422, rejected.body)
  }
  assert.equal(
    (
      await call(owner, 'POST', '/api/ai-debates', {
        ...multiInput,
        target: { documentId: id, version: 2 },
        ranges,
      })
    ).statusCode,
    422
  )
  assert.equal(
    (
      await call(outsider, 'POST', '/api/ai-debates', {
        ...multiInput,
        ranges,
      })
    ).statusCode,
    404
  )

  assert.equal(
    (await call(owner, 'POST', review, { action: 'revoke', people: [] }))
      .statusCode,
    400
  )
  assert.equal(
    (
      await call(owner, 'POST', review, {
        action: 'revoke',
        people: [reviewer.id, pendingReviewer.id],
      })
    ).statusCode,
    200
  )
  assert.equal((await call(pendingReviewer, 'GET', review)).statusCode, 404)
  for (const person of [owner, outsider]) {
    const { participants, messages } = (
      await call(person, 'GET', review)
    ).json()
    assert.deepEqual(
      participants.map((member: { id: string }) => member.id).sort(),
      [owner.id, outsider.id].sort()
    )
    assert.ok(
      messages.some(
        (entry: { body: string }) => entry.body === 'Evidence needs a source.'
      )
    )
  }
  assert.equal((await call(reviewer, 'GET', `${review}/file`)).statusCode, 404)
  assert.equal(
    (
      await call(reviewer, 'POST', review, {
        action: 'post',
        body: 'Rejected after revoke',
      })
    ).statusCode,
    404
  )
  assert.equal(
    (await call(owner, 'PUT', `${base}/trash`, { trash: true })).statusCode,
    200
  )
  assert.equal((await call(outsider, 'GET', review)).statusCode, 404)
  await search('中文短語', 1)
  assert.equal(
    (await call(owner, 'PUT', `${base}/trash`, { trash: false })).statusCode,
    200
  )
  assert.equal((await call(outsider, 'GET', review)).statusCode, 404)
  assert.equal(
    (await call(owner, 'PUT', `${base}/trash`, { trash: true })).statusCode,
    200
  )
  assert.equal((await call(owner, 'DELETE', base)).statusCode, 200)
  assert.equal((await call(owner, 'GET', original)).statusCode, 404)
})

function createPdf() {
  const body = 'BT /F1 18 Tf 40 720 Td (Evidence and proof) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
  ]
  let contents = '%PDF-1.4\n'
  const offsets = ['0000000000 65535 f \n']
  for (const [index, object] of objects.entries()) {
    offsets.push(`${String(contents.length).padStart(10, '0')} 00000 n \n`)
    contents += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const startXref = contents.length
  return Buffer.from(
    `${contents}xref\n0 ${offsets.length}\n${offsets.join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`
  )
}
