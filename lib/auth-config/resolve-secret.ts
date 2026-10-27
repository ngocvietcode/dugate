// Resolves Vault references in a parsed, already-decrypted auth configuration.

import { getSecretProvider } from '@/lib/secrets';
import type { AuthConfig, GatewayHeader } from './types';

export type AuthConfigWarn = (message: string) => void;

/** Resolves gateway-header Vault references without exposing values or references in warnings. */
export async function resolveGatewayHeaders(
  headers: GatewayHeader[] | undefined,
  warn: AuthConfigWarn = console.warn,
): Promise<GatewayHeader[] | undefined> {
  if (!headers?.length) return headers;

  const resolved: GatewayHeader[] = [];
  for (const header of headers) {
    const value = await resolveSecretValue(header.value, header.value_secret_ref, 'gateway header value', warn);
    if (!value) return undefined;
    resolved.push({ ...header, value });
  }
  return resolved;
}

/**
 * Resolves configured secret references. Inline values are already decrypted by the
 * configuration loader, so this module must not decrypt individual fields again.
 * A provider failure returns undefined so callers continue without credentials.
 */
export async function resolveAuthConfigSecrets(
  authConfig: AuthConfig | undefined,
  warn: AuthConfigWarn = console.warn,
): Promise<AuthConfig | undefined> {
  if (!authConfig) return undefined;

  let resolvedConfig: AuthConfig | undefined;
  switch (authConfig.type) {
    case 'none':
      resolvedConfig = authConfig;
      break;
    case 'bearer': {
      const token = await resolveSecretValue(authConfig.token, authConfig.token_secret_ref, 'bearer token', warn);
      resolvedConfig = token ? { ...authConfig, token } : undefined;
      break;
    }
    case 'header': {
      const headerValue = await resolveSecretValue(authConfig.header_value, authConfig.header_value_secret_ref, 'header value', warn);
      resolvedConfig = headerValue ? { ...authConfig, header_value: headerValue } : undefined;
      break;
    }
    case 'query': {
      const queryValue = await resolveSecretValue(authConfig.query_value, authConfig.query_value_secret_ref, 'query value', warn);
      resolvedConfig = queryValue ? { ...authConfig, query_value: queryValue } : undefined;
      break;
    }
    case 'csp_oauth2':
    case 'oauth2_client_credentials': {
      const clientSecret = await resolveSecretValue(authConfig.client_secret, authConfig.client_secret_ref, 'OAuth2 client secret', warn);
      resolvedConfig = clientSecret ? { ...authConfig, client_secret: clientSecret } : undefined;
      break;
    }
  }

  if (!resolvedConfig) return undefined;
  const gatewayHeaders = await resolveGatewayHeaders(resolvedConfig.gateway_headers, warn);
  if (resolvedConfig.gateway_headers?.length && !gatewayHeaders) return undefined;
  return gatewayHeaders ? { ...resolvedConfig, gateway_headers: gatewayHeaders } : resolvedConfig;
}

async function resolveSecretValue(
  inlineValue: string | undefined,
  secretRef: string | undefined,
  fieldName: string,
  warn: AuthConfigWarn,
): Promise<string | undefined> {
  const ref = secretRef?.trim();
  if (!ref) return inlineValue;

  try {
    return await getSecretProvider().getSecret(ref);
  } catch {
    warn(`[AUTH_CONFIG] Could not resolve ${fieldName} from the secret provider; credentials were not attached.`);
    return undefined;
  }
}
