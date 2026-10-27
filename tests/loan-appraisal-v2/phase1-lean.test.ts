// T-V2-16 — giai đoạn 1 tinh gọn: S3–S5 tắt ở giai đoạn 1, chuyển sang giai đoạn 2; intake_review + dossier_summary
// dùng kết quả kiểm tra sơ bộ (V2-R21…R23; D-81…D-84).
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
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';
import { skippedPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

const PRECHECK = 'kiểm tra SƠ BỘ bộ hồ sơ vay';
const REVIEW = 'kiểm tra NHÁP bộ hồ sơ vay';
const SUMMARY = 'TỔNG KẾT TÓM TẮT bộ hồ sơ vay';
const SEMANTIC = 'Hai giá trị sau';

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
    totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { flow: 'FULL', dossier_submitted_at: '2026-10-14', stop_after_intake: 'true', ...vars },
    promptOverrides: {} as Record<string, string>, modelOverrides: {}, reasoningEffortOverrides: {},
    filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
    webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

const PRECHECK_ANSWER = {
  checklist: [], overview: 'Hồ sơ vay của NGUYỄN VĂN AN còn thiếu giấy tờ.', next_actions: ['Bổ sung giấy tờ còn thiếu'],
  relations: [{ topic: 'Số tiền vay', status: 'INCONSISTENT', doc_refs: ['D01', 'D02'], message: 'Hai chứng từ ghi số tiền khác nhau.' }],
};
const REVIEW_ANSWER = { criteria: [{ key: 'DOCUMENTS_COMPLETE', status: 'FAIL', summary: 'Hồ sơ còn thiếu chứng từ.', findings: [] }] };
const SUMMARY_ANSWER = { overview: 'Hồ sơ vay của NGUYỄN VĂN AN.', highlights: ['Có giấy đề nghị vay'], next_actions: ['Bổ sung chứng từ'] };

const prompts = () => enqueueMock.mock.calls.map((c) => String((c[2] as { _prompt?: string })._prompt));
const calls = (marker: string) => enqueueMock.mock.calls.filter((c) => String((c[2] as { _prompt?: string })._prompt).includes(marker));
const stage = (ctx: { stepsResult: unknown[] }, key: string) => ctx.stepsResult.find((s) => (s as { stage_key?: string }).stage_key === key) as { extracted_data: Record<string, unknown> } | undefined;

function routeLlm(over: { precheck?: unknown; review?: unknown; summary?: unknown; semantic?: unknown } = {}) {
  enqueueMock.mockImplementation(async (_c: unknown, _p: string, vars: { _prompt?: string }) => {
    const p = String(vars?._prompt ?? '');
    const body = p.includes(PRECHECK) ? over.precheck ?? PRECHECK_ANSWER
      : p.includes(REVIEW) ? over.review ?? REVIEW_ANSWER
      : p.includes(SUMMARY) ? over.summary ?? SUMMARY_ANSWER
      : p.startsWith(SEMANTIC) ? over.semantic ?? { label: 'SAME' }
      : {};
    return { content: JSON.stringify(body), operation: { id: 'sub-1' } };
  });
}

beforeEach(() => { jest.clearAllMocks(); routeLlm(); });

/** Giai đoạn 1 chạy từ checkpoint classify (S1 đã xong); S2 và các stage sau thuộc giai đoạn 2. */
function phase1(vars: Record<string, unknown> = {}, businessLines?: [string, string]) {
  const ctx = context(vars, businessLines);
  ctx.stepsResult = ctx.stepsResult.slice(0, 1);
  ctx.currentStep = 1;
  return ctx;
}

describe('giai đoạn 1 tinh gọn (mặc định)', () => {
  it('dừng sau kiểm tra sơ bộ ở bước 1: không OCR, không kiểm tra nháp / tổng kết, không S3–S5, không master; khối kiểm tra hoãn sang giai đoạn 2', async () => {
    const ctx = phase1({}, ['Bán gạo', 'Kinh doanh gạo']);
    await runLoanAppraisal(ctx as never);
    expect((failWorkflow as jest.Mock).mock.calls).toEqual([]);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(pauseMock.mock.calls[0][2]).toBe(1);
    expect(stage(ctx, 'consolidate_dossier')).toBeUndefined();
    expect(calls(SEMANTIC)).toHaveLength(0);
    expect(calls(REVIEW)).toHaveLength(0);
    expect(calls(SUMMARY)).toHaveLength(0);
    const out = pauseMock.mock.calls[0][3];
    expect(out).toMatchObject({ result_phase: 'DOSSIER_INTAKE', output_version: '3.0', customer_360: null, master_dossier: null, completeness_percent: 0 });
    expect(out.checklist).toMatchObject({ status: 'NOT_RUN', status_code: 'DEFERRED_TO_PHASE_2', items: [] });
    expect(out.cross_check).toMatchObject({ status: 'NOT_RUN', status_code: 'DEFERRED_TO_PHASE_2', results: [] });
    expect(out.documents.evidences).toHaveLength(0);
    expect(out.dossier_precheck).toMatchObject({ status: 'COMPLETED' });
    expect(out).not.toHaveProperty('intake_assessment');
    expect(out.evidence).toBeDefined();
    expect(out.system_notes[0]).toContain('giai đoạn 2');
  });

  it('chỉ một lời gọi LLM ở giai đoạn 1: kiểm tra sơ bộ', async () => {
    await runLoanAppraisal(phase1() as never);
    const order = prompts().map((p) => (p.includes(PRECHECK) ? 'precheck' : p.includes(REVIEW) ? 'review' : p.includes(SUMMARY) ? 'summary' : 'other'));
    expect(order).toEqual(['precheck']);
  });

  it('kiểm tra sơ bộ UNAVAILABLE → workflow vẫn tới điểm dừng, không đổ stage', async () => {
    enqueueMock.mockImplementation(async (_c: unknown, _p: string, vars: { _prompt?: string }) => {
      if (String(vars?._prompt ?? '').includes(PRECHECK)) throw new Error('model timeout');
      return { content: '{}', operation: { id: 'sub-1' } };
    });
    await runLoanAppraisal(phase1() as never);
    expect((failWorkflow as jest.Mock).mock.calls).toEqual([]);
    expect(pauseMock.mock.calls[0][3].dossier_precheck.status).toBe('UNAVAILABLE');
    expect(pauseMock.mock.calls[0][3].dossier_readiness.status).toBe('NEEDS_VERIFICATION');
  });
});

describe('giai đoạn 2 (sau resume): chỉ OCR → tài chính → rule → khuyến nghị', () => {
  /** Mô phỏng resume: S2 đã có checkpoint, marker intake_phase1 đã đặt ở giai đoạn 1. */
  function resumed(vars: Record<string, unknown> = {}, businessLines?: [string, string]) {
    const ctx = context({ ...vars, stop_after_intake: 'true' }, businessLines);
    const classify = ctx.stepsResult[0] as { extracted_data: Record<string, unknown> };
    // Giai đoạn 1 đã lưu kiểm tra sơ bộ vào checkpoint nên resume không gọi lại.
    classify.extracted_data = { ...classify.extracted_data, intake_phase1: { version: '1.0' }, precheck: { ...skippedPrecheck('đã chạy ở giai đoạn 1'), status: 'COMPLETED' } };
    ctx.currentStep = 2;
    return ctx;
  }

  it('không gọi S4–S5, master, kiểm tra nháp, tổng kết (S3 chạy thuần, không stage riêng); chỉ rule LLM; ra đúng 5 stage liên tục', async () => {
    routeLlm({ semantic: { label: 'DIFFERENT' } });
    const ctx = resumed({}, ['Bán gạo', 'Bán điện thoại']);
    await runLoanAppraisal(ctx as never);
    expect((failWorkflow as jest.Mock).mock.calls).toEqual([]);
    expect(pauseMock).not.toHaveBeenCalled();
    for (const marker of [SEMANTIC, REVIEW, SUMMARY, PRECHECK]) expect(calls(marker)).toHaveLength(0);
    expect(ctx.stepsResult.map((s) => (s as { stage_key: string }).stage_key)).toEqual(['classify', 'extract_evidence', 'calculate_financials', 'evaluate_policy_compliance', 'synthesize_recommendation']);
    expect(stage(ctx, 'consolidate_dossier')).toBeUndefined();
    const final = (completeWorkflow as jest.Mock).mock.calls[0][2];
    expect(final.customer_360).toMatchObject({ role_registry: [expect.objectContaining({ person_id: 'person-1', roles: ['borrower'] })] });
    expect(final.checklist).toMatchObject({ status_code: 'DOSSIER_CHECKS_DISABLED', items: [] });
    expect(final).not.toHaveProperty('master_dossier');
    expect(final.result_phase).toBeUndefined();
    expect(final.dossier_precheck).toMatchObject({ status: 'COMPLETED' });
    expect(final.documents.evidences.length).toBeGreaterThan(0);
  });

  it('chạy hết một lần (stop_after_intake = false): không pause, cùng 5 stage, không bước kiểm tra hồ sơ', async () => {
    const ctx = context({ stop_after_intake: 'false' });
    await runLoanAppraisal(ctx as never);
    expect(pauseMock).not.toHaveBeenCalled();
    expect(stage(ctx, 'consolidate_dossier')).toBeUndefined();
    const final = (completeWorkflow as jest.Mock).mock.calls[0][2];
    expect(final.customer_360).not.toBeNull();
    expect(final).not.toHaveProperty('intake_assessment');
  });
});

describe('tương thích operation cũ có checkpoint consolidate_dossier', () => {
  /** Operation cũ dừng ở bước 3 với checkpoint consolidate_dossier ở chỉ số 2 (đánh số cũ). */
  function legacy() {
    const ctx = context({ stop_after_intake: 'true' });
    const classify = ctx.stepsResult[0] as { extracted_data: Record<string, unknown> };
    classify.extracted_data = { ...classify.extracted_data, intake_phase1: { version: '1.0' } };
    ctx.stepsResult.push({ step: 2, stage_key: 'consolidate_dossier', artifact_version: '1.0', status: 'SUCCESS', stepName: 'cũ', processor: 'x', extracted_data: { cũ: true } });
    ctx.currentStep = 3;
    return ctx;
  }

  it('resume không dùng lại checkpoint consolidate cũ, không dừng lại lần nữa, chạy tài chính từ OCR rồi hoàn tất', async () => {
    const ctx = legacy();
    await runLoanAppraisal(ctx as never);
    expect((failWorkflow as jest.Mock).mock.calls).toEqual([]);
    expect(pauseMock).not.toHaveBeenCalled();
    expect(completeWorkflow).toHaveBeenCalledTimes(1);
    const keys = ctx.stepsResult.map((s) => (s as { stage_key: string }).stage_key);
    expect(keys).toEqual(expect.arrayContaining(['calculate_financials', 'evaluate_policy_compliance', 'synthesize_recommendation']));
    // Artifact tài chính mới nằm ở chỉ số 2 theo đánh số mới, không bị nhầm với consolidate cũ cùng chỉ số.
    const financial = ctx.stepsResult.find((s) => (s as { stage_key: string }).stage_key === 'calculate_financials') as { step: number };
    expect(financial.step).toBe(2);
  });
});
