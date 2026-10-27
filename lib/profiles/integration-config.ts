import type { AuthConfig, GatewayHeader } from '@/lib/auth-config/types';

export type AuthType = AuthConfig['type'];
export type ApiKeyAuthLocation = 'header' | 'query';
export const SECRET_PLACEHOLDER = 'Đã cấu hình — nhập giá trị mới để thay thế';

/** Maps the UI's single API Key mechanism onto the unchanged persisted auth types. */
export function selectApiKeyAuthLocation(draft: AuthConfigDraft, location: ApiKeyAuthLocation): AuthConfigDraft {
  return location === 'query'
    ? { ...draft, type: 'query', header_name: undefined, header_value: undefined, header_value_secret_ref: undefined }
    : { ...draft, type: 'header', query_key: undefined, query_value: undefined, query_value_secret_ref: undefined };
}

/**
 * Initializes a new OAuth2 client-credentials draft with APIC-friendly defaults.
 * Because the default integration path goes through the APIC gateway, JSON body,
 * body-style client auth, and an empty X-IBM-Client-Id header are sensible starting
 * values instead of a discrete preset button. Admins for non-APIC systems simply
 * remove the header and switch the body/auth style. Existing values are preserved.
 */
export function initOAuth2Draft(draft: AuthConfigDraft): AuthConfigDraft {
  const gatewayHeaders = draft.gateway_headers ?? [];
  const hasIbmHeader = gatewayHeaders.some(header => header.name.toLowerCase() === 'x-ibm-client-id');
  return {
    ...draft,
    type: 'oauth2_client_credentials',
    token_body_format: 'json',
    token_auth_style: 'body',
    gateway_headers: hasIbmHeader ? gatewayHeaders : [...gatewayHeaders, { name: 'X-IBM-Client-Id', value: '' }],
  };
}

export interface GatewayHeaderDraft extends GatewayHeader {
  /** The value is deliberately blanked after loading; this flag preserves UI intent only. */
  hasSavedValue?: boolean;
  /** Masked preview of the stored inline value (e.g. "skt•••••••••••••••t11"). Display-only. */
  valuePreview?: string;
}

export interface AuthConfigDraft extends Omit<AuthConfig, 'gateway_headers'> {
  gateway_headers?: GatewayHeaderDraft[];
  /** A stored credential exists but must never be put back into a request unchanged. */
  hasSavedSecret?: boolean;
  /**
   * Masked previews of stored inline secrets (display-only, never re-submitted).
   * Populated from server metadata so the operator recognizes a saved credential.
   */
  client_secret_preview?: string;
  token_preview?: string;
  header_value_preview?: string;
  query_value_preview?: string;
}

export interface ProfileInputSourceDraft {
  auth: AuthConfigDraft;
  authConfigured: boolean;
}

export interface ProfileCallbackDraft {
  payload: 'WITH_RESULT' | null;
  auth: AuthConfigDraft;
  authConfigured: boolean;
}

export interface EndpointInputSourceDraft {
  defaultChunks: string;
}

export interface ProfileIntegrationDraft {
  inputSource: ProfileInputSourceDraft;
  callback: ProfileCallbackDraft;
  /**
   * UI-only intent flag: when false the callback reuses the shared system auth
   * (`inputSource.auth`); when true the callback keeps its own configuration.
   * Persistence still targets the unchanged `fileAuthConfig`/`callbackAuthConfig`
   * columns — this flag never becomes its own column.
   */
  callbackUsesSeparateAuth: boolean;
}

export type EndpointInputMode = 'upload' | 'file_url' | 'both';

export interface EndpointIntegrationDraft {
  inputSource: EndpointInputSourceDraft;
  /**
   * cURL preview switch: which file input the generated example shows. Session-only,
   * deliberately never persisted and never read at runtime.
   */
  inputMode: EndpointInputMode;
  /** cURL preview switch: include `callback_url` in the example. Session-only. */
  curlIncludeCallback: boolean;
}

function hasSecret(config?: Partial<AuthConfig>): boolean {
  if (!config) return false;
  return Boolean(
    config.token || config.token_secret_ref || config.header_value || config.header_value_secret_ref
    || config.query_value || config.query_value_secret_ref || config.client_secret || config.client_secret_ref
    || config.gateway_headers?.some(header => header.value || header.value_secret_ref),
  );
}

