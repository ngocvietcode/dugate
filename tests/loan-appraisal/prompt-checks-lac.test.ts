// D-103 / D-120 — Rule LLM dùng Loan Application Context (LAC AC-6, AC-7), phụ lục OCR thô theo ocr.<doc>.
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

import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import type { LoanApplicationContext } from '@/lib/loan-dossier/context/schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
// Nạp workflow TRƯỚC engine để loan-appraisal gắn với bản mock của engine (xem lac-pii.test.ts).
import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { completeWorkflow } from '@/lib/pipelines/workflow-engine';
import { parseCheckSet, validateCheckSetValue } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { buildEvidenceRegistryV3 } from '@/lib/pipelines/workflows/loan-appraisal/evidence-v3';
import {
  buildPromptCheckVars,
  parsePromptCheckResults,
  type PromptCheckRefs,
} from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';
import type { FinancialMetrics } from '@/lib/pipelines/workflows/loan-appraisal/types';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };

function app(amount: number) {
  const a = loanApp([borrower]);
  a.data!.loan_info = { ...(a.data!.loan_info as object), requested_amount: 600_000_000, bank_proposed_amount: amount, loan_term_months: 60, interest_rate: 10 };
  return { ...a, field_confidences: { ...a.field_confidences, loan_info: 0.95 } };
}
const idCard = () => ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER' }] });

function setup(evidences: EvidenceEnvelope[], check: Record<string, unknown> = {}) {
  const s3 = runMapDossier({ evidences, dossier_submitted_at: '2026-10-14' }).data;
  const lac = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: 'SUCCESS' });
  const evidence = buildEvidenceRegistryV3(evidences, new Set((s3?.superseded_evidences ?? []).map((s) => s.evidence_id)), null);
  const { checkSet } = parseCheckSet({ checks: [{ id: 'X.LOAN', kind: 'PROMPT', prompt: 'Kiểm tra khoản vay.', input: ['lac.loan'], threshold: 0.8, ...check }] }, 'FULL', 'hkd-loan');
  return { lac, evidence, checkSet };
}

function build(lac: LoanApplicationContext, s: ReturnType<typeof setup>, override?: string) {
  let outcome: PromptCheckRefs | null = null;
  const vars = buildPromptCheckVars(
    { checkSet: s.checkSet, evidence: s.evidence, financial: {} as FinancialMetrics, lac },
    override, (o) => { outcome = o; },
  );
  return { prompt: vars._prompt as string, outcome: outcome as unknown as PromptCheckRefs };
}

/** Mã F của fact đầu tiên thoả điều kiện (theo bảng mã đã render). */
function codeOf(outcome: PromptCheckRefs, lac: LoanApplicationContext, pick: (f: LoanApplicationContext['facts'][number]) => boolean): string {
  const fact = lac.facts.find(pick)!;
  const code = [...outcome.render.factIndex].find(([, id]) => id === fact.fact_id)?.[0];
  if (!code) throw new Error('fact không được render');
  return code;
}

const answer = (refs: string[], status = 'PASS') => ({ results: [{ id: 'X.LOAN', status, confidence: 0.95, code: 'MATCH', reason: 'ok', evidence_ids: refs }] });

