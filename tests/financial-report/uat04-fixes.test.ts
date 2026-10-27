// tests/financial-report/uat04-fixes.test.ts
// UAT #04 — regression guard cho các lỗi Sony phát hiện sau UAT thật.
// Mọi test T1..T9 của kế hoạch hợp nhất nằm trong file này.

const mockPrepareChunkAssets = jest.fn();
const mockEnqueueSubStep = jest.fn();

jest.mock('@/lib/pipelines/workflow-engine', () => ({
  enqueueSubStep: (...args: unknown[]) => mockEnqueueSubStep(...args),
  parseDeep: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
}));

jest.mock('@/lib/pipelines/workflows/financial-report/pdf-utils', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflows/financial-report/pdf-utils');
  return {
    ...actual,
    prepareChunkAssets: (...args: unknown[]) => mockPrepareChunkAssets(...args),
  };
});

import {
  classifyDocument,
  detectPeriodScope,
  detectStatementKind,
  findUnassignedPages,
  mergeLocations,
  normalizeClassifyResult,
} from '@/lib/pipelines/workflows/financial-report/classify';
import { mergeNotesReport, mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import {
  describeInvalidNotesJson,
  extractReports,
  looksDegenerateOutput,
  summarizeNotesOutputLimits,
  type TableChunkOutcome,
} from '@/lib/pipelines/workflows/financial-report/extract';
import type { PageSource } from '@/lib/pipelines/workflows/financial-report/pdf-utils';
import { buildPayload, resolveDegradation } from '@/lib/pipelines/workflows/financial-report-translation';
import { buildClassifyPrompt } from '@/lib/pipelines/workflows/prompts/financial-report-prompts';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import { applySgaFallback } from '@/lib/pipelines/workflows/financial-report/sga-fallback';
import { createEmptyPayload } from '@/lib/pipelines/workflows/financial-report/types';
import type {
  ClassifyResult,
  FileProcessingInfo,
  FinancialReportConfig,
  InternalFinancialReportPayload,
  ReportTable,
} from '@/lib/pipelines/workflows/financial-report/types';

function location(
  reportType: ReportLocation['reportType'],
  pageFrom: number,
  pageTo: number,
): ReportLocation {
  return { reportType, pageFrom, pageTo, titleSource: null };
}

function mergeClassifyEntries(entries: ClassifyResult['reports']): ReportLocation[] {
  return mergeLocations([{ sourceLanguage: 'ja', reports: entries }], 29, []);
}

describe('UAT #04 / T1 — độ phủ trang classify', () => {
  it('Sony trả đủ 10 trang chưa gán, gồm trang 13 là KQKD toàn diện quý 4', () => {
    const locations: ReportLocation[] = [
      location('incomeStatement', 10, 12),
      location('equityChangeStatement', 14, 15),
      location('cashFlowStatement', 16, 17),
      location('notesToFinancialStatements', 18, 29),
    ];

    expect(findUnassignedPages(locations, 29)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 13]);
  });

  it('trả mảng rỗng khi location đã phủ toàn bộ trang', () => {
    const locations: ReportLocation[] = [
      location('balanceSheet', 1, 3),
      location('incomeStatement', 4, 6),
    ];

    expect(findUnassignedPages(locations, 6)).toEqual([]);
  });
});

describe('UAT #04 / T2 — giữ biên giới biến thể khi gộp location', () => {
  it('tách KQKD năm và báo cáo toàn diện năm có tiêu đề riêng ở trang liền nhau', () => {
    const locations = mergeClassifyEntries([
      {
        reportType: 'incomeStatement',
        pageFrom: 8,
        pageTo: 9,
        titleFound: '（２）連結損益計算書［連結会計年度］',
      },
      {
        reportType: 'incomeStatement',
        pageFrom: 10,
        pageTo: 10,
        titleFound: '（３）連結包括利益計算書［連結会計年度］',
      },
    ]);

    expect(locations).toEqual([
      {
        reportType: 'incomeStatement',
        pageFrom: 8,
        pageTo: 9,
        titleSource: '（２）連結損益計算書［連結会計年度］',
        consolidation: 'CONSOLIDATED',
      },
      {
        reportType: 'incomeStatement',
        pageFrom: 10,
        pageTo: 10,
        titleSource: '（３）連結包括利益計算書［連結会計年度］',
        consolidation: 'CONSOLIDATED',
      },
    ]);
  });

  it('nối các trang tiếp nối không có tiêu đề riêng của bảng cân đối', () => {
    const locations = mergeClassifyEntries([
      { reportType: 'balanceSheet', pageFrom: 5, pageTo: 5, titleFound: '（１）連結財政状態計算書' },
      { reportType: 'balanceSheet', pageFrom: 6, pageTo: 6, titleFound: null },
      { reportType: 'balanceSheet', pageFrom: 7, pageTo: 7, titleFound: null },
    ]);

    expect(locations).toEqual([{
      reportType: 'balanceSheet',
      pageFrom: 5,
      pageTo: 7,
      titleSource: '（１）連結財政状態計算書',
      consolidation: 'CONSOLIDATED',
    }]);
  });
});

