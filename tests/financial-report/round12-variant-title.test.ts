import { mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';

function location(titleSource: string | null): ReportLocation {
  return {
    reportType: 'incomeStatement',
    pageFrom: 8,
    pageTo: 8,
    titleSource,
    consolidation: 'CONSOLIDATED',
  };
}

function tableChunk(
  tableTitle: string | null | undefined,
  columnLabelSource = 'Current period',
): TableChunkOutcome {
  return {
    reportType: 'incomeStatement',
    locationIndex: 0,
    chunkIndex: 0,
    pageFrom: 8,
    pageTo: 8,
    result: {
      reportType: 'incomeStatement',
      notFound: false,
      tables: [{
        tableId: 'income-table',
        ...(tableTitle === undefined ? {} : { tableTitle }),
        columns: [{ id: 'currentPeriod', labelSource: columnLabelSource, dataType: 'number', period: null }],
        rows: [{
          rowId: 'revenue',
          parentRowId: null,
          level: 1,
          rowType: 'DETAIL',
          labelSource: 'Revenue',
          sourcePage: 8,
          values: { currentPeriod: '100' },
        }],
      }],
    },
    aiWarnings: [],
    failureReason: null,
  };
}

describe('Round 12B T12.2 — variantTitle thuộc về chính bảng', () => {
  it('giữ tableTitle để hiển thị nhưng suy kỳ/loại từ location khi tableTitle không có dấu hiệu', () => {
    const ownTitle = 'Consolidated financial statement';
    const locationTitle = 'Consolidated Statement of Profit or Loss [Quarter]';
    const report = mergeTabularReport('incomeStatement', [location(locationTitle)], [tableChunk(ownTitle)]);

    expect(report.tables[0].variantTitle?.source).toBe(ownTitle);
    expect(report.tables[0].periodScope).toBe('QUARTER');
    expect(report.tables[0].statementKind).toBe('PROFIT_LOSS');
  });

  it('suy kỳ/loại từ tableTitle trước location khi tableTitle có dấu hiệu', () => {
    const ownTitle = 'Consolidated Statement of Profit or Loss [Fiscal year]';
    const report = mergeTabularReport(
      'incomeStatement',
      [location('Consolidated Statement of Profit or Loss [Quarter]')],
      [tableChunk(ownTitle)],
    );

    expect(report.tables[0].variantTitle?.source).toBe(ownTitle);
    expect(report.tables[0].periodScope).toBe('FULL_YEAR');
    expect(report.tables[0].statementKind).toBe('PROFIT_LOSS');
  });

  it('lùi về cột khi cả tableTitle và location title không có dấu hiệu kỳ', () => {
    const ownTitle = 'Consolidated financial statement';
    const report = mergeTabularReport(
      'incomeStatement',
      [location('Consolidated financial statement')],
      [tableChunk(ownTitle, '2024年度\n(自 2024年４月１日 至 2025年３月31日)')],
    );

    expect(report.tables[0].variantTitle?.source).toBe(ownTitle);
    expect(report.tables[0].periodScope).toBe('FULL_YEAR');
    expect(report.tables[0].statementKind).toBe('OTHER');
  });

  it('lùi về location.titleSource nếu bảng không có tableTitle', () => {
    const locationTitle = 'Consolidated Statement of Profit or Loss [Fiscal year]';
    const report = mergeTabularReport('incomeStatement', [location(locationTitle)], [tableChunk(null)]);

    expect(report.tables[0].variantTitle?.source).toBe(locationTitle);
    expect(report.tables[0].periodScope).toBe('FULL_YEAR');
    expect(report.tables[0].statementKind).toBe('PROFIT_LOSS');
  });
});
