import { buildPayload, projectOutputPayload, routeTableChunksByContent } from '@/lib/pipelines/workflows/financial-report-translation';
import type { ClassifyOutcome, ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type {
  ExtractedTable,
  ExtractedTableReportType,
  FinancialReportConfig,
  ReportType,
} from '@/lib/pipelines/workflows/financial-report/types';

function config(): FinancialReportConfig {
  return {
    targetLang: 'vi',
    requestId: 'ROUND-11B-T3.2',
    pagesPerChunk: 1,
    notesPagesPerChunk: 1,
    classifyPagesPerCall: 1,
    classifyRecheckUnassigned: false,
    classifyRecheckMaxWindows: 0,
    maxRetries: 1,
    maxConcurrency: 1,
    staggerDelayMs: 0,
    enableTranslation: false,
    renderScale: 2,
    reportTypes: [],
  };
}

function classified(locations: ReportLocation[]): ClassifyOutcome {
  return {
    sourceLanguage: 'ja',
    documentType: null,
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
  };
}

function table(reportType: ExtractedTableReportType, value: string): ExtractedTable {
  return {
    tableId: `${reportType}-table`,
    reportType,
    tableTitle: '連結包括利益計算書',
    columns: [{ id: 'fy2025', labelSource: '2025年度', dataType: 'number', period: '2025-03-31' }],
    rows: [{
      rowId: 'r1',
      parentRowId: null,
      level: 1,
      rowType: 'DETAIL',
      labelSource: '当期純利益',
      sourcePage: 3,
      values: { fy2025: value },
    }],
  };
}

function chunk(
  sourceReportType: ReportType,
  locationIndex: number,
  page: number,
  tables: ExtractedTable[],
): TableChunkOutcome {
  return {
    reportType: sourceReportType,
    locationIndex,
    chunkIndex: 0,
    pageFrom: page,
    pageTo: page,
    aiWarnings: [],
    failureReason: null,
    result: {
      reportType: sourceReportType,
      notFound: false,
      tables,
    },
  };
}

describe('Round 11B T3.2 — routing bảng theo reportType nội dung', () => {
  it('chuyển bảng từ incomeStatement sang comprehensiveIncome, rồi dùng nguyên bảng làm KQKD khi không có P&L riêng', () => {
    const sourceLocations: ReportLocation[] = [{
      reportType: 'incomeStatement',
      pageFrom: 3,
      pageTo: 3,
      titleSource: '連結包括利益計算書',
      consolidation: null,
    }];
    const sourceChunk = chunk('incomeStatement', 0, 3, [table('comprehensiveIncome', '1,200')]);

    const routed = routeTableChunksByContent([sourceChunk]);
    expect(routed.tableChunks[0]).toMatchObject({
      reportType: 'comprehensiveIncome',
      sourceReportType: 'incomeStatement',
      sourceLocationIndex: 0,
      sourcePageFrom: 3,
      sourcePageTo: 3,
    });

    const payload = buildPayload(config(), classified(sourceLocations), { tableChunks: [sourceChunk], notesChunks: [] });

    expect(payload.incomeStatement.status).toBe('FOUND');
    expect(payload.incomeStatement.tables[0].rows[0].values.fy2025.normalized).toBe(1200);
    expect(payload.comprehensiveIncome).toMatchObject({ status: 'NOT_FOUND', tables: [] });
    expect(projectOutputPayload(payload)).not.toHaveProperty('comprehensiveIncome');
    expect(payload.incomeStatement.warnings).toEqual(expect.arrayContaining([
      {
        code: 'TABLE_REASSIGNED_BY_CONTENT',
        message: 'Bảng từ trang 3-3 (classify: incomeStatement) được nhận vào comprehensiveIncome theo nội dung.',
      },
      expect.objectContaining({ code: 'INCOME_FROM_COMPREHENSIVE_INCOME' }),
    ]));
  });

  it('loại bảng OTHER không sinh warning riêng và đếm đúng một bảng bị bỏ', () => {
    const sourceChunk = chunk('incomeStatement', 0, 3, [table('OTHER', '999')]);
    const routed = routeTableChunksByContent([sourceChunk]);

    expect(routed.tablesDiscardedAsOther).toBe(1);
    expect(routed.tableChunks).toEqual([]);

    const payload = buildPayload(
      config(),
      classified([{ reportType: 'incomeStatement', pageFrom: 3, pageTo: 3, titleSource: '連結損益計算書' }]),
      { tableChunks: [sourceChunk], notesChunks: [] },
    );
    expect(payload.incomeStatement.status).toBe('NOT_FOUND');
    expect(payload.incomeStatement.warnings.map((warning) => warning.code)).not.toContain('TABLE_REASSIGNED_BY_CONTENT');
  });

  it('áp R1 theo reportType đích sau khi chuyển bảng, chỉ giữ biến thể cả năm', () => {
    const sourceLocations: ReportLocation[] = [
      {
        reportType: 'incomeStatement',
        pageFrom: 3,
        pageTo: 3,
        titleSource: '連結包括利益計算書［第４四半期連結会計期間］',
        consolidation: 'CONSOLIDATED',
      },
      {
        reportType: 'incomeStatement',
        pageFrom: 4,
        pageTo: 4,
        titleSource: '連結包括利益計算書［連結会計年度］',
        consolidation: 'CONSOLIDATED',
      },
    ];
    const payload = buildPayload(config(), classified(sourceLocations), {
      tableChunks: [
        chunk('incomeStatement', 0, 3, [table('comprehensiveIncome', '200')]),
        chunk('incomeStatement', 1, 4, [table('comprehensiveIncome', '1,200')]),
      ],
      notesChunks: [],
    });

    expect(payload.incomeStatement.tables).toHaveLength(1);
    expect(payload.incomeStatement.tables[0].periodScope).toBe('FULL_YEAR');
    expect(payload.incomeStatement.tables[0].rows[0].values.fy2025.normalized).toBe(1200);
    expect(payload.incomeStatement.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['MULTIPLE_VARIANTS_MERGED', 'INCOME_FROM_COMPREHENSIVE_INCOME']),
    );
    expect(payload.comprehensiveIncome).toMatchObject({ status: 'NOT_FOUND', tables: [] });
  });
});
