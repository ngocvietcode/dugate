// T-V2-07 — rule và cấu hình rule theo khóa spec (V2-R07, V2-R08).
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

import { defaultCheckSet, parseCheckSet, validateCheckSetValue } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { MinimumDscrRule } from '@/lib/pipelines/workflows/loan-appraisal/rules';
import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { completeWorkflow } from '@/lib/pipelines/workflow-engine';
import { docTypeByKey } from '@/lib/loan-dossier/catalog';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

describe('check set theo khóa spec-v3', () => {
  it('catalog mặc định chỉ dùng doc_type_key của spec', () => {
    for (const check of defaultCheckSet('FULL', 'hkd-loan').checks) {
      for (const input of check.input) {
        const m = input.match(/^evidence\.(.+)$/);
        if (m) expect(docTypeByKey(m[1])).toBeDefined();
      }
    }
  });

  it('parseCheckSet gặp evidence.loan_request → bỏ + warning; validateCheckSetValue → lỗi', () => {
    const value = { checks: [{ id: 'X.CUSTOM', kind: 'PROMPT', prompt: 'kiểm tra', input: ['evidence.loan_request', 'evidence.loan_application'] }] };
    const { checkSet, warnings } = parseCheckSet(value, 'FULL', 'hkd-loan');
    expect(checkSet.checks[0].input).toEqual(['evidence.loan_application']);
    expect(warnings.some((w) => w.includes('evidence.loan_request'))).toBe(true);
    const v = validateCheckSetValue(value);
    expect(v.ok).toBe(false);
  });

  it('rule engine DSCR không đạt khi DSCR dưới ngưỡng (rule đọc chỉ số tài chính, không cần checklist)', () => {
    const def = defaultCheckSet('FULL', 'hkd-loan').checks.find((c) => c.id === 'LOAN.CAPACITY.MIN_DSCR')!;
    const metric = (value: number) => ({ status: 'CALCULATED', value, unit: 'RATIO', formula: '', inputs: {}, evidence_ids: [], warnings: [] });
    const r = new MinimumDscrRule(def, 1.25).evaluate({ financial: { dscr: metric(0.9) } } as never);
    expect(r.result).toBe('FAIL');
    expect(new MinimumDscrRule(def, 1.25).evaluate({ financial: { dscr: metric(1.4) } } as never).result).toBe('PASS');
  });
});

describe('V2-R08: prompt ghi đè bị bỏ qua, có warning trong config_snapshot', () => {
  it('cấu hình sản phẩm có prompts.extract → không dùng, có warning', async () => {
    enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
    const evs = [loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]), ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })];
    const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
    const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
    const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
    const ctx = {
      operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)], currentStep: 2,
      totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { flow: 'FAST', stop_after_intake: false, loan_product_config: { products: { 'hkd-loan': { prompts: { extract: 'prompt cũ' } } } } },
      promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
      filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
      webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };
    await runLoanAppraisal(ctx as never);
    const final = (completeWorkflow as jest.Mock).mock.calls[0][2] as { config_snapshot: { warnings?: string[] } };
    expect(final.config_snapshot.warnings?.some((w) => w.includes('"extract"'))).toBe(true);
    for (const call of enqueueMock.mock.calls) expect(JSON.stringify(call[2])).not.toContain('prompt cũ');
  });
});
