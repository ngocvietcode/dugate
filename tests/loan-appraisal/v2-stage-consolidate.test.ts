// T-V2-03 — stage 2 chạy S3 → S4 → S5 bằng rule; T-V2-04 — EvidenceRegistry; T-V2-05 — Customer 360 / provenance từ S3.
const enqueueMock = jest.fn();
jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return {
    ...actual,
    enqueueSubStep: (...args: unknown[]) => enqueueMock(...args),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    updateWorkflowProgressDetails: jest.fn().mockResolvedValue(undefined),
    completeWorkflow: jest.fn().mockResolvedValue(undefined),
    failWorkflow: jest.fn().mockResolvedValue(undefined),
    assertNotCancelled: jest.fn().mockResolvedValue(undefined),
  };
});

import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { consolidateParams, runConsolidateStage, toLegacyEvaluation, type ConsolidateCheckpoint } from '@/lib/pipelines/workflows/loan-appraisal/dossier-consolidate';
import type { ClassifyCheckpoint, ExtractCheckpoint } from '@/lib/pipelines/workflows/loan-appraisal/dossier-stages';
import { buildEvidenceRegistryV3 } from '@/lib/pipelines/workflows/loan-appraisal/evidence-v3';
import { getLoanProduct } from '@/lib/pipelines/workflows/prompts/loan-appraisal-prompts';
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { classifyOf, ev, ID_A12, ID_B12, ID_C12, loanApp } from '../loan-dossier/fixtures/dossier';

