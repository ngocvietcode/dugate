// app/api/internal/ext-connections/[id]/route.ts
// PUT    — Update connection
// DELETE — Delete connection (cascade deletes overrides)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { requireCapability } from '@/lib/auth-guard';
import { validateAiHubPayload } from '@/lib/endpoints/aihub-validation';
import { getSecretProvider } from '@/lib/secrets';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { auditActor, getSourceIp } from '@/lib/audit/context';

const logger = new Logger({ service: 'ext-connections' });


// ─── PUT: Update connection ────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability('connector:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = await params;
    const body = await req.json();

    const [existing] = await db.select().from(externalApiConnections).where(eq(externalApiConnections.id, id)).limit(1);
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
      vaultSecretPath,
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

    // Validate AIHub config (Requirement 10) — runs only when Mode_Marker is present.
    // Placed BEFORE the general update. PUT is a partial update, so fields not resent
    // fall back to the existing record to avoid false validation failures.
    const aihubError = validateAiHubPayload({
      extraHeaders: extraHeaders !== undefined ? extraHeaders : existing.extraHeaders,
      endpointUrl: endpointUrl !== undefined ? endpointUrl : existing.endpointUrl,
      staticFormFields: staticFormFields !== undefined ? staticFormFields : existing.staticFormFields,
    });
    if (aihubError) {
      return NextResponse.json({ success: false, error: aihubError }, { status: 400 });
    }

    // Resolve vaultSecretPath (only when the field is present in the payload).
    const nextVaultPath =
      vaultSecretPath !== undefined
        ? (vaultSecretPath && vaultSecretPath.trim() ? vaultSecretPath.trim() : null)
        : existing.vaultSecretPath;

    // authSecret handling:
    //  - if now using a Vault path → clear the stored raw key (empty string)
    //  - else keep existing unless a new non-masked value is provided
    let resolvedSecret: string;
    if (nextVaultPath) {
      resolvedSecret = '';
    } else if (authSecret && authSecret.trim() && authSecret !== '••••••••') {
      resolvedSecret = authSecret.trim();
    } else {
      resolvedSecret = existing.authSecret;
    }

    const [updated] = await db.update(externalApiConnections).set({
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() ?? null }),
        ...(endpointUrl !== undefined && { endpointUrl: endpointUrl.trim() }),
        ...(httpMethod !== undefined && { httpMethod }),
        ...(authType !== undefined && { authType }),
        ...(authKeyHeader !== undefined && { authKeyHeader }),
        authSecret: resolvedSecret,
        vaultSecretPath: nextVaultPath,
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
    }).where(eq(externalApiConnections.id, id)).returning();

    // Invalidate the cached secret so subsequent requests fetch the fresh value from Vault.
    if (nextVaultPath) {
      getSecretProvider().invalidate(nextVaultPath);
    }
    // Also invalidate the old path if it changed.
    if (existing.vaultSecretPath && existing.vaultSecretPath !== nextVaultPath) {
      getSecretProvider().invalidate(existing.vaultSecretPath);
    }

    // Diff the full row before/after (secrets redacted). authSecret/vaultSecretPath
    // changes are recorded as presence-only via the default redact list.
    await writeAudit({
      entityType: 'CONNECTOR',
      entityId: updated.id,
      entityName: updated.slug,
      action: 'UPDATE',
      outcome: 'SUCCESS',
      changes: buildChanges(existing, updated, AUDIT_POLICIES.CONNECTOR),
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({
      success: true,
      connection: {
        ...updated,
        authSecret: updated.authSecret ? '••••••••' : '',
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
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability('connector:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = await params;

    const [existing] = await db.select().from(externalApiConnections).where(eq(externalApiConnections.id, id)).limit(1);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Connection không tồn tại' }, { status: 404 });
    }

    // ExternalApiOverride cascade-deletes via foreign key
    await db.delete(externalApiConnections).where(eq(externalApiConnections.id, id));

    await writeAudit({
      entityType: 'CONNECTOR',
      entityId: existing.id,
      entityName: existing.slug,
      action: 'DELETE',
      outcome: 'SUCCESS',
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[DELETE] Failed to delete connection', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
