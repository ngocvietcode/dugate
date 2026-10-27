const mockState: { existingRows: Array<{ endpointSlug: string; enabled: boolean; parameters?: string | null; connectionsOverride?: string | null; jobPriority?: string }> } = {
  existingRows: [],
};
const mockTxSelect = jest.fn();
const mockTxInsertValues = jest.fn();
const mockTxInsertConflict = jest.fn();
const mockTxUpdateSet = jest.fn();
const mockTxUpdateWhere = jest.fn();
const mockTransaction = jest.fn();
const mockWriteAudit = jest.fn();

const mockTx = {
  select: () => {
    mockTxSelect();
    return { from: () => ({ where: () => Promise.resolve(mockState.existingRows) }) };
  },
  insert: () => ({
    values: (values: unknown) => {
      mockTxInsertValues(values);
      return {
        onConflictDoUpdate: (config: unknown) => {
          mockTxInsertConflict(config);
          return Promise.resolve();
        },
      };
    },
  }),
  update: () => ({
    set: (values: unknown) => {
      mockTxUpdateSet(values);
      return {
        where: (where: unknown) => {
          mockTxUpdateWhere(where);
          return Promise.resolve();
        },
      };
    },
  }),
};

jest.mock('@/lib/db', () => ({
  db: {
    transaction: (callback: (tx: typeof mockTx) => unknown) => {
      mockTransaction();
      return callback(mockTx);
    },
  },
}));
jest.mock('@/lib/db/schema', () => ({
  profileEndpoints: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
}));
jest.mock('@/lib/endpoints/registry', () => ({
  getAllEndpointSlugs: () => [
    { slug: 'extract:invoice', isWorkflow: false },
    { slug: 'compare:contract', isWorkflow: false },
    { slug: 'workflows:payroll-verify', isWorkflow: true },
  ],
}));
jest.mock('@/lib/auth-guard', () => ({ requireProfileAccess: jest.fn() }));
jest.mock('@/lib/audit/write', () => ({ writeAudit: mockWriteAudit }));
jest.mock('@/lib/audit/diff', () => ({
  buildChanges: jest.fn(() => ({ enabled: { from: false, to: true } })),
}));
jest.mock('@/lib/audit/policy', () => ({ AUDIT_POLICIES: { ENDPOINT: {} } }));
jest.mock('@/lib/audit/context', () => ({
  auditActor: jest.fn(() => ({ actorUserId: 'u1', actorRole: 'ADMIN' })),
  getSourceIp: jest.fn(() => '127.0.0.1'),
}));
jest.mock('@/lib/logger', () => ({ Logger: jest.fn(() => ({ error: jest.fn() })) }));

import { NextResponse } from 'next/server';
import { requireProfileAccess } from '@/lib/auth-guard';
import { POST } from '@/app/api/internal/profile-endpoints/bulk/route';

const mockRequireProfileAccess = requireProfileAccess as jest.Mock;
const post = (body: unknown) => POST(new Request('http://localhost/api/internal/profile-endpoints/bulk', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}) as never);

const authorizedGuard = { session: { user: { id: 'u1', role: 'ADMIN' } }, allowed: true };

describe('profile-endpoints bulk route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.existingRows = [];
    mockRequireProfileAccess.mockResolvedValue(authorizedGuard);
  });

  it('rejects an invalid scope before authorization or database work', async () => {
    const response = await post({ apiKeyId: 'profile-1', enabled: true, scope: 'invalid' });

    expect(response.status).toBe(400);
    expect(mockRequireProfileAccess).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns the profile-access 403 before starting a transaction', async () => {
    mockRequireProfileAccess.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));

    const response = await post({ apiKeyId: 'profile-1', enabled: true, scope: 'core' });

    expect(response.status).toBe(403);
    expect(mockRequireProfileAccess).toHaveBeenCalledWith('profile-1', 'endpoint:manage');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('enables every core endpoint with one scoped upsert and only updates enabled', async () => {
    mockState.existingRows = [{
      endpointSlug: 'extract:invoice',
      enabled: false,
      parameters: '{"locked":true}',
      connectionsOverride: '["preserved"]',
      jobPriority: 'HIGH',
    }];

    const response = await post({ apiKeyId: 'profile-1', enabled: true, scope: 'core' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 2, enabled: true });
    expect(mockTxInsertValues).toHaveBeenCalledWith([
      { apiKeyId: 'profile-1', endpointSlug: 'extract:invoice', enabled: true },
      { apiKeyId: 'profile-1', endpointSlug: 'compare:contract', enabled: true },
    ]);
    expect(mockTxInsertConflict).toHaveBeenCalledWith(expect.objectContaining({
      target: ['apiKeyId', 'endpointSlug'],
      set: { enabled: true },
    }));
    expect(mockTxUpdateSet).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'BULK_ENABLE',
      scopeEntityId: 'profile-1',
      detail: expect.stringContaining('scope=core; updated=2; enabled=true'),
    }));
  });

  it('disables only existing workflow rows and preserves their other configuration', async () => {
    mockState.existingRows = [{
      endpointSlug: 'workflows:payroll-verify',
      enabled: true,
      parameters: '{"locked":true}',
      connectionsOverride: '["preserved"]',
      jobPriority: 'HIGH',
    }];

    const response = await post({ apiKeyId: 'profile-1', enabled: false, scope: 'workflows' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 1, enabled: false });
    expect(mockTxInsertValues).not.toHaveBeenCalled();
    expect(mockTxUpdateSet).toHaveBeenCalledWith({ enabled: false });
    expect(mockTxUpdateSet.mock.calls[0][0]).toEqual({ enabled: false });
  });

  it('is idempotent when the requested core state is already enabled', async () => {
    mockState.existingRows = [
      { endpointSlug: 'extract:invoice', enabled: true },
      { endpointSlug: 'compare:contract', enabled: true },
    ];

    const response = await post({ apiKeyId: 'profile-1', enabled: true, scope: 'core' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 0, enabled: true });
    expect(mockTxInsertConflict).toHaveBeenCalledWith(expect.objectContaining({ set: { enabled: true } }));
  });
});
