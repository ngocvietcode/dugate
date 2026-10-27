// Giai đoạn 2 — GET /api/internal/operations/[id] is metadata-only.
// Ops still sees what a request carried and how it ran (parameter names, files,
// steps, sub-steps, connectors, states, tokens, cost, errors) but no customer
// values, prompts, extracted data, output or signed URL queries. The one
// exception is the waiting step's data while WAITING_USER_INPUT.

import { NextRequest } from 'next/server';
import { createQueryRecorder, opsSession, toSqlText } from '../operations-visibility/helpers';

const mockRecorder = createQueryRecorder();
const mockRequireCapability = jest.fn();
const mockGetAssignedProfileIds = jest.fn();

jest.mock('@/lib/db', () => ({
  get db() { return mockRecorder.db; },
}));
jest.mock('@/lib/auth-guard', () => ({
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
  getAssignedProfileIds: (...args: unknown[]) => mockGetAssignedProfileIds(...args),
}));

import { GET } from '@/app/api/internal/operations/[id]/route';
import { sha256Hex } from '@/lib/operations/content-retention';

const CUSTOMER = 'TRAN THI B — STK 9876543210';
const PROMPT = `Đối chiếu hồ sơ của ${CUSTOMER}`;
const CREATED = new Date('2026-09-17T01:00:00.000Z');

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'parent-1',
    done: true,
    state: 'SUCCEEDED',
    endpointSlug: 'workflows:loan-appraisal',
    progressPercent: 100,
    progressMessage: 'Done',
    progressLogJson: JSON.stringify([{ t: CREATED.toISOString(), percent: 100, message: 'Done' }]),
    currentStep: 1,
    errorCode: null,
    errorMessage: null,
    failedAtStep: null,
    totalInputTokens: 120,
    totalOutputTokens: 30,
    totalCostUsd: 0.25,
    apiKeyId: 'profile-1',
    profileName: 'Loan',
    correlationId: 'corr-1',
    createdAt: CREATED,
    updatedAt: new Date('2026-09-17T01:05:00.000Z'),
    completedAt: new Date('2026-09-17T01:04:00.000Z'),
    idempotencyKey: 'idem-1',
    pipelineJson: JSON.stringify([{
      processor: 'workflows:loan-appraisal',
      variables: {
        customer_name: CUSTOMER,
        cif: '123456',
        _original_file_urls: [{ url: 'https://files.example/hs.pdf?X-Amz-Signature=SECRET', filename: 'hs.pdf' }],
      },
    }]),
    stepsResultJson: JSON.stringify([
      {
        step: 0, stepName: 'Phân loại', processor: 'ext-classifier', sub_operation_id: 'child-after-resume',
        content_preview: CUSTOMER, extracted_data: { name: CUSTOMER },
      },
      { step: 1, stepName: 'Đánh giá', processor: 'loan-rule-engine', sub_results: [{ a: 1 }, { b: 2 }], extracted_data: { cif: CUSTOMER } },
    ]),
    extractedData: JSON.stringify({ decision: 'APPROVED', customer: CUSTOMER }),
    outputFormat: 'json',
    filesJson: JSON.stringify([{
      name: 'hs.pdf', mime: 'application/pdf', size: 2048, isRemoteUrl: true,
      url: 'https://files.example/hs.pdf?X-Amz-Signature=SECRET', path: '/tmp/hs.pdf',
    }]),
    usageBreakdown: JSON.stringify([{ processor: 'ext-classifier', model: 'gpt-5', input_tokens: 120, output_tokens: 30, cost_usd: 0.25 }]),
    webhookUrl: 'https://callback.example/hook?token=SECRET',
    webhookSentAt: null,
    webhookAttempts: 1,
    webhookLastError: null,
    pagesProcessed: 3,
    modelUsed: null,
    filesDeleted: false,
    deletedAt: null,
    hiddenFromOperations: false,
    contentPurgedAt: null,
    ...overrides,
  };
}

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'child-1',
    endpointSlug: 'ext-classifier',
    pipelineJson: JSON.stringify([{ processor: 'ext-classifier', variables: { _prompt: PROMPT, _model: 'gpt-5', _reasoning_effort: 'low' } }]),
    filesJson: JSON.stringify([{ name: 'hs.pdf' }]),
    state: 'SUCCEEDED',
    done: true,
    createdAt: new Date('2026-09-17T01:01:00.000Z'),
    updatedAt: new Date('2026-09-17T01:01:05.000Z'),
    completedAt: new Date('2026-09-17T01:01:04.000Z'),
    totalInputTokens: 100,
    totalOutputTokens: 20,
    totalCostUsd: 0.2,
    errorCode: null,
    errorMessage: null,
    contentPurgedAt: null,
    correlationId: 'corr-1',
    ...overrides,
  };
}