function blankSavedSecrets(config?: AuthConfig | null, configured = false): AuthConfigDraft {
  if (!config) return { type: 'none', hasSavedSecret: configured };
  const { gateway_headers, token, token_secret_ref, header_value, header_value_secret_ref,
    query_value, query_value_secret_ref, client_secret, client_secret_ref, ...safe } = config;
  return {
    ...safe,
    ...(gateway_headers?.length ? {
      gateway_headers: gateway_headers.map(({ value, value_secret_ref, ...header }) => ({
        ...header,
        hasSavedValue: Boolean(value || value_secret_ref),
      })),
    } : {}),
    hasSavedSecret: configured || hasSecret(config),
  };
}

/** Turns decrypted config into a render-safe draft; no saved secret reaches an input value. */
export function sanitizeAuthDraft(config?: AuthConfig | null, configured = false): AuthConfigDraft {
  return blankSavedSecrets(config, configured);
}

/** Callback destination columns are intentionally no-ops; delivery URLs come only from requests. */
export function createProfileIntegrationDraft(profile: {
  fileAuthConfigured?: boolean;
  callbackAuthConfigured?: boolean;
  callbackPayload?: 'WITH_RESULT' | null;
  /** Auth type loaded from server (admin-only metadata, never contains secrets). */
  fileAuthType?: string | null;
  callbackAuthType?: string | null;
  /** Non-secret structural fields from stored auth config (admin-only). */
  fileAuthMetadata?: Record<string, unknown> | null;
  callbackAuthMetadata?: Record<string, unknown> | null;
}): ProfileIntegrationDraft {
  // The list API returns presence-only booleans (never decrypted config), so the
  // two configs can only be compared when their presence differs. A configured
  // callback with no file auth is unambiguously separate; when both are configured
  // we cannot tell them apart and default to shared (false), which never overwrites
  // a stored secret unless the operator actively edits and re-enters one.
  const callbackUsesSeparateAuth = Boolean(profile.callbackAuthConfigured) && !Boolean(profile.fileAuthConfigured);
  return {
    inputSource: {
      auth: buildAuthDraftFromMetadata(profile.fileAuthMetadata, Boolean(profile.fileAuthConfigured)),
      authConfigured: Boolean(profile.fileAuthConfigured),
    },
    callback: {
      payload: profile.callbackPayload ?? null,
      auth: buildAuthDraftFromMetadata(profile.callbackAuthMetadata, Boolean(profile.callbackAuthConfigured)),
      authConfigured: Boolean(profile.callbackAuthConfigured),
    },
    callbackUsesSeparateAuth,
  };
}

/**
 * Reconstruct an AuthConfigDraft from the non-secret metadata returned by the API.
 * Secret fields are left empty (hasSavedSecret=true indicates they exist server-side).
 * Non-secret fields (token_url, client_id, scope, etc.) are populated for display.
 */
function buildAuthDraftFromMetadata(metadata: Record<string, unknown> | null | undefined, configured: boolean): AuthConfigDraft {
  if (!metadata || !metadata.type) return { type: 'none', hasSavedSecret: configured };
  const type = metadata.type as AuthConfig['type'];
  const hasSavedSecret = configured || Boolean(metadata._hasSecret);
  const draft: AuthConfigDraft = { type, hasSavedSecret };
  // Populate non-secret structural fields from metadata
  if (metadata.token_url) draft.token_url = String(metadata.token_url);
  if (metadata.client_id) draft.client_id = String(metadata.client_id);
  if (metadata.header_name) draft.header_name = String(metadata.header_name);
  if (metadata.query_key) draft.query_key = String(metadata.query_key);
  if (metadata.token_body_format) draft.token_body_format = metadata.token_body_format as 'json' | 'form';
  if (metadata.token_auth_style) draft.token_auth_style = metadata.token_auth_style as 'body' | 'basic';
  if (metadata.scope) draft.scope = String(metadata.scope);
  if (metadata.audience) draft.audience = String(metadata.audience);
  if (metadata.token_response_path) draft.token_response_path = String(metadata.token_response_path);
  // Vault references are restored IN FULL (a path is not the secret) so the UI
  // shows the exact configured Vault path after reload and it round-trips on save.
  if (metadata.client_secret_ref) draft.client_secret_ref = String(metadata.client_secret_ref);
  if (metadata.token_secret_ref) draft.token_secret_ref = String(metadata.token_secret_ref);
  if (metadata.header_value_secret_ref) draft.header_value_secret_ref = String(metadata.header_value_secret_ref);
  if (metadata.query_value_secret_ref) draft.query_value_secret_ref = String(metadata.query_value_secret_ref);
  // Masked previews of stored inline secrets (display-only, never re-submitted).
  if (metadata.client_secret_preview) draft.client_secret_preview = String(metadata.client_secret_preview);
  if (metadata.token_preview) draft.token_preview = String(metadata.token_preview);
  if (metadata.header_value_preview) draft.header_value_preview = String(metadata.header_value_preview);
  if (metadata.query_value_preview) draft.query_value_preview = String(metadata.query_value_preview);
  // Gateway headers: restore names, masked inline previews, and full Vault refs.
  if (Array.isArray(metadata.gateway_headers)) {
    draft.gateway_headers = (metadata.gateway_headers as Array<{ name: string; hasValue?: boolean; valuePreview?: string; value_secret_ref?: string }>).map(h => ({
      name: h.name,
      hasSavedValue: Boolean(h.hasValue),
      ...(h.valuePreview ? { valuePreview: h.valuePreview } : {}),
      ...(h.value_secret_ref ? { value_secret_ref: h.value_secret_ref } : {}),
    }));
  }
  return draft;
}

