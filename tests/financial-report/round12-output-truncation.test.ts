const prepareChunkAssetsMock = jest.fn();
const enqueueSubStepMock = jest.fn();

jest.mock('@/lib/pipelines/workflow-engine', () => ({
  enqueueSubStep: (...args: unknown[]) => enqueueSubStepMock(...args),
  parseDeep: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
}));

jest.mock('@/lib/pipelines/workflows/financial-report/pdf-utils', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflows/financial-report/pdf-utils');
  return {
    ...actual,
    prepareChunkAssets: (...args: unknown[]) => prepareChunkAssetsMock(...args),
  };
});

import {
  extractReports,
  looksDegenerateOutput,
  looksTruncatedOutput,
} from '@/lib/pipelines/workflows/financial-report/extract';
import { translatePayload } from '@/lib/pipelines/workflows/financial-report/translate';
import {
  createEmptyPayload,
  type FinancialReportConfig,
  type InternalFinancialReportPayload,
} from '@/lib/pipelines/workflows/financial-report/types';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { PageSource } from '@/lib/pipelines/workflows/financial-report/pdf-utils';

function config(overrides: Partial<FinancialReportConfig> = {}): FinancialReportConfig {
  return {
    targetLang: 'vi',
    requestId: 'ROUND-12B-T12.8',
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
  };
}

function context() {
  return {
    operationId: 'round12b-output-limit',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    promptOverrides: {},
    modelOverrides: {},
    reasoningEffortOverrides: {},
    pipelineVars: {},
  } as never;
}

function notesPayload(): InternalFinancialReportPayload {
  const payload = createEmptyPayload('ja', 'vi');
  payload.notesToFinancialStatements = {
    status: 'FOUND',
    title: null,
    pageRanges: [],
    unit: null,
    warnings: [],
    sections: [{
      sectionId: 'note-1',
      sourcePage: 1,
      title: { source: null, translated: null },
      sourceText: '注記本文',
      translatedText: null,
    }],
  };
  return payload;
}

function pdfSource(): PageSource {
  return {
    mode: 'pdf',
    totalPages: 1,
    pageBuffers: [Buffer.from('page-1')],
    originalBuffer: null,
    encrypted: false,
    renderScale: 2,
  };
}

const balanceSheetLocation: ReportLocation = {
  reportType: 'balanceSheet',
  pageFrom: 1,
  pageTo: 1,
  titleSource: '連結貸借対照表',
};

beforeEach(() => {
  jest.clearAllMocks();
  prepareChunkAssetsMock.mockResolvedValue({ filesJson: '[]', storageKeys: ['round12b-key'] });
});

describe("Round 12B T12.8' — quan sát JSON bị cắt", () => {
  it('nhận diện output bị cắt, nhưng không thay đổi detector output lặp/khổng lồ hiện hữu', () => {
    expect(looksTruncatedOutput('{"translations":[{"id":"t1","translated":"dở')).toBe(true);
    expect(looksTruncatedOutput('{"translations":[]}')).toBe(false);
    expect(looksTruncatedOutput('```json\n{"translations":[]}\n```')).toBe(false);
    expect(looksTruncatedOutput('')).toBe(false);
    expect(looksDegenerateOutput('-'.repeat(200))).toBe(true);
  });

  it('bổ sung dấu hiệu bị cắt vào lỗi dịch nhưng giữ nguyên tiền tố lỗi cũ', async () => {
    const truncated = '{"translations":[{"id":"t1","translated":"dở';
    enqueueSubStepMock.mockResolvedValue({ content: truncated });

    const outcome = await translatePayload(context(), notesPayload(), config());

    expect(outcome.failureReasons).toEqual([
      `translate lô 1/1 (1 mục): JSON translate không hợp lệ (nghi bị cắt do trần token đầu ra, len=${truncated.length})`,
    ]);
    expect(outcome.translateOutputLimitSuspected).toBe(1);
  });

  it('giữ nguyên chính xác lỗi dịch khi JSON méo nhưng vẫn đóng đủ dấu ngoặc', async () => {
    enqueueSubStepMock.mockResolvedValue({ content: '{"translations":{}}' });

    const outcome = await translatePayload(context(), notesPayload(), config());

    expect(outcome.failureReasons).toEqual(['translate lô 1/1 (1 mục): JSON translate không hợp lệ']);
    expect(outcome.translateOutputLimitSuspected).toBe(0);
  });

  it('chunk table bị nghi cắt vẫn chạy lượt retry chung, không bị deterministicFailure loại ra', async () => {
    enqueueSubStepMock.mockResolvedValue({ content: '{"tables":[{"rows":' });

    const outcome = await extractReports(
      context(),
      'truncated-table.pdf',
      pdfSource(),
      [balanceSheetLocation],
      config({ enableTranslation: false }),
      'round12b',
      [],
    );

    expect(enqueueSubStepMock).toHaveBeenCalledTimes(2);
    expect(outcome.tableChunks[0]).toMatchObject({
      result: null,
      outputLimitSuspected: true,
    });
    expect(outcome.tableChunks[0].deterministicFailure).toBeUndefined();
  });
});
