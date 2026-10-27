import { buildConnectorBundle, sanitizeExtraHeaders, type ConnectorRow } from '@/lib/connectors/transfer/export';
import { parseConnectorBundle } from '@/lib/connectors/transfer/schema';

function row(overrides: Partial<ConnectorRow> = {}): ConnectorRow {
  return {
    name: 'AI Hub', slug: 'ext-aihub', description: 'desc',
    endpointUrl: 'https://dev.example/api', httpMethod: 'POST',
    authType: 'API_KEY_HEADER', authKeyHeader: 'x-api-key',
    authSecret: 'super-secret-raw-key', vaultSecretPath: null,
    promptFieldName: 'query', fileFieldName: 'files', fileUrlFieldName: null,
    defaultPrompt: '{"q":"{{query}}"}', staticFormFields: '[]',
    extraHeaders: JSON.stringify({ 'Content-Type': 'application/json', 'X-Connection-Mode': 'AIHUB', 'X-IBM-Client-Id': 'sensitive' }),
    responseContentPath: 'content', sessionIdResponsePath: null, sessionIdFieldName: null,
    timeoutSec: 300, state: 'ENABLED', ...overrides,
  };
}

describe('connector export', () => {
  it('never includes authSecret and passes strict re-validation', () => {
    const bundle = buildConnectorBundle([row()]);
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('super-secret-raw-key');
    expect(serialized).not.toContain('authSecret');
    // Round-trips through the strict parser (deny-list + schema).
    expect(() => parseConnectorBundle(bundle)).not.toThrow();
  });

  it('keeps its checksum after the browser download JSON round-trip', () => {
    const exported = buildConnectorBundle([row()]);
    const downloaded = JSON.parse(JSON.stringify(exported));

    expect(() => parseConnectorBundle(downloaded)).not.toThrow();
  });

  it('keeps config headers but strips credential header values', () => {
    const cleaned = sanitizeExtraHeaders(row().extraHeaders);
    const parsed = JSON.parse(cleaned!);
    expect(parsed['Content-Type']).toBe('application/json');
    expect(parsed['X-Connection-Mode']).toBe('AIHUB');
    // Credential header name is preserved (structure) but value blanked.
    expect(parsed['X-IBM-Client-Id']).toBe('');
  });

  it('flags needsInlineSecret only for raw-key connectors', () => {
    const raw = buildConnectorBundle([row()]).connectors[0];
    expect(raw.needsInlineSecret).toBe(true);
    const vault = buildConnectorBundle([row({ authSecret: '', vaultSecretPath: 'eda/rpa/dugate/aihub#key' })]).connectors[0];
    expect(vault.needsInlineSecret).toBe(false);
    expect(vault.vaultSecretPath).toBe('eda/rpa/dugate/aihub#key');
    const none = buildConnectorBundle([row({ authType: 'NONE', authSecret: '' })]).connectors[0];
    expect(none.needsInlineSecret).toBe(false);
  });

  it('exports multiple connectors sorted by slug with a stable checksum', () => {
    const a = buildConnectorBundle([row({ slug: 'ext-b' }), row({ slug: 'ext-a' })]);
    expect(a.connectors.map((c) => c.slug)).toEqual(['ext-a', 'ext-b']);
    const b = buildConnectorBundle([row({ slug: 'ext-a' }), row({ slug: 'ext-b' })]);
    expect(a.meta.contentHash).toBe(b.meta.contentHash);
  });

  it('drops an unparseable extraHeaders blob rather than exporting it', () => {
    expect(sanitizeExtraHeaders('not json')).toBeNull();
    expect(sanitizeExtraHeaders(null)).toBeNull();
  });
});
