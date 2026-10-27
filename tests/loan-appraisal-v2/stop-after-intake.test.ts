// D-51 — dừng sau giai đoạn 1 (stop_after_intake) và chạy tiếp giai đoạn 2 bằng resume.
// D-81: các test dưới đây kiểm tra ĐƯỜNG CŨ (S3–S5 chạy ở giai đoạn 1) nên mặc định truyền `intake_run_consolidate = true`;
// đường mới (S3–S5 ở giai đoạn 2) xem phase1-lean.test.ts.
const enqueueMock = jest.fn();
const pauseMock = jest.fn();
jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return {
    ...actual,
    enqueueSubStep: (...args: unknown[]) => enqueueMock(...args),
    pauseWorkflow: (...args: unknown[]) => pauseMock(...args),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    updateWorkflowProgressDetails: jest.fn().mockResolvedValue(undefined),
    completeWorkflow: jest.fn().mockResolvedValue(undefined),
    failWorkflow: jest.fn().mockResolvedValue(undefined),
    assertNotCancelled: jest.fn().mockResolvedValue(undefined),
  };
});

import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';
import { applyOperation } from '@/app/loan-appraisal-v2/lib/operation-mapper';
import { initialRunState, runReducer, type RunState } from '@/app/loan-appraisal-v2/lib/run-reducer';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

/** usinessLines: 2 chứng từ ghi ngành nghề khác nhau → có 1 cặp cần so ngữ nghĩa (D-57). */
function context(vars: Record<string, unknown>, businessLines?: [string, string]) {
  const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
  const evs = [
    loanApp([borrower], businessLines ? { data: { business_info: { business_line: businessLines[0], business_address: null } } } : {}),
    ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] }),
    ...(businessLines ? [ev('purchase_list', { parties: [{ ...borrower, party_role: 'CUSTOMER' }], data: { business_info: { business_line: businessLines[1], business_address: null } } })] : []),
  ];
  const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
  const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
  const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
  return {
    operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)] as unknown[], currentStep: 2,
    totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { flow: 'FULL', dossier_submitted_at: '2026-10-14', intake_run_consolidate: 'true', ...vars },
    promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
    filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
    webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
});

