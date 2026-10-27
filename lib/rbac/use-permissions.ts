'use client';
// lib/rbac/use-permissions.ts
// Client-side capability affordances.
//
// IMPORTANT: this is DISPLAY DATA ONLY. Every sensitive route re-resolves the
// same capability on the server (lib/auth-guard.ts), so hiding a control here is
// a usability decision, never the security boundary. On any failure the hook
// returns an empty set so the UI degrades to read-only instead of showing
// actions the server would reject.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Capability } from './capabilities';

const PERMISSIONS_ENDPOINT = '/api/internal/me/permissions';

export interface UsePermissionsResult {
  role: string | null;
  permissions: Set<Capability>;
  loading: boolean;
  error: string | null;
  /** True when the current user holds the capability. */
  can: (capability: Capability) => boolean;
  /** True when the user holds at least one of the capabilities. */
  canAny: (...capabilities: Capability[]) => boolean;
  reload: () => void;
}

/**
 * @param options.enabled Set false to skip the request entirely (e.g. on public
 * pages where no session exists yet). Disabled means "no capabilities".
 */
export function usePermissions(options?: { enabled?: boolean }): UsePermissionsResult {
  const enabled = options?.enabled ?? true;
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Set<Capability>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setPermissions(new Set());
      setRole(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      try {
        const response = await fetch(PERMISSIONS_ENDPOINT, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Không thể tải quyền (HTTP ${response.status})`);
        }
        const payload = await response.json() as { role?: string; permissions?: string[] };
        if (!active) return;
        setRole(typeof payload.role === 'string' ? payload.role : null);
        setPermissions(new Set((payload.permissions ?? []) as Capability[]));
        setError(null);
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        // Fail closed: no capabilities rather than an optimistic guess.
        setPermissions(new Set());
        setRole(null);
        setError(cause instanceof Error ? cause.message : 'Không thể tải quyền hiện tại');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, reloadToken]);

  const can = useCallback(
    (capability: Capability) => permissions.has(capability),
    [permissions],
  );
  const canAny = useCallback(
    (...capabilities: Capability[]) => capabilities.some((capability) => permissions.has(capability)),
    [permissions],
  );
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return useMemo(
    () => ({ role, permissions, loading, error, can, canAny, reload }),
    [role, permissions, loading, error, can, canAny, reload],
  );
}
