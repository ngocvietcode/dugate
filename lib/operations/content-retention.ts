// lib/operations/content-retention.ts
//
// Customer content carried by a request must not be stored long-term, while the
// Operation row itself (state, timestamps, tokens, cost, usage, errors, webhook
// diagnostics) is kept forever for monitoring, statistics and billing.
// See handover-report/DUImprovement/OperationsDataExposure/05-WORKPLAN.md (giai đoạn 2).
//
// Two independent mechanisms, both of which only SCRUB columns — no row is deleted:
//
//  1. Workflow sub-step purge. Every AI sub-step of a workflow is a hidden child
//     Operation whose pipelineJson carries the exact prompt (document text,
//     master data) and whose result columns carry the model output. Once the
//     parent workflow is SUCCEEDED/FAILED that content is never read again, so it
//     is scrubbed immediately (purgeWorkflowSubSteps) and by an hourly sweeper
//     (sweepWorkflowSubSteps) that catches children finishing after their parent.
//
//  2. Content TTL. Terminal rows older than OPERATION_CONTENT_RETENTION_DAYS
//     (default 7, 0 = off) have parameters, results, step artifacts and file URLs
//     scrubbed (purgeExpiredOperationContent). Rows created before this feature
//     was first armed are only scrubbed once the request-tracking backfill has
//     completed, because that backfill derives metadata from the same columns.
//
// Scrubbed rows get `contentPurgedAt`; `updatedAt` is deliberately preserved.

import { createHash } from 'crypto';
import { and, asc, eq, inArray, isNull, lt, gte, ne, notLike, or, sql, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { appSettings, operations } from '@/lib/db/schema';
import { Logger } from '@/lib/logger';
import { TERMINAL_STATES } from '@/lib/operations/status';
import {
  CHECKPOINT_KEY as BACKFILL_CHECKPOINT_KEY,
  extractTrustedChildOperationIds,
} from '@/lib/operations/backfill';

// ─── Configuration ────────────────────────────────────────────────────────────

export const DEFAULT_CONTENT_RETENTION_DAYS = 7;
export const DEFAULT_PURGE_MAX_PER_RUN = 5_000;
export const PURGE_BATCH_SIZE = 200;
/** A finished sub-step is only swept after this grace (its parent reads it right after it finishes). */
export const SUB_STEP_SWEEP_GRACE_MS = 60 * 60 * 1000;
/** Correlation-linked children must have finished this long ago (see purgeWorkflowSubSteps). */
export const CORRELATION_LINK_GRACE_MS = 5 * 60 * 1000;
/** Pause between batches so a large first run does not monopolise the database. */
export const PURGE_BATCH_PAUSE_MS = 250;

export const RETENTION_STATE_KEY = 'operation_content_retention_v1';

export interface ContentRetentionConfig {
  /** 0 disables the N-day TTL. The sub-step purge is always on. */
  retentionDays: number;
  maxPerRun: number;
  dryRun: boolean;
}

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!/^\d+$/.test(raw.trim())) return Number.NaN;
  return Number.parseInt(raw.trim(), 10);
}

export type RetentionEnv = Record<string, string | undefined>;

/**
 * `WORKFLOW_SUBSTEP_KEEP_CONTENT=true`: giữ prompt + kết quả của bước con workflow (không xoá ngay khi workflow kết thúc,
 * không để sweeper hằng giờ xoá). Nội dung vẫn bị xoá bởi TTL `OPERATION_CONTENT_RETENTION_DAYS` như mọi Operation.
 * Mặc định false (xoá ngay như trước).
 */
