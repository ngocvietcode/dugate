// app/api/internal/ext-overrides/route.ts
// GET    — List overrides (filter by connectionId hoặc apiKeyId)
// POST   — Upsert override (tạo hoặc cập nhật)
// DELETE — Xóa override

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Logger } from '@/lib/logger';
import { requireAdmin } from '@/lib/rbac';

const logger = new Logger({ service: 'ext-overrides' });


// ─── GET: List overrides ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connectionId') ?? undefined;
    const apiKeyId = searchParams.get('apiKeyId') ?? undefined;

    const overrides = await prisma.externalApiOverride.findMany({
      where: {
        ...(connectionId && { connectionId }),
        ...(apiKeyId && { apiKeyId }),
      },
      include: {
        connection: {
          select: { id: true, slug: true, name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ success: true, overrides });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── POST: Upsert (create or update) override ──────────────────────────────────
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { connectionId, apiKeyId, endpointSlug, stepId, promptOverride, isActive } = await req.json();
    const resolvedStepId = stepId ?? '_default';

    if (!connectionId || !apiKeyId || !endpointSlug) {
      return NextResponse.json(
        { success: false, error: 'connectionId, apiKeyId và endpointSlug là bắt buộc' },
        { status: 400 },
      );
    }

    // Verify connection và apiKey tồn tại
    const [connection, apiKey] = await Promise.all([
      prisma.externalApiConnection.findUnique({ where: { id: connectionId } }),
      prisma.apiKey.findUnique({ where: { id: apiKeyId } }),
    ]);

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection không tồn tại' }, { status: 404 });
    }
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'API Key không tồn tại' }, { status: 404 });
    }

    // isActive = false → xóa override (về default)
    if (isActive === false) {
      await prisma.externalApiOverride.deleteMany({
        where: { connectionId, apiKeyId, endpointSlug, stepId: resolvedStepId },
      });
      return NextResponse.json({ success: true, deleted: true });
    }

    // Upsert override
    const override = await prisma.externalApiOverride.upsert({
      where: {
        connectionId_apiKeyId_endpointSlug_stepId: { connectionId, apiKeyId, endpointSlug, stepId: resolvedStepId },
      },
      create: {
        connectionId,
        apiKeyId,
        endpointSlug,
        stepId: resolvedStepId,
        promptOverride: promptOverride?.trim() ?? null,
      },
      update: {
        promptOverride: promptOverride?.trim() ?? null,
      },
    });

    return NextResponse.json({ success: true, override });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[POST] Failed to upsert override', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── DELETE: Remove override ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { connectionId, apiKeyId } = await req.json();

    if (!connectionId || !apiKeyId) {
      return NextResponse.json(
        { success: false, error: 'connectionId và apiKeyId là bắt buộc' },
        { status: 400 },
      );
    }

    await prisma.externalApiOverride.deleteMany({
      where: { connectionId, apiKeyId },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
