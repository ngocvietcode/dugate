/**
 * Unit test for tracing-portal workflow.
 * Mocks enqueueSubStep to simulate AI connector responses,
 * then verifies the workflow produces the correct webhook payload shape.
 */

import { runTracingPortal } from '@/lib/pipelines/workflows/tracing-portal';
import type { WorkflowContext } from '@/lib/pipelines/workflow-engine';

// ─── Mock workflow-engine functions ───────────────────────────────────────────

const mockEnqueueSubStep = jest.fn();
const mockUpdateProgress = jest.fn();
const mockCompleteWorkflow = jest.fn();
const mockFailWorkflow = jest.fn();

jest.mock('@/lib/pipelines/workflow-engine', () => ({
  ...jest.requireActual('@/lib/pipelines/workflow-engine'),
  enqueueSubStep: (...args: unknown[]) => mockEnqueueSubStep(...args),
  updateProgress: (...args: unknown[]) => mockUpdateProgress(...args),
  completeWorkflow: (...args: unknown[]) => mockCompleteWorkflow(...args),
  failWorkflow: (...args: unknown[]) => mockFailWorkflow(...args),
  parseDeep: jest.requireActual('@/lib/pipelines/workflow-engine').parseDeep,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockCtx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    operationId: 'test-op-001',
    correlationId: 'test-corr-001',
    job: undefined,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
    filesJson: null,
    filesData: [],
    pipelineVars: {},
    stepsResult: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    usageBreakdown: [],
    webhookUrl: 'https://example.com/callback',
    apiKeyId: 'key-001',
    createdByUserId: 'user-001',
    promptOverrides: {},
    modelOverrides: {},
    reasoningEffortOverrides: {},
    currentStep: 0,
    endpointSlug: 'workflows:tracing-portal',
    ...overrides,
  };
}

const MOCK_CDM_RESPONSE = JSON.stringify({
  loai_tai_lieu: 'BIÊN BẢN KIỂM QUỸ MÁY CDM',
  don_vi_tiep_quy: 'VPBank Nam Định',
  ma_may: 'A1158005',
  loai_may: 'CDM',
  ngay_bat_dau_chu_ky: '02/03/2026',
  ngay_kiem_quy: '03/03/2026',
  so_tien_chenh_lech: '5410000',
});

const MOCK_ATM_RESPONSE = JSON.stringify({
  loai_tai_lieu: 'BIÊN BẢN KIỂM QUỸ TIỀN MẶT TẠI MÁY ATM',
  don_vi_tiep_quy: 'BỘ PHẬN KQTT SÀI GÒN',
  ma_may: 'A0102005',
  loai_may: 'ATM',
  ngay_bat_dau_chu_ky: '11/03/2026',
  ngay_kiem_quy: '13/03/2026',
  so_tien_chenh_lech: '1000000',
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('tracing-portal workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fail when no files provided', async () => {
    const ctx = createMockCtx({ filesData: [] });

    await runTracingPortal(ctx);

    expect(mockFailWorkflow).toHaveBeenCalledTimes(1);
    expect(mockFailWorkflow.mock.calls[0][1]).toBeInstanceOf(Error);
    expect((mockFailWorkflow.mock.calls[0][1] as Error).message).toContain('INVALID_INPUT');
    expect(mockCompleteWorkflow).not.toHaveBeenCalled();
  });

  it('should process 2 files and call completeWorkflow with correct payload', async () => {
    const ctx = createMockCtx({
      filesData: [
        { name: 'BBKQ_CDM.pdf', path: '/tmp/cdm.pdf', mime: 'application/pdf', size: 1024, file_id: 'DOC-001' },
        { name: 'BBKQ_ATM.pdf', path: '/tmp/atm.pdf', mime: 'application/pdf', size: 2048, file_id: 'DOC-002' },
      ],
    });

    // Mock AI responses per file
    mockEnqueueSubStep
      .mockResolvedValueOnce({
        operation: { id: 'sub-op-cdm' },
        content: MOCK_CDM_RESPONSE,
        extractedData: null,
      })
      .mockResolvedValueOnce({
        operation: { id: 'sub-op-atm' },
        content: MOCK_ATM_RESPONSE,
        extractedData: null,
      });

    await runTracingPortal(ctx);

    // Should NOT have failed
    expect(mockFailWorkflow).not.toHaveBeenCalled();

    // Should have called completeWorkflow
    expect(mockCompleteWorkflow).toHaveBeenCalledTimes(1);

    const [, outputContent, extractedData] = mockCompleteWorkflow.mock.calls[0];

    // outputContent is null (no raw text output for workflows)
    expect(outputContent).toBeNull();

    // Verify extracted_data shape (this is what goes into webhook payload)
    expect(extractedData).toMatchObject({
      request_id: 'test-op-001',
      skill_code: 'tracing-portal',
      status: 'SUCCESS',
      tong_so_tai_lieu: 2,
    });

    expect(extractedData.danh_sach_tai_lieu).toHaveLength(2);

    // CDM file
    expect(extractedData.danh_sach_tai_lieu[0]).toMatchObject({
      file_id: 'DOC-001',
      file_name: 'BBKQ_CDM.pdf',
      status: 'success',
    });
    expect(extractedData.danh_sach_tai_lieu[0].extracted_data).toMatchObject({
      loai_tai_lieu: 'BIÊN BẢN KIỂM QUỸ MÁY CDM',
      ma_may: 'A1158005',
      loai_may: 'CDM',
      so_tien_chenh_lech: '5410000',
    });

    // ATM file
    expect(extractedData.danh_sach_tai_lieu[1]).toMatchObject({
      file_id: 'DOC-002',
      file_name: 'BBKQ_ATM.pdf',
      status: 'success',
    });
    expect(extractedData.danh_sach_tai_lieu[1].extracted_data).toMatchObject({
      loai_tai_lieu: 'BIÊN BẢN KIỂM QUỸ TIỀN MẶT TẠI MÁY ATM',
      ma_may: 'A0102005',
      loai_may: 'ATM',
      so_tien_chenh_lech: '1000000',
    });
  });

  it('should handle partial failure (1 success, 1 error)', async () => {
    const ctx = createMockCtx({
      filesData: [
        { name: 'BBKQ_CDM.pdf', path: '/tmp/cdm.pdf', mime: 'application/pdf', size: 1024, file_id: 'DOC-001' },
        { name: 'BBKQ_ATM.pdf', path: '/tmp/atm.pdf', mime: 'application/pdf', size: 2048, file_id: 'DOC-002' },
      ],
    });

    mockEnqueueSubStep
      .mockResolvedValueOnce({
        operation: { id: 'sub-op-cdm' },
        content: MOCK_CDM_RESPONSE,
        extractedData: null,
      })
      .mockRejectedValueOnce(new Error('Sub-step ext-data-extractor timed out after 330s'));

    await runTracingPortal(ctx);

    expect(mockFailWorkflow).not.toHaveBeenCalled();
    expect(mockCompleteWorkflow).toHaveBeenCalledTimes(1);

    const [, , extractedData] = mockCompleteWorkflow.mock.calls[0];

    expect(extractedData.status).toBe('PARTIAL');
    expect(extractedData.tong_so_tai_lieu).toBe(2);
    expect(extractedData.danh_sach_tai_lieu[0].status).toBe('success');
    expect(extractedData.danh_sach_tai_lieu[1].status).toBe('error');
    expect(extractedData.danh_sach_tai_lieu[1].error).toContain('timed out');
    expect(extractedData.danh_sach_tai_lieu[1].extracted_data).toBeNull();
  });

  it('should pass prompt override to enqueueSubStep', async () => {
    const ctx = createMockCtx({
      filesData: [
        { name: 'test.pdf', path: '/tmp/test.pdf', mime: 'application/pdf', size: 512 },
      ],
      promptOverrides: { extract: 'Custom prompt override content' },
    });

    mockEnqueueSubStep.mockResolvedValueOnce({
      operation: { id: 'sub-op-test' },
      content: MOCK_CDM_RESPONSE,
      extractedData: null,
    });

    await runTracingPortal(ctx);

    expect(mockEnqueueSubStep).toHaveBeenCalledTimes(1);
    const [, , variables] = mockEnqueueSubStep.mock.calls[0];
    expect(variables._prompt).toBe('Custom prompt override content');
  });

  it('should use file_id=null when not provided', async () => {
    const ctx = createMockCtx({
      filesData: [
        { name: 'no-id.pdf', path: '/tmp/no-id.pdf', mime: 'application/pdf', size: 512 },
      ],
    });

    mockEnqueueSubStep.mockResolvedValueOnce({
      operation: { id: 'sub-op-noid' },
      content: MOCK_CDM_RESPONSE,
      extractedData: null,
    });

    await runTracingPortal(ctx);

    const [, , extractedData] = mockCompleteWorkflow.mock.calls[0];
    expect(extractedData.danh_sach_tai_lieu[0].file_id).toBeNull();
  });
});
