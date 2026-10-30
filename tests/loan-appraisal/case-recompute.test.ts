// T-COR-05 — tính lại từ case_input.json (case_corrections.md COR-R02, R03, R13, R15, R16; COR-AC01, COR-AC02, COR-AC11).
const enqueueMock = jest.fn();
const files = new Map<string, string>();
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
jest.mock('@/lib/storage', () => ({
  getStorageBackend: async () => ({
    download: async (key: string) => { const { Readable } = await import('stream'); return Readable.from([Buffer.from(files.get(key) ?? '', 'utf8')]); },
    upload: async () => undefined,
    delete: async () => undefined,
  }),
}));

// Nạp workflow TRƯỚC engine để loan-appraisal gắn với bản mock của engine (xem lac-pii.test.ts).
import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';
import { CASE_INPUT_CONTRACT, CASE_INPUT_VERSION } from '@/lib/loan-dossier/corrections/schema';
import { compactAppraisalResult } from '@/lib/pipelines/workflows/loan-appraisal/compact-view';
import type { AppraisalResultV2 } from '@/lib/pipelines/workflows/loan-appraisal/types';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

const OTHER_ID = '079199912345';
const app = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]);
const card = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: OTHER_ID }] });
const evs = [app, card];
const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
const base = { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {}, webhookUrl: null, apiKeyId: null, endpointSlug: 'workflows:loan-appraisal' };

function originalCtx() {
  const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
  const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
  const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
  return {
    ...base, operationId: 'op-origin', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)], currentStep: 2,
    pipelineVars: { flow: 'FAST', stop_after_intake: false, product_code: 'hkd-loan' },
    filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }], logger: logger(),
  };
}
function recomputeCtx(caseInput: unknown, extraFiles: Array<{ name: string; path: string; mime: string; size: number }> = []) {
  const text = JSON.stringify(caseInput);
  files.set('/s/case.json', text);
  return {
    ...base, operationId: `op-re-${Math.random()}`, stepsResult: [], currentStep: 0, pipelineVars: { product_code: 'khac', flow: 'FULL' },
    filesData: [{ name: 'case_input.json', path: '/s/case.json', mime: 'application/json', size: text.length }, ...extraFiles], logger: logger(),
  };
}
const caseInputOf = (r: AppraisalResultV2, corrections: unknown[] = []) => ({
  contract: CASE_INPUT_CONTRACT, contract_version: CASE_INPUT_VERSION, documents: r.documents, dossier_precheck: r.dossier_precheck ?? null, case_seal: r.case_seal, corrections,
});
const lastResult = () => (completeWorkflow as jest.Mock).mock.calls.at(-1)![2] as AppraisalResultV2;
const prompts = () => enqueueMock.mock.calls.map((c) => String((c[2] as { _prompt?: string })._prompt ?? ''));

