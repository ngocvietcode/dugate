// GET /api/internal/operations/stats/throughput?bucket=minute|hour&summary_only=true
// Requests received per bucket/profile. This is throughput, not concurrency.

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { apiKeys, operations } from '@/lib/db/schema';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';

export const dynamic = 'force-dynamic';

const LEGACY_MAX_BUCKETS = 400;
const MINUTE_MAX_HOURS = 24;
const SUMMARY_MAX_HOURS = 31 * 24;
type Bucket = 'minute' | 'hour';

export async function GET(req: NextRequest) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  const params = req.nextUrl.searchParams;
  const requestedBucket = params.get('bucket');
  if (requestedBucket && requestedBucket !== 'minute' && requestedBucket !== 'hour') {
    return NextResponse.json({ error: 'bucket phải là minute hoặc hour' }, { status: 400 });
  }
  const filterEndpoint = params.get('endpoint') || null;
  const filterProfile = params.get('profile') || null;
  const startDate = params.get('start_date') || null;
  const endDate = params.get('end_date') || null;
  const summaryOnly = params.get('summary_only') === 'true';

  const now = new Date();
  const parsedStart = startDate ? new Date(startDate) : new Date(now.getTime() - 60 * 60 * 1000);
  const parsedEnd = endDate ? new Date(endDate) : now;
  if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime()) || parsedEnd < parsedStart) {
    return NextResponse.json({ error: 'Khoảng thời gian không hợp lệ' }, { status: 400 });
  }

  const spanHours = Math.max(1 / 60, (parsedEnd.getTime() - parsedStart.getTime()) / 3_600_000);
  const bucket: Bucket = requestedBucket as Bucket | null
    ?? (spanHours <= MINUTE_MAX_HOURS ? 'minute' : 'hour');
  if (bucket === 'minute' && spanHours > MINUTE_MAX_HOURS) {
    return NextResponse.json(
      { error: 'Chế độ theo phút chỉ hỗ trợ khoảng thời gian tối đa 24 giờ.' },
      { status: 400 },
    );
  }

  const bucketMs = bucket === 'minute' ? 60_000 : 3_600_000;
  const maxCoverageMs = summaryOnly
    ? (bucket === 'minute' ? MINUTE_MAX_HOURS : SUMMARY_MAX_HOURS) * 3_600_000
    : (LEGACY_MAX_BUCKETS - 1) * bucketMs;
  const earliestCovered = new Date(parsedEnd.getTime() - maxCoverageMs);
  const effectiveStart = parsedStart < earliestCovered ? earliestCovered : parsedStart;
  const truncated = effectiveStart.getTime() > parsedStart.getTime();

  const conditions: SQL[] = [
    // Hidden workflow sub-steps are internal traffic, not requests received.
    visibleInOperationsCondition(),
    gte(operations.createdAt, effectiveStart),
    lte(operations.createdAt, parsedEnd),
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
  if (filterProfile === '__none__') conditions.push(isNull(operations.apiKeyId));
  else if (filterProfile) conditions.push(eq(operations.apiKeyId, filterProfile));

  const whereClause = and(...conditions);
  const bucketExpr = bucket === 'minute'
    ? sql`date_trunc('minute', ${operations.createdAt})`
    : sql`date_trunc('hour', ${operations.createdAt})`;
  const bucketsCount = countElapsedBuckets(effectiveStart, parsedEnd, bucketMs);

  if (summaryOnly) {
    // Aggregate twice in PostgreSQL so the response is O(profile count), not
    // O(bucket count × profile count). Zero buckets are represented by the
    // elapsed-time denominator rather than generate_series rows.
    const bucketed = db
      .select({
        apiKeyId: operations.apiKeyId,
        bucket: bucketExpr.as('throughput_bucket'),
        cnt: sql<number>`count(*)`.mapWith(Number).as('throughput_count'),
      })
      .from(operations)
      .where(whereClause)
      .groupBy(operations.apiKeyId, bucketExpr)
      .as('bucketed_throughput');

    const rows = await db
      .select({
        key: sql<string>`coalesce(${bucketed.apiKeyId}, '__none__')`,
        name: sql<string>`coalesce(${apiKeys.name}, 'Không có profile')`,
        total: sql<number>`sum(${bucketed.cnt})`.mapWith(Number),
        peak: sql<number>`max(${bucketed.cnt})`.mapWith(Number),
      })
      .from(bucketed)
      .leftJoin(apiKeys, eq(bucketed.apiKeyId, apiKeys.id))
      .groupBy(bucketed.apiKeyId, apiKeys.name)
      .orderBy(sql`max(${bucketed.cnt}) desc`);

    return NextResponse.json({
      bucket,
      points: [],
      perProfile: rows.map((row) => ({
        ...row,
        avg: Math.round((row.total / bucketsCount) * 100) / 100,
      })),
      truncated,
      coverageStart: effectiveStart.toISOString(),
    });
  }

  // Backward-compatible detail response for any existing internal consumer.
  const perBucketProfile = await db
    .select({
      key: sql<string>`coalesce(${operations.apiKeyId}, '__none__')`,
      name: sql<string>`coalesce(${apiKeys.name}, 'Không có profile')`,
      ts: sql<string>`${bucketExpr}`,
      cnt: sql<number>`count(*)`.mapWith(Number),
    })
    .from(operations)
    .leftJoin(apiKeys, eq(operations.apiKeyId, apiKeys.id))
    .where(whereClause)
    .groupBy(sql`coalesce(${operations.apiKeyId}, '__none__')`, apiKeys.name, bucketExpr);

  const pointMap = new Map<string, number>();
  const profiles = new Map<string, { key: string; name: string; total: number; peak: number }>();
  for (const row of perBucketProfile) {
    const rawTimestamp: unknown = row.ts;
    const timestamp = rawTimestamp instanceof Date
      ? rawTimestamp.toISOString()
      : new Date(String(rawTimestamp)).toISOString();
    pointMap.set(timestamp, (pointMap.get(timestamp) ?? 0) + row.cnt);
    const current = profiles.get(row.key) ?? {
      key: row.key, name: row.name, total: 0, peak: 0,
    };
    current.total += row.cnt;
    current.peak = Math.max(current.peak, row.cnt);
    profiles.set(row.key, current);
  }

  const perProfile = Array.from(profiles.values())
    .map((profile) => ({
      ...profile,
      avg: Math.round((profile.total / bucketsCount) * 100) / 100,
    }))
    .sort((a, b) => b.peak - a.peak);
  const points = Array.from(pointMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ts, total]) => ({ ts, total }));

  return NextResponse.json({
    bucket,
    points,
    perProfile,
    truncated,
    coverageStart: effectiveStart.toISOString(),
  });
}

function countElapsedBuckets(start: Date, end: Date, bucketMs: number): number {
  const first = Math.floor(start.getTime() / bucketMs);
  const last = Math.floor(end.getTime() / bucketMs);
  return Math.max(1, last - first + 1);
}
