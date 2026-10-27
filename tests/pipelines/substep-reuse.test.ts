/**
 * D-102 (ARCHITECTURE E3): sub-step có reuseKey dùng lại kết quả đã SUCCEEDED của CÙNG operation cha khi retry / resume,
 * cộng usage đúng một lần, nhả khoá của row không dùng được; không có reuseKey thì giữ hành vi cũ.
 */
const rowsByKey = new Map<string, Record<string, unknown>>();
const updateWhereMock = jest.fn().mockResolvedValue(undefined);
const updateSetMock = jest.fn(() => ({ where: updateWhereMock }));
let lastEqValue: unknown;

jest.mock('@/lib/db', () => ({
  db: {
    update: jest.fn(() => ({ set: updateSetMock })),
    select: jest.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => (rowsByKey.has(lastEqValue as string) ? [rowsByKey.get(lastEqValue as string)] : []) }) }),
    })),
  },
}));
jest.mock('@/lib/db/schema', () => ({
  operations: { id: 'operations.id', state: 'operations.state', idempotencyKey: 'operations.idempotencyKey' },
  apiKeys: { id: 'apiKeys.id', totalUsed: 'apiKeys.totalUsed' },
  profileEndpoints: {},
}));
jest.mock('drizzle-orm', () => ({
  eq: jest.fn((_col: unknown, value: unknown) => { lastEqValue = value; return 'eq-clause'; }),
  and: jest.fn(() => 'and-clause'),
  sql: jest.fn(() => 'sql-clause'),
}));
const insertOperationMock = jest.fn(async () => { throw new Error('STOP_AFTER_INSERT'); });
jest.mock('@/lib/operations/state-transition', () => ({
  ...jest.requireActual('@/lib/operations/state-transition'),
  insertOperation: (...args: unknown[]) => insertOperationMock(...(args as [])),
}));

import { enqueueSubStep, subStepIdempotencyKey, type WorkflowContext } from '@/lib/pipelines/workflow-engine';

function context(): WorkflowContext {
  return {
    operationId: 'op-parent', logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    totalInputTokens: 100, totalOutputTokens: 10, totalCost: 0.5, usageBreakdown: [],
  } as unknown as WorkflowContext;
}

function succeededRow(id: string, key: string) {
  return {
    id, idempotencyKey: key, done: true, state: 'SUCCEEDED', contentPurgedAt: null, outputContent: '{"ok":true}', extractedData: null,
    totalInputTokens: 40, totalOutputTokens: 4, totalCostUsd: 0.02, inputTokensMissing: false, outputTokensMissing: false,
    costMissing: false, hasUnpricedCost: false,
    usageBreakdown: JSON.stringify([{ processor: 'llm', model: 'm1', input_tokens: 40, output_tokens: 4, cost_usd: 0.02 }]),
  };
}

beforeEach(() => {
  rowsByKey.clear();
  jest.clearAllMocks();
});

describe('subStepIdempotencyKey', () => {
  it('tất định, gắn với operation cha, không chứa nội dung prompt', () => {
    const k = subStepIdempotencyKey('op-parent', 'ext-classifier', 'PROMPT BÍ MẬT');
    expect(k).toBe(subStepIdempotencyKey('op-parent', 'ext-classifier', 'PROMPT BÍ MẬT'));
    expect(k).toMatch(/^wfstep:op-parent:[0-9a-f]{64}$/);
    expect(k).not.toContain('BÍ MẬT');
    expect(subStepIdempotencyKey('op-other', 'ext-classifier', 'PROMPT BÍ MẬT')).not.toBe(k);
    expect(subStepIdempotencyKey('op-parent', 'ext-data-extractor', 'PROMPT BÍ MẬT')).not.toBe(k);
  });
});

describe('enqueueSubStep với reuseKey', () => {
  it('đã có sub-step SUCCEEDED cùng khoá → dùng lại output, không tạo sub-operation mới, cộng usage một lần', async () => {
    const ctx = context();
    const key = subStepIdempotencyKey(ctx.operationId, 'ext-classifier', 'k1');
    rowsByKey.set(key, succeededRow('sub-1', key));

    const r1 = await enqueueSubStep(ctx, 'ext-classifier', { _prompt: 'p' }, null, null, null, undefined, { reuseKey: 'k1' });
    const r2 = await enqueueSubStep(ctx, 'ext-classifier', { _prompt: 'p' }, null, null, null, undefined, { reuseKey: 'k1' });

    expect(r1.content).toBe('{"ok":true}');
    expect(r2.operation.id).toBe('sub-1');
    expect(insertOperationMock).not.toHaveBeenCalled();
    expect(ctx.totalInputTokens).toBe(140);
    expect(ctx.totalCost).toBeCloseTo(0.52);
    expect(ctx.usageBreakdown).toHaveLength(1);
  });

  it('gọi trùng song song cùng khoá → một lần tra cứu, cùng một kết quả', async () => {
    const ctx = context();
    const key = subStepIdempotencyKey(ctx.operationId, 'ext-data-extractor', 'k2');
    rowsByKey.set(key, succeededRow('sub-2', key));
    const [a, b] = await Promise.all([
      enqueueSubStep(ctx, 'ext-data-extractor', {}, null, null, null, undefined, { reuseKey: 'k2' }),
      enqueueSubStep(ctx, 'ext-data-extractor', {}, null, null, null, undefined, { reuseKey: 'k2' }),
    ]);
    expect(a).toBe(b);
    expect(ctx.totalInputTokens).toBe(140);
  });

  it.each([
    ['FAILED', { done: true, state: 'FAILED' }],
    ['còn RUNNING từ lần chạy bị gián đoạn', { done: false, state: 'RUNNING' }],
    ['đã xoá nội dung', { contentPurgedAt: new Date() }],
  ])('row cùng khoá %s → nhả khoá, chạy mới với khoá đó', async (_label, patch) => {
    const ctx = context();
    const key = subStepIdempotencyKey(ctx.operationId, 'ext-classifier', 'k3');
    rowsByKey.set(key, { ...succeededRow('sub-old', key), ...patch });

    await expect(enqueueSubStep(ctx, 'ext-classifier', {}, null, null, null, undefined, { reuseKey: 'k3' })).rejects.toThrow('STOP_AFTER_INSERT');
    expect(updateSetMock).toHaveBeenCalledWith({ idempotencyKey: null });
    expect(insertOperationMock).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: key, state: 'RUNNING' }));
    expect(ctx.totalInputTokens).toBe(100);
  });

  it('không có reuseKey → không tra cứu, tạo sub-operation không khoá (hành vi cũ)', async () => {
    const ctx = context();
    await expect(enqueueSubStep(ctx, 'ext-classifier', {}, null)).rejects.toThrow('STOP_AFTER_INSERT');
    expect(insertOperationMock).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: null }));
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
