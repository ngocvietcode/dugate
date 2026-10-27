import { mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { ExtractedColumn, ExtractedRow, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

function location(reportType: ReportType, page: number): ReportLocation {
  return {
    reportType,
    pageFrom: page,
    pageTo: page,
    titleSource: 'Consolidated Statement of Changes in Equity — year ended 2025',
    consolidation: 'CONSOLIDATED',
  };
}

function column(id: string, labelSource: string): ExtractedColumn {
  return { id, labelSource, dataType: 'number', period: '2025-03-31' };
}

function row(labelSource: string, page: number, values: Record<string, string>): ExtractedRow {
  return { rowId: `${labelSource}-${page}`, labelSource, rowType: 'CHANGE', sourcePage: page, values };
}

function chunk(
  reportType: ReportType,
  locationIndex: number,
  page: number,
  columns: ExtractedColumn[],
  rows: ExtractedRow[],
): TableChunkOutcome {
  return {
    reportType,
    locationIndex,
    chunkIndex: 0,
    pageFrom: page,
    pageTo: page,
    aiWarnings: [],
    failureReason: null,
    result: { reportType, notFound: false, unitSource: 'JPY', tables: [{ columns, rows }] },
  };
}

describe('Round 12 T12.3 — union equity chỉ khi cột gần như rời nhau', () => {
  it('union ma trận rộng cắt ngang khi nhãn dòng chung và toàn bộ cột rời nhau', () => {
    const report = mergeTabularReport(
      'equityChangeStatement',
      [location('equityChangeStatement', 1), location('equityChangeStatement', 2)],
      [
        chunk('equityChangeStatement', 0, 1, [column('capital', 'Capital stock')], [
          row('Opening balance', 1, { capital: '100' }),
          row('Share issue', 1, { capital: '5' }),
        ]),
        chunk('equityChangeStatement', 1, 2, [column('retained', 'Retained earnings')], [
          row('Opening balance', 2, { retained: '200' }),
          row('Share issue', 2, { retained: '3' }),
        ]),
      ],
    );

    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].columns.map((item) => item.id)).toEqual(['capital', 'retained']);
    expect(report.tables[0].rows[0].values).toMatchObject({
      capital: { normalized: 100 },
      retained: { normalized: 200 },
    });
    expect(report.warnings.map((warning) => warning.code)).toContain('COLUMN_SET_UNIONED');
  });

  it('giữ hai khối kỳ JFE khi cột trùng nhưng giá trị khác, không mất giá trị', () => {
    const report = mergeTabularReport(
      'equityChangeStatement',
      [location('equityChangeStatement', 10), location('equityChangeStatement', 11)],
      [
        chunk('equityChangeStatement', 0, 10, [column('capital', 'Capital stock')], [
          row('Opening balance', 10, { capital: '100' }),
          row('Share issue', 10, { capital: '5' }),
        ]),
        chunk('equityChangeStatement', 1, 11, [column('capital', 'Capital stock')], [
          row('Opening balance', 11, { capital: '900' }),
          row('Share issue', 11, { capital: '30' }),
        ]),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.tables.flatMap((table) => table.rows.map((item) => item.values.capital.normalized))).toEqual([100, 5, 900, 30]);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('COLUMN_SET_UNIONED');
  });

  it('không union loại báo cáo khác dù nhãn, đơn vị, kỳ và cột rời nhau', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 20), location('balanceSheet', 21)],
      [
        chunk('balanceSheet', 0, 20, [column('assets', 'Assets')], [row('Cash', 20, { assets: '100' })]),
        chunk('balanceSheet', 1, 21, [column('liabilities', 'Liabilities')], [row('Cash', 21, { liabilities: '50' })]),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('COLUMN_SET_UNIONED');
  });
});
