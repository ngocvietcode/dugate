// app/api/v1/operations/[id]/route.ts
// GET /api/v1/operations/{id} — Status + Result
// DELETE /api/v1/operations/{id} — Soft delete

import { NextRequest, NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  formatOperationIntegrationResponse,
  formatOperationResponse,
  INTEGRATION_VIEW_ENDPOINTS,
} from '@/lib/pipelines/format';
import { encryptOperationResponse } from '@/lib/crypto/operation-response-encrypt';
import { parseIntegrationIncludes } from '@/lib/pipelines/workflows/loan-appraisal/integration-payload';
import { SelectiveEncryptionFieldError } from '@/lib/crypto/selective-encrypt';
import { BASE_TYPE_URI } from '@/lib/errors';
import { resolveCallerIdentity } from '@/lib/auth-resolve-key';
import { updateOperationMembership } from '@/lib/operations/state-transition';

export const dynamic = 'force-dynamic';

/**
 * Map a selective-encryption misconfiguration to HTTP 422 with a corrective hint.
 * This is an admin config error (wrong encryption_fields dot-path), not a server
 * fault, so a 500 would be misleading. The hint lists the payload's top-level keys
 * so the admin can see the correct base path (e.g. the poll response nests business
 * data under `result.extracted_data`, while the webhook payload nests it under
 * `extracted_data`).
 */
function selectiveFieldError422(err: SelectiveEncryptionFieldError): NextResponse {
  return NextResponse.json(
    {
      type: `${BASE_TYPE_URI}/encryption-fields-mismatch`,
      title: 'Encryption Fields Mismatch',
      status: 422,
      detail:
        `Cấu hình encryption_fields không khớp payload: ${JSON.stringify(err.configuredFields)}. ` +
        `Các khóa cấp cao nhất của response này là: ${JSON.stringify(err.availableTopLevelKeys)}. ` +
        'Gợi ý: dùng wildcard sâu "**.<ten_field>" (vd "**.ma_may") để mã hóa field ở MỌI vị trí — ' +
        'một cấu hình dùng chung cho cả poll và webhook. Hoặc chỉ path poll đầy đủ ' +
        '"result.extracted_data.danh_sach_tai_lieu[].extracted_data.ma_may". ' +
        'Lưu ý: chỉ poll khi operation đã hoàn tất (done=true) mới có khối "result". ' +
        'Ngoài ra có thể chuyển encryption_mode sang "full" để mã hóa toàn bộ.',
      configured_fields: err.configuredFields,
      available_top_level_keys: err.availableTopLevelKeys,
    },
    { status: 422 },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    new Logger({ service: 'operations_api' }).info(`GET /operations/${id} called`);
    const [op] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);

    if (!op) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/not-found`, title: 'Operation Not Found', status: 404, detail: `Operation '${id}' not found.`, requested_id: id },
        { status: 404 }
      );
    }

    // Note: We allow access to soft-deleted operations by direct ID lookup.
    // This is intentional — callers who have the operation ID (from submit response)
    // must be able to poll status even when DISABLE_HISTORY was active.
    // The deletedAt flag only hides operations from LIST queries.

    // ── Ownership enforcement ──
    const { apiKeyId, userId, userRole } = await resolveCallerIdentity(req);

    // Require at least one identity
    if (!apiKeyId && !userId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/unauthorized`, title: 'Unauthorized', status: 401, detail: 'Authentication required.' },
        { status: 401 }
      );
    }

    // API key callers: strict profile ownership
    if (apiKeyId && op.apiKeyId !== apiKeyId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/forbidden`, title: 'Forbidden', status: 403, detail: `Access denied.` },
        { status: 403 }
      );
    }

    // Browser users (non-admin): can only view operations they created
    if (!apiKeyId && userId && userRole !== 'ADMIN' && op.createdByUserId !== userId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/forbidden`, title: 'Forbidden', status: 403, detail: `Access denied.` },
        { status: 403 }
      );
    }

    // Optional response encryption (Profile opt-in). Plaintext when disabled.
    // Views are opt-in so existing API consumers keep the legacy response shape.
    // - compact: polling UIs avoid receiving terminal step artifacts twice.
    // - integration: JSON for external systems, split into classification /
    //   extraction / evaluation sections (loan appraisal only).
    const view = req.nextUrl?.searchParams.get('view') ?? null;
    if (view === 'integration' && !INTEGRATION_VIEW_ENDPOINTS.has(op.endpointSlug ?? '')) {
      return NextResponse.json(
        {
          type: `${BASE_TYPE_URI}/unsupported-view`,
          title: 'Unsupported View',
          status: 400,
          detail: `view=integration chỉ hỗ trợ cho: ${[...INTEGRATION_VIEW_ENDPOINTS].join(', ')}.`,
        },
        { status: 400 },
      );
    }
    const formatted = view === 'integration'
      ? formatOperationIntegrationResponse(op, { include: parseIntegrationIncludes(req.nextUrl?.searchParams.get('include')) })
      : formatOperationResponse(op, { compact: view === 'compact' });
    try {
      // [SEC 29/09 LA-S1] view=integration has a new payload shape: reject stale
      // concrete encryption_fields instead of emitting those fields as plaintext.
      const { body, headers } = await encryptOperationResponse(
        formatted as Record<string, unknown>,
        op,
        undefined,
        undefined,
        { strictPaths: view === 'integration' },
      );
      return NextResponse.json(body, { headers });
    } catch (encErr: unknown) {
      if (encErr instanceof SelectiveEncryptionFieldError) return selectiveFieldError422(encErr);
      throw encErr;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { type: `${BASE_TYPE_URI}/internal`, title: 'Internal Server Error', status: 500, detail: msg },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [op] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);

    if (!op || op.deletedAt) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/not-found`, title: 'Not Found', status: 404 },
        { status: 404 }
      );
    }

    const { apiKeyId, userId, userRole } = await resolveCallerIdentity(req);

    if (!apiKeyId && !userId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/unauthorized`, title: 'Unauthorized', status: 401, detail: 'Authentication required.' },
        { status: 401 }
      );
    }

    if (apiKeyId && op.apiKeyId !== apiKeyId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/forbidden`, title: 'Forbidden', status: 403, detail: `Access denied.` },
        { status: 403 }
      );
    }

    if (!apiKeyId && userId && userRole !== 'ADMIN' && op.createdByUserId !== userId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/forbidden`, title: 'Forbidden', status: 403, detail: `Access denied.` },
        { status: 403 }
      );
    }

    await updateOperationMembership({
      operationId: id,
      changes: { deletedAt: new Date() },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { type: `${BASE_TYPE_URI}/internal`, title: 'Internal Server Error', status: 500, detail: msg },
      { status: 500 }
    );
  }
}
