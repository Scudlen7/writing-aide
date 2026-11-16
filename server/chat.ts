import { z } from 'zod'
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  chatPageSize,
  maxMessageLength,
  type ChatContact,
} from '../shared/chat.ts'
import { db, type Transaction } from './db.ts'
import { ApiError, read } from './errors.ts'
import { identity } from './identity.ts'
import { chatMessage, classroom, enrollment, user } from './schema.ts'

type ChatMember = Pick<ChatContact, 'id' | 'role'>
const peerParams = z.object({ peerId: z.string().min(1).max(128) })
const messageNumber = z.number().int().min(1).max(2147483647)
const messageFields = {
  id: chatMessage.id,
  senderId: chatMessage.senderId,
  body: chatMessage.body,
  createdAt: chatMessage.createdAt,
}

async function chatIdentity(request: FastifyRequest): Promise<ChatMember> {
  const { id, role } = await identity(request)
  if (role === 'admin') throw new ApiError(403, 'forbidden')
  return { id, role }
}

function enrolled(studentId: string | typeof user.id) {
  return exists(
    db
      .select({ id: enrollment.studentId })
      .from(enrollment)
      .where(
        and(
          eq(enrollment.classroomId, classroom.id),
          eq(enrollment.studentId, studentId),
          eq(enrollment.removed, false)
        )
      )
  )
}

function participates(member: ChatMember) {
  return member.role === 'teacher'
    ? eq(classroom.teacherId, member.id)
    : enrolled(member.id)
}

function chatContacts(person: ChatMember, peerId?: string) {
  return db
    .select({
      id: user.id,
      name: user.name,
      role: sql<ChatContact['role']>`${user.role}`.as('role'),
      classrooms: sql<
        string[]
      >`array_agg(distinct ${classroom.name} order by ${classroom.name})`.as(
        'classrooms'
      ),
    })
    .from(user)
    .innerJoin(
      classroom,
      and(
        eq(classroom.archived, false),
        participates(person),
        or(
          and(eq(user.role, 'student'), enrolled(user.id)),
          and(eq(user.role, 'teacher'), eq(classroom.teacherId, user.id))
        )
      )
    )
    .where(
      and(
        ne(user.id, person.id),
        eq(user.disabled, false),
        peerId === undefined ? undefined : eq(user.id, peerId)
      )
    )
    .groupBy(user.id)
    .orderBy(asc(user.name), asc(user.id))
}

function unavailable() {
  return new ApiError(404, 'chatUnavailable')
}

async function withActivePeer<T>(
  person: ChatMember,
  peerId: string,
  write: (tx: Transaction) => Promise<T>
) {
  if (person.id === peerId) throw unavailable()
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ id: user.id, role: user.role, disabled: user.disabled })
      .from(user)
      .where(inArray(user.id, [person.id, peerId]))
      .orderBy(asc(user.id))
      .for('share')
    const sender = members.find((item) => item.id === person.id)
    const peer = members.find((item) => item.id === peerId)
    if (
      !sender ||
      sender.role !== person.role ||
      sender.disabled ||
      !peer ||
      peer.role === 'admin' ||
      peer.disabled
    )
      throw unavailable()
    const scope = and(
      eq(classroom.archived, false),
      participates(person),
      participates({ id: peer.id, role: peer.role })
    )
    const locked = await tx
      .select({ id: classroom.id })
      .from(classroom)
      .where(scope)
      .orderBy(asc(classroom.id))
      .for('share')
    if (!locked.length) throw unavailable()
    // Membership changes lock the class row. Recheck after any concurrent change finishes.
    const [active] = await tx
      .select({ id: classroom.id })
      .from(classroom)
      .where(
        and(
          scope,
          inArray(
            classroom.id,
            locked.map(({ id }) => id)
          )
        )
      )
      .limit(1)
    if (!active) throw unavailable()
    return write(tx)
  })
}

