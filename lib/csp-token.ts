// lib/csp-token.ts
// Backward-compatible CSP wrapper around the shared OAuth2 token manager.

import { clearOAuth2TokenCache, getOAuth2Token } from '@/lib/auth-config/oauth2-token';
import { assertSafeUrl } from '@/lib/pipelines/processors/http-client';

export interface CspTokenConfig {
  /** CSP auth endpoint URL, e.g. "https://api-int.dev.vpbank.com.vn/it-csp/uat/auth/v1/csp/token" */
  token_url: string;
  /** OAuth2 client_id */
  client_id: string;
  /** OAuth2 client_secret */
  client_secret: string;
  /** APIC gateway client identifier — sent as X-IBM-Client-Id header on the token request */
  ibm_client_id?: string;
  /** Generic gateway headers resolved from the encrypted Profile configuration. */
  gateway_headers?: Record<string, string>;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((configured) => configured.toLowerCase() === name.toLowerCase());
}

function tokenExtraHeaders(config: CspTokenConfig): Record<string, string> {
  const headers = { ...(config.gateway_headers ?? {}) };
  if (config.ibm_client_id && !hasHeader(headers, 'X-IBM-Client-Id')) {
    headers['X-IBM-Client-Id'] = config.ibm_client_id;
  }
  return headers;
}

function headerCacheSuffix(headers: Record<string, string>): string {
  return JSON.stringify(Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)));
}

function legacyCacheKey(tokenUrl: string, config: CspTokenConfig): string {
  return `${tokenUrl}|${config.client_id}|${config.ibm_client_id ?? ''}`;
}

function cacheKey(tokenUrl: string, config: CspTokenConfig, headers: Record<string, string>): string {
  const hasOnlyLegacyIbmHeader = Object.keys(headers).length === 1
    && hasHeader(headers, 'X-IBM-Client-Id')
    && headers[Object.keys(headers).find((name) => name.toLowerCase() === 'x-ibm-client-id') ?? ''] === config.ibm_client_id;
  return hasOnlyLegacyIbmHeader || Object.keys(headers).length === 0
    ? legacyCacheKey(tokenUrl, config)
    : `${legacyCacheKey(tokenUrl, config)}|${headerCacheSuffix(headers)}`;
}

/**
 * Fetch a CSP Bearer token using its established JSON/body credential contract.
 * IBM-only callers keep the established `${token_url}|${client_id}|${ibm_client_id ?? ''}` cache key.
 */
export async function getCspToken(config: CspTokenConfig): Promise<string> {
  const safeTokenUrl = await assertSafeUrl(config.token_url);
  const headers = tokenExtraHeaders(config);
  return getOAuth2Token({
    token_url: safeTokenUrl,
    client_id: config.client_id,
    client_secret: config.client_secret,
    token_body_format: 'json',
    token_auth_style: 'body',
    ...(Object.keys(headers).length ? { token_extra_headers: headers } : {}),
  }, {
    cacheKey: cacheKey(safeTokenUrl, config, headers),
    errorPrefix: 'CSP token',
  });
}

/** Clears the exact CSP cache entry selected by the same gateway-header configuration. */
export function clearCspTokenCache(config: CspTokenConfig): void {
  let tokenUrl = config.token_url;
  try { tokenUrl = new URL(config.token_url).toString(); } catch { /* invalid URL has no cache entry */ }
  const headers = tokenExtraHeaders(config);
  clearOAuth2TokenCache(cacheKey(tokenUrl, config, headers));
}
