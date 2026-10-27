// B1/B2: operator actions on customer Operation data leave an audit trail.
// B3:    the internal detail API no longer ships engine prompts to the browser.
// B4:    the legacy /api/operations/[id] GET is a status-only view.

import { NextRequest } from 'next/server';
import { createQueryRecorder, opsSession } from './helpers';

const mockRecorder = createQueryRecorder();
const mockRequireCapability = jest.fn();
const mockGetAssignedProfileIds = jest.fn();
const mockWriteAudit = jest.fn();
const mockTransition = jest.fn();
const mockQueueAdd = jest.fn();

jest.mock('@/lib/db', () => ({
  get db() { return mockRecorder.db; },
}));
jest.mock('@/lib/auth-guard', () => ({
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
  requireAdmin: (...args: unknown[]) => mockRequireCapability(...args),
  getAssignedProfileIds: (...args: unknown[]) => mockGetAssignedProfileIds(...args),
}));
jest.mock('@/lib/audit/write', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));
jest.mock('@/lib/operations/state-transition', () => ({
  transitionOperationState: (...args: unknown[]) => mockTransition(...args),
  updateOperationMembership: jest.fn(),
}));
jest.mock('@/lib/queue/worker-group-router', () => {
  const route = { queue: { add: (...args: unknown[]) => mockQueueAdd(...args) }, queueName: 'pipeline' };
  return { resolveTargetQueue: async () => route, selectWorkflowQueue: async () => route };
});
jest.mock('@/lib/ops/config', () => ({
  getExportMaxDays: async () => 31,
}));

const CUSTOMER_TEXT = 'NGUYEN VAN A — STK 0123456789';

function exportRow(id: string, apiKeyId: string | null) {
  return {
    id,
    state: 'SUCCEEDED',
    endpointSlug: 'extract:invoice',
    outputContent: CUSTOMER_TEXT,
    outputFormat: 'json',
    extractedData: JSON.stringify({ name: CUSTOMER_TEXT }),
    stepsResultJson: '[]',
    totalInputTokens: 1,
    totalOutputTokens: 1,
    totalCostUsd: 0,
    pagesProcessed: 1,
    modelUsed: null,
    apiKeyId,
    profileName: 'Profile',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:01.000Z'),
    completedAt: new Date('2026-10-01T00:00:01.000Z'),
  };
}

function operationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    apiKeyId: 'profile-1',
    createdByUserId: 'ops-1',
    endpointSlug: 'workflows:loan-appraisal',
    state: 'RUNNING',
    done: false,
    deletedAt: null,
    hiddenFromOperations: false,
    stepsResultJson: null,
    ...overrides,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function lastAudit() {
  expect(mockWriteAudit).toHaveBeenCalledTimes(1);
  const entry = mockWriteAudit.mock.calls[0][0] as Record<string, unknown>;
  return { entry, detail: JSON.parse(String(entry.detail)) as Record<string, unknown> };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorder.reset();
  mockRequireCapability.mockResolvedValue(opsSession('ops-1', 'OPS'));
  mockGetAssignedProfileIds.mockResolvedValue(['profile-1']);
  mockTransition.mockResolvedValue({});
  mockQueueAdd.mockResolvedValue(undefined);
});

