// app/api/internal/operations/route.ts
// GET /api/internal/operations — List ALL operations with offset pagination
// Shows everything: with profile, without profile, soft-deleted — full visibility for ops monitoring.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations, apiKeys } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';
import { eq, and, desc, isNull, sql, SQL, ilike, gte, lte, or } from 'drizzle-orm';

const VALID_STATES = [
  'RUNNING', 'SUCCEEDED', 'FAILED', 'PENDING', 'WAITING_USER_INPUT', 'CANCELLED',
] as const;

export async function GET(req: NextRequest) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  // 2. Parse query params
  const params = req.nextUrl.searchParams;
  const page = Math.max(parseInt(params.get('page') ?? '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(params.get('page_size') ?? '20', 10) || 20, 1), 100);
  const filterState = params.get('state') || null;
  const filterEndpoint = params.get('endpoint') || null;
  const filterProfile = params.get('profile') || null; // "__none__" = no profile, UUID = specific profile
  const searchQuery = params.get('q') || null; // unified text search
  const startDate = params.get('start_date') || null; // date range filter
  const endDate = params.get('end_date') || null;
  // Backward-compatible default. The optimized Operations UI fetches metadata
  // through /filter-options and disables this work for list/poll requests.
  const includeFilterOptions = params.get('include_filter_options') !== '0';
  const profileIds = await getAssignedProfileIds('operations:read');
  // Soft-deleted records are available only to a user with global operational
  // scope; assigned-only users remain limited to their visible Profiles.
  const includeDeleted = profileIds === null && params.get('include_deleted') === 'true';

  // 3. Base conditions
  // By default: exclude soft-deleted operations AND hidden workflow sub-steps.
  // `include_deleted=true` (global scope only) intentionally shows both, for diagnostics.
  const baseConditions: SQL[] = [];
  if (!includeDeleted) {
    baseConditions.push(visibleInOperationsCondition());
  }

  if (profileIds !== null) {
    // USER sees assigned profiles plus no-profile operations. With zero
    // assignments, the visible set is exactly the no-profile operations.
    if (profileIds.length === 0) {
      baseConditions.push(isNull(operations.apiKeyId));
    } else {
      baseConditions.push(
        sql`(${operations.apiKeyId} IN (${sql.join(profileIds.map(id => sql`${id}`), sql`, `)}) OR ${operations.apiKeyId} IS NULL)`,
      );
    }
  }

  // 4. Filter conditions
  const filterConditions: SQL[] = [...baseConditions];

  if (filterState) {
    if (!(VALID_STATES as readonly string[]).includes(filterState)) {
      return NextResponse.json({ error: `Invalid state. Must be one of: ${VALID_STATES.join(', ')}` }, { status: 400 });
    }
    filterConditions.push(eq(operations.state, filterState));
  }
  if (filterEndpoint) {
    filterConditions.push(eq(operations.endpointSlug, filterEndpoint));
  }
  if (filterProfile === '__none__') {
    // Special: filter operations WITHOUT a profile (apiKeyId is null)
    filterConditions.push(isNull(operations.apiKeyId));
  } else if (filterProfile) {
    filterConditions.push(eq(operations.apiKeyId, filterProfile));
  }

  // Text search across multiple reference fields
  if (searchQuery) {
    const q = searchQuery.trim();
    // UUID pattern detection — search by exact ID (PK index)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    if (isUuid) {
      filterConditions.push(eq(operations.id, q));
    } else {
      // Strategy: try EQUALITY first (uses B-tree index), then prefix match.
      // In practice, ops team searches by exact reference values (e.g. "FX-2026-001")
      // which are exact matches. ILIKE with leading wildcard ('%x%') cannot use index
      // but is needed for partial matches. We combine both:
      //   - eq() for exact match (fast, uses index)
      //   - ilike with prefix for starts-with pattern (uses index if no leading %)
      // For user convenience, support both exact and contains patterns.
      const likePattern = `%${q}%`;
      filterConditions.push(
        or(
          eq(operations.correlationId, q),
          eq(operations.clientReference, q),
          eq(operations.idempotencyKey, q),
          ilike(operations.correlationId, likePattern),
          ilike(operations.clientReference, likePattern),
          ilike(operations.idempotencyKey, likePattern),
        )!
      );
    }
  }

  // Date range filter
  if (startDate) {
    const start = new Date(startDate);
    if (!isNaN(start.getTime())) {
      filterConditions.push(gte(operations.createdAt, start));
    }
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!isNaN(end.getTime())) {
      // If only date provided (no time), include entire day
      if (endDate.length <= 10) {
        end.setHours(23, 59, 59, 999);
      }
      filterConditions.push(lte(operations.createdAt, end));
    }
  }

  // 5. Count total
  const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;
  const [{ count: totalCount }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(operations)
    .where(whereClause);

  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  // 6. Fetch page data
  const rows = await db
    .select({
      id: operations.id,
      done: operations.done,
      state: operations.state,
      endpointSlug: operations.endpointSlug,
      progressPercent: operations.progressPercent,
      progressMessage: operations.progressMessage,
      currentStep: operations.currentStep,
      errorCode: operations.errorCode,
      errorMessage: operations.errorMessage,
      failedAtStep: operations.failedAtStep,
      totalInputTokens: operations.totalInputTokens,
      totalOutputTokens: operations.totalOutputTokens,
      totalCostUsd: operations.totalCostUsd,
      apiKeyId: operations.apiKeyId,
      profileName: apiKeys.name,
      correlationId: operations.correlationId,
      clientReference: operations.clientReference,
      idempotencyKey: operations.idempotencyKey,
      hasUnpricedCost: sql<boolean>`coalesce(${operations.usageBreakdown}, '') like '%"cost_source":"unpriced"%'`.mapWith(Boolean),
      createdAt: operations.createdAt,
      updatedAt: operations.updatedAt,
      completedAt: operations.completedAt,
    })
    .from(operations)
    .leftJoin(apiKeys, eq(operations.apiKeyId, apiKeys.id))
    .where(whereClause)
    .orderBy(desc(operations.createdAt))
    .limit(pageSize)
    .offset(offset);

  // 7. Filter metadata is optional for backward compatibility. The current UI
  // uses the dedicated /filter-options endpoint, so list polling skips these
  // history-wide queries entirely.
  let filterOptions: {
    endpoints: string[];
    profiles: Array<{ id: string; name: string }>;
    has_no_profile: boolean;
  } | undefined;

  if (includeFilterOptions) {
    const baseWhereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;
    const [endpointRows, profileRows, noProfileRows] = await Promise.all([
      db.selectDistinct({ endpointSlug: operations.endpointSlug })
        .from(operations)
        .where(baseWhereClause),
      db.select({ id: apiKeys.id, name: apiKeys.name })
        .from(apiKeys)
        .where(profileIds !== null
          ? profileIds.length > 0
            ? sql`${apiKeys.id} IN (${sql.join(profileIds.map((id) => sql`${id}`), sql`, `)})`
            : sql`1=0`
          : sql`1=1`)
        .orderBy(apiKeys.name),
      db.select({ id: operations.id })
        .from(operations)
        .where(baseWhereClause
          ? and(baseWhereClause, isNull(operations.apiKeyId))
          : isNull(operations.apiKeyId))
        .limit(1),
    ]);

    filterOptions = {
      endpoints: endpointRows
        .map((row) => row.endpointSlug)
        .filter((slug): slug is string => slug !== null)
        .sort(),
      profiles: profileRows,
      has_no_profile: noProfileRows.length > 0,
    };
  }

  // 8. Format response
  const formatted = rows.map((row) => ({
    id: row.id,
    done: row.done,
    state: row.state,
    endpointSlug: row.endpointSlug,
    progressPercent: row.progressPercent,
    progressMessage: row.progressMessage,
    currentStep: row.currentStep,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    failedAtStep: row.failedAtStep,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    totalCostUsd: row.totalCostUsd,
    apiKeyId: row.apiKeyId,
    profileName: row.profileName ?? null,
    correlationId: row.correlationId ?? null,
    clientReference: row.clientReference ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    hasUnpricedCost: row.hasUnpricedCost,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  }));

  return NextResponse.json({
    operations: formatted,
    total: totalCount,
    page: safePage,
    page_size: pageSize,
    total_pages: totalPages,
    ...(filterOptions ? { filter_options: filterOptions } : {}),
  });
}
