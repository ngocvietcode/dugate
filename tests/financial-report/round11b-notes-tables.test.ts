import {
  buildPayload,
  routeExtractedTables,
} from '@/lib/pipelines/workflows/financial-report-translation';
import type { ClassifyOutcome, ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { ExtractOutcome, NotesChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import { buildNotesExtractPrompt } from '@/lib/pipelines/workflows/prompts/financial-report-prompts';
import type { FinancialReportConfig } from '@/lib/pipelines/workflows/financial-report/types';

function config(): FinancialReportConfig {
  return {
    targetLang: 'vi',
    requestId: 'ROUND-11B-T3.3',
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

function classified(): ClassifyOutcome {
  const location: ReportLocation = {
    reportType: 'notesToFinancialStatements',
    pageFrom: 10,
    pageTo: 10,
    titleSource: '注記事項',
  };
  return {
    sourceLanguage: 'ja',
    documentType: null,
    companyName: null,
    fromDate: null,
    toDate: null,
    currency: 'JPY',
    unit: '百万円',
    locations: [location],
    classifiedWindows: 1,
    failedWindows: 0,
    failureReasons: [],
    unassignedPages: [],
  };
}

function notesChunk(reportType: 'sgaBreakdown' | 'OTHER'): NotesChunkOutcome {
  return {
    locationIndex: 0,
    chunkIndex: 0,
    pageFrom: 10,
    pageTo: 10,
    aiWarnings: [],
    failureReason: null,
    result: {
      titleSource: '注記事項',
      notFound: false,
      sections: [{
        sectionId: 'n1',
        sourcePage: 10,
        titleSource: '重要な会計方針',
        sourceText: '棚卸資産の評価基準…',
      }],
      tables: [{
        tableId: 'note-table-1',
        reportType,
        tableTitle: '販売費及び一般管理費の内訳',
        columns: [{ id: 'fy2025', labelSource: '2025年度', dataType: 'number', period: '2025-03-31' }],
        rows: [{
          rowId: 'r1',
          parentRowId: null,
          level: 1,
          rowType: 'DETAIL',
          labelSource: '給料手当',
          sourcePage: 10,
          values: { fy2025: '1,200' },
        }],
      }],
    },
  };
}

function extractOutcome(reportType: 'sgaBreakdown' | 'OTHER'): ExtractOutcome {
  return { tableChunks: [], notesChunks: [notesChunk(reportType)] };
}

describe('Round 11B T3.3 — bảng trong vùng Notes', () => {
  it('prompt Notes yêu cầu trả đồng thời sections[] và tables[] theo schema table chuẩn', () => {
    const prompt = String(buildNotesExtractPrompt(10, 10)._prompt);

    expect(prompt).toContain('"sections"');
    expect(prompt).toContain('"tables"');
    expect(prompt).toContain('"reportType"');
  });

  it('giữ nguyên notes section và route bảng SG&A từ cùng một response, không cần gọi AI thêm', () => {
    const outcome = extractOutcome('sgaBreakdown');
    const payload = buildPayload(config(), classified(), outcome);

    expect(payload.notesToFinancialStatements.status).toBe('FOUND');
    expect(payload.notesToFinancialStatements.sections).toMatchObject([{
      sourcePage: 10,
      title: { source: '重要な会計方針', translated: null },
      sourceText: '棚卸資産の評価基準…',
    }]);
    expect(payload.sgaBreakdown.status).toBe('FOUND');
    expect(payload.sgaBreakdown.tables[0].rows[0].values.fy2025.normalized).toBe(1200);
    expect(payload.sgaBreakdown.warnings).toContainEqual({
      code: 'TABLE_REASSIGNED_BY_CONTENT',
      message: 'Bảng từ trang 10-10 (classify: notesToFinancialStatements) được nhận vào sgaBreakdown theo nội dung.',
    });
  });

  it('loại bảng OTHER trong Notes theo T3.2 và vẫn giữ section văn bản', () => {
    const outcome = extractOutcome('OTHER');
    const routed = routeExtractedTables(outcome);
    const payload = buildPayload(config(), classified(), outcome);

    expect(routed.tablesDiscardedAsOther).toBe(1);
    expect(routed.tableChunks).toEqual([]);
    expect(payload.notesToFinancialStatements.sections).toHaveLength(1);
    expect(payload.sgaBreakdown.status).toBe('NOT_FOUND');
  });
});
