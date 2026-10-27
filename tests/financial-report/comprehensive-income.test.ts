import { financialReportToMarkdown } from '@/lib/financial-report/client-helpers';
import { buildPayload, projectOutputPayload, summarizeReportStatuses } from '@/lib/pipelines/workflows/financial-report-translation';
import { translatePayload } from '@/lib/pipelines/workflows/financial-report/translate';
import type { ReportType } from '@/lib/pipelines/workflows/financial-report/types';
import {
  createEmptyPayload,
  REPORT_TYPES,
} from '@/lib/pipelines/workflows/financial-report/types';
import {
  REPORT_ALIASES,
  REPORT_TITLE_FALLBACK,
} from '@/lib/pipelines/workflows/prompts/financial-report-prompts';

describe('Round 11 T1.1 — comprehensiveIncome report type', () => {
  it('khai báo chính xác 7 report type nội bộ theo thứ tự routing và payload nội bộ có bucket CI riêng', () => {
    expect(REPORT_TYPES).toEqual([
      'balanceSheet',
      'incomeStatement',
      'comprehensiveIncome',
      'cashFlowStatement',
      'equityChangeStatement',
      'sgaBreakdown',
      'notesToFinancialStatements',
    ]);
    expect(REPORT_TYPES).toHaveLength(7);

    const payload = createEmptyPayload('ja', 'vi');
    expect(payload.comprehensiveIncome).toMatchObject({ status: 'NOT_FOUND', tables: [] });
  });

  it('tách alias và fallback của thu nhập toàn diện khỏi báo cáo lãi/lỗ', () => {
    expect(REPORT_ALIASES.comprehensiveIncome.ja).toEqual(expect.arrayContaining([
      '包括利益計算書',
      '連結包括利益計算書',
      '純損益及びその他の包括利益計算書',
    ]));
    expect(REPORT_ALIASES.comprehensiveIncome.en).toEqual(expect.arrayContaining([
      'Statement of Comprehensive Income',
      'Statements of Comprehensive Income',
    ]));
    expect(REPORT_ALIASES.incomeStatement.ja).not.toContain('包括利益計算書');
    expect(REPORT_ALIASES.incomeStatement.en).not.toContain('Statement of Comprehensive Income');
    expect(REPORT_TITLE_FALLBACK.comprehensiveIncome).toEqual({
      vi: 'Báo cáo thu nhập toàn diện',
      en: 'Statement of Comprehensive Income',
    });
  });

  it('chỉ gỡ CI tại biên output, không sửa payload nội bộ và có thể bật lại bằng Set rỗng', () => {
    const internalPayload = createEmptyPayload('ja', 'vi');
    const outputPayload = projectOutputPayload(internalPayload);
    const reenabledOutput = projectOutputPayload(internalPayload, new Set());

    expect(internalPayload.comprehensiveIncome).toMatchObject({ status: 'NOT_FOUND', tables: [] });
    expect(outputPayload).not.toHaveProperty('comprehensiveIncome');
    expect(reenabledOutput.comprehensiveIncome).toBe(internalPayload.comprehensiveIncome);
  });

  // HOTFIX 2026-08-18: run() gọi summarizeReportStatuses trên fileResult.report (payload ĐÃ CHIẾU,
  // CI đã bị gỡ). Trước fix, vòng lặp REPORT_TYPES đọc payload['comprehensiveIncome'].status trên
  // undefined → "Cannot read properties of undefined (reading 'status')" → WORKFLOW_ERROR uncaught,
  // làm MỌI file (không riêng JFE) FAILED ở khâu lắp ráp cuối dù classify/extract/translate đã xong.
  it('summarizeReportStatuses KHÔNG ném trên payload đã gỡ CI và bỏ đúng key đã suppress', () => {
    const projected = projectOutputPayload(createEmptyPayload('ja', 'vi'));

    expect(() => summarizeReportStatuses(projected)).not.toThrow();
    const summary = summarizeReportStatuses(projected);
    expect(summary).not.toHaveProperty('comprehensiveIncome');
    expect(summary.balanceSheet).toBe('NOT_FOUND');
    expect(summary.incomeStatement).toBe('NOT_FOUND');
  });

  it('R14-P3 suppresses sgaBreakdown only at the public boundary while internal translation and public UI mapping remain safe', async () => {
    const internalPayload = createEmptyPayload('ja', 'vi');
    const projected = projectOutputPayload(
      internalPayload,
      new Set<ReportType>(['comprehensiveIncome', 'sgaBreakdown']),
    );

    expect(projected).not.toHaveProperty('comprehensiveIncome');
    expect(projected).not.toHaveProperty('sgaBreakdown');
    expect(internalPayload.sgaBreakdown).toMatchObject({ status: 'NOT_FOUND', tables: [] });
    expect(summarizeReportStatuses(projected)).not.toHaveProperty('sgaBreakdown');

    await expect(translatePayload({} as never, internalPayload, workflowConfig())).resolves.toMatchObject({
      totalItems: 0,
      translatedItems: 0,
    });

    expect(() => financialReportToMarkdown({
      requestId: 'R14-P3',
      code: 200,
      message: 'Thành công',
      timestamp: '2026-08-20T00:00:00+07:00',
      targetLang: 'vi',
      data: [{
        fileId: 'GRP-1',
        fileName: 'report.pdf',
        status: 'SUCCESS',
        errorCode: null,
        errorMessage: null,
        diagnostic: null,
        report: projected,
        processingInfo: null,
      }],
    })).not.toThrow();
  });
});