describe('UAT #04 / T3 — classify theo từng trang', () => {
  it('prompt yêu cầu pages[] và giữ đủ luật loại trừ trang bìa, tóm lược và thuyết minh', () => {
    const prompt = buildClassifyPrompt(1, 8, 29)._prompt as string;

    expect(prompt).toContain('"pages"');
    expect(prompt).toContain('MỖI trang');
    expect(prompt).toContain('CONTINUATION_UNKNOWN');
    expect(prompt).toContain('tóm lược chỉ số');
    expect(prompt).toContain('…に関する注記');
    expect(prompt).toContain('TUYỆT ĐỐI KHÔNG dùng riêng 「資産合計」');
  });

  it('suy một location bảng cân đối Sony 5–7 từ TITLE và CONTINUATION', () => {
    const normalized = normalizeClassifyResult({
      sourceLanguage: 'ja',
      reports: [],
      pages: [
        { page: 1, reportType: null, basis: 'NONE', titleFound: null },
        { page: 2, reportType: null, basis: 'NONE', titleFound: null },
        { page: 3, reportType: null, basis: 'NONE', titleFound: null },
        { page: 4, reportType: null, basis: 'NONE', titleFound: null },
        { page: 5, reportType: 'balanceSheet', basis: 'TITLE', titleFound: '連結財政状態計算書' },
        { page: 6, reportType: 'balanceSheet', basis: 'CONTINUATION', titleFound: null },
        { page: 7, reportType: 'balanceSheet', basis: 'CONTINUATION', titleFound: null },
      ],
    }, { from: 1, to: 8 }, 29);

    expect(normalized.reports).toEqual([{
      reportType: 'balanceSheet',
      pageFrom: 5,
      pageTo: 7,
      titleFound: '連結財政状態計算書',
    }]);
  });

  it('giữ đường reports[] cũ khi Profile override chưa trả pages[]', () => {
    const normalized = normalizeClassifyResult({
      sourceLanguage: 'ja',
      reports: [{
        reportType: 'cashFlowStatement',
        pageFrom: 16,
        pageTo: 17,
        titleFound: '連結キャッシュ・フロー計算書',
      }],
    }, { from: 14, to: 18 }, 29);

    expect(normalized.pages).toBeUndefined();
    expect(normalized.reports.find((entry) => entry.reportType === 'cashFlowStatement')).toMatchObject({
      pageFrom: 16,
      pageTo: 17,
      titleFound: '連結キャッシュ・フロー計算書',
    });
  });

  it('loại page label nằm ngoài cửa sổ classify thay vì kẹp sang trang khác', () => {
    const stats = { titlesRejectedAsProse: 0, pageNumberCorrections: 0 };
    const normalized = normalizeClassifyResult({
      sourceLanguage: 'ja',
      reports: [],
      pages: [
        { page: 0, reportType: 'balanceSheet', basis: 'TITLE', titleFound: 'bad before' },
        { page: 5, reportType: 'balanceSheet', basis: 'TITLE', titleFound: '連結財政状態計算書' },
        { page: 9, reportType: 'balanceSheet', basis: 'CONTINUATION', titleFound: null },
      ],
    }, { from: 1, to: 8 }, 29, stats);

    expect(normalized.pages).toEqual([{
      page: 5,
      reportType: 'balanceSheet',
      basis: 'TITLE',
      titleFound: '連結財政状態計算書',
    }]);
    expect(normalized.reports).toEqual([{
      reportType: 'balanceSheet',
      pageFrom: 5,
      pageTo: 5,
      titleFound: '連結財政状態計算書',
    }]);
    expect(stats.pageNumberCorrections).toBe(0);
  });

  it('giữ entry một trang khi AI trả sai số trang và CODE đóng dấu trang thật', () => {
    const stats = { titlesRejectedAsProse: 0, pageNumberCorrections: 0 };
    const normalized = normalizeClassifyResult({
      sourceLanguage: 'ja',
      reports: [],
      pages: [{
        page: 6,
        reportType: 'balanceSheet',
        basis: 'TITLE',
        titleFound: '連結財政状態計算書',
      }],
    }, { from: 5, to: 5 }, 29, stats);

    expect(normalized.pages).toEqual([{
      page: 5,
      reportType: 'balanceSheet',
      basis: 'TITLE',
      titleFound: '連結財政状態計算書',
    }]);
    expect(normalized.reports).toEqual([{
      reportType: 'balanceSheet',
      pageFrom: 5,
      pageTo: 5,
      titleFound: '連結財政状態計算書',
    }]);
    expect(stats.pageNumberCorrections).toBe(1);
  });
});


const recheckLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const recheckCtx = {
  operationId: 'uat04-recheck',
  logger: recheckLogger,
  promptOverrides: {},
  modelOverrides: {},
  reasoningEffortOverrides: {},
  pipelineVars: {},
} as never;

