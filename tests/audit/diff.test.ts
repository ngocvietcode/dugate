import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';

describe('buildChanges', () => {
  it('keeps short operational values as a before/after transition', () => {
    expect(buildChanges(
      { displayName: 'Profile A', rateLimitPerMin: 60 },
      { displayName: 'Profile B', rateLimitPerMin: 120 },
      AUDIT_POLICIES.PROFILE,
    )).toEqual({
      displayName: { from: 'Profile A', to: 'Profile B' },
      rateLimitPerMin: { from: 60, to: 120 },
    });
  });

  it('reports credentials and Vault references as configured state only', () => {
    const secret = 'never-write-this-value';
    const vaultPath = 'banking/dugate/connector-a#api-key';
    const headers = JSON.stringify({ Authorization: `Bearer ${secret}` });
    const changes = buildChanges(
      { authSecret: secret, vaultSecretPath: vaultPath, extraHeaders: headers },
      { authSecret: 'replacement-secret', vaultSecretPath: 'other/path#key', extraHeaders: '{"X-Api-Key":"new-secret"}' },
      AUDIT_POLICIES.CONNECTOR,
    );
    const serialized = JSON.stringify(changes);

    expect(changes).toEqual({
      authSecret: { from: 'configured', to: 'configured' },
      vaultSecretPath: { from: 'configured', to: 'configured' },
      extraHeaders: { from: 'configured', to: 'configured' },
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(vaultPath);
    expect(serialized).not.toContain('new-secret');
  });

  it('summarizes prompts without persisting their content', () => {
    const before = 'Prompt confidential one';
    const after = 'Prompt confidential two with much longer instruction';
    const changes = buildChanges({ defaultPrompt: before }, { defaultPrompt: after }, AUDIT_POLICIES.CONNECTOR);
    const serialized = JSON.stringify(changes);

    expect(changes.defaultPrompt.from).toMatchObject({ kind: 'summary', length: before.length });
    expect(changes.defaultPrompt.to).toMatchObject({ kind: 'summary', length: after.length });
    expect(serialized).not.toContain(before);
    expect(serialized).not.toContain(after);
  });

  it('fails closed: fields not in the policy never enter audit changes', () => {
    expect(buildChanges(
      { updatedAt: 'old', unreviewedSecret: 'old-value' },
      { updatedAt: 'new', unreviewedSecret: 'new-value' },
      AUDIT_POLICIES.CONNECTOR,
    )).toEqual({});
  });

  it('handles null and undefined values consistently', () => {
    expect(buildChanges({ note: null }, { note: undefined }, AUDIT_POLICIES.PROFILE)).toEqual({});
    expect(buildChanges({ vaultSecretPath: null }, { vaultSecretPath: 'secret/path' }, AUDIT_POLICIES.CONNECTOR))
      .toEqual({ vaultSecretPath: { from: null, to: 'configured' } });
  });
});

describe('buildChanges — additional entity types', () => {
  it('ENDPOINT: parameters is PRESENCE, enabled is VALUE, retired fileUrlAuthConfig is dropped', () => {
    const changes = buildChanges(
      { enabled: false, parameters: '{"model":{"value":"gpt-4o"}}', fileUrlAuthConfig: 'encrypted-blob' },
      { enabled: true, parameters: '{"model":{"value":"gemini"}}', fileUrlAuthConfig: 'new-encrypted-blob' },
      AUDIT_POLICIES.ENDPOINT,
    );
    expect(changes.enabled).toEqual({ from: false, to: true });
    expect(changes.parameters).toEqual({ from: 'configured', to: 'configured' });
    // The per-endpoint file-auth override was removed from the policy. buildChanges is an
    // allow-list walk over the policy, so the retired field is omitted entirely — which is
    // stricter than the previous presence-only representation.
    expect(changes.fileUrlAuthConfig).toBeUndefined();
    expect(JSON.stringify(changes)).not.toContain('gpt-4o');
    expect(JSON.stringify(changes)).not.toContain('encrypted-blob');
  });

  it('OVERRIDE: promptOverride is SUMMARY, modelOverride is VALUE', () => {
    const changes = buildChanges(
      { promptOverride: 'Extract all tables', modelOverride: 'gpt-4o' },
      { promptOverride: 'Extract all tables and charts from the document', modelOverride: 'gemini-2.5-pro' },
      AUDIT_POLICIES.OVERRIDE,
    );
    expect(changes.modelOverride).toEqual({ from: 'gpt-4o', to: 'gemini-2.5-pro' });
    expect(changes.promptOverride?.from).toMatchObject({ kind: 'summary' });
    expect(changes.promptOverride?.to).toMatchObject({ kind: 'summary' });
    expect(JSON.stringify(changes)).not.toContain('Extract all tables');
  });

  it('ASSIGNMENT: apiKeyIds is VALUE (array diff)', () => {
    const changes = buildChanges(
      { apiKeyIds: ['id-a', 'id-b'] },
      { apiKeyIds: ['id-a', 'id-c'] },
      AUDIT_POLICIES.ASSIGNMENT,
    );
    expect(changes.apiKeyIds).toEqual({ from: ['id-a', 'id-b'], to: ['id-a', 'id-c'] });
  });

  it('USER: username, email and role are VALUE, and no credential field is recognised', () => {
    const changes = buildChanges(
      { username: 'ops1', email: 'ops1@example.com', role: 'OPS' },
      { username: 'ops1', email: 'ops1@example.com', role: 'ADMIN' },
      AUDIT_POLICIES.USER,
    );
    expect(changes.role).toEqual({ from: 'OPS', to: 'ADMIN' });
    expect(changes.username).toBeUndefined(); // unchanged
    expect(changes.email).toBeUndefined(); // unchanged
  });

  it('USER: an email change is recorded, since it decides SSO identity matching', () => {
    const changes = buildChanges(
      { username: 'ops1', email: null, role: 'OPS' },
      { username: 'ops1', email: 'ops1@example.com', role: 'OPS' },
      AUDIT_POLICIES.USER,
    );
    expect(changes.email).toEqual({ from: null, to: 'ops1@example.com' });
  });

  it('USER: sign-in is delegated to the IDP, so a stray credential is never logged', () => {
    // Defence in depth: the routes no longer send a password, and an unpoliced
    // field must be dropped rather than written through to the audit trail.
    const changes = buildChanges(
      { username: 'ops1', role: 'OPS', password: 'hash-old' },
      { username: 'ops1', role: 'OPS', password: 'hash-new' },
      AUDIT_POLICIES.USER,
    );
    expect(changes.password).toBeUndefined();
    expect(JSON.stringify(changes)).not.toContain('hash-old');
    expect(JSON.stringify(changes)).not.toContain('hash-new');
  });
});