describe('template', () => {
  it('template mặc định dùng {{context}}, mã F<n>, không gửi OCR thô khi không rule nào khai ocr.<doc>', () => {
    const s = setup([app(500_000_000), idCard()]);
    const { prompt, outcome } = build(s.lac, s);
    expect(outcome.ocr).toBeNull();
    expect(outcome.legacyTemplate).toBe(false);
    expect(prompt).toContain('<untrusted_loan_context>');
    expect(prompt).toMatch(/\bF1 /);
    expect(prompt).not.toContain('<untrusted_evidence>');
    expect(prompt).toContain('"evidence_ids": ["F3", "F12.2"]');
  });

  it('D-120: template ghi đè không có {{context}} → tự chuyển, vẫn dùng LAC, báo legacyTemplate', () => {
    const s = setup([app(500_000_000), idCard()]);
    const { prompt, outcome } = build(s.lac, s, 'Kiểm tra.\n{{checks}}\n{{evidence}}\n{{output_schema}}');
    expect(outcome.legacyTemplate).toBe(true);
    expect(prompt).toContain('<untrusted_loan_context>');
  });

  it('input lac.* hợp lệ được nhận khi ghi; lac.document với loại chứng từ lạ bị từ chối; allow_declared_pass phải là boolean', () => {
    const ok = { checks: [{ id: 'X.A', kind: 'PROMPT', prompt: 'p', input: ['lac.loan', 'lac.person.borrower', 'lac.document.id_card'], allow_declared_pass: true }] };
    expect(validateCheckSetValue(ok).ok).toBe(true);
    // Ghi fail-closed (V2-R07): loại chứng từ lạ bị từ chối; đọc khoan dung: bỏ input lạ, giữ phần còn lại.
    expect(validateCheckSetValue({ checks: [{ id: 'X.B', kind: 'PROMPT', prompt: 'p', input: ['lac.document.khong_co'] }] }).ok).toBe(false);
    expect(parseCheckSet({ checks: [{ id: 'X.B', kind: 'PROMPT', prompt: 'p', input: ['lac.document.khong_co', 'lac.loan'] }] }, 'FULL', 'hkd-loan').checkSet.checks[0].input).toEqual(['lac.loan']);
    expect(validateCheckSetValue({ checks: [{ id: 'X.C', kind: 'PROMPT', prompt: 'p', allow_declared_pass: 'yes' }] }).ok).toBe(false);
  });
});

describe('parse với LAC (LAC-R13)', () => {
  it('PASS dẫn F<n> của dữ kiện CORROBORATED, đã ACCEPTED → PASS, evidence_ids là record_id', () => {
    const s = setup([app(500_000_000), idCard()], { input: ['lac.person'] });
    const { outcome } = build(s.lac, s);
    const code = codeOf(outcome, s.lac, (f) => f.trust === 'CORROBORATED' && f.review === 'ACCEPTED' && f.field.endsWith('full_name'));
    const [r] = parsePromptCheckResults(answer([code]), s.checkSet, s.evidence, outcome, s.lac);
    expect(r.result).toBe('PASS');
    expect(r.evidence_ids.every((id) => id.includes('#'))).toBe(true);
  });

  it('AC-6: PASS chỉ dựa dữ kiện DECLARED → REVIEW / PROMPT_CHECK_DECLARED_ONLY', () => {
    const s = setup([app(500_000_000), idCard()]);
    const { outcome } = build(s.lac, s);
    const code = codeOf(outcome, s.lac, (f) => f.field === 'loan_info.bank_proposed_amount');
    const [r] = parsePromptCheckResults(answer([code]), s.checkSet, s.evidence, outcome, s.lac);
    expect(r).toMatchObject({ result: 'REVIEW', reason_code: 'PROMPT_CHECK_DECLARED_ONLY' });
  });

  it('D-112: PASS dẫn DECLARED kèm một dữ kiện CORROBORATED không liên quan → vẫn REVIEW / PROMPT_CHECK_DECLARED_ONLY', () => {
    const s = setup([app(500_000_000), idCard()], { input: ['lac.loan', 'lac.person'] });
    const { outcome } = build(s.lac, s);
    const declared = codeOf(outcome, s.lac, (f) => f.field === 'loan_info.bank_proposed_amount');
    const other = codeOf(outcome, s.lac, (f) => f.trust === 'CORROBORATED' && f.review === 'ACCEPTED' && f.field.endsWith('full_name'));
    const [r] = parsePromptCheckResults(answer([declared, other]), s.checkSet, s.evidence, outcome, s.lac);
    expect(r).toMatchObject({ result: 'REVIEW', reason_code: 'PROMPT_CHECK_DECLARED_ONLY' });
  });

  it('AC-6: rule khai allow_declared_pass → PASS trên dữ kiện DECLARED', () => {
    const s = setup([app(500_000_000), idCard()], { allow_declared_pass: true });
    const { outcome } = build(s.lac, s);
    const code = codeOf(outcome, s.lac, (f) => f.field === 'loan_info.bank_proposed_amount');
    const [r] = parsePromptCheckResults(answer([code]), s.checkSet, s.evidence, outcome, s.lac);
    expect(r.result).toBe('PASS');
  });

  it('AC-6: PASS dẫn dữ kiện DISPUTED (hai đơn vay khác số tiền) → REVIEW / PROMPT_CHECK_EVIDENCE_DISPUTED', () => {
    const s = setup([app(500_000_000), app(700_000_000), idCard()]);
    const { outcome } = build(s.lac, s);
    const code = codeOf(outcome, s.lac, (f) => f.field === 'loan_info.bank_proposed_amount' && f.trust === 'DISPUTED');
    const [r] = parsePromptCheckResults(answer([code]), s.checkSet, s.evidence, outcome, s.lac);
    expect(r).toMatchObject({ result: 'REVIEW', reason_code: 'PROMPT_CHECK_EVIDENCE_DISPUTED' });
  });

  it('FAIL không bị rào trust (rào chỉ chặn PASS)', () => {
    const s = setup([app(500_000_000), idCard()]);
    const { outcome } = build(s.lac, s);
    const code = codeOf(outcome, s.lac, (f) => f.field === 'loan_info.bank_proposed_amount');
    const [r] = parsePromptCheckResults(answer([code], 'FAIL'), s.checkSet, s.evidence, outcome, s.lac);
    expect(r.result).toBe('FAIL');
  });

  it('D-120: PASS dẫn D<n> của phụ lục OCR thô vẫn qua rào trust của LAC (DECLARED → REVIEW)', () => {
    const s = setup([app(500_000_000), idCard()], { input: ['lac.loan', 'ocr.loan_application'] });
    const { prompt, outcome } = build(s.lac, s);
    expect(outcome.ocr).not.toBeNull();
    expect(prompt).toContain('<untrusted_evidence>');
    const [r] = parsePromptCheckResults(answer(['D1:loan_info.bank_proposed_amount']), s.checkSet, s.evidence, outcome, s.lac);
    expect(r).toMatchObject({ result: 'REVIEW', reason_code: 'PROMPT_CHECK_DECLARED_ONLY' });
  });

  it('AC-7: mã lạ (F999, D1:… khi không có phụ lục) bị bỏ; không còn mã hợp lệ → PROMPT_CHECK_EVIDENCE_MISSING', () => {
    const s = setup([app(500_000_000), idCard()]);
    const { outcome } = build(s.lac, s);
    const [r] = parsePromptCheckResults(answer(['F999', 'D1:loan_info.bank_proposed_amount']), s.checkSet, s.evidence, outcome, s.lac);
    expect(r).toMatchObject({ result: 'INSUFFICIENT_DATA', reason_code: 'PROMPT_CHECK_EVIDENCE_MISSING', evidence_ids: [] });
  });
});

