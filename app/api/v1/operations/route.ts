// app/api/v1/operations/route.ts
// GET /api/v1/operations — List operations with cursor pagination

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq, isNull, ilike, and, desc, lt, SQL } from 'drizzle-orm';
import { resolveCallerIdentity } from '@/lib/auth-resolve-key';
import { safeInputFileNames } from '@/lib/financial-report/client-helpers';

const VALID_STATES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'PENDING'];

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
 *       - in: query
 *         name: scope
 *         description: "mine requires a browser session and always restricts createdByUserId, including ADMIN users."
 *         schema: { type: string, enum: [mine] }
 *       - in: query
 *         name: endpoint_slug
 *         description: Exact endpoint slug filter.
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of operations
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const parsedPageSize = Number.parseInt(params.get('page_size') ?? '20', 10);
  const pageSize = Number.isFinite(parsedPageSize) ? Math.min(Math.max(parsedPageSize, 1), 100) : 20;
  const pageToken = params.get('page_token');
  const filter = params.get('filter');
  const scope = params.get('scope');
  const endpointSlug = params.get('endpoint_slug');

  if (scope && scope !== 'mine') {
    return NextResponse.json({ error: 'Invalid scope. Supported scope: mine.' }, { status: 400 });
  }

  const { apiKeyId, userId, userRole } = await resolveCallerIdentity(req);

  // Require at least one identity (API key or authenticated session).
  if (!apiKeyId && !userId) {
    return NextResponse.json({ error: 'Authentication required. Provide x-api-key header or login via browser.' }, { status: 401 });
  }

  // `mine` is deliberately a session-only contract. API-key authentication takes precedence in
  // resolveCallerIdentity, so accepting it here would risk turning a creator-owned view into a key view.
  if (scope === 'mine' && (!userId || apiKeyId)) {
    return NextResponse.json({ error: 'scope=mine requires an authenticated browser session without x-api-key.' }, { status: 401 });
  }

  const conditions: SQL[] = [isNull(operations.deletedAt)];

  if (scope === 'mine') {
    // Deliberately applies to every session role, including ADMIN.
    conditions.push(eq(operations.createdByUserId, userId!));
  } else if (apiKeyId) {
    // API key callers only see operations owned by that profile.
    conditions.push(eq(operations.apiKeyId, apiKeyId));
  } else if (userId && userRole !== 'ADMIN') {
    // Non-admin browser users only see operations they created.
    conditions.push(eq(operations.createdByUserId, userId));
  }
  // ADMIN browser users without scope=mine retain the existing all-operations behavior.

  if (endpointSlug) {
    // Exact, parameterized match only; never reuse the free-text pipeline filter for endpoint ownership views.
    conditions.push(eq(operations.endpointSlug, endpointSlug));
  }

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

  // `filesJson` is selected only to derive safe display names below. Raw path/URL/configuration fields never leave this route.
  const opsList = await db.select({
    id: operations.id,
    done: operations.done,
    state: operations.state,
    endpointSlug: operations.endpointSlug,
    currentStep: operations.currentStep,
    progressPercent: operations.progressPercent,
    progressMessage: operations.progressMessage,
    errorCode: operations.errorCode,
    errorMessage: operations.errorMessage,
    failedAtStep: operations.failedAtStep,
    totalInputTokens: operations.totalInputTokens,
    totalOutputTokens: operations.totalOutputTokens,
    totalCostUsd: operations.totalCostUsd,
    createdAt: operations.createdAt,
    updatedAt: operations.updatedAt,
    filesJson: operations.filesJson,
  })
    .from(operations)
    .where(and(...conditions))
    .orderBy(desc(operations.createdAt))
    .limit(pageSize + 1);

  const hasMore = opsList.length > pageSize;
  const items = hasMore ? opsList.slice(0, pageSize) : opsList;
  const nextPageToken = hasMore ? items[items.length - 1].id : undefined;

  // Return lightweight list items — full authorized details remain available via GET /operations/{id}.
  const formatted = items.map((op) => ({
    name: `operations/${op.id}`,
    done: op.done,
    input_files: safeInputFileNames(op.filesJson),
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
