import { and, eq, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import {
  OperationNotFoundError,
  transitionOperationState,
} from '@/lib/operations/state-transition';

export const DEFAULT_RUNNING_STALL_MS = 9_000_000;
const configuredRunningStallMs = Number.parseInt(
  process.env.RUNNING_STALL_MS ?? '',
  10,
);
/** Must stay above the two-hour financial-report workflow deadline. */
export const RUNNING_STALL_MS =
  Number.isFinite(configuredRunningStallMs) &&
  configuredRunningStallMs > 7_200_000
    ? configuredRunningStallMs
    : DEFAULT_RUNNING_STALL_MS;

export interface ReapedOperation {
  id: string;
  endpointSlug: string | null;
  updatedAt: Date;
}

/** Marks only currently-running operations with no recent persisted progress as terminal. */
export async function recoverStalledOperations(
  stallMs: number = DEFAULT_RUNNING_STALL_MS,
): Promise<ReapedOperation[]> {
  const thresholdDate = new Date(Date.now() - stallMs);
  const stalledOperations = await db
    .select({
      id: operations.id,
      endpointSlug: operations.endpointSlug,
      updatedAt: operations.updatedAt,
    })
    .from(operations)
    .where(
      and(
        eq(operations.state, 'RUNNING'),
        eq(operations.done, false),
        lt(operations.updatedAt, thresholdDate),
      ),
    );

  if (stalledOperations.length === 0) return [];

  for (const operation of stalledOperations) {
    try {
      await transitionOperationState({
        operationId: operation.id,
        state: 'FAILED',
        changes: {
          errorCode: 'STALLED',
          errorMessage: `Operation exceeded stall threshold of ${stallMs / 1000}s with no progress.`,
          progressMessage: null,
        },
        onlyIf: { state: 'RUNNING', done: false },
      });
    } catch (error) {
      // A row may be removed after candidate selection. This remains a no-op,
      // matching the former guarded batch update.
      if (!(error instanceof OperationNotFoundError)) throw error;
    }
  }

  return stalledOperations;
}
