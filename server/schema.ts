import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  boolean,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import type { DebateExcerpt } from '../shared/debate.ts'
import type {
  DiscussionAnchor,
  DiscussionDecision,
  discussionRoles,
} from '../shared/discussions.ts'
import {
  peerStates,
  type PeerFeedback,
  type PeerReport,
} from '../shared/peer.ts'
import {
  notificationKinds,
  roles,
  type AiResult,
  type AiTask,
  type AssignmentInput,
  type AssessmentCalibration,
  type Decision,
  type GradeDraft,
  type GradeInput,
  type ReviewSource,
  type ReturnedPaper,
  type Stage,
  type Work,
} from '../shared/writing.ts'

const date = (name: string) => timestamp(name, { withTimezone: true })

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role', { enum: roles }).notNull().default('student'),
  disabled: boolean('disabled').notNull().default(false),
  submissionNotifications: boolean('submission_notifications')
    .notNull()
    .default(false),
  createdAt: date('created_at').notNull().defaultNow(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: date('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: date('created_at').notNull().defaultNow(),
    updatedAt: date('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index().on(table.userId)]
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: date('access_token_expires_at'),
    refreshTokenExpiresAt: date('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: date('created_at').notNull().defaultNow(),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  (table) => [index().on(table.userId)]
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: date('expires_at').notNull(),
    createdAt: date('created_at').notNull().defaultNow(),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  (table) => [index().on(table.identifier)]
)

export const classroom = pgTable(
  'classroom',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => user.id),
    joinCode: text('join_code').notNull().unique(),
    archived: boolean('archived').notNull().default(false),
  },
  (table) => [index().on(table.teacherId)]
)

export const enrollment = pgTable(
  'enrollment',
  {
    classroomId: uuid('classroom_id')
      .notNull()
      .references(() => classroom.id),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id),
    removed: boolean('removed').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.classroomId, table.studentId] }),
    index().on(table.studentId),
  ]
)

export const assignment = pgTable(
  'assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classroomId: uuid('classroom_id')
      .notNull()
      .references(() => classroom.id),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    language: text('language', { enum: ['zh-CN', 'en'] }).notNull(),
    dueAt: date('due_at').notNull(),
    minLength: integer('min_length').notNull(),
    maxLength: integer('max_length').notNull(),
    checklist: jsonb('checklist')
      .$type<AssignmentInput['checklist']>()
      .notNull(),
    rubric: jsonb('rubric').$type<AssignmentInput['rubric']>().notNull(),
    aiPolicy: jsonb('ai_policy').$type<AiTask[]>(),
    aiDebate: boolean('ai_debate').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    updatedAt: date('updated_at'),
  },
  (table) => [index().on(table.classroomId)]
)

export const submission = pgTable(
  'submission',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignment.id),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id),
    stage: text('stage').$type<Stage>().notNull().default('goals'),
    openedStage: text('opened_stage').$type<Stage>().notNull().default('goals'),
    status: text('status', { enum: ['draft', 'submitted', 'graded'] })
      .notNull()
      .default('draft'),
    version: integer('version').notNull().default(0),
    work: jsonb('work').$type<Work>().notNull(),
    grade: jsonb('grade').$type<GradeInput>(),
    gradeDraft: jsonb('grade_draft').$type<GradeDraft>(),
    returned: jsonb('returned').$type<ReturnedPaper>(),
    priorGradeDraft: jsonb('prior_grade_draft').$type<GradeDraft>(),
    submittedAt: date('submitted_at'),
    requirements: jsonb('requirements').$type<AssignmentInput>(),
  },
  (table) => [unique().on(table.assignmentId, table.studentId)]
)

export const aiReview = pgTable(
  'ai_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submission.id),
    task: text('task').$type<AiTask>().notNull(),
    attempt: integer('attempt').notNull().default(1),
    result: jsonb('result').$type<AiResult>().notNull(),
    source: jsonb('source').$type<ReviewSource>(),
    calibration: jsonb('calibration').$type<AssessmentCalibration>(),
    decisions: jsonb('decisions')
      .$type<Record<string, Decision>>()
      .notNull()
      .default({}),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (table) => [index().on(table.submissionId)]
)

