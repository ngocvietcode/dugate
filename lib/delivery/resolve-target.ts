import { assertSafeUrl, isUrlOriginAllowed } from '@/lib/pipelines/processors/http-client';

export type CallbackTargetSource = 'request' | 'none';

export interface ResolveCallbackTargetInput {
  callbackUrl: unknown;
  webhookUrl: unknown;
}

export type ResolveCallbackTargetResult =
  | { ok: true; url: string | null; source: CallbackTargetSource }
  | { ok: false; detail: string };

function normalizeRequestUrl(value: unknown, field: 'callback_url' | 'webhook_url'):
  | { ok: true; url: string | null }
  | { ok: false; detail: string } {
  if (value === null || value === undefined || value === '') return { ok: true, url: null };
  if (typeof value !== 'string') return { ok: false, detail: `${field} must be a string.` };

  let url = value.trim();
  if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1).trim();
  return { ok: true, url: url || null };
}

function requestFailureDetail(field: 'callback_url' | 'webhook_url', allowlist: boolean): string {
  if (field === 'webhook_url') {
    return allowlist
      ? 'webhook_url origin is not allowlisted.'
      : 'webhook_url is not an allowed callback URL.';
  }
  return allowlist
    ? 'callback_url origin is not allowlisted.'
    : 'callback_url is not an allowed callback URL.';
}

/** Resolves a callback destination only from a request's canonical URL or legacy alias. */
export async function resolveCallbackTarget(input: ResolveCallbackTargetInput): Promise<ResolveCallbackTargetResult> {
  const callbackUrl = normalizeRequestUrl(input.callbackUrl, 'callback_url');
  if (!callbackUrl.ok) return callbackUrl;
  const webhookUrl = normalizeRequestUrl(input.webhookUrl, 'webhook_url');
  if (!webhookUrl.ok) return webhookUrl;

  if (callbackUrl.url && webhookUrl.url && callbackUrl.url !== webhookUrl.url) {
    return { ok: false, detail: 'callback_url and webhook_url must match when both are provided.' };
  }

  const selectedUrl = callbackUrl.url ?? webhookUrl.url;
  if (!selectedUrl) return { ok: true, url: null, source: 'none' };
  const requestField: 'callback_url' | 'webhook_url' = callbackUrl.url ? 'callback_url' : 'webhook_url';

  try {
    const safeUrl = await assertSafeUrl(selectedUrl);
    if (!isUrlOriginAllowed(safeUrl, process.env.ALLOWED_WEBHOOK_ORIGINS ?? '')) {
      return { ok: false, detail: requestFailureDetail(requestField, true) };
    }
    return { ok: true, url: safeUrl, source: 'request' };
  } catch {
    return { ok: false, detail: requestFailureDetail(requestField, false) };
  }
}
