const mockEnqueueSubStep = jest.fn();

jest.mock('@/lib/pipelines/workflow-engine', () => ({
  enqueueSubStep: (...args: unknown[]) => mockEnqueueSubStep(...args),
  parseDeep: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
}));

import { translatePayload } from '@/lib/pipelines/workflows/financial-report/translate';
import { resolveConfig } from '@/lib/pipelines/workflows/financial-report-translation';
import {
  createEmptyPayload,
  type FinancialReportConfig,
  type InternalFinancialReportPayload,
} from '@/lib/pipelines/workflows/financial-report/types';

type PromptItem = { id: string; text: string };
type TranslationOutcomeWithDiagnostics = {
  translatedItems: number;
  totalBatches: number;
  failedBatches: number;
  untranslatedItems?: number;
  failureReasons?: string[];
};

function config(overrides: Partial<FinancialReportConfig> & {
  translateBatchItems?: number;
  translateBatchChars?: number;
} = {}): FinancialReportConfig {
  return {
    targetLang: 'vi',
    requestId: 'ROUND-11B-T4.1',
    pagesPerChunk: 1,
    notesPagesPerChunk: 1,
    classifyPagesPerCall: 1,
    classifyRecheckUnassigned: false,
    classifyRecheckMaxWindows: 0,
    maxRetries: 1,
    maxConcurrency: 1,
    staggerDelayMs: 0,
    enableTranslation: true,
    renderScale: 2,
    reportTypes: [],
    ...overrides,
  } as FinancialReportConfig;
}

function context() {
  return {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    promptOverrides: {},
    modelOverrides: {},
    reasoningEffortOverrides: {},
  } as never;
}

function notesPayload(sourceTexts: string[]): InternalFinancialReportPayload {
  const payload = createEmptyPayload('ja', 'vi');
  payload.notesToFinancialStatements = {
    status: 'FOUND',
    title: null,
    pageRanges: [],
    unit: null,
    warnings: [],
    sections: sourceTexts.map((sourceText, index) => ({
      sectionId: `note-${index + 1}`,
      sourcePage: index + 1,
      title: { source: null, translated: null },
      sourceText,
      translatedText: null,
    })),
  };
  return payload;
}

function promptItems(promptVars: unknown): PromptItem[] {
  const prompt = String((promptVars as { _prompt?: unknown })._prompt);
  const content = prompt.match(/### DANH SÁCH CẦN DỊCH\n([\s\S]*?)\n\n### OUTPUT JSON/);
  if (!content) throw new Error('Không tìm thấy danh sách dịch trong prompt');
  return JSON.parse(content[1]) as PromptItem[];
}

function successfulResponse(items: PromptItem) {
  return {
    content: JSON.stringify({
      translations: [{ id: items.id, translated: `vi:${items.text}` }],
    }),
  };
}

function successfulBatchResponse(items: PromptItem[]) {
  return {
    content: JSON.stringify({
      translations: items.map((item) => ({ id: item.id, translated: `vi:${item.text}` })),
    }),
  };
}

describe('Round 11B T4.1 — chia lô dịch theo nguồn duy nhất', () => {
  beforeEach(() => {
    mockEnqueueSubStep.mockReset();
  });

  it('100 mục với một lô lỗi trả PARTIAL, một failure reason, và vẫn dịch các lô còn lại', async () => {
    const payload = notesPayload(Array.from({ length: 100 }, (_, index) => `nguồn-${index + 1}`));
    let call = 0;
    mockEnqueueSubStep.mockImplementation(async (_ctx: unknown, _connector: unknown, promptVars: unknown) => {
      call++;
      if (call === 2) throw new Error('translator timeout');
      return successfulBatchResponse(promptItems(promptVars));
    });

    const outcome = await translatePayload(context(), payload, config({
      translateBatchItems: 40,
      translateBatchChars: 20_000,
    })) as TranslationOutcomeWithDiagnostics;

    expect(mockEnqueueSubStep).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({
      translatedItems: 60,
      untranslatedItems: 40,
      totalBatches: 3,
      failedBatches: 1,
      failureReasons: ['translate lô 2/3 (40 mục): translator timeout'],
    });
    expect(payload.notesToFinancialStatements.sections[0].translatedText).toBe('vi:nguồn-1');
    expect(payload.notesToFinancialStatements.sections[40].translatedText).toBeNull();
    expect(payload.notesToFinancialStatements.sections[80].translatedText).toBe('vi:nguồn-81');
  });

  it('mọi lô lỗi trả outcome FAILED-compatible thay vì ném, với lý do cho từng lô', async () => {
    const payload = notesPayload(Array.from({ length: 41 }, (_, index) => `nguồn-${index + 1}`));
    mockEnqueueSubStep.mockRejectedValue(new Error('provider unavailable'));

    const outcome = await translatePayload(context(), payload, config({
      translateBatchItems: 40,
      translateBatchChars: 20_000,
    })) as TranslationOutcomeWithDiagnostics;

    expect(outcome).toMatchObject({
      translatedItems: 0,
      untranslatedItems: 41,
      totalBatches: 2,
      failedBatches: 2,
      failureReasons: [
        'translate lô 1/2 (40 mục): provider unavailable',
        'translate lô 2/2 (1 mục): provider unavailable',
      ],
    });
  });

  it('dedupe chuỗi nguồn toàn file: hai id cùng nguồn chỉ gọi AI một lần nhưng đều nhận bản dịch', async () => {
    const payload = notesPayload(['trùng nguồn']);
    payload.generalInformation.companyName.source = 'trùng nguồn';
    mockEnqueueSubStep.mockImplementation(async (_ctx: unknown, _connector: unknown, promptVars: unknown) =>
      successfulBatchResponse(promptItems(promptVars)));

    const outcome = await translatePayload(context(), payload, config({
      translateBatchItems: 40,
      translateBatchChars: 20_000,
    })) as TranslationOutcomeWithDiagnostics;

    expect(mockEnqueueSubStep).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ translatedItems: 2, untranslatedItems: 0 });
    expect(payload.generalInformation.companyName.translated).toBe('vi:trùng nguồn');
    expect(payload.notesToFinancialStatements.sections[0].translatedText).toBe('vi:trùng nguồn');
  });

  it('mục dài hơn 20.000 ký tự là singleton nguyên vẹn, không bị cắt', async () => {
    const overLimitSource = '長'.repeat(20_001);
    const payload = notesPayload([overLimitSource, ...Array.from({ length: 40 }, (_, index) => `ngắn-${index + 1}`)]);
    const capturedBatches: PromptItem[][] = [];
    mockEnqueueSubStep.mockImplementation(async (_ctx: unknown, _connector: unknown, promptVars: unknown) => {
      const items = promptItems(promptVars);
      capturedBatches.push(items);
      return successfulBatchResponse(items);
    });

    await translatePayload(context(), payload, config({
      translateBatchItems: 40,
      translateBatchChars: 20_000,
    }));

    expect(capturedBatches.map((items) => items.length)).toEqual([1, 40]);
    expect(capturedBatches[0][0].text).toBe(overLimitSource);
  });

  it('đọc đúng hai Profile key và default đã chốt', () => {
    const ctxLike = (vars: Record<string, unknown>) => ({ operationId: 'op-1', pipelineVars: vars }) as never;

    expect(resolveConfig(ctxLike({}))).toMatchObject({
      translateBatchItems: 40,
      translateBatchChars: 20_000,
    });
    expect(resolveConfig(ctxLike({ translate_batch_items: '12', translate_batch_chars: '3456' }))).toMatchObject({
      translateBatchItems: 12,
      translateBatchChars: 3456,
    });
  });
});