export const peerReview = pgTable(
  'peer_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submission.id),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => user.id),
    submissionVersion: integer('submission_version').notNull(),
    status: text('status', { enum: peerStates }).notNull().default('assigned'),
    feedback: jsonb('feedback').$type<PeerFeedback>(),
    report: jsonb('report').$type<PeerReport>(),
    createdAt: date('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.submissionId, table.reviewerId, table.submissionVersion),
  ]
)

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => user.id),
    assignmentId: uuid('assignment_id').references(() => assignment.id),
    submissionId: uuid('submission_id').references(() => submission.id),
    reviewThreadId: uuid('review_thread_id').references(
      (): AnyPgColumn => reviewThread.id,
      { onDelete: 'cascade' }
    ),
    kind: text('kind', { enum: notificationKinds }).notNull(),
    eventKey: text('event_key').notNull(),
    createdAt: date('created_at').notNull().defaultNow(),
    readAt: date('read_at'),
  },
  (table) => [
    unique().on(table.recipientId, table.eventKey),
    index().on(table.recipientId, table.createdAt),
    check(
      'notification_one_target',
      sql`num_nonnulls(${table.assignmentId}, ${table.reviewThreadId}) = 1`
    ),
  ]
)

export const managementAudit = pgTable('management_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: text('actor_id')
    .notNull()
    .references(() => user.id),
  targetId: text('target_id').notNull(),
  action: text('action').notNull(),
  createdAt: date('created_at').notNull().defaultNow(),
})

export const aiRequestEvent = pgTable(
  'ai_request_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    task: text('task').$type<AiTask | 'debate'>().notNull(),
    model: text('model').notNull(),
    outcome: text('outcome').notNull(),
    durationMs: integer('duration_ms').notNull(),
    createdAt: date('created_at').defaultNow().notNull(),
  },
  (table) => [index().on(table.createdAt)]
)

export const chatMessage = pgTable(
  'chat_message',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    senderId: text('sender_id')
      .notNull()
      .references(() => user.id),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => user.id),
    clientId: uuid('client_id').notNull(),
    body: text('body').notNull(),
    createdAt: date('created_at').notNull().defaultNow(),
    readAt: date('read_at'),
  },
  (table) => [
    unique().on(table.senderId, table.clientId),
    check(
      'chat_message_distinct_participants',
      sql`${table.senderId} <> ${table.recipientId}`
    ),
    index().on(table.senderId, table.recipientId, table.id),
    index().on(table.recipientId, table.senderId, table.id),
  ]
)

export const personalDocument = pgTable(
  'personal_document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    title: text('title').notNull(),
    source: text('source', {
      enum: ['upload', 'word', 'writing', 'course'],
    }).notNull(),
    tags: text('tags').array().notNull().default([]),
    currentVersion: integer('current_version').notNull().default(1),
    updatedAt: date('updated_at').notNull().defaultNow(),
    trashedAt: date('trashed_at'),
  },
  (table) => [index().on(table.ownerId, table.updatedAt)]
)

export const personalDocumentFile = pgTable(
  'personal_document_file',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => personalDocument.id, { onDelete: 'cascade' }),
    bytes: integer('bytes').notNull(),
    digest: text('digest').notNull(),
    format: text('format', {
      enum: ['docx', 'doc', 'pdf', 'md', 'writing'],
    }).notNull(),
    indexStatus: text('index_status', {
      enum: ['pending', 'ready', 'empty', 'failed'],
    })
      .notNull()
      .default('pending'),
    indexText: text('index_text'),
    searchText: text('search_text'),
    indexError: text('index_error'),
    indexLease: date('index_lease'),
  },
  (table) => [unique().on(table.documentId, table.digest, table.format)]
)

export const personalDocumentVersion = pgTable(
  'personal_document_version',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => personalDocument.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    sourceVersion: integer('source_version'),
    conflict: boolean('conflict').notNull().default(false),
    fileId: uuid('file_id')
      .notNull()
      .references(() => personalDocumentFile.id),
    filename: text('filename').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.number] })]
)

export const personalFileCleanup = pgTable('personal_file_cleanup', {
  id: uuid('id').primaryKey(),
  after: date('after').notNull().defaultNow(),
})

