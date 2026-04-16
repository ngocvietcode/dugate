// app/api/v1/operations/route.ts
// GET /api/v1/operations — List operations with cursor pagination

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq, isNull, ilike, and, desc, lt, SQL } from 'drizzle-orm';

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
  
  const conditions: SQL[] = [isNull(operations.deletedAt)];
  if (apiKeyId) conditions.push(eq(operations.apiKeyId, apiKeyId));

  const VALID_STATES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'PENDING'];

  if (filter) {
    const parts = filter.split(',');
    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key === 'state') {
        if (!VALID_STATES.includes(val)) {
          return NextResponse.json({ error: `Invalid state filter. Must be one of: ${VALID_STATES.join(', ')}` }, { status: 400 });
        }
        conditions.push(eq(operations.state, val));
      }
      if (key === 'processor') {
        conditions.push(ilike(operations.pipelineJson, `%${val}%`));
      }
    }
  }

  // Cursor-based pagination
  if (pageToken) {
    const [cursorItem] = await db.select({ createdAt: operations.createdAt }).from(operations).where(eq(operations.id, pageToken)).limit(1);
    if (cursorItem) {
      conditions.push(lt(operations.createdAt, cursorItem.createdAt));
    }
  }

  const opsList = await db.select({
      id: operations.id,
      done: operations.done,
      state: operations.state,
      endpointSlug: operations.endpointSlug,
      outputFormat: operations.outputFormat,
      currentStep: operations.currentStep,
      progressPercent: operations.progressPercent,
      progressMessage: operations.progressMessage,
      errorCode: operations.errorCode,
      errorMessage: operations.errorMessage,
      failedAtStep: operations.failedAtStep,
      totalInputTokens: operations.totalInputTokens,
      totalOutputTokens: operations.totalOutputTokens,
      totalCostUsd: operations.totalCostUsd,
      pagesProcessed: operations.pagesProcessed,
      modelUsed: operations.modelUsed,
      createdAt: operations.createdAt,
      updatedAt: operations.updatedAt,
      webhookUrl: operations.webhookUrl,
      webhookSentAt: operations.webhookSentAt,
      apiKeyId: operations.apiKeyId,
      createdByUserId: operations.createdByUserId,
      idempotencyKey: operations.idempotencyKey,
  })
  .from(operations)
  .where(and(...conditions))
  .orderBy(desc(operations.createdAt))
  .limit(pageSize + 1);

  const hasMore = opsList.length > pageSize;
  const items = hasMore ? opsList.slice(0, pageSize) : opsList;
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