function recheckConfig(overrides: Partial<FinancialReportConfig> = {}): FinancialReportConfig {
  return {
    targetLang: 'vi',
    requestId: 'UAT-04',
    pagesPerChunk: 2,
    notesPagesPerChunk: 1,
    classifyPagesPerCall: 29,
    classifyRecheckUnassigned: true,
    classifyRecheckMaxWindows: 2,
    maxRetries: 1,
    maxConcurrency: 1,
    staggerDelayMs: 0,
    enableTranslation: false,
    renderScale: 2.5,
    reportTypes: [],
    ...overrides,
  };
}

function classifySource(totalPages: number): PageSource {
  return {
    mode: 'pdf',
    totalPages,
    pageBuffers: Array.from({ length: totalPages }, (_, index) => Buffer.from(`page-${index + 1}`)),
    originalBuffer: null,
    encrypted: false,
    renderScale: 2.5,
  };
}

function classifyResponse(
  reports: ClassifyResult['reports'],
  pages?: ClassifyResult['pages'],
) {
  return {
    content: JSON.stringify({
      sourceLanguage: 'ja',
      isFinancialReport: true,
      currency: 'JPY',
      reports,
      ...(pages ? { pages } : {}),
    }),
  };
}

const sonyInitialReports: ClassifyResult['reports'] = [
  { reportType: 'incomeStatement', pageFrom: 10, pageTo: 12, titleFound: '（３）連結包括利益計算書［連結会計年度］' },
  { reportType: 'equityChangeStatement', pageFrom: 14, pageTo: 15, titleFound: '連結持分変動計算書' },
  { reportType: 'cashFlowStatement', pageFrom: 16, pageTo: 17, titleFound: '連結キャッシュ・フロー計算書' },
  { reportType: 'notesToFinancialStatements', pageFrom: 18, pageTo: 29, titleFound: '注記事項' },
];

/** T2.3: các dải Sony cần soi lại phải có bằng chứng hasTable thay vì chỉ dùng reports[] legacy. */
const sonyInitialPages: NonNullable<ClassifyResult['pages']> = Array.from({ length: 29 }, (_, index) => {
  const page = index + 1;
  if (page <= 9 || page === 13) {
    return { page, reportType: null, basis: 'NONE', titleFound: null, hasTable: true };
  }
  if (page === 10) {
    return { page, reportType: 'incomeStatement', basis: 'TITLE', titleFound: '（３）連結包括利益計算書［連結会計年度］', hasTable: true };
  }
  if (page <= 12) return { page, reportType: 'incomeStatement', basis: 'CONTINUATION', titleFound: null, hasTable: true };
  if (page === 14) return { page, reportType: 'equityChangeStatement', basis: 'TITLE', titleFound: '連結持分変動計算書', hasTable: true };
  if (page === 15) return { page, reportType: 'equityChangeStatement', basis: 'CONTINUATION', titleFound: null, hasTable: true };
  if (page === 16) return { page, reportType: 'cashFlowStatement', basis: 'TITLE', titleFound: '連結キャッシュ・フロー計算書', hasTable: true };
  if (page === 17) return { page, reportType: 'cashFlowStatement', basis: 'CONTINUATION', titleFound: null, hasTable: true };
  if (page === 18) return { page, reportType: 'notesToFinancialStatements', basis: 'TITLE', titleFound: '注記事項', hasTable: false };
  return { page, reportType: 'notesToFinancialStatements', basis: 'CONTINUATION', titleFound: null, hasTable: false };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrepareChunkAssets.mockResolvedValue({ filesJson: '[]', storageKeys: ['uat04-chunk'] });
});