const D0 = '2026-10-14';
const holder = { party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const ports = { llm: null, semantic: null };

function dossier(): EvidenceEnvelope[] {
  return [
    loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }, { party_role: 'COLLATERAL_OWNER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 }]),
    ev('id_card', { parties: [holder], confidence: 0.95 }),
    ev('cic', { parties: [holder], confidence: 0.6, issue_date: '2026-10-01' }),
  ];
}
const checkpoints = (evs: EvidenceEnvelope[]) => {
  const c = classifyOf(evs);
  const classify: ClassifyCheckpoint = { ...c, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
  const extract: ExtractCheckpoint = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
  return { classify, extract };
};

describe('runConsolidateStage (T-V2-03)', () => {
  it('lưu 3 kết quả riêng S3, S4, S5; không gọi model khi không có port', async () => {
    const { classify, extract } = checkpoints(dossier());
    const { step, checkpoint } = await runConsolidateStage(classify, extract, { product_code: 'hkd-loan', flow: 'FAST', dossier_submitted_at: D0, external_input: null, ports });
    expect(step).toMatchObject({ step: 2, stage_key: 'consolidate_dossier', processor: 'loan-dossier-rules' });
    expect(Object.keys(step.extracted_data as object)).toEqual(['map_dossier_roles', 'check_checklist', 'cross_check_documents']);
    expect(checkpoint.map_dossier_roles.stage_key).toBe('map_dossier_roles');
    expect(checkpoint.check_checklist.data!.items.length).toBeGreaterThan(0);
    expect(checkpoint.cross_check_documents.data!.results.length).toBeGreaterThan(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('flow thiếu → S4 FAILED/INVALID_FLOW, S3 và S5 vẫn có kết quả', async () => {
    const { classify, extract } = checkpoints(dossier());
    const { checkpoint, step } = await runConsolidateStage(classify, extract, { product_code: 'hkd-loan', flow: undefined, dossier_submitted_at: D0, external_input: null, ports });
    expect([checkpoint.check_checklist.status, checkpoint.check_checklist.status_code]).toEqual(['FAILED', 'INVALID_FLOW']);
    expect(checkpoint.map_dossier_roles.data).not.toBeNull();
    expect(checkpoint.cross_check_documents.data).not.toBeNull();
    expect(step.status).toBe('PARTIAL_SUCCESS');
  });

  it('không có đơn vay → S3 INSUFFICIENT_DATA, S5 UNAVAILABLE/ROLE_REGISTRY_UNAVAILABLE, vẫn có checklist', async () => {
    const { classify, extract } = checkpoints(dossier().slice(1));
    const { checkpoint } = await runConsolidateStage(classify, extract, { product_code: 'hkd-loan', flow: 'FAST', dossier_submitted_at: D0, external_input: null, ports });
    expect(checkpoint.map_dossier_roles.status_code).toBe('LOAN_APPLICATION_MISSING');
    expect(checkpoint.cross_check_documents.status_code).toBe('ROLE_REGISTRY_UNAVAILABLE');
    expect(checkpoint.check_checklist.status_code).toBe('SUBJECT_MAPPING_UNAVAILABLE');
  });

  it('cầu nối AppraisalResult cho stage 3–7: checklist theo item_key, cross_check từ dòng không khớp', async () => {
    const evs = dossier();
    evs[1] = ev('id_card', { parties: [{ ...holder, id_number: ID_C12 }] });
    const { classify, extract } = checkpoints(evs);
    const { checkpoint } = await runConsolidateStage(classify, extract, { product_code: 'hkd-loan', flow: 'FAST', dossier_submitted_at: D0, external_input: null, ports });
    const legacy = toLegacyEvaluation(checkpoint, classify, getLoanProduct(undefined));
    expect(legacy.checklist.find((c) => c.key === 'legal_id_card:person-1')).toBeDefined();
    expect(legacy.cross_check.length).toBeGreaterThan(0);
    expect(legacy.completeness_percent).toBe(checkpoint.check_checklist.data!.completeness_percent);
  });

  it('consolidateParams: ngày nộp mặc định theo giờ VN; external_input JSON hoặc biến rời', () => {
    expect(consolidateParams({}, new Date('2026-10-18T20:00:00Z')).dossier_submitted_at).toBe('2026-10-19');
    expect(consolidateParams({ dossier_submitted_at: '2026-10-01' }).dossier_submitted_at).toBe('2026-10-01');
    expect(consolidateParams({ external_input: '{"loan_amount": 5000000000}' }).external_input).toMatchObject({ loan_amount: 5_000_000_000 });
    expect(consolidateParams({ collateral_mortgaged_elsewhere: 'false' }).external_input).toMatchObject({ collateral_mortgaged_elsewhere: false });
    expect(consolidateParams({}).external_input).toBeNull();
  });
});

describe('buildEvidenceRegistryV3 (T-V2-04)', () => {
  it('evidence_id ev-…#parties[0].full_name, ổn định; 0.80 ACCEPTED, 0.79 REVIEW', () => {
    const a = ev('id_card', { id: 'ev-cccccccccc01', parties: [holder], confidence: 0.8 });
    const b = ev('cic', { id: 'ev-cccccccccc02', parties: [holder], confidence: 0.79 });
    const r1 = buildEvidenceRegistryV3([a, b], new Set(), null);
    const r2 = buildEvidenceRegistryV3([a, b], new Set(), null);
    expect(r1).toEqual(r2);
    const name = r1.records.find((r) => r.evidence_id === 'ev-cccccccccc01#parties[0].full_name')!;
    expect([name.value, name.review_status]).toEqual(['NGUYỄN VĂN AN', 'ACCEPTED']);
    expect(r1.records.find((r) => r.evidence_id === 'ev-cccccccccc02#parties[0].full_name')!.review_status).toBe('REVIEW');
  });

  it('evidence ERROR và bản bị thay thế không có bản ghi; trạng thái checklist trỏ found_in', async () => {
    const evs = dossier();
    const err = { ...ev('vneid', { parties: [holder] }), status: 'ERROR' as const, data: null, reason_code: 'UNREADABLE_CONTENT', field_confidences: {} };
    const { classify, extract } = checkpoints([...evs, err]);
    const { checkpoint } = await runConsolidateStage(classify, extract, { product_code: 'hkd-loan', flow: 'FAST', dossier_submitted_at: D0, external_input: null, ports });
    const reg = buildEvidenceRegistryV3(extract.evidences, new Set([evs[2].evidence_id]), checkpoint.check_checklist.data);
    expect(reg.records.some((r) => r.evidence_id.startsWith(err.evidence_id))).toBe(false);
    expect(reg.records.some((r) => r.evidence_id.startsWith(`${evs[2].evidence_id}#`))).toBe(false);
    const status = reg.records.find((r) => r.evidence_id === 'chk:legal_id_card:person-1')!;
    expect(status).toMatchObject({ evidence_kind: 'CHECKLIST_STATUS', value: 'PRESENT', source_evidence_ids: [evs[1].evidence_id] });
  });
});

describe('runLoanAppraisal — giai đoạn 2 không chạy các bước kiểm tra hồ sơ (tạm tắt)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
  });
  it('resume sau OCR: S3 chạy thuần (customer_360), không S4–S5, không master, không kiểm tra nháp; chỉ tài chính + rule + khuyến nghị; workflow hoàn tất', async () => {
    const { classify, extract } = checkpoints(dossier());
    const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
    const ctx = {
      operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)], currentStep: 2,
      totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { flow: 'FAST', dossier_submitted_at: D0, stop_after_intake: false },
      promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
      filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
      webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };
    await runLoanAppraisal(ctx as never);
    expect((failWorkflow as jest.Mock).mock.calls.map((c) => String(c[1]))).toEqual([]);
    expect(completeWorkflow).toHaveBeenCalledTimes(1);
    // Không có checkpoint kiểm tra hồ sơ; các stage còn lại đánh số liên tục từ 2.
    expect(ctx.stepsResult.find((s) => s.stage_key === 'consolidate_dossier')).toBeUndefined();
    expect(ctx.stepsResult.map((s) => s.stage_key)).toEqual(['classify', 'extract_evidence', 'calculate_financials', 'evaluate_policy_compliance', 'synthesize_recommendation']);
    expect(ctx.stepsResult.map((s) => s.step)).toEqual([0, 1, 2, 3, 4]);
    // Mọi lời gọi LLM còn lại chỉ là rule LLM (policy_checks); không prompt kiểm tra nháp / tổng kết / hiệu chỉnh master / Customer 360.
    for (const call of enqueueMock.mock.calls) {
      const prompt = JSON.stringify(call[2]);
      for (const forbidden of ['Customer 360', 'intake_review', 'dossier_summary', 'master_correction']) expect(prompt).not.toContain(forbidden);
    }
    const final = (completeWorkflow as jest.Mock).mock.calls[0][2] as Record<string, unknown>;
    for (const gone of ['intake', 'audit', 'master_dossier', 'intake_assessment', 'dossier_readiness']) expect(final).not.toHaveProperty(gone);
    expect((final.checklist as { status_code: string }).status_code).toBe('DOSSIER_CHECKS_DISABLED');
    expect((final.cross_check as { status_code: string }).status_code).toBe('DOSSIER_CHECKS_DISABLED');
    // S3 chạy sau OCR (thuần, không LLM): customer_360 có người; không thêm stage vào DAG.
    expect((final.customer_360 as { role_registry: unknown[] }).role_registry.length).toBeGreaterThan(0);
    expect((final.documents as { evidences: unknown[] }).evidences.length).toBeGreaterThan(0);
  });
});
