/**
 * "At least one ADMIN must remain" invariant (app/api/users/[id]/route.ts).
 *
 * Losing the final ADMIN is unrecoverable through the UI: nobody could restore
 * roles, assignments, or the permission matrix afterwards. Counting admins and
 * writing must therefore be atomic, so the route takes a transaction-scoped
 * PostgreSQL advisory lock — these tests assert both the lock and the refusal.
 */
const getServerSession = jest.fn();
const writeAudit = jest.fn().mockResolvedValue(undefined);
const txExecute = jest.fn().mockResolvedValue(undefined);
const txDelete = jest.fn();
const updateReturning = jest.fn();

let outerSelectRows: Array<Record<string, unknown>> = [];
let txSelectQueue: Array<Array<Record<string, unknown>>> = [];

jest.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/audit/write', () => ({ writeAudit: (entry: unknown) => writeAudit(entry) }));

/** Supports both `.where(...)` and `.where(...).limit(1)` call shapes. */
const thenableRows = (rows: Array<Record<string, unknown>>) => ({
  limit: () => Promise.resolve(rows),
  then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(onFulfilled, onRejected),
});

jest.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => thenableRows(outerSelectRows) }) }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      execute: (statement: unknown) => txExecute(statement),
      select: () => ({ from: () => ({ where: () => thenableRows(txSelectQueue.shift() ?? []) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => updateReturning() }) }) }),
      delete: () => ({ where: () => txDelete() }),
    }),
  },
}));

const adminActor = { user: { id: 'admin-actor', username: 'root', role: 'ADMIN' } };

const callPut = async (id: string, body: unknown) => {
  const { PUT } = await import('@/app/api/users/[id]/route');
  const request = new Request(`http://localhost/api/users/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PUT(request, { params: { id } });
};

const callDelete = async (id: string) => {
  const { DELETE } = await import('@/app/api/users/[id]/route');
  const request = new Request(`http://localhost/api/users/${id}`, { method: 'DELETE' });
  return DELETE(request, { params: { id } });
};

beforeEach(() => {
  jest.clearAllMocks();
  getServerSession.mockResolvedValue(adminActor);
  outerSelectRows = [];
  txSelectQueue = [];
  txDelete.mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('demoting an ADMIN to OPS', () => {
  it('is refused when that ADMIN is the last one', async () => {
    outerSelectRows = [{ id: 'admin-2', username: 'only-admin', role: 'ADMIN' }];
    txSelectQueue = [[{ adminCount: 1 }]];

    const response = await callPut('admin-2', { role: 'OPS' });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Không thể hạ role ADMIN cuối cùng');
    expect(updateReturning).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('takes the advisory lock before counting admins', async () => {
    outerSelectRows = [{ id: 'admin-2', username: 'only-admin', role: 'ADMIN' }];
    txSelectQueue = [[{ adminCount: 1 }]];

    await callPut('admin-2', { role: 'OPS' });

    // Serializes concurrent demotions across app instances.
    expect(txExecute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(txExecute.mock.calls[0][0])).toContain('72418002');
  });

  it('succeeds while another ADMIN remains, and is audited', async () => {
    outerSelectRows = [{ id: 'admin-2', username: 'second-admin', role: 'ADMIN' }];
    txSelectQueue = [[{ adminCount: 2 }]];
    updateReturning.mockResolvedValue([{ id: 'admin-2', username: 'second-admin', role: 'OPS' }]);

    const response = await callPut('admin-2', { role: 'OPS' });

    expect(response.status).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'USER',
      action: 'UPDATE',
      outcome: 'SUCCESS',
      actorUserId: 'admin-actor',
    }));
  });

  it('does not lock or count when the target is not an ADMIN', async () => {
    outerSelectRows = [{ id: 'ops-1', username: 'operator', role: 'OPS' }];
    updateReturning.mockResolvedValue([{ id: 'ops-1', username: 'operator', role: 'OPS' }]);

    const response = await callPut('ops-1', { role: 'OPS' });

    expect(response.status).toBe(200);
    expect(txExecute).not.toHaveBeenCalled();
  });

  it('rejects a role outside ADMIN/OPS', async () => {
    const response = await callPut('ops-1', { role: 'VIEWER' });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Role không hợp lệ');
  });

  it('refuses a non-ADMIN caller', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'ops-9', username: 'op', role: 'OPS' } });

    const response = await callPut('admin-2', { role: 'OPS' });

    expect(response.status).toBe(403);
  });
});

describe('deleting an ADMIN', () => {
  it('is refused when that ADMIN is the last one', async () => {
    txSelectQueue = [[{ id: 'admin-2', username: 'only-admin', role: 'ADMIN' }], [{ adminCount: 1 }]];

    const response = await callDelete('admin-2');
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Không thể xóa ADMIN cuối cùng');
    expect(txDelete).not.toHaveBeenCalled();
  });

  it('succeeds while another ADMIN remains', async () => {
    txSelectQueue = [[{ id: 'admin-2', username: 'second-admin', role: 'ADMIN' }], [{ adminCount: 2 }]];

    const response = await callDelete('admin-2');

    expect(response.status).toBe(200);
    expect(txDelete).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'USER',
      action: 'DELETE',
      outcome: 'SUCCESS',
    }));
  });

  it('refuses self-deletion before any database work', async () => {
    const response = await callDelete('admin-actor');
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Không thể xóa chính mình');
    expect(txDelete).not.toHaveBeenCalled();
  });
});