function workflowConfig() {
  return {
    targetLang: 'vi',
    requestId: 'ROUND-11-T1.2',
    pagesPerChunk: 2,
    notesPagesPerChunk: 1,
    classifyPagesPerCall: 8,
    classifyRecheckUnassigned: false,
    classifyRecheckMaxWindows: 0,
    maxRetries: 1,
    maxConcurrency: 1,
    staggerDelayMs: 0,
    enableTranslation: false,
    renderScale: 2,
    reportTypes: [],
  } as never;
}

function classifiedWithLocations(locations: Array<Record<string, unknown>>) {
  return {
    sourceLanguage: 'ja',
    documentType: 'CONSOLIDATED',
    companyName: null,
    fromDate: null,
    toDate: null,
    currency: 'JPY',
    unit: '百万円',
    locations,
    classifiedWindows: 1,
    failedWindows: 0,
    failureReasons: [],
    unassignedPages: [],
  } as never;
}

function tabularChunk(
  reportType: 'incomeStatement' | 'comprehensiveIncome',
  locationIndex: number,
  page: number,
  titleSource: string,
  amount: string,
  additionalRows: Array<{ labelSource: string; amount: string }> = [],
) {
  return {
    reportType,
    locationIndex,
    chunkIndex: 0,
    pageFrom: page,
    pageTo: page,
    aiWarnings: [],
    failureReason: null,
    result: {
      reportType,
      titleSource,
      notFound: false,
      tables: [{
        columns: [{ id: 'currentPeriod', labelSource: '2025年度', dataType: 'number', period: '2025-03-31' }],
        rows: [
          {
            rowId: 'r1',
            labelSource: '当期純利益',
            rowType: 'DETAIL',
            sourcePage: page,
            values: { currentPeriod: amount },
          },
          ...additionalRows.map((row, index) => ({
            rowId: `r${index + 2}`,
            labelSource: row.labelSource,
            rowType: 'DETAIL',
            sourcePage: page,
            values: { currentPeriod: row.amount },
          })),
        ],
      }],
    },
  };
}