describe('UAT #04 / T4 — soi lại trang classify chưa gán', () => {
  it('không gọi AI thêm khi chỉ còn một trang chưa gán', async () => {
    mockEnqueueSubStep.mockResolvedValueOnce(classifyResponse([
      { reportType: 'balanceSheet', pageFrom: 1, pageTo: 1, titleFound: '貸借対照表' },
    ]));

    const outcome = await classifyDocument(recheckCtx, 'one-gap.pdf', classifySource(2), recheckConfig({ classifyPagesPerCall: 2 }), 'f1', []);

    expect(mockEnqueueSubStep).toHaveBeenCalledTimes(1);
    expect(outcome.recheckWindows).toBe(0);
    expect(outcome.unassignedPages).toEqual([2]);
  });

  it('Sony chỉ soi lại dải 1–9 có bảng chưa gán; p13 được T2.2 nối vào KQKD liền trước', async () => {
    mockEnqueueSubStep
      .mockResolvedValueOnce(classifyResponse(sonyInitialReports, sonyInitialPages))
      .mockResolvedValueOnce(classifyResponse([
        { reportType: 'balanceSheet', pageFrom: 5, pageTo: 7, titleFound: '（１）連結財政状態計算書' },
        { reportType: 'incomeStatement', pageFrom: 8, pageTo: 9, titleFound: '（２）連結損益計算書［連結会計年度］' },
      ]));

    const outcome = await classifyDocument(recheckCtx, 'sony.pdf', classifySource(29), recheckConfig(), 'f1', []);
    const prompts = mockEnqueueSubStep.mock.calls.map((call) => String((call[2] as { _prompt?: unknown })._prompt));

    expect(mockEnqueueSubStep).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain('Các trang 1–9 đã bị bỏ sót');
    expect(prompts.join('\n')).not.toContain('Các trang 13–13 đã bị bỏ sót');
    expect(outcome.recheckWindows).toBe(1);
    expect(outcome.locations.some((location) => location.fromRecheckPass && location.pageFrom === 5 && location.pageTo === 7)).toBe(true);
  });

  it('giới hạn classifyRecheckMaxWindows = 1 chỉ soi dải Sony dài nhất 1–9', async () => {
    mockEnqueueSubStep
      .mockResolvedValueOnce(classifyResponse(sonyInitialReports, sonyInitialPages))
      .mockResolvedValueOnce(classifyResponse([
        { reportType: 'balanceSheet', pageFrom: 5, pageTo: 7, titleFound: '（１）連結財政状態計算書' },
      ]));

    const outcome = await classifyDocument(
      recheckCtx,
      'sony.pdf',
      classifySource(29),
      recheckConfig({ classifyRecheckMaxWindows: 1 }),
      'f1',
      [],
    );
    const prompts = mockEnqueueSubStep.mock.calls.map((call) => String((call[2] as { _prompt?: unknown })._prompt));

    expect(mockEnqueueSubStep).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain('Các trang 1–9 đã bị bỏ sót');
    expect(prompts.join('\n')).not.toContain('Các trang 13–13 đã bị bỏ sót');
    expect(outcome.recheckWindows).toBe(1);
  });

  it('tắt classifyRecheckUnassigned thì không bao giờ gọi lượt soi lại', async () => {
    mockEnqueueSubStep.mockResolvedValueOnce(classifyResponse(sonyInitialReports, sonyInitialPages));

    const outcome = await classifyDocument(
      recheckCtx,
      'sony.pdf',
      classifySource(29),
      recheckConfig({ classifyRecheckUnassigned: false }),
      'f1',
      [],
    );

    expect(mockEnqueueSubStep).toHaveBeenCalledTimes(1);
    expect(outcome.recheckWindows).toBe(0);
    expect(outcome.unassignedPages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});


function variantLocation(
  pageFrom: number,
  pageTo: number,
  titleSource: string,
): ReportLocation {
  return { reportType: 'incomeStatement', pageFrom, pageTo, titleSource };
}

function incomeStatementChunk(
  locationIndex: number,
  pageFrom: number,
  pageTo: number,
  amount2025: string,
  amount2026: string,
): TableChunkOutcome {
  return {
    reportType: 'incomeStatement',
    locationIndex,
    chunkIndex: 0,
    pageFrom,
    pageTo,
    result: {
      reportType: 'incomeStatement',
      unitSource: '百万円',
      tables: [{
        columns: [
          { id: 'fy2025', labelSource: '2025', dataType: 'number', period: '2025-03-31' },
          { id: 'fy2026', labelSource: '2026', dataType: 'number', period: '2026-03-31' },
        ],
        rows: [{
          rowId: 'sales',
          labelSource: '売上高',
          rowType: 'DETAIL',
          sourcePage: pageFrom,
          values: { fy2025: amount2025, fy2026: amount2026 },
        }],
      }],
    },
    aiWarnings: [],
    failureReason: null,
  };
}

describe('UAT #04 / T5 — nhãn và thứ tự biến thể KQKD', () => {
  it('nhận đúng kỳ quý trước khi xét 年度 và nhận đúng loại báo cáo kết hợp', () => {
    expect(detectPeriodScope('連結損益計算書［第４四半期連結会計年度］')).toBe('QUARTER');
    expect(detectPeriodScope('連結損益計算書［連結会計年度］')).toBe('FULL_YEAR');
    expect(detectStatementKind('連結損益計算書及び連結包括利益計算書')).toBe('COMBINED');
    expect(detectStatementKind('連結包括利益計算書')).toBe('COMPREHENSIVE_INCOME');
  });

  it('R1 — Sony có cả năm và quý 4: LOẠI bảng quý, chỉ giữ bảng cả năm, ghi rõ bảng bị loại', () => {
    const report = mergeTabularReport(
      'incomeStatement',
      [
        variantLocation(11, 12, '連結損益計算書［第４四半期連結会計期間］'),
        variantLocation(8, 9, '連結損益計算書［連結会計年度］'),
      ],
      [
        incomeStatementChunk(0, 11, 12, '2,804,938', '3,036,417'),
        incomeStatementChunk(1, 8, 9, '12,034,917', '12,479,620'),
      ],
    );

    // R1: chỉ còn bảng kỳ năm, bảng kỳ quý bị loại khỏi output.
    expect(report.tables).toHaveLength(1);
    expect(report.tables[0]).toMatchObject({
      periodScope: 'FULL_YEAR',
      statementKind: 'PROFIT_LOSS',
      variantTitle: { source: '連結損益計算書［連結会計年度］', translated: null },
    });
    expect(report.tables[0].rows[0].values).toMatchObject({
      fy2025: { normalized: 12034917 },
      fy2026: { normalized: 12479620 },
    });
    // Không còn bảng kỳ quý nào trong tables.
    expect(report.tables.some((table) => table.periodScope === 'QUARTER')).toBe(false);
    // Bảng quý bị loại phải truy được trong chẩn đoán.
    const dropWarning = report.warnings.find((warning) => warning.code === 'MULTIPLE_VARIANTS_MERGED');
    expect(dropWarning?.message).toContain('R1');
    expect(dropWarning?.message).toContain('loại 1 bảng kỳ quý');
    expect(dropWarning?.message).toContain('trang 11-12');
    // Đã có bảng cả năm nên KHÔNG cảnh báo thiếu kỳ năm.
    expect(report.warnings.map((warning) => warning.code)).not.toContain('FULL_YEAR_VARIANT_MISSING');
  });

  it('cảnh báo chỉ có kỳ quý, nhưng không cảnh báo biến thể cho báo cáo một bảng cả năm', () => {
    const onlyQuarter = mergeTabularReport(
      'incomeStatement',
      [variantLocation(11, 12, '連結損益計算書［第４四半期連結会計期間］')],
      [incomeStatementChunk(0, 11, 12, '2,804,938', '3,036,417')],
    );
    const onlyFullYear = mergeTabularReport(
      'incomeStatement',
      [variantLocation(8, 9, '連結損益計算書［連結会計年度］')],
      [incomeStatementChunk(0, 8, 9, '12,034,917', '12,479,620')],
    );

    expect(onlyQuarter.warnings.map((warning) => warning.code)).toContain('FULL_YEAR_VARIANT_MISSING');
    expect(onlyQuarter.warnings.map((warning) => warning.code)).not.toContain('MULTIPLE_VARIANTS_MERGED');
    expect(onlyFullYear.warnings.map((warning) => warning.code)).not.toContain('MULTIPLE_VARIANTS_MERGED');
    expect(onlyFullYear.warnings.map((warning) => warning.code)).not.toContain('FULL_YEAR_VARIANT_MISSING');
  });
});


function sgaIncomeTable(
  periodScope: 'FULL_YEAR' | 'QUARTER',
  sourcePage: number,
  amount2025: number,
  amount2026: number,
): ReportTable {
  return {
    tableId: `income-${periodScope}-${sourcePage}`,
    periodScope,
    statementKind: 'PROFIT_LOSS',
    variantTitle: { source: periodScope === 'FULL_YEAR' ? '連結損益計算書［連結会計年度］' : '連結損益計算書［第４四半期］', translated: null },
    columns: [
      { id: 'fy2025', label: { source: '2025', translated: null }, dataType: 'number', period: '2025-03-31' },
      { id: 'fy2026', label: { source: '2026', translated: null }, dataType: 'number', period: '2026-03-31' },
    ],
    rows: [{
      rowId: `sga-${sourcePage}`,
      parentRowId: null,
      level: 1,
      rowType: 'DETAIL',
      statementSection: null,
      label: { source: '販売費及び一般管理費', translated: null },
      sourcePage,
      values: {
        fy2025: { raw: String(amount2025), normalized: amount2025 },
        fy2026: { raw: String(amount2026), normalized: amount2026 },
      },
    }],
  };
}

function sgaFallbackPayload(tables: ReportTable[]): InternalFinancialReportPayload {
  const payload = createEmptyPayload('ja', 'vi');
  payload.generalInformation.unit = { source: '百万円', translated: null, multiplier: 1_000_000 };
  payload.incomeStatement = {
    status: 'FOUND',
    title: { source: '連結損益計算書', translated: null },
    pageRanges: tables.map((table) => {
      const page = table.rows[0]?.sourcePage ?? 0;
      return { from: page, to: page };
    }),
    unit: { source: '百万円', translated: null, multiplier: 1_000_000 },
    warnings: [],
    tables,
  };
  return payload;
}

describe('UAT #04 / T6 — fallback SG&A ưu tiên bảng cả năm', () => {
  it('giữ nguyên fallback OG Corp với một bảng duy nhất và số 7,915', () => {
    const payload = sgaFallbackPayload([sgaIncomeTable('FULL_YEAR', 5, 7_915, 7_915)]);

    const outcome = applySgaFallback(payload);

    expect(outcome.kind).toBe('derived');
    expect(payload.sgaBreakdown).toMatchObject({ status: 'PARTIAL' });
    expect(payload.sgaBreakdown.tables[0].rows[0].values.fy2026.normalized).toBe(7915);
    expect(payload.sgaBreakdown.warnings.map((warning) => warning.code)).toEqual([
      'DETAIL_NOT_FOUND',
      'SGA_DERIVED_FROM_INCOME_STATEMENT',
    ]);
  });

  it('ưu tiên đúng một bảng Sony FULL_YEAR thay vì bảng quý 4', () => {
    const payload = sgaFallbackPayload([
      sgaIncomeTable('QUARTER', 11, 599_224, 647_221),
      sgaIncomeTable('FULL_YEAR', 8, 2_256_829, 2_298_638),
    ]);

    const outcome = applySgaFallback(payload);

    expect(outcome.kind).toBe('derived');
    expect(payload.sgaBreakdown.tables[0].rows[0].values).toMatchObject({
      fy2025: { normalized: 2256829 },
      fy2026: { normalized: 2298638 },
    });
    expect(payload.sgaBreakdown.warnings.find((warning) => warning.code === 'SGA_DERIVED_FROM_INCOME_STATEMENT')?.message)
      .toContain('Đã ưu tiên bảng kỳ cả năm.');
  });

  it('không suy diễn khi có hai bảng FULL_YEAR cùng chứa dòng SG&A', () => {
    const payload = sgaFallbackPayload([
      sgaIncomeTable('FULL_YEAR', 8, 2_256_829, 2_298_638),
      sgaIncomeTable('FULL_YEAR', 20, 1_000, 2_000),
    ]);

    const outcome = applySgaFallback(payload);

    expect(outcome).toMatchObject({ kind: 'skipped', reason: expect.stringContaining('2 dòng SG&A') });
    expect(payload.sgaBreakdown.status).toBe('NOT_FOUND');
  });
});


describe('UAT #04 / T7 — chặn phản hồi Notes lặp/cụt do trần token', () => {
  it('nhận diện phản hồi dài bất thường hoặc có chuỗi ký tự lặp, nhưng không nhầm JSON ngắn hợp lệ', () => {
    expect(looksDegenerateOutput('-'.repeat(800_000))).toBe(true);
    expect(looksDegenerateOutput('-'.repeat(300))).toBe(true);
    expect(looksDegenerateOutput('{"sections":[]}')).toBe(false);
  });

  it('không để bất kỳ nhánh thông điệp runtime nào dùng cụm bị cấm và nói đúng nguyên nhân chất lượng ảnh', () => {
    expect(describeInvalidNotesJson('-'.repeat(300))).toContain('trần token đầu ra');
    expect(describeInvalidNotesJson('{"sections":[')).not.toContain('ảnh mờ');
    expect(describeInvalidNotesJson('[]')).toContain('không phải lỗi chất lượng ảnh');
    expect(describeInvalidNotesJson('-'.repeat(300))).not.toContain('ảnh mờ');
    expect(describeInvalidNotesJson('{"sections":[')).not.toContain('ảnh mờ');
    expect(describeInvalidNotesJson('[]')).not.toContain('ảnh mờ');
  });

  it('dừng mỗi Notes chunk lặp/cụt sau tối đa hai lần, không chạy lại ở lượt retry chung và ghi đúng counters/warning', async () => {
    mockEnqueueSubStep.mockResolvedValue({ content: '-'.repeat(300) });

    const outcome = await extractReports(
      recheckCtx,
      'sony-notes.pdf',
      classifySource(25),
      [
        { reportType: 'notesToFinancialStatements', pageFrom: 18, pageTo: 18, titleSource: '注記事項' },
        { reportType: 'notesToFinancialStatements', pageFrom: 25, pageTo: 25, titleSource: '注記事項' },
      ],
      recheckConfig({ maxRetries: 3, maxConcurrency: 2 }),
      't7',
      [],
    );

    expect(mockEnqueueSubStep).toHaveBeenCalledTimes(4);
    expect(outcome.notesChunks).toHaveLength(2);
    expect(outcome.notesChunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ deterministicFailure: true, aiOutputLimitHits: 2 }),
    ]));
    expect(outcome.notesChunks.map((chunk) => chunk.failureReason).join('\n')).toContain('trần token đầu ra');

    const counters = summarizeNotesOutputLimits(outcome.notesChunks);
    expect(counters).toEqual({ aiOutputLimitHits: 4, deterministicChunkFailures: 2 });

    const report = mergeNotesReport(
      [
        { reportType: 'notesToFinancialStatements', pageFrom: 18, pageTo: 18, titleSource: '注記事項' },
        { reportType: 'notesToFinancialStatements', pageFrom: 25, pageTo: 25, titleSource: '注記事項' },
      ],
      outcome.notesChunks,
    );
    expect(report.status).toBe('UNREADABLE');
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: 'NOTES_PAGE_AI_OUTPUT_LIMIT' }));
  }, 10_000);
});


