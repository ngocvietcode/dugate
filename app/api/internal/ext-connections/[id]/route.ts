// app/api/internal/ext-connections/[id]/route.ts
// PUT    — Update connection (authSecret optional)
// DELETE — Delete connection (cascade deletes Processor + overrides)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ─── PUT: Update connection ────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
      authSecret,     // undefined or '' = keep existing
      promptFieldName,
      fileFieldName,
      defaultPrompt,
      staticFormFields,
      extraHeaders,
      responseContentPath,
      timeoutSec,
      state,
    } = body;

    // Only update authSecret if a non-empty value is provided
    const resolvedSecret =
      authSecret && authSecret.trim() && authSecret !== '••••••••'
        ? authSecret.trim()
        : existing.authSecret;

    const updated = await prisma.$transaction(async (tx) => {
      const connection = await tx.externalApiConnection.update({
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
          ...(timeoutSec !== undefined && { timeoutSec: Number(timeoutSec) }),
          ...(state !== undefined && { state }),
        },
      });

      // Sync linked Processor's displayName and state
      await tx.processor.updateMany({
        where: { externalApiConnectionId: id },
        data: {
          ...(name !== undefined && { displayName: name.trim() }),
          ...(state !== undefined && { state }),
        },
      });

      return connection;
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
    console.error('[ExtConnections PUT]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── DELETE: Remove connection ─────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const existing = await prisma.externalApiConnection.findUnique({
      where: { id },
      include: { processors: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Connection không tồn tại' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      // Xóa linked Processors trước
      await tx.processor.deleteMany({ where: { externalApiConnectionId: id } });
      // ExternalApiOverride sẽ tự cascade delete theo connection
      await tx.externalApiConnection.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ExtConnections DELETE]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
