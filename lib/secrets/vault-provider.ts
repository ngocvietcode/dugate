// lib/secrets/vault-provider.ts
// HashiCorp Vault secret provider (AppRole auth + KV v2).
//
// Design goals (see brain: vault-secrets-mgmt):
//  - fetch-only, no heavy/native deps (must survive esbuild worker bundle)
//  - token cached + auto-renewed; re-login on 401/403
//  - secret value cached with TTL + single-flight (avoid Vault stampede under
//    batch load); short Vault outages tolerated via stale window
//  - NOT routed through assertSafeUrl (Vault is an internal host by design)

import type { SecretProvider } from './types';
import { parseVaultRef } from './types';
import {
  VAULT_ADDR,
  VAULT_ROLE_ID,
  VAULT_SECRET_ID,
  VAULT_KV_MOUNT,
  VAULT_NAMESPACE,
  VAULT_SECRET_CACHE_TTL_MS,
  VAULT_SECRET_STALE_MAX_MS,
  VAULT_REQUEST_TIMEOUT_MS,
  VAULT_TOKEN_RENEW_SKEW_MS,
} from '@/lib/config';

interface CachedSecret {
  value: string;
  freshUntil: number; // serve without refetch until this time
  staleUntil: number; // serve stale (on Vault error) until this time
}

export class VaultSecretProvider implements SecretProvider {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private loginInFlight: Promise<string> | null = null;

  private readonly cache = new Map<string, CachedSecret>();
  private readonly fetchInFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly cfg = {
      addr: VAULT_ADDR,
      roleId: VAULT_ROLE_ID,
      secretId: VAULT_SECRET_ID,
      mount: VAULT_KV_MOUNT,
      namespace: VAULT_NAMESPACE,
      ttlMs: VAULT_SECRET_CACHE_TTL_MS,
      staleMs: VAULT_SECRET_STALE_MAX_MS,
      timeoutMs: VAULT_REQUEST_TIMEOUT_MS,
      renewSkewMs: VAULT_TOKEN_RENEW_SKEW_MS,
    },
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  async getSecret(ref: string): Promise<string> {
    if (!ref?.trim()) throw new Error('[vault] empty secret ref');
    const now = Date.now();

    const cached = this.cache.get(ref);
    if (cached && now < cached.freshUntil) return cached.value;

    // single-flight: collapse concurrent fetches for the same ref
    const existing = this.fetchInFlight.get(ref);
    if (existing) return existing;

    const p = this.fetchAndCache(ref, cached).finally(() => {
      this.fetchInFlight.delete(ref);
    });
    this.fetchInFlight.set(ref, p);
    return p;
  }

  async testResolve(ref: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.getSecretUncached(ref);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Evict cached value for a ref — forces next getSecret() to fetch fresh from Vault. */
  invalidate(ref: string): void {
    this.cache.delete(ref);
    this.fetchInFlight.delete(ref);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async fetchAndCache(ref: string, prev?: CachedSecret): Promise<string> {
    try {
      const value = await this.getSecretUncached(ref);
      const now = Date.now();
      this.cache.set(ref, {
        value,
        freshUntil: now + this.cfg.ttlMs,
        staleUntil: now + this.cfg.staleMs,
      });
      return value;
    } catch (err) {
      // Soft outage tolerance: serve last-known value within the stale window.
      const now = Date.now();
      if (prev && now < prev.staleUntil) return prev.value;
      throw err;
    }
  }

  /** Resolve straight from Vault (no cache) — used by testResolve and fetchAndCache. */
  private async getSecretUncached(ref: string): Promise<string> {
    const { mount, path, field } = parseVaultRef(ref);
    const data = await this.readKvV2(this.composeUrl(mount, path), path, /* allowRelogin */ true);
    const value = data?.[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`[vault] field '${field}' not found at path '${path}'`);
    }
    return value;
  }

  /**
   * Compose the KV v2 read URL. The path is used VERBATIM (no hidden prefixing);
   * only the mount can be overridden (default = VAULT_KV_MOUNT).
   *   KV v2 read: <mount>/data/<path>
   */
  private composeUrl(mount: string | null, path: string): string {
    const useMount = (mount || this.cfg.mount).replace(/^\/+|\/+$/g, '');
    return `${this.cfg.addr.replace(/\/+$/, '')}/v1/${useMount}/data/${path}`;
  }

  private async readKvV2(url: string, path: string, allowRelogin: boolean): Promise<Record<string, unknown>> {
    const token = await this.ensureToken();
    const res = await this.httpFetch(url, { headers: this.vaultHeaders(token) });

    if (res.status === 401 || res.status === 403) {
      // token likely expired/revoked — re-login once and retry
      if (allowRelogin) {
        this.token = null;
        this.tokenExpiresAt = 0;
        return this.readKvV2(url, path, /* allowRelogin */ false);
      }
      throw new Error(`[vault] access denied reading '${path}' (HTTP ${res.status})`);
    }
    if (res.status === 404) throw new Error(`[vault] secret not found at '${path}'`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[vault] read '${path}' failed HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    const data = json?.data?.data;
    if (!data || typeof data !== 'object') {
      throw new Error(`[vault] unexpected KV v2 response shape for '${path}'`);
    }
    return data;
  }

  // ── Auth (AppRole) ──────────────────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - this.cfg.renewSkewMs) return this.token;
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = this.login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async login(): Promise<string> {
    if (!this.cfg.addr) throw new Error('[vault] VAULT_ADDR is not configured');
    if (!this.cfg.roleId || !this.cfg.secretId) {
      throw new Error('[vault] VAULT_ROLE_ID / VAULT_SECRET_ID are not configured');
    }

    const url = `${this.cfg.addr.replace(/\/+$/, '')}/v1/auth/approle/login`;
    const res = await this.httpFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.namespaceHeader() },
      body: JSON.stringify({ role_id: this.cfg.roleId, secret_id: this.cfg.secretId }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[vault] AppRole login failed HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      auth?: { client_token?: string; lease_duration?: number };
    };
    const clientToken = json?.auth?.client_token;
    if (!clientToken) throw new Error('[vault] AppRole login response missing client_token');

    const leaseSec = json.auth?.lease_duration ?? 3600;
    this.token = clientToken;
    this.tokenExpiresAt = Date.now() + leaseSec * 1000;
    return clientToken;
  }

  private vaultHeaders(token: string): Record<string, string> {
    return { 'X-Vault-Token': token, accept: 'application/json', ...this.namespaceHeader() };
  }

  private namespaceHeader(): Record<string, string> {
    return this.cfg.namespace ? { 'X-Vault-Namespace': this.cfg.namespace } : {};
  }

  private async httpFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`[vault] request timed out after ${this.cfg.timeoutMs}ms`);
      }
      throw err instanceof Error ? new Error(`[vault] request failed: ${err.message}`) : err;
    } finally {
      clearTimeout(t);
    }
  }
}
