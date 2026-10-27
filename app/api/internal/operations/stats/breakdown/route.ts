// app/api/internal/operations/stats/breakdown/route.ts
// GET /api/internal/operations/stats/breakdown?group_by=profile|endpoint
// Aggregate operations grouped by profile (apiKeyId) or endpoint (endpointSlug),
// returning counts + tokens + cost per group. Powers the "Chi phí & Profile" tab
// and the Overview top-lists. Same filters/RBAC/date-defaults as /stats. Read-only.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations, apiKeys } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { formatDecimal } from '@/app/operations/lib/format';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';
import { eq, and, isNull, sql, SQL, gte, lte } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  // 2. Params
  const params = req.nextUrl.searchParams;
  const groupBy = params.get('group_by') === 'endpoint' ? 'endpoint' : 'profile';
  const filterEndpoint = params.get('endpoint') || null;
  const filterProfile = params.get('profile') || null;
  const startDate = params.get('start_date') || null;
  const endDate = params.get('end_date') || null;

  // 3. Base conditions (soft-delete + RBAC)
  // Hidden workflow sub-steps are excluded: the parent already rolls their usage up.
  const conditions: SQL[] = [visibleInOperationsCondition()];

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

  // 4. Filters
  if (filterEndpoint) conditions.push(eq(operations.endpointSlug, filterEndpoint));
  if (filterProfile === '__none__') {
    conditions.push(isNull(operations.apiKeyId));
  } else if (filterProfile) {
    conditions.push(eq(operations.apiKeyId, filterProfile));
  }

  // Date range — same default-to-today behavior as /stats for consistency
  if (startDate) {
    const start = new Date(startDate);
    if (!isNaN(start.getTime())) conditions.push(gte(operations.createdAt, start));
  } else {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    conditions.push(gte(operations.createdAt, todayStart));
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!isNaN(end.getTime())) {
      if (endDate.length <= 10) end.setHours(23, 59, 59, 999);
      conditions.push(lte(operations.createdAt, end));
    }
  }

  const whereClause = and(...conditions);

  // 5. Aggregate — shared metric columns
  const metricCols = {
    total: sql<number>`count(*)`.mapWith(Number),
    succeeded: sql<number>`count(*) filter (where ${operations.state} = 'SUCCEEDED')`.mapWith(Number),
    failed: sql<number>`count(*) filter (where ${operations.state} = 'FAILED')`.mapWith(Number),
    running: sql<number>`count(*) filter (where ${operations.state} = 'RUNNING')`.mapWith(Number),
    tokensIn: sql<number>`coalesce(sum(${operations.totalInputTokens}), 0)`.mapWith(Number),
    tokensOut: sql<number>`coalesce(sum(${operations.totalOutputTokens}), 0)`.mapWith(Number),
    cost: sql<number>`round(coalesce(sum(${operations.totalCostUsd}), 0)::numeric, 10)`.mapWith(Number),
    unpricedCount: sql<number>`count(*) filter (where coalesce(${operations.usageBreakdown}, '') like '%"cost_source":"unpriced"%')`.mapWith(Number),
  };

  type QueryRow = {
    key: string; name: string;
    total: number; succeeded: number; failed: number; running: number;
    tokensIn: number; tokensOut: number; cost: number; unpricedCount: number;
  };
  let rows: QueryRow[];

  if (groupBy === 'endpoint') {
    rows = await db
      .select({
        key: sql<string>`coalesce(${operations.endpointSlug}, '__none__')`,
        name: sql<string>`coalesce(${operations.endpointSlug}, '(không xác định)')`,
        ...metricCols,
      })
      .from(operations)
      .where(whereClause)
      .groupBy(operations.endpointSlug)
      .orderBy(sql`count(*) desc`);
  } else {
    rows = await db
      .select({
        key: sql<string>`coalesce(${operations.apiKeyId}, '__none__')`,
        name: sql<string>`coalesce(${apiKeys.name}, 'Không có profile')`,
        ...metricCols,
      })
      .from(operations)
      .leftJoin(apiKeys, eq(operations.apiKeyId, apiKeys.id))
      .where(whereClause)
      .groupBy(operations.apiKeyId, apiKeys.name)
      .orderBy(sql`count(*) desc`);
  }

  const outRows = rows.map((r) => ({
    key: r.key,
    name: r.name,
    total: r.total,
    succeeded: r.succeeded,
    failed: r.failed,
    running: r.running,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    cost: r.cost,                       // canonicalized to 10 decimal places in SQL
    unpricedCount: (r as { unpricedCount: number }).unpricedCount ?? 0,
  }));

  // CSV export of the aggregated table (Req 3). Canonical fixed-notation costs.
  if (params.get('format') === 'csv') {
    const headers = ['name', 'total', 'succeeded', 'failed', 'running', 'inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'unpricedCount'];
    const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const num = (v: number) => formatDecimal(v);
    const lines = [headers.join(',')];
    for (const r of outRows) {
      lines.push([
        esc(r.name),
        String(r.total), String(r.succeeded), String(r.failed), String(r.running),
        String(r.tokensIn), String(r.tokensOut), String(r.tokensIn + r.tokensOut),
        num(r.cost), String(r.unpricedCount),
      ].join(','));
    }
    const csv = '\uFEFF' + lines.join('\n') + '\n';
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="breakdown-${groupBy}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json({ group_by: groupBy, rows: outRows });
}
