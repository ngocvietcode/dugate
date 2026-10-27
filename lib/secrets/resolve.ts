// lib/secrets/resolve.ts
// Single resolution point for a connection's outbound auth secret.
//
// Dual-read (Strangler Fig migration):
//   - if `vaultSecretPath` is set → resolve the live value from the provider
//   - else → fall back to the legacy plaintext `authSecret` (pre-migration)
// This keeps not-yet-migrated connectors working with zero downtime.

import { getSecretProvider } from './index';

export interface ConnectionSecretFields {
  authSecret: string;
  vaultSecretPath?: string | null;
}

export async function resolveConnectionSecret(conn: ConnectionSecretFields): Promise<string> {
  const ref = conn.vaultSecretPath?.trim();
  if (ref) return getSecretProvider().getSecret(ref);
  return conn.authSecret ?? '';
}
