import { buildConnectorBundle, type ConnectorRow } from '@/lib/connectors/transfer/export';
import { parseConnectorBundle, isSecretHeaderName } from '@/lib/connectors/transfer/schema';

function baseRow(): ConnectorRow {
  return {
    name: 'AI Hub', slug: 'ext-aihub', description: null,
    endpointUrl: 'https://dev.example/api', httpMethod: 'POST',
    authType: 'API_KEY_HEADER', authKeyHeader: 'x-api-key',
    authSecret: 'k', vaultSecretPath: null,
    promptFieldName: 'query', fileFieldName: 'files', fileUrlFieldName: null,
    defaultPrompt: '{}', staticFormFields: null, extraHeaders: null,
    responseContentPath: 'content', sessionIdResponsePath: null, sessionIdFieldName: null,
    timeoutSec: 300, state: 'ENABLED',
  };
}

describe('connector bundle schema', () => {
  it('accepts a freshly built valid bundle', () => {
    expect(() => parseConnectorBundle(buildConnectorBundle([baseRow()]))).not.toThrow();
  });

  it('accepts edited non-secret settings without verifying the checksum', () => {
    const bundle = buildConnectorBundle([baseRow()]);
    bundle.connectors[0].endpointUrl = 'http://127.0.0.1:3099/ext/ext-comparator';
    bundle.connectors[0].name = 'Edited After Export';
    expect(parseConnectorBundle(bundle).connectors[0].endpointUrl)
      .toBe('http://127.0.0.1:3099/ext/ext-comparator');
  });

  it('accepts a bundle without informational contentHash', () => {
    const bundle = buildConnectorBundle([baseRow()]);
    delete (bundle.meta as { contentHash?: string }).contentHash;
    expect(() => parseConnectorBundle(bundle)).not.toThrow();
  });

  it('rejects a bundle carrying a forbidden authSecret field', () => {
    const bundle = buildConnectorBundle([baseRow()]) as unknown as Record<string, unknown>;
    (bundle.connectors as Array<Record<string, unknown>>)[0].authSecret = 'leaked';
    expect(() => parseConnectorBundle(bundle)).toThrow(/forbidden field 'authSecret'/);
  });

  it('rejects an unknown top-level key (strict schema)', () => {
    const bundle = buildConnectorBundle([baseRow()]) as unknown as Record<string, unknown>;
    bundle.extra = true;
    expect(() => parseConnectorBundle(bundle)).toThrow(/Invalid connector bundle|checksum/i);
  });

  it('rejects a bad slug format', () => {
    const bundle = buildConnectorBundle([baseRow()]);
    bundle.connectors[0].slug = 'Bad Slug';
    expect(() => parseConnectorBundle(bundle)).toThrow();
  });

  it('classifies header names correctly', () => {
    expect(isSecretHeaderName('Authorization')).toBe(true);
    expect(isSecretHeaderName('X-IBM-Client-Secret')).toBe(true);
    expect(isSecretHeaderName('X-IBM-Client-Id')).toBe(true);
    expect(isSecretHeaderName('x-api-key')).toBe(true);
    expect(isSecretHeaderName('Content-Type')).toBe(false);
    expect(isSecretHeaderName('X-Connection-Mode')).toBe(false);
  });
});
