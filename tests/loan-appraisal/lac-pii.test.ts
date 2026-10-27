// D-103 — LAC-R19 / AC-11: giá trị dữ kiện của LAC (PII) chỉ đi vào prompt; không vào log, content_preview, warning hay
// bản tóm tắt lưu trong kết quả.
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

// Thứ tự import quan trọng: nạp workflow TRƯỚC engine, để loan-appraisal gắn với bản mock của engine
// (engine thật import registry workflow trong lúc factory của jest.mock đang chạy).
import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { completeWorkflow } from '@/lib/pipelines/workflow-engine';

import { classifyOf, ev, loanApp } from '../loan-dossier/fixtures/dossier';

// Giá trị giả nhưng dễ nhận ra để quét.
const NAME = 'PHẠM THỊ KIỂM THỬ';
const ID = '079199912345';
const AMOUNT = 987_654_321;
const borrower = { party_role: 'BORROWER', full_name: NAME, id_number: ID };

it('lac_mode = on: PII có trong prompt rule LLM nhưng không có trong log, content_preview, warning, bản tóm tắt', async () => {
  const a = loanApp([borrower]);
  a.data!.loan_info = { ...(a.data!.loan_info as object), requested_amount: AMOUNT, bank_proposed_amount: AMOUNT, loan_term_months: 60, interest_rate: 10 };
  const evs = [{ ...a, field_confidences: { ...a.field_confidences, loan_info: 0.95 } }, ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER' }] })];
  const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
  const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
  const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const ctx = {
    operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)], currentStep: 2,
    totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [],
    pipelineVars: { flow: 'FAST', stop_after_intake: false, lac_mode: 'on' },
    promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
    filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
    webhookUrl: null, apiKeyId: null, logger,
  };
  enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });

  await runLoanAppraisal(ctx as never);

  const pii = [NAME, ID, String(AMOUNT)];
  // Đối chứng: dữ kiện thật sự vào prompt (test không qua chỉ vì không có dữ liệu).
  const prompts = enqueueMock.mock.calls.map((c) => String((c[2] as { _prompt?: string })._prompt ?? '')).filter((p) => p.includes('untrusted_loan_context'));
  expect(prompts).toHaveLength(1);
  for (const v of pii) expect(prompts[0]).toContain(v);

  const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
  const previews = JSON.stringify(ctx.stepsResult.map((s) => (s as { content_preview?: unknown }).content_preview ?? null));
  const final = (completeWorkflow as jest.Mock).mock.calls[0][2] as { config_snapshot: { warnings?: string[] }; loan_application_context_summary?: unknown };
  const summary = JSON.stringify(final.loan_application_context_summary);
  const warnings = JSON.stringify(final.config_snapshot.warnings ?? []);
  expect(final.loan_application_context_summary).toMatchObject({ mode: 'on', used_in_prompt: true, fact_count: expect.any(Number), rendered_fact_count: expect.any(Number) });
  for (const v of pii) {
    expect(logged).not.toContain(v);
    expect(previews).not.toContain(v);
    expect(summary).not.toContain(v);
    expect(warnings).not.toContain(v);
  }
});
