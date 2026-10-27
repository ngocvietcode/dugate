// lib/crypto/key-resolver.ts
//
// Resolves the RSA public key used to wrap the AES key, following the waterfall
// defined in DESIGN-API-SECURITY-ENCRYPTION.md §4:
//
//   1. Request/param `encryption_public_key`   (per-request, spec name)
//   2. Request/param `partner_public_key`       (per-request, PAM legacy name)
//   3. Vault at `encryption_vault_path`         (Admin-configured secret path)
//   4. Profile PEM `partner_public_key` (same field, Profile-locked)  — covered by 1/2
//   5. else → null (caller returns HTTP 400)
//
// Both `encryption_public_key` and `partner_public_key` live in ctx.pipelineVars.
// pipelineVars already merges request params + Profile config (see profile-resolver),
// so we do not distinguish request vs Profile origin here — the merge did that.

export interface KeyResolverVars {
  encryption_public_key?: unknown;
  partner_public_key?: unknown;
  encryption_vault_path?: unknown;
}

/** Fetch a PEM public key from Vault. Kept as a seam so tests can inject a stub. */
export type VaultKeyFetcher = (vaultPath: string) => Promise<string | null>;

function asTrimmedString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Resolve the receiver public key PEM.
 * Returns the PEM string, or null when no key is configured.
 *
 * @param vars          pipelineVars (merged request + Profile).
 * @param vaultFetcher  optional Vault fetcher; when omitted, the Vault step is skipped.
 */
export async function resolvePublicKey(
  vars: KeyResolverVars,
  vaultFetcher?: VaultKeyFetcher,
): Promise<string | null> {
  // 1 + 2: explicit PEM (spec name preferred, then PAM legacy name)
  const explicit = asTrimmedString(vars.encryption_public_key) ?? asTrimmedString(vars.partner_public_key);
  if (explicit) return explicit;

  // 3: Vault path
  const vaultPath = asTrimmedString(vars.encryption_vault_path);
  if (vaultPath && vaultFetcher) {
    const fromVault = await vaultFetcher(vaultPath);
    const trimmed = asTrimmedString(fromVault);
    if (trimmed) return trimmed;
  }

  // 4/5: nothing
  return null;
}
