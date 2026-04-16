import {
  pgTable, text, boolean, integer, doublePrecision,
  timestamp, index, uniqueIndex
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ═══════════════════════════════════════════════
// Operation
// ═══════════════════════════════════════════════
export const operations = pgTable('Operation', {
  id:               text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  apiKeyId:         text('apiKeyId'),
  createdByUserId:  text('createdByUserId'),
  idempotencyKey:   text('idempotencyKey').unique(),
  done:             boolean('done').default(false).notNull(),
  state:            text('state').default('RUNNING').notNull(),
  progressPercent:  integer('progressPercent').default(0).notNull(),
  progressMessage:  text('progressMessage'),
  endpointSlug:     text('endpointSlug'),
  pipelineJson:     text('pipelineJson').notNull(),
  currentStep:      integer('currentStep').default(0).notNull(),
  failedAtStep:     integer('failedAtStep'),
  filesJson:        text('filesJson'),
  outputFormat:     text('outputFormat').default('json').notNull(),
  outputContent:    text('outputContent'),
  outputFilePath:   text('outputFilePath'),
  extractedData:    text('extractedData'),
  stepsResultJson:  text('stepsResultJson'),
  totalInputTokens:  integer('totalInputTokens').default(0).notNull(),
  totalOutputTokens: integer('totalOutputTokens').default(0).notNull(),
  pagesProcessed:   integer('pagesProcessed').default(0).notNull(),
  modelUsed:        text('modelUsed'),
  totalCostUsd:     doublePrecision('totalCostUsd').default(0.0).notNull(),
  usageBreakdown:   text('usageBreakdown'),
  webhookUrl:       text('webhookUrl'),
  webhookSentAt:    timestamp('webhookSentAt', { mode: 'date', precision: 3 }),
  errorCode:        text('errorCode'),
  errorMessage:     text('errorMessage'),
  filesDeleted:     boolean('filesDeleted').default(false).notNull(),
  createdAt:        timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt:        timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
  deletedAt:        timestamp('deletedAt', { mode: 'date', precision: 3 }),
}, (t) => [
  index('operation_state_idx').on(t.state),
  index('operation_apiKeyId_createdAt_idx').on(t.apiKeyId, t.createdAt),
  index('operation_createdAt_idx').on(t.createdAt),
  index('operation_endpointSlug_idx').on(t.endpointSlug),
]);

// ═══════════════════════════════════════════════
// ApiKey
// ═══════════════════════════════════════════════
export const apiKeys = pgTable('ApiKey', {
  id:            text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:          text('name').notNull(),
  keyHash:       text('keyHash').unique().notNull(),
  prefix:        text('prefix').notNull(),
  role:          text('role').default('STANDARD').notNull(),
  note:          text('note'),
  spendingLimit: doublePrecision('spendingLimit').default(0.0).notNull(),
  totalUsed:     doublePrecision('totalUsed').default(0.0).notNull(),
  status:        text('status').default('active').notNull(),
  createdAt:     timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt:     timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
}, (t) => [
  index('apikey_status_idx').on(t.status),
]);

// ═══════════════════════════════════════════════
// ExternalApiConnection
// ═══════════════════════════════════════════════
export const externalApiConnections = pgTable('ExternalApiConnection', {
  id:                    text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:                  text('name').notNull(),
  slug:                  text('slug').unique().notNull(),
  description:           text('description'),
  endpointUrl:           text('endpointUrl').notNull(),
  httpMethod:            text('httpMethod').default('POST').notNull(),
  authType:              text('authType').default('API_KEY_HEADER').notNull(),
  authKeyHeader:         text('authKeyHeader').default('x-api-key').notNull(),
  authSecret:            text('authSecret').notNull(),
  promptFieldName:       text('promptFieldName').default('query').notNull(),
  fileFieldName:         text('fileFieldName').default('files').notNull(),
  fileUrlFieldName:      text('fileUrlFieldName'),
  defaultPrompt:         text('defaultPrompt').notNull(),
  staticFormFields:      text('staticFormFields'),
  extraHeaders:          text('extraHeaders'),
  responseContentPath:   text('responseContentPath').default('content'),
  sessionIdResponsePath: text('sessionIdResponsePath'),
  sessionIdFieldName:    text('sessionIdFieldName'),
  timeoutSec:            integer('timeoutSec').default(60).notNull(),
  state:                 text('state').default('ENABLED').notNull(),
  createdAt:             timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt:             timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
}, (t) => [
  index('ext_conn_slug_idx').on(t.slug),
  index('ext_conn_state_idx').on(t.state),
]);

// ═══════════════════════════════════════════════
// ExternalApiOverride
// ═══════════════════════════════════════════════
export const externalApiOverrides = pgTable('ExternalApiOverride', {
  id:             text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  connectionId:   text('connectionId').notNull(),
  apiKeyId:       text('apiKeyId').notNull(),
  endpointSlug:   text('endpointSlug').notNull(),
  stepId:         text('stepId').default('_default').notNull(),
  promptOverride: text('promptOverride'),
  createdAt:      timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt:      timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('ext_override_unique_idx').on(t.connectionId, t.apiKeyId, t.endpointSlug, t.stepId),
  index('ext_override_apiKeyId_idx').on(t.apiKeyId),
  index('ext_override_connectionId_idx').on(t.connectionId),
  index('ext_override_endpointSlug_idx').on(t.endpointSlug),
]);

// ═══════════════════════════════════════════════
// ProfileEndpoint
// ═══════════════════════════════════════════════
export const profileEndpoints = pgTable('ProfileEndpoint', {
  id:                    text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  apiKeyId:              text('apiKeyId').notNull(),
  endpointSlug:          text('endpointSlug').notNull(),
  enabled:               boolean('enabled').default(true).notNull(),
  parameters:            text('parameters'),
  connectionsOverride:   text('connectionsOverride'),
  jobPriority:           text('jobPriority').default('MEDIUM').notNull(),
  fileUrlAuthConfig:     text('fileUrlAuthConfig'),
  allowedFileExtensions: text('allowedFileExtensions'),
  createdAt:             timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt:             timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('profile_endpoint_unique_idx').on(t.apiKeyId, t.endpointSlug),
  index('profile_endpoint_apiKeyId_idx').on(t.apiKeyId),
]);

// ═══════════════════════════════════════════════
// AppSetting
// ═══════════════════════════════════════════════
export const appSettings = pgTable('AppSetting', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  key:       text('key').unique().notNull(),
  value:     text('value').notNull(),
  updatedAt: timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
});

