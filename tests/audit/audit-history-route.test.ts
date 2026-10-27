import { NextResponse } from 'next/server';

const requireProfileAccess = jest.fn();
const requireCapability = jest.fn();
const offset = jest.fn();
const limit = jest.fn(() => ({ offset }));
const orderBy = jest.fn(() => ({ limit }));
const where = jest.fn(() => ({ orderBy }));
const from = jest.fn(() => ({ where }));
const select = jest.fn(() => ({ from }));

jest.mock('@/lib/auth-guard', () => ({
  requireProfileAccess: (...args: unknown[]) => requireProfileAccess(...args),
  requireCapability: (...args: unknown[]) => requireCapability(...args),
}));
jest.mock('@/lib/db', () => ({ db: { select: () => select() } }));

describe('GET /api/internal/audit-history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireProfileAccess.mockResolvedValue({ session: { user: { id: 'ops-1', role: 'OPS' } } });
    requireCapability.mockResolvedValue({ session: { user: { id: 'ops-1', role: 'OPS' } } });
  });

  it('authorizes a Profile before querying ConfigAudit', async () => {
    requireProfileAccess.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { GET } = await import('@/app/api/internal/audit-history/route');

    const response = await GET(new Request('http://localhost/api/internal/audit-history?entityType=PROFILE&entityId=profile-1') as never);

    expect(response.status).toBe(403);
    expect(requireProfileAccess).toHaveBeenCalledWith('profile-1', 'profile:read');
    expect(select).not.toHaveBeenCalled();
  });

  it('filters a Connector timeline and sanitizes legacy secret values', async () => {
    offset.mockResolvedValue([
      {
        id: 'audit-1', entityType: 'CONNECTOR', entityId: 'conn-1', entityName: 'connector-a', action: 'UPDATE', outcome: 'SUCCESS',
        changes: JSON.stringify({
          endpointUrl: { from: 'https://old/?token=secret', to: 'https://new/?token=secret2' },
          extraHeaders: { from: '{"Authorization":"Bearer leak"}', to: '{"Authorization":"Bearer replacement"}' },
        }),
        actorUserId: 'ops-1', actorRole: 'OPS', sourceIp: '127.0.0.1', createdAt: new Date('2026-09-09T00:00:00.000Z'),
      },
    ]);
    const { GET } = await import('@/app/api/internal/audit-history/route');

    const response = await GET(new Request('http://localhost/api/internal/audit-history?entityType=CONNECTOR&entityId=conn-1&pageSize=20') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireCapability).toHaveBeenCalledWith('connector:manage');
    expect(body.entries[0].changes.extraHeaders).toEqual({ from: 'configured', to: 'configured' });
    expect(body.entries[0].changes.endpointUrl.from).toMatchObject({ kind: 'summary' });
    expect(JSON.stringify(body)).not.toContain('Bearer leak');
    expect(JSON.stringify(body)).not.toContain('token=secret');
    expect(limit).toHaveBeenCalledWith(21);
    expect(offset).toHaveBeenCalledWith(0);
  });
});

  it('sanitizes ENDPOINT rows returned via scopeEntityId in a Profile timeline', async () => {
    offset.mockResolvedValue([
      {
        id: 'audit-ep-1', entityType: 'ENDPOINT', entityId: 'ep-1', entityName: 'extract',
        scopeEntityId: 'profile-1', action: 'UPDATE', outcome: 'SUCCESS',
        changes: JSON.stringify({
          enabled: { from: false, to: true },
          parameters: { from: '{"secret":"leak"}', to: '{"secret":"new-leak"}' },
          fileUrlAuthConfig: { from: 'encrypted', to: 'new-encrypted' },
        }),
        actorUserId: 'ops-1', actorRole: 'OPS', sourceIp: '10.0.0.1',
        createdAt: new Date('2026-09-09T01:00:00.000Z'),
      },
    ]);
    const { GET } = await import('@/app/api/internal/audit-history/route');

    const response = await GET(new Request('http://localhost/api/internal/audit-history?entityType=PROFILE&entityId=profile-1') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    const entry = body.entries[0];
    // enabled is VALUE — passes through
    expect(entry.changes.enabled).toEqual({ from: false, to: true });
    // parameters is PRESENCE — no raw values
    expect(entry.changes.parameters).toEqual({ from: 'configured', to: 'configured' });
    // fileUrlAuthConfig was retired from the ENDPOINT policy. sanitizeChanges is an
    // allow-list walk, so a historical row still carrying the field has it dropped.
    expect(entry.changes.fileUrlAuthConfig).toBeUndefined();
    // No raw secrets in serialized response
    expect(JSON.stringify(body)).not.toContain('leak');
    expect(JSON.stringify(body)).not.toContain('encrypted');
  });