export function keepWorkflowSubStepContent(env: RetentionEnv = process.env): boolean {
  const raw = (env.WORKFLOW_SUBSTEP_KEEP_CONTENT ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function readContentRetentionConfig(
  env: RetentionEnv = process.env,
): ContentRetentionConfig & { warnings: string[] } {
  const warnings: string[] = [];

  let retentionDays = DEFAULT_CONTENT_RETENTION_DAYS;
  const days = parseNonNegativeInt(env.OPERATION_CONTENT_RETENTION_DAYS);
  if (days !== null) {
    if (Number.isNaN(days)) {
      warnings.push(`OPERATION_CONTENT_RETENTION_DAYS="${env.OPERATION_CONTENT_RETENTION_DAYS}" is not a non-negative integer; using ${DEFAULT_CONTENT_RETENTION_DAYS}`);
    } else {
      retentionDays = days;
    }
  }

  let maxPerRun = DEFAULT_PURGE_MAX_PER_RUN;
  const max = parseNonNegativeInt(env.OPERATION_CONTENT_PURGE_MAX_PER_RUN);
  if (max !== null) {
    if (Number.isNaN(max) || max === 0) {
      warnings.push(`OPERATION_CONTENT_PURGE_MAX_PER_RUN="${env.OPERATION_CONTENT_PURGE_MAX_PER_RUN}" is not a positive integer; using ${DEFAULT_PURGE_MAX_PER_RUN}`);
    } else {
      maxPerRun = max;
    }
  }

  const dryRunRaw = (env.OPERATION_CONTENT_PURGE_DRY_RUN ?? '').trim().toLowerCase();
  const dryRun = dryRunRaw === 'true' || dryRunRaw === '1' || dryRunRaw === 'yes';

  return { retentionDays, maxPerRun, dryRun, warnings };
}

// ─── Pure scrub helpers ───────────────────────────────────────────────────────

export const PURGED_VALUE = '[purged]';

/** Step-result keys that describe the run, never its content. */
const KEPT_STEP_KEYS = [
  'step',
  'stepName',
  'processor',
  'sub_operation_id',
  'output_format',
  'is_human_edited',
  'stage_key',
  'artifact_version',
  'status',
] as const;

/** Pipeline-step keys (outside `variables`) that are definition, not request data. */
const KEPT_PIPELINE_STEP_KEYS = [
  'processor', 'stepId', 'id', 'name', 'output_format', 'outputFormat', 'captureSession', 'injectSession',
] as const;

/**
 * File descriptor keys kept after purge. `url` (often a signed link) is dropped.
 * `path` / `s3Key` / `fileCacheId` MUST survive: lib/cleanup.ts uses them to
 * delete the stored object and release FileCache.refCount, possibly after a purge.
 */
const KEPT_FILE_KEYS = [
  'name', 'filename', 'mime', 'mime_type', 'size', 'file_id', 'path', 'isRemoteUrl',
  's3Key', 'fileCacheId', 'md5',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** Drops query string and fragment, which is where signed-URL credentials live. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Variables keep their NAMES (so Ops can see which parameters a request carried)
 * but lose their values. Kept as-is: `encryption_*` (outbound response encryption
 * config read at poll time) and the per-step `_model` / `_reasoning_effort`.
 * `_prompt` becomes a length + sha256 so a prompt can still be correlated with a
 * known template without being stored.
 */
export function scrubVariables(variables: unknown): Record<string, unknown> {
  if (!isRecord(variables)) return {};
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(variables)) {
    if (key.startsWith('encryption_') || key === '_model' || key === '_reasoning_effort') {
      out[key] = value;
      continue;
    }
    if (key === '_prompt') {
      out[key] = PURGED_VALUE;
      if (typeof value === 'string') {
        out._prompt_length = value.length;
        out._prompt_sha256 = sha256Hex(value);
      }
      continue;
    }
    if (key === '_prompt_length' || key === '_prompt_sha256') {
      out[key] = value; // already-scrubbed row being scrubbed again
      continue;
    }
    if (key === '_original_file_urls' && Array.isArray(value)) {
      out[key] = value.map((entry) => {
        if (!isRecord(entry)) return PURGED_VALUE;
        const kept: Record<string, unknown> = {};
        if (typeof entry.filename === 'string') kept.filename = entry.filename;
        if (typeof entry.mime_type === 'string') kept.mime_type = entry.mime_type;
        if (typeof entry.url === 'string') kept.url = stripUrlQuery(entry.url);
        return kept;
      });
      continue;
    }
    out[key] = value === null || value === undefined || value === '' ? value ?? null : PURGED_VALUE;
  }

  return out;
}

export function scrubPipelineJson(raw: string | null | undefined): string {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return '[]';

  return JSON.stringify(parsed.map((step) => {
    if (!isRecord(step)) return {};
    const out: Record<string, unknown> = {};
    for (const key of KEPT_PIPELINE_STEP_KEYS) {
      if (key in step && isPrimitive(step[key])) out[key] = step[key];
    }
    if ('variables' in step) out.variables = scrubVariables(step.variables);
    return out;
  }));
}

/**
 * Keeps the step skeleton (number, name, processor, sub-operation link, flags).
 * Child operation IDs nested inside the dropped artifacts are preserved under
 * `sub_results[].sub_operation_id`, the shape lib/operations/backfill.ts reads.
 */
export function scrubStepsResultJson(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return null;

  return JSON.stringify(parsed.map((step) => {
    if (!isRecord(step)) return { content_purged: true };
    const out: Record<string, unknown> = {};
    for (const key of KEPT_STEP_KEYS) {
      if (key in step && isPrimitive(step[key])) out[key] = step[key];
    }
    const topLevelChild = typeof step.sub_operation_id === 'string' ? step.sub_operation_id.trim() : '';
    const nestedChildren = extractTrustedChildOperationIds(JSON.stringify(step))
      .filter((id) => id !== topLevelChild);
    if (nestedChildren.length > 0) {
      out.sub_results = nestedChildren.map((id) => ({ sub_operation_id: id }));
    }
    out.content_purged = true;
    return out;
  }));
}

export function scrubFilesJson(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return null;

  return JSON.stringify(parsed.map((file) => {
    if (!isRecord(file)) return {};
    const out: Record<string, unknown> = {};
    for (const key of KEPT_FILE_KEYS) {
      if (!(key in file) || !isPrimitive(file[key])) continue;
      const value = file[key];
      // A remote "path" is a URL — keep only its query-less form.
      out[key] = typeof value === 'string' && /^https?:\/\//i.test(value) ? stripUrlQuery(value) : value;
    }
    return out;
  }));
}

export interface PurgeSourceRow {
  id: string;
  pipelineJson: string;
  stepsResultJson: string | null;
  filesJson: string | null;
}

export interface ContentPurgePatch {
  pipelineJson: string;
  stepsResultJson: string | null;
  filesJson: string | null;
  extractedData: null;
  outputContent: null;
  contentPurgedAt: Date;
}

export function buildContentPurgePatch(row: PurgeSourceRow, now: Date): ContentPurgePatch {
  return {
    pipelineJson: scrubPipelineJson(row.pipelineJson),
    stepsResultJson: scrubStepsResultJson(row.stepsResultJson),
    filesJson: scrubFilesJson(row.filesJson),
    extractedData: null,
    outputContent: null,
    contentPurgedAt: now,
  };
}

// ─── Database application ─────────────────────────────────────────────────────

const defaultLogger = new Logger({ service: 'content-retention' });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const terminalCondition = (): SQL => and(
  eq(operations.done, true),
  inArray(operations.state, [...TERMINAL_STATES]),
) as SQL;

/**
 * Finished before `cutoff` (completedAt; updatedAt for legacy rows without it).
 * Built from column comparisons so the Date goes through the column's own
 * driver mapping, exactly like the other timestamp filters in this codebase.
 */
const finishedBefore = (cutoff: Date): SQL => or(
  lt(operations.completedAt, cutoff),
  and(isNull(operations.completedAt), lt(operations.updatedAt, cutoff)),
) as SQL;

/** Workflow children only — never a workflow parent. */
const hiddenSubStepCondition = (): SQL => and(
  eq(operations.hiddenFromOperations, true),
  or(isNull(operations.endpointSlug), notLike(operations.endpointSlug, 'workflows:%')),
) as SQL;

/**
 * Candidate queries select IDs only; content is loaded one row at a time.
 * Sub-step prompts and step artifacts (e.g. `ocr_texts`) can be very large, so a
 * whole batch in memory could push the worker over its heap threshold.
 */
async function scrubRows(ids: string[], now: Date): Promise<number> {
  let purged = 0;
  for (const id of ids) {
    const [row] = await db.select(purgeSourceColumns)
      .from(operations)
      .where(and(eq(operations.id, id), isNull(operations.contentPurgedAt)))
      .limit(1);
    if (!row) continue; // already purged by another process
    const patch = buildContentPurgePatch(row, now);
    const updated = await db.update(operations)
      .set({
        ...patch,
        // Preserve updatedAt: it drives "recently updated" ordering and the legacy
        // duration fallback; a retention scrub is not an operational change.
        updatedAt: sql`${operations.updatedAt}`,
      })
      .where(and(eq(operations.id, row.id), isNull(operations.contentPurgedAt)))
      .returning({ id: operations.id });
    purged += updated.length;
  }
  return purged;
}

const purgeSourceColumns = {
  id: operations.id,
  pipelineJson: operations.pipelineJson,
  stepsResultJson: operations.stepsResultJson,
  filesJson: operations.filesJson,
};

/**
 * Scrubs the finished sub-steps of a workflow run as soon as the parent reaches
 * SUCCEEDED/FAILED. Children still running (e.g. the parent timed out waiting)
 * are left for the sweeper. Never throws: a purge problem must not change the
 * workflow outcome or its webhook.
 */
export async function purgeWorkflowSubSteps(input: {
  parentOperationId: string;
  correlationIds: Array<string | null | undefined>;
  /** Parent artifacts naming child operation IDs (stepsResult, extracted data). */
  references: unknown[];
  logger?: Pick<Logger, 'info' | 'warn'>;
  now?: Date;
}): Promise<number> {
  const logger = input.logger ?? defaultLogger;
  if (keepWorkflowSubStepContent()) return 0;
  try {
    const childIds = extractTrustedChildOperationIds(
      ...input.references.map((value) => (value === undefined ? null : JSON.stringify(value))),
    );
    // A resumed run gets a fresh job correlationId, so also use the parent's stored one.
    const [parent] = await db.select({
      correlationId: operations.correlationId,
      createdAt: operations.createdAt,
    })
      .from(operations)
      .where(eq(operations.id, input.parentOperationId))
      .limit(1);
    const correlationIds = [...new Set([...input.correlationIds, parent?.correlationId].filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    ))];
    if (childIds.length === 0 && correlationIds.length === 0) return 0;

    const now = input.now ?? new Date();
    const links: SQL[] = [];
    // IDs named by this run's own artifacts are unique to it: purge at once.
    if (childIds.length > 0) links.push(inArray(operations.id, childIds));
    // x-correlation-id is client-controlled and may be reused by a concurrent
    // request whose parent is about to read its just-finished child; only take
    // correlation-linked children that finished a few minutes ago.
    if (correlationIds.length > 0) {
      links.push(and(
        inArray(operations.correlationId, correlationIds),
        parent ? gte(operations.createdAt, parent.createdAt) : sql`true`,
        finishedBefore(new Date(now.getTime() - CORRELATION_LINK_GRACE_MS)),
      ) as SQL);
    }

    const rows = await db.select({ id: operations.id })
      .from(operations)
      .where(and(
        ne(operations.id, input.parentOperationId),
        isNull(operations.contentPurgedAt),
        hiddenSubStepCondition(),
        eq(operations.done, true),
        or(...links),
      ))
      .limit(1_000);

    if (rows.length === 0) return 0;
    const purged = await scrubRows(rows.map((row) => row.id), now);
    logger.info?.('[CONTENT-RETENTION] Purged workflow sub-step content', {
      parentOperationId: input.parentOperationId,
      purged,
    });
    return purged;
  } catch (error) {
    try {
      logger.warn?.('[CONTENT-RETENTION] Sub-step purge failed; the sweeper will retry', {
        parentOperationId: input.parentOperationId,
      }, error);
    } catch {
      // Logging must not turn a best-effort purge into a workflow failure.
    }
    return 0;
  }
}

async function isBackfillComplete(): Promise<boolean> {
  const [row] = await db.select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, BACKFILL_CHECKPOINT_KEY))
    .limit(1);
  if (!row) return false;
  const parsed = parseJson(row.value);
  return isRecord(parsed) && parsed.phase === 'complete';
}

