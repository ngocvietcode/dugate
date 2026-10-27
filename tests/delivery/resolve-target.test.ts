const mockAssertSafeUrl = jest.fn(async (url: string) => `safe:${url}`);
const mockIsUrlOriginAllowed = jest.fn(() => true);

jest.mock('@/lib/pipelines/processors/http-client', () => ({
  assertSafeUrl: mockAssertSafeUrl,
  isUrlOriginAllowed: mockIsUrlOriginAllowed,
}));

import { resolveCallbackTarget } from '@/lib/delivery/resolve-target';

describe('resolveCallbackTarget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertSafeUrl.mockImplementation(async (url: string) => `safe:${url}`);
    mockIsUrlOriginAllowed.mockReturnValue(true);
  });

  it('accepts the legacy webhook_url byte-for-byte when no Profile callback exists', async () => {
    await expect(resolveCallbackTarget({ callbackUrl: null, webhookUrl: 'https://legacy.test/hook' }))
      .resolves.toEqual({ ok: true, url: 'safe:https://legacy.test/hook', source: 'request' });
  });

  it('accepts callback_url and rejects conflicting aliases before validating either URL', async () => {
    await expect(resolveCallbackTarget({ callbackUrl: 'https://new.test/hook', webhookUrl: null }))
      .resolves.toEqual({ ok: true, url: 'safe:https://new.test/hook', source: 'request' });
    await expect(resolveCallbackTarget({
      callbackUrl: 'https://new.test/hook', webhookUrl: 'https://legacy.test/hook',
    })).resolves.toEqual({ ok: false, detail: 'callback_url and webhook_url must match when both are provided.' });
    expect(mockAssertSafeUrl).toHaveBeenCalledTimes(1);
  });

  it('uses only callback_url or webhook_url from the request and ignores no persisted source', async () => {
    await expect(resolveCallbackTarget({ callbackUrl: null, webhookUrl: null }))
      .resolves.toEqual({ ok: true, url: null, source: 'none' });
  });

  it('preserves legacy webhook_url validation messages', async () => {
    mockIsUrlOriginAllowed.mockReturnValue(false);
    await expect(resolveCallbackTarget({ callbackUrl: null, webhookUrl: 'https://legacy.test/hook' }))
      .resolves.toEqual({ ok: false, detail: 'webhook_url origin is not allowlisted.' });

    mockAssertSafeUrl.mockRejectedValueOnce(new Error('unsafe'));
    await expect(resolveCallbackTarget({ callbackUrl: null, webhookUrl: 'https://legacy.test/hook' }))
      .resolves.toEqual({ ok: false, detail: 'webhook_url is not an allowed callback URL.' });
  });
});
