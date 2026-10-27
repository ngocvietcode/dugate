import { buildPayloadWithRouting } from '@/lib/pipelines/workflows/financial-report-translation';
import type { ClassifyOutcome, ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { ExtractOutcome, NotesChunkOutcome, TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { ExtractedTable, FinancialReportConfig, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

function config(): FinancialReportConfig {
  return {
    targetLang: 'vi', requestId: 'ROUND-12-T12.4', pagesPerChunk: 1, notesPagesPerChunk: 1,
    classifyPagesPerCall: 1, classifyRecheckUnassigned: false, classifyRecheckMaxWindows: 0,
    maxRetries: 1, maxConcurrency: 1, staggerDelayMs: 0, enableTranslation: false,
    renderScale: 2, reportTypes: [],
  };
}

function classified(locations: ReportLocation[]): ClassifyOutcome {
  return {
    sourceLanguage: 'en', documentType: null, companyName: null, fromDate: null, toDate: null,
    currency: 'JPY', unit: 'JPY', locations, classifiedWindows: 1, failedWindows: 0,
    failureReasons: [], unassignedPages: [],
  };
}

function table(reportType: ReportType | undefined, tableTitle: string, sourcePage: number, value: string): ExtractedTable {
  return {
    tableId: `${reportType ?? 'untyped'}-${sourcePage}`,
    ...(reportType ? { reportType } : {}),
    tableTitle,
    columns: [{ id: 'fy2025', labelSource: '2025', dataType: 'number', period: '2025-03-31' }],
    rows: [{
      rowId: `${reportType}-row`, parentRowId: null, level: 1, rowType: 'DETAIL',
      labelSource: 'Selling expense', sourcePage, values: { fy2025: value },
    }],
  };
}

function notesChunk(tables: ExtractedTable[]): NotesChunkOutcome {
  return {
    locationIndex: 0, chunkIndex: 0, pageFrom: 10, pageTo: 10, aiWarnings: [], failureReason: null,
    result: {
      titleSource: 'Notes to Financial Statements', notFound: false,
      sections: [{ sectionId: 'n1', sourcePage: 10, titleSource: 'Accounting policy', sourceText: 'Narrative survives.' }],
      tables,
    },
  };
}

function primaryChunk(reportType: ReportType, sourcePage: number, title: string, value: string): TableChunkOutcome {
  return {
    reportType, locationIndex: 0, chunkIndex: 0, pageFrom: sourcePage, pageTo: sourcePage,
    aiWarnings: [], failureReason: null,
    result: { reportType, notFound: false, tables: [table(reportType, title, sourcePage, value)] },
  };
}

describe('Round 12 T12.4 — Notes table observation before diagnosis', () => {
  it('đếm tất cả bảng Notes, chỉ đếm reject alias yếu, log từng bảng, và route SGA giữ section', () => {
    const diagnostics: string[] = [];
    const outcome: ExtractOutcome = {
      tableChunks: [],
      notesChunks: [notesChunk([
        table('sgaBreakdown', '29. Selling, General and Administrative Expenses', 10, '1200'),
        table('incomeStatement', '20. Income Taxes', 10, '900'),
      ])],
    };

    const built = buildPayloadWithRouting(
      config(),
      classified([{ reportType: 'notesToFinancialStatements', pageFrom: 10, pageTo: 10, titleSource: 'Notes' }]),
      outcome,
      (message) => diagnostics.push(message),
    );

    expect(built.notesTablesFound).toBe(2);
    expect(built.notesTablesRejected).toBe(1);
    expect(built.payload.notesToFinancialStatements.sections).toHaveLength(1);
    expect(built.payload.sgaBreakdown.tables[0].rows[0].values.fy2025.normalized).toBe(1200);
    expect(built.payload.sgaBreakdown.warnings.map((warning) => warning.code)).toContain('TABLE_FROM_NOTES_REGION');
    expect(built.payload.incomeStatement.status).toBe('NOT_FOUND');
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('tableTitle="29. Selling, General and Administrative Expenses" reportType=sgaBreakdown strongAlias=true'),
      expect.stringContaining('tableTitle="20. Income Taxes" reportType=incomeStatement strongAlias=false'),
    ]));
  });

  it('BẢO VỆ: Notes không ghi đè SGA chính đã FOUND và không tính là alias reject', () => {
    const outcome: ExtractOutcome = {
      tableChunks: [primaryChunk('sgaBreakdown', 1, 'Selling, General and Administrative Expenses', '1200')],
      notesChunks: [notesChunk([table('sgaBreakdown', '29. Selling, General and Administrative Expenses', 10, '900')])],
    };
    const built = buildPayloadWithRouting(
      config(),
      classified([
        { reportType: 'sgaBreakdown', pageFrom: 1, pageTo: 1, titleSource: 'Selling, General and Administrative Expenses' },
        { reportType: 'notesToFinancialStatements', pageFrom: 10, pageTo: 10, titleSource: 'Notes' },
      ]),
      outcome,
    );

    expect(built.notesTablesFound).toBe(1);
    expect(built.notesTablesRejected).toBe(0);
    expect(built.payload.sgaBreakdown.tables[0].rows[0].values.fy2025.normalized).toBe(1200);
    expect(built.payload.sgaBreakdown.warnings.map((warning) => warning.code)).toContain('TABLE_FROM_NOTES_REGION_IGNORED');
  });
});