let original: AppraisalResultV2;
beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcd';
  enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
  await runLoanAppraisal(originalCtx() as never);
  // Kết quả đi qua DB / API dưới dạng JSON.
  original = JSON.parse(JSON.stringify(lastResult()));
});
beforeEach(() => { enqueueMock.mockClear(); enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-2' } }); (failWorkflow as jest.Mock).mockClear(); });

it('kết quả chạy thường có case_seal của chính Operation', () => {
  expect(original.case_seal).toMatchObject({ alg: 'HMAC-SHA256', source_operation_id: 'op-origin', product_code: 'hkd-loan' });
});

it('COR-AC01: không có hiệu chỉnh → cùng LAC, cùng rule; không gọi phân loại / OCR / kiểm tra sơ bộ; sản phẩm theo niêm phong', async () => {
  await runLoanAppraisal(recomputeCtx(caseInputOf(original)) as never);
  expect(failWorkflow).not.toHaveBeenCalled();
  const again = lastResult();
  expect(again.product_code).toBe('hkd-loan');
  expect(again.loan_application_context_summary?.source_hash).toBe(original.loan_application_context_summary?.source_hash);
  expect(again.policy_compliance.rule_results.map((r) => [r.rule_id, r.result])).toEqual(original.policy_compliance.rule_results.map((r) => [r.rule_id, r.result]));
  expect(again.documents).toEqual(original.documents);
  expect(prompts().every((p) => p.includes('untrusted_loan_context'))).toBe(true);
  expect(again.correction_report).toEqual({ source_operation_id: 'op-origin', applied: [], skipped: [] });
  expect(again.case_seal?.source_operation_id).toBe('op-origin');
});

it('COR-R16: case_input dựng từ view compact vẫn qua niêm phong', async () => {
  await runLoanAppraisal(recomputeCtx(caseInputOf(compactAppraisalResult(original) as AppraisalResultV2)) as never);
  expect(failWorkflow).not.toHaveBeenCalled();
});

it('COR-AC02: sửa một ký tự OCR trong documents → CASE_SEAL_INVALID, không có giá trị trong message', async () => {
  const tampered = JSON.parse(JSON.stringify(caseInputOf(original)));
  tampered.documents.evidences[1].data.parties[0].id_number = ID_A12;
  await runLoanAppraisal(recomputeCtx(tampered) as never);
  const err = (failWorkflow as jest.Mock).mock.calls[0][1] as Error;
  expect(err.message).toContain('CASE_SEAL_INVALID');
  expect(err.message).not.toContain(ID_A12);
  expect(enqueueMock).not.toHaveBeenCalled();
});

it('lẫn file khác → CASE_INPUT_MIXED; schema sai → INVALID_CASE_INPUT kèm đường dẫn, không giá trị', async () => {
  await runLoanAppraisal(recomputeCtx(caseInputOf(original), [{ name: 'b.pdf', path: '/s/b.pdf', mime: 'application/pdf', size: 1 }]) as never);
  expect(((failWorkflow as jest.Mock).mock.calls[0][1] as Error).message).toContain('CASE_INPUT_MIXED');
  (failWorkflow as jest.Mock).mockClear();
  await runLoanAppraisal(recomputeCtx({ ...caseInputOf(original), corrections: [{ kind: 'OCR_FIX', value: 'BÍ MẬT' }] }) as never);
  const msg = ((failWorkflow as jest.Mock).mock.calls[0][1] as Error).message;
  expect(msg).toContain('INVALID_CASE_INPUT');
  expect(msg).toContain('corrections');
  expect(msg).not.toContain('BÍ MẬT');
});

it('FACT_RESOLUTION + OCR_FIX áp được, có correction_report; tính lại lần hai giữ Operation gốc', async () => {
  const appId = `${app.evidence_id}#parties[0].id_number`;
  const cardId = `${card.evidence_id}#parties[0].id_number`;
  const meta = { reason: 'đối chiếu bản gốc', corrected_by: 'u1', corrected_at: '2026-10-30T09:00:00Z' };
  const corrections = [
    { ...meta, correction_id: 'r1', kind: 'FACT_RESOLUTION', record_ids: [appId, cardId], chosen_record_id: cardId },
    { ...meta, correction_id: 'f1', kind: 'OCR_FIX', record_id: `${card.evidence_id}#parties[0].full_name`, original_value: 'NGUYỄN VĂN AN', value: 'Nguyễn Văn An' },
  ];
  await runLoanAppraisal(recomputeCtx(caseInputOf(original, corrections)) as never);
  const r1 = JSON.parse(JSON.stringify(lastResult())) as AppraisalResultV2;
  expect(r1.correction_report?.skipped).toEqual([]);
  expect(r1.correction_report?.applied.map((a) => a.correction_id).sort()).toEqual(['f1', 'r1']);
  expect(r1.loan_application_context_summary?.conflicts).toBeLessThan(original.loan_application_context_summary!.conflicts);
  expect(r1.config_snapshot.reproducibility?.corrections_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(r1.documents).toEqual(original.documents);

  // Tính lại tiếp từ kết quả đã tính lại (COR-R15): cùng documents, niêm phong vẫn trỏ Operation gốc.
  await runLoanAppraisal(recomputeCtx(caseInputOf(r1, corrections)) as never);
  expect(failWorkflow).not.toHaveBeenCalled();
  expect(lastResult().case_seal?.source_operation_id).toBe('op-origin');
});

it('upload: chỉ loan-appraisal nhận .json (case_input.json); workflow khác vẫn từ chối', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { validateFileMetadata } = require('@/lib/upload') as typeof import('@/lib/upload');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveAllowedExtensions } = require('@/lib/endpoints/registry') as typeof import('@/lib/endpoints/registry');
  expect(validateFileMetadata('case_input.json', 'application/json', 10, resolveAllowedExtensions('workflows:loan-appraisal')).valid).toBe(true);
  expect(validateFileMetadata('case_input.json', 'application/json', 10, resolveAllowedExtensions('workflows:disbursement')).valid).toBe(false);
});

it('COR-AC10: lý do, người sửa không vào prompt / log / content_preview / warning; giá trị sửa không vào log / content_preview', async () => {
  const REASON = 'LY-DO-RIENG-7f3a';
  const BY = 'NGUOI-SUA-9c1d';
  const VALUE = 'Nguyễn Văn An';
  const meta = { reason: REASON, corrected_by: BY, corrected_at: '2026-10-30T09:00:00Z' };
  const ctx = recomputeCtx(caseInputOf(original, [
    { ...meta, correction_id: 'f1', kind: 'OCR_FIX', record_id: `${card.evidence_id}#parties[0].full_name`, original_value: 'NGUYỄN VĂN AN', value: VALUE },
    { ...meta, correction_id: 'r1', kind: 'FACT_RESOLUTION', record_ids: [`${app.evidence_id}#parties[0].id_number`, `${card.evidence_id}#parties[0].id_number`], chosen_record_id: `${card.evidence_id}#parties[0].id_number` },
  ]));
  await runLoanAppraisal(ctx as never);
  const final = lastResult();
  const logged = JSON.stringify([ctx.logger.info.mock.calls, ctx.logger.warn.mock.calls, ctx.logger.error.mock.calls]);
  const previews = JSON.stringify(ctx.stepsResult.map((s) => (s as { content_preview?: unknown }).content_preview ?? null));
  const warnings = JSON.stringify(final.config_snapshot.warnings ?? []);
  const report = JSON.stringify(final.correction_report);
  for (const v of [REASON, BY]) {
    for (const p of prompts()) expect(p).not.toContain(v);
    expect(logged).not.toContain(v);
    expect(previews).not.toContain(v);
    expect(warnings).not.toContain(v);
    expect(report).not.toContain(v);
  }
  expect(logged).not.toContain(VALUE);
  expect(previews).not.toContain(VALUE);
});
