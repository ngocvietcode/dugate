// app/api/v1/docs/workflows/route.ts
// Entrypoint for complex business workflows.
// Creates an Operation + enqueues a BullMQ job with name "workflow:{process}".
// The actual orchestration logic runs in the Worker process (workflow-engine.ts).

import { NextRequest, NextResponse } from 'next/server';

// Allow large file uploads (PDF + Excel can be 10MB+)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { normalizeFiles, apiError } from '@/lib/endpoints/runner';
import { submitPipelineJob } from '@/lib/pipelines/submit';
import { SERVICE_REGISTRY, resolveAllowedExtensions } from '@/lib/endpoints/registry';
import { db } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import {
  type FileUrlEntry,
  type FileUrlAuthConfig,
  parseFileUrlAuthConfig,
} from '@/lib/file-url-downloader';
import { parseFileUrlsInput, applyDefaultChunks } from '@/lib/endpoints/file-urls-input';
import { resolveCallbackTarget } from '@/lib/delivery/resolve-target';
import { getFileUrlAuthConfig, loadProfileEndpoint, mergeParameters } from '@/lib/endpoints/profile-resolver';
import { extractClientReference } from '@/lib/reference-extract';
import { enforceRateLimit } from '@/lib/rate-limit';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'v1_workflows_api' });

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  // Đo thời gian nhận body và chuẩn bị trước khi nộp job (không chứa nội dung hồ sơ), để phân biệt chậm do mạng/upload của client
  // (formData) với chậm phía máy chủ (xem log `submitPipelineJob timings`).
  const startedAt = Date.now();

  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (err: unknown) {
      // A malformed multipart body (most commonly a manually supplied
      // Content-Type without its boundary) is a client input error. Keep this
      // separate from the outer catch so callers receive an actionable 400
      // instead of a misleading generic 500.
      logger.warn('[POST] Invalid multipart/form-data body', {
        correlationId,
        contentType: req.headers.get('content-type') ?? undefined,
      }, err);
      return apiError(
        400,
        'Invalid Multipart FormData',
        'The request body could not be parsed as multipart/form-data. Ensure the Content-Type boundary is generated automatically and every file field references an accessible file. In Postman, use the Desktop Agent, remove and re-select all file rows, and then send the request again.',
      );
    }

    const parsedAt = Date.now();
    let processName = (form.get('process') as string | null)?.trim() ?? null;
    // Strip surrounding quotes from form-data values (Postman quirk)
    if (processName?.startsWith('"') && processName?.endsWith('"')) {
      processName = processName.slice(1, -1).trim();
    }

    if (!processName) {
      return apiError(400, 'Missing Parameter', "Form field 'process' is required.");
    }

    const subCase = SERVICE_REGISTRY['workflows']?.subCases[processName];
    if (!subCase) {
      return apiError(404, 'Workflow Not Found', `Workflow '${processName}' is not registered.`);
    }

    // ── Normalize direct file uploads ───────────────────────────────────────
    const files = normalizeFiles(form);

    // ── Parse file_urls (shared validator; remote URLs for IDP integration) ──
    // Uses the unified validator so Core API and workflows enforce one contract.
    // For workflows this ADDS file_id type validation that was previously absent
    // (tightening only invalid input); every previously-valid payload is accepted.
    const fileUrlsResult = parseFileUrlsInput(form.get('file_urls') as string | null);
    if (!fileUrlsResult.ok) {
      return apiError(400, 'Invalid Parameter', fileUrlsResult.detail);
    }
    const fileUrls: FileUrlEntry[] | undefined = fileUrlsResult.entries;

    // ── Parse inline file_url_auth (one-time auth config from request) ──────
    let inlineFileUrlAuth: FileUrlAuthConfig | undefined;
    const fileUrlAuthRaw = form.get('file_url_auth') as string | null;
    if (fileUrlAuthRaw) {
      let jsonStr = fileUrlAuthRaw.trim();
      if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
        jsonStr = jsonStr.slice(1, -1);
      }
      let parsedAuth: unknown;
      try {
        parsedAuth = JSON.parse(jsonStr);
      } catch {
        return apiError(400, 'Invalid Parameter', 'file_url_auth must be valid JSON.');
      }
      inlineFileUrlAuth = parseFileUrlAuthConfig(parsedAuth);
      if (!inlineFileUrlAuth || inlineFileUrlAuth.type === 'none') {
        return apiError(400, 'Invalid Parameter', 'file_url_auth has an invalid authentication shape.');
      }
    }

    // Require at least 1 file source (upload or URL)
    if (files.length === 0 && (!fileUrls || fileUrls.length === 0)) {
      return apiError(400, 'Missing Files', 'Workflow requires at least 1 document (upload or file_urls).');
    }

    const endpointSlug = `workflows:${processName}`;

    // Authentication is by API key ONLY — for external integrations and internal
    // tools alike. A bare Profile UUID (`apiKeyId`) is an identifier, never a
    // credential, so it can never authenticate a request on its own.
    const requestedApiKeyId = (form.get('apiKeyId') as string | null)?.trim() || null;
    const rawKey = req.headers.get('x-api-key');
    if (!rawKey) {
      return apiError(401, 'API Key Required', 'A valid x-api-key header is required for this endpoint.');
    }

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const [apiKeyRecord] = await db.select({
      id: apiKeys.id,
      status: apiKeys.status,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      // Profile-level Integration Auth is the canonical file URL credential.
      // Keep the encrypted value server-side; it is never returned or logged.
      fileAuthConfig: apiKeys.fileAuthConfig,
    }).from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);

    if (!apiKeyRecord) {
      return apiError(401, 'Unauthorized', 'Invalid or revoked API key.');
    }
    if (apiKeyRecord.status !== 'active') {
      return apiError(403, 'Forbidden', 'API key is deactivated or suspended.');
    }
    // If the caller also passes an explicit Profile id, it must match the key.
    if (requestedApiKeyId && requestedApiKeyId !== apiKeyRecord.id) {
      return apiError(403, 'Forbidden', 'The requested Profile does not match the authenticated API key.');
    }

    const apiKeyId = apiKeyRecord.id;
    const rateLimitResponse = await enforceRateLimit(req, { apiKey: apiKeyRecord });
    if (rateLimitResponse) return rateLimitResponse;

    // ── Resolve Profile policy. Stored Profile values take precedence; request
    // overrides are compatibility fallbacks only when the Profile leaves a field unset.
    const profileEndpoint = await loadProfileEndpoint(apiKeyId, endpointSlug, 'workflows');
    if (!profileEndpoint) {
      return apiError(403, 'Endpoint Not Configured', `Workflow '${processName}' is not configured for this Profile.`);
    }
    if (!profileEndpoint.enabled) {
      return apiError(403, 'Endpoint Disabled', `Workflow '${processName}' is disabled for this Profile.`);
    }

    // ── Merge Profile-stored params with request form (parity with Core API) ──
    // The workflow's sub-case schema carries the auto-injected ENCRYPTION_PARAMS,
    // so merging the Profile parameters here is what makes a Profile that turned
    // encryption ON actually take effect: encryption_enabled / mode / fields land
    // in pipelineJson, which encryptOperationResponse reads at poll/download time.
    // Without this merge the request form alone never carries encryption_enabled,
    // so the response would stay plaintext even though the Profile enabled it.
    // mergeParameters also enforces admin-locked fields (client cannot override).
    let dbParams: Record<string, { value: unknown; isLocked?: boolean }> = {};
    if (profileEndpoint.parameters) {
      try {
        const parsed = JSON.parse(profileEndpoint.parameters);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          dbParams = parsed as Record<string, { value: unknown; isLocked?: boolean }>;
        }
      } catch {
        logger.warn('[PROFILE] Invalid parameters JSON; workflow params not merged', { apiKeyId, endpointSlug });
        return apiError(500, 'Profile Configuration Error', `Profile parameters are invalid. Reference: ${correlationId}`);
      }
    }

    const mergeResult = mergeParameters(form, subCase.parameters, dbParams);
    if (!mergeResult.ok) return mergeResult.errorResponse;
    const variables: Record<string, unknown> = mergeResult.vars;

    // Store original file_urls in variables for audit/display purposes so the
    // Operations UI can show the original URLs even after files are downloaded.
    if (fileUrls && fileUrls.length > 0) {
      variables['_original_file_urls'] = fileUrls.map(f => ({
        url: f.url,
        filename: f.filename,
        mime_type: f.mime_type,
      }));
    }

    // Single-step pipeline placeholder (workflow-engine ignores the processor but
    // submitPipelineJob requires >=1 step, and pipelineJson[0].variables is where
    // the merged Profile config — including encryption_* — is persisted).
    const pipeline = [{ processor: 'ext-classifier', variables }];

    const callbackTarget = await resolveCallbackTarget({
      callbackUrl: form.get('callback_url'),
      webhookUrl: form.get('webhook_url'),
    });
    if (!callbackTarget.ok) {
      return apiError(400, 'Invalid Parameter', callbackTarget.detail);
    }
    const webhookUrl = callbackTarget.url;

    // Endpoint-level default chunk count — parity with Core API runner step 5b.
    // Backfills entries that omit total_chunks; a caller-supplied value always wins.
    // Default absent → no-op, so unconfigured Profiles behave exactly as before.
    applyDefaultChunks(fileUrls, (profileEndpoint as any).fileUrlDefaultChunks);

    const clientAllowedExt = (form.get('allowed_extensions') as string | null)?.trim();
    const profileAllowedExt = profileEndpoint.allowedFileExtensions?.trim();
    const allowedFileExtensions = profileAllowedExt
      || clientAllowedExt
      || resolveAllowedExtensions(endpointSlug)
      || undefined;

    // Profile Integration Auth is the canonical stored credential. The former
    // per-endpoint override was removed, so this is the only stored source. Only
    // resolve it for file_urls requests, matching the universal runner and avoiding
    // unnecessary secret parsing for uploads.
    let fileUrlAuthConfig: FileUrlAuthConfig | undefined;
    if (fileUrls && fileUrls.length > 0 && apiKeyRecord.fileAuthConfig) {
      fileUrlAuthConfig = getFileUrlAuthConfig({ fileUrlAuthConfig: apiKeyRecord.fileAuthConfig } as any);
      if (!fileUrlAuthConfig) {
        logger.error('[PROFILE] Stored Profile file URL auth config is malformed', { apiKeyId });
        return apiError(500, 'Profile Configuration Error', `Profile file authentication is invalid. Reference: ${correlationId}`);
      }
    }

    // Legacy workflow parameters remain a compatibility fallback for Profiles
    // that have not migrated yet. New Profiles must use Integration Auth above.
    // Build CSP credentials from Profile parameters when canonical auth is absent.
    if (!fileUrlAuthConfig && profileEndpoint.parameters) {
      try {
        const params = JSON.parse(profileEndpoint.parameters);
        const tokenUrl = params.csp_token_url?.value;
        const clientId = params.csp_client_id?.value;
        const clientSecret = params.csp_client_secret?.value;
        const ibmClientId = params.ibm_client_id?.value;
        const chunkSize = parseInt(params.csp_chunk_size?.value ?? '', 10);
        if (tokenUrl || clientId || clientSecret) {
          fileUrlAuthConfig = parseFileUrlAuthConfig({
            type: 'csp_oauth2',
            token_url: tokenUrl,
            client_id: clientId,
            client_secret: clientSecret,
            ...(Number.isInteger(chunkSize) && chunkSize > 0 ? { csp_chunk_size: chunkSize } : {}),
            ...(ibmClientId ? { ibm_client_id: ibmClientId } : {}),
          });
          if (!fileUrlAuthConfig) {
            return apiError(500, 'Profile Configuration Error', `Profile CSP authentication is invalid. Reference: ${correlationId}`);
          }
        }
      } catch {
        logger.warn('[PROFILE] Invalid parameters JSON; CSP file auth was not loaded', { apiKeyId, endpointSlug });
        return apiError(500, 'Profile Configuration Error', `Profile parameters are invalid. Reference: ${correlationId}`);
      }
    }

    // Backward-compatible fallback only when the Profile has no stored auth.
    if (!fileUrlAuthConfig) fileUrlAuthConfig = inlineFileUrlAuth;

    // ── Extract client reference for ops search ────────────────────────────
    const clientReference = extractClientReference(
      form, files, (profileEndpoint as any)?.referenceExtract
    );

    // Browser session user (injected by middleware from NextAuth). Operations are a
    // shared feature owned by the USER who created them — not by the profile API key.
    // Recording createdByUserId lets non-admin users poll/view their own operations.
    const sessionUserId = req.headers.get('x-user-id') || undefined;

    const preparedAt = Date.now();
    const result = await submitPipelineJob({
      pipeline,
      files: files.length > 0 ? files : undefined,
      fileUrls,
      fileUrlAuthConfig,
      allowedFileExtensions,
      endpointSlug,
      webhookUrl,
      correlationId,
      clientReference,
      apiKeyId: apiKeyId || undefined,
      userId: sessionUserId,
      disableHistory: false,
    });

    const submittedAt = Date.now();
    logger.info('[POST] Workflow submitted', {
      correlationId,
      operationId: result.ok ? result.operation.id : undefined,
      process: processName,
      files: files.length,
      timings_ms: {
        parse_body: parsedAt - startedAt,
        prepare: preparedAt - parsedAt,
        submit: submittedAt - preparedAt,
        total: submittedAt - startedAt,
        ...(result.ok ? result.timings : {}),
      },
    });
    if (!result.ok) return result.errorResponse;

    return NextResponse.json(
      {
        name: `operations/${result.operation.id}`,
        done: false,
        metadata: {
          state: 'RUNNING',
          workflow: processName,
          progress_percent: 0,
          progress_message: 'Initializing workflow...',
        },
      },
      {
        status: 202,
        headers: {
          'X-Operation-ID': result.operation.id,
          'Operation-Location': `/api/v1/operations/${result.operation.id}`,
        },
      },
    );
  } catch (err: unknown) {
    logger.error('[POST] Workflow submission failed', { correlationId }, err);
    return apiError(500, 'Internal Workflow Error', `Workflow submission failed. Reference: ${correlationId}`);
  }
}
