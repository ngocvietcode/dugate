import type { AuthConfig, GatewayHeader } from './types';

const MAX_AUTH_VALUE_LENGTH = 16_384;
const MAX_AUTH_KEY_LENGTH = 128;
const MAX_GATEWAY_HEADERS = 20;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN_CUSTOM_HEADERS = new Set(['connection', 'content-length', 'host', 'transfer-encoding']);
const FORBIDDEN_GATEWAY_HEADERS = new Set([...FORBIDDEN_CUSTOM_HEADERS, 'authorization', 'content-type']);

function nonEmptyBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\r\n]/.test(value);
}

function parseGatewayHeaders(input: Record<string, unknown>): GatewayHeader[] | undefined {
  const configured = input.gateway_headers;
  const headersByName = new Map<string, GatewayHeader>();

  if (Array.isArray(configured)) {
    for (const item of configured.slice(0, MAX_GATEWAY_HEADERS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const header = item as Record<string, unknown>;
      if (!nonEmptyBoundedString(header.name, MAX_AUTH_KEY_LENGTH)
          || !HEADER_NAME_PATTERN.test(header.name)
          || FORBIDDEN_GATEWAY_HEADERS.has(header.name.toLowerCase())) continue;

      const value = nonEmptyBoundedString(header.value, MAX_AUTH_VALUE_LENGTH) ? header.value : undefined;
      const valueSecretRef = nonEmptyBoundedString(header.value_secret_ref, MAX_AUTH_VALUE_LENGTH)
        ? header.value_secret_ref.trim()
        : undefined;
      if (!value && !valueSecretRef) continue;

      headersByName.set(header.name.toLowerCase(), {
        name: header.name,
        ...(value ? { value } : {}),
        ...(valueSecretRef ? { value_secret_ref: valueSecretRef } : {}),
      });
    }
  }

  const ibmClientId = nonEmptyBoundedString(input.ibm_client_id, 512) ? input.ibm_client_id.trim() : undefined;
  if (ibmClientId && !headersByName.has('x-ibm-client-id')) {
    headersByName.set('x-ibm-client-id', { name: 'X-IBM-Client-Id', value: ibmClientId });
  }
  return headersByName.size ? [...headersByName.values()] : undefined;
}

function withGatewayHeaders<T extends AuthConfig>(input: Record<string, unknown>, config: T): T {
  const gatewayHeaders = parseGatewayHeaders(input);
  return gatewayHeaders ? { ...config, gateway_headers: gatewayHeaders } : config;
}

/** Validate and normalize untrusted or persisted file URL authentication JSON. */
export function parseFileUrlAuthConfig(value: unknown): AuthConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;

  const configWithSecretReference = parseAuthConfigWithSecretReference(input);
  if (configWithSecretReference) return withGatewayHeaders(input, configWithSecretReference);

  if (input.type === 'none') return withGatewayHeaders(input, { type: 'none' });
  if (input.type === 'bearer' && nonEmptyBoundedString(input.token, MAX_AUTH_VALUE_LENGTH)) {
    return withGatewayHeaders(input, { type: 'bearer', token: input.token.trim() });
  }
  if (input.type === 'header'
      && nonEmptyBoundedString(input.header_name, MAX_AUTH_KEY_LENGTH)
      && HEADER_NAME_PATTERN.test(input.header_name)
      && !FORBIDDEN_CUSTOM_HEADERS.has(input.header_name.toLowerCase())
      && nonEmptyBoundedString(input.header_value, MAX_AUTH_VALUE_LENGTH)) {
    return withGatewayHeaders(input, {
      type: 'header',
      header_name: input.header_name,
      header_value: input.header_value,
    });
  }
  if (input.type === 'query'
      && nonEmptyBoundedString(input.query_key, MAX_AUTH_KEY_LENGTH)
      && nonEmptyBoundedString(input.query_value, MAX_AUTH_VALUE_LENGTH)) {
    return withGatewayHeaders(input, {
      type: 'query',
      query_key: input.query_key,
      query_value: input.query_value,
    });
  }
  if (input.type === 'csp_oauth2'
      && nonEmptyBoundedString(input.token_url, 2_048)
      && nonEmptyBoundedString(input.client_id, 512)
      && nonEmptyBoundedString(input.client_secret, MAX_AUTH_VALUE_LENGTH)) {
    try {
      const tokenUrl = new URL(input.token_url);
      if (tokenUrl.protocol !== 'http:' && tokenUrl.protocol !== 'https:') return undefined;
    } catch {
      return undefined;
    }
    if (input.csp_chunk_size !== undefined
        && (!Number.isInteger(input.csp_chunk_size) || Number(input.csp_chunk_size) <= 0 || Number(input.csp_chunk_size) > 100 * 1024 * 1024)) {
      return undefined;
    }
    return withGatewayHeaders(input, {
      type: 'csp_oauth2',
      token_url: input.token_url,
      client_id: input.client_id,
      client_secret: input.client_secret,
      ...(input.csp_chunk_size === undefined ? {} : { csp_chunk_size: Number(input.csp_chunk_size) }),
      ...(nonEmptyBoundedString(input.ibm_client_id, 512) ? { ibm_client_id: input.ibm_client_id.trim() } : {}),
    });
  }
  if (input.type === 'oauth2_client_credentials') {
    if (!nonEmptyBoundedString(input.token_url, 2_048)
        || !nonEmptyBoundedString(input.client_id, 512)
        || (!nonEmptyBoundedString(input.client_secret, MAX_AUTH_VALUE_LENGTH)
          && !nonEmptyBoundedString(input.client_secret_ref, MAX_AUTH_VALUE_LENGTH))) {
      return undefined;
    }
    try {
      const tokenUrl = new URL(input.token_url);
      if (tokenUrl.protocol !== 'http:' && tokenUrl.protocol !== 'https:') return undefined;
    } catch {
      return undefined;
    }
    if (input.token_body_format !== undefined
        && input.token_body_format !== 'json'
        && input.token_body_format !== 'form') return undefined;
    if (input.token_auth_style !== undefined
        && input.token_auth_style !== 'body'
        && input.token_auth_style !== 'basic') return undefined;
    if ((input.scope !== undefined && !nonEmptyBoundedString(input.scope, MAX_AUTH_VALUE_LENGTH))
        || (input.audience !== undefined && !nonEmptyBoundedString(input.audience, MAX_AUTH_VALUE_LENGTH))
        || (input.token_response_path !== undefined && !nonEmptyBoundedString(input.token_response_path, MAX_AUTH_VALUE_LENGTH))
        || (input.csp_chunk_size !== undefined
          && (!Number.isInteger(input.csp_chunk_size) || Number(input.csp_chunk_size) <= 0 || Number(input.csp_chunk_size) > 100 * 1024 * 1024))) {
      return undefined;
    }
    return withGatewayHeaders(input, {
      type: 'oauth2_client_credentials',
      token_url: input.token_url,
      client_id: input.client_id,
      ...(nonEmptyBoundedString(input.client_secret, MAX_AUTH_VALUE_LENGTH)
        ? { client_secret: input.client_secret }
        : {}),
      ...(nonEmptyBoundedString(input.client_secret_ref, MAX_AUTH_VALUE_LENGTH)
        ? { client_secret_ref: input.client_secret_ref.trim() }
        : {}),
      token_body_format: input.token_body_format ?? 'form',
      token_auth_style: input.token_auth_style ?? 'body',
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.audience === undefined ? {} : { audience: input.audience }),
      ...(input.token_response_path === undefined ? {} : { token_response_path: input.token_response_path }),
      ...(input.csp_chunk_size === undefined ? {} : { csp_chunk_size: Number(input.csp_chunk_size) }),
      ...(nonEmptyBoundedString(input.ibm_client_id, 512) ? { ibm_client_id: input.ibm_client_id.trim() } : {}),
    });
  }
  return undefined;
}

