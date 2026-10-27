// app/api/internal/operations/stats/timeseries/route.ts
// GET /api/internal/operations/stats/timeseries?bucket=hour|day
// Time-bucketed counts (total / succeeded / failed) for the Overview trend chart.
// Auto-picks bucket when not given and caps the number of buckets. Read-only.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';
import { eq, and, isNull, sql, SQL, gte, lte } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const MAX_BUCKETS = 300;

export async function GET(req: NextRequest) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  // 2. Params
  const params = req.nextUrl.searchParams;
  const filterEndpoint = params.get('endpoint') || null;
  const filterProfile = params.get('profile') || null;
  const startDate = params.get('start_date') || null;
  const endDate = params.get('end_date') || null;

  // Resolve date window (for bucket auto-selection)
  const now = new Date();
  let start: Date;
  if (startDate) {
    const s = new Date(startDate);
    start = isNaN(s.getTime()) ? new Date(now.getTime() - 7 * 86_400_000) : s;
  } else {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    start = todayStart;
  }
  let end = now;
  if (endDate) {
    const e = new Date(endDate);
    if (!isNaN(e.getTime())) {
      if (endDate.length <= 10) e.setHours(23, 59, 59, 999);
      end = e;
    }
  }

  // Auto bucket: <= 2 days → hour, else day. Explicit param overrides but is
  // downgraded to 'day' if it would exceed MAX_BUCKETS.
  const spanHours = Math.max(1, (end.getTime() - start.getTime()) / 3_600_000);
  let bucket: 'hour' | 'day' = params.get('bucket') === 'hour' || params.get('bucket') === 'day'
    ? (params.get('bucket') as 'hour' | 'day')
    : spanHours <= 48 ? 'hour' : 'day';
  if (bucket === 'hour' && spanHours > MAX_BUCKETS) bucket = 'day';

  // 3. Conditions. Aggregate only the newest MAX_BUCKETS so the "Tất cả"
  // preset cannot force PostgreSQL to group decades of data. KPI totals still use
  // the full requested range; this cap applies only to chart coverage.
  const bucketMs = bucket === 'hour' ? 3_600_000 : 86_400_000;
  const earliestCovered = new Date(end.getTime() - (MAX_BUCKETS - 1) * bucketMs);
  const effectiveStart = start < earliestCovered ? earliestCovered : start;
  const truncated = effectiveStart.getTime() > start.getTime();
  const conditions: SQL[] = [
    // Hidden workflow sub-steps are excluded: the parent already rolls their usage up.
    visibleInOperationsCondition(),
    gte(operations.createdAt, effectiveStart),
    lte(operations.createdAt, end),
  ];

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
  if (filterEndpoint) conditions.push(eq(operations.endpointSlug, filterEndpoint));
  if (filterProfile === '__none__') {
    conditions.push(isNull(operations.apiKeyId));
  } else if (filterProfile) {
    conditions.push(eq(operations.apiKeyId, filterProfile));
  }

  const whereClause = and(...conditions);

  // Use fixed SQL literals selected from the validated union. Binding the date_trunc
  // unit as a parameter can produce invalid/ambiguous PostgreSQL SQL at runtime.
  const bucketExpr = bucket === 'hour'
    ? sql`date_trunc('hour', ${operations.createdAt})`
    : sql`date_trunc('day', ${operations.createdAt})`;
  const rows = await db
    .select({
      ts: sql<string>`${bucketExpr}`,
      total: sql<number>`count(*)`.mapWith(Number),
      succeeded: sql<number>`count(*) filter (where ${operations.state} = 'SUCCEEDED')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${operations.state} = 'FAILED')`.mapWith(Number),
      cost: sql<number>`round(coalesce(sum(${operations.totalCostUsd}), 0)::numeric, 10)`.mapWith(Number),
      tokensIn: sql<number>`coalesce(sum(${operations.totalInputTokens}), 0)`.mapWith(Number),
      tokensOut: sql<number>`coalesce(sum(${operations.totalOutputTokens}), 0)`.mapWith(Number),
    })
    .from(operations)
    .where(whereClause)
    .groupBy(bucketExpr)
    .orderBy(sql`${bucketExpr} desc`)
    .limit(MAX_BUCKETS);

  rows.reverse();

  return NextResponse.json({
    bucket,
    truncated,
    coverageStart: effectiveStart.toISOString(),
    points: rows.map((r) => ({
      ts: typeof r.ts === 'string' ? r.ts : new Date(r.ts as unknown as string).toISOString(),
      total: r.total,
      succeeded: r.succeeded,
      failed: r.failed,
      cost: r.cost,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
    })),
  });
}
