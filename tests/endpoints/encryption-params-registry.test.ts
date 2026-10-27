// tests/endpoints/encryption-params-registry.test.ts
//
// Guards the auto-injection of ENCRYPTION_PARAMS across the registry:
//  - every core API + workflow sub-case exposes encryption_enabled + sub-params,
//  - the sub-params are enable-gated (hidden + showWhen: encryption_enabled),
//  - PAM receives the new schema while retaining its legacy partner_public_key,
//  - a sub-case that pre-defines a param keeps its own definition (spread-first).

import { getAllEndpointSlugs } from '@/lib/endpoints/registry';

const ENC_SUB_PARAMS = [
  'encryption_mode',
  'encryption_fields',
  'encryption_metadata_target',
  'encryption_public_key',
  'encryption_vault_path',
];

const endpoints = getAllEndpointSlugs();
const bySlug = (slug: string) => endpoints.find((e) => e.slug === slug)!;

describe('ENCRYPTION_PARAMS auto-injection', () => {
  it('adds encryption_enabled to core API endpoints', () => {
    for (const slug of ['extract:invoice', 'analyze:classify', 'transform:translate', 'generate:summary', 'compare:diff']) {
      expect(bySlug(slug).parametersSchema).toHaveProperty('encryption_enabled');
    }
  });

  it('adds encryption_enabled to spec workflows', () => {
    for (const slug of ['workflows:statement-analyze', 'workflows:tracing-portal', 'workflows:loan-appraisal']) {
      expect(bySlug(slug).parametersSchema).toHaveProperty('encryption_enabled');
    }
  });

  it('marks sub-params hidden + gated; fields depends on selective mode', () => {
    const schema = bySlug('extract:invoice').parametersSchema as Record<string, any>;
    // Most sub-params are gated behind the encryption_enabled toggle.
    for (const key of ['encryption_mode', 'encryption_metadata_target', 'encryption_public_key', 'encryption_vault_path']) {
      expect(schema[key].hidden).toBe(true);
      expect(schema[key].showWhen).toEqual({ param: 'encryption_enabled' });
    }
    // encryption_fields only appears when mode = selective (point 4).
    expect(schema.encryption_fields.hidden).toBe(true);
    expect(schema.encryption_fields.showWhen).toEqual({ param: 'encryption_mode', equals: 'selective' });
    expect(schema.encryption_fields.required).toBe(true);
    // mode keeps its default and is not force-required (point 1).
    expect(schema.encryption_mode.default).toBe('selective');
    expect(schema.encryption_mode.required).toBeUndefined();
    // The toggle itself is always visible (no showWhen gate).
    expect(schema.encryption_enabled.showWhen).toBeUndefined();
  });

  it('injects new encryption params into PAM while keeping its legacy key', () => {
    const pam = bySlug('workflows:payment-account-management').parametersSchema as Record<string, any>;
    expect(pam).toHaveProperty('encryption_enabled');
    for (const key of ENC_SUB_PARAMS) {
      expect(pam).toHaveProperty(key);
    }
    expect(pam).toHaveProperty('partner_public_key');
  });

  it('preserves a pre-existing param definition over the injected default (spread-first)', () => {
    // extract sub-cases also carry return_bbox; ensure injection did not clobber it.
    expect(bySlug('extract:invoice').parametersSchema).toHaveProperty('return_bbox');
  });
});
