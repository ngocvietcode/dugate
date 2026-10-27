import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  appSettings,
  businessOperationStatusSnapshots,
  operations,
} from '@/lib/db/schema';
import { Logger } from '@/lib/logger';
import {
  aggregateCurrentStatus,
  type ValidBusinessStatus,
} from '@/lib/operations/status';

/** Exported so content retention can wait for this backfill before scrubbing legacy rows. */
export const CHECKPOINT_KEY = 'operations_request_tracking_backfill_v1';
const CHECKPOINT_VERSION = 1 as const;
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 5_000;
const CHILD_ID_CHUNK_SIZE = 500;

export type CanonicalLogicResult = 'PASS' | 'FAIL';
export type CanonicalExtractionResult = 'SUCCESS' | 'FAIL';
export type BackfillPhase = 'operations' | 'snapshots' | 'complete';

export interface OperationCursor {
  createdAt: string;
  id: string;
}

export interface BackfillCounters {
  processedOperations: number;
  metadataRowsUpdated: number;
  hiddenChildrenMarked: number;
  processedGroups: number;
  snapshotsUpserted: number;
  unknownGroupsSkipped: number;
}

export interface BackfillCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  phase: BackfillPhase;
  operationCursor: OperationCursor | null;
  snapshotCursor: string | null;
  counters: BackfillCounters;
}

export interface HistoricalOperationRow {
  id: string;
  createdAt: Date;
  endpointSlug: string | null;
  usageBreakdown: string | null;
  stepsResultJson: string | null;
  extractedData: string | null;
  outputContent: string | null;
  logicResult: string | null;
  extractionResult: string | null;
}

export interface OperationMetadataPatch {
  id: string;
  hasUnpricedCost?: boolean;
  logicResult?: CanonicalLogicResult;
  extractionResult?: CanonicalExtractionResult;
}

export interface SnapshotGroupRow {
  businessGroupKey: string;
  states: string[];
}

export interface SnapshotPatch {
  businessGroupKey: string;
  lastValidStatus: ValidBusinessStatus;
}

export interface ApplyOperationBatchResult {
  metadataRowsUpdated: number;
  hiddenChildrenMarked: number;
}

export interface OperationsBackfillRepository {
  loadCheckpoint(): Promise<BackfillCheckpoint | null>;
  saveCheckpoint(checkpoint: BackfillCheckpoint): Promise<void>;
  readOperationBatch(cursor: OperationCursor | null, limit: number): Promise<HistoricalOperationRow[]>;
  applyOperationBatch(
    patches: OperationMetadataPatch[],
    hiddenChildIds: string[],
    checkpoint: BackfillCheckpoint,
  ): Promise<ApplyOperationBatchResult>;
  readSnapshotBatch(cursor: string | null, limit: number): Promise<SnapshotGroupRow[]>;
  applySnapshotBatch(patches: SnapshotPatch[], checkpoint: BackfillCheckpoint): Promise<number>;
}

export interface RunOperationsBackfillOptions {
  batchSize?: number;
  restart?: boolean;
  maxBatches?: number;
  logger?: Pick<Logger, 'info' | 'warn'>;
}

function emptyCounters(): BackfillCounters {
  return {
    processedOperations: 0,
    metadataRowsUpdated: 0,
    hiddenChildrenMarked: 0,
    processedGroups: 0,
    snapshotsUpserted: 0,
    unknownGroupsSkipped: 0,
  };
}

