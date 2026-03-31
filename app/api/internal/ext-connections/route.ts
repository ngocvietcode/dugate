// app/api/internal/ext-connections/route.ts
// GET  — List all ExternalApiConnections (authSecret masked)
// POST — Create new connection + auto-create linked Processor

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ─── GET: List all connections ────────────────────────────────────────────────
export async function GET() {
  try {
    const connections = await prisma.externalApiConnection.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        processors: {
          select: { id: true, slug: true, state: true },
        },
      },
    });

    // Mask authSecret — never expose to frontend
    const masked = connections.map((c) => ({
      ...c,
      authSecret: c.authSecret ? '••••••••' : '',
    }));

    return NextResponse.json({ success: true, connections: masked });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── POST: Create new connection + auto-create Processor ──────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      slug,
      description,
      endpointUrl,
      httpMethod = 'POST',
      authType = 'API_KEY_HEADER',
      authKeyHeader = 'x-api-key',
      authSecret,
      promptFieldName = 'query',
      fileFieldName = 'files',
      defaultPrompt,
      staticFormFields,
      extraHeaders,
      responseContentPath = 'content',
      timeoutSec = 60,
      state = 'ENABLED',
    } = body;

    // Validate required fields
    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'Tên connection không được để trống' }, { status: 400 });
    }
    if (!slug?.trim()) {
      return NextResponse.json({ success: false, error: 'Slug không được để trống' }, { status: 400 });
    }
    if (!endpointUrl?.trim()) {
      return NextResponse.json({ success: false, error: 'Endpoint URL không được để trống' }, { status: 400 });
    }
    if (!authSecret?.trim() && authType !== 'NONE') {
      return NextResponse.json({ success: false, error: 'Auth Secret không được để trống' }, { status: 400 });
    }
    if (!defaultPrompt?.trim()) {
      return NextResponse.json({ success: false, error: 'Default Prompt không được để trống' }, { status: 400 });
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ success: false, error: 'Slug chỉ được chứa chữ thường, số và dấu gạch ngang' }, { status: 400 });
    }

    // Check slug uniqueness
    const existing = await prisma.externalApiConnection.findUnique({ where: { slug } });
    if (existing) {
      return NextResponse.json({ success: false, error: `Slug '${slug}' đã tồn tại` }, { status: 409 });
    }

    // Transaction: tạo connection + auto-create linked Processor
    const result = await prisma.$transaction(async (tx) => {
      const connection = await tx.externalApiConnection.create({
        data: {
          name: name.trim(),
          slug: slug.trim(),
          description: description?.trim() ?? null,
          endpointUrl: endpointUrl.trim(),
          httpMethod,
          authType,
          authKeyHeader,
          authSecret: authSecret?.trim() ?? '',
          promptFieldName,
          fileFieldName,
          defaultPrompt: defaultPrompt.trim(),
          staticFormFields: staticFormFields ?? null,
          extraHeaders: extraHeaders ?? null,
          responseContentPath,
          timeoutSec: Number(timeoutSec),
          state,
        },
      });

      // Auto-create a Processor linked to this connection
      const processor = await tx.processor.create({
        data: {
          slug: connection.slug,
          displayName: connection.name,
          type: 'EXTERNAL_API',
          category: 'extract',
          description: connection.description ?? `External AI service: ${connection.name}`,
          state: connection.state,
          // Placeholder values (không dùng cho EXTERNAL_API)
          systemPrompt: '',
          acceptedMimes: 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          outputFormats: 'md',
          canBeFirstStep: true,
          canBeChainStep: false,
          externalApiConnectionId: connection.id,
        },
      });

      return { connection, processor };
    });

    return NextResponse.json({
      success: true,
      connection: {
        ...result.connection,
        authSecret: '••••••••', // Mask on return
      },
      processor: result.processor,
    }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ExtConnections POST]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
