import { buildGatewayHeaders, buildSyncAuthHeaders, applyQueryAuth } from '@/lib/auth-config/apply';
import { parseFileUrlAuthConfig } from '@/lib/auth-config/parse';
import { resolveAuthConfigSecrets } from '@/lib/auth-config/resolve-secret';
import type { AuthConfig } from '@/lib/auth-config/types';
import { decrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';
import { assertSafeUrl, isUrlOriginAllowed, ssrfSafeFetch } from '@/lib/pipelines/processors/http-client';
import { eq } from 'drizzle-orm';

const TEST_TIMEOUT_MS = 30_000;
const FILE_TEST_RANGE = 'bytes=0-4095';

export interface TestFileUrlInput {
  apiKeyId: string;
  endpointSlug: string;
  url: string;
  authConfig?: AuthConfig;
}

export interface TestCallbackInput {
  apiKeyId: string;
  endpointSlug: string;
  url: string;
  authConfig?: AuthConfig;
  payload?: Record<string, unknown>;
}

export interface FileUrlTestResult {
  ok: boolean;
  httpStatus?: number;
  contentType?: string | null;
  contentLength?: number | null;
  filenameResolved?: string;
  errorSummary?: string;
}

export interface CallbackTestResult {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  errorSummary?: string;
}

function callbackErrorSummary(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Callback request timed out after 30s.';
  return 'Callback test request could not be completed.';
}

function fileErrorSummary(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'File request timed out after 30s.';
  return 'File test request could not be completed.';
}

function isCredentialed(authConfig: AuthConfig | undefined): boolean {
  return Boolean(authConfig && (
    authConfig.type !== 'none'
    || authConfig.ibm_client_id
    || authConfig.gateway_headers?.length
  ));
}

/** Credential-bearing file requests require an explicit exact-origin allowlist match. */
function isCredentialedFileOriginAllowed(rawUrl: string): boolean {
  const configured = (process.env.ALLOWED_FILE_AUTH_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length === 0) return false;
  let origin: string;
  try { origin = new URL(rawUrl).origin; } catch { return false; }
  return configured.some((value) => {
    try { return new URL(value).origin === origin; } catch { return false; }
  });
}

function parseStoredAuthConfig(raw: string | null | undefined): AuthConfig | undefined {
  if (!raw) return undefined;
  const parse = (value: string): AuthConfig | undefined => {
    try { return parseFileUrlAuthConfig(JSON.parse(value)); } catch { return undefined; }
  };
  try { return parse(decrypt(raw)); } catch { return parse(raw); }
}

/**
 * Resolves the file-download credential for a "Test file URL" run. The per-endpoint
 * override was removed, so the Profile-level config is the only stored source.
 */
async function loadFileAuthConfig(apiKeyId: string, _endpointSlug: string): Promise<AuthConfig | undefined> {
  const [profile] = await db.select({ fileAuthConfig: apiKeys.fileAuthConfig })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1);
  if (!profile?.fileAuthConfig) return undefined;
  const config = parseStoredAuthConfig(profile.fileAuthConfig);
  if (!config) throw new Error('Stored file authentication configuration is invalid.');
  return config;
}

async function loadCallbackAuthConfig(apiKeyId: string): Promise<AuthConfig | undefined> {
  const [profile] = await db.select({ callbackAuthConfig: apiKeys.callbackAuthConfig })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1);
  if (!profile?.callbackAuthConfig) return undefined;
  const config = parseStoredAuthConfig(profile.callbackAuthConfig);
  if (!config || config.type === 'query') {
    throw new Error('Stored callback authentication configuration is invalid.');
  }
  return config;
}

async function buildAuthenticatedHeaders(authConfig: AuthConfig | undefined): Promise<Record<string, string>> {
  if (!authConfig) return {};
  const resolved = await resolveAuthConfigSecrets(authConfig, () => undefined);
  if (!resolved) throw new Error('Credentials could not be resolved.');

  const gatewayHeaders = buildGatewayHeaders(resolved);
  const headers = { ...gatewayHeaders, ...buildSyncAuthHeaders(resolved) };
  if (resolved.type === 'csp_oauth2' && resolved.token_url && resolved.client_id && resolved.client_secret) {
    const { getCspToken } = await import('@/lib/csp-token');
    headers.Authorization = `Bearer ${await getCspToken({
      token_url: await assertSafeUrl(resolved.token_url),
      client_id: resolved.client_id,
      client_secret: resolved.client_secret,
      ibm_client_id: resolved.ibm_client_id,
      gateway_headers: gatewayHeaders,
    })}`;
  }
  if (resolved.type === 'oauth2_client_credentials' && resolved.token_url && resolved.client_id && resolved.client_secret) {
    const { getOAuth2Token } = await import('@/lib/auth-config/oauth2-token');
    headers.Authorization = `Bearer ${await getOAuth2Token({
      token_url: resolved.token_url,
      client_id: resolved.client_id,
      client_secret: resolved.client_secret,
      token_body_format: resolved.token_body_format,
      token_auth_style: resolved.token_auth_style,
      scope: resolved.scope,
      audience: resolved.audience,
      token_response_path: resolved.token_response_path,
      ...(Object.keys(gatewayHeaders).length ? { token_extra_headers: gatewayHeaders } : {}),
    }, { errorPrefix: 'Test OAuth2 token' })}`;
  }
  return headers;
}

