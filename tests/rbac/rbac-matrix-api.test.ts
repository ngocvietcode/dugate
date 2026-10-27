/**
 * ADMIN-only OPS permission matrix API (app/api/internal/rbac/route.ts).
 *
 * The matrix is the control surface an auditor will exercise, so these tests pin:
 *   - only an ADMIN reaches it (OPS must not edit the role it belongs to);
 *   - baseline/locked/unknown keys are REJECTED rather than silently dropped, so
 *     a failed privilege change can never look like a successful one;
 *   - an accepted change is persisted, audited, and invalidates the resolver cache;
 *   - a no-op submission writes nothing and produces no audit noise.
 */
import { NextResponse } from 'next/server';
import { BASELINE_CAPABILITIES, LOCKED_CAPABILITIES } from '@/lib/rbac/capabilities';

const requireAdmin = jest.fn();
const existingRows = jest.fn<Promise<Array<{ permission: string; granted: boolean }>>, []>();
const insertedValues = jest.fn();
const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
const writeAudit = jest.fn().mockResolvedValue(undefined);
const getEffectivePermissions = jest.fn();
const invalidateRolePermissions = jest.fn();

jest.mock('@/lib/auth-guard', () => ({ requireAdmin: () => requireAdmin() }));
jest.mock('@/lib/audit/write', () => ({ writeAudit: (entry: unknown) => writeAudit(entry) }));
jest.mock('@/lib/rbac/resolve', () => ({
  getEffectivePermissions: () => getEffectivePermissions(),
  invalidateRolePermissions: (role?: string) => invalidateRolePermissions(role),
}));
jest.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => existingRows() }) }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      insert: () => ({
        values: (values: unknown) => {
          insertedValues(values);
          return { onConflictDoUpdate };
        },
      }),
    }),
  },
}));

const adminSession = { session: { user: { id: 'admin-1', username: 'admin', role: 'ADMIN' } } };

const putMatrix = async (body: unknown) => {
  const { PUT } = await import('@/app/api/internal/rbac/route');
  const request = new Request('http://localhost/api/internal/rbac', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PUT(request as never);
};

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue(adminSession);
  existingRows.mockResolvedValue([]);
  getEffectivePermissions.mockResolvedValue(new Set(['profile:read']));
});

describe('authorization', () => {
  it('refuses a non-ADMIN before touching the database', async () => {
    requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 }));

    const response = await putMatrix({ role: 'OPS', permissions: { 'profile:update': true } });

    expect(response.status).toBe(403);
    expect(existingRows).not.toHaveBeenCalled();
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it('exposes the matrix to an ADMIN on GET', async () => {
    const { GET } = await import('@/app/api/internal/rbac/route');

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.role).toBe('OPS');
    // Every catalog row is returned with its granted state so the UI can disable
    // the rows an ADMIN is not allowed to change.
    expect(payload.capabilities.length).toBeGreaterThan(0);
    expect(payload.capabilities.find((row: { key: string }) => row.key === 'profile:read')).toMatchObject({
      kind: 'baseline',
      granted: true,
    });
  });
});

describe('payload validation', () => {
  it.each(LOCKED_CAPABILITIES)('rejects locked capability %s', async (capability) => {
    const response = await putMatrix({ role: 'OPS', permissions: { [capability]: true } });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain(capability);
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it.each(BASELINE_CAPABILITIES)('rejects baseline capability %s', async (capability) => {
    const response = await putMatrix({ role: 'OPS', permissions: { [capability]: false } });

    expect(response.status).toBe(400);
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it('rejects an unknown capability key', async () => {
    const response = await putMatrix({ role: 'OPS', permissions: { 'profile:sudo': true } });

    expect(response.status).toBe(400);
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean grant value', async () => {
    const response = await putMatrix({ role: 'OPS', permissions: { 'profile:update': 'yes' } });

    expect(response.status).toBe(400);
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it.each([
    ['a role other than OPS', { role: 'ADMIN', permissions: { 'profile:update': true } }],
    ['a missing permissions object', { role: 'OPS' }],
    ['an empty permissions object', { role: 'OPS', permissions: {} }],
  ])('rejects %s', async (_label, body) => {
    const response = await putMatrix(body);

    expect(response.status).toBe(400);
    expect(insertedValues).not.toHaveBeenCalled();
  });
});

describe('applying a change', () => {
  it('persists, audits and invalidates the cache', async () => {
    const response = await putMatrix({ role: 'OPS', permissions: { 'profile:delete': true } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.changed).toBe(1);
    expect(insertedValues).toHaveBeenCalledWith(expect.objectContaining({
      role: 'OPS',
      permission: 'profile:delete',
      granted: true,
      updatedByUserId: 'admin-1',
    }));
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    // Revocations must take effect without the OPS user signing in again.
    expect(invalidateRolePermissions).toHaveBeenCalledWith('OPS');
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'ROLE_PERMISSION',
      entityName: 'OPS',
      action: 'UPDATE',
      outcome: 'SUCCESS',
      changes: { 'profile:delete': { from: false, to: true } },
      actorUserId: 'admin-1',
    }));
  });

  it('records the previous state when revoking an existing grant', async () => {
    existingRows.mockResolvedValue([{ permission: 'operations:cancel', granted: true }]);

    const response = await putMatrix({ role: 'OPS', permissions: { 'operations:cancel': false } });

    expect(response.status).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      changes: { 'operations:cancel': { from: true, to: false } },
    }));
  });

  it('writes nothing when the submitted state already matches', async () => {
    existingRows.mockResolvedValue([{ permission: 'profile:update', granted: true }]);

    const response = await putMatrix({ role: 'OPS', permissions: { 'profile:update': true } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.changed).toBe(0);
    expect(insertedValues).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(invalidateRolePermissions).not.toHaveBeenCalled();
  });
});