// ═══════════════════════════════════════════════
// FileCache
// ═══════════════════════════════════════════════
export const fileCaches = pgTable('FileCache', {
  id:             text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  md5Hash:        text('md5Hash').unique().notNull(),
  s3Key:          text('s3Key').notNull(),
  fileName:       text('fileName').notNull(),
  mimeType:       text('mimeType').notNull(),
  size:           integer('size').notNull(),
  refCount:       integer('refCount').default(1).notNull(),
  createdAt:      timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  lastAccessedAt: timestamp('lastAccessedAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, (t) => [
  index('file_cache_refCount_idx').on(t.refCount),
  index('file_cache_lastAccessedAt_idx').on(t.lastAccessedAt),
]);

// ═══════════════════════════════════════════════
// User
// ═══════════════════════════════════════════════
export const users = pgTable('User', {
  id:          text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  username:    text('username').unique().notNull(),
  password:    text('password').default('').notNull(),
  role:        text('role').default('USER').notNull(),
  provider:    text('provider'),
  providerSub: text('providerSub').unique(),
  email:       text('email'),
  displayName: text('displayName'),
  createdAt:   timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt:   timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
});

// ═══════════════════════════════════════════════
// UserProfileAssignment
// ═══════════════════════════════════════════════
export const userProfileAssignments = pgTable('UserProfileAssignment', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:    text('userId').notNull(),
  apiKeyId:  text('apiKeyId').notNull(),
  createdAt: timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, (t) => [
  uniqueIndex('user_profile_assignment_unique_idx').on(t.userId, t.apiKeyId),
  index('user_profile_assignment_userId_idx').on(t.userId),
  index('user_profile_assignment_apiKeyId_idx').on(t.apiKeyId),
]);

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ExternalApiConnection = typeof externalApiConnections.$inferSelect;
export type ExternalApiOverride = typeof externalApiOverrides.$inferSelect;
export type ProfileEndpoint = typeof profileEndpoints.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type FileCache = typeof fileCaches.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserProfileAssignment = typeof userProfileAssignments.$inferSelect;