describe('workflow', () => {
  it('stop_after_intake = true → dừng ngay sau giai đoạn 1 (classify + kiểm tra sơ bộ) ở bước 1; không OCR, không tài chính, không rule', async () => {
    const ctx = context({ stop_after_intake: 'true' });
    ctx.stepsResult = ctx.stepsResult.slice(0, 1);
    ctx.currentStep = 1;
    await runLoanAppraisal(ctx as never);
    expect((failWorkflow as jest.Mock).mock.calls).toEqual([]);
    expect(completeWorkflow).not.toHaveBeenCalled();
    expect(pauseMock).toHaveBeenCalledTimes(1);
    const [, , step, data] = pauseMock.mock.calls[0];
    expect(step).toBe(1);
    expect(data).toMatchObject({ result_phase: 'DOSSIER_INTAKE', output_version: '3.0' });
    expect(data).not.toHaveProperty('financial_metrics');
    expect(data).not.toHaveProperty('intake_assessment');
    expect(ctx.stepsResult.map((s) => (s as { step: number }).step)).toEqual([0]);
  });

  it('resume sau giai đoạn 1 (currentStep = 1): chạy OCR → tài chính → rule → khuyến nghị, không dừng lại, hoàn tất; không có bước kiểm tra hồ sơ', async () => {
    const ctx = context({ stop_after_intake: 'true' });
    ctx.stepsResult = ctx.stepsResult.slice(0, 1);
    ctx.currentStep = 1;
    await runLoanAppraisal(ctx as never);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    // Resume: S2 do dossierPorts thật sẽ chạy; thay bằng checkpoint đã có để kiểm tra phần còn lại của giai đoạn 2.
    const resumed = context({ stop_after_intake: 'true' });
    resumed.stepsResult = [...resumed.stepsResult.slice(0, 1).map((s) => ({ ...(s as object), extracted_data: { ...((s as { extracted_data: object }).extracted_data), intake_phase1: { version: '1.0' } } })), resumed.stepsResult[1]];
    resumed.currentStep = 2;
    await runLoanAppraisal(resumed as never);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(completeWorkflow).toHaveBeenCalledTimes(1);
    const final = (completeWorkflow as jest.Mock).mock.calls[0][2];
    expect(final.financial_metrics).toBeDefined();
    expect(final.result_phase).toBeUndefined();
    expect(resumed.stepsResult.map((s) => (s as { stage_key: string }).stage_key)).toEqual(['classify', 'extract_evidence', 'calculate_financials', 'evaluate_policy_compliance', 'synthesize_recommendation']);
  });

  it('không truyền stop_after_intake → mặc định dừng sau giai đoạn 1 (D-53)', async () => {
    const ctx = context({});
    ctx.stepsResult = ctx.stepsResult.slice(0, 1);
    ctx.currentStep = 1;
    await runLoanAppraisal(ctx as never);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(completeWorkflow).not.toHaveBeenCalled();
  });

  it.each([false, 'false', '0', 'no'])('stop_after_intake = %p → chạy hết 5 stage một lần', async (value) => {
    await runLoanAppraisal(context({ stop_after_intake: value }) as never);
    expect(pauseMock).not.toHaveBeenCalled();
    expect(completeWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe('API và giao diện', () => {
  const op = (state: string, extractedData: unknown) => ({
    id: 'op-1', done: false, state, pipelineJson: '[]', stepsResultJson: '[]', currentStep: 3, progressPercent: 55, progressMessage: 'Đã xong giai đoạn 1',
    progressLogJson: '[]', createdAt: null, updatedAt: null, completedAt: null, webhookSentAt: null, extractedData: JSON.stringify(extractedData),
  });

  it('GET operation WAITING_USER_INPUT trả result.extracted_data; snapshot tiến độ thì không', () => {
    expect(formatOperationResponse(op('WAITING_USER_INPUT', { result_phase: 'DOSSIER_INTAKE' }) as never).result).toEqual({ extracted_data: { result_phase: 'DOSSIER_INTAKE' } });
    expect(formatOperationResponse(op('WAITING_USER_INPUT', { progress_details: {} }) as never).result).toBeUndefined();
    expect(formatOperationResponse(op('RUNNING', { result_phase: 'DOSSIER_INTAKE' }) as never).result).toBeUndefined();
  });

  it('mapper → PAUSED; reducer: running → paused → resuming → running', () => {
    const body = { done: false, metadata: { state: 'WAITING_USER_INPUT', current_step: 3, progress_message: 'Đã xong giai đoạn 1' }, result: { extracted_data: { result_phase: 'DOSSIER_INTAKE' } } };
    const { actions, outcome } = applyOperation(body, new Set());
    expect(outcome).toBe('paused');
    let s: RunState = { ...initialRunState(), phase: 'running', operationId: 'op-1' };
    for (const a of actions) s = runReducer(s, a);
    expect(s.phase).toBe('paused');
    expect(s.result?.result_phase).toBe('DOSSIER_INTAKE');
    expect([s.stages.classify, s.stages.dossier_precheck, s.stages.extract_evidence]).toEqual(['done', 'done', 'pending']);
    s = runReducer(s, { type: 'RESUME_START' });
    expect(s.phase).toBe('resuming');
    expect(runReducer(s, { type: 'RESUME_FAILED', message: 'x' }).phase).toBe('paused');
    expect(runReducer(s, { type: 'RESUMED' }).phase).toBe('running');
  });
});

// D-57 (so ngữ nghĩa LLM) và D-59 (tổng kết LLM của kiểm tra nháp) không còn là bước của workflow: giai đoạn 2 tạm tắt các bước kiểm tra hồ sơ.
// Test xác nhận không có lời gọi LLM nào ngoài rule nằm ở v2-stage-consolidate.test.ts; logic thuần của chúng vẫn có test riêng (intake-*, cross-check).
describe('các bước kiểm tra hồ sơ không còn trong workflow', () => {
  it('chạy hết một lần: không có lời gọi LLM so ngữ nghĩa, kiểm tra nháp hay tổng kết', async () => {
    enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
    await runLoanAppraisal(context({ stop_after_intake: false }, ['Bán gạo', 'Bán điện thoại']) as never);
    const prompts = enqueueMock.mock.calls.map((c) => String((c[2] as { _prompt?: string })._prompt));
    for (const marker of ['Hai giá trị sau', 'kiểm tra NHÁP bộ hồ sơ vay', 'TỔNG KẾT TÓM TẮT bộ hồ sơ vay']) expect(prompts.some((p) => p.includes(marker))).toBe(false);
    expect(completeWorkflow).toHaveBeenCalledTimes(1);
  });
});

