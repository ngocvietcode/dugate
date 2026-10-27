// app/api/internal/ext-overrides/route.ts
// GET    — List overrides (filter by connectionId hoặc apiKeyId)
// POST   — Upsert override (tạo hoặc cập nhật)
// DELETE — Xóa override

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiOverrides, externalApiConnections, apiKeys } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { requireCapability, requireProfileAccess } from '@/lib/auth-guard';
import { isValidReasoningEffortOverride, normalizeReasoningEffort } from '@/lib/endpoints/aihub-config';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { auditActor, getSourceIp } from '@/lib/audit/context';

const logger = new Logger({ service: 'ext-overrides' });


// ─── GET: List overrides ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId') ?? undefined;
    const apiKeyId = searchParams.get('apiKeyId') ?? undefined;

    if (apiKeyId) {
      const guard = await requireProfileAccess(apiKeyId);
      if (guard instanceof NextResponse) return guard;
    } else {
      const connectorGuard = await requireCapability('connector:read');
      if (connectorGuard instanceof NextResponse) return connectorGuard;
      // A connection-only query spans every Profile using that connection,
      // so assignment-limited operators need the explicit global data scope.
      const scopeGuard = await requireCapability('data:all-profiles');
      if (scopeGuard instanceof NextResponse) return scopeGuard;
    }

    const conditions = [];
    if (connectionId) conditions.push(eq(externalApiOverrides.connectionId, connectionId));
    if (apiKeyId) conditions.push(eq(externalApiOverrides.apiKeyId, apiKeyId));

    const rows = await db.select({
      override: externalApiOverrides,
      connection: { id: externalApiConnections.id, slug: externalApiConnections.slug, name: externalApiConnections.name }
    }).from(externalApiOverrides)
    .leftJoin(externalApiConnections, eq(externalApiOverrides.connectionId, externalApiConnections.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(externalApiOverrides.createdAt));

    const overrides = rows.map(r => ({ ...r.override, connection: r.connection }));

    return NextResponse.json({ success: true, overrides });
  } catch (error: unknown) {
    logger.error('[GET] Failed to list overrides', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

// ─── POST: Upsert (create or update) override ──────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { connectionId, apiKeyId, endpointSlug, stepId, promptOverride, modelOverride, reasoningEffortOverride, isActive } = await req.json();
    const resolvedStepId = stepId ?? '_default';

    if (!connectionId || !apiKeyId || !endpointSlug) {
      return NextResponse.json(
        { success: false, error: 'connectionId, apiKeyId và endpointSlug là bắt buộc' },
        { status: 400 },
      );
    }
    if (promptOverride !== undefined && promptOverride !== null && typeof promptOverride !== 'string') {
      return NextResponse.json({ success: false, error: 'promptOverride không hợp lệ' }, { status: 400 });
    }
    if (modelOverride !== undefined && modelOverride !== null
        && (typeof modelOverride !== 'string' || modelOverride.length > 200)) {
      return NextResponse.json({ success: false, error: 'modelOverride không hợp lệ' }, { status: 400 });
    }
    if (!isValidReasoningEffortOverride(reasoningEffortOverride)) {
      return NextResponse.json({ success: false, error: 'reasoningEffortOverride không hợp lệ' }, { status: 400 });
    }
    if (typeof resolvedStepId !== 'string' || !resolvedStepId.trim() || resolvedStepId.length > 120) {
      return NextResponse.json({ success: false, error: 'stepId không hợp lệ' }, { status: 400 });
    }

    const guard = await requireProfileAccess(apiKeyId, 'connector:manage');
    if (guard instanceof NextResponse) return guard;

    // Verify connection và apiKey tồn tại
    const [connectionResult, apiKeyResult] = await Promise.all([
      db.select().from(externalApiConnections).where(eq(externalApiConnections.id, connectionId)).limit(1),
      db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1),
    ]);
    const connection = connectionResult[0];
    const apiKey = apiKeyResult[0];

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection không tồn tại' }, { status: 404 });
    }
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'API Key không tồn tại' }, { status: 404 });
    }

    // isActive = false → xóa override (về default)
    if (isActive === false) {
      await db.delete(externalApiOverrides).where(
        and(
          eq(externalApiOverrides.connectionId, connectionId),
          eq(externalApiOverrides.apiKeyId, apiKeyId),
          eq(externalApiOverrides.endpointSlug, endpointSlug),
          eq(externalApiOverrides.stepId, resolvedStepId)
        )
      );
      await writeAudit({
        entityType: 'OVERRIDE',
        entityName: `${apiKey.name} · ${endpointSlug}`,
        scopeEntityId: apiKeyId,
        action: 'DELETE',
        outcome: 'SUCCESS',
        detail: `connectionId=${connectionId} stepId=${resolvedStepId}`,
        ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
        sourceIp: getSourceIp(req),
      });
      return NextResponse.json({ success: true, deleted: true });
    }

    // Upsert override
    const payload = {
      connectionId,
      apiKeyId,
      endpointSlug,
      stepId: resolvedStepId,
      promptOverride: promptOverride?.trim() ?? null,
      modelOverride: modelOverride?.trim() ?? null,
      reasoningEffortOverride: normalizeReasoningEffort(reasoningEffortOverride) || null,
    };
    // Capture prior state to distinguish CREATE vs UPDATE and build the diff.
    const [priorOverride] = await db.select({
      promptOverride: externalApiOverrides.promptOverride,
      modelOverride: externalApiOverrides.modelOverride,
      reasoningEffortOverride: externalApiOverrides.reasoningEffortOverride,
    }).from(externalApiOverrides).where(
      and(
        eq(externalApiOverrides.connectionId, connectionId),
        eq(externalApiOverrides.apiKeyId, apiKeyId),
        eq(externalApiOverrides.endpointSlug, endpointSlug),
        eq(externalApiOverrides.stepId, resolvedStepId),
      ),
    ).limit(1);

    const [override] = await db.insert(externalApiOverrides).values(payload).onConflictDoUpdate({
      target: [externalApiOverrides.connectionId, externalApiOverrides.apiKeyId, externalApiOverrides.endpointSlug, externalApiOverrides.stepId],
      set: {
        promptOverride: promptOverride?.trim() ?? null,
        modelOverride: modelOverride?.trim() ?? null,
        reasoningEffortOverride: normalizeReasoningEffort(reasoningEffortOverride) || null,
      }
    }).returning();

    await writeAudit({
      entityType: 'OVERRIDE',
      entityId: override.id,
      entityName: `${apiKey.name} · ${endpointSlug}`,
      scopeEntityId: apiKeyId,
      action: priorOverride ? 'UPDATE' : 'CREATE',
      outcome: 'SUCCESS',
      changes: buildChanges(priorOverride ?? null, {
        promptOverride: override.promptOverride,
        modelOverride: override.modelOverride,
        reasoningEffortOverride: override.reasoningEffortOverride,
      }, AUDIT_POLICIES.OVERRIDE),
      detail: `connectionId=${connectionId} stepId=${resolvedStepId}`,
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ success: true, override });
  } catch (error: unknown) {
    logger.error('[POST] Failed to upsert override', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

// ─── DELETE: Remove override ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { connectionId, apiKeyId, endpointSlug, stepId } = await req.json();

    if (typeof connectionId !== 'string' || !connectionId
        || typeof apiKeyId !== 'string' || !apiKeyId
        || typeof endpointSlug !== 'string' || !endpointSlug
        || typeof stepId !== 'string' || !stepId.trim() || stepId.length > 120) {
      return NextResponse.json(
        { success: false, error: 'connectionId, apiKeyId, endpointSlug và stepId là bắt buộc' },
        { status: 400 },
      );
    }

    const guard = await requireProfileAccess(apiKeyId, 'connector:manage');
    if (guard instanceof NextResponse) return guard;

    await db.delete(externalApiOverrides).where(and(
      eq(externalApiOverrides.connectionId, connectionId),
      eq(externalApiOverrides.apiKeyId, apiKeyId),
      eq(externalApiOverrides.endpointSlug, endpointSlug),
      eq(externalApiOverrides.stepId, stepId.trim()),
    ));

    await writeAudit({
      entityType: 'OVERRIDE',
      entityName: endpointSlug,
      scopeEntityId: apiKeyId,
      action: 'DELETE',
      outcome: 'SUCCESS',
      detail: `apiKeyId=${apiKeyId} connectionId=${connectionId} stepId=${stepId.trim()}`,
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('[DELETE] Failed to delete overrides', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