/**
 * The moment this feature first ran on this database. Rows created before it
 * are "legacy": they may still need the request-tracking backfill, which reads
 * the very columns the TTL scrubs.
 */
async function loadLegacyCutoff(now: Date): Promise<Date> {
  await db.insert(appSettings)
    .values({
      key: RETENTION_STATE_KEY,
      value: JSON.stringify({ legacyCutoff: now.toISOString() }),
      updatedAt: now,
    })
    .onConflictDoNothing({ target: appSettings.key });

  const [row] = await db.select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, RETENTION_STATE_KEY))
    .limit(1);
  const parsed = parseJson(row?.value);
  const cutoff = isRecord(parsed) && typeof parsed.legacyCutoff === 'string'
    ? new Date(parsed.legacyCutoff)
    : null;
  return cutoff && !Number.isNaN(cutoff.getTime()) ? cutoff : now;
}

export interface PurgeRunResult {
  scanned: number;
  purged: number;
  dryRun: boolean;
  /** True when the per-run cap stopped the run before the backlog was empty. */
  capped: boolean;
}

interface BatchedPurgeOptions {
  where: SQL;
  maxPerRun: number;
  dryRun: boolean;
  now: Date;
  pauseMs: number;
}

async function runBatchedPurge(options: BatchedPurgeOptions): Promise<PurgeRunResult> {
  if (options.dryRun) {
    const [row] = await db.select({ count: sql<number>`COUNT(*)::integer` })
      .from(operations)
      .where(options.where);
    const eligible = Number(row?.count ?? 0);
    return { scanned: eligible, purged: 0, dryRun: true, capped: eligible > options.maxPerRun };
  }

  let scanned = 0;
  let purged = 0;
  while (scanned < options.maxPerRun) {
    const limit = Math.min(PURGE_BATCH_SIZE, options.maxPerRun - scanned);
    const rows = await db.select({ id: operations.id })
      .from(operations)
      .where(options.where)
      .orderBy(asc(operations.createdAt), asc(operations.id))
      .limit(limit);
    if (rows.length === 0) return { scanned, purged, dryRun: false, capped: false };

    scanned += rows.length;
    const batchPurged = await scrubRows(rows.map((row) => row.id), options.now);
    purged += batchPurged;
    // Nothing changed in a full batch means every row was raced by another
    // process; stop rather than spin on the same rows.
    if (rows.length < limit || batchPurged === 0) return { scanned, purged, dryRun: false, capped: false };
    if (options.pauseMs > 0) await sleep(options.pauseMs);
  }
  return { scanned, purged, dryRun: false, capped: true };
}

