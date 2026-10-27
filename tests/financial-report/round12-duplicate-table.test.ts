import { mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { ExtractChunkResult, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

interface TestRow {
  label: string;
  value: number;
}

function location(
  reportType: ReportType,
  page: number,
  title: string,
): ReportLocation {
  return { reportType, pageFrom: page, pageTo: page, titleSource: title, consolidation: 'CONSOLIDATED' };
}

function tableChunk(input: {
  reportType: ReportType;
  locationIndex: number;
  page: number;
  title: string;
  rows: TestRow[];
  unitSource?: string;
}): TableChunkOutcome {
  const result: ExtractChunkResult = {
    reportType: input.reportType,
    titleSource: input.title,
    notFound: false,
    ...(input.unitSource ? { unitSource: input.unitSource } : {}),
    tables: [{
      tableId: `table-${input.locationIndex}`,
      columns: [{ id: 'currentPeriod', labelSource: 'Current period', dataType: 'number', period: '2025-03-31' }],
      rows: input.rows.map((row) => ({
        // Stable source identity: the two T12 tables model separately extracted
        // copies of the same logical rows, not rows unique to their location.
        rowId: `source-${row.label}`,
        parentRowId: null,
        level: 1,
        rowType: 'DETAIL',
        labelSource: row.label,
        sourcePage: input.page,
        values: { currentPeriod: String(row.value) },
      })),
    }],
  };

  return {
    reportType: input.reportType,
    locationIndex: input.locationIndex,
    chunkIndex: 0,
    pageFrom: input.page,
    pageTo: input.page,
    result,
    aiWarnings: [],
    failureReason: null,
  };
}

function numberedRows(prefix: string, count: number, startValue = 1): TestRow[] {
  return Array.from({ length: count }, (_, index) => ({
    label: `${prefix} ${index + 1}`,
    value: startValue + index,
  }));
}

describe('Round 12 T12.1 — loại bảng trùng trước R1', () => {
  it('giữ bảng 57 dòng chứa bảng 25 dòng và ghi cảnh báo có trang/số liệu', () => {
    const smaller = numberedRows('Revenue', 25);
    const richer = numberedRows('Revenue', 57);
    const report = mergeTabularReport(
      'incomeStatement',
      [
        location('incomeStatement', 8, 'Consolidated Statement of Profit or Loss'),
        location('incomeStatement', 9, 'Consolidated Statement of Profit or Loss'),
      ],
      [
        tableChunk({ reportType: 'incomeStatement', locationIndex: 0, page: 8, title: 'Consolidated Statement of Profit or Loss', rows: smaller }),
        tableChunk({ reportType: 'incomeStatement', locationIndex: 1, page: 9, title: 'Consolidated Statement of Profit or Loss', rows: richer }),
      ],
    );

    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].rows).toHaveLength(57);
    const warning = report.warnings.find((item) => item.code === 'DUPLICATE_TABLE_DROPPED');
    expect(warning?.message).toContain('1 bảng');
    expect(warning?.message).toContain('trang 8-8');
    expect(warning?.message).toContain('trang 9-9');
    expect(warning?.message).toContain('25 dòng/25 giá trị');
    expect(warning?.message).toContain('57 dòng/57 giá trị');
  });

  it('BẢO VỆ: hai bảng equity cùng nhãn nhưng giá trị khác vẫn được giữ', () => {
    const labels = numberedRows('Equity movement', 4);
    const report = mergeTabularReport(
      'equityChangeStatement',
      [
        location('equityChangeStatement', 20, 'Statement of Changes in Equity'),
        location('equityChangeStatement', 21, 'Statement of Changes in Equity'),
      ],
      [
        tableChunk({
          reportType: 'equityChangeStatement', locationIndex: 0, page: 20,
          title: 'Statement of Changes in Equity', rows: labels, unitSource: 'JPY',
        }),
        tableChunk({
          reportType: 'equityChangeStatement', locationIndex: 1, page: 21,
          title: 'Statement of Changes in Equity',
          rows: labels.map((row) => ({ ...row, value: row.value + 100 })), unitSource: 'million JPY',
        }),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((item) => item.code)).not.toContain('DUPLICATE_TABLE_DROPPED');
  });

  it('BẢO VỆ: bảng chỉ trùng 50% nhãn vẫn được giữ', () => {
    const report = mergeTabularReport(
      'incomeStatement',
      [
        location('incomeStatement', 30, 'Consolidated Statement of Profit or Loss'),
        location('incomeStatement', 31, 'Consolidated Statement of Profit or Loss'),
      ],
      [
        tableChunk({
          reportType: 'incomeStatement', locationIndex: 0, page: 30,
          title: 'Consolidated Statement of Profit or Loss',
          rows: [
            { label: 'Common 1', value: 1 }, { label: 'Common 2', value: 2 },
            { label: 'Only A 1', value: 3 }, { label: 'Only A 2', value: 4 },
          ],
        }),
        tableChunk({
          reportType: 'incomeStatement', locationIndex: 1, page: 31,
          title: 'Consolidated Statement of Profit or Loss',
          rows: [
            { label: 'Common 1', value: 1 }, { label: 'Common 2', value: 2 },
            { label: 'Only B 1', value: 5 }, { label: 'Only B 2', value: 6 },
          ],
        }),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((item) => item.code)).not.toContain('DUPLICATE_TABLE_DROPPED');
  });

  it('vẫn chạy R1 sau khi loại bản sao của bảng kỳ năm', () => {
    const annualRows = [{ label: 'Revenue', value: 100 }];
    const report = mergeTabularReport(
      'incomeStatement',
      [
        location('incomeStatement', 40, 'Consolidated Statement of Profit or Loss [Fiscal year]'),
        location('incomeStatement', 41, 'Consolidated Statement of Profit or Loss [Fiscal year]'),
        location('incomeStatement', 42, 'Consolidated Statement of Profit or Loss [Quarter]'),
      ],
      [
        tableChunk({ reportType: 'incomeStatement', locationIndex: 0, page: 40, title: 'Consolidated Statement of Profit or Loss [Fiscal year]', rows: annualRows }),
        tableChunk({ reportType: 'incomeStatement', locationIndex: 1, page: 41, title: 'Consolidated Statement of Profit or Loss [Fiscal year]', rows: annualRows }),
        tableChunk({ reportType: 'incomeStatement', locationIndex: 2, page: 42, title: 'Consolidated Statement of Profit or Loss [Quarter]', rows: [{ label: 'Revenue', value: 25 }] }),
      ],
    );

    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].periodScope).toBe('FULL_YEAR');
    expect(report.tables[0].rows[0].values.currentPeriod.normalized).toBe(100);
    expect(report.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'DUPLICATE_TABLE_DROPPED',
      'MULTIPLE_VARIANTS_MERGED',
    ]));
  });
});


