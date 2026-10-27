// lib/secrets/types.ts
// Abstraction for resolving a secret VALUE from a logical reference.
//
// A "secret ref" is an ENV-AGNOSTIC logical path stored in the DB, e.g.
//   "aihub/team-a"                 → field defaults to "api_key"
//   "agent-toolkit/invoice#token"  → explicit field "token"
// The concrete provider (Vault / dev) composes the full backend path from
// environment config, so the same DB value works across Nonprod/Prod.

export interface SecretProvider {
  /**
   * Resolve the secret value for a logical reference.
   * @param ref logical path, optionally suffixed with "#<field>".
   * @throws if the secret cannot be resolved.
   */
  getSecret(ref: string): Promise<string>;

  /**
   * Resolve without throwing — returns { ok, value|error }.
   * Used by the "Test resolve" UI action (never exposes the value on failure).
   */
  testResolve(ref: string): Promise<{ ok: true } | { ok: false; error: string }>;

  /**
   * Evict a cached value so the next getSecret() fetches fresh.
   * No-op for providers without caching.
   */
  invalidate(ref: string): void;
}

export interface ParsedVaultRef {
  /** KV mount override (null → use the configured VAULT_KV_MOUNT). */
  mount: string | null;
  /** Full KV path within the mount (no mount, no leading/trailing slash, no #field). */
  path: string;
  /** Field within the secret. Default "api_key". */
  field: string;
}

/**
 * Parse a Vault Secret Path ref. ONE rule: the value is the FULL KV path within the
 * mount (exactly as shown in the Vault UI), optionally with a "<mount>:" prefix to
 * target a non-default mount, and "#<field>" for the field. No hidden prefixing.
 *   "eda/rpa/dugate/agent-toolkit#ext-doc-layout" → mount=default, field ext-doc-layout
 *   "eda/rpa/dugate/aihub"                        → mount=default, field api_key
 *   "kv-aihub:eda/aihub/shared#api_key"           → mount override "kv-aihub"
 */
export function parseVaultRef(ref: string): ParsedVaultRef {
  let s = (ref ?? '').trim();

  // 1) split off "#field"
  let field = 'api_key';
  const hashIdx = s.indexOf('#');
  if (hashIdx !== -1) {
    field = s.slice(hashIdx + 1).trim() || 'api_key';
    s = s.slice(0, hashIdx).trim();
  }

  // 2) optional "<mount>:<rest>" override (mount token has no slash)
  let mount: string | null = null;
  const colonIdx = s.indexOf(':');
  if (colonIdx > 0 && !s.slice(0, colonIdx).includes('/')) {
    mount = s.slice(0, colonIdx).trim() || null;
    s = s.slice(colonIdx + 1).trim();
  }

  // 3) tolerate leading/trailing slashes; the path is used verbatim (no prefixing)
  const path = s.replace(/^\/+|\/+$/g, '');

  return { mount, path, field };
}

/** Backward-compatible helper (path + field only). */
export function parseSecretRef(ref: string): { path: string; field: string } {
  const { path, field } = parseVaultRef(ref);
  return { path, field };
}
