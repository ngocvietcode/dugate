// app/api/internal/operations/stuck/route.ts
// GET /api/internal/operations/stuck — detect "stuck" operations for the Ops alert banner.
// A stuck op = not done, still RUNNING/PENDING, with no DB write (updatedAt) for longer
// than the configured threshold. There is no heartbeat field in the schema, so this is a
// derived heuristic ("nghi treo"), not a definitive flag. Read-only.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations, apiKeys } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { getStuckThresholds } from '@/lib/ops/config';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';
import { eq, and, isNull, or, sql, SQL } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const ITEMS_LIMIT = 20;

export async function GET(req: NextRequest) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  // 2. Thresholds (config, with optional query override for tuning)
  const cfg = await getStuckThresholds();
  const params = req.nextUrl.searchParams;
  const runningMin = clampMinutes(params.get('running_min'), cfg.runningMin);
  const pendingMin = clampMinutes(params.get('pending_min'), cfg.pendingMin);

  // 3. Base conditions (soft-delete + RBAC)
  // A stalled sub-step surfaces through its parent workflow; listing it again is noise.
  const conditions: SQL[] = [visibleInOperationsCondition(), eq(operations.done, false)];

  const profileIds = await getAssignedProfileIds('operations:read');
  if (profileIds !== null) {
    if (profileIds.length === 0) {
      conditions.push(isNull(operations.apiKeyId));
    } else {
      conditions.push(
        sql`(${operations.apiKeyId} IN (${sql.join(profileIds.map((id) => sql`${id}`), sql`, `)}) OR ${operations.apiKeyId} IS NULL)`,
      );
    }
  }

  // 4. Stuck predicate: RUNNING stale OR PENDING stale
  const stalePredicate = or(
    and(
      eq(operations.state, 'RUNNING'),
      sql`${operations.updatedAt} < now() - (${runningMin} * interval '1 minute')`,
    ),
    and(
      eq(operations.state, 'PENDING'),
      sql`${operations.updatedAt} < now() - (${pendingMin} * interval '1 minute')`,
    ),
  );
  if (stalePredicate) conditions.push(stalePredicate);

  const whereClause = and(...conditions);

  // 5. Count (global) + items (limited, longest-stuck first)
  const [[{ count }], rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(operations).where(whereClause),
    db
      .select({
        id: operations.id,
        state: operations.state,
        endpointSlug: operations.endpointSlug,
        profileName: apiKeys.name,
        clientReference: operations.clientReference,
        correlationId: operations.correlationId,
        createdAt: operations.createdAt,
        updatedAt: operations.updatedAt,
      })
      .from(operations)
      .leftJoin(apiKeys, eq(operations.apiKeyId, apiKeys.id))
      .where(whereClause)
      .orderBy(operations.updatedAt) // oldest updatedAt = stuck longest
      .limit(ITEMS_LIMIT),
  ]);

  const now = Date.now();
  const items = rows.map((r) => ({
    id: r.id,
    state: r.state,
    endpointSlug: r.endpointSlug,
    profileName: r.profileName ?? null,
    clientReference: r.clientReference,
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    stuckMinutes: Math.max(0, Math.floor((now - r.updatedAt.getTime()) / 60_000)),
  }));

  return NextResponse.json({
    thresholds: { running_min: runningMin, pending_min: pendingMin },
    count,
    items,
  });
}

function clampMinutes(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100_000);
}