export interface RetentionRunOptions {
  env?: RetentionEnv;
  now?: Date;
  pauseMs?: number;
  logger?: Pick<Logger, 'info' | 'warn'>;
}

/** Hourly safety net for sub-steps that finished after their parent, or whose parent crashed. */
export async function sweepWorkflowSubSteps(options: RetentionRunOptions = {}): Promise<PurgeRunResult> {
  const config = readContentRetentionConfig(options.env);
  const now = options.now ?? new Date();
  const logger = options.logger ?? defaultLogger;
  if (keepWorkflowSubStepContent(options.env)) {
    return { scanned: 0, purged: 0, dryRun: config.dryRun, capped: false };
  }

  const result = await runBatchedPurge({
    where: and(
      isNull(operations.contentPurgedAt),
      hiddenSubStepCondition(),
      terminalCondition(),
      finishedBefore(new Date(now.getTime() - SUB_STEP_SWEEP_GRACE_MS)),
    ) as SQL,
    maxPerRun: config.maxPerRun,
    dryRun: config.dryRun,
    now,
    pauseMs: options.pauseMs ?? PURGE_BATCH_PAUSE_MS,
  });
  if (result.scanned > 0) {
    logger.info('[CONTENT-RETENTION] Sub-step sweep finished', { ...result });
  }
  return result;
}

