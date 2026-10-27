// T-V2-13 — đường chạy mới hoàn toàn (currentStep = 0): S1 chạy trong cùng lần rồi mới kiểm tra sơ bộ, trước S2.
const enqueueMock = jest.fn();
const pauseMock = jest.fn();
const order: string[] = [];
jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return {
    ...actual,
    enqueueSubStep: (...args: unknown[]) => enqueueMock(...args),
    pauseWorkflow: (...args: unknown[]) => pauseMock(...args),
    updateProgress: jest.fn(async (_c: unknown, _p: number, message: string) => { order.push(`progress:${message}`); }),
    updateWorkflowProgressDetails: jest.fn().mockResolvedValue(undefined),
    completeWorkflow: jest.fn().mockResolvedValue(undefined),
    failWorkflow: jest.fn().mockResolvedValue(undefined),
    assertNotCancelled: jest.fn().mockResolvedValue(undefined),
  };
});

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const evs = [loanApp([borrower]), ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })];
const classifyData = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };

jest.mock('@/lib/pipelines/workflows/loan-appraisal/dossier-stages', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflows/loan-appraisal/dossier-stages');
  return {
    ...actual,
    runClassifyStage: jest.fn(async () => {
      order.push('S1');
      return {
        failure: null,
        result: { content_preview: { classified_count: 2, file_count: 1 } },
        step: { step: 0, stage_key: 'classify', artifact_version: '3.0', status: 'SUCCESS', stepName: 's1', processor: 'ext-classifier', extracted_data: classifyData },
      };
    }),
    runExtractStage: jest.fn(async (classify: { precheck?: unknown }) => {
      order.push(classify.precheck ? 'S2(sau precheck)' : 'S2(TRƯỚC precheck)');
      return {
        failure: null,
        result: { content_preview: { success_count: 2, evidence_count: 2 } },
        step: {
          step: 1, stage_key: 'extract_evidence', artifact_version: '3.0', status: 'SUCCESS', stepName: 's2', processor: 'ext-data-extractor',
          extracted_data: { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null },
        },
      };
    }),
  };
});
jest.mock('@/lib/pipelines/workflows/loan-appraisal/stage-adapters', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflows/loan-appraisal/stage-adapters');
  return {
    ...actual,
    createDossierPorts: () => ({ classifyPorts: {}, fileRefs: () => ({}), extractPorts: () => ({}), cleanup: async () => undefined }),
  };
});

import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { isDossierPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';

const MARKER = 'kiểm tra SƠ BỘ bộ hồ sơ vay';
const ANSWER = { checklist: [], relations: [], overview: 'Tổng quan.', next_actions: [] };

function fresh(vars: Record<string, unknown> = {}) {
  return {
    operationId: 'op-fresh', endpointSlug: 'workflows:loan-appraisal', stepsResult: [] as unknown[], currentStep: 0,
    totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { flow: 'FULL', dossier_submitted_at: '2026-10-14', stop_after_intake: 'true', ...vars },
    promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
    filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
    webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  enqueueMock.mockImplementation(async (_c: unknown, _p: string, vars: { _prompt?: string }) => {
    if (String(vars?._prompt ?? '').includes(MARKER)) order.push('LLM-precheck');
    return { content: String(vars?._prompt ?? '').includes(MARKER) ? JSON.stringify(ANSWER) : '{}', operation: { id: 'sub' } };
  });
});

describe('T-V2-13: đường chạy mới hoàn toàn', () => {
  it('thứ tự: S1 → LLM kiểm tra sơ bộ → S2; checkpoint bước 0 lưu precheck; tiến độ báo ngay sau S1', async () => {
    const ctx = fresh();
    await runLoanAppraisal(ctx as never);
    const seq = order.filter((x) => x === 'S1' || x === 'LLM-precheck' || x.startsWith('S2'));
    expect(seq).toEqual(['S1', 'LLM-precheck', 'S2(sau precheck)']);
    const progress = order.filter((x) => x.startsWith('progress:'));
    const iS1 = progress.findIndex((m) => m.includes('Bước 1 hoàn tất'));
    const iPre = progress.findIndex((m) => m.includes('Kiểm tra sơ bộ xong'));
    const iS2 = progress.findIndex((m) => m.includes('Bước 2 hoàn tất'));
    expect(iS1).toBeGreaterThanOrEqual(0);
    expect(iPre).toBeGreaterThan(iS1);
    expect(iS2).toBeGreaterThan(iPre);
    const step0 = ctx.stepsResult.find((s) => (s as { stage_key: string }).stage_key === 'classify') as { extracted_data: { precheck?: unknown } };
    expect(isDossierPrecheck(step0.extracted_data.precheck)).toBe(true);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(pauseMock.mock.calls[0][3].dossier_precheck).toMatchObject({ status: 'COMPLETED' });
    expect(pauseMock.mock.calls[0][3].intake_assessment.criteria).toHaveLength(4);
  });

  it('dossier_precheck = false: S1 → S2 không có LLM kiểm tra sơ bộ', async () => {
    await runLoanAppraisal(fresh({ dossier_precheck: 'false' }) as never);
    expect(order.filter((x) => x === 'S1' || x === 'LLM-precheck' || x.startsWith('S2'))).toEqual(['S1', 'S2(sau precheck)']);
    expect(pauseMock.mock.calls[0][3].dossier_precheck.status).toBe('SKIPPED');
  });
});