function filenameFromDisposition(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded).replace(/[\\/\0]/g, '_'); } catch { /* use plain name */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1]?.trim();
  return plain ? plain.replace(/[\\/\0]/g, '_') : undefined;
}

function filenameFromUrl(rawUrl: string): string {
  try {
    const name = new URL(rawUrl).pathname.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name).replace(/[\\/\0]/g, '_') : 'download';
  } catch {
    return 'download';
  }
}

async function cancelBoundedBody(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try { await reader.read(); } catch { /* response body is intentionally not surfaced */ }
  await reader.cancel().catch(() => undefined);
}

export async function testFileUrl(input: TestFileUrlInput): Promise<FileUrlTestResult> {
  let safeUrl: string;
  try {
    safeUrl = await assertSafeUrl(input.url);
  } catch {
    return { ok: false, errorSummary: 'File URL is not allowed.' };
  }

  try {
    const authConfig = input.authConfig ?? await loadFileAuthConfig(input.apiKeyId, input.endpointSlug);
    const authenticatedUrl = await assertSafeUrl(applyQueryAuth(safeUrl, authConfig));
    if (isCredentialed(authConfig) && !isCredentialedFileOriginAllowed(authenticatedUrl)) {
      return { ok: false, errorSummary: 'File credentials are not authorized for this origin.' };
    }

    const response = await ssrfSafeFetch(authenticatedUrl, {
      method: 'GET',
      headers: { ...await buildAuthenticatedHeaders(authConfig), Range: FILE_TEST_RANGE },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    await cancelBoundedBody(response);

    if (!response.ok) {
      return { ok: false, httpStatus: response.status, errorSummary: `File server returned HTTP ${response.status}.` };
    }
    const contentLengthHeader = response.headers.get('content-length');
    const parsedLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : null;
    return {
      ok: true,
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      contentLength: Number.isSafeInteger(parsedLength) ? parsedLength : null,
      filenameResolved: filenameFromDisposition(response.headers.get('content-disposition')) ?? filenameFromUrl(safeUrl),
    };
  } catch (error) {
    return { ok: false, errorSummary: fileErrorSummary(error) };
  }
}

export async function testCallback(input: TestCallbackInput): Promise<CallbackTestResult> {
  const startedAt = Date.now();
  let safeUrl: string;
  try {
    safeUrl = await assertSafeUrl(input.url);
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt, errorSummary: 'Callback URL is not allowed.' };
  }
  if (!isUrlOriginAllowed(safeUrl, process.env.ALLOWED_WEBHOOK_ORIGINS ?? '')) {
    return { ok: false, latencyMs: Date.now() - startedAt, errorSummary: 'Callback origin is not allowlisted.' };
  }

  try {
    const authConfig = input.authConfig ?? await loadCallbackAuthConfig(input.apiKeyId);
    if (authConfig?.type === 'query') {
      return { ok: false, latencyMs: Date.now() - startedAt, errorSummary: 'Query authentication is not allowed for callbacks.' };
    }
    const payload = input.payload ?? {
      operation_id: '00000000-0000-0000-0000-000000000000',
      state: 'SUCCEEDED',
      done: true,
      extracted_data: { _test: true },
    };
    const response = await ssrfSafeFetch(safeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await buildAuthenticatedHeaders(authConfig) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    await cancelBoundedBody(response);
    return response.ok
      ? { ok: true, httpStatus: response.status, latencyMs: Date.now() - startedAt }
      : { ok: false, httpStatus: response.status, latencyMs: Date.now() - startedAt, errorSummary: `Callback server returned HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, errorSummary: callbackErrorSummary(error) };
  }
}