describe('B1 — export audit', () => {
  // Giai đoạn 2: JSON / HTML exports (full customer results) were removed.
  it.each([
    ['json', '@/app/api/internal/operations/export-json/route'],
    ['html', '@/app/api/internal/operations/export-html/route'],
  ])('%s export is gone (410) and reads nothing', async (format, modulePath) => {
    mockRecorder.enqueueResult([exportRow('op-a', 'profile-1')]);
    const { POST } = await import(modulePath);

    const response = await POST(post(
      `/api/internal/operations/export-${format}`,
      { operationIds: ['op-a'] },
    ));

    expect(response.status).toBe(410);
    expect(JSON.stringify(await response.json())).not.toContain(CUSTOMER_TEXT);
    expect(mockRecorder.db.select).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('CSV export records the selection that defines the file', async () => {
    mockRecorder.enqueueResult([]);
    const { GET } = await import('@/app/api/internal/operations/export-csv/route');
    const response = await GET(new NextRequest(
      'http://localhost/api/internal/operations/export-csv?state=FAILED&q=CASE-42'
      + '&start_date=2026-10-01T00:00:00.000Z&end_date=2026-10-02T00:00:00.000Z',
    ));
    expect(response.status).toBe(200);
    const { entry, detail } = lastAudit();
    expect(entry).toMatchObject({ entityType: 'OPERATION', action: 'EXPORT', actorUserId: 'ops-1' });
    expect(detail).toMatchObject({
      format: 'csv',
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-10-02T00:00:00.000Z',
      filters: { state: 'FAILED', endpoint: null, profile: null, q: 'CASE-42' },
    });
  });
});

describe('B2 — resume and cancel audit', () => {
  it('records a human edit on resume without copying the edited values', async () => {
    mockRecorder.enqueueResult([operationRow({
      state: 'WAITING_USER_INPUT',
      stepsResultJson: JSON.stringify([{ step: 0, extracted_data: { name: 'old' } }]),
    })]);
    mockRecorder.enqueueResult([]); // ProfileEndpoint priority lookup
    const { POST } = await import('@/app/api/internal/operations/[id]/resume/route');

    const response = await POST(
      post('/api/internal/operations/op-1/resume', { step: 0, extracted_data: { name: CUSTOMER_TEXT } }),
      { params: Promise.resolve({ id: 'op-1' }) },
    );

    expect(response.status).toBe(200);
    const { entry, detail } = lastAudit();
    expect(entry).toMatchObject({
      entityType: 'OPERATION',
      action: 'RESUME',
      entityId: 'op-1',
      actorUserId: 'ops-1',
    });
    expect(detail).toEqual({ humanEdited: true, step: 0, apiKeyId: 'profile-1' });
    expect(JSON.stringify(entry)).not.toContain(CUSTOMER_TEXT);
  });

  it('records a plain resume as not edited', async () => {
    mockRecorder.enqueueResult([operationRow({ state: 'WAITING_USER_INPUT', stepsResultJson: '[]' })]);
    mockRecorder.enqueueResult([]);
    const { POST } = await import('@/app/api/internal/operations/[id]/resume/route');
    const response = await POST(post('/api/internal/operations/op-1/resume', {}), {
      params: Promise.resolve({ id: 'op-1' }),
    });
    expect(response.status).toBe(200);
    expect(lastAudit().detail).toMatchObject({ humanEdited: false, step: null });
  });

  it('records a cancel', async () => {
    mockRecorder.enqueueResult([operationRow()]);
    const { POST } = await import('@/app/api/internal/operations/[id]/cancel/route');
    const response = await POST(post('/api/internal/operations/op-1/cancel', {}), {
      params: Promise.resolve({ id: 'op-1' }),
    });
    expect(response.status).toBe(200);
    const { entry, detail } = lastAudit();
    expect(entry).toMatchObject({ entityType: 'OPERATION', action: 'CANCEL', entityId: 'op-1' });
    expect(detail).toEqual({ previousState: 'RUNNING', apiKeyId: 'profile-1' });
  });

  it.each([
    ['cancel', '@/app/api/internal/operations/[id]/cancel/route', operationRow({ hiddenFromOperations: true })],
    ['resume', '@/app/api/internal/operations/[id]/resume/route',
      operationRow({ hiddenFromOperations: true, state: 'WAITING_USER_INPUT' })],
  ])('%s refuses a hidden workflow sub-step with 404 and writes nothing', async (action, modulePath, row) => {
    mockGetAssignedProfileIds.mockResolvedValue(null); // even a global-scope operator
    mockRecorder.enqueueResult([row]);
    const { POST } = await import(modulePath);
    const response = await POST(post(`/api/internal/operations/op-1/${action}`, {}), {
      params: Promise.resolve({ id: 'op-1' }),
    });
    expect(response.status).toBe(404);
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});

describe('B3 — internal detail API omits engine-internal step variables', () => {
  it('strips _prompt/_model/_reasoning_effort but keeps _original_file_urls and business params', async () => {
    mockRecorder.enqueueResult([{
      id: 'op-1',
      done: true,
      state: 'SUCCEEDED',
      endpointSlug: 'extract:invoice',
      progressPercent: 100,
      progressMessage: null,
      progressLogJson: null,
      currentStep: 0,
      errorCode: null,
      errorMessage: null,
      failedAtStep: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      apiKeyId: 'profile-1',
      profileName: 'Profile',
      correlationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      idempotencyKey: null,
      pipelineJson: JSON.stringify([{
        processor: 'ext-data-extractor',
        variables: {
          fields: 'name,amount',
          _prompt: `Extract from: ${CUSTOMER_TEXT}`,
          _model: 'gpt-x',
          _reasoning_effort: 'high',
          _original_file_urls: [{ url: 'https://files.example/doc.pdf', filename: 'doc.pdf' }],
        },
      }]),
      stepsResultJson: '[]',
      extractedData: null,
      outputFormat: 'json',
      outputContent: null,
      filesJson: '[]',
      usageBreakdown: '[]',
      webhookUrl: null,
      webhookSentAt: null,
      webhookAttempts: null,
      webhookLastError: null,
      pagesProcessed: 0,
      modelUsed: null,
      filesDeleted: false,
      deletedAt: null,
      hiddenFromOperations: false,
    }]);
    const { GET } = await import('@/app/api/internal/operations/[id]/route');

    const response = await GET(new NextRequest('http://localhost/api/internal/operations/op-1'), {
      params: Promise.resolve({ id: 'op-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    // Giai đoạn 2: parameter NAMES only; engine-internal `_*` variables are not parameters.
    expect(body.pipelineJson).toEqual([{ processor: 'ext-data-extractor', parameterNames: ['fields'] }]);
    expect(body.originalFileUrls).toEqual([
      { url: 'https://files.example/doc.pdf', filename: 'doc.pdf', mime_type: null },
    ]);
    expect(JSON.stringify(body)).not.toContain(CUSTOMER_TEXT);
    expect(JSON.stringify(body)).not.toContain('name,amount');
  });
});

describe('B4 — legacy GET /api/operations/[id] is status-only', () => {
  const fullRow = {
    id: 'op-1',
    apiKeyId: 'profile-1',
    done: true,
    state: 'SUCCEEDED',
    pipelineJson: JSON.stringify([{ processor: 'ext-data-extractor' }]),
    currentStep: 0,
    progressPercent: 100,
    progressMessage: null,
    progressLogJson: null,
    stepsResultJson: JSON.stringify([{
      step: 0,
      processor: 'ext-data-extractor',
      content_preview: CUSTOMER_TEXT,
      extracted_data: { name: CUSTOMER_TEXT },
    }]),
    extractedData: JSON.stringify({ name: CUSTOMER_TEXT }),
    outputFormat: 'json',
    outputContent: CUSTOMER_TEXT,
    totalInputTokens: 10,
    totalOutputTokens: 5,
    pagesProcessed: 1,
    modelUsed: 'gpt-x',
    totalCostUsd: 0.5,
    usageBreakdown: '[]',
    errorCode: null,
    errorMessage: null,
    failedAtStep: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
    webhookSentAt: null,
    deletedAt: null,
    hiddenFromOperations: false,
  };

  async function get() {
    const { GET } = await import('@/app/api/operations/[id]/route');
    return GET(new NextRequest('http://localhost/api/operations/op-1'), {
      params: Promise.resolve({ id: 'op-1' }),
    });
  }

  it('returns state and usage but no customer content', async () => {
    mockRecorder.enqueueResult([fullRow]);
    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.done).toBe(true);
    expect(body.metadata.state).toBe('SUCCEEDED');
    expect(body.result.usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
    expect(body.result.content).toBeUndefined();
    expect(body.result.extracted_data).toBeUndefined();
    expect(body.metadata.pipeline_steps[0]).toEqual({ step: 0, processor: 'ext-data-extractor' });
    expect(JSON.stringify(body)).not.toContain(CUSTOMER_TEXT);
  });

  it('returns 404 for a hidden workflow sub-step', async () => {
    mockRecorder.enqueueResult([{ ...fullRow, hiddenFromOperations: true }]);
    const response = await get();
    expect(response.status).toBe(404);
  });
});