export async function chatRoutes(app: FastifyInstance) {
  app.get('/api/chats/contacts', async (request) =>
    chatContacts(await chatIdentity(request))
  )

  app.get('/api/chats/unread', async (request) => {
    const person = await chatIdentity(request)
    const contacts = chatContacts(person).as('chat_contacts')
    const [unread] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(chatMessage)
      .innerJoin(contacts, eq(contacts.id, chatMessage.senderId))
      .where(
        and(eq(chatMessage.recipientId, person.id), isNull(chatMessage.readAt))
      )
    return unread
  })

  app.get('/api/chats', async (request) => {
    const person = await chatIdentity(request)
    const contacts = chatContacts(person).as('chat_contacts')
    const mine = db.$with('my_chat_messages').as(
      db
        .select({
          ...messageFields,
          recipientId: chatMessage.recipientId,
          readAt: chatMessage.readAt,
          peerId: sql<string>`case when ${chatMessage.senderId} = ${person.id}
          then ${chatMessage.recipientId} else ${chatMessage.senderId} end`.as(
            'peer_id'
          ),
        })
        .from(chatMessage)
        .where(
          or(
            eq(chatMessage.senderId, person.id),
            eq(chatMessage.recipientId, person.id)
          )
        )
    )
    const latest = db.$with('latest_chat_messages').as(
      db
        .selectDistinctOn([mine.peerId], {
          id: mine.id,
          peerId: mine.peerId,
          senderId: mine.senderId,
          body: sql<string>`left(${mine.body}, 120)`.as('preview'),
          createdAt: mine.createdAt,
          unread:
            sql<number>`(count(*) filter (where ${mine.recipientId} = ${person.id}
          and ${mine.readAt} is null) over (partition by ${mine.peerId}))::int`.as(
              'unread'
            ),
        })
        .from(mine)
        .orderBy(mine.peerId, desc(mine.id))
    )
    return db
      .with(mine, latest)
      .select({
        contact: {
          id: contacts.id,
          name: contacts.name,
          role: contacts.role,
          classrooms: contacts.classrooms,
        },
        lastMessage: {
          id: latest.id,
          senderId: latest.senderId,
          body: latest.body,
          createdAt: latest.createdAt,
        },
        unread: latest.unread,
      })
      .from(latest)
      .innerJoin(contacts, eq(contacts.id, latest.peerId))
      .orderBy(desc(latest.id))
  })

  app.get('/api/chats/:peerId', async (request) => {
    const person = await chatIdentity(request)
    const { peerId } = read(peerParams, request.params)
    const { before } = read(
      z.object({ before: z.coerce.number().pipe(messageNumber).optional() }),
      request.query
    )
    const [contact] = await chatContacts(person, peerId)
    if (!contact) throw unavailable()
    const rows = await db
      .select({
        ...messageFields,
        unread: sql<boolean>`(${chatMessage.recipientId} = ${person.id} and ${chatMessage.readAt} is null)`,
      })
      .from(chatMessage)
      .where(
        and(
          or(
            and(
              eq(chatMessage.senderId, person.id),
              eq(chatMessage.recipientId, peerId)
            ),
            and(
              eq(chatMessage.senderId, peerId),
              eq(chatMessage.recipientId, person.id)
            )
          ),
          before === undefined ? undefined : lt(chatMessage.id, before)
        )
      )
      .orderBy(desc(chatMessage.id))
      .limit(chatPageSize + 1)
    const page = rows.slice(0, chatPageSize).reverse()
    return {
      contact,
      messages: page.map(({ unread: _unread, ...message }) => message),
      hasOlder: rows.length > chatPageSize,
      unreadIds: page.filter(({ unread }) => unread).map(({ id }) => id),
    }
  })

  app.post('/api/chats/:peerId/messages', async (request, reply) => {
    const person = await chatIdentity(request)
    const { peerId } = read(peerParams, request.params)
    const { clientId, body } = read(
      z.object({
        clientId: z.uuid(),
        body: z.string().trim().min(1).max(maxMessageLength),
      }),
      request.body
    )
    const message = await withActivePeer(person, peerId, async (tx) => {
      const [created] = await tx
        .insert(chatMessage)
        .values({ senderId: person.id, recipientId: peerId, clientId, body })
        .onConflictDoNothing({
          target: [chatMessage.senderId, chatMessage.clientId],
        })
        .returning(messageFields)
      if (created) return created
      const [existing] = await tx
        .select(messageFields)
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.senderId, person.id),
            eq(chatMessage.recipientId, peerId),
            eq(chatMessage.clientId, clientId),
            eq(chatMessage.body, body)
          )
        )
      if (!existing) throw new ApiError(409, 'invalidInput')
      return existing
    }).catch((error: unknown) => {
      if (error instanceof ApiError) throw error
      // Database errors can include the plaintext message in their parameters.
      request.log.error('Could not store a chat message')
      throw new ApiError(500, 'serverError')
    })
    return reply.code(201).send(message)
  })

  app.put('/api/chats/:peerId/read', async (request) => {
    const person = await chatIdentity(request)
    const { peerId } = read(peerParams, request.params)
    const { ids } = read(
      z.object({ ids: z.array(messageNumber).min(1).max(chatPageSize) }),
      request.body
    )
    await withActivePeer(person, peerId, async (tx) => {
      await tx
        .update(chatMessage)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(chatMessage.senderId, peerId),
            eq(chatMessage.recipientId, person.id),
            inArray(chatMessage.id, ids),
            isNull(chatMessage.readAt)
          )
        )
    })
    return { ok: true }
  })
}
