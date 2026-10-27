// T-V2-02 — stage 1 của workflow v2 chạy S2 (V2-R03, S2-R01, S2-R20) + resume dùng lại checkpoint 0–1.
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

import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import type { ExtractPorts } from '@/lib/loan-dossier/s2/run';
import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import {
  runExtractStage, toLegacyExtraction, type ClassifyCheckpoint, type ExtractCheckpoint,
} from '@/lib/pipelines/workflows/loan-appraisal/dossier-stages';
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';

import { makeFullData, makeLightData } from '../loan-dossier/fixtures/build';

const FILE = 'file-00000000000a';

function checkpoint(keys: string[]): ClassifyCheckpoint {
  return {
    files: [{
      file_id: FILE, file_name: 'ho-so.pdf', status: 'CLASSIFIED', reason_code: null, next_action: null, message: null, page_count: keys.length,
      matches: keys.map((k, i) => ({
        doc_type_key: k, confidence: 0.9, needs_manual_review: false, needs_extraction: docTypeByKey(k)!.needs_extraction,
        instances_count: 1, hint_mismatch: false, instances: [{ instance_index: 1, page_range: [i + 1, i + 1], confidence: 0.9, summary: '', key_facts: [] }],
      })),
    }],
    repeated_doc_types: [],
    stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: { [FILE]: '/s/ho-so.pdf' },
  };
}

function ports(fail: Set<string> = new Set()): ExtractPorts {
  return {
    readFile: async () => ({ content: Buffer.from('%PDF-1.4'), mime: 'application/pdf', page_count: 4 }),
    extractor: {
      extract: async (i) => (fail.has(i.doc_type_key)
        ? { form_found: false, data: null }
        : { form_found: true, data: i.extraction_level === 'FULL' ? makeFullData(i.doc_type_key) : makeLightData(i.doc_type_key), field_confidences: { parties: 0.9 }, source_pages: {} }),
    },
  };
}

describe('runExtractStage', () => {
  it('match FULL và LIGHT đều ra evidence, extraction_level đúng', async () => {
    const { step, failure } = await runExtractStage(checkpoint(['id_card', 'household_business_license']), ports());
    expect(failure).toBeNull();
    expect(step).toMatchObject({ step: 1, stage_key: 'extract_evidence', status: 'SUCCESS' });
    const cp = step.extracted_data as ExtractCheckpoint;
    expect(cp.evidences.map((e) => [e.doc_type_key, e.extraction_level])).toEqual([['id_card', 'FULL'], ['household_business_license', 'LIGHT']]);
    expect(toLegacyExtraction(cp).map((d) => d.status)).toEqual(['success', 'success']);
  });

  it('1 evidence ERROR → bước PARTIAL_SUCCESS, không dừng workflow', async () => {
    const { step, failure } = await runExtractStage(checkpoint(['id_card', 'cic']), ports(new Set(['cic'])));
    expect(step.status).toBe('PARTIAL_SUCCESS');
    expect((step.extracted_data as ExtractCheckpoint).status_code).toBe('EXTRACTION_ERRORS_PRESENT');
    expect(failure).toBeNull();
  });

  it('mọi evidence ERROR → INVALID_INPUT', async () => {
    const { failure } = await runExtractStage(checkpoint(['cic']), ports(new Set(['cic'])));
    expect(failure?.message).toMatch(/^INVALID_INPUT/);
  });
});

describe('runLoanAppraisal — resume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
  });

  it('resume từ bước 2 dùng lại checkpoint bước 0–1, không gọi lại model phân loại/bóc tách', async () => {
    const extract = await runExtractStage(checkpoint(['id_card']), ports());
    const classifyStep = {
      step: 0, stage_key: 'classify', artifact_version: '3.0', status: 'SUCCESS', stepName: 's0', processor: 'ext-classifier',
      extracted_data: checkpoint(['id_card']),
    };
    const ctx = {
      operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [classifyStep, extract.step], currentStep: 2,
      totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { stop_after_intake: false },
      promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
      filesData: [{ name: 'ho-so.pdf', path: '/s/ho-so.pdf', mime: 'application/pdf', size: 1 }],
      webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };
    await runLoanAppraisal(ctx as never);
    const processors = enqueueMock.mock.calls.map((c) => c[1]);
    expect(processors).not.toContain('ext-classifier');
    expect(processors).not.toContain('ext-data-extractor');
    // D-73: checkpoint cũ chưa có precheck được chạy bù nên object bước 0 được thay bằng bản có `precheck`;
    // dữ liệu phân loại giữ nguyên và model phân loại / bóc tách vẫn không bị gọi lại (kiểm tra ở trên).
    expect(ctx.stepsResult[0]).toMatchObject({ step: 0, stage_key: 'classify', extracted_data: { files: checkpoint(['id_card']).files } });
    expect(ctx.stepsResult[1]).toBe(extract.step);
    // Cầu nối tạm cho stage 2–7: workflow chạy hết, không lỗi.
    expect((failWorkflow as jest.Mock).mock.calls.map((c) => String(c[1]))).toEqual([]);
    expect(completeWorkflow).toHaveBeenCalledTimes(1);
  });
});