async function get(id = 'parent-1') {
  const response = await GET(new NextRequest(`http://localhost/api/internal/operations/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { response, body: await response.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorder.reset();
  mockRequireCapability.mockResolvedValue(opsSession('ops-1', 'OPS'));
  mockGetAssignedProfileIds.mockResolvedValue(['profile-1']);
});

describe('metadata-only Operations detail', () => {
  it('returns how the request ran without any customer value', async () => {
    mockRecorder.enqueueResult([detailRow()]);
    mockRecorder.enqueueResult([
      subRow(),
      subRow({
        id: 'child-2', endpointSlug: 'ext-fact-verifier', state: 'FAILED', errorCode: 'CONNECTOR_ERROR',
        errorMessage: 'timeout', createdAt: new Date('2026-09-17T01:02:00.000Z'),
        pipelineJson: JSON.stringify([{ variables: { _prompt: '[purged]', _prompt_length: 42, _prompt_sha256: 'abc' } }]),
        contentPurgedAt: new Date('2026-09-17T02:00:00.000Z'),
      }),
      // Sub-step created after a resume (new correlationId) but named by the parent.
      subRow({ id: 'child-after-resume', correlationId: 'corr-2', createdAt: new Date('2026-09-17T01:03:00.000Z') }),
      // Same client correlationId reused by an OLDER request: not part of this run.
      subRow({ id: 'foreign', createdAt: new Date('2026-09-16T00:00:00.000Z') }),
      subRow({ id: 'parent-1', endpointSlug: 'workflows:loan-appraisal' }),
    ]);

    const { response, body } = await get();
    expect(response.status).toBe(200);
    const text = JSON.stringify(body);
    expect(text).not.toContain(CUSTOMER);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('123456');
    expect(text).not.toContain(PROMPT);
    expect(body).not.toHaveProperty('extractedData');
    expect(body).not.toHaveProperty('outputContent');
    expect(body).not.toHaveProperty('subStepPrompts');

    expect(body.pipelineJson).toEqual([{ processor: 'workflows:loan-appraisal', parameterNames: ['cif', 'customer_name'] }]);
    expect(body.originalFileUrls).toEqual([{ filename: 'hs.pdf', mime_type: null, url: 'https://files.example/hs.pdf' }]);
    expect(body.filesJson).toEqual([{ name: 'hs.pdf', mime: 'application/pdf', size: 2048, isRemoteUrl: true, url: 'https://files.example/hs.pdf' }]);
    expect(body.webhookUrl).toBe('https://callback.example/hook');
    expect(body.stepsResultJson).toEqual([
      { step: 0, stepName: 'Phân loại', processor: 'ext-classifier', sub_operation_id: 'child-after-resume' },
      { step: 1, stepName: 'Đánh giá', processor: 'loan-rule-engine', sub_result_count: 2 },
    ]);
    expect(body.waitingInput).toBeNull();
    expect(body).toMatchObject({ totalInputTokens: 120, totalCostUsd: 0.25, pagesProcessed: 3, contentPurgedAt: null });

    expect(body.subSteps.map((s: { id: string }) => s.id)).toEqual(['child-1', 'child-2', 'child-after-resume']);
    expect(body.subSteps[0]).toEqual({
      id: 'child-1',
      processor: 'ext-classifier',
      model: 'gpt-5',
      reasoningEffort: 'low',
      fileName: 'hs.pdf',
      state: 'SUCCEEDED',
      createdAt: '2026-09-17T01:01:00.000Z',
      completedAt: '2026-09-17T01:01:04.000Z',
      durationMs: 4000,
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.2,
      errorCode: null,
      errorMessage: null,
      promptLength: PROMPT.length,
      promptSha256: sha256Hex(PROMPT),
      contentPurged: false,
    });
    expect(body.subSteps[1]).toMatchObject({
      state: 'FAILED', errorCode: 'CONNECTOR_ERROR', errorMessage: 'timeout',
      promptLength: 42, promptSha256: 'abc', contentPurged: true,
    });

    // Sub-steps are found by correlationId OR by the IDs the parent recorded.
    const subQuery = toSqlText(mockRecorder.whereArgs[1]);
    expect(subQuery).toMatch(/"correlationId" = \$1 or "Operation"\."id" in \(\$2\)/);
  });

  it('returns the waiting step data only while WAITING_USER_INPUT', async () => {
    mockRecorder.enqueueResult([detailRow({
      state: 'WAITING_USER_INPUT',
      done: false,
      currentStep: 0,
      endpointSlug: 'extract:invoice',
      stepsResultJson: JSON.stringify([{ step: 0, processor: 'ext-data-extractor', extracted_data: { name: CUSTOMER } }]),
    })]);

    const { body } = await get();
    expect(body.waitingInput).toEqual({ step: 0, extracted_data: { name: CUSTOMER } });
    expect(body.stepsResultJson).toEqual([{ step: 0, processor: 'ext-data-extractor' }]);
  });

  it('exposes the purge timestamp so the page can say the content has expired', async () => {
    mockRecorder.enqueueResult([detailRow({
      endpointSlug: 'extract:invoice',
      extractedData: null,
      contentPurgedAt: new Date('2026-09-24T01:00:00.000Z'),
    })]);
    const { body } = await get();
    expect(body.contentPurgedAt).toBe('2026-09-24T01:00:00.000Z');
    expect(body.subSteps).toEqual([]);
  });

  it('summarises a financial-report result with statuses and counters only', async () => {
    const envelope = {
      requestId: 'req-1', code: 207, message: 'Partial', timestamp: 'now', targetLang: 'vi',
      data: [{
        fileId: 'f1', fileName: 'bctc.pdf', status: 'PARTIAL_SUCCESS',
        errorCode: 'TRANSLATION_FAILED', errorMessage: 'Dịch lỗi', diagnostic: 'timeout',
        processingInfo: {
          totalPages: 10, extractChunksTotal: 4, extractChunksFailed: 1, classifyWindowsTotal: 2, classifyWindowsFailed: 0,
          failedPageRanges: [{ from: 3, to: 4 }], translationStatus: 'PARTIAL', untranslatedItems: 2,
          failureReasons: ['extract trang 3-4: timeout'],
          classifyLocations: [{ titleSource: CUSTOMER }],
        },
        report: {
          generalInformation: { companyName: CUSTOMER },
          balanceSheet: { status: 'FOUND', title: CUSTOMER, warnings: [{ code: 'LOW_CONFIDENCE', message: CUSTOMER }], tables: [{ rows: [CUSTOMER] }] },
        },
      }],
    };
    mockRecorder.enqueueResult([detailRow({
      endpointSlug: 'extract:financial-report',
      extractedData: JSON.stringify(envelope),
    })]);

    const { body } = await get();
    expect(JSON.stringify(body)).not.toContain(CUSTOMER);
    expect(body.resultSummary.data[0]).toMatchObject({
      fileName: 'bctc.pdf',
      status: 'PARTIAL_SUCCESS',
      errorCode: 'TRANSLATION_FAILED',
      processingInfo: { totalPages: 10, failedPageRanges: [{ from: 3, to: 4 }], failureReasons: ['extract trang 3-4: timeout'] },
      report: { balanceSheet: { status: 'FOUND', warnings: [{ code: 'LOW_CONFIDENCE', message: '' }] } },
    });
  });
});