describe('Round 13 T13.3 — suy loại bảng Notes từ tiêu đề khi AI không khai reportType', () => {
  const notesLocation: ReportLocation = {
    reportType: 'notesToFinancialStatements', pageFrom: 10, pageTo: 10, titleSource: 'Notes',
  };

  it('reportType=null + alias SGA mạnh được route vào sgaBreakdown và không tăng rejected', () => {
    const built = buildPayloadWithRouting(
      config(),
      classified([notesLocation]),
      { tableChunks: [], notesChunks: [notesChunk([
        table(undefined, '29. Selling, General and Administrative Expenses', 10, '1200'),
      ])] },
    );

    expect(built.payload.sgaBreakdown.status).toBe('FOUND');
    expect(built.payload.sgaBreakdown.tables[0].rows[0].values.fy2025.normalized).toBe(1200);
    expect(built.notesTablesRejected).toBe(0);
  });

  it('BẢO VỆ: reportType=null + title không khớp mạnh vẫn là Notes và được đếm rejected', () => {
    const built = buildPayloadWithRouting(
      config(),
      classified([notesLocation]),
      { tableChunks: [], notesChunks: [notesChunk([table(undefined, '20. Income Taxes', 10, '900')])] },
    );

    expect(built.payload.notesToFinancialStatements.sections).toHaveLength(1);
    expect(built.payload.incomeStatement.status).toBe('NOT_FOUND');
    expect(built.payload.sgaBreakdown.status).toBe('NOT_FOUND');
    expect(built.notesTablesRejected).toBe(1);
  });

  it('BẢO VỆ: bảng Notes suy từ title không ghi đè sgaBreakdown primary đã FOUND', () => {
    const built = buildPayloadWithRouting(
      config(),
      classified([
        { reportType: 'sgaBreakdown', pageFrom: 1, pageTo: 1, titleSource: 'Selling, General and Administrative Expenses' },
        notesLocation,
      ]),
      {
        tableChunks: [primaryChunk('sgaBreakdown', 1, 'Selling, General and Administrative Expenses', '1200')],
        notesChunks: [notesChunk([table(undefined, '29. Selling, General and Administrative Expenses', 10, '900')])],
      },
    );

    expect(built.payload.sgaBreakdown.tables[0].rows[0].values.fy2025.normalized).toBe(1200);
    expect(built.payload.sgaBreakdown.warnings.map((warning) => warning.code)).toContain('TABLE_FROM_NOTES_REGION_IGNORED');
    expect(built.notesTablesRejected).toBe(0);
  });
});
