// lib/endpoints/runner.ts
// Universal endpoint dispatcher for all 6 API services.
// Delegates to: profile-resolver (profile loading + param merge), submit (job submission).

import { NextRequest, NextResponse } from 'next/server';
import { submitPipelineJob } from '@/lib/pipelines/submit';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { encryptOperationResponse } from '@/lib/crypto/operation-response-encrypt';
import { SERVICE_REGISTRY, resolveAllowedExtensions } from './registry';
import { EXTRACT_PRESETS, buildGuardedExtractFields, bboxInstruction } from './presets';
import { Logger } from '@/lib/logger';
import {
  getFileUrlAuthConfig,
  loadProfileEndpoint,
  mergeParameters,
  parseConnectionSteps,
} from './profile-resolver';
import { parseFileUrlsInput, applyDefaultChunks } from './file-urls-input';
import { type FileUrlEntry } from '@/lib/file-url-downloader';
import { resolveCallbackTarget } from '@/lib/delivery/resolve-target';
import { enforceRateLimit } from '@/lib/rate-limit';
import { BASE_TYPE_URI } from '@/lib/errors';
import { extractClientReference } from '@/lib/reference-extract';
import crypto from 'crypto';

// ─── Error helper ─────────────────────────────────────────────────────────────

export function apiError(status: number, title: string, detail: string, type?: string): NextResponse {
  return NextResponse.json(
    {
      type: type ?? `${BASE_TYPE_URI}/${title.toLowerCase().replace(/\s+/g, '-')}`,
      title,
      status,
      detail,
    },
    { status },
  );
}

// ─── File normalization ───────────────────────────────────────────────────────

/**
 * Normalize file inputs: accepts `file` (single), `files[]` and `files` (multi).
 * Always returns an array for consistent downstream handling.
 *
 * `files` (không có `[]`) là alias thêm vào để khớp contract SRS của
 * financial-report-translation (curl -F "files=@a.pdf"). Thêm alias là lựa chọn
 * không phá caller cũ — xem PLAN/TASK-1-WORKFLOW.md §11 Option A.
 */
export function normalizeFiles(form: FormData): File[] {
  const result: File[] = [];
  const isUsable = (f: unknown): f is File => f instanceof File && f.size > 0;

  const bracketFiles = (form.getAll('files[]') as unknown[]).filter(isUsable);
  result.push(...bracketFiles);

  // `files` is an ALIAS for the same slot as `files[]`, so it is read only when
  // `files[]` supplied nothing.
  //
  // normalizeFiles is shared by all 7 endpoints. Reading both unconditionally
  // means a caller that sends the same document under both names — a common
  // "be safe" pattern — would have it attached twice: two AI attachments, double
  // tokens, double cost and a duplicated document in the output. Gating the alias
  // keeps every existing `files[]` caller byte-identical while still honouring the
  // financial-report SRS contract (`curl -F "files=@a.pdf"`).
  if (bracketFiles.length === 0) {
    result.push(...(form.getAll('files') as unknown[]).filter(isUsable));
  }

  const source = form.get('source_file');
  if (source instanceof File && source.size > 0) result.push(source);

  const target = form.get('target_file');
  if (target instanceof File && target.size > 0) result.push(target);

  const single = form.get('file');
  if (single instanceof File && single.size > 0) result.push(single);

  return result;
}

// ─── ApiKey-level file auth (tier 3) ───────────────────────────────────────────

/**
 * Load the Profile-level (ApiKey) `fileAuthConfig` used as the tier-3 fallback
 * for file download authentication. Reuses the ApiKey record already fetched
 * during auth resolution when available; otherwise fetches only the one column.
 * Returns the raw stored value (encrypted or legacy JSON) or null.
 */
