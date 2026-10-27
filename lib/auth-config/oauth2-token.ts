// Generic OAuth2 client-credentials token retrieval for outbound integrations.

import { assertSafeUrl, ssrfSafeFetch, summarizeErrorBody } from '@/lib/pipelines/processors/http-client';

export interface OAuth2TokenConfig {
  token_url: string;
  client_id: string;
  client_secret: string;
  token_body_format?: 'json' | 'form';
  token_auth_style?: 'body' | 'basic';
  scope?: string;
  audience?: string;
  token_response_path?: string;
  /**
   * Extra static headers sent on the token POST (e.g. an APIC gateway's
   * `X-IBM-Client-Id`). Part of the cache key so distinct gateways never share
   * a token. Content-Type and Authorization remain authoritative.
   */
  token_extra_headers?: Record<string, string>;
}

interface OAuth2TokenOptions {
  /** Lets compatibility wrappers retain an established cache-key contract. */
  cacheKey?: string;
  /** Names the integration in safe, credential-free errors. */
  errorPrefix?: string;
}

interface CachedToken {
  access_token: string;
  expires_at: number;
}

const tokenCache = new Map<string, CachedToken>();
const EXPIRY_BUFFER_MS = 60_000;

function cacheKeyFor(safeTokenUrl: string, config: OAuth2TokenConfig): string {
  return JSON.stringify([
    safeTokenUrl,
    config.client_id,
    config.token_body_format ?? 'form',
    config.token_auth_style ?? 'body',
    config.scope ?? '',
    config.audience ?? '',
    config.token_response_path ?? '',
    config.token_extra_headers
      ? Object.entries(config.token_extra_headers).sort(([a], [b]) => a.localeCompare(b))
      : [],
  ]);
}

function requestPayload(config: OAuth2TokenConfig): Record<string, string> {
  const payload: Record<string, string> = { grant_type: 'client_credentials' };
  if ((config.token_auth_style ?? 'body') === 'body') {
    payload.client_id = config.client_id;
    payload.client_secret = config.client_secret;
  }
  if (config.scope) payload.scope = config.scope;
  if (config.audience) payload.audience = config.audience;
  return payload;
}

function requestBody(config: OAuth2TokenConfig, payload: Record<string, string>): string {
  return (config.token_body_format ?? 'form') === 'json'
    ? JSON.stringify(payload)
    : new URLSearchParams(payload).toString();
}

function responseObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function tokenAtPath(response: Record<string, unknown>, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((current, segment) => {
    if (!segment) return undefined;
    return responseObject(current)?.[segment];
  }, response);
  return typeof value === 'string' && value ? value : undefined;
}

function standardToken(response: Record<string, unknown>): string | undefined {
  const nested = responseObject(response.data);
  const candidates = [nested, response];
  for (const candidate of candidates) {
    const token = candidate?.access_token ?? candidate?.token ?? candidate?.accessToken;
    if (typeof token === 'string' && token) return token;
  }
  return undefined;
}

function expiresInSeconds(response: Record<string, unknown>): number {
  const nested = responseObject(response.data);
  const value = nested?.expires_in ?? nested?.expiresIn ?? response.expires_in ?? response.expiresIn;
  const seconds = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 900;
}

function safeErrorDetail(raw: string, clientSecret: string): string {
  return summarizeErrorBody(raw)
    .split(clientSecret).join('***')
    .replace(/\bclient[_-]?secret\b/gi, 'credential');
}

/**
 * Fetch and cache an OAuth2 client-credentials token. Redirects are deliberately
 * not followed by ssrfSafeFetch so credentials cannot be forwarded to another host.
 */
export async function getOAuth2Token(
  config: OAuth2TokenConfig,
  options: OAuth2TokenOptions = {},
): Promise<string> {
  const safeTokenUrl = await assertSafeUrl(config.token_url);
  const cacheKey = options.cacheKey ?? cacheKeyFor(safeTokenUrl, config);
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expires_at - EXPIRY_BUFFER_MS) {
    return cached.access_token;
  }

  const authStyle = config.token_auth_style ?? 'body';
  const bodyFormat = config.token_body_format ?? 'form';
  // Extra headers form the base; Content-Type and Authorization stay authoritative.
  const headers: Record<string, string> = { ...(config.token_extra_headers ?? {}) };
  headers['Content-Type'] = bodyFormat === 'json' ? 'application/json' : 'application/x-www-form-urlencoded';
  if (authStyle === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64')}`;
  }

  const errorPrefix = options.errorPrefix ?? 'OAuth2 token';
  let response: Response;
  try {
    response = await ssrfSafeFetch(safeTokenUrl, {
      method: 'POST',
      headers,
      body: requestBody(config, requestPayload(config)),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${errorPrefix} request timed out after 15s`);
    }
    throw error;
  }

  if (!response.ok) {
    const detail = safeErrorDetail(await response.text().catch(() => ''), config.client_secret);
    throw new Error(`${errorPrefix} request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
  }

  let data: Record<string, unknown>;
  try {
    data = responseObject(await response.json()) ?? {};
  } catch {
    throw new Error(`${errorPrefix} response was not valid JSON`);
  }

  const accessToken = config.token_response_path
    ? tokenAtPath(data, config.token_response_path)
    : standardToken(data);
  if (!accessToken) {
    throw new Error(`${errorPrefix} response missing access_token field`);
  }

  tokenCache.set(cacheKey, {
    access_token: accessToken,
    expires_at: Date.now() + expiresInSeconds(data) * 1000,
  });
  return accessToken;
}

/** Remove one cached entry; compatibility wrappers choose their own stable key. */
export function clearOAuth2TokenCache(cacheKey: string): void {
  tokenCache.delete(cacheKey);
}
