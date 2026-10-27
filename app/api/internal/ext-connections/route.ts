// app/api/internal/ext-connections/route.ts
// GET  — List all ExternalApiConnections (authSecret masked)
// POST — Create new connection + auto-create linked Processor

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { requireCapability } from '@/lib/auth-guard';
import { roleHasCapability } from '@/lib/rbac/resolve';
import { validateAiHubPayload } from '@/lib/endpoints/aihub-validation';
import { resolveConnectionPrompt } from '@/lib/endpoints/aihub-config';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { auditActor, getSourceIp } from '@/lib/audit/context';

const logger = new Logger({ service: 'ext-connections' });



// ─── GET: List all connections ────────────────────────────────────────────────
export async function GET() {
  const guard = await requireCapability('connector:read');
  if (guard instanceof NextResponse) return guard;
  const canManageConnectors = await roleHasCapability(guard.session.user.role, 'connector:manage');

  try {
    const connections = await db.select().from(externalApiConnections).orderBy(asc(externalApiConnections.createdAt));

    // Two audiences, two shapes:
    //  - connector managers can configure connectors, so receive the full
    //    non-secret row.
    //  - readers need only identity and prompt/model metadata for profiles.
    // Returning the full row to every authenticated user exposed endpointUrl,
    // vaultSecretPath, authKeyHeader and extraHeaders — the latter routinely holds
    // custom auth headers — to accounts with no Profile assignment at all.
    if (!canManageConnectors) {
      return NextResponse.json({
        success: true,
        connections: connections.map((c) => {
          // Resolve the human-facing prompt server-side so the client never needs
          // `extraHeaders` (which routinely carries custom auth headers). For AIHub
          // connectors this surfaces system_prompt/user_prompt instead of the raw
          // JSON chat-body wrapper stored in `defaultPrompt`.
          const rp = resolveConnectionPrompt({
            extraHeaders: c.extraHeaders,
            staticFormFields: c.staticFormFields,
            defaultPrompt: c.defaultPrompt,
          });
          return {
            id: c.id,
            slug: c.slug,
            name: c.name,
            description: c.description,
            defaultPrompt: c.defaultPrompt,
            staticFormFields: c.staticFormFields,
            state: c.state,
            connectionMode: rp.mode,
            effectivePrompt: rp.effectivePrompt,
            systemPrompt: rp.systemPrompt,
          };
        }),
      });
    }

    // Mask authSecret — never expose to frontend
    const masked = connections.map((c) => {
      const rp = resolveConnectionPrompt({
        extraHeaders: c.extraHeaders,
        staticFormFields: c.staticFormFields,
        defaultPrompt: c.defaultPrompt,
      });
      return {
        ...c,
        authSecret: c.authSecret ? '••••••••' : '',
        connectionMode: rp.mode,
        effectivePrompt: rp.effectivePrompt,
        systemPrompt: rp.systemPrompt,
      };
    });

    return NextResponse.json({ success: true, connections: masked });
  } catch (error: unknown) {
    logger.error('[GET] Failed to list connections', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

// ─── POST: Create new connection + auto-create Processor ──────────────────────
export async function POST(req: NextRequest) {
  const guard = await requireCapability('connector:manage');
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
      vaultSecretPath,
      promptFieldName = 'query',
      fileFieldName = 'files',
      defaultPrompt,
      staticFormFields,
      extraHeaders,
      responseContentPath = 'content',
      sessionIdResponsePath,
      sessionIdFieldName,
      timeoutSec = 300,
      state = 'ENABLED',
    } = body;

    // Validate AIHub config (Requirement 10) — runs only when Mode_Marker is present.
    // Placed BEFORE the general validation; returns null (skip) for non-AIHub payloads.
    const aihubError = validateAiHubPayload(body);
    if (aihubError) {
      return NextResponse.json({ success: false, error: aihubError }, { status: 400 });
    }

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
    const usingVault = !!(vaultSecretPath && vaultSecretPath.trim());
    if (!authSecret?.trim() && !usingVault && authType !== 'NONE') {
      return NextResponse.json({ success: false, error: 'Cần nhập Vault Secret Path hoặc Auth Secret' }, { status: 400 });
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
          // When using Vault, the raw key is NOT stored in the DB (empty string).
          authSecret: usingVault ? '' : (authSecret?.trim() ?? ''),
          vaultSecretPath: usingVault ? vaultSecretPath.trim() : null,
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

    await writeAudit({
      entityType: 'CONNECTOR',
      entityId: result.id,
      entityName: result.slug,
      action: 'CREATE',
      outcome: 'SUCCESS',
      changes: buildChanges(null, {
        name: result.name,
        slug: result.slug,
        endpointUrl: result.endpointUrl,
        httpMethod: result.httpMethod,
        authType: result.authType,
        state: result.state,
        // Redacted by buildChanges — only presence is recorded.
        authSecret: result.authSecret || undefined,
        vaultSecretPath: result.vaultSecretPath || undefined,
      }, AUDIT_POLICIES.CONNECTOR),
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({
      success: true,
      connection: {
        ...result,
        authSecret: result.authSecret ? '••••••••' : '',
      },
    }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[POST] Failed to create connection', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
