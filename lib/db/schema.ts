import {
  pgTable, text, boolean, integer, doublePrecision, numeric,
  timestamp, index, uniqueIndex, check
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
  progressLogJson:  text('progressLogJson'),
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
  // PostgreSQL numeric keeps aggregation exact; number mode preserves compatibility for
  // existing request-level writers/readers until Business Operation responses serialize decimals.
  totalCostUsd:     numeric('totalCostUsd', { precision: 30, scale: 10, mode: 'number' }).default(0).notNull(),
  usageBreakdown:   text('usageBreakdown'),
  webhookUrl:       text('webhookUrl'),
  webhookSentAt:    timestamp('webhookSentAt', { mode: 'date', precision: 3 }),
  webhookAttempts:  integer('webhookAttempts'),
  webhookLastError: text('webhookLastError'),
  // Tracing & reference (v4.13 — Operation Search feature)
  correlationId:    text('correlationId'),
  clientReference:  text('clientReference'),
  // Stable database-owned grouping key. Referenced requests are partitioned by profile
  // (or the dedicated internal scope); blank references remain one-request groups.
  businessGroupKey: text('businessGroupKey').notNull().generatedAlwaysAs(sql`
    CASE
      WHEN NULLIF(BTRIM("clientReference"), '') IS NULL THEN 'request:' || "id"
      ELSE 'profile:' || COALESCE("apiKeyId", '__internal__') || ':reference:' || BTRIM("clientReference")
    END
  `),
  hiddenFromOperations: boolean('hiddenFromOperations').default(false).notNull(),
  logicResult:      text('logicResult'),
  extractionResult: text('extractionResult'),
  inputTokensMissing: boolean('inputTokensMissing').default(false).notNull(),
  outputTokensMissing: boolean('outputTokensMissing').default(false).notNull(),
  costMissing:      boolean('costMissing').default(false).notNull(),
  hasUnpricedCost:  boolean('hasUnpricedCost').default(false).notNull(),
  errorCode:        text('errorCode'),
  errorMessage:     text('errorMessage'),
  filesDeleted:     boolean('filesDeleted').default(false).notNull(),
  createdAt:        timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  // DB clock for both INSERT and UPDATE so durations never go negative from
  // cross-process clock skew (createdAt/completedAt use the same source).
  // Do NOT add .default() here: with a column default Drizzle emits `default`
  // for omitted values on INSERT and stops sending anything itself, which makes
  // every Operation insert depend on the DEFAULT actually existing in the DB.
  // Without .default(), Drizzle applies this $onUpdate expression on INSERT too,
  // so inserts carry CURRENT_TIMESTAMP(3) explicitly and need no schema change.
  updatedAt:        timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => sql`CURRENT_TIMESTAMP(3)`),
  // Timestamp the operation reached a terminal state (SUCCEEDED/FAILED/CANCELLED).
  // Unlike `updatedAt` (bumped by any later write — webhook delivery, cleanup/filesDeleted),
  // this is the true "finished at" moment. Used to compute processing duration accurately.
  // Nullable: NULL while running/pending/waiting; legacy rows fall back to updatedAt in the UI.
  completedAt:      timestamp('completedAt', { mode: 'date', precision: 3 }),
  deletedAt:        timestamp('deletedAt', { mode: 'date', precision: 3 }),
  // Set once when request/result content (parameters, prompts, extracted data, output,
  // per-step artifacts, file URLs) has been scrubbed by lib/operations/content-retention.ts.
  // The row itself — state, timestamps, tokens, cost, errors — is kept forever.
  // NULL = content still present (running, waiting, or not yet past retention).
  contentPurgedAt:  timestamp('contentPurgedAt', { mode: 'date', precision: 3 }),
}, (t) => [
  index('operation_state_idx').on(t.state),
  // Retention scans look for terminal rows whose content is still present.
  index('operation_content_pending_purge_idx')
    .on(t.createdAt)
    .where(sql`${t.contentPurgedAt} IS NULL`),
  index('operation_apiKeyId_createdAt_idx').on(t.apiKeyId, t.createdAt),
  index('operation_createdAt_idx').on(t.createdAt),
  index('operation_endpointSlug_idx').on(t.endpointSlug),
  index('operation_correlationId_idx').on(t.correlationId),
  index('operation_clientReference_idx').on(t.clientReference),
  index('operation_business_group_created_id_idx')
    .on(t.businessGroupKey, t.createdAt, t.id)
    .where(sql`${t.deletedAt} IS NULL AND ${t.hiddenFromOperations} = false`),
  index('operation_profile_created_idx')
    .on(t.apiKeyId, t.createdAt)
    .where(sql`${t.deletedAt} IS NULL AND ${t.hiddenFromOperations} = false`),
  index('operation_endpoint_business_group_idx')
    .on(t.endpointSlug, t.businessGroupKey)
    .where(sql`${t.deletedAt} IS NULL AND ${t.hiddenFromOperations} = false`),
  index('operation_updated_business_group_idx')
    .on(t.updatedAt.desc(), t.businessGroupKey)
    .where(sql`${t.deletedAt} IS NULL AND ${t.hiddenFromOperations} = false`),
  index('operation_profile_normalized_reference_idx')
    .on(t.apiKeyId, sql`NULLIF(BTRIM(${t.clientReference}), '')`)
    .where(sql`${t.deletedAt} IS NULL AND ${t.hiddenFromOperations} = false AND NULLIF(BTRIM(${t.clientReference}), '') IS NOT NULL`),
  check('operation_logic_result_check', sql`${t.logicResult} IS NULL OR ${t.logicResult} IN ('PASS', 'FAIL')`),
  check('operation_extraction_result_check', sql`${t.extractionResult} IS NULL OR ${t.extractionResult} IN ('SUCCESS', 'FAIL')`),
]);

