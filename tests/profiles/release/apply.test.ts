jest.mock('@/lib/crypto', () => ({ encrypt: (value: string) => `enc:${value}` }));
jest.mock('@/lib/file-url-downloader', () => ({ parseFileUrlAuthConfig: (value: any) => value }));
jest.mock('@/lib/audit/write', () => ({ writeAudit: jest.fn().mockResolvedValue(undefined) }));

import { buildBundle } from '@/lib/profiles/release/export';
import { planApply } from '@/lib/profiles/release/plan';
import { applyBundle, type TransactionLike } from '@/lib/profiles/release/apply';
import { writeAudit } from '@/lib/audit/write';

const bundle = buildBundle({
  profile: { name: 'p', displayName: null, note: null, status: 'active', role: 'STANDARD', workerGroup: 'wg', rateLimitPerMin: 5, spendingLimit: 1, fileAuthConfig: null, callbackAuthConfig: null, callbackPayload: null },
  endpoints: [{ endpointSlug: 'extract:invoice', enabled: true, parameters: null, connectionsOverride: null, jobPriority: 'MEDIUM', fileUrlAuthConfig: null, fileUrlDefaultChunks: null, allowedFileExtensions: null, referenceExtract: null }],
  overrides: [],
  connections: [],
  appVersion: '1',
  message: '',
});
const plan = planApply(bundle, {
  profile: { name: 'p' },
  profilesByName: 1,
  endpoints: [{ endpointSlug: 'extract:invoice', enabled: true, parameters: null, connectionsOverride: null, jobPriority: 'MEDIUM', fileUrlDefaultChunks: null, allowedFileExtensions: null, referenceExtract: null, overrides: [], fileUrlAuth: null }],
  connectors: [],
  workerGroups: ['wg'],
  endpointSlugs: ['extract:invoice'],
  appVersion: '1',
  targetProfileName: 'p',
});
const base = () => ({ bundle, plan, expectedPlanHash: plan.planHash, expectedTargetHash: plan.targetHash, targetProfileName: 'p', actorUserId: 'u', actorRole: 'ADMIN' });

function tx(profile: any = { id: 'p1' }) {
  const update = jest.fn();
  const insert = jest.fn();
  return { profile, endpoints: [], revision: 2, _rawKey: profile === null ? 'dg_test-created-key' : undefined, update, insert } as any as TransactionLike & { update: jest.Mock; insert: jest.Mock };
}

