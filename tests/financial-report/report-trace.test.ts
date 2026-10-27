import { buildPayload, buildReportTrace } from '@/lib/pipelines/workflows/financial-report-translation';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { FinancialReportConfig } from '@/lib/pipelines/workflows/financial-report/types';

function config(): FinancialReportConfig {
  return {
    targetLang: 'vi', requestId: 'REPORT-TRACE', pagesPerChunk: 2, notesPagesPerChunk: 1,
    classifyPagesPerCall: 8, classifyRecheckUnassigned: false, classifyRecheckMaxWindows: 0,
    maxRetries: 1, maxConcurrency: 1, staggerDelayMs: 0, enableTranslation: false,
    renderScale: 2, reportTypes: [],
  };
}

function classifiedWith(locations: ReportLocation[]) {
  return {
    sourceLanguage: 'ja', documentType: null, companyName: null, fromDate: null, toDate: null,
    currency: 'JPY', unit: '百万円', locations, classifiedWindows: 1, failedWindows: 0,
    failureReasons: [], unassignedPages: [],
  } as never;
}

function incomeLocation(): ReportLocation {
  return {
    reportType: 'incomeStatement', pageFrom: 4, pageTo: 4,
    titleSource: '連結損益計算書', consolidation: 'CONSOLIDATED',
  };
}

function incomeChunk(labelSource: string): TableChunkOutcome {
  return {
    reportType: 'incomeStatement', locationIndex: 0, chunkIndex: 0, pageFrom: 4, pageTo: 4,
    result: {
      reportType: 'incomeStatement', titleSource: '連結損益計算書', notFound: false,
      tables: [{
        columns: [{ id: 'fy2025', labelSource: '2025', dataType: 'number', period: '2025-03-31' }],
        rows: [{ rowId: 'r-1', labelSource, rowType: 'DETAIL', sourcePage: 4, values: { fy2025: '1,234' } }],
      }],
    },
    aiWarnings: [], failureReason: null,
  };
}

function traceFor(chunks: TableChunkOutcome[]) {
  const classified = classifiedWith([incomeLocation()]);
  const extractOutcome = { tableChunks: chunks, notesChunks: [] } as never;
  const payload = buildPayload(config(), classified, extractOutcome);
  const trace = buildReportTrace(classified, extractOutcome, payload)
    .find((entry) => entry.reportType === 'incomeStatement');

  if (!trace) throw new Error('incomeStatement trace was not generated');
  return trace;
}

describe('Round 07 report trace', () => {
  it('records raw and kept rows when AI returns a normal labeled row', () => {
    const trace = traceFor([incomeChunk('売上高')]);

    expect(trace.rawRows).toBeGreaterThan(0);
    expect(trace.keptRows).toBeGreaterThan(0);
    expect(trace.finalStatus).toBe('FOUND');
  });

  it('distinguishes a merge-dropped empty label from rule-based table removal', () => {
    const trace = traceFor([incomeChunk('')]);

    expect(trace.rawRows).toBeGreaterThan(0);
    expect(trace.keptRows).toBe(0);
    expect(trace.droppedByRule).toBe(false);
  });

  it('records zero raw rows and chunks when extraction has no chunk for the report', () => {
    const trace = traceFor([]);

    expect(trace.rawRows).toBe(0);
    expect(trace.chunksTotal).toBe(0);
  });
});