export function createInitialCheckpoint(): BackfillCheckpoint {
  return {
    version: CHECKPOINT_VERSION,
    phase: 'operations',
    operationCursor: null,
    snapshotCursor: null,
    counters: emptyCounters(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Returns null when the historical source is absent/malformed. A valid array is
 * authoritative for both true and false, so a safe rerun can repair stale flags.
 */
export function deriveUnpricedFlag(rawUsageBreakdown: string | null): boolean | null {
  const parsed = parseJson(rawUsageBreakdown);
  if (!Array.isArray(parsed)) return null;

  return parsed.some((entry) => (
    isRecord(entry) && entry.cost_source === 'unpriced'
  ));
}

/**
 * Workflow children are only considered confidently identified when a persisted
 * parent result names their exact operation ID under one of the two adapter keys
 * used by workflow implementations. No correlation/reference heuristic is used.
 */
export function extractTrustedChildOperationIds(...rawPayloads: Array<string | null>): string[] {
  const ids = new Set<string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;

    for (const [key, child] of Object.entries(value)) {
      if ((key === 'sub_operation_id' || key === 'subOperationId') && typeof child === 'string') {
        const id = child.trim();
        if (id) ids.add(id);
      }
      visit(child);
    }
  };

  for (const raw of rawPayloads) {
    const parsed = parseJson(raw);
    if (parsed !== null) visit(parsed);
  }

  return [...ids].sort();
}

function decisionToLogicResult(value: unknown): CanonicalLogicResult | null {
  if (value === 'APPROVED' || value === 'PASS') return 'PASS';
  if (value === 'REVIEW_REQUIRED' || value === 'REJECTED' || value === 'FAIL') return 'FAIL';
  return null;
}

/**
 * Endpoint-specific historical adapters. They deliberately require the exact
 * workflow slug and stable output envelope/field; ambiguous statuses and warning
 * outcomes remain null (NOT_AVAILABLE).
 */
export function deriveCanonicalResults(
  endpointSlug: string | null,
  rawExtractedData: string | null,
): {
  logicResult: CanonicalLogicResult | null;
  extractionResult: CanonicalExtractionResult | null;
} {
  const parsed = parseJson(rawExtractedData);
  if (!isRecord(parsed)) return { logicResult: null, extractionResult: null };

  if (endpointSlug === 'workflows:payroll-verify') {
    const result = isRecord(parsed.result) ? parsed.result : null;
    if (parsed.skill_code === 'payroll-batch-validation' && result) {
      return {
        logicResult: decisionToLogicResult(result.final_decision),
        extractionResult: null,
      };
    }
  }

  if (endpointSlug === 'workflows:margin-deposit-profile') {
    const summary = isRecord(parsed.summary) ? parsed.summary : null;
    return {
      logicResult: summary ? decisionToLogicResult(summary.overall_verdict) : null,
      extractionResult: null,
    };
  }

  if (endpointSlug === 'workflows:payment-account-management') {
    const metadata = isRecord(parsed.metadata) ? parsed.metadata : null;
    const result = isRecord(parsed.result) ? parsed.result : null;
    const summary = result && isRecord(result.summary) ? result.summary : null;
    if (parsed.skill_code === 'payment-account-management' && metadata?.mode === 'open_account' && summary) {
      return {
        logicResult: decisionToLogicResult(summary.final_decision),
        extractionResult: null,
      };
    }
  }

  if (endpointSlug === 'workflows:tracing-portal' && parsed.skill_code === 'tracing-portal') {
    return {
      logicResult: null,
      extractionResult: parsed.status === 'SUCCESS'
        ? 'SUCCESS'
        : parsed.status === 'PARTIAL'
          ? 'FAIL'
          : null,
    };
  }

  return { logicResult: null, extractionResult: null };
}

export function buildOperationBackfill(row: HistoricalOperationRow): {
  patch: OperationMetadataPatch | null;
  hiddenChildIds: string[];
} {
  const patch: OperationMetadataPatch = { id: row.id };
  const hasUnpricedCost = deriveUnpricedFlag(row.usageBreakdown);
  const canonical = deriveCanonicalResults(row.endpointSlug, row.extractedData);

  if (hasUnpricedCost !== null) patch.hasUnpricedCost = hasUnpricedCost;
  if (row.logicResult === null && canonical.logicResult !== null) {
    patch.logicResult = canonical.logicResult;
  }
  if (row.extractionResult === null && canonical.extractionResult !== null) {
    patch.extractionResult = canonical.extractionResult;
  }

  return {
    patch: Object.keys(patch).length > 1 ? patch : null,
    hiddenChildIds: extractTrustedChildOperationIds(row.stepsResultJson, row.extractedData),
  };
}

function validateBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  return batchSize;
}

function validateCheckpoint(value: BackfillCheckpoint): BackfillCheckpoint {
  if (value.version !== CHECKPOINT_VERSION) {
    throw new Error(`Unsupported Operations backfill checkpoint version: ${String(value.version)}`);
  }
  if (!['operations', 'snapshots', 'complete'].includes(value.phase)) {
    throw new Error(`Invalid Operations backfill checkpoint phase: ${String(value.phase)}`);
  }
  return value;
}

export async function runOperationsBackfill(
  repository: OperationsBackfillRepository = new DrizzleOperationsBackfillRepository(),
  options: RunOperationsBackfillOptions = {},
): Promise<BackfillCheckpoint> {
  const batchSize = validateBatchSize(options.batchSize);
  const logger = options.logger ?? new Logger({ service: 'operations-request-tracking-backfill' });
  let checkpoint = options.restart
    ? createInitialCheckpoint()
    : validateCheckpoint((await repository.loadCheckpoint()) ?? createInitialCheckpoint());

  if (options.restart) await repository.saveCheckpoint(checkpoint);
  if (checkpoint.phase === 'complete') {
    logger.info('Operations backfill already complete; no changes applied', { ...checkpoint.counters });
    return checkpoint;
  }

  let batches = 0;
  const reachedBatchLimit = (): boolean => (
    options.maxBatches !== undefined && batches >= options.maxBatches
  );

  while (checkpoint.phase === 'operations' && !reachedBatchLimit()) {
    const rows = await repository.readOperationBatch(checkpoint.operationCursor, batchSize);
    if (rows.length === 0) {
      checkpoint = { ...checkpoint, phase: 'snapshots', snapshotCursor: null };
      await repository.saveCheckpoint(checkpoint);
      logger.info('Operation metadata phase complete', { ...checkpoint.counters });
      break;
    }

    const patches: OperationMetadataPatch[] = [];
    const hiddenChildIds = new Set<string>();
    for (const row of rows) {
      const result = buildOperationBackfill(row);
      if (result.patch) patches.push(result.patch);
      result.hiddenChildIds.forEach((id) => hiddenChildIds.add(id));
    }

    const last = rows[rows.length - 1];
    const nextCheckpoint: BackfillCheckpoint = {
      ...checkpoint,
      operationCursor: { createdAt: last.createdAt.toISOString(), id: last.id },
      counters: {
        ...checkpoint.counters,
        processedOperations: checkpoint.counters.processedOperations + rows.length,
      },
    };
    const applied = await repository.applyOperationBatch(patches, [...hiddenChildIds], nextCheckpoint);
    checkpoint = {
      ...nextCheckpoint,
      counters: {
        ...nextCheckpoint.counters,
        metadataRowsUpdated: nextCheckpoint.counters.metadataRowsUpdated + applied.metadataRowsUpdated,
        hiddenChildrenMarked: nextCheckpoint.counters.hiddenChildrenMarked + applied.hiddenChildrenMarked,
      },
    };
    // Persist actual write counts after the atomic source-update/cursor commit.
    await repository.saveCheckpoint(checkpoint);
    batches += 1;
    logger.info('Applied Operations metadata batch', {
      rows: rows.length,
      metadataRowsUpdated: applied.metadataRowsUpdated,
      hiddenChildrenMarked: applied.hiddenChildrenMarked,
      cursor: checkpoint.operationCursor,
    });
  }

  while (checkpoint.phase === 'snapshots' && !reachedBatchLimit()) {
    const groups = await repository.readSnapshotBatch(checkpoint.snapshotCursor, batchSize);
    if (groups.length === 0) {
      checkpoint = { ...checkpoint, phase: 'complete' };
      await repository.saveCheckpoint(checkpoint);
      logger.info('Operations backfill complete', { ...checkpoint.counters });
      break;
    }

    const patches: SnapshotPatch[] = [];
    let unknownGroups = 0;
    for (const group of groups) {
      const status = aggregateCurrentStatus(group.states);
      if (status) patches.push({ businessGroupKey: group.businessGroupKey, lastValidStatus: status });
      else unknownGroups += 1;
    }

    const nextCheckpoint: BackfillCheckpoint = {
      ...checkpoint,
      snapshotCursor: groups[groups.length - 1].businessGroupKey,
      counters: {
        ...checkpoint.counters,
        processedGroups: checkpoint.counters.processedGroups + groups.length,
        unknownGroupsSkipped: checkpoint.counters.unknownGroupsSkipped + unknownGroups,
      },
    };
    const upserted = await repository.applySnapshotBatch(patches, nextCheckpoint);
    checkpoint = {
      ...nextCheckpoint,
      counters: {
        ...nextCheckpoint.counters,
        snapshotsUpserted: nextCheckpoint.counters.snapshotsUpserted + upserted,
      },
    };
    await repository.saveCheckpoint(checkpoint);
    batches += 1;
    logger.info('Applied last-valid snapshot batch', {
      groups: groups.length,
      snapshotsUpserted: upserted,
      unknownGroupsSkipped: unknownGroups,
      cursor: checkpoint.snapshotCursor,
    });
  }

  return checkpoint;
}

function checkpointValue(checkpoint: BackfillCheckpoint): string {
  return JSON.stringify(checkpoint);
}

async function upsertCheckpoint(
  executor: Pick<typeof db, 'insert'>,
  checkpoint: BackfillCheckpoint,
): Promise<void> {
  await executor.insert(appSettings).values({
    key: CHECKPOINT_KEY,
    value: checkpointValue(checkpoint),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: checkpointValue(checkpoint), updatedAt: new Date() },
  });
}

