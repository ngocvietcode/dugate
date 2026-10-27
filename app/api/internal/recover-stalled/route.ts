// app/api/internal/recover-stalled/route.ts
// Safety-net endpoint: detects Operations stuck in RUNNING state beyond a
// configurable timeout and marks them as FAILED.
//
// BullMQ's built-in stalledInterval handles queue-level recovery.
// This endpoint handles DB-level recovery for operations that lost their job
// reference (e.g., Redis was wiped in dev, pod crashed before job was acked).
//
// AUTOMATED recovery does NOT use this HTTP route: lib/stalled-reaper-scheduler.ts
// runs in-process (started from app/layout.tsx, every 5 min) and calls
// recoverStalledOperations() directly. This HTTP route is only a MANUAL/external
// (e.g. CronJob) trigger, so it is guarded fail-closed by INTERNAL_API_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq, lt, and, sql } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { recoverStalledOperations, RUNNING_STALL_MS } from '@/lib/stalled-reaper';
import { writeAudit } from '@/lib/audit/write';
import { getSourceIp } from '@/lib/audit/context';

const logger = new Logger({ service: 'recover-stalled' });

/**
 * Đồng bộ với reaper tự động: dùng RUNNING_STALL_MS (đã cưỡng chế ≥ deadline 2h qua env),
 * để endpoint thủ công / K8s CronJob KHÔNG BAO GIỜ giết oan job dài hợp lệ (vd file ~150 trang ~1h).
 * Trước đây default 15 phút → nguy cơ đánh FAILED job đang chạy đúng.
 */
const STALL_THRESHOLD_MS = RUNNING_STALL_MS;

/**
 * Fail-closed internal guard. Unlike the previous `if (secret && ...)` check,
 * this REQUIRES INTERNAL_API_SECRET to be configured AND matched. If the secret
 * is not provisioned, the endpoint refuses (503) instead of allowing open access.
 * Returns a NextResponse to short-circuit, or null when the caller is authorized.
 */
function guardInternalRequest(req: NextRequest): NextResponse | null {
  const internalSecret = process.env.INTERNAL_API_SECRET;
  if (!internalSecret) {
    logger.error('[recover-stalled] INTERNAL_API_SECRET is not configured — refusing request (fail-closed).');
    return NextResponse.json(
      { error: 'Internal endpoint is not configured' },
      { status: 503 },
    );
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${internalSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const denied = guardInternalRequest(req);
  if (denied) return denied;

  const stalledOps = await recoverStalledOperations(STALL_THRESHOLD_MS);

  if (stalledOps.length === 0) {
    logger.info('[recover-stalled] No stalled operations found.');
    return NextResponse.json({ recovered: 0, operations: [] });
  }

  logger.warn(`[recover-stalled] Found ${stalledOps.length} stalled operation(s) — marking FAILED.`);

  const ids = stalledOps.map((op) => op.id);
  logger.info(`[recover-stalled] Recovered ${ids.length} stalled operation(s).`, { ids });

  await writeAudit({
    entityType: 'OPERATION',
    action: 'RECOVER_STALLED',
    outcome: 'SUCCESS',
    detail: JSON.stringify({ recovered: ids.length, ids }),
    actorRole: 'INTERNAL',
    sourceIp: getSourceIp(req),
  });

  return NextResponse.json({
    recovered: ids.length,
    operations: stalledOps.map((op) => ({
      id: op.id,
      endpointSlug: op.endpointSlug,
      updatedAt: op.updatedAt,
    })),
  });
}

// GET: status check — how many operations are currently stalled
export async function GET(req: NextRequest) {
  const denied = guardInternalRequest(req);
  if (denied) return denied;

  const thresholdDate = new Date(Date.now() - STALL_THRESHOLD_MS);
  const [{ count }] = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(operations).where(
    and(eq(operations.state, 'RUNNING'), eq(operations.done, false), lt(operations.updatedAt, thresholdDate))
  );
  return NextResponse.json({ stalled: count, thresholdMs: STALL_THRESHOLD_MS });
}