describe('UAT #04 / T8 — đơn vị riêng theo từng bảng', () => {
  it('tách bảng khi unitSource đổi trong cùng incomeStatement, giữ unit theo bảng và cảnh báo rõ phạm vi', () => {
    const first = incomeStatementChunk(0, 5, 5, '12,034,917', '12,479,620');
    const second = incomeStatementChunk(0, 6, 6, '1', '2');
    second.chunkIndex = 1;
    second.result = {
      ...second.result!,
      unitSource: '円',
      tables: second.result!.tables?.map((table) => ({ ...table, isContinuation: true })),
    };

    const report = mergeTabularReport(
      'incomeStatement',
      [variantLocation(5, 6, '連結損益計算書［連結会計年度］')],
      [first, second],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.tables.map((table) => table.unit)).toEqual([
      expect.objectContaining({ source: '百万円', multiplier: 1_000_000 }),
      expect.objectContaining({ source: '円', multiplier: 1 }),
    ]);
    expect(report.unit).toBeNull();
    expect(report.warnings).toContainEqual(expect.objectContaining({
      code: 'UNIT_VARIES_WITHIN_REPORT',
      message: expect.stringContaining('incomeStatement-1 (百万円)'),
    }));
    expect(report.warnings.find((warning) => warning.code === 'UNIT_VARIES_WITHIN_REPORT')?.message)
      .toContain('incomeStatement-2 (円)');
  });

  it('ưu tiên table.unit trước report và đơn vị chung khi quyết định UNIT_NOT_FOUND', () => {
    const first = incomeStatementChunk(0, 5, 5, '12,034,917', '12,479,620');
    const second = incomeStatementChunk(0, 6, 6, '1', '2');
    second.chunkIndex = 1;
    second.result = {
      ...second.result!,
      unitSource: '円',
      tables: second.result!.tables?.map((table) => ({ ...table, isContinuation: true })),
    };
    const classified = {
      sourceLanguage: 'ja',
      companyName: null,
      fromDate: null,
      toDate: null,
      currency: 'JPY',
      unit: null,
      locations: [variantLocation(5, 6, '連結損益計算書［連結会計年度］')],
      unassignedPages: [],
      classifiedWindows: 1,
      failedWindows: 0,
      failureReasons: [],
    } as never;

    const payload = buildPayload(
      recheckConfig(),
      classified,
      { tableChunks: [first, second], notesChunks: [] } as never,
    );

    expect(payload.generalInformation.unit.multiplier).toBeNull();
    expect(payload.incomeStatement.unit).toBeNull();
    expect(payload.incomeStatement.tables.map((table) => table.unit?.multiplier)).toEqual([1_000_000, 1]);
    expect(payload.incomeStatement.warnings.map((warning) => warning.code)).not.toContain('UNIT_NOT_FOUND');
  });
});