export class DrizzleOperationsBackfillRepository implements OperationsBackfillRepository {
  async loadCheckpoint(): Promise<BackfillCheckpoint | null> {
    const [row] = await db.select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, CHECKPOINT_KEY))
      .limit(1);
    if (!row) return null;

    try {
      return validateCheckpoint(JSON.parse(row.value) as BackfillCheckpoint);
    } catch (error) {
      throw new Error('Operations backfill checkpoint is malformed; inspect it before retrying', { cause: error });
    }
  }

  async saveCheckpoint(checkpoint: BackfillCheckpoint): Promise<void> {
    await upsertCheckpoint(db, checkpoint);
  }

  async readOperationBatch(cursor: OperationCursor | null, limit: number): Promise<HistoricalOperationRow[]> {
    const cursorDate = cursor ? new Date(cursor.createdAt) : null;
    return db.select({
      id: operations.id,
      createdAt: operations.createdAt,
      endpointSlug: operations.endpointSlug,
      usageBreakdown: operations.usageBreakdown,
      stepsResultJson: operations.stepsResultJson,
      extractedData: operations.extractedData,
      outputContent: operations.outputContent,
      logicResult: operations.logicResult,
      extractionResult: operations.extractionResult,
    }).from(operations)
      .where(cursor && cursorDate
        ? or(
          gt(operations.createdAt, cursorDate),
          and(eq(operations.createdAt, cursorDate), gt(operations.id, cursor.id)),
        )
        : undefined)
      .orderBy(asc(operations.createdAt), asc(operations.id))
      .limit(limit);
  }

  async applyOperationBatch(
    patches: OperationMetadataPatch[],
    hiddenChildIds: string[],
    checkpoint: BackfillCheckpoint,
  ): Promise<ApplyOperationBatchResult> {
    return db.transaction(async (tx) => {
      let metadataRowsUpdated = 0;
      for (const patch of patches) {
        const values: {
          hasUnpricedCost?: boolean;
          logicResult?: CanonicalLogicResult;
          extractionResult?: CanonicalExtractionResult;
        } = {};
        if (patch.hasUnpricedCost !== undefined) values.hasUnpricedCost = patch.hasUnpricedCost;
        if (patch.logicResult !== undefined) values.logicResult = patch.logicResult;
        if (patch.extractionResult !== undefined) values.extractionResult = patch.extractionResult;
        if (Object.keys(values).length === 0) continue;

        const updated = await tx.update(operations).set(values)
          .where(eq(operations.id, patch.id))
          .returning({ id: operations.id });
        metadataRowsUpdated += updated.length;
      }

      let hiddenChildrenMarked = 0;
      const uniqueIds = [...new Set(hiddenChildIds)];
      for (let offset = 0; offset < uniqueIds.length; offset += CHILD_ID_CHUNK_SIZE) {
        const chunk = uniqueIds.slice(offset, offset + CHILD_ID_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const updated = await tx.update(operations)
          .set({ hiddenFromOperations: true })
          .where(and(
            inArray(operations.id, chunk),
            eq(operations.hiddenFromOperations, false),
          ))
          .returning({ id: operations.id });
        hiddenChildrenMarked += updated.length;
      }

      await upsertCheckpoint(tx, checkpoint);
      return { metadataRowsUpdated, hiddenChildrenMarked };
    });
  }

  async readSnapshotBatch(cursor: string | null, limit: number): Promise<SnapshotGroupRow[]> {
    const rows = await db.execute<{ businessGroupKey: string; states: string[] }>(sql`
      SELECT "businessGroupKey", array_agg("state" ORDER BY "id") AS states
        FROM "Operation"
       WHERE "deletedAt" IS NULL
         AND "hiddenFromOperations" = false
         ${cursor ? sql`AND "businessGroupKey" > ${cursor}` : sql``}
       GROUP BY "businessGroupKey"
       ORDER BY "businessGroupKey" ASC
       LIMIT ${limit}
    `);
    return Array.from(rows).map((row) => ({
      businessGroupKey: row.businessGroupKey,
      states: row.states,
    }));
  }

  async applySnapshotBatch(patches: SnapshotPatch[], checkpoint: BackfillCheckpoint): Promise<number> {
    return db.transaction(async (tx) => {
      for (const patch of patches) {
        await tx.insert(businessOperationStatusSnapshots).values({
          businessGroupKey: patch.businessGroupKey,
          lastValidStatus: patch.lastValidStatus,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: businessOperationStatusSnapshots.businessGroupKey,
          set: {
            lastValidStatus: patch.lastValidStatus,
            updatedAt: new Date(),
          },
        });
      }
      await upsertCheckpoint(tx, checkpoint);
      return patches.length;
    });
  }
}
