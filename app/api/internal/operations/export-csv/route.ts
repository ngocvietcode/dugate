// app/api/internal/operations/export-csv/route.ts
// GET /api/internal/operations/export-csv — stream a CSV summary of operations
// matching the current filters + date range. ONLY scalar columns (no large text
// payloads) so it stays light on DB/memory. Guarded by a max span (AppSetting
// ops_export_max_days) and a hard row cap. Read-only.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations, apiKeys } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { auditOperationAction, boundedAuditText } from '@/lib/audit/operation-audit';
import { getExportMaxDays } from '@/lib/ops/config';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';
import { formatDecimal } from '@/app/operations/lib/format';
import { eq, and, isNull, sql, SQL, gte, lte, lt, desc, ilike, or } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 50_000;
const BATCH = 2_000;

const VALID_STATES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'PENDING', 'WAITING_USER_INPUT', 'CANCELLED'];

const CSV_HEADERS = [
  'id', 'clientReference', 'correlationId', 'profileName', 'endpointSlug', 'state',
  'progressPercent', 'inputTokens', 'outputTokens', 'costUsd', 'durationSec',
  'errorCode', 'createdAt', 'updatedAt',
];

interface ExportRow {
  id: string;
  clientReference: string | null;
  correlationId: string | null;
  profileName: string | null;
  endpointSlug: string | null;
  state: string;
  progressPercent: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  done: boolean;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export async function GET(req: NextRequest) {
  const guard = await requireCapability('operations:export');
  if (guard instanceof NextResponse) return guard;

  // 2. Params
  const params = req.nextUrl.searchParams;
  const filterState = params.get('state') || null;
  const filterEndpoint = params.get('endpoint') || null;
  const filterProfile = params.get('profile') || null;
  const searchQuery = params.get('q') || null;
  const startDate = params.get('start_date') || null;
  const endDate = params.get('end_date') || null;

  // 3. Enforce bounded, validated date range and filter contract.
  if (filterState && !VALID_STATES.includes(filterState)) {
    return NextResponse.json({ error: 'state không hợp lệ' }, { status: 400 });
  }

  const maxDays = await getExportMaxDays();
  const now = new Date();
  const start = startDate ? new Date(startDate) : new Date(now.getTime() - 7 * 86_400_000);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: 'start_date không hợp lệ' }, { status: 400 });
  }

  let end = now;
  if (endDate) {
    const parsedEnd = new Date(endDate);
    if (Number.isNaN(parsedEnd.getTime())) {
      return NextResponse.json({ error: 'end_date không hợp lệ' }, { status: 400 });
    }
    if (endDate.length <= 10) parsedEnd.setHours(23, 59, 59, 999);
    end = parsedEnd;
  }
  if (end < start) {
    return NextResponse.json({ error: 'Khoảng thời gian không hợp lệ' }, { status: 400 });
  }

  const spanDays = (end.getTime() - start.getTime()) / 86_400_000;
  if (spanDays > maxDays) {
    return NextResponse.json(
      { error: `Khoảng thời gian tối đa cho phép là ${maxDays} ngày. Vui lòng thu hẹp bộ lọc.` },
      { status: 400 },
    );
  }

  // 4. Conditions (mirror list route)
  // Hidden sub-steps excluded: the parent row already carries their rolled-up cost.
  const conditions: SQL[] = [visibleInOperationsCondition(), gte(operations.createdAt, start), lte(operations.createdAt, end)];

  const profileIds = await getAssignedProfileIds('operations:export');
  if (profileIds !== null) {
    if (profileIds.length === 0) {
      conditions.push(isNull(operations.apiKeyId));
    } else {
      conditions.push(
        sql`(${operations.apiKeyId} IN (${sql.join(profileIds.map((id) => sql`${id}`), sql`, `)}) OR ${operations.apiKeyId} IS NULL)`,
      );
    }
  }

  if (filterState && VALID_STATES.includes(filterState)) {
    conditions.push(eq(operations.state, filterState));
  }
  if (filterEndpoint) conditions.push(eq(operations.endpointSlug, filterEndpoint));
  if (filterProfile === '__none__') {
    conditions.push(isNull(operations.apiKeyId));
  } else if (filterProfile) {
    conditions.push(eq(operations.apiKeyId, filterProfile));
  }
  if (searchQuery) {
    const q = searchQuery.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    if (isUuid) {
      conditions.push(eq(operations.id, q));
    } else {
      const like = `%${q}%`;
      const searchCond = or(
        ilike(operations.clientReference, like),
        ilike(operations.correlationId, like),
        ilike(operations.idempotencyKey, like),
      );
      if (searchCond) conditions.push(searchCond);
    }
  }

  const whereClause = and(...conditions);

  // 5. Stream one DB batch per consumer pull. This honors backpressure and
  // bounds retained output to roughly one encoded batch instead of 50k chunks.
  type ExportCursor = { createdAt: Date; id: string };
  const fetchBatch = async (cursor: ExportCursor | null): Promise<ExportRow[]> => {
    const cursorCondition: SQL | undefined = cursor
      ? or(
          lt(operations.createdAt, cursor.createdAt),
          and(
            eq(operations.createdAt, cursor.createdAt),
            lt(operations.id, cursor.id),
          ),
        )
      : undefined;
    const batchWhere: SQL | undefined = cursorCondition
      ? and(whereClause, cursorCondition)
      : whereClause;

    return db
      .select({
        id: operations.id,
        clientReference: operations.clientReference,
        correlationId: operations.correlationId,
        profileName: apiKeys.name,
        endpointSlug: operations.endpointSlug,
        state: operations.state,
        progressPercent: operations.progressPercent,
        totalInputTokens: operations.totalInputTokens,
        totalOutputTokens: operations.totalOutputTokens,
        totalCostUsd: operations.totalCostUsd,
        done: operations.done,
        errorCode: operations.errorCode,
        createdAt: operations.createdAt,
        updatedAt: operations.updatedAt,
        completedAt: operations.completedAt,
      })
      .from(operations)
      .leftJoin(apiKeys, eq(operations.apiKeyId, apiKeys.id))
      .where(batchWhere)
      .orderBy(desc(operations.createdAt), desc(operations.id))
      .limit(BATCH);
  };

  const toCsvLine = (row: ExportRow): string => {
    const durationEnd = row.completedAt ?? row.updatedAt;
    const durationSec = row.done
      ? ((durationEnd.getTime() - row.createdAt.getTime()) / 1000).toFixed(1)
      : '';
    return [
      row.id,
      row.clientReference ?? '',
      row.correlationId ?? '',
      row.profileName ?? '',
      row.endpointSlug ?? '',
      row.state,
      String(row.progressPercent),
      String(row.totalInputTokens),
      String(row.totalOutputTokens),
      csvNum(row.totalCostUsd),
      durationSec,
      row.errorCode ?? '',
      row.createdAt.toISOString(),
      row.updatedAt.toISOString(),
    ].map(csvEscape).join(',');
  };

  // Preflight the first query before committing a 200 CSV response. Initial DB
  // failures now return a normal 500 response rather than a corrupt download.
  let pendingRows: ExportRow[] | null;
  try {
    pendingRows = await fetchBatch(null);
  } catch (err) {
    console.error('[Operations CSV] Export preflight failed', err);
    return NextResponse.json({ error: 'Không thể tạo file CSV' }, { status: 500 });
  }

  // Accountability: the row count is only known once the stream ends, so record
  // the exact selection (filters + window) that defines what was exported.
  await auditOperationAction({
    action: 'EXPORT',
    req,
    session: guard.session,
    entityName: 'operations CSV',
    detail: {
      format: 'csv',
      start: start.toISOString(),
      end: end.toISOString(),
      filters: {
        state: filterState,
        endpoint: boundedAuditText(filterEndpoint),
        profile: boundedAuditText(filterProfile),
        q: boundedAuditText(searchQuery),
      },
      maxRows: MAX_ROWS,
      firstBatchRows: pendingRows.length,
    },
  });

  const encoder = new TextEncoder();
  let cursor: ExportCursor | null = null;
  let emitted = 0;
  let firstChunk = true;
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled || req.signal.aborted) {
        controller.close();
        return;
      }

      try {
        const currentRows = pendingRows ?? await fetchBatch(cursor);
        pendingRows = null;

        if (cancelled || req.signal.aborted) {
          controller.close();
          return;
        }
        if (currentRows.length === 0) {
          if (firstChunk) {
            controller.enqueue(encoder.encode('\uFEFF' + CSV_HEADERS.join(',') + '\n'));
          }
          controller.close();
          return;
        }

        const rowsToEmit = currentRows.slice(0, MAX_ROWS - emitted);
        const prefix = firstChunk ? '\uFEFF' + CSV_HEADERS.join(',') + '\n' : '';
        firstChunk = false;
        controller.enqueue(encoder.encode(prefix + rowsToEmit.map(toCsvLine).join('\n') + '\n'));
        emitted += rowsToEmit.length;

        const last = rowsToEmit[rowsToEmit.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
        if (currentRows.length < BATCH || emitted >= MAX_ROWS) controller.close();
      } catch (err) {
        if (cancelled || req.signal.aborted) {
          controller.close();
          return;
        }
        console.error('[Operations CSV] Export stream failed', err);
        controller.error(new Error('CSV export interrupted'));
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  const filename = `operations-${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}.csv`;
  return csvResponse(stream, filename);
}

function csvResponse(stream: ReadableStream<Uint8Array>, filename = 'operations.csv') {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** RFC-4180 escaping plus spreadsheet-formula neutralization. */
function csvEscape(value: string): string {
  const safeValue = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

/** Canonical fixed-notation cost for CSV (10 decimals, never scientific notation). */
function csvNum(v: number): string {
  return formatDecimal(v);
}