async function loadApiKeyFileAuthConfig(
  apiKeyId: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiKeyRecord: any,
): Promise<string | null> {
  if (!apiKeyId) return null;
  if (apiKeyRecord && 'fileAuthConfig' in apiKeyRecord) {
    return (apiKeyRecord.fileAuthConfig as string | null) ?? null;
  }
  const { db } = await import('@/lib/db');
  const { apiKeys } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const [row] = await db
    .select({ fileAuthConfig: apiKeys.fileAuthConfig })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1);
  return row?.fileAuthConfig ?? null;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runEndpoint(serviceSlug: string, req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const logger = new Logger({ correlationId, service: serviceSlug });
  const startedAt = Date.now();

  logger.info(`[REQUEST] Incoming /v1/${serviceSlug}`, {
    method: req.method,
    url: req.url,
    apiKeyId: req.headers.get('x-api-key-id') ?? undefined,
    userId: req.headers.get('x-user-id') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
    idempotencyKey: req.headers.get('idempotency-key') ?? undefined,
    sync: new URL(req.url).searchParams.get('sync') === 'true',
  });

  try {
    // ── 1. Lookup service ───────────────────────────────────────────────────
    const service = SERVICE_REGISTRY[serviceSlug];
    if (!service) {
      return apiError(404, 'Service Not Found', `Service '${serviceSlug}' is not registered.`);
    }

    // ── 1b. Authorization note ─────────────────────────────────────────────
    // No role gate here: /api/v1 submit is authorized by API-key resolution
    // (below) for server-to-server callers, or by the NextAuth session for
    // browser operators (roles are ADMIN/OPS). Destructive actions such as
    // deleting an operation are guarded separately in their own routes.

    // ── 1c. Resolve API key from raw x-api-key header (BEFORE body parse) ──
    // Resolved early so rate limiting can reject before the (up to 300MB) formData
    // parse, and so the full ApiKey record can be reused downstream (no re-query).
    // Middleware no longer validates x-api-key at the edge; we do it here.
    // IMPORTANT: If a key is provided but invalid/revoked/inactive → hard reject (401/403).
    let apiKeyId = req.headers.get('x-api-key-id') ?? undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let apiKeyRecord: any = null;
    if (!apiKeyId) {
      const rawKey = req.headers.get('x-api-key');
      if (rawKey) {
        try {
          const { db } = await import('@/lib/db');
          const { apiKeys } = await import('@/lib/db/schema');
          const { eq } = await import('drizzle-orm');
          const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
          const [found] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
          if (!found) {
            logger.warn(`[AUTH] x-api-key provided but no matching ApiKey found`);
            return apiError(401, 'Unauthorized', 'Invalid or revoked API key.');
          }
          if (found.status !== 'active') {
            logger.warn(`[AUTH] API key found but status='${found.status}'`, { apiKeyId: found.id });
            return apiError(403, 'Forbidden', 'API key is deactivated or suspended.');
          }
          apiKeyRecord = found;
          apiKeyId = found.id;
          logger.info(`[AUTH] Resolved apiKeyId from x-api-key header`, { apiKeyId });
        } catch (err) {
          logger.error(`[AUTH] Failed to resolve apiKeyId from x-api-key`, {}, err);
          return apiError(500, 'Internal Error', 'Failed to validate API key.');
        }
      }
    }

    // ── 1d. Rate limiting — per-profile when key resolved, else IP/user fallback ──
    const rl = await enforceRateLimit(req, { apiKey: apiKeyRecord });
    if (rl) {
      logger.warn(`[RATE_LIMIT] 429 for /v1/${serviceSlug}`, { apiKeyId });
      return rl;
    }

    const form = await req.formData();
    const userId = req.headers.get('x-user-id') ?? undefined;

    // ── 1e. Require API key for all pipeline submissions ─────────────────────
    // Enforce profile-driven architecture: every AI pipeline call must be
    // associated with a Profile (API Key). Anonymous access is not permitted.
    if (!apiKeyId) {
      logger.warn(`[AUTH] No API key provided — rejecting anonymous request`, { userId });
      return apiError(401, 'API Key Required',
        'A valid x-api-key header is required to access this endpoint. Contact your administrator to obtain an API key.');
    }

    // ── 2. Resolve sub-case ─────────────────────────────────────────────────
    const discriminatorValue = (form.get(service.discriminatorName) as string | null)?.trim();
    const subCase = service.subCases[discriminatorValue ?? ''] ?? service.subCases['_default'];

    if (!subCase) {
      const validValues = Object.keys(service.subCases).join(', ');
      return apiError(
        400,
        'Invalid Parameter',
        `'${service.discriminatorName}' must be one of: ${validValues}. Got: '${discriminatorValue ?? '(empty)'}'.`,
      );
    }

    // ── 3. Normalize files ──────────────────────────────────────────────────
    const files = normalizeFiles(form);

    // ── 3b. Parse file_urls (shared validator) ───────────────────────────────
    // The endpoint config that governs file URLs (fileUrlEnabled toggle and
    // fileUrlDefaultChunks) is only known after step 5, so it is applied there.
    const fileUrlsRaw = form.get('file_urls') as string | null;
    const fileUrlsResult = parseFileUrlsInput(fileUrlsRaw);
    if (!fileUrlsResult.ok) {
      return apiError(400, 'Invalid Parameter', fileUrlsResult.detail);
    }
    let fileUrls: FileUrlEntry[] | undefined = fileUrlsResult.entries;

    logger.info(`[REQUEST_PARSED] ${service.displayName} / ${subCase.displayName}`, {
      endpointSlug: discriminatorValue && discriminatorValue !== '_default'
        ? `${serviceSlug}:${discriminatorValue}`
        : serviceSlug,
      fileCount: files.length,
      fileUrlCount: fileUrls?.length ?? 0,
      fileNames: files.map((f) => `${f.name} (${(f.size / 1024).toFixed(1)} KB)`),
      formKeys: Array.from(form.keys()).filter(
        (k) => !['files[]', 'file', 'source_file', 'target_file', 'file_urls'].includes(k),
      ),
    });

    // ── 4. Build endpoint slug ──────────────────────────────────────────────
    const endpointSlug =
      discriminatorValue && discriminatorValue !== '_default'
        ? `${serviceSlug}:${discriminatorValue}`
        : serviceSlug;

    // ── 5. Load profile endpoint ────────────────────────────────────────────
    const profileEndpoint = await loadProfileEndpoint(apiKeyId, endpointSlug, serviceSlug);

    // If an API key was provided but no ProfileEndpoint exists, the key has no
    // access to this endpoint (e.g. the profile was deleted by an admin).
    if (apiKeyId && !profileEndpoint) {
      return apiError(
        403,
        'Endpoint Not Configured',
        `The '${service.displayName} / ${subCase.displayName}' endpoint is not configured for this API key.`,
      );
    }

    if (profileEndpoint && !profileEndpoint.enabled) {
      return apiError(
        403,
        'Endpoint Disabled',
        `The '${service.displayName} / ${subCase.displayName}' endpoint is disabled for this API key.`,
      );
    }

    // ── 5b. File-URL default chunk count ──────────────────────────────────────
    // Input mode (direct upload vs file_urls) is the caller's per-request choice;
    // DU accepts both, always. There is deliberately NO admin gate on URL input:
    // there is no requirement to disable server-side URL fetching per Profile, and
    // the downloader is already SSRF-hardened. Here we only backfill the endpoint's
    // default chunk count (fileUrlDefaultChunks) for entries that omit total_chunks.
    if (fileUrls && fileUrls.length > 0 && profileEndpoint) {
      applyDefaultChunks(fileUrls, (profileEndpoint as any).fileUrlDefaultChunks);
    }

    // ── 6. Parse profile DB params ──────────────────────────────────────────
    let dbParams: Record<string, { value: unknown; isLocked?: boolean }> = {};
    if (profileEndpoint?.parameters) {
      try {
        dbParams = JSON.parse(profileEndpoint.parameters);
      } catch { /* skip invalid JSON */ }
    }

    // ── 7. Merge params + lock check ────────────────────────────────────────
    const mergeResult = mergeParameters(form, subCase.parameters, dbParams);
    if (!mergeResult.ok) return mergeResult.errorResponse;
    const mergedVars = mergeResult.vars;

    // ── 8. Inject extract presets ───────────────────────────────────────────
    if (serviceSlug === 'extract') {
      if (discriminatorValue) {
        const preset = EXTRACT_PRESETS[discriminatorValue];
        if (preset) {
          // Prepend a DOCUMENT TYPE GATE so the extractor verifies the uploaded
          // file truly belongs to `discriminatorValue` before extracting; wrong-type
          // files return a document_type_mismatch object instead of fabricated data.
          if (!mergedVars.fields) mergedVars.fields = buildGuardedExtractFields(discriminatorValue, preset);
          if (preset.schema && !mergedVars.schema) mergedVars.schema = preset.schema;
        }
      }
      // Cách A: ext-data-extractor có placeholder {{fields}} và {{schema}} trong
      // defaultPrompt. interpolateVariables chỉ thay các key có mặt trong vars —
      // key thiếu sẽ bị gửi literal ("Output schema: {{schema}}") cho model.
      // Theo thiết kế, `fields` được customize theo từng type qua preset, còn
      // `schema` là tuỳ chọn (chỉ type `custom` truyền lên). Đảm bảo cả hai luôn
      // có giá trị (mặc định chuỗi rỗng) để không rò placeholder cho bất kỳ type nào.
      if (mergedVars.fields == null) mergedVars.fields = '';
      if (mergedVars.schema == null) mergedVars.schema = '';

      // return_bbox (default off): append the bounding-box instruction to the field
      // list so the model also emits a `_bounding_boxes` array (normalized 0–1000 +
      // page index). Accept both boolean (from param coercion) and 'true' string.
      const wantBbox = mergedVars.return_bbox === true || mergedVars.return_bbox === 'true';
      if (wantBbox) {
        mergedVars.fields = `${mergedVars.fields}\n\n${bboxInstruction()}`;
      }
    }

    // Record the original file URLs so the Operations UI can display them even
    // after the worker downloads the files and replaces them with storage
    // references. Parity with the workflows route (02-CURRENT-STATE §1.6).
    if (fileUrls && fileUrls.length > 0) {
      mergedVars['_original_file_urls'] = fileUrls.map((f) => ({
        url: f.url,
        filename: f.filename,
        mime_type: f.mime_type,
      }));
    }

    // ── 9. Build pipeline ───────────────────────────────────────────────────
    const connectionSteps = parseConnectionSteps(
      profileEndpoint?.connectionsOverride,
      subCase.connections,
      () => logger.info(`[PROFILE_ROUTING] Override (legacy format)`),
      () => logger.warn(`[PROFILE_ROUTING] Invalid connectionsOverride JSON, falling back to defaults`),
    );

    const pipeline = connectionSteps.map((step) => ({
      processor: step.slug,
      variables: { ...mergedVars },
      stepId: step.stepId,
      captureSession: step.captureSession,
      injectSession: step.injectSession,
    }));

    // ── 10. Resolve callback target and submit job ──────────────────────────
    const outputFormat = (form.get('output_format') as string | null) ?? 'json';
    const callbackTarget = await resolveCallbackTarget({
      callbackUrl: form.get('callback_url'),
      webhookUrl: form.get('webhook_url'),
    });
    if (!callbackTarget.ok) {
      return apiError(400, 'Invalid Parameter', callbackTarget.detail);
    }
    const webhookUrl = callbackTarget.url;
    const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;
    const executeSync = new URL(req.url).searchParams.get('sync') === 'true';

    // ── 10b. Extract client reference for ops search ────────────────────────
    const clientReference = extractClientReference(
      form, files, (profileEndpoint as any)?.referenceExtract
    );

    // File download auth comes from ONE place: the Profile-level ApiKey.fileAuthConfig.
    // The former per-endpoint override (ProfileEndpoint.fileUrlAuthConfig) was removed:
    // it leaked decrypted credentials to the browser and could not be edited without
    // re-entering the secret. A single Profile-wide credential is the canonical source.
    // It is only resolved when the request actually carries file_urls, so uploads never
    // pay for secret parsing.
    let fileUrlAuthConfig: ReturnType<typeof getFileUrlAuthConfig>;
    if (fileUrls && fileUrls.length > 0) {
      const apiKeyFileAuthRaw = await loadApiKeyFileAuthConfig(apiKeyId, apiKeyRecord);
      if (apiKeyFileAuthRaw) {
        // Reuse getFileUrlAuthConfig's decrypt/legacy-JSON parsing by reading the
        // raw off a minimal object with the same field name.
        const apiKeyFileAuth = getFileUrlAuthConfig({ fileUrlAuthConfig: apiKeyFileAuthRaw } as any);
        if (!apiKeyFileAuth) {
          logger.error('[PROFILE] Stored ApiKey file auth config is malformed', { apiKeyId });
          return apiError(500, 'Profile Configuration Error', `Profile file authentication is invalid. Reference: ${correlationId}`);
        }
        fileUrlAuthConfig = apiKeyFileAuth;
      }
    }
    // Allowed file extensions priority:
    //   1. Profile override (admin-configured per API key)
    //   2. Registry per-endpoint policy (self-documenting, e.g. ingest:ocr → pdf+images)
    //   3. Global DEFAULT_ALLOWED_EXTENSIONS (pdf + images) — applied inside validateFile
    const allowedFileExtensions =
      (profileEndpoint as any)?.allowedFileExtensions ??
      resolveAllowedExtensions(endpointSlug) ??
      undefined;

    const result = await submitPipelineJob({
      pipeline,
      files,
      fileUrls,
      fileUrlAuthConfig,
      allowedFileExtensions,
      endpointSlug,
      outputFormat,
      webhookUrl,
      idempotencyKey,
      apiKeyId,
      apiKeyRecord,
      profileEndpoint,
      userId,
      executeSync,
      correlationId,
      clientReference,
    });

    if (!result.ok) {
      const latencyMs = Date.now() - startedAt;
      logger.warn(`[RESPONSE] Pipeline rejected`, { latencyMs });
      return result.errorResponse;
    }

    // Sync and idempotent replay return 200 only when a terminal result is actually
    // available. If the sync wait window elapsed while the worker is still running,
    // degrade to the normal LRO contract (202 + Operation-Location) instead of
    // returning a misleading 200 response with done=false.
    const hasTerminalResult = result.operation.done === true;
    const returnResultInline = hasTerminalResult && (result.isIdempotent || executeSync);
    const httpStatus = returnResultInline ? 200 : 202;
    const latencyMs = Date.now() - startedAt;

    logger.info(`[RESPONSE] ${httpStatus}`, {
      operationId: result.operation.id,
      httpStatus,
      latencyMs,
      fileCount: files.length,
      fileUrlCount: fileUrls?.length ?? 0,
      pipelineSteps: pipeline.length,
      outputFormat,
      isIdempotent: result.isIdempotent,
      executeSync,
      hasTerminalResult,
    });

    const formatted = formatOperationResponse(result.operation);

    // A completed synchronous (or idempotent-replay) response returns the result
    // inline in this HTTP body. Apply the same Profile opt-in encryption here so
    // "encryption_enabled" covers every inline delivery path. A non-terminal result
    // uses the pollable 202 path below and therefore stays plaintext.
    if (returnResultInline) {
      const { body, headers: encHeaders } = await encryptOperationResponse(
        formatted as Record<string, unknown>,
        result.operation,
      );
      return NextResponse.json(body, {
        status: httpStatus,
        headers: {
          'X-Operation-ID': result.operation.id,
          ...encHeaders,
        },
      });
    }

    return NextResponse.json(formatted, {
      status: httpStatus,
      headers: {
        'X-Operation-ID': result.operation.id,
        'Operation-Location': `/api/v1/operations/${result.operation.id}`,
      },
    });

  } catch (error: unknown) {
    const latencyMs = Date.now() - startedAt;
    logger.error(`[RESPONSE] 500 Internal Error`, { latencyMs }, error);
    return apiError(
      500,
      'Internal Error',
      `The request could not be completed. Reference: ${correlationId}`,
      `${BASE_TYPE_URI}/internal`,
    );
  }
}
