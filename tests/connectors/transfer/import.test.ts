import {
  planConnectorImport,
  resolveConnectorWriteRow,
  type TargetConnectorRow,
  type ConnectorImportInput,
} from '@/lib/connectors/transfer/import';
import type { ConnectorBundleEntryV1 } from '@/lib/connectors/transfer/schema';

function entry(overrides: Partial<ConnectorBundleEntryV1> = {}): ConnectorBundleEntryV1 {
  return {
    name: 'AI Hub', slug: 'ext-aihub', description: null,
    endpointUrl: 'https://prod.example/api', httpMethod: 'POST',
    authType: 'API_KEY_HEADER', authKeyHeader: 'x-api-key', vaultSecretPath: null,
    promptFieldName: 'query', fileFieldName: 'files', fileUrlFieldName: null,
    defaultPrompt: '{}', staticFormFields: null, extraHeaders: null,
    responseContentPath: 'content', sessionIdResponsePath: null, sessionIdFieldName: null,
    timeoutSec: 300, state: 'ENABLED', needsInlineSecret: true, ...overrides,
  };
}

function target(overrides: Partial<TargetConnectorRow> = {}): TargetConnectorRow {
  return { slug: 'ext-aihub', endpointUrl: 'https://old.example/api', authType: 'API_KEY_HEADER', authSecret: 'existing-key', vaultSecretPath: null, ...overrides };
}

describe('connector import plan', () => {
  it('marks a new slug as CREATE and blocks until a secret is supplied', () => {
    const plan = planConnectorImport([entry()], []);
    expect(plan.items[0].op).toBe('CREATE');
    expect(plan.items[0].secretRequired).toBe(true);
    expect(plan.applicable).toBe(false);
  });

  it('is applicable once a raw key is supplied for a CREATE', () => {
    const inputs: ConnectorImportInput[] = [{ slug: 'ext-aihub', inlineSecret: 'new-prod-key' }];
    const plan = planConnectorImport([entry()], [], inputs);
    expect(plan.applicable).toBe(true);
    expect(plan.items[0].secretRequired).toBe(false);
  });

  it('reuses an existing target secret on UPDATE without requiring re-entry', () => {
    const plan = planConnectorImport([entry()], [target()]);
    expect(plan.items[0].op).toBe('UPDATE');
    expect(plan.items[0].secretRequired).toBe(false);
    expect(plan.applicable).toBe(true);
  });

  it('requires a new secret when the auth type changed vs the target', () => {
    const plan = planConnectorImport([entry({ authType: 'BEARER' })], [target()]);
    expect(plan.items[0].secretRequired).toBe(true);
  });

  it('treats a Vault path as satisfying the secret requirement', () => {
    const plan = planConnectorImport([entry({ vaultSecretPath: 'eda/rpa/dugate/aihub#key', needsInlineSecret: false })], []);
    expect(plan.applicable).toBe(true);
  });

  it('flags endpoint host change for operator review', () => {
    const plan = planConnectorImport([entry()], [target()], [{ slug: 'ext-aihub', inlineSecret: 'k' }]);
    expect(plan.items[0].endpointUrlChanged).toBe(true);
    expect(plan.items[0].hostChanged).toBe(true);
  });
});

describe('connector import row resolution', () => {
  it('stores a new inline secret and the operator endpoint URL', () => {
    const write = resolveConnectorWriteRow(entry(), { slug: 'ext-aihub', inlineSecret: 'new-key', endpointUrl: 'https://uat.example/api' }, undefined);
    expect(write.op).toBe('CREATE');
    expect(write.values.authSecret).toBe('new-key');
    expect(write.values.endpointUrl).toBe('https://uat.example/api');
  });

  it('clears authSecret when a Vault path is in effect', () => {
    const write = resolveConnectorWriteRow(entry(), { slug: 'ext-aihub', vaultSecretPath: 'eda/rpa/dugate/aihub#key' }, target());
    expect(write.values.authSecret).toBe('');
    expect(write.values.vaultSecretPath).toBe('eda/rpa/dugate/aihub#key');
  });

  it('preserves the existing target secret when none is supplied and auth type matches', () => {
    const write = resolveConnectorWriteRow(entry(), undefined, target());
    expect(write.op).toBe('UPDATE');
    expect(write.values.authSecret).toBe('existing-key');
  });

  it('keeps state from the bundle', () => {
    const write = resolveConnectorWriteRow(entry({ state: 'DISABLED' }), { slug: 'ext-aihub', inlineSecret: 'k' }, undefined);
    expect(write.values.state).toBe('DISABLED');
  });
});
