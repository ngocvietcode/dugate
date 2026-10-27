// lib/crypto/operation-response-encrypt.ts
//
// Applies spec-format response encryption to a formatted operation response,
// driven by the encryption_* config stored in the operation's pipelineJson.
//
// Used by the poll (GET /operations/{id}) and download endpoints so that a
// Profile which enabled encryption gets encrypted poll/download output too —
// not just the webhook. When encryption is disabled or no key is configured,
// the response is returned unchanged (returns { body: original, headers: {} }).
//
// PAM is unaffected: PAM encrypts only on the webhook path via its own transform.
// PAM does not set encryption_enabled, so poll/download stay plaintext for PAM.

import { encryptForWire, type EncryptMode } from './webhook-encryptor';
import { resolvePublicKey, type VaultKeyFetcher } from './key-resolver';

export interface OperationLike {
  pipelineJson: string | null;
  /** Present on the poll path so encryption only runs once a result exists. */
  done?: boolean | null;
  state?: string | null;
}

interface EncryptionVars {
  encryption_enabled?: unknown;
  encryption_mode?: unknown;
  encryption_fields?: unknown;
  encryption_metadata_target?: unknown;
  encryption_public_key?: unknown;
  partner_public_key?: unknown;
  encryption_vault_path?: unknown;
}

/** Extract the merged pipeline variables persisted for the operation. */
function readPipelineVars(op: OperationLike): EncryptionVars {
  if (!op.pipelineJson) return {};
  try {
    const pipeline = JSON.parse(op.pipelineJson);
    const vars = pipeline?.[0]?.variables;
    return vars && typeof vars === 'object' ? (vars as EncryptionVars) : {};
  } catch {
    return {};
  }
}

function isEnabled(v: unknown): boolean {
  return v === true || v === 'true';
}

function parseFields(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

export interface EncryptedResponse {
  /** The response object to serialize (encrypted or original). */
  body: Record<string, unknown>;
  /** Encryption metadata headers (empty when not encrypted). */
  headers: Record<string, string>;
  /** True when encryption was actually applied. */
  encrypted: boolean;
}

/**
 * Encrypt a formatted operation response according to the operation's stored
 * encryption config. Returns the original body unchanged when disabled/no key.
 *
 * @param formatted   The object from formatOperationResponse(op).
 * @param op          The operation row (for pipelineJson).
 * @param vaultFetcher optional Vault fetcher for the key waterfall.
 */
export async function encryptOperationResponse(
  formatted: Record<string, unknown>,
  op: OperationLike,
  vaultFetcher?: VaultKeyFetcher,
  /** Force a specific mode regardless of Profile config (e.g. download always 'full'). */
  forceMode?: EncryptMode,
  /** Selective mode: reject configured paths missing from this payload's structure. */
  options: { strictPaths?: boolean } = {},
): Promise<EncryptedResponse> {
  const vars = readPipelineVars(op);
  if (!isEnabled(vars.encryption_enabled)) {
    return { body: formatted, headers: {}, encrypted: false };
  }

  // Only encrypt once there is a business result to protect. A poll performed
  // while the operation is still RUNNING (done=false) returns just name/done/
  // metadata — there is no `result` yet, so selective field-paths would match
  // nothing and fail closed. Progress/status responses carry no sensitive
  // business data, so returning them as plaintext is safe and correct. The
  // download path passes forceMode (it is only reached after SUCCEEDED), so it
  // bypasses this guard. `done`/`state` may be absent on non-poll callers; when
  // absent we do not gate (backward compatible).
  if (forceMode === undefined && op.done !== undefined) {
    const hasResult = op.done === true && op.state === 'SUCCEEDED';
    if (!hasResult) {
      return { body: formatted, headers: {}, encrypted: false };
    }
  }

  const publicKeyPem = await resolvePublicKey(vars, vaultFetcher);
  if (!publicKeyPem) {
    // Enabled but misconfigured — do NOT leak plaintext. Surface an error.
    throw new Error(
      'Encryption enabled but no public key configured — set encryption_public_key, ' +
        'partner_public_key, or encryption_vault_path on the Profile.',
    );
  }

  // Mode: forceMode wins (download always 'full'); otherwise the Profile value,
  // defaulting to 'selective' (matches the registry schema default).
  const mode: EncryptMode = forceMode ?? (vars.encryption_mode === 'full' ? 'full' : 'selective');

  const fields = parseFields(vars.encryption_fields);
  if (mode === 'selective' && fields.length === 0) {
    throw new Error(
      'Encryption enabled with mode "selective" but encryption_fields is empty — ' +
        'configure the dot-path fields to encrypt on the Profile.',
    );
  }

  const metadataTarget =
    vars.encryption_metadata_target === 'body' || vars.encryption_metadata_target === 'headers'
      ? vars.encryption_metadata_target
      : 'both';

  const out = encryptForWire(formatted, {
    style: 'spec', mode, fields, publicKeyPem, metadataTarget, strictPaths: options.strictPaths,
  });
  return { body: JSON.parse(out.body), headers: out.headers, encrypted: true };
}
