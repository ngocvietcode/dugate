import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * @swagger
 * /api/v1/billing/usage:
 *   get:
 *     summary: Get token usage and cost breakdown for the authenticated API key
 *     tags:
 *       - Cost Management
 *     parameters:
 *       - name: start_date
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: end_date
 *         in: query
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Usage breakdown
 */
export async function GET(req: NextRequest) {
  const apiKeyId = req.headers.get('x-api-key-id');
  if (!apiKeyId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const startDateStr = searchParams.get('start_date');
  const endDateStr = searchParams.get('end_date');

  const startDate = startDateStr ? new Date(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = endDateStr ? new Date(endDateStr + 'T23:59:59Z') : new Date();

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 });
  }

  // Aggregate usage from completed operations in the date range
  const operations = await prisma.operation.findMany({
    where: {
      apiKeyId,
      state: 'SUCCEEDED',
      done: true,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      modelUsed: true,
      endpointSlug: true,
      totalInputTokens: true,
      totalOutputTokens: true,
      pagesProcessed: true,
      totalCostUsd: true,
    },
  });

  // Group by model
  const byModel: Record<string, {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    pages_processed: number;
    cost_usd: number;
  }> = {};

  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const op of operations) {
    const model = op.modelUsed ?? 'unknown';
    if (!byModel[model]) {
      byModel[model] = { model, prompt_tokens: 0, completion_tokens: 0, pages_processed: 0, cost_usd: 0 };
    }
    byModel[model].prompt_tokens += op.totalInputTokens;
    byModel[model].completion_tokens += op.totalOutputTokens;
    byModel[model].pages_processed += op.pagesProcessed;
    byModel[model].cost_usd += op.totalCostUsd;
    totalCostUsd += op.totalCostUsd;
    totalInputTokens += op.totalInputTokens;
    totalOutputTokens += op.totalOutputTokens;
  }

  return NextResponse.json({
    object: 'billing_usage',
    start_date: startDate.toISOString().split('T')[0],
    end_date: endDate.toISOString().split('T')[0],
    total_cost_usd: totalCostUsd,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_operations: operations.length,
    usage: Object.values(byModel),
  });
}
