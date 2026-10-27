import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiKeys, profileEndpoints, operations } from '@/lib/db/schema';
import { eq, inArray, desc, and, count, max } from 'drizzle-orm';
import crypto from 'crypto';
import { Logger } from '@/lib/logger';
import { getAssignedProfileIds, requireCapability, requireProfileAccess } from '@/lib/auth-guard';
import { roleHasCapability } from '@/lib/rbac/resolve';
import { encrypt, decrypt } from '@/lib/crypto';
import { parseFileUrlAuthConfig } from '@/lib/file-url-downloader';
import { validateCallbackPayloadMode } from '@/lib/profile-config/validate';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { auditActor, getSourceIp } from '@/lib/audit/context';

const logger = new Logger({ service: 'apikeys' });

// Profile integration metadata is user-specific and must never be served from
// a browser, CDN, ingress, or Next.js cache after a successful PUT.
export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
};

/** Safely extract non-secret fields from an encrypted config. Never exposes credentials. */
function safeExtractAuthType(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    const json = JSON.parse(decrypt(encrypted));
    const type = json?.type;
    return typeof type === 'string' ? type : null;
  } catch {
    try {
      const json = JSON.parse(encrypted);
      const type = json?.type;
      return typeof type === 'string' ? type : null;
    } catch {
      return null;
    }
  }
}

/**
 * Build a masked preview of an inline auth value: first 3 + fixed dots + last 3.
 * Short values (<= 6 chars) are fully masked to avoid leaking most of the value.
 * Returns undefined when there is no inline value to mask (e.g. Vault reference),
 * because the server must not resolve Vault just to render a preview.
 */
function maskSecretPreview(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (value.length <= 6) return '•'.repeat(value.length);
  return `${value.slice(0, 3)}•••••••••••••••${value.slice(-3)}`;
}

/**
 * Extract non-secret metadata from an encrypted auth config for admin display.
 *
 * Secret VALUES (inline token/header_value/query_value/client_secret) are NEVER
 * returned raw — only a masked preview (first 3 + last 3 chars) so a saved inline
 * credential is recognizable.
 *
 * Vault secret REFERENCES (…_secret_ref) are returned in FULL: a Vault path is a
 * permission-guarded pointer, not the secret itself, and operators need to see and
 * edit it. Returning it lets the UI show the exact configured path after reload.
 */
function safeExtractAuthMetadata(encrypted: string | null | undefined): Record<string, unknown> | null {
  if (!encrypted) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(decrypt(encrypted));
  } catch {
    try { json = JSON.parse(encrypted); } catch { return null; }
  }
  if (!json || typeof json !== 'object') return null;
  // Only expose non-secret, structural fields
  const safe: Record<string, unknown> = { type: json.type };
  if (json.token_url) safe.token_url = json.token_url;
  if (json.client_id) safe.client_id = json.client_id;
  if (json.header_name) safe.header_name = json.header_name;
  if (json.query_key) safe.query_key = json.query_key;
  if (json.token_body_format) safe.token_body_format = json.token_body_format;
  if (json.token_auth_style) safe.token_auth_style = json.token_auth_style;
  if (json.scope) safe.scope = json.scope;
  if (json.audience) safe.audience = json.audience;
  if (json.token_response_path) safe.token_response_path = json.token_response_path;
  if (json.ibm_client_id) safe.ibm_client_id = json.ibm_client_id;
  // Vault references are returned in full (see doc comment). Inline secret values
  // are only ever returned as a masked preview.
  if (json.client_secret_ref) safe.client_secret_ref = json.client_secret_ref;
  if (json.token_secret_ref) safe.token_secret_ref = json.token_secret_ref;
  if (json.header_value_secret_ref) safe.header_value_secret_ref = json.header_value_secret_ref;
  if (json.query_value_secret_ref) safe.query_value_secret_ref = json.query_value_secret_ref;
  const clientSecretPreview = maskSecretPreview(json.client_secret);
  if (clientSecretPreview) safe.client_secret_preview = clientSecretPreview;
  const tokenPreview = maskSecretPreview(json.token);
  if (tokenPreview) safe.token_preview = tokenPreview;
  const headerValuePreview = maskSecretPreview(json.header_value);
  if (headerValuePreview) safe.header_value_preview = headerValuePreview;
  const queryValuePreview = maskSecretPreview(json.query_value);
  if (queryValuePreview) safe.query_value_preview = queryValuePreview;
  // Gateway headers: expose names, masked previews of inline values, and full
  // Vault references (a path, not the secret itself).
  if (Array.isArray(json.gateway_headers)) {
    safe.gateway_headers = (json.gateway_headers as Array<Record<string, unknown>>).map(h => ({
      name: h.name,
      // Flag whether a value exists without exposing it
      hasValue: Boolean(h.value || h.value_secret_ref),
      ...(maskSecretPreview(h.value) ? { valuePreview: maskSecretPreview(h.value) } : {}),
      ...(h.value_secret_ref ? { value_secret_ref: h.value_secret_ref } : {}),
    }));
  }
  // Flag that secrets exist (for UI "already configured" indicator)
  safe._hasSecret = Boolean(
    json.token || json.token_secret_ref || json.header_value || json.header_value_secret_ref
    || json.query_value || json.query_value_secret_ref || json.client_secret || json.client_secret_ref
  );
  return safe;
}

