const mockLimit = jest.fn();
const mockOrderBy = jest.fn(() => ({ limit: mockLimit }));
const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = jest.fn(() => ({ where: mockWhere }));
const mockSelect = jest.fn(() => ({ from: mockFrom }));
const mockIdentity = jest.fn();
const mockEq = jest.fn((column, value) => ({ column, value }));

jest.mock('@/lib/db', () => ({ db: { select: mockSelect } }));
jest.mock('@/lib/auth-resolve-key', () => ({ resolveCallerIdentity: mockIdentity }));
jest.mock('@/lib/db/schema', () => ({
  operations: {
    id: 'id', apiKeyId: 'apiKeyId', createdByUserId: 'createdByUserId', done: 'done', state: 'state', endpointSlug: 'endpointSlug', currentStep: 'currentStep',
    progressPercent: 'progressPercent', progressMessage: 'progressMessage', errorCode: 'errorCode',
    errorMessage: 'errorMessage', failedAtStep: 'failedAtStep', totalInputTokens: 'totalInputTokens',
    totalOutputTokens: 'totalOutputTokens', totalCostUsd: 'totalCostUsd', createdAt: 'createdAt',
    updatedAt: 'updatedAt', deletedAt: 'deletedAt', filesJson: 'filesJson', pipelineJson: 'pipelineJson',
  },
}));
jest.mock('drizzle-orm', () => ({
  eq: mockEq,
  isNull: (column: string) => ({ isNull: column }),
  ilike: (column: string, value: string) => ({ ilike: [column, value] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (column: string) => ({ desc: column }),
  lt: (column: string, value: unknown) => ({ lt: [column, value] }),
}));

import { GET } from '@/app/api/v1/operations/route';

function request(path: string): any {
  return { nextUrl: new URL(`http://localhost${path}`) };
}

const operation = {
  id: 'op-1', done: false, state: 'RUNNING', endpointSlug: 'workflows:financial-report-translation',
  currentStep: 1, progressPercent: 25, progressMessage: 'Extracting', errorCode: null, errorMessage: null,
  failedAtStep: null, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0,
  createdAt: new Date('2026-08-17T08:00:00.000Z'), updatedAt: new Date('2026-08-17T08:01:00.000Z'),
  filesJson: JSON.stringify([{ name: 's3://private/op-1/report.pdf', path: 'private/op-1/report.pdf', url: 'https://secret.example/report.pdf?token=secret' }]),
};

describe('GET /api/v1/operations scoped financial-report history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdentity.mockResolvedValue({ apiKeyId: null, userId: 'user-1', userRole: 'ADMIN' });
    mockLimit.mockResolvedValue([operation]);
  });

  it('rejects a scope=mine request without a session identity', async () => {
    mockIdentity.mockResolvedValue({ apiKeyId: 'key-1', userId: null, userRole: null });
    const response = await GET(request('/api/v1/operations?scope=mine'));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('session') });
  });

  it('rejects unsupported scopes instead of silently widening a list', async () => {
    const response = await GET(request('/api/v1/operations?scope=all'));
    expect(response.status).toBe(400);
  });

  it('forces createdByUserId ownership for scope=mine even for an ADMIN and applies an exact endpoint slug', async () => {
    const response = await GET(request('/api/v1/operations?scope=mine&endpoint_slug=workflows%3Afinancial-report-translation'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockEq).toHaveBeenCalledWith('createdByUserId', 'user-1');
    expect(mockEq).toHaveBeenCalledWith('endpointSlug', 'workflows:financial-report-translation');
    expect(body.operations[0]).toMatchObject({
      name: 'operations/op-1',
      input_files: ['report.pdf'],
      metadata: { endpoint_slug: 'workflows:financial-report-translation' },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('private/op-1');
    expect(serialized).not.toContain('secret.example');
    expect(serialized).not.toContain('apiKeyId');
    expect(serialized).not.toContain('filesJson');
  });

  it('keeps API-key list behavior scoped to the key when scope=mine is not requested', async () => {
    mockIdentity.mockResolvedValue({ apiKeyId: 'key-1', userId: null, userRole: null });
    const response = await GET(request('/api/v1/operations'));
    expect(response.status).toBe(200);
    expect(mockEq).toHaveBeenCalledWith('apiKeyId', 'key-1');
  });
});
