import { renderToStaticMarkup } from 'react-dom/server';
import {
  FinancialReportOperationsSummary,
  isFinancialReportEnvelope,
} from '@/components/financial-report/FinancialReportOperationsSummary';
import type { FinancialReportEnvelope } from '@/lib/pipelines/workflows/financial-report/types';

const partialEnvelope = {
  requestId: 'R14-O2',
  code: 207,
  message: 'Xử lý hoàn tất một phần',
  timestamp: '2026-08-20T00:00:00+07:00',
  targetLang: 'vi',
  data: [{
    fileId: 'file-1',
    fileName: 'partial.pdf',
    status: 'PARTIAL_SUCCESS',
    errorCode: 'OCR_LOW_CONFIDENCE',
    errorMessage: 'Không đọc được rõ nội dung file.',
    diagnostic: 'extract balanceSheet trang 2: timeout',
    processingInfo: {
      totalPages: 3,
      pageSourceMode: 'pdf', encrypted: false, reportsFound: 1,
      classifyWindowsTotal: 2, classifyWindowsFailed: 1,
      extractChunksTotal: 3, extractChunksFailed: 1, tablesDiscardedAsOther: 0,
      failedPageRanges: [{ from: 2, to: 2 }], translationStatus: 'PARTIAL', untranslatedItems: 2,
      failureReasons: ['extract balanceSheet trang 2: timeout'],
    },
    report: {
      generalInformation: { companyName: { source: 'Test', translated: null }, sourceLanguage: 'ja', targetLanguage: 'vi', fromDate: null, toDate: null, currency: null, unit: { source: null, translated: null, multiplier: null } },
      balanceSheet: { status: 'PARTIAL', title: null, pageRanges: [], unit: null, warnings: [{ code: 'TOTAL_MISMATCH', message: 'Tổng không khớp.' }], tables: [] },
    },
  }],
} as FinancialReportEnvelope;

describe('R14-O2 Operations financial-report renderer', () => {
  it('recognizes and renders a 207 partial envelope with diagnostics and report warnings', () => {
    expect(isFinancialReportEnvelope(partialEnvelope)).toBe(true);
    const html = renderToStaticMarkup(<FinancialReportOperationsSummary envelope={partialEnvelope} />);
    expect(html).toContain('PARTIAL_SUCCESS');
    expect(html).toContain('Chunk bóc tách lỗi');
    expect(html).toContain('extract balanceSheet trang 2: timeout');
    expect(html).toContain('TOTAL_MISMATCH');
  });

  it('rejects generic operation data so ResultSection retains its JSON fallback', () => {
    expect(isFinancialReportEnvelope({ requestId: 'x', code: '207', data: [] })).toBe(false);
    expect(isFinancialReportEnvelope({ code: 200, requestId: 'x', message: 'ok', timestamp: 'now', targetLang: 'vi', data: [{ fileId: 1 }] })).toBe(false);
  });
});
