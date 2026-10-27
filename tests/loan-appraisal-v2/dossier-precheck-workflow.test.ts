// T-V2-13 — kiểm tra sơ bộ bằng LLM ngay sau S1, nối vào stage 0 (V2-R16, V2-R20; D-73, D-74).
const enqueueMock = jest.fn();
const pauseMock = jest.fn();
const updateProgressMock = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return {
    ...actual,
    enqueueSubStep: (...args: unknown[]) => enqueueMock(...args),
    pauseWorkflow: (...args: unknown[]) => pauseMock(...args),
    updateProgress: (...args: unknown[]) => updateProgressMock(...args),
    updateWorkflowProgressDetails: jest.fn().mockResolvedValue(undefined),
    completeWorkflow: jest.fn().mockResolvedValue(undefined),
    failWorkflow: jest.fn().mockResolvedValue(undefined),
    assertNotCancelled: jest.fn().mockResolvedValue(undefined),
  };
});

import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';
import { isDossierPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

const PRECHECK_MARKER = 'kiểm tra SƠ BỘ bộ hồ sơ vay';

function context(vars: Record<string, unknown>, opts: { withPrecheck?: unknown } = {}) {
  const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
  const evs = [loanApp([borrower]), ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })];
  const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {}, ...(opts.withPrecheck ? { precheck: opts.withPrecheck } : {}) };
  const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
  const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
  return {
    operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)] as unknown[], currentStep: 2,
    totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { flow: 'FULL', dossier_submitted_at: '2026-10-14', ...vars },
    promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
    filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
    webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

const isPrecheckCall = (c: unknown[]) => String((c[2] as { _prompt?: string })._prompt).includes(PRECHECK_MARKER);
const precheckCalls = () => enqueueMock.mock.calls.filter(isPrecheckCall);

/** LLM giả: mọi mục REQUIRED bị bỏ sót → code tự thêm UNCERTAIN; chỉ cần overview hợp lệ. */
const ANSWER = { checklist: [], relations: [{ topic: 'Người vay', status: 'CONSISTENT', doc_refs: ['D01', 'D02'], message: 'Cùng người vay.' }], overview: 'Hồ sơ vay của NGUYỄN VĂN AN.', next_actions: ['Bổ sung chứng từ còn thiếu'] };

