export type WebhookDisplayState = 'unconfigured' | 'sent' | 'failed' | 'legacy';

export interface WebhookDisplayInput {
  webhookUrl: string | null;
  webhookSentAt: string | null;
  webhookAttempts: number | null;
}

/** Classifies current and historical callback rows without changing delivery behavior. */
export function getWebhookDisplayState({ webhookUrl, webhookSentAt, webhookAttempts }: WebhookDisplayInput): WebhookDisplayState {
  if (!webhookUrl) return 'unconfigured';
  if (webhookSentAt) return 'sent';
  // A recorded zero denotes a preflight failure (e.g. blocked origin), not a legacy row.
  if (webhookAttempts !== null) return 'failed';
  return 'legacy';
}

function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}${url.search ? '?[redacted]' : ''}`;
  } catch {
    return '[redacted URL]';
  }
}

/** Removes likely credentials and URL query values before displaying delivery diagnostics. */
export function scrubWebhookError(error: string | null | undefined, maxLength = 280): string | null {
  if (!error?.trim()) return null;
  const scrubbed = error
    .replace(/https?:\/\/[^\s,;]+/gi, scrubUrl)
    .replace(/\b(authorization|x-api-key|token|secret|password)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, (_match, name: string) => `${name}=[redacted]`)
    .replace(/\bbearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, Math.max(0, maxLength - 1))}…` : scrubbed;
}
