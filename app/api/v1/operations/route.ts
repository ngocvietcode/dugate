// app/api/v1/operations/route.ts
// GET /api/v1/operations — List operations with cursor pagination

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * @swagger
 * /api/v1/operations:
 *   get:
 *     summary: List operations (history)
 *     tags: [Operations]
 *     parameters:
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: page_token
 *         schema: { type: string }
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of operations
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const pageSize = Math.min(parseInt(params.get('page_size') ?? '20'), 100);
  const pageToken = params.get('page_token');
  const filter = params.get('filter');

  const apiKeyId = req.headers.get('x-api-key-id');
  
  // Build where clause
  const where: Record<string, unknown> = {
    deletedAt: null,
    ...(apiKeyId ? { apiKeyId } : {})
  };

  if (filter) {
    const parts = filter.split(',');
    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key === 'state') where.state = val;
      if (key === 'processor') {
        where.pipelineJson = { contains: val };
      }
    }
  }

  // Cursor-based pagination
  const cursor = pageToken ? { id: pageToken } : undefined;

  // Exclude heavy JSON blobs from list response — clients fetch individual operations for details
  const VALID_STATES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'PENDING'];
  if (where.state && !VALID_STATES.includes(where.state as string)) {
    return NextResponse.json({ error: `Invalid state filter. Must be one of: ${VALID_STATES.join(', ')}` }, { status: 400 });
  }

  const operations = await prisma.operation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: pageSize + 1, // +1 to check if next page exists
    ...(cursor ? { cursor, skip: 1 } : {}),
    select: {
      id: true,
      done: true,
      state: true,
      endpointSlug: true,
      outputFormat: true,
      currentStep: true,
      progressPercent: true,
      progressMessage: true,
      errorCode: true,
      errorMessage: true,
      failedAtStep: true,
      totalInputTokens: true,
      totalOutputTokens: true,
      totalCostUsd: true,
      pagesProcessed: true,
      modelUsed: true,
      createdAt: true,
      updatedAt: true,
      webhookUrl: true,
      webhookSentAt: true,
      apiKeyId: true,
      createdByUserId: true,
      idempotencyKey: true,
      // Excluded from list: pipelineJson, stepsResultJson, extractedData, filesJson, usageBreakdown, outputContent
    },
  });

  const hasMore = operations.length > pageSize;
  const items = hasMore ? operations.slice(0, pageSize) : operations;
  const nextPageToken = hasMore ? items[items.length - 1].id : undefined;

  // Return lightweight list items — full details available via GET /operations/{id}
  const formatted = items.map((op) => ({
    name: `operations/${op.id}`,
    done: op.done,
    metadata: {
      state: op.state,
      endpoint_slug: op.endpointSlug,
      current_step: op.currentStep,
      progress_percent: op.progressPercent,
      progress_message: op.progressMessage,
      create_time: op.createdAt,
      update_time: op.updatedAt,
    },
    ...(op.done && op.state === 'FAILED' ? {
      error: { code: op.errorCode, message: op.errorMessage, failed_step: op.failedAtStep },
    } : {}),
    ...(op.done && op.state === 'SUCCEEDED' ? {
      result: {
        usage: {
          input_tokens: op.totalInputTokens,
          output_tokens: op.totalOutputTokens,
          cost_usd: op.totalCostUsd,
        },
      },
    } : {}),
  }));

  return NextResponse.json({
    operations: formatted,
    next_page_token: nextPageToken ?? null,
  });
}
