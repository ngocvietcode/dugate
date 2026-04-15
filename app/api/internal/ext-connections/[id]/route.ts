// app/api/internal/ext-connections/[id]/route.ts
// PUT    — Update connection
// DELETE — Delete connection (cascade deletes overrides)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Logger } from '@/lib/logger';
import { requireAdmin } from '@/lib/auth-guard';

const logger = new Logger({ service: 'ext-connections' });


// ─── PUT: Update connection ────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.externalApiConnection.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Connection không tồn tại' }, { status: 404 });
    }

    const {
      name,
      description,
      endpointUrl,
      httpMethod,
      authType,
      authKeyHeader,
      authSecret,
      promptFieldName,
      fileFieldName,
      defaultPrompt,
      staticFormFields,
      extraHeaders,
      responseContentPath,
      sessionIdResponsePath,
      sessionIdFieldName,
      timeoutSec,
      state,
    } = body;

    // Only update authSecret if a non-empty value is provided
    const resolvedSecret =
      authSecret && authSecret.trim() && authSecret !== '••••••••'
        ? authSecret.trim()
        : existing.authSecret;

    const updated = await prisma.externalApiConnection.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() ?? null }),
        ...(endpointUrl !== undefined && { endpointUrl: endpointUrl.trim() }),
        ...(httpMethod !== undefined && { httpMethod }),
        ...(authType !== undefined && { authType }),
        ...(authKeyHeader !== undefined && { authKeyHeader }),
        authSecret: resolvedSecret,
        ...(promptFieldName !== undefined && { promptFieldName }),
        ...(fileFieldName !== undefined && { fileFieldName }),
        ...(defaultPrompt !== undefined && { defaultPrompt: defaultPrompt.trim() }),
        ...(staticFormFields !== undefined && { staticFormFields: staticFormFields ?? null }),
        ...(extraHeaders !== undefined && { extraHeaders: extraHeaders ?? null }),
        ...(responseContentPath !== undefined && { responseContentPath }),
        ...(sessionIdResponsePath !== undefined && { sessionIdResponsePath: sessionIdResponsePath ?? null }),
        ...(sessionIdFieldName !== undefined && { sessionIdFieldName: sessionIdFieldName ?? null }),
        ...(timeoutSec !== undefined && { timeoutSec: Number(timeoutSec) }),
        ...(state !== undefined && { state }),
      },
    });

    return NextResponse.json({
      success: true,
      connection: {
        ...updated,
        authSecret: '••••••••',
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[PUT] Failed to update connection', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── DELETE: Remove connection ─────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = await params;

    const existing = await prisma.externalApiConnection.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Connection không tồn tại' }, { status: 404 });
    }

    // ExternalApiOverride cascade-deletes via foreign key
    await prisma.externalApiConnection.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[DELETE] Failed to delete connection', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