function parseAuthConfigWithSecretReference(input: Record<string, unknown>): AuthConfig | undefined {
  if (input.type === 'bearer' && nonEmptyBoundedString(input.token_secret_ref, MAX_AUTH_VALUE_LENGTH)) {
    return {
      type: 'bearer',
      ...(nonEmptyBoundedString(input.token, MAX_AUTH_VALUE_LENGTH) ? { token: input.token.trim() } : {}),
      token_secret_ref: input.token_secret_ref.trim(),
    };
  }
  if (input.type === 'header'
      && nonEmptyBoundedString(input.header_name, MAX_AUTH_KEY_LENGTH)
      && HEADER_NAME_PATTERN.test(input.header_name)
      && !FORBIDDEN_CUSTOM_HEADERS.has(input.header_name.toLowerCase())
      && nonEmptyBoundedString(input.header_value_secret_ref, MAX_AUTH_VALUE_LENGTH)) {
    return {
      type: 'header',
      header_name: input.header_name,
      ...(nonEmptyBoundedString(input.header_value, MAX_AUTH_VALUE_LENGTH) ? { header_value: input.header_value } : {}),
      header_value_secret_ref: input.header_value_secret_ref.trim(),
    };
  }
  if (input.type === 'query'
      && nonEmptyBoundedString(input.query_key, MAX_AUTH_KEY_LENGTH)
      && nonEmptyBoundedString(input.query_value_secret_ref, MAX_AUTH_VALUE_LENGTH)) {
    return {
      type: 'query',
      query_key: input.query_key,
      ...(nonEmptyBoundedString(input.query_value, MAX_AUTH_VALUE_LENGTH) ? { query_value: input.query_value } : {}),
      query_value_secret_ref: input.query_value_secret_ref.trim(),
    };
  }
  if (input.type === 'csp_oauth2'
      && nonEmptyBoundedString(input.token_url, 2_048)
      && nonEmptyBoundedString(input.client_id, 512)
      && nonEmptyBoundedString(input.client_secret_ref, MAX_AUTH_VALUE_LENGTH)) {
    try {
      const tokenUrl = new URL(input.token_url);
      if (tokenUrl.protocol !== 'http:' && tokenUrl.protocol !== 'https:') return undefined;
    } catch {
      return undefined;
    }
    if (input.csp_chunk_size !== undefined
        && (!Number.isInteger(input.csp_chunk_size) || Number(input.csp_chunk_size) <= 0 || Number(input.csp_chunk_size) > 100 * 1024 * 1024)) {
      return undefined;
    }
    return {
      type: 'csp_oauth2',
      token_url: input.token_url,
      client_id: input.client_id,
      ...(nonEmptyBoundedString(input.client_secret, MAX_AUTH_VALUE_LENGTH) ? { client_secret: input.client_secret } : {}),
      client_secret_ref: input.client_secret_ref.trim(),
      ...(input.csp_chunk_size === undefined ? {} : { csp_chunk_size: Number(input.csp_chunk_size) }),
      ...(nonEmptyBoundedString(input.ibm_client_id, 512) ? { ibm_client_id: input.ibm_client_id.trim() } : {}),
    };
  }
  return undefined;
}