describe('applyBundle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('applies safely and records a successful revision after the transaction writes', async () => {
    const transaction = tx();
    const result = await applyBundle(base(), transaction);
    expect(result).toMatchObject({ success: true, revision: 3 });
    expect(result).not.toHaveProperty('verifyHash');
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SUCCESS', toHash: bundle.meta.contentHash }));
  });

  it('deletes every persisted override when the bundle intentionally returns an endpoint to defaults', async () => {
    const transaction = tx() as unknown as TransactionLike & { deleteOverridesNotIn: jest.Mock };
    transaction.deleteOverridesNotIn = jest.fn();

    await applyBundle(base(), transaction);

    expect(transaction.deleteOverridesNotIn).toHaveBeenCalledWith('extract:invoice', []);
  });

  it('keeps bundle overrides and asks the adapter to delete only other persisted overrides', async () => {
    const bundleWithOverride: any = JSON.parse(JSON.stringify(bundle));
    bundleWithOverride.endpoints[0].overrides = [{
      connectorSlug: 'connector-a',
      stepId: '_default',
      promptOverride: 'custom prompt',
      modelOverride: null,
      reasoningEffortOverride: null,
    }];
    const transaction = tx() as unknown as TransactionLike & { deleteOverridesNotIn: jest.Mock };
    transaction.deleteOverridesNotIn = jest.fn();

    await applyBundle({ ...base(), bundle: bundleWithOverride }, transaction);

    expect(transaction.deleteOverridesNotIn).toHaveBeenCalledWith('extract:invoice', ['connector-a\0_default']);
  });

  it('rejects stale plan and target locks', async () => {
    expect((await applyBundle({ ...base(), expectedPlanHash: 'x' }, tx())).status).toBe(409);
    expect((await applyBundle({ ...base(), expectedTargetHash: 'x' }, tx())).status).toBe(409);
  });

  it('rejects an apply request whose target differs from the reviewed plan', async () => {
    expect((await applyBundle({ ...base(), targetProfileName: 'other' }, tx())).status).toBe(409);
  });

  it('requires create option for missing Profile and preserves the supplied lowercase target name', async () => {
    expect((await applyBundle(base(), tx(null))).success).toBe(false);
    const createPlan = planApply(bundle, {
      profile: undefined,
      profilesByName: 0,
      endpoints: [],
      connectors: [],
      workerGroups: ['wg'],
      endpointSlugs: ['extract:invoice'],
      appVersion: '1',
      targetProfileName: 'test-lower-case',
    });
    const transaction = tx(null);
    const result = await applyBundle({
      ...base(),
      targetProfileName: 'test-lower-case',
      createMissingProfile: true,
      plan: createPlan,
      expectedPlanHash: createPlan.planHash,
      expectedTargetHash: createPlan.targetHash,
    }, transaction);
    expect(result.rawKey).toMatch(/^dg_/);
    expect(transaction.insert).toHaveBeenCalledWith('ApiKey', expect.objectContaining({ name: 'test-lower-case' }));
  });

  it('persists the imported semantic version with the release record', async () => {
    const versionedBundle: any = JSON.parse(JSON.stringify(bundle));
    versionedBundle.meta.version = '1.2.3';
    const transaction = tx();

    await applyBundle({ ...base(), bundle: versionedBundle }, transaction);

    expect(transaction.insert).toHaveBeenCalledWith('ProfileRelease', expect.objectContaining({ version: '1.2.3' }));
  });

  it('never writes raw profile secret fields even if direct bundle is tampered', async () => {
    const tamperedBundle: any = JSON.parse(JSON.stringify(bundle));
    tamperedBundle.profile.keyHash = 'bad';
    tamperedBundle.profile.prefix = 'bad';
    tamperedBundle.profile.totalUsed = 99;
    const transaction = tx();
    await applyBundle({ ...base(), bundle: tamperedBundle }, transaction);
    for (const [, payload] of transaction.update.mock.calls) {
      expect(payload).not.toEqual(expect.objectContaining({ keyHash: expect.anything(), prefix: expect.anything(), totalUsed: expect.anything() }));
    }
  });

  it('encrypts inline profile auth', async () => {
    const securedBundle: any = JSON.parse(JSON.stringify(bundle));
    securedBundle.profile.fileAuth = { type: 'bearer' };
    securedBundle.profile.secretRefs.fileAuth.needsInlineSecret = true;
    const transaction = tx();
    await applyBundle({ ...base(), bundle: securedBundle, secrets: { fileAuth: 'secret' } }, transaction);
    expect(transaction.update.mock.calls[0][1].fileAuthConfig).toContain('enc:');
  });

  it('does not apply runtime hints by default', async () => {
    const transaction = tx();
    await applyBundle(base(), transaction);
    expect(transaction.update.mock.calls[0][1]).not.toHaveProperty('workerGroup');
  });

  it('audits transaction errors without throwing', async () => {
    const transaction = tx();
    (transaction.update as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const result = await applyBundle(base(), transaction);
    expect(result.success).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'FAIL' }));
  });
});

test('applies runtime hints only when explicitly enabled', async () => {
  const transaction = tx();
  await applyBundle({ ...base(), applyRuntimeHints: true }, transaction);
  expect(transaction.update.mock.calls[0][1]).toMatchObject({ workerGroup: 'wg', rateLimitPerMin: 5, spendingLimit: 1 });
});

test('prunes only when explicitly enabled', async () => {
  const transaction = tx();
  transaction.delete = jest.fn();
  await applyBundle({ ...base(), pruneUnknownEndpoints: true }, transaction);
  expect(transaction.delete).toHaveBeenCalledWith('ProfileEndpoint', expect.any(Object));
});

test('encrypts callback auth structure without requiring an inline secret for Vault refs', async () => {
  const securedBundle: any = JSON.parse(JSON.stringify(bundle));
  securedBundle.profile.callbackAuth = { type: 'bearer', token_secret_ref: 'vault#cb' };
  const transaction = tx();
  await applyBundle({ ...base(), bundle: securedBundle }, transaction);
  expect(transaction.update.mock.calls[0][1].callbackAuthConfig).toContain('enc:');
});