export interface TtlRunResult extends PurgeRunResult {
  retentionDays: number;
  skipped?: 'disabled';
  /** True when legacy rows were excluded because the backfill is not complete. */
  legacyBlocked: boolean;
}

export async function purgeExpiredOperationContent(options: RetentionRunOptions = {}): Promise<TtlRunResult> {
  const config = readContentRetentionConfig(options.env);
  const now = options.now ?? new Date();
  const logger = options.logger ?? defaultLogger;
  for (const warning of config.warnings) logger.warn(`[CONTENT-RETENTION] ${warning}`);

  if (config.retentionDays === 0) {
    return {
      scanned: 0, purged: 0, dryRun: config.dryRun, capped: false,
      retentionDays: 0, skipped: 'disabled', legacyBlocked: false,
    };
  }

  const cutoff = new Date(now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000);
  const legacyCutoff = await loadLegacyCutoff(now);
  const legacyBlocked = !(await isBackfillComplete());

  const conditions: SQL[] = [
    isNull(operations.contentPurgedAt),
    terminalCondition(),
    finishedBefore(cutoff),
  ];
  if (legacyBlocked) conditions.push(gte(operations.createdAt, legacyCutoff));

  const result = await runBatchedPurge({
    where: and(...conditions) as SQL,
    maxPerRun: config.maxPerRun,
    dryRun: config.dryRun,
    now,
    pauseMs: options.pauseMs ?? PURGE_BATCH_PAUSE_MS,
  });

  if (legacyBlocked && cutoff.getTime() > legacyCutoff.getTime()) {
    // Only worth saying once legacy rows are actually past retention.
    logger.warn(
      '[CONTENT-RETENTION] Rows created before content retention was enabled are kept until the '
      + `request-tracking backfill (${BACKFILL_CHECKPOINT_KEY}) reports phase=complete.`,
      { legacyCutoff: legacyCutoff.toISOString() },
    );
  }
  logger.info('[CONTENT-RETENTION] Retention run finished', {
    ...result,
    retentionDays: config.retentionDays,
    cutoff: cutoff.toISOString(),
    legacyBlocked,
  });
  return { ...result, retentionDays: config.retentionDays, legacyBlocked };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_FIRST_RUN_DELAY_MS = 60_000;

let retentionScheduled = false;
let retentionRunning = false;

export async function runContentRetention(options: RetentionRunOptions = {}): Promise<void> {
  if (retentionRunning) return;
  retentionRunning = true;
  const logger = options.logger ?? defaultLogger;
  try {
    await sweepWorkflowSubSteps(options).catch((error) =>
      logger.warn('[CONTENT-RETENTION] Sub-step sweep failed', undefined, error));
    await purgeExpiredOperationContent(options).catch((error) =>
      logger.warn('[CONTENT-RETENTION] Retention run failed', undefined, error));
  } finally {
    retentionRunning = false;
  }
}

/**
 * Arms the hourly retention run once per process. Called from the app cleanup
 * scheduler and from the worker's job entry points (the app scheduler only starts
 * after a page render, which an API-only deployment may never do). Several
 * processes may arm it: every update is guarded by `contentPurgedAt IS NULL`.
 */
export function ensureContentRetentionScheduled(): void {
  if (retentionScheduled) return;
  if (process.env.JEST_WORKER_ID !== undefined) return; // never from unit tests
  retentionScheduled = true;

  const first = setTimeout(() => { void runContentRetention(); }, RETENTION_FIRST_RUN_DELAY_MS);
  const every = setInterval(() => { void runContentRetention(); }, RETENTION_INTERVAL_MS);
  first.unref?.();
  every.unref?.();
}
