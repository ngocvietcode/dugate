/**
 * Billing policy: every operation charges the AI cost it already incurred into apiKeys.totalUsed
 * exactly once, whether it ends SUCCEEDED or FAILED (see .agents/tasks/h4-failed-billing-plan.md).
 */
const mockTransition = jest.fn().mockResolvedValue({});
const mockWarn = jest.fn();
const mockError = jest.fn();
const mockRunProcessor = jest.fn();
const mockSendProfileCallback = jest.fn().mockResolvedValue(undefined);
const selectQueue: unknown[][] = [];
const updateSetMock = jest.fn();
let apiKeyUpdateImpl: () => Promise<unknown> = async () => undefined;

jest.mock('@/lib/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: () => ({
        where: () => {
          const rows = selectQueue.shift() ?? [];
          return {
            limit: async () => rows,
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(rows).then(resolve, reject),
          };
        },
      }),
    })),
    update: jest.fn(() => ({
      set: (arg: Record<string, unknown>) => {
        updateSetMock(arg);
        return { where: async () => ('totalUsed' in arg ? apiKeyUpdateImpl() : undefined) };
      },
    })),
  },
}));
jest.mock('@/lib/db/schema', () => ({
  operations: { id: 'operations.id' },
  apiKeys: { id: 'apiKeys.id', totalUsed: 'apiKeys.totalUsed' },
  externalApiConnections: { slug: 'c.slug' },
  externalApiOverrides: {},
}));
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'eq'),
  inArray: jest.fn(),
  and: jest.fn(),
  // Keep the interpolated amount so tests can read the charged delta.
  sql: jest.fn((_strings: unknown, ...vals: unknown[]) => ({ amount: vals[1] })),
}));
jest.mock('@/lib/operations/state-transition', () => ({
  transitionOperationState: mockTransition,
}));
jest.mock('@/lib/pipelines/processors/external-api', () => ({
  runExternalApiProcessor: mockRunProcessor,
}));
jest.mock('@/lib/delivery/webhook-sender', () => ({
  resolveCallbackDeliveryConfig: jest.fn().mockResolvedValue({ active: true }),
  sendProfileCallback: mockSendProfileCallback,
}));
jest.mock('@/lib/storage', () => ({
  getStorageBackend: jest.fn().mockResolvedValue({ downloadToTempFile: jest.fn() }),
}));
jest.mock('@/lib/storage/local-backend', () => ({ LocalStorageBackend: class {} }));
jest.mock('@/lib/logger', () => ({
  Logger: class {
    error = mockError;
    warn = mockWarn;
    info = jest.fn();
  },
}));

import { runPipeline } from '@/lib/pipelines/engine';

function step(cost: number | null, costSource: string = 'provider') {
  return {
    content: 'out',
    inputTokens: 1,
    outputTokens: 1,
    pagesProcessed: 1,
    modelUsed: 'm',
    costUsd: cost,
    costSource,
  };
}

function seedRun(opts: {
  steps: number;
  apiKeyId?: string | null;
  currentStep?: number;
  stepsResultJson?: string | null;
}) {
  const slugs = Array.from({ length: opts.steps }, (_, i) => `conn-${i}`);
  const operation = {
    id: 'op-1',
    apiKeyId: opts.apiKeyId === undefined ? 'k1' : opts.apiKeyId,
    endpointSlug: 'extract:test',
    pipelineJson: JSON.stringify(slugs.map((processor) => ({ processor }))),
    filesJson: null,
    webhookUrl: 'https://example.test/hook',
    outputFormat: 'json',
    currentStep: opts.currentStep ?? 0,
    stepsResultJson: opts.stepsResultJson ?? null,
  };
  selectQueue.push([operation]);
  selectQueue.push(slugs.map((slug, i) => ({ id: `id-${i}`, slug, state: 'ENABLED' })));
  selectQueue.push([]); // overrides
}

function charges(): number[] {
  return updateSetMock.mock.calls
    .map(([arg]) => arg as Record<string, unknown>)
    .filter((arg) => 'totalUsed' in arg)
    .map((arg) => (arg.totalUsed as { amount: number }).amount);
}
const total = () => charges().reduce((a, b) => a + b, 0);
const states = () => mockTransition.mock.calls.map(([arg]) => (arg as { state: string }).state);

