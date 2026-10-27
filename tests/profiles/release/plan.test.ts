import { buildBundle } from '@/lib/profiles/release/export';
import { planApply, type TargetState } from '@/lib/profiles/release/plan';

const bundle = buildBundle({
  profile: { name: 'p', displayName: null, note: null, status: 'active', role: 'STANDARD', workerGroup: 'wg', rateLimitPerMin: 1, spendingLimit: 0, fileAuthConfig: null, callbackAuthConfig: null, callbackPayload: null },
  endpoints: [{ endpointSlug: 'extract:invoice', enabled: true, parameters: null, connectionsOverride: JSON.stringify([{ slug: 'gemini' }]), jobPriority: 'MEDIUM', fileUrlAuthConfig: null, fileUrlDefaultChunks: null, allowedFileExtensions: null, referenceExtract: null }],
  overrides: [],
  connections: [{ id: 'x', slug: 'gemini' }],
  appVersion: '1',
  message: '',
});

const target = (): TargetState => ({
  profile: { name: 'p' },
  profilesByName: 1,
  endpoints: [{ endpointSlug: 'extract:invoice', enabled: true, parameters: null, connectionsOverride: [{ slug: 'gemini' }], jobPriority: 'MEDIUM', fileUrlDefaultChunks: null, allowedFileExtensions: null, referenceExtract: null, overrides: [], fileUrlAuth: null }],
  connectors: [{ slug: 'gemini', state: 'ENABLED' }],
  workerGroups: ['wg'],
  endpointSlugs: ['extract:invoice'],
  appVersion: '1',
  targetProfileName: 'p',
});

describe('planApply', () => {
  it('returns applicable NOOP plan when target matches', () => {
    const plan = planApply(bundle, target());
    expect(plan.applicable).toBe(true);
    expect(plan.endpoints[0].op).toBe('NOOP');
    expect(plan.breaking).toEqual([]);
  });

  it('blocks a missing connector', () => {
    const state = target();
    state.connectors = [];
    expect(planApply(bundle, state).applicable).toBe(false);
  });

  it('blocks missing endpoint registry and worker group', () => {
    const state = target();
    state.endpointSlugs = [];
    state.workerGroups = [];
    expect(planApply(bundle, state).preconditions.filter((item) => item.status === 'FAIL')).toHaveLength(2);
  });

  it('blocks duplicate natural names', () => {
    const state = target();
    state.profilesByName = 2;
    expect(planApply(bundle, state).applicable).toBe(false);
  });

  it('classifies endpoint disable and pipeline changes as breaking', () => {
    const changedBundle: any = JSON.parse(JSON.stringify(bundle));
    changedBundle.endpoints[0].enabled = false;
    changedBundle.endpoints[0].connections = [{ slug: 'other' }];
    const plan = planApply(changedBundle, target());
    expect(plan.breaking.map((item) => item.kind)).toEqual(expect.arrayContaining(['ENDPOINT_DISABLED', 'PIPELINE_CHANGED']));
  });

  it('creates endpoints absent on target', () => {
    const state = target();
    state.endpoints = [];
    expect(planApply(bundle, state).endpoints[0].op).toBe('CREATE');
  });

  it('warns for Profile inline secrets and queued work', () => {
    const changedBundle: any = JSON.parse(JSON.stringify(bundle));
    changedBundle.profile.secretRefs.fileAuth.needsInlineSecret = true;
    const state = target();
    state.pendingRunningJobs = 2;
    expect(planApply(changedBundle, state).warnings.map((item) => item.code)).toEqual(expect.arrayContaining(['SECRET_REQUIRED', 'QUEUE_NOT_EMPTY']));
  });

  // The per-endpoint file-auth override was removed, so a legacy bundle that still asks
  // for an endpoint secret must NOT raise SECRET_REQUIRED: there is nothing to apply it to.
  it('ignores a legacy endpoint-level secret request', () => {
    const changedBundle: any = JSON.parse(JSON.stringify(bundle));
    changedBundle.endpoints[0].secretRefs = { fileUrlAuth: { present: true, type: 'bearer', needsInlineSecret: true } };
    expect(planApply(changedBundle, target()).warnings.map((item) => item.code)).not.toContain('SECRET_REQUIRED');
  });

  it('hashes plans deterministically and target mutations change target hash', () => {
    const one = planApply(bundle, target());
    const two = planApply(bundle, target());
    expect(one.planHash).toBe(two.planHash);
    const state = target();
    state.profile = { name: 'changed' };
    expect(planApply(bundle, state).targetHash).not.toBe(one.targetHash);
  });

  it('binds a plan to the selected target name even when the target is missing', () => {
    const firstMissingTarget = target();
    firstMissingTarget.profile = undefined;
    firstMissingTarget.endpoints = [];
    firstMissingTarget.profilesByName = 0;
    firstMissingTarget.targetProfileName = 'new-one';
    const secondMissingTarget = { ...firstMissingTarget, targetProfileName: 'new-two' };
    const firstPlan = planApply(bundle, firstMissingTarget);
    const secondPlan = planApply(bundle, secondMissingTarget);
    expect(firstPlan.targetHash).toBe(secondPlan.targetHash);
    expect(firstPlan.planHash).not.toBe(secondPlan.planHash);
  });
});

test('does not classify safe endpoint creation as breaking', () => {
  const state = target();
  state.endpoints = [];
  expect(planApply(bundle, state).breaking).toEqual([]);
});

test('records no queue warning for an empty queue', () => {
  const state = target();
  state.pendingRunningJobs = 0;
  expect(planApply(bundle, state).warnings).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'QUEUE_NOT_EMPTY' })]));
});

test('includes a failed precondition detail for a missing connector slug', () => {
  const state = target();
  state.connectors = [];
  expect(planApply(bundle, state).preconditions).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'connectorSlugs', detail: 'gemini' })]));
});