function routeLlm(answer: unknown = ANSWER) {
  enqueueMock.mockImplementation(async (_ctx: unknown, _proc: string, vars: { _prompt?: string }) => {
    const p = String(vars?._prompt ?? '');
    if (p.includes(PRECHECK_MARKER)) return { content: typeof answer === 'string' ? answer : JSON.stringify(answer), operation: { id: 'sub-precheck' } };
    return { content: '{}', operation: { id: 'sub-1' } };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
});

describe('T-V2-13: kiểm tra sơ bộ sau S1', () => {
  it('giai đoạn 1: gọi LLM đúng 1 lần; checkpoint bước 0 có precheck; output tạm dừng có dossier_precheck', async () => {
    routeLlm();
    const ctx = context({ stop_after_intake: 'true' });
    await runLoanAppraisal(ctx as never);
    expect((failWorkflow as jest.Mock).mock.calls).toEqual([]);
    expect(precheckCalls()).toHaveLength(1);
    const step0 = ctx.stepsResult.find((s) => (s as { stage_key: string }).stage_key === 'classify') as { extracted_data: { precheck?: unknown } };
    expect(isDossierPrecheck(step0.extracted_data.precheck)).toBe(true);
    const out = pauseMock.mock.calls[0][3];
    expect(out.dossier_precheck).toMatchObject({ status: 'COMPLETED', source: 'LLM', draft: true, flow: 'FULL', overview: ANSWER.overview });
    expect(out.dossier_precheck.relations).toHaveLength(1);
    expect(out.dossier_precheck.by_status.UNCERTAIN).toBeGreaterThan(0); // mục REQUIRED bị bỏ sót → UNCERTAIN
    expect(out.dossier_precheck.overall).toBe('GAPS_FOUND');
    expect(out).not.toHaveProperty('intake_assessment'); // giai đoạn 1 chỉ có kiểm tra sơ bộ
  });

  it('LLM kiểm tra sơ bộ chạy trước S2/S5 và trước điểm dừng; tiến độ ghi ngay sau S1', async () => {
    routeLlm();
    await runLoanAppraisal(context({ stop_after_intake: 'true' }) as never);
    const messages = updateProgressMock.mock.calls.map((c) => String(c[2]));
    const idx = messages.findIndex((m) => m.includes('kiểm tra sơ bộ'));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(messages.some((m) => m.includes('Kiểm tra sơ bộ xong'))).toBe(true);
  });

  it('resume sau OCR (currentStep = 2) không gọi lại; kết quả cuối vẫn mang dossier_precheck', async () => {
    routeLlm();
    const ctx = context({ stop_after_intake: 'true' });
    await runLoanAppraisal(ctx as never);
    await runLoanAppraisal({ ...ctx, currentStep: 2 } as never);
    expect(precheckCalls()).toHaveLength(1);
    const final = (completeWorkflow as jest.Mock).mock.calls[0][2];
    expect(final.dossier_precheck).toMatchObject({ status: 'COMPLETED' });
  });

  it('checkpoint đã có precheck → không gọi lại ngay cả khi chạy từ bước 2', async () => {
    routeLlm();
    const first = context({ stop_after_intake: 'true' });
    await runLoanAppraisal(first as never);
    const saved = (first.stepsResult[0] as { extracted_data: { precheck: unknown } }).extracted_data.precheck;
    enqueueMock.mockClear();
    await runLoanAppraisal(context({ stop_after_intake: 'true' }, { withPrecheck: saved }) as never);
    expect(precheckCalls()).toHaveLength(0);
  });

  it('currentStep ≤ 2 mà checkpoint thiếu precheck → chạy bù (kết quả cũ trước D-73)', async () => {
    routeLlm();
    await runLoanAppraisal(context({ stop_after_intake: 'true' }) as never);
    expect(precheckCalls()).toHaveLength(1);
  });

  it('dossier_precheck = false → không gọi LLM, status SKIPPED, workflow vẫn tạm dừng bình thường', async () => {
    routeLlm();
    await runLoanAppraisal(context({ stop_after_intake: 'true', dossier_precheck: 'false' }) as never);
    expect(precheckCalls()).toHaveLength(0);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(pauseMock.mock.calls[0][3].dossier_precheck).toMatchObject({ status: 'SKIPPED', overall: null });
  });

  it('LLM lỗi → UNAVAILABLE, không báo đủ hồ sơ, workflow vẫn tới điểm dừng', async () => {
    enqueueMock.mockImplementation(async (_c: unknown, _p: string, vars: { _prompt?: string }) => {
      if (String(vars?._prompt ?? '').includes(PRECHECK_MARKER)) throw new Error('model timeout');
      return { content: '{}', operation: { id: 'sub-1' } };
    });
    await runLoanAppraisal(context({ stop_after_intake: 'true' }) as never);
    expect((failWorkflow as jest.Mock).mock.calls).toEqual([]);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(pauseMock.mock.calls[0][3].dossier_precheck).toMatchObject({ status: 'UNAVAILABLE', overall: null, checklist: [] });
  });

  it('phản hồi sai định dạng → UNAVAILABLE', async () => {
    routeLlm('không phải JSON');
    await runLoanAppraisal(context({ stop_after_intake: 'true' }) as never);
    expect(pauseMock.mock.calls[0][3].dossier_precheck.status).toBe('UNAVAILABLE');
  });

  it('prompt ghi đè dossier_precheck và model riêng được dùng', async () => {
    routeLlm();
    // Cấu hình theo sản phẩm (loan_product_config), không còn theo Profile.
    const ctx = context({
      stop_after_intake: 'true',
      loan_product_config: { products: { 'hkd-loan': {
        prompts: { dossier_precheck: `Bạn là trợ lý ${PRECHECK_MARKER} kiểu khác. {{checklist}} {{documents}} {{output_schema}}` },
        models: { dossier_precheck: 'model-rieng' }, reasoning: { dossier_precheck: 'low' },
      } } },
    });
    await runLoanAppraisal(ctx as never);
    const call = precheckCalls()[0];
    expect(String((call[2] as { _prompt: string })._prompt)).toContain('kiểu khác');
    expect(call).toContain('model-rieng');
    expect(call).toContain('low');
    expect(pauseMock.mock.calls[0][3].dossier_precheck.prompt_overridden).toBe(true);
  });

  it('chạy hết 5 stage một lần (stop_after_intake = false): output cuối có dossier_precheck', async () => {
    routeLlm();
    await runLoanAppraisal(context({ stop_after_intake: 'false' }) as never);
    expect(pauseMock).not.toHaveBeenCalled();
    expect((completeWorkflow as jest.Mock).mock.calls[0][2].dossier_precheck).toMatchObject({ status: 'COMPLETED' });
  });

  it('prompt gửi LLM không chứa tên file và không chứa OCR của S2', async () => {
    routeLlm();
    await runLoanAppraisal(context({ stop_after_intake: 'true' }) as never);
    const prompt = String((precheckCalls()[0][2] as { _prompt: string })._prompt);
    expect(prompt).not.toMatch(/\.pdf/);
    expect(prompt).not.toContain(ID_A12);
  });
});
