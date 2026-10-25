import { bigserial, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

// Khớp migrations/0001_init.sql (migration SQL là nguồn sự thật cho DDL, gồm trigger append-only)
export const apps = pgSchema('apps');

export const appRun = apps.table('app_run', {
  runId: text('run_id').primaryKey(),
  app: text('app').notNull(),
  appVersion: text('app_version').notNull(),
  caller: text('caller').notNull(),
  requestId: text('request_id').notNull(),
  businessRef: jsonb('business_ref').notNull(),
  makerUserId: text('maker_user_id').notNull(),
  reviewMode: text('review_mode').notNull(),
  callback: jsonb('callback'),
  status: text('status').notNull(),
  outcome: text('outcome'),
  progressPercent: integer('progress_percent').notNull().default(0),
  progressMessage: text('progress_message').notNull().default(''),
  findings: jsonb('findings').notNull().default([]),
  result: jsonb('result'),
  openTasks: integer('open_tasks').notNull().default(0),
  error: jsonb('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

export const reviewTask = apps.table('review_task', {
  taskId: text('task_id').primaryKey(),
  runId: text('run_id').notNull(),
  kind: text('kind').notNull(),
  ref: text('ref').notNull(),
  severity: text('severity'),
  title: text('title').notNull(),
  status: text('status').notNull().default('OPEN'),
  decidedBy: text('decided_by'),
  decision: jsonb('decision'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  doneAt: timestamp('done_at', { withTimezone: true }),
});

export const appAuditEvent = apps.table('app_audit_event', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  runId: text('run_id'),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  object: text('object').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  correlationId: text('correlation_id'),
  at: timestamp('at', { withTimezone: true }).notNull(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
});
