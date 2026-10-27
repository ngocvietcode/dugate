/**
 * Capability resolver invariants (lib/rbac/resolve.ts).
 *
 * This resolver is the single authority behind every server guard, so the tests
 * below pin the security properties that must hold even when the RolePermission
 * table is empty, stale, or deliberately tampered with:
 *   - ADMIN is unconditional and never depends on database state.
 *   - OPS baseline capabilities cannot be revoked.
 *   - Locked (identity/RBAC) capabilities can never be granted to OPS, even by a
 *     hand-inserted row — this is the privilege-escalation guard.
 *   - Retired roles (USER/VIEWER) and unknown roles are denied everything.
 */
import {
  BASELINE_CAPABILITIES,
  LOCKED_CAPABILITIES,
  ALL_CAPABILITIES,
} from '@/lib/rbac/capabilities';

const permissionRows = jest.fn<Promise<Array<{ permission: string; granted: boolean }>>, []>();

jest.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => permissionRows() }) }),
  },
}));

import {
  getEffectivePermissions,
  invalidateRolePermissions,
  resetPermissionCacheForTests,
  roleHasCapability,
} from '@/lib/rbac/resolve';

beforeEach(() => {
  jest.clearAllMocks();
  resetPermissionCacheForTests();
  permissionRows.mockResolvedValue([]);
});

describe('ADMIN', () => {
  it('holds every capability without reading the database', async () => {
    const permissions = await getEffectivePermissions('ADMIN');

    expect([...permissions].sort()).toEqual([...ALL_CAPABILITIES].sort());
    expect(permissionRows).not.toHaveBeenCalled();
  });

  it('keeps locked identity capabilities', async () => {
    for (const locked of LOCKED_CAPABILITIES) {
      expect(await roleHasCapability('ADMIN', locked)).toBe(true);
    }
  });

  it('returns a copy so a caller cannot mutate the shared ADMIN set', async () => {
    const first = await getEffectivePermissions('ADMIN');
    first.delete('rbac:manage');

    expect(await roleHasCapability('ADMIN', 'rbac:manage')).toBe(true);
  });
});

describe('OPS', () => {
  it('gets baseline capabilities when nothing is configured', async () => {
    const permissions = await getEffectivePermissions('OPS');

    expect([...permissions].sort()).toEqual([...BASELINE_CAPABILITIES].sort());
  });

  it('gains a configurable capability that is granted', async () => {
    permissionRows.mockResolvedValue([{ permission: 'profile:update', granted: true }]);

    expect(await roleHasCapability('OPS', 'profile:update')).toBe(true);
  });

  it('does not gain a configurable capability that is revoked', async () => {
    permissionRows.mockResolvedValue([{ permission: 'profile:delete', granted: false }]);

    expect(await roleHasCapability('OPS', 'profile:delete')).toBe(false);
  });

  it('ignores a granted LOCKED capability row (privilege escalation guard)', async () => {
    // Simulates DB tampering or a stale row from an earlier schema.
    permissionRows.mockResolvedValue([
      { permission: 'user:manage', granted: true },
      { permission: 'rbac:manage', granted: true },
      { permission: 'role:assign', granted: true },
      { permission: 'assignment:manage', granted: true },
    ]);

    const permissions = await getEffectivePermissions('OPS');

    for (const locked of LOCKED_CAPABILITIES) {
      expect(permissions.has(locked)).toBe(false);
    }
  });

  it('ignores unknown permission strings', async () => {
    permissionRows.mockResolvedValue([{ permission: 'profile:destroy-everything', granted: true }]);

    const permissions = await getEffectivePermissions('OPS');

    expect([...permissions].sort()).toEqual([...BASELINE_CAPABILITIES].sort());
  });

  it('cannot have a baseline capability revoked through the database', async () => {
    permissionRows.mockResolvedValue([{ permission: 'profile:read', granted: false }]);

    expect(await roleHasCapability('OPS', 'profile:read')).toBe(true);
  });
});

describe('unrecognised roles fail closed', () => {
  it.each(['USER', 'VIEWER', 'ops', 'SUPERADMIN', '', null, undefined])(
    'denies every capability for %p',
    async (role) => {
      const permissions = await getEffectivePermissions(role as string | null | undefined);

      expect(permissions.size).toBe(0);
      expect(await roleHasCapability(role as string | null | undefined, 'profile:read')).toBe(false);
    },
  );

  it('never queries the database for a retired role', async () => {
    await getEffectivePermissions('VIEWER');

    expect(permissionRows).not.toHaveBeenCalled();
  });
});

describe('cache behaviour', () => {
  it('serves repeated OPS lookups from cache within the TTL', async () => {
    await getEffectivePermissions('OPS');
    await getEffectivePermissions('OPS');
    await roleHasCapability('OPS', 'profile:read');

    expect(permissionRows).toHaveBeenCalledTimes(1);
  });

  it('re-reads after an ADMIN updates the matrix', async () => {
    await getEffectivePermissions('OPS');
    permissionRows.mockResolvedValue([{ permission: 'settings:manage', granted: true }]);

    // Without invalidation the revocation/grant would linger for the TTL.
    expect(await roleHasCapability('OPS', 'settings:manage')).toBe(false);
    invalidateRolePermissions('OPS');

    expect(await roleHasCapability('OPS', 'settings:manage')).toBe(true);
    expect(permissionRows).toHaveBeenCalledTimes(2);
  });
});
