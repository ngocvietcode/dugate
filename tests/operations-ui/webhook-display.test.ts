import { getWebhookDisplayState, scrubWebhookError } from '@/lib/ops/webhook-display';

describe('webhook display helpers', () => {
  it.each([
    [{ webhookUrl: null, webhookSentAt: null, webhookAttempts: null }, 'unconfigured'],
    [{ webhookUrl: 'https://callback.test/hook', webhookSentAt: '2026-08-19T00:00:00.000Z', webhookAttempts: 1 }, 'sent'],
    [{ webhookUrl: 'https://callback.test/hook', webhookSentAt: null, webhookAttempts: 0 }, 'failed'],
    [{ webhookUrl: 'https://callback.test/hook', webhookSentAt: null, webhookAttempts: null }, 'legacy'],
  ] as const)('classifies %o as %s', (input, expected) => {
    expect(getWebhookDisplayState(input)).toBe(expected);
  });

  it('redacts credentials and URL query values before displaying an error', () => {
    expect(scrubWebhookError('POST https://partner.test/hook?token=do-not-show Authorization: Bearer do-not-show')).toBe(
      'POST https://partner.test/hook?[redacted] Authorization=[redacted]',
    );
  });

  it('bounds a long diagnostic', () => {
    expect(scrubWebhookError('x'.repeat(20), 10)).toBe('xxxxxxxxx…');
  });
});