/**
 * Merge operator-supplied non-secret fields into the existing stored auth config,
 * preserving all secret material (inline secrets and Vault references) when the
 * operator did not provide a replacement. This is what lets an admin edit
 * Token URL / Client ID / header names WITHOUT re-typing the client secret.
 *
 * `incoming` is the parsed, validated config from the request. `storedEncrypted`
 * is the current ciphertext column. Returns a fully-formed AuthConfig to encrypt.
 */
function mergeAuthConfigPreservingSecrets(
  incoming: Record<string, unknown>,
  storedEncrypted: string | null | undefined,
): Record<string, unknown> {
  // An explicit null means "delete this field". It is stripped on EVERY path, including
  // the early returns below, because parseFileUrlAuthConfig rejects a null-valued
  // optional field and would turn an intentional clear into a 400.
  const withoutCleared = (value: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));

  if (!storedEncrypted) return withoutCleared(incoming);
  let stored: Record<string, unknown> | null = null;
  try {
    stored = JSON.parse(decrypt(storedEncrypted));
  } catch {
    try { stored = JSON.parse(storedEncrypted); } catch { stored = null; }
  }
  // Only merge stored auth values forward when the stored config is the SAME auth type.
  // A type change (e.g. bearer -> oauth2) means the old value is irrelevant.
  if (!stored || typeof stored !== 'object' || stored.type !== incoming.type) {
    return withoutCleared(incoming);
  }

  const merged: Record<string, unknown> = { ...incoming };

  // Carry forward non-secret structural fields the client omitted. Without this the
  // fields are replace-only: a caller that PATCHes just `{ type, client_secret }` would
  // silently wipe a stored token_url / client_id / scope.
  //
  // Three cases, and the difference between the last two matters:
  //   value present  -> incoming wins
  //   null           -> delete (authConfigPatch emits this for an optional field the
  //                     operator just blanked, because stripDraftMetadata drops '')
  //   absent         -> keep the stored value (a partial PATCH must not wipe anything)
  //
  // `gateway_headers` is deliberately NOT in this list — an absent array is how the UI
  // expresses "remove every header", so inheriting it would break deletion.
  const NON_SECRET_FIELDS = [
    'token_url', 'client_id', 'header_name', 'query_key', 'token_body_format',
    'token_auth_style', 'scope', 'audience', 'token_response_path', 'csp_chunk_size',
    'ibm_client_id',
  ] as const;
  for (const key of NON_SECRET_FIELDS) {
    if (incoming[key] === null) { delete merged[key]; continue; }
    if (incoming[key] === undefined && stored[key] !== undefined) merged[key] = stored[key];
  }

  const SECRET_PAIRS: Array<[string, string]> = [
    ['token', 'token_secret_ref'],
    ['header_value', 'header_value_secret_ref'],
    ['query_value', 'query_value_secret_ref'],
    ['client_secret', 'client_secret_ref'],
  ];
  for (const [inlineKey, refKey] of SECRET_PAIRS) {
    const incomingHasSecret = Boolean(incoming[inlineKey] || incoming[refKey]);
    if (incomingHasSecret) continue; // operator supplied a replacement — keep it
    if (stored[inlineKey] !== undefined) merged[inlineKey] = stored[inlineKey];
    if (stored[refKey] !== undefined) merged[refKey] = stored[refKey];
  }

  // Merge gateway-header secret values by header name when the incoming row has
  // no new value/ref (name-only edit keeps the previously stored value/ref).
  if (Array.isArray(merged.gateway_headers) && Array.isArray(stored.gateway_headers)) {
    const storedByName = new Map(
      (stored.gateway_headers as Array<Record<string, unknown>>).map(h => [String(h.name), h]),
    );
    merged.gateway_headers = (merged.gateway_headers as Array<Record<string, unknown>>).map(h => {
      if (h.value || h.value_secret_ref) return h; // replacement supplied
      const prior = storedByName.get(String(h.name));
      if (!prior) return h;
      return {
        ...h,
        ...(prior.value !== undefined ? { value: prior.value } : {}),
        ...(prior.value_secret_ref !== undefined ? { value_secret_ref: prior.value_secret_ref } : {}),
      };
    });
  }
  return merged;
}

