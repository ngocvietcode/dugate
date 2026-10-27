import { sql, type SQL } from 'drizzle-orm';
import { operations } from '@/lib/db/schema';
import type { CostSource } from '@/lib/pricing';

export type CanonicalLogicResult = 'PASS' | 'FAIL';
export type CanonicalExtractionResult = 'SUCCESS' | 'FAIL';

export interface CanonicalOperationalResults {
  logicResult?: CanonicalLogicResult | null;
  extractionResult?: CanonicalExtractionResult | null;
}

export interface UsageMeasurement {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costSource?: CostSource | null;
}

export interface OperationUsageMetadata {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  inputTokensMissing: boolean;
  outputTokensMissing: boolean;
  costMissing: boolean;
  hasUnpricedCost: boolean;
}

/**
 * Converts nullable processor measurements into Operation aggregates without
 * destroying the distinction between a real zero and an unavailable value.
 * Unpriced usage is deliberately excluded from cost while retaining its marker.
 */
export function summarizeOperationUsage(
  measurements: readonly UsageMeasurement[],
): OperationUsageMetadata {
  return measurements.reduce<OperationUsageMetadata>((summary, measurement) => {
    const unpriced = measurement.costSource === 'unpriced';

    summary.totalInputTokens += measurement.inputTokens ?? 0;
    summary.totalOutputTokens += measurement.outputTokens ?? 0;
    if (!unpriced) summary.totalCostUsd += measurement.costUsd ?? 0;
    summary.inputTokensMissing ||= measurement.inputTokens === null;
    summary.outputTokensMissing ||= measurement.outputTokens === null;
    summary.costMissing ||= measurement.costUsd === null && !unpriced;
    summary.hasUnpricedCost ||= unpriced;

    return summary;
  }, {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    inputTokensMissing: false,
    outputTokensMissing: false,
    costMissing: false,
    hasUnpricedCost: false,
  });
}

export function canonicalLogicResult(
  outcome: boolean | 'PASS' | 'FAIL' | null | undefined,
): CanonicalLogicResult | null {
  if (outcome === true || outcome === 'PASS') return 'PASS';
  if (outcome === false || outcome === 'FAIL') return 'FAIL';
  return null;
}

export function canonicalExtractionResult(
  outcome: boolean | 'SUCCESS' | 'FAIL' | null | undefined,
): CanonicalExtractionResult | null {
  if (outcome === true || outcome === 'SUCCESS') return 'SUCCESS';
  if (outcome === false || outcome === 'FAIL') return 'FAIL';
  return null;
}

/** Only extraction endpoints have a generic, deterministic pipeline outcome. */
export function canonicalPipelineResults(
  endpointSlug: string | null,
  succeeded: boolean,
): Required<CanonicalOperationalResults> {
  return {
    logicResult: null,
    extractionResult: endpointSlug?.startsWith('extract:')
      ? canonicalExtractionResult(succeeded)
      : null,
  };
}

/** Workflow sub-operations remain source rows but are excluded from Operations. */
export function workflowChildVisibility(): {
  hiddenFromOperations: true;
  deletedAt: null;
} {
  return { hiddenFromOperations: true, deletedAt: null };
}

// ─── Operation visibility ─────────────────────────────────────────────────────
// An Operation row is hidden from every listing, statistic, export and cleanup
// pass for one of two reasons:
//   - soft delete:         `deletedAt` is set (user/admin delete, DISABLE_HISTORY)
//   - workflow sub-step:   `hiddenFromOperations = true` (see workflowChildVisibility)
//
// Before commit 80e309b sub-steps were hidden with `deletedAt`, so every reader
// filtered `deletedAt IS NULL` only. Sub-steps now use the dedicated flag, and a
// reader that checks `deletedAt` alone lists them, double-counts their cost (the
// parent already rolls child usage up) and lets them through row guards.
//
// Every reader MUST use these two helpers instead of hand-writing the predicate,
// so the definition of "visible" lives in exactly one place.

/** SQL predicate: the row appears in Operations listings, stats, exports and cleanup. */
export function visibleInOperationsCondition(): SQL {
  return sql`(${operations.deletedAt} IS NULL AND ${operations.hiddenFromOperations} = false)`;
}

/** Row-level counterpart of {@link visibleInOperationsCondition}, for guards on an already-loaded row. */
export function isHiddenFromOperations(row: {
  deletedAt: Date | null;
  hiddenFromOperations: boolean;
}): boolean {
  return row.deletedAt !== null || row.hiddenFromOperations === true;
}