/**
 * Endpoint callback columns are intentionally no-ops, and the per-endpoint file-auth
 * override was removed, so the chunk default is the only persisted value left here.
 * `inputMode` / `curlIncludeCallback` are cURL preview switches, not configuration.
 */
export function createEndpointIntegrationDraft(endpoint: {
  fileUrlDefaultChunks?: number | null;
}): EndpointIntegrationDraft {
  return {
    inputSource: {
      defaultChunks: endpoint.fileUrlDefaultChunks == null ? '' : String(endpoint.fileUrlDefaultChunks),
    },
    inputMode: 'both',
    curlIncludeCallback: false,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.every(item => item && typeof item === 'object' && 'name' in item)) {
      return [...value].map(canonicalize).sort((a, b) => String((a as { name: string }).name).localeCompare(String((b as { name: string }).name)));
    }
    return value.map(canonicalize);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, canonicalize((value as Record<string, unknown>)[key])]));
}

/** Deterministic across object key/header-row ordering, for dirty checks and resets. */
export function integrationDraftSignature(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function stripDraftMetadata(draft: AuthConfigDraft): AuthConfig {
  // Drop display-only fields so they never reach the request body: the masked
  // previews and Vault indicators exist purely for UI recognition.
  const {
    hasSavedSecret: _saved, gateway_headers,
    client_secret_preview: _csp, token_preview: _tp,
    header_value_preview: _hvp, query_value_preview: _qvp,
    ...config
  } = draft;
  const cleanedConfig = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined && value !== ''));
  const cleanedHeaders = gateway_headers
    ?.map(({ hasSavedValue: _hasSavedValue, valuePreview: _vp, ...header }) => ({
      ...header,
      ...(header.value?.trim() ? { value: header.value.trim() } : {}),
      ...(header.value_secret_ref?.trim() ? { value_secret_ref: header.value_secret_ref.trim() } : {}),
    }))
    // Keep any named header even when its value is blank: the server merges the
    // previously stored value/ref forward by header name. Only drop nameless rows.
    .filter(header => header.name?.trim());
  return {
    ...cleanedConfig,
    ...(cleanedHeaders?.length ? { gateway_headers: cleanedHeaders } : {}),
  } as AuthConfig;
}

function draftHasReplacementSecret(draft: AuthConfigDraft): boolean {
  return hasSecret(stripDraftMetadata(draft));
}

/**
 * Returns undefined when a stored auth value is unchanged, null for an intentional clear,
 * otherwise a new auth config. This preserves server has(key) semantics.
 *
 * IMPORTANT: The hasSavedSecret guard exists to prevent overwriting stored key material
 * when the operator only changes non-sensitive fields (e.g. token_url). The operator must
 * re-enter the value to prove intent. For BRAND NEW configs (baseline.type === 'none'
 * and both hasSavedSecret are false), this guard MUST NOT fire because there is nothing
 * stored to protect.
 */
export function authConfigPatch(current: AuthConfigDraft, baseline: AuthConfigDraft): AuthConfig | null | undefined {
  if (integrationDraftSignature(current) === integrationDraftSignature(baseline)) return undefined;
  if (current.type === 'none') return null;
  // A draft may legitimately change ONLY non-secret fields (Token URL, Client ID,
  // header names, scope, ...) while keeping a previously stored secret. We emit the
  // non-secret config WITHOUT the secret; the server merges the stored secret / Vault
  // reference forward (mergeAuthConfigPreservingSecrets). The operator only re-enters
  // a secret when they want to replace it. stripDraftMetadata already drops blanked
  // secret fields, so a sanitized saved draft carries no secret value here.
  const config = stripDraftMetadata(current);
  return { ...config, ...clearedOptionalFields(current, baseline) } as AuthConfig;
}