const SAFE_API_KEY_FIELDS = {
  id: apiKeys.id,
  name: apiKeys.name,
  displayName: apiKeys.displayName,
  status: apiKeys.status,
  note: apiKeys.note,
  rateLimitPerMin: apiKeys.rateLimitPerMin,
};

type DisplayNameResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

function normalizeDisplayName(value: unknown): DisplayNameResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: 'Tên hiển thị phải là chuỗi hoặc null' };
  }
  const normalized = value.trim();
  if (normalized.length > 120) {
    return { ok: false, error: 'Tên hiển thị không được vượt quá 120 ký tự' };
  }
  return { ok: true, value: normalized || null };
}

/**
 * Operational summary used by the Profile index table. Both values are read-only
 * aggregates over existing indexed columns:
 *   - enabledEndpoints: group-by on ProfileEndpoint (never a per-row query)
 *   - lastActivityAt:   max(createdAt) on Operation, served by
 *                       operation_apiKeyId_createdAt_idx
 * Failure here must not break the Profile list, so callers fall back to nulls.
 */
async function loadProfileSummaries(profileIds: string[]) {
  const enabledEndpoints = new Map<string, number>();
  const lastActivityAt = new Map<string, Date>();
  if (profileIds.length === 0) return { enabledEndpoints, lastActivityAt };

  try {
    const [endpointRows, activityRows] = await Promise.all([
      db.select({ apiKeyId: profileEndpoints.apiKeyId, total: count() })
        .from(profileEndpoints)
        .where(and(inArray(profileEndpoints.apiKeyId, profileIds), eq(profileEndpoints.enabled, true)))
        .groupBy(profileEndpoints.apiKeyId),
      db.select({ apiKeyId: operations.apiKeyId, lastAt: max(operations.createdAt) })
        .from(operations)
        .where(inArray(operations.apiKeyId, profileIds))
        .groupBy(operations.apiKeyId),
    ]);
    for (const row of endpointRows) enabledEndpoints.set(row.apiKeyId, Number(row.total));
    for (const row of activityRows) {
      if (row.apiKeyId && row.lastAt) lastActivityAt.set(row.apiKeyId, row.lastAt);
    }
  } catch (error: unknown) {
    logger.error('[GET] Profile summary aggregate failed; serving list without summaries', {}, error);
  }
  return { enabledEndpoints, lastActivityAt };
}

