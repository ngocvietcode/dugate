import { contentHash, stableStringify } from '@/lib/profiles/release/canonical';

describe('Profile Release canonical serialization', () => {
  it('is stable when object key order differs', () => {
    const first = { profile: { role: 'STANDARD', name: 'ocr' }, bundleVersion: 1 };
    const second = { bundleVersion: 1, profile: { name: 'ocr', role: 'STANDARD' } };

    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(contentHash(first)).toBe(contentHash(second));
  });

  it('sorts endpoint and override rows by their natural release keys', () => {
    const first = {
      endpoints: [
        {
          endpointSlug: 'extract:invoice',
          overrides: [
            { connectorSlug: 'connector-b', stepId: 'step-2' },
            { connectorSlug: 'connector-a', stepId: '_default' },
          ],
        },
        { endpointSlug: 'analyze:contract', overrides: [] },
      ],
    };
    const second = {
      endpoints: [
        { endpointSlug: 'analyze:contract', overrides: [] },
        {
          endpointSlug: 'extract:invoice',
          overrides: [
            { connectorSlug: 'connector-a', stepId: '_default' },
            { connectorSlug: 'connector-b', stepId: 'step-2' },
          ],
        },
      ],
    };

    expect(contentHash(first)).toBe(contentHash(second));
  });

  it('preserves connections order because it is pipeline semantics', () => {
    const first = { connections: [{ slug: 'first' }, { slug: 'second' }] };
    const second = { connections: [{ slug: 'second' }, { slug: 'first' }] };

    expect(contentHash(first)).not.toBe(contentHash(second));
  });

  it('excludes mutable metadata from the content hash', () => {
    const first = {
      profile: { name: 'ocr' },
      meta: { exportedAt: '2026-08-21T10:00:00.000Z', exportedBy: 'user-a' },
    };
    const second = {
      profile: { name: 'ocr' },
      meta: { exportedAt: '2026-08-21T11:00:00.000Z', exportedBy: 'user-b' },
    };

    expect(contentHash(first)).toBe(contentHash(second));
  });

  it('normalizes empty nullable release fields without touching opaque parameter strings', () => {
    const first = {
      profile: { note: '', callbackPayload: '' },
      endpoints: [{ endpointSlug: 'extract:invoice', connections: null, parameters: { custom: '' } }],
    };
    const second = {
      profile: { note: null, callbackPayload: null },
      endpoints: [{ endpointSlug: 'extract:invoice', connections: null, parameters: { custom: '' } }],
    };

    expect(contentHash(first)).toBe(contentHash(second));
  });
});
