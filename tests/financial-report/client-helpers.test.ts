import {
  DEFAULT_ETA_SECONDS_PER_PAGE,
  FOREGROUND_POLL_WINDOW_MS,
  INITIAL_COMPLETION_ESTIMATE_MS,
  WORKFLOW_DEADLINE_GUIDANCE,
  financialReportToMarkdown,
  foregroundPollDeadline,
  initialCompletionEstimate,
  initialEstimateDurationMs,
  isWorkflowDeadlineFailure,
  refinedRemainingDurationMs,
  safeDisplayFileName,
  safeInputFileNames,
} from '@/lib/financial-report/client-helpers';
import type { FinancialReportEnvelope } from '@/lib/pipelines/workflows/financial-report/types';

const baseEnvelope: FinancialReportEnvelope = {
  requestId: 'request-1',
  code: 200,
  message: 'Hoàn tất',
  timestamp: '2026-08-17T08:00:00.000Z',
  targetLang: 'vi',
  data: [{
    fileId: 'file-1',
    fileName: 'Báo cáo | thử.pdf',
    status: 'SUCCESS',
    errorCode: null,
    errorMessage: null,
    diagnostic: null,
    processingInfo: null,
    report: {
      generalInformation: {
        companyName: { source: '株式会社|テスト', translated: 'Công ty thử nghiệm' },
        sourceLanguage: 'ja',
        targetLanguage: 'vi',
        fromDate: null,
        toDate: null,
        currency: null,
        unit: { source: null, translated: null, multiplier: null },
      },
      balanceSheet: {
        status: 'FOUND', title: { source: 'B/S', translated: 'Bảng cân đối' }, pageRanges: [], unit: null, warnings: [],
        tables: [{
          tableId: 'table-1',
          columns: [{ id: 'current', label: { source: '当期', translated: 'Kỳ này' }, dataType: 'number', period: null }],
          rows: [{ rowId: 'row-1', parentRowId: null, level: 0, rowType: 'DETAIL', statementSection: null, label: { source: '資産', translated: 'Tài sản' }, sourcePage: 1, values: { current: { raw: '1,000', normalized: 1000 } } }],
        }],
      },
      incomeStatement: { status: 'NOT_FOUND', title: null, pageRanges: [], unit: null, warnings: [], tables: [] },
      cashFlowStatement: { status: 'NOT_FOUND', title: null, pageRanges: [], unit: null, warnings: [], tables: [] },
      equityChangeStatement: { status: 'NOT_FOUND', title: null, pageRanges: [], unit: null, warnings: [], tables: [] },
      sgaBreakdown: { status: 'NOT_FOUND', title: null, pageRanges: [], unit: null, warnings: [], tables: [] },
      notesToFinancialStatements: { status: 'NOT_FOUND', title: null, pageRanges: [], unit: null, warnings: [], sections: [] },
    },
  }],
};

describe('financial-report client helpers', () => {
  it('reduces stored paths and URLs to display-safe filenames', () => {
    expect(safeDisplayFileName('C:\\private\\uploads\\report.pdf')).toBe('report.pdf');
    expect(safeDisplayFileName('https://storage.example/internal/report.pdf?signature=secret')).toBe('report.pdf');
    expect(safeDisplayFileName('  report\u0000.pdf  ')).toBe('report.pdf');
    expect(safeDisplayFileName(null)).toBeNull();
  });

  it('returns only bounded, unique display names from filesJson', () => {
    const filesJson = JSON.stringify([
      { name: '/private/first.pdf', path: 'secret/path/first.pdf', url: 'https://secret.example/first.pdf' },
      { name: '/private/first.pdf' },
      { name: 'second.pdf' },
      { path: 'no-name' },
    ]);
    expect(safeInputFileNames(filesJson)).toEqual(['first.pdf', 'second.pdf']);
    expect(safeInputFileNames('{invalid')).toEqual([]);
  });

  it('derives an ETA from page count, retains a truthful fallback, and refines without a negative remainder', () => {
    const startedAt = new Date('2026-08-17T08:00:00.000Z');
    expect(foregroundPollDeadline(startedAt).getTime() - startedAt.getTime()).toBe(FOREGROUND_POLL_WINDOW_MS);
    expect(initialEstimateDurationMs(1)).toBe(DEFAULT_ETA_SECONDS_PER_PAGE * 1000);
    expect(initialEstimateDurationMs(100, 13)).toBe(100 * 13 * 1000);
    expect(initialEstimateDurationMs(null)).toBe(INITIAL_COMPLETION_ESTIMATE_MS);
    expect(initialCompletionEstimate(startedAt, 2, 10).getTime() - startedAt.getTime()).toBe(20_000);
    expect(refinedRemainingDurationMs({ totalPages: 100, secondsPerPage: 13, progressPercent: 0, elapsedMs: 50_000 })).toBe(100 * 13 * 1000);
    expect(refinedRemainingDurationMs({ totalPages: 100, secondsPerPage: 13, progressPercent: 50, elapsedMs: 650_000 })).toBeGreaterThanOrEqual(0);
    expect(refinedRemainingDurationMs({ totalPages: 100, secondsPerPage: 13, progressPercent: 100, elapsedMs: 1_300_000 })).toBe(0);
  });

  it('detects deadline failures and exposes actionable Vietnamese guidance', () => {
    expect(isWorkflowDeadlineFailure('Workflow exceeded its configured time budget.')).toBe(true);
    expect(isWorkflowDeadlineFailure('workflow deadline reached')).toBe(true);
    expect(isWorkflowDeadlineFailure('A downstream service could not complete the request.')).toBe(false);
    expect(WORKFLOW_DEADLINE_GUIDANCE).toContain('workflow_deadline_ms');
    expect(WORKFLOW_DEADLINE_GUIDANCE).toContain('Chạy lại');
  });

  it('exports only report keys present in the public envelope and escapes Markdown table content', () => {
    const markdown = financialReportToMarkdown(baseEnvelope);
    expect(markdown).toContain('## 1. Báo cáo \\| thử.pdf');
    expect(markdown).toContain('### B/S / Bảng cân đối');
    expect(markdown).toContain('| 資産 / Tài sản | 1,000 |');
    expect(markdown).not.toContain('comprehensiveIncome');
    expect(markdown).toContain('incomeStatement');
  });
});
