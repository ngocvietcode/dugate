// app/api/internal/operations/stats/route.ts
// GET /api/internal/operations/stats — Aggregate statistics for Operations Dashboard
// Returns counts by state, total cost, avg duration, success rate, top errors.
// Responds to the same filters as the list endpoint (profile, endpoint, date range).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';
import { eq, and, isNull, sql, SQL, gte, lte } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  // 2. Parse filters
  const params = req.nextUrl.searchParams;
  const filterEndpoint = params.get('endpoint') || null;
  const filterProfile = params.get('profile') || null;
  const startDate = params.get('start_date') || null;
  const endDate = params.get('end_date') || null;

  // 3. Base conditions (RBAC + soft-delete)
  // Hidden workflow sub-steps are excluded: the parent already rolls their usage up.
  const conditions: SQL[] = [visibleInOperationsCondition()];

  const profileIds = await getAssignedProfileIds('operations:read');
  if (profileIds !== null) {
    if (profileIds.length === 0) {
      conditions.push(isNull(operations.apiKeyId));
    } else {
      conditions.push(
        sql`(${operations.apiKeyId} IN (${sql.join(profileIds.map(id => sql`${id}`), sql`, `)}) OR ${operations.apiKeyId} IS NULL)`,
      );
    }
  }

  // 4. Apply filters
  if (filterEndpoint) {
    conditions.push(eq(operations.endpointSlug, filterEndpoint));
  }
  if (filterProfile === '__none__') {
    conditions.push(isNull(operations.apiKeyId));
  } else if (filterProfile) {
    conditions.push(eq(operations.apiKeyId, filterProfile));
  }

  // Date range — default to "today" if no dates provided
  if (startDate) {
    const start = new Date(startDate);
    if (!isNaN(start.getTime())) {
      conditions.push(gte(operations.createdAt, start));
    }
  } else {
    // Default: start of today (UTC)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    conditions.push(gte(operations.createdAt, todayStart));
  }

  if (endDate) {
    const end = new Date(endDate);
    if (!isNaN(end.getTime())) {
      if (endDate.length <= 10) {
        end.setHours(23, 59, 59, 999);
      }
      conditions.push(lte(operations.createdAt, end));
    }
  }

  const whereClause = and(...conditions);

  // 5. Aggregate query — single pass
  const [stats] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      succeeded: sql<number>`count(*) filter (where ${operations.state} = 'SUCCEEDED')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${operations.state} = 'FAILED')`.mapWith(Number),
      running: sql<number>`count(*) filter (where ${operations.state} = 'RUNNING')`.mapWith(Number),
      waiting: sql<number>`count(*) filter (where ${operations.state} = 'WAITING_USER_INPUT')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${operations.state} = 'PENDING')`.mapWith(Number),
      totalCostUsd: sql<number>`round(coalesce(sum(${operations.totalCostUsd}), 0)::numeric, 10)`.mapWith(Number),
      avgDurationSec: sql<number>`coalesce(avg(extract(epoch from (coalesce(${operations.completedAt}, ${operations.updatedAt}) - ${operations.createdAt}))) filter (where ${operations.done} = true), 0)`.mapWith(Number),
      // Requests explicitly marked unpriced (model price not configured). Uses the
      // stored cost_source marker → no false positives for genuinely-free ($0) calls.
      unpriced: sql<number>`count(*) filter (where coalesce(${operations.usageBreakdown}, '') like '%"cost_source":"unpriced"%')`.mapWith(Number),
    })
    .from(operations)
    .where(whereClause);

  // 6. Success rate calculation
  const completedTotal = stats.succeeded + stats.failed;
  const successRate = completedTotal > 0
    ? Math.round((stats.succeeded / completedTotal) * 1000) / 10
    : 0;

  // 7. Top errors (grouped by errorCode, top 5)
  const topErrors = await db
    .select({
      code: operations.errorCode,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(operations)
    .where(and(whereClause, eq(operations.state, 'FAILED'), sql`${operations.errorCode} IS NOT NULL`))
    .groupBy(operations.errorCode)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  return NextResponse.json({
    total: stats.total,
    succeeded: stats.succeeded,
    failed: stats.failed,
    running: stats.running,
    waiting: stats.waiting,
    pending: stats.pending,
    total_cost_usd: stats.totalCostUsd,        // canonicalized to 10 decimal places in SQL
    avg_duration_sec: Math.round(stats.avgDurationSec * 10) / 10,
    success_rate: successRate,
    unpriced_count: stats.unpriced,
    top_errors: topErrors.map(e => ({ code: e.code ?? 'UNKNOWN', count: e.count })),
  });
}
