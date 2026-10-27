// tests/financial-report/classify-assumptions.test.ts
// B3 (vòng #03) — phân biệt UNSUPPORTED_DOCUMENT vs UNRECOGNIZED_REPORT_STRUCTURE khi
// Gemini Flash BỎ TRỐNG isFinancialReport + KHÔNG có tín hiệu tài chính → UNSUPPORTED_DOCUMENT

const prepareChunkAssetsMock = jest.fn();
const enqueueSubStepMock = jest.fn();

jest.mock('@/lib/pipelines/workflow-engine', () => ({
  enqueueSubStep: (...args: unknown[]) => enqueueSubStepMock(...args),
  parseDeep: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
}));

// Vòng #05 mục 34: điểm vào duy nhất để dựng chunk là `prepareChunkAssets`.
jest.mock('@/lib/pipelines/workflows/financial-report/pdf-utils', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflows/financial-report/pdf-utils');
  return {
    ...actual,
    prepareChunkAssets: (...args: unknown[]) => prepareChunkAssetsMock(...args),
  };
});

import { classifyDocument } from '@/lib/pipelines/workflows/financial-report/classify';
import type { PageSource } from '@/lib/pipelines/workflows/financial-report/pdf-utils';
import { REPORT_TYPES, type FinancialReportConfig } from '@/lib/pipelines/workflows/financial-report/types';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const ctx = {
  operationId: 'op-test',
  logger,
  promptOverrides: {},
  modelOverrides: {},
  reasoningEffortOverrides: {},
  pipelineVars: {},
} as never;

const config: FinancialReportConfig = {
  targetLang: 'vi',
  requestId: 'REQ-1',
  pagesPerChunk: 2,
  notesPagesPerChunk: 1,
  classifyPagesPerCall: 8,
  classifyRecheckUnassigned: true,
  classifyRecheckMaxWindows: 2,
  maxRetries: 1,
  maxConcurrency: 2,
  staggerDelayMs: 0,
  enableTranslation: false,
  renderScale: 2.5,
  reportTypes: [],
};

const source: PageSource = {
  mode: 'pdf',
  totalPages: 2,
  pageBuffers: [Buffer.from('a'), Buffer.from('b')],
  originalBuffer: null,
  encrypted: false,
  renderScale: 2.5,
};

/** Danh sách 6 reportType, mặc định không tìm thấy gì. */
function emptyReports() {
  return REPORT_TYPES.map((reportType) => ({ reportType, pageFrom: null, pageTo: null, titleFound: null }));
}

function classifyResponse(body: Record<string, unknown>) {
  return { content: JSON.stringify({ sourceLanguage: 'ja', reports: emptyReports(), ...body }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  prepareChunkAssetsMock.mockResolvedValue({ filesJson: '[]', storageKeys: ['k1'] });
});

describe('B3 — không tìm thấy report nào', () => {
  it('AI bỏ trống isFinancialReport VÀ không có tín hiệu tài chính → UNSUPPORTED_DOCUMENT', async () => {
    enqueueSubStepMock.mockResolvedValue(classifyResponse({ companyName: 'Công ty TNHH Hợp đồng' }));

    await expect(classifyDocument(ctx, 'contract.pdf', source, config, 'f1', []))
      .rejects.toThrow(/UNSUPPORTED_DOCUMENT/);
  });

  it('AI nói rõ isFinancialReport = false → UNSUPPORTED_DOCUMENT (kể cả có tiền tệ)', async () => {
    enqueueSubStepMock.mockResolvedValue(classifyResponse({ isFinancialReport: false, currency: 'JPY' }));

    await expect(classifyDocument(ctx, 'invoice.pdf', source, config, 'f1', []))
      .rejects.toThrow(/UNSUPPORTED_DOCUMENT/);
  });

  it('AI bỏ trống NHƯNG có tín hiệu tài chính (đơn vị số liệu) → UNRECOGNIZED_REPORT_STRUCTURE', async () => {
    enqueueSubStepMock.mockResolvedValue(classifyResponse({ unit: '百万円' }));

    await expect(classifyDocument(ctx, 'weird-bctc.pdf', source, config, 'f1', []))
      .rejects.toThrow(/UNRECOGNIZED_REPORT_STRUCTURE/);
  });

  it('AI bỏ trống NHƯNG có kỳ báo cáo → UNRECOGNIZED_REPORT_STRUCTURE', async () => {
    enqueueSubStepMock.mockResolvedValue(classifyResponse({ fromDate: '2024-04-01', toDate: '2025-03-31' }));

    await expect(classifyDocument(ctx, 'weird-bctc.pdf', source, config, 'f1', []))
      .rejects.toThrow(/UNRECOGNIZED_REPORT_STRUCTURE/);
  });

  it('AI xác nhận isFinancialReport = true → UNRECOGNIZED_REPORT_STRUCTURE', async () => {
    enqueueSubStepMock.mockResolvedValue(classifyResponse({ isFinancialReport: true }));

    await expect(classifyDocument(ctx, 'weird-bctc.pdf', source, config, 'f1', []))
      .rejects.toThrow(/UNRECOGNIZED_REPORT_STRUCTURE/);
  });

  it('toàn bộ trang trắng → EMPTY_OR_BLANK_PAGES (ưu tiên hơn 2 mã trên)', async () => {
    enqueueSubStepMock.mockResolvedValue(classifyResponse({ blank: true }));

    await expect(classifyDocument(ctx, 'blank.pdf', source, config, 'f1', []))
      .rejects.toThrow(/EMPTY_OR_BLANK_PAGES/);
  });

  it('mọi cửa sổ classify đều lỗi → OCR_LOW_CONFIDENCE', async () => {
    enqueueSubStepMock.mockRejectedValue(new Error('AI down'));

    await expect(classifyDocument(ctx, 'blur.pdf', source, config, 'f1', []))
      .rejects.toThrow(/OCR_LOW_CONFIDENCE/);
  });
});

describe('B3 — tìm thấy report thì không bao giờ bỏ trống isFinancialReport', () => {
  it('có report → vẫn chạy tiếp bình thường, không bắn errorCode nào', async () => {
    const reports = emptyReports().map((r) =>
      r.reportType === 'balanceSheet' ? { ...r, pageFrom: 1, pageTo: 2, titleFound: '貸借対照表' } : r);
    enqueueSubStepMock.mockResolvedValue({
      content: JSON.stringify({ sourceLanguage: 'ja', currency: 'JPY', unit: '百万円', reports }),
    });

    const outcome = await classifyDocument(ctx, 'og.pdf', source, config, 'f1', []);
    expect(outcome.locations).toHaveLength(1);
    expect(outcome.locations[0].reportType).toBe('balanceSheet');
    expect(outcome.sourceLanguage).toBe('ja');
  });

  it('sourceLanguage nhận mã ISO tự do (Q1 generic)', async () => {
    const reports = emptyReports().map((r) =>
      r.reportType === 'balanceSheet' ? { ...r, pageFrom: 1, pageTo: 1, titleFound: 'Balance Sheet' } : r);
    enqueueSubStepMock.mockResolvedValue({
      content: JSON.stringify({ sourceLanguage: 'ko', reports }),
    });

    const outcome = await classifyDocument(ctx, 'kr.pdf', source, config, 'f1', []);
    expect(outcome.sourceLanguage).toBe('ko');
  });
});
