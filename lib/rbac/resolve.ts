// lib/rbac/resolve.ts
// Database-backed capability resolver. It is intentionally server-only: UI code
// obtains its own capability list via /api/internal/me/permissions and must never
// be trusted for authorization.

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rolePermissions } from '@/lib/db/schema';
import {
  ALL_CAPABILITIES,
  BASELINE_CAPABILITIES,
  type Capability,
  isConfigurableCapability,
} from '@/lib/rbac/capabilities';

const PERMISSION_CACHE_TTL_MS = 15_000;

type CachedPermissions = {
  permissions: ReadonlySet<Capability>;
  expiresAt: number;
};

const permissionCache = new Map<string, CachedPermissions>();
const adminPermissions = new Set<Capability>(ALL_CAPABILITIES);

function clonePermissions(permissions: ReadonlySet<Capability>): Set<Capability> {
  return new Set(permissions);
}

/**
 * Resolve effective permissions for one application role.
 *
 * Invariants:
 * - ADMIN has every known capability, regardless of DB state.
 * - Only persisted configurable grants can extend OPS beyond its baseline.
 * - Unknown, empty, and retired roles are denied every capability.
 * - Locked and unknown DB values are ignored, even if manually inserted.
 */
export async function getEffectivePermissions(role: string | null | undefined): Promise<Set<Capability>> {
  if (role === 'ADMIN') return clonePermissions(adminPermissions);
  if (role !== 'OPS') return new Set<Capability>();

  const now = Date.now();
  const cached = permissionCache.get(role);
  if (cached && cached.expiresAt > now) {
    return clonePermissions(cached.permissions);
  }

  const rows = await db.select({
    permission: rolePermissions.permission,
    granted: rolePermissions.granted,
  })
    .from(rolePermissions)
    .where(eq(rolePermissions.role, role));

  const permissions = new Set<Capability>(BASELINE_CAPABILITIES);
  for (const row of rows) {
    // `isConfigurableCapability` makes a DB corruption or stale privilege row
    // fail closed. Baseline cannot be revoked; locked can never be granted.
    if (row.granted && isConfigurableCapability(row.permission)) {
      permissions.add(row.permission);
    }
  }

  permissionCache.set(role, {
    permissions,
    expiresAt: now + PERMISSION_CACHE_TTL_MS,
  });
  return clonePermissions(permissions);
}

export async function roleHasCapability(
  role: string | null | undefined,
  capability: Capability,
): Promise<boolean> {
  return (await getEffectivePermissions(role)).has(capability);
}

/** Clear local permission cache after an ADMIN changes the OPS matrix. */
export function invalidateRolePermissions(role?: string): void {
  if (role) {
    permissionCache.delete(role);
    return;
  }
  permissionCache.clear();
}

/** Exposed only for deterministic unit tests. */
export function resetPermissionCacheForTests(): void {
  permissionCache.clear();
}
