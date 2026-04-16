// app/api/internal/recover-stalled/route.ts
// Safety-net endpoint: detects Operations stuck in RUNNING state beyond a
// configurable timeout and marks them as FAILED.
//
// BullMQ's built-in stalledInterval handles queue-level recovery.
// This endpoint handles DB-level recovery for operations that lost their job
// reference (e.g., Redis was wiped in dev, pod crashed before job was acked).
//
// Intended to be called:
//   - By a K8s CronJob every 5 minutes
//   - Or manually by Admin via Dashboard

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq, lt, and, inArray, sql } from 'drizzle-orm';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'recover-stalled' });

/** Operations RUNNING longer than this are considered stalled (default: 15 min) */
const STALL_THRESHOLD_MS = parseInt(process.env.STALL_THRESHOLD_MS || '900000', 10);

export async function POST(req: NextRequest) {
  // Internal-only: only callable from within the cluster (middleware bypasses /api/internal/*)
  // Additionally guard with a simple token for extra safety
  const authHeader = req.headers.get('authorization');
  const internalSecret = process.env.INTERNAL_API_SECRET;
  if (internalSecret && authHeader !== `Bearer ${internalSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const thresholdDate = new Date(Date.now() - STALL_THRESHOLD_MS);

  const stalledOps = await db.select({ id: operations.id, createdAt: operations.createdAt, endpointSlug: operations.endpointSlug }).from(operations).where(
    and(
      eq(operations.state, 'RUNNING'),
      eq(operations.done, false),
      lt(operations.createdAt, thresholdDate)
    )
  );

  if (stalledOps.length === 0) {
    logger.info('[recover-stalled] No stalled operations found.');
    return NextResponse.json({ recovered: 0, operations: [] });
  }

  logger.warn(`[recover-stalled] Found ${stalledOps.length} stalled operation(s) — marking FAILED.`);

  const ids = stalledOps.map((op) => op.id);

  await db.update(operations).set({
      done: true,
      state: 'FAILED',
      errorCode: 'STALLED',
      errorMessage: `Operation exceeded stall threshold of ${STALL_THRESHOLD_MS / 1000}s with no progress.`,
      progressMessage: null,
  }).where(inArray(operations.id, ids));

  logger.info(`[recover-stalled] Recovered ${ids.length} stalled operation(s).`, { ids });

  return NextResponse.json({
    recovered: ids.length,
    operations: stalledOps.map((op) => ({
      id: op.id,
      endpointSlug: op.endpointSlug,
      createdAt: op.createdAt,
    })),
  });
}

// GET: status check — how many operations are currently stalled
export async function GET(req: NextRequest) {
  const thresholdDate = new Date(Date.now() - STALL_THRESHOLD_MS);
  const [{ count }] = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(operations).where(
    and(eq(operations.state, 'RUNNING'), eq(operations.done, false), lt(operations.createdAt, thresholdDate))
  );
  return NextResponse.json({ stalled: count, thresholdMs: STALL_THRESHOLD_MS });
}