export const officeSession = pgTable('office_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => personalDocument.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id),
  version: integer('version').notNull(),
  savedVersion: integer('saved_version'),
  mode: text('mode', { enum: ['view', 'edit', 'convert'] }).notNull(),
  state: text('state', {
    enum: ['open', 'saved', 'closed', 'failed', 'conflict'],
  })
    .notNull()
    .default('open'),
  pendingSave: uuid('pending_save'),
  pendingAt: date('pending_at'),
  expiresAt: date('expires_at').notNull(),
  finishedAt: date('finished_at'),
})

export const reviewThread = pgTable(
  'review_thread',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id').references(() => personalDocument.id, {
      onDelete: 'cascade',
    }),
    submissionId: uuid('submission_id').references(() => submission.id),
    peerId: uuid('peer_id')
      .unique()
      .references(() => peerReview.id),
    version: integer('version').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    hostId: text('host_id')
      .notNull()
      .references(() => user.id),
    mode: text('mode', { enum: ['review', 'debate'] }).notNull(),
    topic: text('topic').notNull(),
    title: text('title').notNull(),
    courseParagraphs: jsonb('course_paragraphs').$type<string[]>(),
    criteria: jsonb('criteria').$type<string[]>().notNull().default([]),
    endedAt: date('ended_at'),
    resolution: text('resolution'),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'review_thread_one_target',
      sql`num_nonnulls(${table.documentId}, ${table.submissionId}) = 1`
    ),
    index().on(table.documentId),
    index().on(table.submissionId),
  ]
)

export const reviewParticipant = pgTable(
  'review_participant',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => reviewThread.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => user.id),
    state: text('state', {
      enum: ['pending', 'accepted', 'rejected', 'revoked'],
    })
      .notNull()
      .default('pending'),
    expiresAt: date('expires_at'),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.personId] }),
    index().on(table.personId),
  ]
)

export const reviewMessage = pgTable(
  'review_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => reviewThread.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    body: text('body').notNull(),
    role: text('role', {
      enum: ['support', 'challenge', 'clarify', 'summarize'],
    }).$type<(typeof discussionRoles)[number]>(),
    replyTo: uuid('reply_to').references((): AnyPgColumn => reviewMessage.id),
    anchor: jsonb('anchor').$type<DiscussionAnchor>(),
    decision: jsonb('decision').$type<DiscussionDecision>(),
    criterion: integer('criterion'),
    ai: boolean('ai').notNull().default(false),
    report: jsonb('report').$type<PeerReport>(),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (table) => [index().on(table.threadId, table.createdAt)]
)

export const personalAiReview = pgTable(
  'personal_ai_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => personalDocument.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    task: text('task', { enum: ['outline', 'revision'] }).notNull(),
    source: text('source').notNull(),
    digest: text('digest').notNull(),
    result: jsonb('result').$type<AiResult>().notNull(),
    decisions: jsonb('decisions')
      .$type<Record<string, Decision>>()
      .notNull()
      .default({}),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.documentId, table.version, table.task, table.digest),
  ]
)

export const aiDebate = pgTable(
  'ai_debate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    documentId: uuid('document_id').references(() => personalDocument.id, {
      onDelete: 'cascade',
    }),
    submissionId: uuid('submission_id').references(() => submission.id),
    version: integer('version').notNull(),
    language: text('language', { enum: ['zh-CN', 'en'] }).notNull(),
    topic: text('topic').notNull(),
    anchor: jsonb('anchor')
      .$type<DiscussionAnchor & { excerpts?: DebateExcerpt[] }>()
      .notNull(),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'ai_debate_one_target',
      sql`num_nonnulls(${table.documentId}, ${table.submissionId}) = 1`
    ),
    index().on(table.ownerId, table.createdAt),
  ]
)

export const aiDebateStep = pgTable(
  'ai_debate_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    debateId: uuid('debate_id')
      .notNull()
      .references(() => aiDebate.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    role: integer('role').notNull(),
    question: text('question').notNull(),
    body: text('body'),
    state: text('state', { enum: ['running', 'ready', 'failed'] }).notNull(),
    startedAt: date('started_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(1),
  },
  (table) => [unique().on(table.debateId, table.round, table.role)]
)