describe('Round 13 T13.2 — loại bảng trùng theo danh tính ô', () => {
  const makeChunk = (
    locationIndex: number,
    page: number,
    columns: string[],
    rows: Array<{ label: string; values: Record<string, number> }>,
    reportType: ReportType = 'equityChangeStatement',
  ): TableChunkOutcome => ({
    reportType,
    locationIndex,
    chunkIndex: 0,
    pageFrom: page,
    pageTo: page,
    result: {
      reportType,
      titleSource: 'Statement of Changes in Equity',
      notFound: false,
      tables: [{
        tableId: `equity-${locationIndex}`,
        columns: columns.map((id) => ({ id, labelSource: id, dataType: 'number', period: null })),
        rows: rows.map((row, index) => ({
          // Source row IDs model the same structural row across separately extracted copies.
          // Repeated labels intentionally retain the same ID so the JFE duplicate fixture
          // remains a true duplicate under T13.2b's row-identity contract.
          rowId: `source-${row.label}`,
          parentRowId: null,
          level: 1,
          rowType: 'DETAIL',
          labelSource: row.label,
          sourcePage: page,
          values: Object.fromEntries(Object.entries(row.values).map(([id, value]) => [id, String(value)])),
        })),
      }],
    },
    aiWarnings: [],
    failureReason: null,
  });

  it('BẢO VỆ: JFE-shaped fragment with its own numeric cells is retained rather than dropped', () => {
    const cleanColumns = Array.from({ length: 15 }, (_, index) => `c${index + 1}`);
    const labels = Array.from({ length: 15 }, (_, index) => `Equity row ${index + 1}`);
    const cleanRows = labels.map((label, rowIndex) => {
      const count = rowIndex < 3 ? 5 : 6;
      return {
        label,
        values: Object.fromEntries(Array.from({ length: count }, (_, columnIndex) => [
          `c${columnIndex + 1}`,
          (rowIndex + 1) * 100 + columnIndex + 1,
        ])),
      };
    });
    const duplicatedRows = labels.flatMap((label, rowIndex) => [
      {
        label,
        values: Object.fromEntries(Array.from({ length: 3 }, (_, columnIndex) => [
          `c${columnIndex + 1}`,
          (rowIndex + 1) * 100 + columnIndex + 1,
        ])),
      },
      {
        label,
        values: Object.fromEntries(Array.from({ length: 3 }, (_, columnIndex) => [
          `c${columnIndex + 1}`,
          100000 + (rowIndex + 1) * 100 + columnIndex + 1,
        ])),
      },
    ]);
    const report = mergeTabularReport(
      'equityChangeStatement',
      [
        location('equityChangeStatement', 6, 'Statement of Changes in Equity'),
        location('equityChangeStatement', 7, 'Statement of Changes in Equity'),
      ],
      [
        makeChunk(0, 6, cleanColumns, cleanRows),
        makeChunk(1, 7, cleanColumns.slice(0, 7), duplicatedRows),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.tables[0].columns).toHaveLength(15);
    expect(report.tables[0].rows).toHaveLength(15);
    expect(report.tables[0].rows[0].values.c1).toEqual({ raw: '101', normalized: 101 });
    expect(report.warnings.map((warning) => warning.code)).not.toContain('DUPLICATE_TABLE_DROPPED');
  });

  it('drops an exact contained duplicate even when the extracted column IDs differ', () => {
    const rows = [
      { label: 'Opening balance', values: { left: 100 } },
      { label: 'Closing balance', values: { left: 120 } },
    ];
    const report = mergeTabularReport(
      'incomeStatement',
      [
        location('incomeStatement', 10, 'Consolidated Statement of Profit or Loss'),
        location('incomeStatement', 11, 'Consolidated Statement of Profit or Loss'),
      ],
      [
        makeChunk(0, 10, ['left'], rows, 'incomeStatement'),
        makeChunk(1, 11, ['right'], rows.map((row) => ({
          label: row.label,
          values: { right: row.values.left },
        })), 'incomeStatement'),
      ],
    );

    expect(report.tables).toHaveLength(1);
    expect(report.warnings.map((warning) => warning.code)).toContain('DUPLICATE_TABLE_DROPPED');
  });

});


describe('Round 14 R14-B — value-multiset containment guards', () => {
  it('does not drop identical printed values when table units differ', () => {
    const rows = numberedRows('Revenue', 2, 100);
    const report = mergeTabularReport(
      'incomeStatement',
      [
        location('incomeStatement', 50, 'Consolidated Statement of Profit or Loss'),
        location('incomeStatement', 51, 'Consolidated Statement of Profit or Loss'),
      ],
      [
        tableChunk({ reportType: 'incomeStatement', locationIndex: 0, page: 50, title: 'Consolidated Statement of Profit or Loss', rows, unitSource: 'JPY' }),
        tableChunk({ reportType: 'incomeStatement', locationIndex: 1, page: 51, title: 'Consolidated Statement of Profit or Loss', rows, unitSource: 'million JPY' }),
      ],
    );

    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('DUPLICATE_TABLE_DROPPED');
  });

  it('drops a contained duplicate without losing the distinct reportType/label/rounded-value set', () => {
    const rows = numberedRows('Revenue', 3, 100);
    const expectedDistinctPairs = new Set(rows.map((row) => `incomeStatement\u0000${row.label}\u0000${Math.round(row.value)}`));
    const report = mergeTabularReport(
      'incomeStatement',
      [
        location('incomeStatement', 60, 'Consolidated Statement of Profit or Loss'),
        location('incomeStatement', 61, 'Consolidated Statement of Profit or Loss'),
      ],
      [
        tableChunk({ reportType: 'incomeStatement', locationIndex: 0, page: 60, title: 'Consolidated Statement of Profit or Loss', rows }),
        tableChunk({ reportType: 'incomeStatement', locationIndex: 1, page: 61, title: 'Consolidated Statement of Profit or Loss', rows: rows.map((row) => ({ ...row })) }),
      ],
    );

    const outputDistinctPairs = new Set(report.tables.flatMap((table) => table.rows.flatMap((row) =>
      Object.values(row.values).flatMap((cell) => typeof cell.normalized === 'number'
        ? [`incomeStatement\u0000${row.label.source?.trim() ?? ''}\u0000${Math.round(cell.normalized)}`]
        : []),
    )));
    expect(report.tables).toHaveLength(1);
    expect(outputDistinctPairs).toEqual(expectedDistinctPairs);
  });
});