/**
 * Optional auth fields an operator may legitimately want to REMOVE after saving.
 * The required-per-type fields are excluded: blanking one of those makes the config
 * invalid, so the server's validator rejects it rather than persisting a broken entry.
 */
const CLEARABLE_OPTIONAL_FIELDS = [
  'scope', 'audience', 'token_response_path', 'ibm_client_id', 'csp_chunk_size',
] as const;

/**
 * Emits an explicit `null` for every optional field the operator just blanked.
 *
 * stripDraftMetadata drops empty strings, so a cleared field simply disappears from the
 * payload — indistinguishable from "the client never sent it". The server treats an absent
 * field as "keep what is stored" (so a partial PATCH cannot silently wipe a stored value),
 * which means a blanked field would otherwise be restored from the stored config and could
 * never be removed. Comparing against the baseline restores the distinction: absent means
 * unchanged, null means delete.
 */
function clearedOptionalFields(current: AuthConfigDraft, baseline: AuthConfigDraft): Record<string, null> {
  const cleared: Record<string, null> = {};
  const before_ = baseline as unknown as Record<string, unknown>;
  const after_ = current as unknown as Record<string, unknown>;
  for (const field of CLEARABLE_OPTIONAL_FIELDS) {
    const before = before_[field];
    const after = after_[field];
    const hadValue = before !== undefined && before !== null && before !== '';
    const nowEmpty = after === undefined || after === null || after === '';
    if (hadValue && nowEmpty) cleared[field] = null;
  }
  return cleared;
}

/**
 * Produces an auth config for an isolated test request only after a complete new
 * auth value is supplied. Omitting the key lets Batch 1's test runner resolve the
 * stored encrypted configuration instead of receiving a sanitized partial one.
 */
export function authConfigForTest(draft: AuthConfigDraft): AuthConfig | undefined {
  if (draft.type === 'none' || !draftHasReplacementSecret(draft)) return undefined;
  return stripDraftMetadata(draft);
}

export function profileIntegrationPatch(current: ProfileIntegrationDraft, baseline: ProfileIntegrationDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const fileAuth = authConfigPatch(current.inputSource.auth, baseline.inputSource.auth);
  if (fileAuth !== undefined) patch.fileAuthConfig = fileAuth;

  if (current.callbackUsesSeparateAuth) {
    // Separate callback auth: patch from the dedicated callback editor draft.
    const callbackAuth = authConfigPatch(current.callback.auth, baseline.callback.auth);
    if (callbackAuth !== undefined) patch.callbackAuthConfig = callbackAuth;
  } else if (current.inputSource.auth.type !== 'query') {
    // Shared: the callback mirrors the common system auth. A Query API key can never
    // apply to a callback (token would leak into the URL), so it is not propagated.
    const sharedCallbackAuth = authConfigPatch(current.inputSource.auth, baseline.callback.auth);
    if (sharedCallbackAuth !== undefined) patch.callbackAuthConfig = sharedCallbackAuth;
  }

  if (current.callback.payload !== baseline.callback.payload) patch.callbackPayload = current.callback.payload;

  // Safety: if the draft obviously differs but authConfigPatch returned undefined
  // (hasSavedSecret guard blocked emission), log a warning for diagnostics.
  if (Object.keys(patch).length === 0
      && integrationDraftSignature(current) !== integrationDraftSignature(baseline)) {
    if (typeof window !== 'undefined') {
      // Log only the field NAMES. The draft still holds whatever the operator just typed,
      // so printing the object would put a fresh plaintext secret into the browser console.
      console.warn('[profileIntegrationPatch] Draft changed but patch is empty — hasSavedSecret guard likely blocked emission.',
        { currentAuthKeys: Object.keys(current.inputSource.auth), baselineAuthKeys: Object.keys(baseline.inputSource.auth) });
    }
  }
  return patch;
}

export function endpointIntegrationPatch(current: EndpointIntegrationDraft, baseline: EndpointIntegrationDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  // No auth branch: the per-endpoint credential override was removed, and inputMode /
  // curlIncludeCallback are preview-only so they must never reach the request body.
  if (current.inputSource.defaultChunks !== baseline.inputSource.defaultChunks) {
    patch.fileUrlDefaultChunks = current.inputSource.defaultChunks.trim() ? Number(current.inputSource.defaultChunks) : null;
  }
  return patch;
}

export function testCallbackPayload(): Record<string, unknown> {
  return {
    operation_id: '00000000-0000-0000-0000-000000000000',
    state: 'SUCCEEDED',
    done: true,
    extracted_data: { _test: true },
  };
}
