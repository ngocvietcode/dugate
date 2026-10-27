// Applies synchronous outbound authentication fields. OAuth2 token retrieval remains asynchronous and belongs elsewhere.

import type { AuthConfig, GatewayHeader } from './types';

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((configured) => configured.toLowerCase() === name.toLowerCase());
}

/** Builds APIC gateway headers, preserving the legacy IBM alias when no explicit header overrides it. */
export function buildGatewayHeaders(
  authConfig?: AuthConfig,
  resolvedGatewayHeaders?: GatewayHeader[],
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of resolvedGatewayHeaders ?? authConfig?.gateway_headers ?? []) {
    if (header.value) headers[header.name] = header.value;
  }
  if (authConfig?.ibm_client_id && !hasHeader(headers, 'X-IBM-Client-Id')) {
    headers['X-IBM-Client-Id'] = authConfig.ibm_client_id;
  }
  return headers;
}

export function buildSyncAuthHeaders(authConfig?: AuthConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!authConfig || authConfig.type === 'none') return headers;
  if (authConfig.type === 'bearer' && authConfig.token) {
    headers.Authorization = `Bearer ${authConfig.token}`;
  } else if (authConfig.type === 'header' && authConfig.header_name && authConfig.header_value) {
    headers[authConfig.header_name] = authConfig.header_value;
  }
  return headers;
}

export function applyQueryAuth(urlStr: string, authConfig?: AuthConfig): string {
  if (!authConfig || authConfig.type !== 'query') return urlStr;
  if (!authConfig.query_key || !authConfig.query_value) return urlStr;
  try {
    const url = new URL(urlStr);
    url.searchParams.set(authConfig.query_key, authConfig.query_value);
    return url.toString();
  } catch {
    return urlStr;
  }
}
