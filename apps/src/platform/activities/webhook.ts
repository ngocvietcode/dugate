import { ApplicationFailure } from '@temporalio/activity';
import type { RunEvent } from '../contract';
import { assertAllowedCallback } from '../security/callback-url';
import { sign } from '../security/hmac';

export interface DeliverInput { url: string; event: RunEvent; eventId: string }

/** Gửi sự kiện run tới callback của hệ thống gọi; Temporal retry khi 5xx/mạng lỗi. */
export function createWebhookActivities(opts: { secret: string; allowedHosts: string[]; fetchImpl?: typeof fetch;
  now?: () => number }) {
  const f = opts.fetchImpl ?? fetch;
  return {
    async deliverWebhook(input: DeliverInput): Promise<{ status: number }> {
      try {
        assertAllowedCallback(input.url, opts.allowedHosts);
      } catch (e) {
        throw ApplicationFailure.nonRetryable((e as Error).message, 'CallbackNotAllowed');
      }
      const body = JSON.stringify(input.event);
      const ts = String(Math.floor((opts.now?.() ?? Date.now()) / 1000));
      const res = await f(input.url, {
        method: 'POST', body, signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'x-dugate-event-id': input.eventId, 'x-dugate-timestamp': ts,
          'x-dugate-signature': `sha256=${sign(opts.secret, ts, body)}` },
      });
      if (res.ok) return { status: res.status };
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw ApplicationFailure.nonRetryable(`callback trả ${res.status}`, 'CallbackRejected');
      }
      throw new Error(`callback trả ${res.status}`);
    },
  };
}
export type WebhookActivities = ReturnType<typeof createWebhookActivities>;