function coverageInfo(unassignedPages: number[], totalPages = 29): FileProcessingInfo {
  return {
    totalPages,
    pageSourceMode: 'image',
    encrypted: true,
    reportsFound: 3,
    classifyWindowsTotal: 4,
    classifyWindowsFailed: 0,
    extractChunksTotal: 12,
    extractChunksFailed: 0,
    tablesDiscardedAsOther: 0,
    failedPageRanges: [],
    unassignedPages,
    translationStatus: 'DONE',
    untranslatedItems: 0,
    failureReasons: [],
  };
}

describe('UAT #04 / T9 — coverage gate cho báo cáo cốt lõi', () => {
  it('gắn cảnh báo thiếu báo cáo cho core reports khi Sony còn 10 trang chưa gán', () => {
    const sonyUnassignedPages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13];
    const classified = {
      sourceLanguage: 'ja',
      companyName: null,
      fromDate: null,
      toDate: null,
      currency: 'JPY',
      unit: '百万円',
      locations: [],
      unassignedPages: sonyUnassignedPages,
      classifiedWindows: 4,
      failedWindows: 0,
      failureReasons: [],
    } as never;

    const payload = buildPayload(recheckConfig(), classified, { tableChunks: [], notesChunks: [] } as never);

    expect(payload.balanceSheet.warnings).toContainEqual(expect.objectContaining({
      code: 'REPORT_MISSING_WITH_UNASSIGNED_PAGES',
      message: expect.stringContaining('10 trang chưa gán'),
    }));
    expect(payload.incomeStatement.warnings.map((warning) => warning.code)).toContain('REPORT_MISSING_WITH_UNASSIGNED_PAGES');
    expect(payload.cashFlowStatement.warnings.map((warning) => warning.code)).toContain('REPORT_MISSING_WITH_UNASSIGNED_PAGES');
    expect(payload.equityChangeStatement.warnings.map((warning) => warning.code)).toContain('REPORT_MISSING_WITH_UNASSIGNED_PAGES');
    expect(payload.sgaBreakdown.warnings.map((warning) => warning.code)).not.toContain('REPORT_MISSING_WITH_UNASSIGNED_PAGES');
  });

  it('ghi INFO thay vì warning/degradation khi 10/85 trang chưa gán là non-data', () => {
    const unassignedPages = Array.from({ length: 10 }, (_, index) => index + 1);
    const diagnostics: string[] = [];
    const classified = {
      sourceLanguage: 'ja',
      companyName: null,
      fromDate: null,
      toDate: null,
      currency: 'JPY',
      unit: '百万円',
      locations: [],
      unassignedPages,
      classifiedWindows: 85,
      failedWindows: 0,
      failureReasons: [],
    } as never;

    const payload = buildPayload(recheckConfig(), classified, { tableChunks: [], notesChunks: [] } as never, (message) => diagnostics.push(message), 85);

    expect(payload.balanceSheet.warnings.map((warning) => warning.code)).not.toContain('REPORT_MISSING_WITH_UNASSIGNED_PAGES');
    expect(diagnostics).toContainEqual(expect.stringContaining('[INFO] Coverage chưa gán 10/85'));
    expect(resolveDegradation(payload, coverageInfo(unassignedPages, 85))).toBeNull();
  });

  it('giữ warning/degradation khi 50/85 trang chưa gán vượt ngưỡng coverage', () => {
    const unassignedPages = Array.from({ length: 50 }, (_, index) => index + 1);
    const classified = {
      sourceLanguage: 'ja',
      companyName: null,
      fromDate: null,
      toDate: null,
      currency: 'JPY',
      unit: '百万円',
      locations: [],
      unassignedPages,
      classifiedWindows: 85,
      failedWindows: 0,
      failureReasons: [],
    } as never;

    const payload = buildPayload(recheckConfig(), classified, { tableChunks: [], notesChunks: [] } as never, undefined, 85);

    expect(payload.balanceSheet.warnings.map((warning) => warning.code)).toContain('REPORT_MISSING_WITH_UNASSIGNED_PAGES');
    expect(resolveDegradation(payload, coverageInfo(unassignedPages, 85))).toEqual(expect.objectContaining({
      errorCode: 'UNRECOGNIZED_REPORT_STRUCTURE',
    }));
  });

  it('đưa Sony về PARTIAL_SUCCESS bằng UNRECOGNIZED_REPORT_STRUCTURE trước lỗi extract', () => {
    const payload = createEmptyPayload('ja', 'vi');
    const degradation = resolveDegradation(payload, coverageInfo([1, 2, 3, 4, 5, 6, 7, 8, 9, 13]));

    expect(degradation).toEqual(expect.objectContaining({
      errorCode: 'UNRECOGNIZED_REPORT_STRUCTURE',
      reason: expect.stringContaining('10 trang chưa phân loại'),
    }));
  });

  it('giữ OG SUCCESS khi cash flow thật sự không có nhưng không còn trang chưa gán', () => {
    const payload = createEmptyPayload('ja', 'vi');

    expect(resolveDegradation(payload, coverageInfo([]))).toBeNull();
  });

  it('không degrade chỉ vì một trang chưa gán', () => {
    const payload = createEmptyPayload('ja', 'vi');

    expect(resolveDegradation(payload, coverageInfo([13]))).toBeNull();
  });

  it('Round 11 D12 — không degrade coverage thấp dù có report core thiếu', () => {
    const payload = createEmptyPayload('ja', 'vi');
    payload.balanceSheet.status = 'FOUND';
    payload.incomeStatement.status = 'FOUND';
    payload.comprehensiveIncome.status = 'FOUND';
    payload.sgaBreakdown.status = 'FOUND';
    payload.notesToFinancialStatements.status = 'FOUND';

    expect(resolveDegradation(payload, {
      ...coverageInfo([13, 14]),
      reportsFound: 5,
    })).toBeNull();
  });
});


describe('Round 14 C1 — classifier accepts supplemental title aliases', () => {
  it('passes the Profile alias to the classifier prompt and retains the mocked TITLE result', async () => {
    mockEnqueueSubStep.mockResolvedValueOnce(classifyResponse([], [{
      page: 1,
      reportType: 'balanceSheet',
      basis: 'TITLE',
      titleFound: 'Custom Statement of Position',
      hasTable: true,
    }]));

    const outcome = await classifyDocument(
      recheckCtx,
      'custom-title.pdf',
      classifySource(1),
      recheckConfig({ supplementalReportTitleAliases: { balanceSheet: ['Custom Statement of Position'] } }),
      'f-c1',
      [],
    );
    const prompt = String((mockEnqueueSubStep.mock.calls[0][2] as { _prompt?: unknown })._prompt);

    expect(prompt).toContain('Custom Statement of Position');
    expect(prompt).toContain('貸借対照表');
    expect(outcome.locations).toEqual([expect.objectContaining({
      reportType: 'balanceSheet',
      pageFrom: 1,
      pageTo: 1,
      titleSource: 'Custom Statement of Position',
    })]);
  });
});
