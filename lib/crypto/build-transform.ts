// lib/crypto/build-transform.ts
//
// Builds a `transformWebhookPayload` function from pipelineVars (merged request +
// Profile config). This is the single wiring point the engine uses to auto-enable
// encryption for any Profile that turns it on via the UI — no per-workflow code.
//
// Config params (see registry.ts):
//   encryption_enabled       boolean  — master switch (Admin-locked)
//   encryption_mode          'full'|'selective'  (default 'selective')
//   encryption_fields        CSV dot-paths (selective; default 'extracted_data')
//   encryption_metadata_target 'body'|'headers'|'both' (default 'both')
//   encryption_public_key    PEM (request or Profile)
//   partner_public_key       PEM (PAM legacy name; also honored)
//   encryption_vault_path    Vault secret path

import { resolvePublicKey, type VaultKeyFetcher } from './key-resolver';
import { encryptForWire, type EncryptMode, type EncryptStyle } from './webhook-encryptor';

export interface BuildTransformVars {
  encryption_enabled?: unknown;
  encryption_mode?: unknown;
  encryption_fields?: unknown;
  encryption_metadata_target?: unknown;
  encryption_public_key?: unknown;
  partner_public_key?: unknown;
  encryption_vault_path?: unknown;
}

type Transform = (payload: object) => Promise<{ body: string; headers: Record<string, string> }>;

function parseFields(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Resolve the encryption mode. Defaults to 'selective' (matches the registry
 * schema default) when unset; only an explicit 'full' switches modes.
 */
function parseMode(raw: unknown): EncryptMode {
  return raw === 'full' ? 'full' : 'selective';
}

function parseMetadataTarget(raw: unknown): 'body' | 'headers' | 'both' {
  return raw === 'body' || raw === 'headers' ? raw : 'both';
}

/**
 * Build a spec-style encryption transform when the Profile enabled it.
 * Returns undefined when disabled OR no key is configured (caller falls back to
 * plain JSON for disabled; a missing key while enabled is surfaced as a thrown
 * error inside the transform so the failure is visible on the webhook path).
 *
 * @param vars         pipelineVars
 * @param vaultFetcher optional Vault fetcher for the key waterfall
 */
export function buildEncryptTransform(
  vars: BuildTransformVars,
  vaultFetcher?: VaultKeyFetcher,
  options: { strictPaths?: boolean } = {},
): Transform | undefined {
  if (vars.encryption_enabled !== true && vars.encryption_enabled !== 'true') return undefined;

  const mode = parseMode(vars.encryption_mode);
  const fields = parseFields(vars.encryption_fields);
  const metadataTarget = parseMetadataTarget(vars.encryption_metadata_target);
  const style: EncryptStyle = 'spec';

  // Selective mode requires an explicit field list — no implicit default.
  if (mode === 'selective' && fields.length === 0) {
    throw new Error(
      'Encryption enabled with mode "selective" but encryption_fields is empty — ' +
        'configure the dot-path fields to encrypt on the Profile.',
    );
  }

  return async (payload: object) => {
    const publicKeyPem = await resolvePublicKey(vars, vaultFetcher);
    if (!publicKeyPem) {
      throw new Error(
        'Encryption enabled but no public key configured — set encryption_public_key, ' +
          'partner_public_key, or encryption_vault_path.',
      );
    }
    return encryptForWire(payload as Record<string, unknown>, {
      style,
      mode,
      fields,
      publicKeyPem,
      metadataTarget,
      strictPaths: options.strictPaths,
    });
  };
}
