import { buildGatewayHeaders, buildSyncAuthHeaders } from '@/lib/auth-config/apply';
import { parseFileUrlAuthConfig } from '@/lib/auth-config/parse';
import { resolveAuthConfigSecrets } from '@/lib/auth-config/resolve-secret';
import type { AuthConfig } from '@/lib/auth-config/types';
import { decrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import { apiKeys, operations } from '@/lib/db/schema';
import type { BuildCallbackPayloadInput } from '@/lib/delivery/build-payload';
import { buildCallbackPayload } from '@/lib/delivery/build-payload';
import { describeSentBody } from '@/lib/delivery/failed-payload-meta';
import type { Logger } from '@/lib/logger';
import { assertSafeUrl, isUrlOriginAllowed, sanitizeUrlForLogging, ssrfSafeFetch } from '@/lib/pipelines/processors/http-client';
import { eq } from 'drizzle-orm';

const WEBHOOK_ATTEMPTS = 3;
const WEBHOOK_TIMEOUT_MS = 10_000;

type CallbackLogger = Pick<Logger, 'info' | 'warn' | 'error'>;

export interface CallbackDeliveryConfig {
  active: boolean;
  payloadMode: 'WITH_RESULT' | null;
  authConfigured: boolean;
  authConfig?: AuthConfig;
}

/**
 * Optional outbound-body transform (encoding / encryption), mirroring the
 * workflow engine's `transformWebhookPayload`. When provided, it turns the
 * plain payload object into the exact wire body + extra headers to send.
 * The DB always records the delivery result against the plain payload; only
 * the bytes on the wire are transformed.
 */
export type WebhookPayloadTransform = (
  payload: Record<string, unknown>,
) => Promise<{ body: string; headers: Record<string, string> }>;

export interface ConfiguredWebhookInput {
  operationId: string;
  webhookUrl: string | null;
  config: CallbackDeliveryConfig;
  payload: Record<string, unknown>;
  logger: CallbackLogger;
  /** Optional spec-style encryption transform applied to the wire body. */
  encryptTransform?: WebhookPayloadTransform;
}

export interface WebhookDeliveryResult {
  delivered: boolean;
  attempts: number;
  lastError: string | null;
}

/**
 * Loads only Profile-scoped callback delivery settings. Destination URLs always
 * come from the request, and endpoint callback overrides are intentionally ignored.
 */
export async function resolveCallbackDeliveryConfig(
  apiKeyId: string | null | undefined,
): Promise<CallbackDeliveryConfig> {
  if (!apiKeyId) {
    return { active: false, payloadMode: null, authConfigured: false };
  }

  const profileRows = await db.select({
    callbackAuthConfig: apiKeys.callbackAuthConfig,
    callbackPayload: apiKeys.callbackPayload,
  }).from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1);

  const profile = profileRows[0];
  const payloadMode = profile?.callbackPayload === 'WITH_RESULT' ? 'WITH_RESULT' : null;
  const authConfigured = Boolean(profile?.callbackAuthConfig);

  return {
    active: authConfigured || payloadMode !== null,
    payloadMode,
    authConfigured,
    authConfig: parseCallbackAuthConfig(profile?.callbackAuthConfig),
  };
}

/** Runs T10's frozen payload builder before using the Profile delivery transport. */
export async function sendProfileCallback(
  input: Omit<ConfiguredWebhookInput, 'payload'> & { payloadInput: BuildCallbackPayloadInput },
): Promise<WebhookDeliveryResult> {
  return sendConfiguredWebhook({
    ...input,
    payload: buildCallbackPayload({ ...input.payloadInput, mode: input.config.payloadMode }),
  });
}

/**
 * Prepare the wire body + headers for a callback. When an encryption transform
 * is configured (Profile encryption_enabled) the plain payload is run through it;
 * otherwise the payload is serialized as-is (unchanged legacy behaviour).
 */
async function prepareWebhookWire(
  input: ConfiguredWebhookInput,
): Promise<{ body: string; extraHeaders: Record<string, string> }> {
  if (input.encryptTransform) {
    const { body, headers } = await input.encryptTransform(input.payload);
    return { body, extraHeaders: headers };
  }
  return { body: JSON.stringify(input.payload), extraHeaders: {} };
}

/**
 * Sends an already-built callback body through the Profile-configured transport.
 * URL authorization is completed before resolving or attaching any credentials.
 */