// ═══════════════════════════════════════════════
// BusinessOperationStatusSnapshot
// Preserves only the last valid aggregate status for groups whose current source
// rows contain an unknown state. Request metrics remain sourced from Operation.
// ═══════════════════════════════════════════════
export const businessOperationStatusSnapshots = pgTable('BusinessOperationStatusSnapshot', {
  businessGroupKey: text('businessGroupKey').primaryKey(),
  lastValidStatus:  text('lastValidStatus').notNull(),
  updatedAt:        timestamp('updatedAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, (t) => [
  check('business_operation_status_snapshot_status_check', sql`${t.lastValidStatus} IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')`),
]);

// ═══════════════════════════════════════════════
// WorkerGroup
// ═══════════════════════════════════════════════
export const workerGroups = pgTable('WorkerGroup', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:      text('name').unique().notNull(),
  createdAt: timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
});

// ═══════════════════════════════════════════════
// ApiKey
// ═══════════════════════════════════════════════
export const apiKeys = pgTable('ApiKey', {
  id:            text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:          text('name').notNull(),
  // Optional operator-facing label. Technical identity remains `name`.
  // NULL means consumers fall back to `name`; never backfill a duplicate value.
  displayName:   text('displayName'),
  keyHash:       text('keyHash').unique().notNull(),
  prefix:        text('prefix').notNull(),
  role:          text('role').default('STANDARD').notNull(),
  note:          text('note'),
  workerGroup:   text('workerGroup'),
  // Per-profile rate limit (requests/minute). 0 = use global default (RATE_LIMIT_API_KEY).
  rateLimitPerMin: integer('rateLimitPerMin').default(0).notNull(),
  spendingLimit: doublePrecision('spendingLimit').default(0.0).notNull(),
  totalUsed:     doublePrecision('totalUsed').default(0.0).notNull(),
  status:        text('status').default('active').notNull(),
  // Profile integration config. Auth config values are encrypted by their API routes.
  fileAuthConfig:     text('fileAuthConfig'),
  callbackUrl:        text('callbackUrl'),
  callbackAuthConfig: text('callbackAuthConfig'),
  callbackPayload:    text('callbackPayload'),
  callbackUrlLocked:  boolean('callbackUrlLocked').default(false).notNull(),
  createdAt:     timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt:     timestamp('updatedAt', { mode: 'date', precision: 3 }).notNull().$onUpdate(() => new Date()),
}, (t) => [
  index('apikey_status_idx').on(t.status),
  index('apikey_workerGroup_idx').on(t.workerGroup),
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
  // Vault migration (IT SEC): logical, env-agnostic secret ref (e.g. "aihub/team-a" or
  // "agent-toolkit/<slug>#api_key"). When set, the live key is resolved from Vault at
  // runtime and `authSecret` is ignored (dual-read fallback keeps legacy rows working).
  vaultSecretPath:       text('vaultSecretPath'),
  promptFieldName:       text('promptFieldName').default('query').notNull(),
  fileFieldName:         text('fileFieldName').default('files').notNull(),
  fileUrlFieldName:      text('fileUrlFieldName'),
  defaultPrompt:         text('defaultPrompt').notNull(),
  staticFormFields:      text('staticFormFields'),
  extraHeaders:          text('extraHeaders'),
  responseContentPath:   text('responseContentPath').default('content'),
  sessionIdResponsePath: text('sessionIdResponsePath'),
  sessionIdFieldName:    text('sessionIdFieldName'),
  timeoutSec:            integer('timeoutSec').default(300).notNull(),
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
  modelOverride:  text('modelOverride'),
  // OpenAI-compatible reasoning_effort override (minimal|low|medium|high).
  // null = use the connector's default (the "reasoning_effort" field in staticFormFields, if any).
  reasoningEffortOverride: text('reasoningEffortOverride'),
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
  fileUrlEnabled:        boolean('fileUrlEnabled').default(true).notNull(),
  callbackEnabled:       boolean('callbackEnabled').default(true).notNull(),
  fileUrlDefaultChunks:  integer('fileUrlDefaultChunks'),
  callbackUrlOverride:   text('callbackUrlOverride'),
  callbackPayloadOverride: text('callbackPayloadOverride'),
  allowedFileExtensions: text('allowedFileExtensions'),
  // Admin-configurable: field name in request body to extract as client reference for ops search
  referenceExtract:  text('referenceExtract'),
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
  role:        text('role').default('OPS').notNull(),
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

// ═══════════════════════════════════════════════
// RolePermission — configurable capability grants for application roles
// ADMIN is an invariant full-access role and has no stored rows. OPS receives
// only the persisted configurable grants plus code-defined baseline capabilities.
// ═══════════════════════════════════════════════
export const rolePermissions = pgTable('RolePermission', {
  id:              text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  role:            text('role').notNull(),
  permission:      text('permission').notNull(),
  granted:         boolean('granted').default(true).notNull(),
  updatedByUserId: text('updatedByUserId'),
  updatedAt:       timestamp('updatedAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, (t) => [
  uniqueIndex('role_permission_unique_idx').on(t.role, t.permission),
  index('role_permission_role_idx').on(t.role),
]);

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;
export type BusinessOperationStatusSnapshot = typeof businessOperationStatusSnapshots.$inferSelect;
export type NewBusinessOperationStatusSnapshot = typeof businessOperationStatusSnapshots.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type WorkerGroup = typeof workerGroups.$inferSelect;
export type NewWorkerGroup = typeof workerGroups.$inferInsert;
export type ExternalApiConnection = typeof externalApiConnections.$inferSelect;
export type ExternalApiOverride = typeof externalApiOverrides.$inferSelect;
export type ProfileEndpoint = typeof profileEndpoints.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type FileCache = typeof fileCaches.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserProfileAssignment = typeof userProfileAssignments.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;


// ═══════════════════════════════════════════════
// Profile Release — immutable configuration snapshots and append-only audit
// ═══════════════════════════════════════════════
export const profileReleases = pgTable('ProfileRelease', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  profileName: text('profileName').notNull(),
  apiKeyId: text('apiKeyId'),
  revision: integer('revision').notNull(),
  contentHash: text('contentHash').notNull(),
  bundle: text('bundle').notNull(),
  action: text('action').notNull(),
  sourceEnv: text('sourceEnv'),
  sourceHash: text('sourceHash'),
  appVersion: text('appVersion'),
  version: text('version'),
  message: text('message'),
  createdByUserId: text('createdByUserId'),
  createdAt: timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, (table) => [
  uniqueIndex('profile_release_unique_idx').on(table.profileName, table.revision),
  index('profile_release_name_idx').on(table.profileName),
  index('profile_release_hash_idx').on(table.contentHash),
]);

// ═══════════════════════════════════════════════
// ConfigAudit — general-purpose append-only audit trail for all config changes
// Covers: Profile release actions, Profile/connector/endpoint edits, user/assignment changes
// ═══════════════════════════════════════════════
export const configAudits = pgTable('ConfigAudit', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

  // What was changed
  entityType: text('entityType').notNull(),         // PROFILE | CONNECTOR | ENDPOINT | OVERRIDE | USER | ASSIGNMENT | RELEASE | SETTING
  entityId: text('entityId'),                       // UUID of the affected row (nullable for bulk/release actions)
  entityName: text('entityName'),                   // human-readable: profile name, connector slug, endpoint slug...
  scopeEntityId: text('scopeEntityId'),             // parent Profile ID for endpoint/override timeline grouping

  // What happened
  action: text('action').notNull(),                 // CREATE | UPDATE | DELETE | EXPORT | PLAN | APPLY | ROLLBACK | SNAPSHOT | ENABLE | DISABLE
  outcome: text('outcome').notNull(),               // SUCCESS | FAIL | BLOCKED

  // Change detail
  changes: text('changes'),                         // JSON: { field: { from, to } } — NEVER contains secret values
  detail: text('detail'),                           // free-text or JSON for release-specific context (BREAKING list, precondition failures, etc.)

  // Release-specific (nullable, only filled for RELEASE entityType)
  fromHash: text('fromHash'),
  toHash: text('toHash'),
  planHash: text('planHash'),

  // Metadata
  ticketId: text('ticketId'),                       // change management ticket reference
  actorUserId: text('actorUserId'),
  actorRole: text('actorRole'),
  sourceIp: text('sourceIp'),                       // request IP for traceability (optional)
  createdAt: timestamp('createdAt', { mode: 'date', precision: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, (table) => [
  index('config_audit_entity_idx').on(table.entityType, table.entityName),
  index('config_audit_entity_id_createdAt_idx').on(table.entityType, table.entityId, table.createdAt),
  index('config_audit_scope_entity_createdAt_idx').on(table.scopeEntityId, table.createdAt),
  index('config_audit_createdAt_idx').on(table.createdAt),
  index('config_audit_actor_idx').on(table.actorUserId),
]);