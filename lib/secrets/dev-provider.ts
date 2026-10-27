// lib/secrets/dev-provider.ts
// Local/CI/mock secret provider — resolves refs WITHOUT a real Vault.
//
// Source of values (first match wins):
//  1. explicit map passed to the constructor (tests)
//  2. JSON object in env VAULT_DEV_SECRETS, e.g. {"aihub/team-a":"sk-xxx"}
//  3. env var VAULT_DEV_SECRET_<UPPER_SNAKE(path)> (e.g. aihub/team-a → VAULT_DEV_SECRET_AIHUB_TEAM_A)
// This keeps existing dev flows and the mock-service working with no Vault.

import type { SecretProvider } from './types';
import { parseSecretRef } from './types';

export class DevSecretProvider implements SecretProvider {
  private readonly map: Record<string, string>;

  constructor(map?: Record<string, string>) {
    this.map = map ?? this.loadFromEnv();
  }

  async getSecret(ref: string): Promise<string> {
    const { path } = parseSecretRef(ref);
    if (path in this.map) return this.map[path];

    const envKey = 'VAULT_DEV_SECRET_' + path.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
    const fromEnv = process.env[envKey];
    if (fromEnv) return fromEnv;

    throw new Error(`[dev-secrets] no value configured for ref '${ref}' (looked up map + ${envKey})`);
  }

  async testResolve(ref: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.getSecret(ref);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  invalidate(_ref: string): void {
    // No-op — dev provider has no cache.
  }

  private loadFromEnv(): Record<string, string> {
    const raw = process.env.VAULT_DEV_SECRETS;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
}