export async function sendConfiguredWebhook(input: ConfiguredWebhookInput): Promise<WebhookDeliveryResult> {
  if (!input.webhookUrl) return { delivered: false, attempts: 0, lastError: null };

  let targetUrl: string;
  try {
    targetUrl = await assertSafeUrl(input.webhookUrl);
  } catch {
    return persistDeliveryResult(input.operationId, false, 0, 'Callback URL is not allowed.');
  }

  if (!isUrlOriginAllowed(targetUrl, process.env.ALLOWED_WEBHOOK_ORIGINS ?? '')) {
    input.logger.warn(`[WEBHOOK] Blocked non-allowlisted callback origin: ${sanitizeUrlForLogging(targetUrl)}`);
    return persistDeliveryResult(input.operationId, false, 0, 'Callback origin is not allowlisted.');
  }

  const headers = await resolveCallbackHeaders(input.config, input.logger);
  if (!headers.ok) {
    return persistDeliveryResult(input.operationId, false, 0, headers.error);
  }

  // Build the wire body up front. If encryption is enabled but misconfigured
  // (missing key / selective fields that match nothing) the transform throws —
  // fail closed and never fall back to sending the plaintext payload.
  let wireBody: string;
  let encryptHeaders: Record<string, string>;
  try {
    const prepared = await prepareWebhookWire(input);
    wireBody = prepared.body;
    encryptHeaders = prepared.extraHeaders;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    // No wire body exists — the transform threw before producing one. Record the
    // plain payload's top-level keys only (no values) so we know what failed to encrypt.
    input.logger.error(
      `[WEBHOOK] Payload encryption failed for ${input.operationId}: ${msg}`,
      { encryption_failed: true, payload_keys: Object.keys(input.payload) },
    );
    return persistDeliveryResult(input.operationId, false, 0, `Callback payload encryption failed: ${msg}`);
  }

  const safeUrl = sanitizeUrlForLogging(targetUrl);
  let lastError = 'Callback delivery failed.';
  for (let attempt = 1; attempt <= WEBHOOK_ATTEMPTS; attempt += 1) {
    try {
      const response = await ssrfSafeFetch(targetUrl, {
        method: 'POST',
        headers: { ...headers.value, ...encryptHeaders },
        body: wireBody,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      await response.text().catch(() => '');
      if (response.ok) {
        input.logger.info(`[WEBHOOK] Sent callback to ${safeUrl} (attempt ${attempt}, HTTP ${response.status})`);
        return persistDeliveryResult(input.operationId, true, attempt, null);
      }
      lastError = `Callback returned HTTP ${response.status}.`;
      input.logger.warn(`[WEBHOOK] Callback attempt ${attempt}/${WEBHOOK_ATTEMPTS} returned HTTP ${response.status} for ${safeUrl}`);
    } catch (error: unknown) {
      lastError = error instanceof Error && error.name === 'AbortError'
        ? 'Callback request timed out.'
        : 'Callback request failed.';
      input.logger.warn(`[WEBHOOK] Callback attempt ${attempt}/${WEBHOOK_ATTEMPTS} failed for ${safeUrl}`, undefined, error);
    }
    if (attempt < WEBHOOK_ATTEMPTS) await delay(attempt * 1000);
  }

  input.logger.error(
    `[WEBHOOK] Callback delivery failed after ${WEBHOOK_ATTEMPTS} attempts for ${input.operationId}`,
    describeSentBody(wireBody, { last_error: lastError }),
  );
  return persistDeliveryResult(input.operationId, false, WEBHOOK_ATTEMPTS, lastError);
}

function parseCallbackAuthConfig(raw: string | null | undefined): AuthConfig | undefined {
  if (!raw) return undefined;

  const parse = (value: string): AuthConfig | undefined => {
    try {
      const config = parseFileUrlAuthConfig(JSON.parse(value));
      // Query auth is rejected at persistence and prohibited again at use time:
      // callback URLs must never be modified with a stored secret.
      return config?.type === 'query' ? undefined : config;
    } catch {
      return undefined;
    }
  };

  try {
    return parse(decrypt(raw));
  } catch {
    return parse(raw);
  }
}

async function resolveCallbackHeaders(
  config: CallbackDeliveryConfig,
  logger: CallbackLogger,
): Promise<{ ok: true; value: Record<string, string> } | { ok: false; error: string }> {
  if (config.authConfigured && !config.authConfig) {
    return { ok: false, error: 'Callback authentication configuration is invalid.' };
  }
  if (!config.authConfig) return { ok: true, value: { 'Content-Type': 'application/json' } };

  const resolvedAuth = await resolveAuthConfigSecrets(config.authConfig, (message) => logger.warn(`[WEBHOOK] ${message}`));
  if (!resolvedAuth) return { ok: false, error: 'Callback credentials could not be resolved.' };

  const gatewayHeaders = buildGatewayHeaders(resolvedAuth);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...gatewayHeaders,
    ...buildSyncAuthHeaders(resolvedAuth),
  };

  try {
    if (resolvedAuth.type === 'csp_oauth2'
        && resolvedAuth.token_url && resolvedAuth.client_id && resolvedAuth.client_secret) {
      const { getCspToken } = await import('@/lib/csp-token');
      const token = await getCspToken({
        token_url: await assertSafeUrl(resolvedAuth.token_url),
        client_id: resolvedAuth.client_id,
        client_secret: resolvedAuth.client_secret,
        ibm_client_id: resolvedAuth.ibm_client_id,
        gateway_headers: gatewayHeaders,
      });
      headers.Authorization = `Bearer ${token}`;
    }
    if (resolvedAuth.type === 'oauth2_client_credentials'
        && resolvedAuth.token_url && resolvedAuth.client_id && resolvedAuth.client_secret) {
      const { getOAuth2Token } = await import('@/lib/auth-config/oauth2-token');
      const token = await getOAuth2Token({
        token_url: resolvedAuth.token_url,
        client_id: resolvedAuth.client_id,
        client_secret: resolvedAuth.client_secret,
        token_body_format: resolvedAuth.token_body_format,
        token_auth_style: resolvedAuth.token_auth_style,
        scope: resolvedAuth.scope,
        audience: resolvedAuth.audience,
        token_response_path: resolvedAuth.token_response_path,
        ...(Object.keys(gatewayHeaders).length ? { token_extra_headers: gatewayHeaders } : {}),
      }, { errorPrefix: 'Callback OAuth2 token' });
      headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    logger.warn('[WEBHOOK] Callback authentication could not be prepared.', undefined, error);
    return { ok: false, error: 'Callback credentials could not be resolved.' };
  }

  return { ok: true, value: headers };
}

async function persistDeliveryResult(
  operationId: string,
  delivered: boolean,
  attempts: number,
  lastError: string | null,
): Promise<WebhookDeliveryResult> {
  await db.update(operations).set(delivered
    ? { webhookSentAt: new Date(), webhookAttempts: attempts, webhookLastError: null }
    : { webhookAttempts: attempts, webhookLastError: lastError },
  ).where(eq(operations.id, operationId));
  return { delivered, attempts, lastError };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