describe('runPipeline billing', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    jest.clearAllMocks();
    mockRunProcessor.mockReset();
    apiKeyUpdateImpl = async () => undefined;
  });

  it('C2 control: SUCCEEDED charges the summed cost once', async () => {
    seedRun({ steps: 2 });
    mockRunProcessor.mockResolvedValueOnce(step(0.25)).mockResolvedValueOnce(step(0.75));
    await runPipeline('op-1');
    expect(states()).toEqual(['SUCCEEDED']);
    expect(charges()).toEqual([1]);
    expect(mockTransition.mock.calls[0][0].changes.totalCostUsd).toBe(1);
    expect(mockSendProfileCallback).toHaveBeenCalledTimes(1);
  });

  it('F1 FAILED after a costed step charges that known cost exactly once', async () => {
    seedRun({ steps: 2 });
    mockRunProcessor.mockResolvedValueOnce(step(0.4)).mockRejectedValueOnce(new Error('boom'));
    await runPipeline('op-1');
    expect(states()).toEqual(['FAILED']);
    expect(mockTransition.mock.calls[0][0].changes.totalCostUsd).toBe(0.4);
    expect(charges()).toEqual([0.4]);
    expect(mockSendProfileCallback).toHaveBeenCalledTimes(1);
    expect(mockSendProfileCallback.mock.calls[0][0].payloadInput.state).toBe('FAILED');
  });

  it('F2 FAILED with no known cost charges nothing', async () => {
    seedRun({ steps: 1 });
    mockRunProcessor.mockRejectedValueOnce(new Error('boom'));
    await runPipeline('op-1');
    expect(states()).toEqual(['FAILED']);
    expect(charges()).toEqual([]);
  });

  it('F3 missing/unpriced steps add nothing; only the known portion is charged', async () => {
    seedRun({ steps: 4 });
    mockRunProcessor
      .mockResolvedValueOnce(step(null, 'none'))
      .mockResolvedValueOnce(step(0, 'unpriced'))
      .mockResolvedValueOnce(step(0.2))
      .mockRejectedValueOnce(new Error('boom'));
    await runPipeline('op-1');
    const changes = mockTransition.mock.calls[0][0].changes;
    expect(changes.costMissing).toBe(true);
    expect(changes.hasUnpricedCost).toBe(true);
    expect(charges()).toEqual([0.2]);
    expect(mockWarn.mock.calls.some(([m]) => String(m).includes('[BILLING]'))).toBe(true);
  });

  it('F3b only unknown/unpriced cost => no charge', async () => {
    seedRun({ steps: 3 });
    mockRunProcessor
      .mockResolvedValueOnce(step(null, 'none'))
      .mockResolvedValueOnce(step(0, 'unpriced'))
      .mockRejectedValueOnce(new Error('boom'));
    await runPipeline('op-1');
    expect(charges()).toEqual([]);
  });

  it('F4 exception after the SUCCEEDED transition does not charge the same cost twice', async () => {
    seedRun({ steps: 1 });
    mockRunProcessor.mockResolvedValueOnce(step(0.3));
    mockSendProfileCallback.mockRejectedValueOnce(new Error('webhook down'));
    await runPipeline('op-1');
    expect(states()).toEqual(['SUCCEEDED', 'FAILED']);
    expect(total()).toBeCloseTo(0.3, 10);
  });

  it('F5 attempts: each attempt charges only its own spend', async () => {
    seedRun({ steps: 2 });
    mockRunProcessor.mockResolvedValueOnce(step(0.4)).mockRejectedValueOnce(new Error('boom'));
    await runPipeline('op-1');
    seedRun({
      steps: 2,
      currentStep: 1,
      stepsResultJson: JSON.stringify([{ step: 0, processor: 'conn-0', output_format: 'json', content_preview: 'out' }]),
    });
    mockRunProcessor.mockResolvedValueOnce(step(0.1));
    await runPipeline('op-1');
    expect(charges()).toEqual([0.4, 0.1]);
    expect(mockRunProcessor).toHaveBeenCalledTimes(3);
  });

  it('F6 a billing DB error in the FAILED path is isolated', async () => {
    seedRun({ steps: 2 });
    mockRunProcessor.mockResolvedValueOnce(step(0.4)).mockRejectedValueOnce(new Error('boom'));
    apiKeyUpdateImpl = async () => { throw new Error('db down'); };
    await expect(runPipeline('op-1')).resolves.toBeUndefined();
    expect(states()).toEqual(['FAILED']);
    expect(mockSendProfileCallback).toHaveBeenCalledTimes(1);
    expect(mockError.mock.calls.some(([m]) => String(m).includes('[BILLING]'))).toBe(true);
  });

  it('F7 no apiKeyId => never charges', async () => {
    seedRun({ steps: 2, apiKeyId: null });
    mockRunProcessor.mockResolvedValueOnce(step(0.4)).mockRejectedValueOnce(new Error('boom'));
    await runPipeline('op-1');
    expect(states()).toEqual(['FAILED']);
    expect(charges()).toEqual([]);
  });
});