export async function GET() {
  const guard = await requireCapability('profile:read');
  if (guard instanceof NextResponse) return guard;
  const canManageProfile = await roleHasCapability(guard.session.user.role, 'profile:update');

  try {
    const assignedIds = await getAssignedProfileIds('profile:read');
    const whereCondition = assignedIds === null ? undefined : inArray(apiKeys.id, assignedIds);
    // Select integration fields only to derive presence flags and the Profile
    // payload mode. Destination/lock columns remain in the database as no-ops.
    const keys = await db.select({
      ...SAFE_API_KEY_FIELDS,
      fileAuthConfig: apiKeys.fileAuthConfig,
      callbackAuthConfig: apiKeys.callbackAuthConfig,
      callbackPayload: apiKeys.callbackPayload,
    })
      .from(apiKeys)
      .where(whereCondition)
      .orderBy(desc(apiKeys.createdAt));

    const { enabledEndpoints, lastActivityAt } = await loadProfileSummaries(keys.map(key => key.id));
    const enriched = keys.map(key => {
      const { fileAuthConfig, callbackAuthConfig, callbackPayload, ...safe } = key;
      // Extract only the auth type from encrypted config (never secrets).
      const fileAuthType = safeExtractAuthType(fileAuthConfig);
      const callbackAuthType = safeExtractAuthType(callbackAuthConfig);
      // Managers can reload non-secret integration metadata; read-only users
      // receive only configuration-presence flags.
      const fileAuthMetadata = canManageProfile ? safeExtractAuthMetadata(fileAuthConfig) : null;
      const callbackAuthMetadata = canManageProfile ? safeExtractAuthMetadata(callbackAuthConfig) : null;
      return {
        ...safe,
        enabledEndpoints: enabledEndpoints.get(key.id) ?? 0,
        lastActivityAt: lastActivityAt.get(key.id)?.toISOString() ?? null,
        fileAuthConfigured: Boolean(fileAuthConfig),
        callbackAuthConfigured: Boolean(callbackAuthConfig),
        ...(canManageProfile ? { fileAuthType, callbackAuthType, fileAuthMetadata, callbackAuthMetadata, callbackPayload } : {}),
      };
    });
    return NextResponse.json(
      { success: true, apiKeys: enriched },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: unknown) {
    logger.error('[GET] DB error', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, note, action, rateLimitPerMin } = body;
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ success: false, error: 'Thiếu ID' }, { status: 400 });
    }

    const guard = await requireProfileAccess(
      id,
      action === 'rotate' ? 'profile:rotate' : 'profile:update',
    );
    if (guard instanceof NextResponse) return guard;
    if (has('name')) {
      return NextResponse.json({ success: false, error: 'Internal name không được phép thay đổi' }, { status: 400 });
    }

    if (action === 'rotate') {
      const rawKey = 'dg_' + crypto.randomBytes(32).toString('base64url');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const [updatedKey] = await db.update(apiKeys)
        .set({ keyHash })
        .where(eq(apiKeys.id, id))
        .returning(SAFE_API_KEY_FIELDS);
      if (!updatedKey) {
        return NextResponse.json({ success: false, error: 'Không tìm thấy Profile' }, { status: 404 });
      }
      // Key rotation: record THAT the key changed, never any key material.
      await writeAudit({
        entityType: 'PROFILE',
        entityId: updatedKey.id,
        entityName: updatedKey.name,
        action: 'ROTATE_KEY',
        outcome: 'SUCCESS',
        ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
        sourceIp: getSourceIp(req),
      });
      return NextResponse.json({ success: true, apiKey: updatedKey, rawKey });
    }

    const updates: {
      note?: string;
      rateLimitPerMin?: number;
      displayName?: string | null;
      fileAuthConfig?: string | null;
      callbackAuthConfig?: string | null;
      callbackPayload?: string | null;
    } = {};
    if (note !== undefined) {
      if (typeof note !== 'string' || note.length > 2000) {
        return NextResponse.json({ success: false, error: 'Ghi chú không hợp lệ' }, { status: 400 });
      }
      updates.note = note;
    }
    if (rateLimitPerMin !== undefined) {
      const n = Number(rateLimitPerMin);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json({ success: false, error: 'rateLimitPerMin phải là số nguyên >= 0' }, { status: 400 });
      }
      updates.rateLimitPerMin = n;
    }
    if (has('displayName')) {
      const displayName = normalizeDisplayName(body.displayName);
      if (!displayName.ok) {
        return NextResponse.json({ success: false, error: displayName.error }, { status: 400 });
      }
      updates.displayName = displayName.value;
    }
    // ── Profile-level integration config (5 additive fields) ─────────────────
    // Secrets are validated then encrypted; only ciphertext reaches db.update().
    // When only non-secret fields change, the previously stored secret/Vault ref
    // is merged forward so the operator never has to re-enter it.
    const needsStoredConfig = (has('fileAuthConfig') && body.fileAuthConfig !== null)
      || (has('callbackAuthConfig') && body.callbackAuthConfig !== null);

    // Single read for both secret-merge and audit before-snapshot. This
    // eliminates the race window between two separate SELECTs.
    const [snapshotRow] = await db.select({
      note: apiKeys.note,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      displayName: apiKeys.displayName,
      fileAuthConfig: apiKeys.fileAuthConfig,
      callbackAuthConfig: apiKeys.callbackAuthConfig,
      callbackPayload: apiKeys.callbackPayload,
    }).from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    if (needsStoredConfig && !snapshotRow) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy Profile' }, { status: 404 });
    }
    const beforeRow = snapshotRow ?? null;
    const storedConfig = snapshotRow
      ? { fileAuthConfig: snapshotRow.fileAuthConfig, callbackAuthConfig: snapshotRow.callbackAuthConfig }
      : undefined;

    if (has('fileAuthConfig')) {
      if (body.fileAuthConfig === null) {
        updates.fileAuthConfig = null;
      } else if (!body.fileAuthConfig || typeof body.fileAuthConfig !== 'object') {
        return NextResponse.json({ success: false, error: 'fileAuthConfig không hợp lệ' }, { status: 400 });
      } else {
        // Merge stored secret material into the raw submission FIRST, so a
        // non-secret-only edit (e.g. Token URL) still passes secret validation.
        const merged = mergeAuthConfigPreservingSecrets(
          body.fileAuthConfig as Record<string, unknown>,
          storedConfig?.fileAuthConfig,
        );
        const cfg = parseFileUrlAuthConfig(merged);
        if (!cfg || cfg.type === 'none') {
          return NextResponse.json({ success: false, error: 'fileAuthConfig không hợp lệ' }, { status: 400 });
        }
        updates.fileAuthConfig = encrypt(JSON.stringify(cfg));
      }
    }
    if (has('callbackAuthConfig')) {
      if (body.callbackAuthConfig === null) {
        updates.callbackAuthConfig = null;
      } else if (!body.callbackAuthConfig || typeof body.callbackAuthConfig !== 'object') {
        return NextResponse.json({ success: false, error: 'callbackAuthConfig không hợp lệ' }, { status: 400 });
      } else {
        const merged = mergeAuthConfigPreservingSecrets(
          body.callbackAuthConfig as Record<string, unknown>,
          storedConfig?.callbackAuthConfig,
        );
        const cfg = parseFileUrlAuthConfig(merged);
        // 'query' is rejected for callbacks: it puts the credential in the URL
        // query string, which leaks into the receiver's access logs / proxies.
        // (File downloads may still use 'query'; only the callback direction is restricted.)
        if (!cfg || cfg.type === 'none' || cfg.type === 'query') {
          return NextResponse.json(
            {
              success: false,
              error: cfg?.type === 'query'
                ? "callbackAuthConfig không hợp lệ: kiểu 'query' không dùng được cho callback (token lọt vào log hệ nhận)"
                : 'callbackAuthConfig không hợp lệ',
            },
            { status: 400 },
          );
        }
        updates.callbackAuthConfig = encrypt(JSON.stringify(cfg));
      }
    }
    if (has('callbackPayload')) {
      const result = validateCallbackPayloadMode(body.callbackPayload);
      if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }
      updates.callbackPayload = result.value;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'Không có trường hợp lệ để cập nhật' }, { status: 400 });
    }

    // Snapshot already captured above in snapshotRow; no additional read needed.

    const [updatedKey] = await db.update(apiKeys)
      .set(updates)
      .where(eq(apiKeys.id, id))
      .returning(SAFE_API_KEY_FIELDS);
    if (!updatedKey) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy Profile' }, { status: 404 });
    }
    // Audit the profile update. `updates` holds only the changed columns; the
    // diff is computed against the pre-update snapshot with secrets redacted.
    await writeAudit({
      entityType: 'PROFILE',
      entityId: updatedKey.id,
      entityName: updatedKey.name,
      action: 'UPDATE',
      outcome: 'SUCCESS',
      changes: buildChanges(beforeRow ?? null, { ...beforeRow, ...updates }, AUDIT_POLICIES.PROFILE),
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });
    // Return refreshed non-secret metadata so the client can rebuild the draft
    // immediately after save, without waiting for a full reload. Secrets stay
    // masked/omitted exactly as in GET.
    const responseExtras: Record<string, unknown> = {};
    if (updates.fileAuthConfig !== undefined) {
      responseExtras.fileAuthConfigured = Boolean(updates.fileAuthConfig);
      responseExtras.fileAuthType = safeExtractAuthType(updates.fileAuthConfig);
      responseExtras.fileAuthMetadata = safeExtractAuthMetadata(updates.fileAuthConfig);
    }
    if (updates.callbackAuthConfig !== undefined) {
      responseExtras.callbackAuthConfigured = Boolean(updates.callbackAuthConfig);
      responseExtras.callbackAuthType = safeExtractAuthType(updates.callbackAuthConfig);
      responseExtras.callbackAuthMetadata = safeExtractAuthMetadata(updates.callbackAuthConfig);
    }
    if (updates.callbackPayload !== undefined) responseExtras.callbackPayload = updates.callbackPayload;

    return NextResponse.json(
      { success: true, apiKey: { ...updatedKey, ...responseExtras } },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: unknown) {
    logger.error('[PUT] DB error', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireCapability('profile:create');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await req.json();
    const { name } = body;
    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 120) {
      return NextResponse.json({ success: false, error: 'Tên kỹ thuật không hợp lệ' }, { status: 400 });
    }
    const displayName = normalizeDisplayName(body.displayName);
    if (!displayName.ok) {
      return NextResponse.json({ success: false, error: displayName.error }, { status: 400 });
    }

    const rawKey = 'dg_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const [apiKey] = await db.insert(apiKeys).values({
      name: name.trim(),
      displayName: displayName.value,
      keyHash,
      prefix: 'dg_',
      status: 'active',
    }).returning(SAFE_API_KEY_FIELDS);

    await writeAudit({
      entityType: 'PROFILE',
      entityId: apiKey.id,
      entityName: apiKey.name,
      action: 'CREATE',
      outcome: 'SUCCESS',
      changes: buildChanges(null, {
        name: apiKey.name,
        displayName: apiKey.displayName,
        status: apiKey.status,
      }, AUDIT_POLICIES.PROFILE),
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({
      success: true,
      apiKey,
      rawKey,
    });
  } catch (error: unknown) {
    logger.error('[POST] DB error', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Thiếu ID' }, { status: 400 });

    const guard = await requireProfileAccess(id, 'profile:delete');
    if (guard instanceof NextResponse) return guard;

    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    if (!key) return NextResponse.json({ success: false, error: 'Không tìm thấy Profile' }, { status: 404 });
    if (key.name === 'Global Profile') {
      return NextResponse.json({ success: false, error: 'Global Profile không được phép xóa' }, { status: 403 });
    }

    await db.delete(apiKeys).where(eq(apiKeys.id, id));

    await writeAudit({
      entityType: 'PROFILE',
      entityId: key.id,
      entityName: key.name,
      action: 'DELETE',
      outcome: 'SUCCESS',
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('[DELETE] DB error', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
