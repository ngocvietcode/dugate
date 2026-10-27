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
    result: {
      reportType,
      notFound: false,
      unitSource: 'JPY',
      tables: [{ columns, rows }],
    },
  };
}

function column(id: string, labelSource: string): ExtractedColumn {
  return { id, labelSource, dataType: 'number', period: '2025-03-31' };
}

function row(labelSource: string, sourcePage: number, values: Record<string, string>): ExtractedRow {
  return {
    rowId: labelSource,
    labelSource,
    rowType: 'CHANGE',
    sourcePage,
    values,
  };
}

describe('Round 11B T4.2 — union cột cho ma trận vốn chủ sở hữu', () => {
  it('gộp hai bảng equity có ≥50% nhãn chung và cột gần như rời nhau', () => {
    const report = mergeTabularReport(
      'equityChangeStatement',
      [location('equityChangeStatement', 1), location('equityChangeStatement', 2)],
      [
        chunk('equityChangeStatement', 0, 1, [column('capital', 'Capital stock')], [
          row('Opening balance', 1, { capital: '100' }),
          row('Share issue', 1, { capital: '5' }),
        ]),
        chunk('equityChangeStatement', 1, 2, [
          column('retained', 'Retained earnings'),
          column('other', 'Other equity'),
        ], [
          row('Opening balance', 2, { retained: '999', other: '200' }),
          row('Share issue', 2, { retained: '3', other: '4' }),
          row('Dividend', 2, { retained: '7', other: '8' }),
        ]),
      ],
    );

    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].columns.map((item) => item.id)).toEqual(['capital', 'retained', 'other']);
    expect(report.tables[0].rows.map((item) => item.label.source)).toEqual([
      'Opening balance', 'Share issue', 'Dividend',
    ]);
    expect(report.warnings).toContainEqual(expect.objectContaining({
      code: 'COLUMN_SET_UNIONED',
      message: expect.stringContaining('retained, other'),
    }));
  });

  it('không gộp hai bảng equity có nhãn dòng rời nhau', () => {
    const report = mergeTabularReport(
      'equityChangeStatement',
      [location('equityChangeStatement', 1), location('equityChangeStatement', 2)],
      [
        chunk('equityChangeStatement', 0, 1, [column('capital', 'Capital stock')], [
          row('Opening balance', 1, { capital: '100' }),
          row('Share issue', 1, { capital: '5' }),
        ]),
        chunk('equityChangeStatement', 1, 2, [column('other', 'Other equity')], [
          row('Dividend', 2, { other: '8' }),
          row('Translation adjustment', 2, { other: '9' }),
        ]),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('COLUMN_SET_UNIONED');
  });

  it('không gộp hai bảng equity có cột trùng và giá trị khác', () => {
    const report = mergeTabularReport(
      'equityChangeStatement',
      [location('equityChangeStatement', 1), location('equityChangeStatement', 2)],
      [
        chunk('equityChangeStatement', 0, 1, [column('capital', 'Capital stock')], [
          row('Opening balance', 1, { capital: '100' }),
        ]),
        chunk('equityChangeStatement', 1, 2, [column('capital', 'Capital stock')], [
          row('Opening balance', 2, { capital: '999' }),
        ]),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.tables.map((table) => table.rows[0].values.capital.normalized)).toEqual([100, 999]);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('COLUMN_SET_UNIONED');
  });

  it('không union loại báo cáo khác dù nhãn, đơn vị và kỳ trùng nhau', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1), location('balanceSheet', 2)],
      [
        chunk('balanceSheet', 0, 1, [column('assets', 'Assets')], [row('Cash', 1, { assets: '100' })]),
        chunk('balanceSheet', 1, 2, [column('liabilities', 'Liabilities')], [row('Cash', 2, { liabilities: '50' })]),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('COLUMN_SET_UNIONED');
  });
});
