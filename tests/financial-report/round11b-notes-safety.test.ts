import {
  buildPayload,
  matchesAliasStrongly,
} from '@/lib/pipelines/workflows/financial-report-translation';
import type { ClassifyOutcome, ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { ExtractOutcome, NotesChunkOutcome, TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { ExtractedTable, FinancialReportConfig, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

function config(): FinancialReportConfig {
  return {
    targetLang: 'vi',
    requestId: 'ROUND-11B-T3.4',
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
    sourceLanguage: 'en',
    documentType: null,
    companyName: null,
    fromDate: null,
    toDate: null,
    currency: 'JPY',
    unit: 'Millions of yen',
    locations,
    classifiedWindows: 1,
    failedWindows: 0,
    failureReasons: [],
    unassignedPages: [],
  };
}

function table(reportType: ReportType, tableTitle: string, page: number, value: string): ExtractedTable {
  return {
    tableId: `${reportType}-${page}`,
    reportType,
    tableTitle,
    columns: [{ id: 'fy2025', labelSource: '2025', dataType: 'number', period: '2025-03-31' }],
    rows: [{
      rowId: 'r1',
      parentRowId: null,
      level: 1,
      rowType: 'DETAIL',
      labelSource: 'Revenue',
      sourcePage: page,
      values: { fy2025: value },
    }],
  };
}

function primaryChunk(reportType: ReportType, page: number, tableTitle: string, value: string): TableChunkOutcome {
  return {
    reportType,
    locationIndex: 0,
    chunkIndex: 0,
    pageFrom: page,
    pageTo: page,
    aiWarnings: [],
    failureReason: null,
    result: { reportType, notFound: false, tables: [table(reportType, tableTitle, page, value)] },
  };
}

function notesChunk(reportType: ReportType, tableTitle: string, value = '900', locationIndex = 0): NotesChunkOutcome {
  return {
    locationIndex,
    chunkIndex: 0,
    pageFrom: 10,
    pageTo: 10,
    aiWarnings: [],
    failureReason: null,
    result: {
      titleSource: 'Notes to Financial Statements',
      notFound: false,
      sections: [],
      tables: [table(reportType, tableTitle, 10, value)],
    },
  };
}

describe('Round 11B T3.4 — Notes table safety', () => {
  it('không coi "20. Income Taxes" là alias mạnh của incomeStatement, nên không route vào báo cáo chính', () => {
    expect(matchesAliasStrongly('20. Income Taxes', 'incomeStatement')).toBe(false);

    const payload = buildPayload(
      config(),
      classified([{ reportType: 'notesToFinancialStatements', pageFrom: 10, pageTo: 10, titleSource: 'Notes' }]),
      { tableChunks: [], notesChunks: [notesChunk('incomeStatement', '20. Income Taxes')] },
    );
    expect(payload.incomeStatement.status).toBe('NOT_FOUND');
  });

  it('nhận alias mạnh sau số thứ tự và dùng bảng Notes cho sgaBreakdown chưa có dữ liệu', () => {
    const title = '29. Selling, General and Administrative Expenses';
    expect(matchesAliasStrongly(title, 'sgaBreakdown')).toBe(true);

    const payload = buildPayload(
      config(),
      classified([{ reportType: 'notesToFinancialStatements', pageFrom: 10, pageTo: 10, titleSource: 'Notes' }]),
      { tableChunks: [], notesChunks: [notesChunk('sgaBreakdown', title)] },
    );

    expect(payload.sgaBreakdown.status).toBe('FOUND');
    expect(payload.sgaBreakdown.warnings.map((warning) => warning.code)).toContain('TABLE_FROM_NOTES_REGION');
  });

  it('bỏ bảng balanceSheet trong Notes khi balanceSheet chính đã FOUND và gắn warning ignored', () => {
    const outcome: ExtractOutcome = {
      tableChunks: [primaryChunk('balanceSheet', 1, 'Balance Sheet', '1,200')],
      notesChunks: [notesChunk('balanceSheet', '1. Balance Sheet', '900', 1)],
    };
    const payload = buildPayload(
      config(),
      classified([
        { reportType: 'balanceSheet', pageFrom: 1, pageTo: 1, titleSource: 'Balance Sheet' },
        { reportType: 'notesToFinancialStatements', pageFrom: 10, pageTo: 10, titleSource: 'Notes' },
      ]),
      outcome,
    );

    expect(payload.balanceSheet.tables).toHaveLength(1);
    expect(payload.balanceSheet.tables[0].rows[0].values.fy2025.normalized).toBe(1200);
    expect(payload.balanceSheet.warnings.map((warning) => warning.code)).toContain('TABLE_FROM_NOTES_REGION_IGNORED');
  });
});
