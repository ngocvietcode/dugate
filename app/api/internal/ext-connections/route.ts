// app/api/internal/ext-connections/route.ts
// GET  — List all ExternalApiConnections (authSecret masked)
// POST — Create new connection + auto-create linked Processor

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { requireAdmin, requireAuth } from '@/lib/auth-guard';

const logger = new Logger({ service: 'ext-connections' });



// ─── GET: List all connections ────────────────────────────────────────────────
export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  try {
    const connections = await db.select().from(externalApiConnections).orderBy(asc(externalApiConnections.createdAt));

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
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

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
      sessionIdResponsePath,
      sessionIdFieldName,
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
    const [existing] = await db.select().from(externalApiConnections).where(eq(externalApiConnections.slug, slug)).limit(1);
    if (existing) {
      return NextResponse.json({ success: false, error: `Slug '${slug}' đã tồn tại` }, { status: 409 });
    }

    const [result] = await db.insert(externalApiConnections).values({
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
          sessionIdResponsePath: sessionIdResponsePath ?? null,
          sessionIdFieldName: sessionIdFieldName ?? null,
          timeoutSec: Number(timeoutSec),
          state,
    }).returning();

    return NextResponse.json({
      success: true,
      connection: {
        ...result,
        authSecret: '••••••••',
      },
    }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[POST] Failed to create connection', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
