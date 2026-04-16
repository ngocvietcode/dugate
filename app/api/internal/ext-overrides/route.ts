// app/api/internal/ext-overrides/route.ts
// GET    — List overrides (filter by connectionId hoặc apiKeyId)
// POST   — Upsert override (tạo hoặc cập nhật)
// DELETE — Xóa override

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiOverrides, externalApiConnections, profileEndpoints, apiKeys } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { requireProfileAccess } from '@/lib/auth-guard';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const logger = new Logger({ service: 'ext-overrides' });


// ─── GET: List overrides ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId') ?? undefined;
    const apiKeyId = searchParams.get('apiKeyId') ?? undefined;

    const session = await getServerSession(authOptions);
    const isAdmin = session?.user?.role === 'ADMIN';

    if (!isAdmin && !apiKeyId) {
      return NextResponse.json({ success: false, error: 'Standard users must provide apiKeyId' }, { status: 403 });
    }

    if (apiKeyId) {
      const guard = await requireProfileAccess(apiKeyId);
      if (guard instanceof NextResponse) return guard;
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
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── POST: Upsert (create or update) override ──────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { connectionId, apiKeyId, endpointSlug, stepId, promptOverride, isActive } = await req.json();
    const resolvedStepId = stepId ?? '_default';

    if (!connectionId || !apiKeyId || !endpointSlug) {
      return NextResponse.json(
        { success: false, error: 'connectionId, apiKeyId và endpointSlug là bắt buộc' },
        { status: 400 },
      );
    }

    const guard = await requireProfileAccess(apiKeyId);
    if (guard instanceof NextResponse) return guard;

    const session = await getServerSession(authOptions);
    const isAdmin = session?.user?.role === 'ADMIN';

    if (!isAdmin) {
      const [existingEndpoint] = await db.select().from(profileEndpoints).where(and(eq(profileEndpoints.apiKeyId, apiKeyId), eq(profileEndpoints.endpointSlug, endpointSlug))).limit(1);
      if (!existingEndpoint || !existingEndpoint.enabled) {
        return NextResponse.json({ success: false, error: 'Endpoint is not enabled or does not exist.' }, { status: 403 });
      }
    }

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
      return NextResponse.json({ success: true, deleted: true });
    }

    // Upsert override
    const payload = {
      connectionId,
      apiKeyId,
      endpointSlug,
      stepId: resolvedStepId,
      promptOverride: promptOverride?.trim() ?? null,
    };
    const [override] = await db.insert(externalApiOverrides).values(payload).onConflictDoUpdate({
      target: [externalApiOverrides.connectionId, externalApiOverrides.apiKeyId, externalApiOverrides.endpointSlug, externalApiOverrides.stepId],
      set: { promptOverride: promptOverride?.trim() ?? null }
    }).returning();

    return NextResponse.json({ success: true, override });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[POST] Failed to upsert override', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── DELETE: Remove override ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { connectionId, apiKeyId } = await req.json();

    if (!connectionId || !apiKeyId) {
      return NextResponse.json(
        { success: false, error: 'connectionId và apiKeyId là bắt buộc' },
        { status: 400 },
      );
    }

    const guard = await requireProfileAccess(apiKeyId);
    if (guard instanceof NextResponse) return guard;

    await db.delete(externalApiOverrides).where(and(eq(externalApiOverrides.connectionId, connectionId), eq(externalApiOverrides.apiKeyId, apiKeyId)));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