describe('Round 11 T1.2 — routing and R1 isolation for comprehensiveIncome', () => {
  it('dùng nguyên bảng 包括利益計算書 làm KQKD khi tài liệu không có 損益計算書 riêng', () => {
    const payload = buildPayload(
      workflowConfig(),
      classifiedWithLocations([{
        reportType: 'comprehensiveIncome',
        pageFrom: 10,
        pageTo: 10,
        titleSource: '連結包括利益計算書［連結会計年度］',
        consolidation: 'CONSOLIDATED',
      }]),
      {
        tableChunks: [tabularChunk(
          'comprehensiveIncome',
          0,
          10,
          '連結包括利益計算書［連結会計年度］',
          '200',
          [{ labelSource: '販売費及び一般管理費', amount: '-75' }],
        )],
        notesChunks: [],
      } as never,
    );

    expect(payload.incomeStatement.status).toBe('FOUND');
    expect(payload.incomeStatement.title?.source).toBe('連結包括利益計算書［連結会計年度］');
    expect(payload.incomeStatement.tables[0].rows).toHaveLength(2);
    expect(payload.incomeStatement.tables[0].rows[0].values.currentPeriod.normalized).toBe(200);
    expect(payload.incomeStatement.warnings.map((warning) => warning.code))
      .toContain('INCOME_FROM_COMPREHENSIVE_INCOME');
    expect(payload.comprehensiveIncome).toMatchObject({ status: 'NOT_FOUND', tables: [] });
    expect(payload.sgaBreakdown.status).toBe('PARTIAL');
    expect(payload.sgaBreakdown.tables[0].rows[0].values.currentPeriod.normalized).toBe(-75);
    expect(payload.sgaBreakdown.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['DETAIL_NOT_FOUND', 'SGA_DERIVED_FROM_INCOME_STATEMENT']),
    );
    expect(projectOutputPayload(payload)).not.toHaveProperty('comprehensiveIncome');
  });

  it('Sony annual/quarter variants are filtered independently for incomeStatement and comprehensiveIncome', () => {
    const payload = buildPayload(
      workflowConfig(),
      classifiedWithLocations([
        { reportType: 'incomeStatement', pageFrom: 8, pageTo: 8, titleSource: '連結損益計算書［連結会計年度］', consolidation: 'CONSOLIDATED' },
        { reportType: 'incomeStatement', pageFrom: 11, pageTo: 11, titleSource: '連結損益計算書［第４四半期］', consolidation: 'CONSOLIDATED' },
        { reportType: 'comprehensiveIncome', pageFrom: 10, pageTo: 10, titleSource: '連結包括利益計算書［連結会計年度］', consolidation: 'CONSOLIDATED' },
        { reportType: 'comprehensiveIncome', pageFrom: 13, pageTo: 13, titleSource: '連結包括利益計算書［第４四半期］', consolidation: 'CONSOLIDATED' },
      ]),
      {
        tableChunks: [
          tabularChunk('incomeStatement', 0, 8, '連結損益計算書［連結会計年度］', '12034'),
          tabularChunk('incomeStatement', 1, 11, '連結損益計算書［第４四半期］', '2804'),
          tabularChunk('comprehensiveIncome', 2, 10, '連結包括利益計算書［連結会計年度］', '200'),
          tabularChunk('comprehensiveIncome', 3, 13, '連結包括利益計算書［第４四半期］', '50'),
        ],
        notesChunks: [],
      } as never,
    );

    expect(payload.incomeStatement.tables).toHaveLength(1);
    expect(payload.incomeStatement.tables[0].rows[0].values.currentPeriod.normalized).toBe(12034);
    expect(payload.incomeStatement.warnings.map((warning) => warning.code))
      .not.toContain('INCOME_FROM_COMPREHENSIVE_INCOME');
    expect(payload.comprehensiveIncome.tables).toHaveLength(1);
    expect(payload.comprehensiveIncome.tables[0].rows[0].values.currentPeriod.normalized).toBe(200);
    expect(payload.incomeStatement.warnings.map((warning) => warning.code)).toContain('MULTIPLE_VARIANTS_MERGED');
    expect(payload.comprehensiveIncome.warnings.map((warning) => warning.code)).toContain('MULTIPLE_VARIANTS_MERGED');
  });
});
