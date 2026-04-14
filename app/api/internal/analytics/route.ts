import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { Logger } from '@/lib/logger';
import { canMutate } from '@/lib/rbac';

const logger = new Logger({ service: 'analytics-api' });

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canMutate(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized or Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const timeRange = searchParams.get('timeRange') || '24h'; // 24h, 7d, 30d
    const resolution = searchParams.get('resolution') || 'hour'; // hour, day

    const startDate = new Date();
    if (timeRange === '24h') startDate.setHours(startDate.getHours() - 24);
    else if (timeRange === '7d') startDate.setDate(startDate.getDate() - 7);
    else if (timeRange === '30d') startDate.setDate(startDate.getDate() - 30);

    // 1. Time Series Data
    const timeSeriesRaw = await prisma.$queryRaw<Array<{
      time_bucket: Date;
      state: string;
      request_count: bigint;
      total_tokens: bigint;
      total_cost: number;
    }>>(
      resolution === 'hour'
        ? Prisma.sql`
            SELECT 
              DATE_TRUNC('hour', "createdAt") as time_bucket,
              state,
              COUNT(id) as request_count,
              SUM("totalInputTokens" + "totalOutputTokens") as total_tokens,
              SUM("totalCostUsd") as total_cost
            FROM "Operation"
            WHERE "createdAt" >= ${startDate}
            GROUP BY 1, 2
            ORDER BY 1 ASC
          `
        : Prisma.sql`
            SELECT 
              DATE_TRUNC('day', "createdAt") as time_bucket,
              state,
              COUNT(id) as request_count,
              SUM("totalInputTokens" + "totalOutputTokens") as total_tokens,
              SUM("totalCostUsd") as total_cost
            FROM "Operation"
            WHERE "createdAt" >= ${startDate}
            GROUP BY 1, 2
            ORDER BY 1 ASC
          `
    );

    // 2. Summary
    const summaryRaw = await prisma.$queryRaw<Array<{
      total_requests: bigint;
      success_count: bigint;
      total_tokens: bigint;
      total_cost: number;
    }>>`
      SELECT
        COUNT(id) as total_requests,
        SUM(CASE WHEN state = 'SUCCEEDED' THEN 1 ELSE 0 END) as success_count,
        SUM("totalInputTokens" + "totalOutputTokens") as total_tokens,
        SUM("totalCostUsd") as total_cost
      FROM "Operation"
      WHERE "createdAt" >= ${startDate}
    `;

    // 3. Breakdown by Profile
    const profileBreakdown = await prisma.$queryRaw<Array<{
      api_key_id: string;
      name: string;
      count: bigint;
    }>>`
      SELECT 
        COALESCE(o."apiKeyId", 'internal') as api_key_id,
        COALESCE(k.name, 'Internal App') as name,
        COUNT(o.id) as count
      FROM "Operation" o
      LEFT JOIN "ApiKey" k ON o."apiKeyId" = k.id
      WHERE o."createdAt" >= ${startDate}
      GROUP BY 1, 2
      ORDER BY count DESC
    `;

    // 4. Breakdown by Pipeline/Connector
    const pipelineBreakdown = await prisma.$queryRaw<Array<{
      endpoint_slug: string;
      count: bigint;
    }>>`
      SELECT 
        COALESCE("endpointSlug", 'unknown') as endpoint_slug,
        COUNT(id) as count
      FROM "Operation"
      WHERE "createdAt" >= ${startDate}
      GROUP BY 1
      ORDER BY count DESC
    `;

    // Server-side aggregate states for stacked bar charts
    const timeMap = new Map<string, any>();
    for (const t of timeSeriesRaw) {
      const timeStr = t.time_bucket.toISOString();
      if (!timeMap.has(timeStr)) {
        timeMap.set(timeStr, { 
          time: timeStr, 
          requests: 0, 
          tokens: 0, 
          cost: 0,
          successRequests: 0,
          failRequests: 0,
          pendingRequests: 0
        });
      }
      const entry = timeMap.get(timeStr)!;
      const count = Number(t.request_count);
      entry.requests += count;
      entry.tokens += Number(t.total_tokens || 0);
      entry.cost += Number(t.total_cost || 0);

      if (t.state === 'SUCCEEDED') entry.successRequests += count;
      else if (t.state === 'FAILED') entry.failRequests += count;
      else entry.pendingRequests += count;
    }
    const safeTimeSeries = Array.from(timeMap.values()).sort((a, b) => a.time.localeCompare(b.time));

    const safeSummary = summaryRaw[0] ? {
      totalRequests: Number(summaryRaw[0].total_requests),
      successRate: Number(summaryRaw[0].total_requests) > 0 
        ? (Number(summaryRaw[0].success_count) / Number(summaryRaw[0].total_requests)) * 100 
        : 0,
      totalTokens: Number(summaryRaw[0].total_tokens || 0),
      totalCost: Number(summaryRaw[0].total_cost || 0)
    } : { totalRequests: 0, successRate: 0, totalTokens: 0, totalCost: 0 };

    return NextResponse.json({
      success: true,
      summary: safeSummary,
      timeSeries: safeTimeSeries,
      profileBreakdown: profileBreakdown.map(p => ({ id: p.api_key_id, name: p.name, value: Number(p.count) })),
      pipelineBreakdown: pipelineBreakdown.map(p => ({ name: p.endpoint_slug, value: Number(p.count) }))
    });

  } catch (error: any) {
    logger.error('Failed to fetch analytics', {}, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