describe('workflow', () => {
  // Cùng một bộ evidence cho mọi lần chạy: fixture đánh số tên file theo bộ đếm, dựng lại sẽ đổi tên file trong prompt.
  const evs = [app(500_000_000), idCard()];
  function context(pipelineVars: Record<string, unknown> = {}) {
    const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
    const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
    const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
    return {
      operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)], currentStep: 2,
      totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [],
      pipelineVars: { flow: 'FAST', stop_after_intake: false, ...pipelineVars },
      promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
      filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
      webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };
  }
  const stage3 = (ctx: { stepsResult: Array<{ stage_key?: string; content_preview?: Record<string, unknown> }> }) => ctx.stepsResult.find((s) => s.stage_key === 'evaluate_policy_compliance')!;

  beforeEach(() => { enqueueMock.mockReset(); (completeWorkflow as jest.Mock).mockClear(); });

  it('prompt rule LLM luôn dùng {{context}}; content_preview.lac có số đếm; lac_mode cũ trên Profile bị bỏ qua', async () => {
    enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
    const ctx = context({ lac_mode: 'off' });
    await runLoanAppraisal(ctx as never);
    const prompts = enqueueMock.mock.calls.map((c) => String((c[2] as { _prompt?: string })._prompt ?? ''));
    expect(prompts.some((p) => p.includes('<untrusted_loan_context>'))).toBe(true);
    expect(stage3(ctx).content_preview?.lac).toMatchObject({ facts_rendered: expect.any(Number), chars: expect.any(Number) });
  });
});
