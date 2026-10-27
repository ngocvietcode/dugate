import { contentHash } from '@/lib/profiles/release/canonical';
import { assertNoForbiddenKeys, parseProfileReleaseBundle } from '@/lib/profiles/release/schema';

function buildBundle() {
  const bundle = {
    bundleVersion: 1,
    kind: 'dugate.profile',
    profile: {
      name: 'ocr-bctc-jp',
      displayName: 'OCR BCTC Nhật',
      note: null,
      status: 'active',
      role: 'STANDARD',
      callbackPayload: null,
      fileAuth: { type: 'bearer', token_secret_ref: 'dugate/uat#file-token' },
      callbackAuth: null,
      secretRefs: {
        fileAuth: { present: true, type: 'bearer', needsInlineSecret: false },
        callbackAuth: { present: false, type: 'none', needsInlineSecret: false },
      },
    },
    runtimeHints: { workerGroup: 'ocr', rateLimitPerMin: 60, spendingLimit: 0 },
    requires: {
      apiSurface: 'v2',
      minAppVersion: '4.12.0',
      endpointSlugs: ['extract:invoice'],
      connectorSlugs: ['gemini'],
      workerGroups: ['ocr'],
    },
    endpoints: [{
      endpointSlug: 'extract:invoice',
      enabled: true,
      parameters: { custom: { value: 'opaque' } },
      connections: [{ slug: 'gemini', stepId: null, captureSession: null, injectSession: null }],
      jobPriority: 'MEDIUM',
      fileUrlDefaultChunks: null,
      allowedFileExtensions: null,
      referenceExtract: null,
      overrides: [{
        connectorSlug: 'gemini',
        stepId: '_default',
        promptOverride: null,
        modelOverride: null,
        reasoningEffortOverride: null,
      }],
      fileUrlAuth: null,
      secretRefs: { fileUrlAuth: { present: false, type: 'none', needsInlineSecret: false } },
    }],
    meta: {
      sourceEnv: 'UAT',
      sourceRevision: 7,
      exportedAt: '2026-08-21T10:00:00.000Z',
      exportedBy: 'admin',
      appVersion: '4.12.0',
      message: 'release',
      contentHash: '',
    },
  };
  bundle.meta.contentHash = contentHash(bundle);
  return bundle;
}

describe('Profile Release bundle schema', () => {
  it('accepts a strict valid v1 bundle with portable secret references', () => {
    expect(parseProfileReleaseBundle(buildBundle()).profile.name).toBe('ocr-bctc-jp');
  });

  it('accepts a semantic version and remains compatible with legacy bundles without one', () => {
    const versioned = buildBundle() as any;
    versioned.meta.version = '1.2.3';
    versioned.meta.contentHash = contentHash(versioned);
    expect(parseProfileReleaseBundle(versioned).meta.version).toBe('1.2.3');
    expect(parseProfileReleaseBundle(buildBundle()).meta.version).toBeUndefined();
  });

  it('rejects an invalid semantic version when present', () => {
    const invalid = buildBundle() as any;
    invalid.meta.version = '1.2';
    invalid.meta.contentHash = contentHash(invalid);
    expect(() => parseProfileReleaseBundle(invalid)).toThrow('meta.version');
  });

  it('rejects a modified bundle whose supplied checksum was not updated', () => {
    const bundle = buildBundle();
    bundle.profile.displayName = 'tampered';

    expect(() => parseProfileReleaseBundle(bundle)).toThrow('Bundle checksum mismatch');
  });

  it('reports the precise path for a required endpoint identity', () => {
    const bundle = buildBundle() as any;
    delete bundle.endpoints[0].endpointSlug;
    bundle.meta.contentHash = contentHash(bundle);

    expect(() => parseProfileReleaseBundle(bundle)).toThrow('endpoints.0.endpointSlug');
  });

  it.each([
    ['keyHash', { profile: { keyHash: 'forbidden' } }],
    ['authSecret', { profile: { authSecret: 'forbidden' } }],
    ['connectionId', { endpoints: [{ connectionId: 'forbidden' }] }],
    ['token', { profile: { fileAuth: { token: 'forbidden' } } }],
    ['client_secret', { profile: { fileAuth: { client_secret: 'forbidden' } } }],
    ['header_value', { profile: { fileAuth: { header_value: 'forbidden' } } }],
    ['query_value', { profile: { fileAuth: { query_value: 'forbidden' } } }],
    ['gateway_headers[].value', { profile: { fileAuth: { gateway_headers: [{ name: 'X-Key', value: 'forbidden' }] } } }],
  ])('rejects forbidden %s at any depth', (key, value) => {
    expect(() => assertNoForbiddenKeys(value)).toThrow(`bundle contains forbidden field '${key}'`);
  });

  it('enforces the existing 200,000-character prompt limit', () => {
    const bundle = buildBundle() as any;
    bundle.endpoints[0].overrides[0].promptOverride = 'x'.repeat(200_001);
    bundle.meta.contentHash = contentHash(bundle);

    expect(() => parseProfileReleaseBundle(bundle)).toThrow('endpoints.0.overrides.0.promptOverride');
  });
});
