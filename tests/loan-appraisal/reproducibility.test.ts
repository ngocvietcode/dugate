// ARCHITECTURE E1 — bản ghi tái lập trong config_snapshot.reproducibility.
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

import { createHash } from 'crypto';

import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { completeWorkflow } from '@/lib/pipelines/workflow-engine';
import { DOSSIER_PRECHECK_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck-prompt';
import { POLICY_CHECKS_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';
import { buildReproducibilitySnapshot, CATALOG_VERSIONS, type ReproducibilitySnapshot } from '@/lib/pipelines/workflows/loan-appraisal/reproducibility';
import { LOAN_APPRAISAL_WORKFLOW_VERSION } from '@/lib/pipelines/workflows/loan-appraisal/types';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const none = { promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {} };

describe('buildReproducibilitySnapshot', () => {
  it('tất định và ghi workflow_version + phiên bản danh mục', () => {
    const a = buildReproducibilitySnapshot(none);
    expect(buildReproducibilitySnapshot(none)).toEqual(a);
    expect(a.workflow_version).toBe(LOAN_APPRAISAL_WORKFLOW_VERSION);
    expect(a.catalog_versions).toEqual(CATALOG_VERSIONS);
    for (const key of ['loan_products', 'doc_types', 'checklist_catalog', 'checklist_programs', 'light_extraction', 'reason_codes']) {
      expect(a.catalog_versions[key]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('ghi đúng 4 bước AI đang chạy; S1/S2 là BUILT_IN, template mặc định là DEFAULT với sha256 của template', () => {
    const s = buildReproducibilitySnapshot(none);
    expect(Object.keys(s.ai_steps).sort()).toEqual(['classify', 'dossier_precheck', 'extract', 'policy_checks']);
    expect(s.ai_steps.classify.prompt_source).toBe('BUILT_IN');
    expect(s.ai_steps.extract.prompt_source).toBe('BUILT_IN');
    expect(s.ai_steps.classify.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.ai_steps.extract.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.ai_steps.dossier_precheck).toEqual({ prompt_source: 'DEFAULT', prompt_sha256: sha(DOSSIER_PRECHECK_PROMPT_TEMPLATE), model_override: null, reasoning_override: null });
    expect(s.ai_steps.policy_checks).toEqual({ prompt_source: 'DEFAULT', prompt_sha256: sha(POLICY_CHECKS_PROMPT_TEMPLATE), model_override: null, reasoning_override: null });
  });

  it('prompt ghi đè trên Profile → PROFILE, sha256 của bản ghi đè; không chứa nội dung prompt', () => {
    const s = buildReproducibilitySnapshot({ ...none, promptOverrides: { policy_checks: 'PROMPT TÙY CHỈNH {{checks}}' } });
    expect(s.ai_steps.policy_checks.prompt_source).toBe('PROFILE');
    expect(s.ai_steps.policy_checks.prompt_sha256).toBe(sha('PROMPT TÙY CHỈNH {{checks}}'));
    expect(JSON.stringify(s)).not.toContain('TÙY CHỈNH');
  });

  it('model / reasoning: precheck và policy_checks fallback về evaluate; classify / extract thì không (giống workflow)', () => {
    const s = buildReproducibilitySnapshot({
      promptOverrides: {},
      modelOverrides: { evaluate: 'model-eval', extract: 'model-ocr' },
      reasoningEffortOverrides: { evaluate: 'low', policy_checks: 'high' },
    });
    expect(s.ai_steps.classify).toMatchObject({ model_override: null, reasoning_override: null });
    expect(s.ai_steps.extract).toMatchObject({ model_override: 'model-ocr', reasoning_override: null });
    expect(s.ai_steps.dossier_precheck).toMatchObject({ model_override: 'model-eval', reasoning_override: 'low' });
    expect(s.ai_steps.policy_checks).toMatchObject({ model_override: 'model-eval', reasoning_override: 'high' });
  });
});

describe('runLoanAppraisal ghi reproducibility vào config_snapshot', () => {
  it('kết quả cuối có reproducibility; prompt policy_checks của sản phẩm được ghi là PROFILE', async () => {
    enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
    const evs = [loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]), ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })];
    const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
    const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
    const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
    const override = 'Thẩm định theo quy định nội bộ.\n{{checks}}\n{{evidence}}\n{{output_schema}}';
    const ctx = {
      operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)], currentStep: 2,
      totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [],
      pipelineVars: { flow: 'FAST', stop_after_intake: false, loan_product_config: { products: { 'hkd-loan': { prompts: { policy_checks: override }, models: { evaluate: 'model-eval' } } } } },
      promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
      filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
      webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };
    await runLoanAppraisal(ctx as never);
    const final = (completeWorkflow as jest.Mock).mock.calls[0][2] as { config_snapshot: { reproducibility?: ReproducibilitySnapshot } };
    const r = final.config_snapshot.reproducibility!;
    expect(r).toBeDefined();
    expect(r.ai_steps.policy_checks).toMatchObject({ prompt_source: 'PROFILE', prompt_sha256: sha(override), model_override: 'model-eval' });
    expect(r.ai_steps.dossier_precheck).toMatchObject({ prompt_source: 'DEFAULT', model_override: 'model-eval' });
  });
});
