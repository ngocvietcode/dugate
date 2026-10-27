import { mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { ExtractedColumn, ExtractedRow, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

type SourceRow = {
  label: string;
  values: Record<string, string>;
  rowId?: string;
  parentRowId?: string | null;
  level?: number;
  rowType?: string;
};

function location(reportType: ReportType, page: number): ReportLocation {
  return {
    reportType,
    pageFrom: page,
    pageTo: page,
    titleSource: 'Consolidated Statement of Changes in Equity — year ended 2025',
    consolidation: 'CONSOLIDATED',
  };
}

function column(id: string): ExtractedColumn {
  return { id, labelSource: id, dataType: 'number', period: '2025-03-31' };
}

function sourceRow(row: SourceRow, page: number): ExtractedRow {
  return {
    ...(row.rowId !== undefined ? { rowId: row.rowId } : {}),
    parentRowId: row.parentRowId ?? null,
    level: row.level ?? 1,
    rowType: row.rowType ?? 'DETAIL',
    labelSource: row.label,
    sourcePage: page,
    values: row.values,
  };
}

function chunk(
  locationIndex: number,
  page: number,
  columns: ExtractedColumn[],
  rows: SourceRow[],
): TableChunkOutcome {
  return {
    reportType: 'equityChangeStatement',
    locationIndex,
    chunkIndex: 0,
    pageFrom: page,
    pageTo: page,
    aiWarnings: [],
    failureReason: null,
    result: {
      reportType: 'equityChangeStatement',
      notFound: false,
      unitSource: 'JPY',
      tables: [{ columns, rows: rows.map((row) => sourceRow(row, page)) }],
    },
  };
}

function meidenshaRows(priorYearOpening: number, useStableRowIds: boolean): SourceRow[] {
  return [
    { label: '2025年度', rowId: 'fy-2025', rowType: 'SECTION', values: {} },
    {
      label: '当期首残高',
      ...(useStableRowIds ? { rowId: 'opening-fy-2025' } : { rowId: '' }),
      parentRowId: 'fy-2025',
      level: 4,
      values: { currentPeriod: '100' },
    },
    { label: '2024年度', rowId: 'fy-2024', rowType: 'SECTION', values: {} },
    {
      label: '当期首残高',
      ...(useStableRowIds ? { rowId: 'opening-fy-2024' } : { rowId: '' }),
      parentRowId: 'fy-2024',
      level: 4,
      values: { currentPeriod: String(priorYearOpening) },
    },
  ];
}

describe('Round 13 T13.2b — structural duplicate-cell identities', () => {
  it('Meidensha canary: repeated 当期首残高 under two parents is not collapsed or falsely dropped', () => {
    const report = mergeTabularReport(
      'equityChangeStatement',
      [location('equityChangeStatement', 40), location('equityChangeStatement', 41)],
      [
        chunk(0, 40, [column('currentPeriod')], meidenshaRows(999, true)),
        chunk(1, 41, [column('currentPeriod')], meidenshaRows(200, true)),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.tables.flatMap((table) => table.rows
      .filter((row) => row.label.source === '当期首残高')
      .map((row) => row.values.currentPeriod.normalized))).toEqual([100, 999, 100, 200]);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('DUPLICATE_TABLE_DROPPED');
  });

  it('uses the parent + label + occurrence fallback when extractor row IDs are absent', () => {
    const report = mergeTabularReport(
      'equityChangeStatement',
      [location('equityChangeStatement', 42), location('equityChangeStatement', 43)],
      [
        chunk(0, 42, [column('currentPeriod')], meidenshaRows(999, false)),
        chunk(1, 43, [column('currentPeriod')], meidenshaRows(200, false)),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.tables.flatMap((table) => table.rows
      .filter((row) => row.label.source === '当期首残高')
      .map((row) => row.values.currentPeriod.normalized))).toEqual([100, 999, 100, 200]);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('DUPLICATE_TABLE_DROPPED');
  });

  it('Air Water structural anchor: five equity fragments across two periods union only within their period block', () => {
    const columnIds = Array.from({ length: 13 }, (_, index) => `c${index + 1}`);
    const rowsFor = (base: number, ids: string[]): SourceRow[] => [
      {
        label: 'Opening balance',
        rowId: 'opening-balance',
        values: Object.fromEntries(ids.map((id, index) => [id, String(base + index + 1)])),
      },
      {
        label: 'Share issue',
        rowId: 'share-issue',
        values: Object.fromEntries(ids.map((id, index) => [id, String(base + 100 + index + 1)])),
      },
    ];
    const fragments = [
      { ids: columnIds.slice(0, 7), base: 100 },
      { ids: columnIds.slice(7, 10), base: 107 },
      { ids: columnIds.slice(10), base: 110 },
      { ids: columnIds.slice(0, 7), base: 1000 },
      { ids: columnIds.slice(7), base: 1007 },
    ];

    const report = mergeTabularReport(
      'equityChangeStatement',
      fragments.map((_, index) => location('equityChangeStatement', 50 + index)),
      fragments.map((fragment, index) => chunk(
        index,
        50 + index,
        fragment.ids.map(column),
        rowsFor(fragment.base, fragment.ids),
      )),
    );

    expect(report.tables).toHaveLength(2);
    expect(report.tables.map((table) => table.columns.map((item) => item.id))).toEqual([
      columnIds,
      columnIds,
    ]);
    expect(report.tables[0].rows[0].values.c1.normalized).toBe(101);
    expect(report.tables[0].rows[0].values.c13.normalized).toBe(113);
    expect(report.tables[1].rows[0].values.c1.normalized).toBe(1001);
    expect(report.tables[1].rows[0].values.c13.normalized).toBe(1013);
    expect(report.warnings.map((warning) => warning.code)).toContain('COLUMN_SET_UNIONED');
    expect(report.warnings.map((warning) => warning.code)).not.toEqual(expect.arrayContaining([
      'DUPLICATE_TABLE_DROPPED',
      'COLUMN_ID_REMAPPED',
    ]));
  });
});
