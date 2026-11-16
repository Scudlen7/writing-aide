import {
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
} from 'drizzle-orm/pg-core'
import {
  notificationKinds,
  roles,
  type AiResult,
  type AiTask,
  type AssignmentInput,
  type Decision,
  type GradeInput,
  type ReviewSource,
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
    result: jsonb('result').$type<AiResult>().notNull(),
    source: jsonb('source').$type<ReviewSource>(),
    decisions: jsonb('decisions')
      .$type<Record<string, Decision>>()
      .notNull()
      .default({}),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (table) => [index().on(table.submissionId)]
)

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => user.id),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignment.id),
    submissionId: uuid('submission_id').references(() => submission.id),
    kind: text('kind', { enum: notificationKinds }).notNull(),
    eventKey: text('event_key').notNull(),
    createdAt: date('created_at').notNull().defaultNow(),
    readAt: date('read_at'),
  },
  (table) => [
    unique().on(table.recipientId, table.eventKey),
    index().on(table.recipientId, table.createdAt),
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
