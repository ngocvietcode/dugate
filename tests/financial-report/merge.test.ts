// tests/financial-report/merge.test.ts
// Kiểm tra phần deterministic (code-only) của workflow financial-report-translation
// theo Acceptance §9 và test tối thiểu §22 của PLAN/TASK-1-WORKFLOW.md.
//
// Fixture mô phỏng đúng đặc điểm mẫu `AI-Processed/OG Corp_CFS_FY2024_Ended 31032025.pdf`:
//   - có BS / IS / Equity / Notes
//   - KHÔNG có Cash Flow          → NOT_FOUND, tables = []
//   - SGA chỉ có dòng tổng        → PARTIAL + DETAIL_NOT_FOUND
//   - số âm in dạng △37           → normalized = -37
// Phần gọi AI không unit-test (§22).
//
// Nhóm cuối file là test cho vòng fix CODE-REVIEW-01 (mục 1, 2, 3, 11).

import { mergeNotesReport, mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import type { NotesChunkOutcome, TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { ExtractChunkResult, ExtractNotesChunkResult, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

function location(reportType: ReportType, from: number, to: number, title: string | null = null): ReportLocation {
  return { reportType, pageFrom: from, pageTo: to, titleSource: title };
}

/** Helper dựng TableChunkOutcome; locationIndex/chunkIndex default 0 (1 location, chunk đầu). */
function tableChunk(input: {
  reportType: ReportType;
  pageFrom: number;
  pageTo: number;
  result: ExtractChunkResult | null;
  aiWarnings?: string[];
  locationIndex?: number;
  chunkIndex?: number;
}): TableChunkOutcome {
  return {
    reportType: input.reportType,
    locationIndex: input.locationIndex ?? 0,
    chunkIndex: input.chunkIndex ?? 0,
    pageFrom: input.pageFrom,
    pageTo: input.pageTo,
    result: input.result,
    aiWarnings: input.aiWarnings ?? [],
    failureReason: input.result === null ? 'test: chunk lỗi' : null,
  };
}

function notesChunk(input: {
  pageFrom: number;
  pageTo: number;
  result: ExtractNotesChunkResult | null;
  aiWarnings?: string[];
  locationIndex?: number;
  chunkIndex?: number;
}): NotesChunkOutcome {
  return {
    locationIndex: input.locationIndex ?? 0,
    chunkIndex: input.chunkIndex ?? 0,
    pageFrom: input.pageFrom,
    pageTo: input.pageTo,
    result: input.result,
    aiWarnings: input.aiWarnings ?? [],
    failureReason: input.result === null ? 'test: chunk lỗi' : null,
  };
}

describe('mergeTabularReport — balanceSheet của mẫu OG Corp', () => {
  const chunk = tableChunk({
    reportType: 'balanceSheet',
    pageFrom: 1,
    pageTo: 2,
    result: {
      reportType: 'balanceSheet',
      titleSource: '貸借対照表',
      notFound: false,
      tables: [
        {
          tableId: 'bs-1',
          columns: [
            { id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' },
            { id: 'previousPeriod', labelSource: '前期', dataType: 'number', period: '2024-03-31' },
          ],
          rows: [
            { rowId: 'a', parentRowId: null, level: 1, rowType: 'SECTION', labelSource: '資産の部', sourcePage: 1, values: {} },
            { rowId: 'b', parentRowId: 'a', level: 2, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 1, values: { currentPeriod: '5,288', previousPeriod: '4,900' } },
            { rowId: 'c', parentRowId: 'a', level: 2, rowType: 'DETAIL', labelSource: '貸倒引当金', sourcePage: 1, values: { currentPeriod: '△37' } },
            { rowId: 'd', parentRowId: null, level: 1, rowType: 'TOTAL', labelSource: '資産合計', sourcePage: 2, values: { currentPeriod: '76,703' } },
          ],
        },
      ],
    },
  });

  const report = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 2, '貸借対照表')], [chunk]);

  it('status = FOUND, giữ nguyên chữ nguồn của tiêu đề', () => {
    expect(report.status).toBe('FOUND');
    expect(report.title).toEqual({ source: '貸借対照表', translated: null });
    expect(report.pageRanges).toEqual([{ from: 1, to: 2 }]);
  });

  it('số âm △37 → normalized = -37, raw giữ nguyên', () => {
    const row = report.tables[0].rows.find((r) => r.label.source === '貸倒引当金');
    expect(row?.values.currentPeriod).toEqual({ raw: '△37', normalized: -37 });
  });

  it('rowId được re-index unique và parentRowId map đúng', () => {
    const rows = report.tables[0].rows;
    expect(rows.map((r) => r.rowId)).toEqual(['bs-001', 'bs-002', 'bs-003', 'bs-004']);
    expect(rows[1].parentRowId).toBe('bs-001');
    expect(rows[3].parentRowId).toBeNull();
  });

  it('ô trống bị bỏ key, không đặt 0', () => {
    const row = report.tables[0].rows.find((r) => r.label.source === '貸倒引当金');
    expect(Object.keys(row!.values)).toEqual(['currentPeriod']);
    expect(row!.values.previousPeriod).toBeUndefined();
  });

  it('dòng SECTION không có số thì values rỗng', () => {
    expect(report.tables[0].rows[0].values).toEqual({});
  });
});

describe('mergeTabularReport — báo cáo không tồn tại (cashFlowStatement)', () => {
  it('không classify được trang nào → NOT_FOUND, tables = []', () => {
    const report = mergeTabularReport('cashFlowStatement', [], []);
    expect(report.status).toBe('NOT_FOUND');
    expect(report.tables).toEqual([]);
    expect(report.pageRanges).toEqual([]);
    expect(report.title).toBeNull();
  });

  it('AI trả notFound = true → NOT_FOUND, không bịa số', () => {
    const chunk = tableChunk({
      reportType: 'cashFlowStatement',
      pageFrom: 3,
      pageTo: 3,
      result: { reportType: 'cashFlowStatement', notFound: true, tables: [] },
    });
    const report = mergeTabularReport('cashFlowStatement', [location('cashFlowStatement', 3, 3)], [chunk]);
    expect(report.status).toBe('NOT_FOUND');
    expect(report.tables).toEqual([]);
  });
});

describe('mergeTabularReport — SGA chỉ có tổng (A5)', () => {
  const chunk = tableChunk({
    reportType: 'sgaBreakdown',
    pageFrom: 4,
    pageTo: 4,
    aiWarnings: ['DETAIL_NOT_FOUND'],
    result: {
      reportType: 'sgaBreakdown',
      titleSource: '販売費及び一般管理費',
      notFound: false,
      tables: [
        {
          tableId: 'sga-1',
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            { rowId: 't', parentRowId: null, level: 1, rowType: 'TOTAL', labelSource: '販売費及び一般管理費', sourcePage: 4, values: { currentPeriod: '7,915' } },
          ],
        },
      ],
    },
  });

  const report = mergeTabularReport('sgaBreakdown', [location('sgaBreakdown', 4, 4)], [chunk]);

  it('status = PARTIAL kèm warning DETAIL_NOT_FOUND', () => {
    expect(report.status).toBe('PARTIAL');
    expect(report.warnings.map((w) => w.code)).toContain('DETAIL_NOT_FOUND');
  });

  it('vẫn giữ dòng tổng đọc được, không bịa dòng chi tiết', () => {
    expect(report.tables[0].rows).toHaveLength(1);
    expect(report.tables[0].rows[0].values.currentPeriod).toEqual({ raw: '7,915', normalized: 7915 });
  });
});

describe('mergeTabularReport — chunk lỗi', () => {
  it('tất cả chunk lỗi → UNREADABLE + LOW_CONFIDENCE_PAGE', () => {
    const chunk = tableChunk({ reportType: 'incomeStatement', pageFrom: 3, pageTo: 4, result: null });
    const report = mergeTabularReport('incomeStatement', [location('incomeStatement', 3, 4)], [chunk]);
    expect(report.status).toBe('UNREADABLE');
    expect(report.tables).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toContain('LOW_CONFIDENCE_PAGE');
  });

  it('một phần chunk lỗi → PARTIAL, giữ phần đọc được', () => {
    const ok = tableChunk({
      reportType: 'incomeStatement',
      pageFrom: 3,
      pageTo: 3,
      result: {
        reportType: 'incomeStatement',
        notFound: false,
        tables: [
          {
            tableId: 'is-1',
            columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
            rows: [
              { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売上高', sourcePage: 3, values: { currentPeriod: '124,732' } },
            ],
          },
        ],
      },
    });
    const failed = tableChunk({ reportType: 'incomeStatement', pageFrom: 4, pageTo: 4, chunkIndex: 1, result: null });
    const report = mergeTabularReport('incomeStatement', [location('incomeStatement', 3, 4)], [ok, failed]);
    expect(report.status).toBe('PARTIAL');
    expect(report.tables[0].rows).toHaveLength(1);
    expect(report.warnings.map((w) => w.code)).toContain('LOW_CONFIDENCE_PAGE');
  });
});

describe('mergeTabularReport — bảng bị cắt qua trang (§17)', () => {
  const makeChunk = (
    from: number,
    chunkIndex: number,
    rows: Array<{ label: string; value: string }>,
    withColumns: boolean,
    locationIndex = 0,
  ): TableChunkOutcome => tableChunk({
    reportType: 'balanceSheet',
    locationIndex,
    chunkIndex,
    pageFrom: from,
    pageTo: from,
    result: {
      reportType: 'balanceSheet',
      notFound: false,
      tables: [
        {
          tableId: `t-${from}`,
          isContinuation: chunkIndex > 0,
          columns: withColumns ? [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }] : [],
          rows: rows.map((r, i) => ({
            rowId: `r${from}-${i}`,
            parentRowId: null,
            level: 1,
            rowType: 'DETAIL',
            labelSource: r.label,
            sourcePage: from,
            values: { currentPeriod: r.value },
          })),
        },
      ],
    },
  });

  it('chunk sau cùng bộ cột → nối tiếp vào bảng trước, không tạo bảng mới', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1, 2)],
      [
        makeChunk(1, 0, [{ label: '現金及び預金', value: '5,288' }], true),
        makeChunk(2, 1, [{ label: '売掛金', value: '29,112' }], true),
      ],
    );
    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].rows.map((r) => r.label.source)).toEqual(['現金及び預金', '売掛金']);
    expect(report.pageRanges).toEqual([{ from: 1, to: 2 }]);
  });

  it('loại bỏ dòng bị in lặp ở đầu chunk tiếp nối', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1, 2)],
      [
        makeChunk(1, 0, [{ label: '現金及び預金', value: '5,288' }], true),
        makeChunk(2, 1, [{ label: '現金及び預金', value: '5,288' }, { label: '売掛金', value: '29,112' }], true),
      ],
    );
    expect(report.tables[0].rows.map((r) => r.label.source)).toEqual(['現金及び預金', '売掛金']);
  });
});

describe('mergeTabularReport — validate chỉ sinh warning, không sửa số (§19)', () => {
  it('tổng tài sản ≠ tổng nợ + VCSH → TOTAL_MISMATCH nhưng số giữ nguyên', () => {
    const chunk = tableChunk({
      reportType: 'balanceSheet',
      pageFrom: 1,
      pageTo: 1,
      result: {
        reportType: 'balanceSheet',
        notFound: false,
        tables: [
          {
            tableId: 'bs-1',
            columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
            rows: [
              { rowId: 'x1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 1, values: { currentPeriod: '5,288' } },
              { rowId: 'a', parentRowId: null, level: 1, rowType: 'TOTAL', labelSource: '資産合計', sourcePage: 1, values: { currentPeriod: '76,703' } },
              { rowId: 'l', parentRowId: null, level: 1, rowType: 'TOTAL', labelSource: '負債合計', sourcePage: 1, values: { currentPeriod: '53,278' } },
              { rowId: 'e', parentRowId: null, level: 1, rowType: 'TOTAL', labelSource: '純資産合計', sourcePage: 1, values: { currentPeriod: '20,000' } },
            ],
          },
        ],
      },
    });
    const report = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 1)], [chunk]);
    expect(report.warnings.map((w) => w.code)).toContain('TOTAL_MISMATCH');
    const assets = report.tables[0].rows.find((r) => r.label.source === '資産合計');
    expect(assets?.values.currentPeriod).toEqual({ raw: '76,703', normalized: 76703 });
  });

  it('giá trị thuộc cột không khai báo bị loại + warning', () => {
    const chunk = tableChunk({
      reportType: 'balanceSheet',
      pageFrom: 1,
      pageTo: 1,
      result: {
        reportType: 'balanceSheet',
        notFound: false,
        tables: [
          {
            tableId: 'bs-1',
            columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
            rows: [
              { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 1, values: { currentPeriod: '5,288', ghostColumn: '999' } },
            ],
          },
        ],
      },
    });
    const report = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 1)], [chunk]);
    expect(Object.keys(report.tables[0].rows[0].values)).toEqual(['currentPeriod']);
    expect(report.warnings.map((w) => w.code)).toContain('UNKNOWN_COLUMN_DROPPED');
  });
});

describe('mergeNotesReport', () => {
  it('trả sections[] với sourceText nguyên văn, translatedText chờ bước dịch', () => {
    const chunk = notesChunk({
      pageFrom: 5,
      pageTo: 8,
      result: {
        titleSource: '個別注記表',
        notFound: false,
        sections: [
          { sectionId: 's1', sourcePage: 5, titleSource: '重要な会計方針', sourceText: '棚卸資産の評価基準…' },
        ],
      },
    });
    const report = mergeNotesReport([location('notesToFinancialStatements', 5, 8, '個別注記表')], [chunk]);
    expect(report.status).toBe('FOUND');
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0]).toMatchObject({
      sectionId: 'note-001',
      sourcePage: 5,
      sourceText: '棚卸資産の評価基準…',
      translatedText: null,
    });
    expect(report.sections[0].title).toEqual({ source: '重要な会計方針', translated: null });
  });

  it('không có thuyết minh → NOT_FOUND, sections = []', () => {
    expect(mergeNotesReport([], []).status).toBe('NOT_FOUND');
    expect(mergeNotesReport([], []).sections).toEqual([]);
  });
});

// ─── Vòng fix CODE-REVIEW-01 ───────────────────────────────────────────────────

describe('CODE-REVIEW-01 mục 2 — hai location cùng reportType KHÔNG được gộp', () => {
  /** BS riêng lẻ (trang 3) + BS hợp nhất (trang 40) — cùng bộ cột, khác locationIndex. */
  const standalone = tableChunk({
    reportType: 'balanceSheet',
    locationIndex: 0,
    chunkIndex: 0,
    pageFrom: 3,
    pageTo: 3,
    result: {
      reportType: 'balanceSheet',
      titleSource: '貸借対照表',
      notFound: false,
      tables: [
        {
          tableId: 'bs-a',
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 3, values: { currentPeriod: '5,288' } },
          ],
        },
      ],
    },
  });

  const consolidated = tableChunk({
    reportType: 'balanceSheet',
    locationIndex: 1,
    chunkIndex: 0,
    pageFrom: 40,
    pageTo: 40,
    result: {
      reportType: 'balanceSheet',
      titleSource: '連結貸借対照表',
      notFound: false,
      tables: [
        {
          tableId: 'bs-b',
          // Cố tình đánh dấu isContinuation + cùng bộ cột: vẫn KHÔNG được nối vì khác location.
          isContinuation: true,
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 40, values: { currentPeriod: '9,999' } },
          ],
        },
      ],
    },
  });

  const report = mergeTabularReport(
    'balanceSheet',
    [location('balanceSheet', 3, 3, '貸借対照表'), location('balanceSheet', 40, 40, '連結貸借対照表')],
    [standalone, consolidated],
  );

  it('tạo 2 table riêng, không nối vào nhau', () => {
    expect(report.tables).toHaveLength(2);
    expect(report.tables[0].rows).toHaveLength(1);
    expect(report.tables[1].rows).toHaveLength(1);
  });

  it('giá trị của hai phạm vi không lẫn vào nhau', () => {
    expect(report.tables[0].rows[0].values.currentPeriod.raw).toBe('5,288');
    expect(report.tables[1].rows[0].values.currentPeriod.raw).toBe('9,999');
  });

  it('rowId vẫn unique xuyên nhiều table của cùng report', () => {
    expect(report.tables[0].rows[0].rowId).toBe('bs-001');
    expect(report.tables[1].rows[0].rowId).toBe('bs-002');
  });

  it('pageRanges giữ 2 khoảng rời nhau', () => {
    expect(report.pageRanges).toEqual([{ from: 3, to: 3 }, { from: 40, to: 40 }]);
  });
});

describe('CODE-REVIEW-01 mục 3 — table không khai báo cột', () => {
  const first = tableChunk({
    reportType: 'incomeStatement',
    chunkIndex: 0,
    pageFrom: 1,
    pageTo: 1,
    result: {
      reportType: 'incomeStatement',
      notFound: false,
      tables: [
        {
          tableId: 'is-1',
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売上高', sourcePage: 1, values: { currentPeriod: '124,732' } },
          ],
        },
      ],
    },
  });

  const secondWithoutColumns = (isContinuation: boolean) => tableChunk({
    reportType: 'incomeStatement',
    chunkIndex: 1,
    pageFrom: 2,
    pageTo: 2,
    result: {
      reportType: 'incomeStatement',
      notFound: false,
      tables: [
        {
          tableId: 'is-2',
          isContinuation,
          columns: [],
          rows: [
            { rowId: 'r2', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売上原価', sourcePage: 2, values: { currentPeriod: '115,469' } },
          ],
        },
      ],
    },
  });

  it('CHỈ nối khi AI đánh dấu isContinuation = true', () => {
    const report = mergeTabularReport('incomeStatement', [location('incomeStatement', 1, 2)], [first, secondWithoutColumns(true)]);
    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].rows.map((r) => r.label.source)).toEqual(['売上高', '売上原価']);
    expect(report.warnings.map((w) => w.code)).toContain('TABLE_CONTINUATION_UNCERTAIN');
  });

  it('KHÔNG nối khi isContinuation không được đánh dấu → tạo bảng mới', () => {
    const report = mergeTabularReport('incomeStatement', [location('incomeStatement', 1, 2)], [first, secondWithoutColumns(false)]);
    expect(report.tables).toHaveLength(2);
    // Bảng mới không có cột nào → values của nó bị loại (key không thuộc columns) + warning
    expect(report.tables[1].rows[0].values).toEqual({});
    expect(report.warnings.map((w) => w.code)).toContain('UNKNOWN_COLUMN_DROPPED');
  });
});

describe('CODE-REVIEW-01 mục 11 — continuation merge field thiếu của cột', () => {
  const first = tableChunk({
    reportType: 'balanceSheet',
    chunkIndex: 0,
    pageFrom: 1,
    pageTo: 1,
    result: {
      reportType: 'balanceSheet',
      notFound: false,
      tables: [
        {
          tableId: 'bs-1',
          columns: [
            // chunk đầu thiếu period, có label
            { id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: null },
            // cột này đã có period sẵn → không được ghi đè
            { id: 'previousPeriod', labelSource: '前期', dataType: 'number', period: '2024-03-31' },
          ],
          rows: [
            { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 1, values: { currentPeriod: '5,288' } },
          ],
        },
      ],
    },
  });

  const second = tableChunk({
    reportType: 'balanceSheet',
    chunkIndex: 1,
    pageFrom: 2,
    pageTo: 2,
    result: {
      reportType: 'balanceSheet',
      notFound: false,
      tables: [
        {
          tableId: 'bs-2',
          isContinuation: true,
          columns: [
            { id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' },
            { id: 'previousPeriod', labelSource: 'ĐỪNG GHI ĐÈ', dataType: 'number', period: '9999-12-31' },
          ],
          rows: [
            { rowId: 'r2', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売掛金', sourcePage: 2, values: { currentPeriod: '29,112' } },
          ],
        },
      ],
    },
  });

  const report = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 2)], [first, second]);

  it('vẫn nối thành 1 bảng', () => {
    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].rows).toHaveLength(2);
  });

  it('bổ sung period còn thiếu từ chunk sau', () => {
    const col = report.tables[0].columns.find((c) => c.id === 'currentPeriod');
    expect(col?.period).toBe('2025-03-31');
  });

  it('KHÔNG ghi đè period và label đã có', () => {
    const col = report.tables[0].columns.find((c) => c.id === 'previousPeriod');
    expect(col?.period).toBe('2024-03-31');
    expect(col?.label.source).toBe('前期');
  });
});

describe('Q9 — statementSection của bảng cân đối kế toán', () => {
  const bsChunk = tableChunk({
    reportType: 'balanceSheet',
    pageFrom: 1,
    pageTo: 2,
    result: {
      reportType: 'balanceSheet',
      notFound: false,
      tables: [
        {
          tableId: 'bs-1',
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            { rowId: 'a', parentRowId: null, level: 1, rowType: 'SECTION', labelSource: '資産の部', sourcePage: 1, values: {} },
            { rowId: 'a1', parentRowId: 'a', level: 2, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 1, values: { currentPeriod: '5,288' } },
            // Dòng chi tiết có chữ "負債" nằm TRONG khối tài sản — không được làm lệch khối
            { rowId: 'a2', parentRowId: 'a', level: 2, rowType: 'DETAIL', labelSource: '負債性引当金相当額', sourcePage: 1, values: { currentPeriod: '12' } },
            { rowId: 'at', parentRowId: null, level: 1, rowType: 'TOTAL', labelSource: '資産合計', sourcePage: 1, values: { currentPeriod: '76,703' } },
            { rowId: 'l', parentRowId: null, level: 1, rowType: 'SECTION', labelSource: '負債の部', sourcePage: 2, values: {} },
            { rowId: 'l1', parentRowId: 'l', level: 2, rowType: 'DETAIL', labelSource: '買掛金', sourcePage: 2, values: { currentPeriod: '25,400' } },
            { rowId: 'lt', parentRowId: null, level: 1, rowType: 'TOTAL', labelSource: '負債合計', sourcePage: 2, values: { currentPeriod: '53,278' } },
            { rowId: 'e', parentRowId: null, level: 1, rowType: 'SECTION', labelSource: '純資産の部', sourcePage: 2, values: {} },
            { rowId: 'e1', parentRowId: 'e', level: 2, rowType: 'DETAIL', labelSource: '資本金', sourcePage: 2, values: { currentPeriod: '1,110' } },
            { rowId: 'et', parentRowId: null, level: 1, rowType: 'TOTAL', labelSource: '純資産合計', sourcePage: 2, values: { currentPeriod: '23,425' } },
          ],
        },
      ],
    },
  });

  const report = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 2)], [bsChunk]);
  const section = (label: string) => report.tables[0].rows.find((r) => r.label.source === label)?.statementSection;

  it('gán ASSETS cho khối tài sản', () => {
    expect(section('資産の部')).toBe('ASSETS');
    expect(section('現金及び預金')).toBe('ASSETS');
    expect(section('資産合計')).toBe('ASSETS');
  });

  it('dòng chi tiết có chữ "負債" trong khối tài sản KHÔNG làm lệch khối', () => {
    expect(section('負債性引当金相当額')).toBe('ASSETS');
  });

  it('gán LIABILITIES và EQUITY đúng thứ tự in trên tài liệu', () => {
    expect(section('負債の部')).toBe('LIABILITIES');
    expect(section('買掛金')).toBe('LIABILITIES');
    expect(section('負債合計')).toBe('LIABILITIES');
    expect(section('純資産の部')).toBe('EQUITY');
    expect(section('資本金')).toBe('EQUITY');
    expect(section('純資産合計')).toBe('EQUITY');
  });

  it('nhận diện được cả tiêu đề khối tiếng Anh', () => {
    const enChunk = tableChunk({
      reportType: 'balanceSheet',
      pageFrom: 1,
      pageTo: 1,
      result: {
        reportType: 'balanceSheet',
        notFound: false,
        tables: [
          {
            tableId: 'bs-1',
            columns: [{ id: 'currentPeriod', labelSource: 'Current Period', dataType: 'number', period: '2025-09-30' }],
            rows: [
              { rowId: 'a', parentRowId: null, level: 1, rowType: 'SECTION', labelSource: 'Assets', sourcePage: 1, values: {} },
              { rowId: 'a1', parentRowId: 'a', level: 2, rowType: 'DETAIL', labelSource: 'Cash and deposits', sourcePage: 1, values: { currentPeriod: '5,288' } },
              { rowId: 'l', parentRowId: null, level: 1, rowType: 'SECTION', labelSource: 'Liabilities', sourcePage: 1, values: {} },
              { rowId: 'l1', parentRowId: 'l', level: 2, rowType: 'DETAIL', labelSource: 'Trade payables', sourcePage: 1, values: { currentPeriod: '25,400' } },
              { rowId: 'e', parentRowId: null, level: 1, rowType: 'SECTION', labelSource: 'Total equity', sourcePage: 1, values: { currentPeriod: '23,425' } },
            ],
          },
        ],
      },
    });
    const en = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 1)], [enChunk]);
    const rows = en.tables[0].rows;
    expect(rows.find((r) => r.label.source === 'Cash and deposits')?.statementSection).toBe('ASSETS');
    expect(rows.find((r) => r.label.source === 'Trade payables')?.statementSection).toBe('LIABILITIES');
    expect(rows.find((r) => r.label.source === 'Total equity')?.statementSection).toBe('EQUITY');
  });

  it('báo cáo KHÔNG phải bảng cân đối thì statementSection luôn null', () => {
    const isChunk = tableChunk({
      reportType: 'incomeStatement',
      pageFrom: 3,
      pageTo: 3,
      result: {
        reportType: 'incomeStatement',
        notFound: false,
        tables: [
          {
            tableId: 'is-1',
            columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
            rows: [
              { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売上高', sourcePage: 3, values: { currentPeriod: '124,732' } },
            ],
          },
        ],
      },
    });
    const is = mergeTabularReport('incomeStatement', [location('incomeStatement', 3, 3)], [isChunk]);
    expect(is.tables[0].rows[0].statementSection).toBeNull();
  });
});

describe('Q10 — đơn vị riêng của báo cáo ở tầng merge', () => {
  const chunkWithUnit = (unitSource: string | null) => tableChunk({
    reportType: 'sgaBreakdown',
    pageFrom: 4,
    pageTo: 4,
    result: {
      reportType: 'sgaBreakdown',
      unitSource,
      notFound: false,
      tables: [
        {
          tableId: 'sga-1',
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '給料手当', sourcePage: 4, values: { currentPeriod: '163,540,767' } },
          ],
        },
      ],
    },
  });

  it('đọc được đơn vị riêng và dịch nhãn theo targetLang', () => {
    const report = mergeTabularReport('sgaBreakdown', [location('sgaBreakdown', 4, 4)], [chunkWithUnit('円')], 'vi');
    expect(report.unit).toEqual({ source: '円', translated: 'Yên', multiplier: 1 });
  });

  it('không khai đơn vị → unit = null (downstream dùng đơn vị chung)', () => {
    const report = mergeTabularReport('sgaBreakdown', [location('sgaBreakdown', 4, 4)], [chunkWithUnit(null)], 'vi');
    expect(report.unit).toBeNull();
  });

  it('đơn vị lạ → giữ chữ nguồn, multiplier null + warning UNIT_NOT_FOUND', () => {
    const report = mergeTabularReport('sgaBreakdown', [location('sgaBreakdown', 4, 4)], [chunkWithUnit('đơn vị lạ')], 'vi');
    expect(report.unit).toEqual({ source: 'đơn vị lạ', translated: null, multiplier: null });
    expect(report.warnings.map((w) => w.code)).toContain('UNIT_NOT_FOUND');
  });

  it('normalized vẫn KHÔNG nhân multiplier', () => {
    const report = mergeTabularReport('sgaBreakdown', [location('sgaBreakdown', 4, 4)], [chunkWithUnit('円')], 'vi');
    expect(report.tables[0].rows[0].values.currentPeriod).toEqual({ raw: '163,540,767', normalized: 163540767 });
  });
});

// ─── Vòng #03: làm code bền với giả định về AI ────────────────────────────────

describe('B1 — AI không trả unitSource', () => {
  const chunk = (unitSource: string | null) => tableChunk({
    reportType: 'sgaBreakdown',
    pageFrom: 4,
    pageTo: 4,
    result: {
      reportType: 'sgaBreakdown',
      ...(unitSource === null ? {} : { unitSource }),
      notFound: false,
      tables: [
        {
          tableId: 'sga-1',
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '給料手当', sourcePage: 4, values: { currentPeriod: '163,540,767' } },
          ],
        },
      ],
    },
  });

  it('unit = null + warning REPORT_UNIT_ASSUMED_FROM_DOCUMENT để phân biệt với đơn vị riêng thật', () => {
    const report = mergeTabularReport('sgaBreakdown', [location('sgaBreakdown', 4, 4)], [chunk(null)], 'vi');
    expect(report.unit).toBeNull();
    expect(report.warnings.map((w) => w.code)).toContain('REPORT_UNIT_ASSUMED_FROM_DOCUMENT');
  });

  it('đọc được đơn vị riêng → KHÔNG có warning đó', () => {
    const report = mergeTabularReport('sgaBreakdown', [location('sgaBreakdown', 4, 4)], [chunk('円')], 'vi');
    expect(report.unit?.multiplier).toBe(1);
    expect(report.warnings.map((w) => w.code)).not.toContain('REPORT_UNIT_ASSUMED_FROM_DOCUMENT');
  });

  it('dữ liệu số vẫn nguyên vẹn khi thiếu đơn vị (không nhân multiplier)', () => {
    const report = mergeTabularReport('sgaBreakdown', [location('sgaBreakdown', 4, 4)], [chunk(null)], 'vi');
    expect(report.tables[0].rows[0].values.currentPeriod).toEqual({ raw: '163,540,767', normalized: 163540767 });
  });
});

describe('B2 — AI gán TẤT CẢ rowType = DETAIL', () => {
  /** Không có dòng nào là SECTION/TOTAL — rule cũ sẽ không nhận được khối nào. */
  const allDetailChunk = tableChunk({
    reportType: 'balanceSheet',
    pageFrom: 1,
    pageTo: 2,
    result: {
      reportType: 'balanceSheet',
      notFound: false,
      tables: [
        {
          tableId: 'bs-1',
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            { rowId: 'a', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '資産の部', sourcePage: 1, values: {} },
            { rowId: 'a1', parentRowId: null, level: 2, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 1, values: { currentPeriod: '5,288' } },
            // Nhãn khớp YẾU trong khối Tài sản: KHÔNG được làm lệch khối
            { rowId: 'a2', parentRowId: null, level: 2, rowType: 'DETAIL', labelSource: 'その他の負債性引当金', sourcePage: 1, values: { currentPeriod: '12' } },
            { rowId: 'l', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '負債の部', sourcePage: 2, values: {} },
            { rowId: 'l1', parentRowId: null, level: 2, rowType: 'DETAIL', labelSource: '買掛金', sourcePage: 2, values: { currentPeriod: '25,400' } },
            { rowId: 'e', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '純資産の部', sourcePage: 2, values: {} },
            { rowId: 'e1', parentRowId: null, level: 2, rowType: 'DETAIL', labelSource: '資本金', sourcePage: 2, values: { currentPeriod: '1,110' } },
          ],
        },
      ],
    },
  });

  const report = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 2)], [allDetailChunk], 'vi');
  const section = (label: string) => report.tables[0].rows.find((r) => r.label.source === label)?.statementSection;

  it('vẫn chia được khối nhờ nhãn cấu trúc (khớp mạnh), bất kể rowType', () => {
    expect(section('資産の部')).toBe('ASSETS');
    expect(section('現金及び預金')).toBe('ASSETS');
    expect(section('負債の部')).toBe('LIABILITIES');
    expect(section('買掛金')).toBe('LIABILITIES');
    expect(section('純資産の部')).toBe('EQUITY');
    expect(section('資本金')).toBe('EQUITY');
  });

  it('nhãn khớp YẾU trên dòng DETAIL vẫn KHÔNG làm lệch khối', () => {
    expect(section('その他の負債性引当金')).toBe('ASSETS');
  });

  it('nhận diện được đủ khối → KHÔNG gắn SECTION_DETECTION_WEAK', () => {
    expect(report.warnings.map((w) => w.code)).not.toContain('SECTION_DETECTION_WEAK');
  });

  it('nhãn khối tiếng Anh cũng khớp mạnh khi rowType = DETAIL', () => {
    const enChunk = tableChunk({
      reportType: 'balanceSheet',
      pageFrom: 1,
      pageTo: 1,
      result: {
        reportType: 'balanceSheet',
        notFound: false,
        tables: [
          {
            tableId: 'bs-1',
            columns: [{ id: 'currentPeriod', labelSource: 'Current', dataType: 'number', period: '2025-09-30' }],
            rows: [
              { rowId: 'a', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: 'Assets', sourcePage: 1, values: {} },
              { rowId: 'a1', parentRowId: null, level: 2, rowType: 'DETAIL', labelSource: 'Cash and deposits', sourcePage: 1, values: { currentPeriod: '5,288' } },
              { rowId: 'l', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: 'Total liabilities', sourcePage: 1, values: { currentPeriod: '53,278' } },
            ],
          },
        ],
      },
    });
    const en = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 1)], [enChunk], 'vi');
    const rows = en.tables[0].rows;
    expect(rows.find((r) => r.label.source === 'Cash and deposits')?.statementSection).toBe('ASSETS');
    expect(rows.find((r) => r.label.source === 'Total liabilities')?.statementSection).toBe('LIABILITIES');
  });

  it('không nhãn khối nào đọc được → SECTION_DETECTION_WEAK', () => {
    const noSectionChunk = tableChunk({
      reportType: 'balanceSheet',
      pageFrom: 1,
      pageTo: 1,
      result: {
        reportType: 'balanceSheet',
        notFound: false,
        tables: [
          {
            tableId: 'bs-1',
            columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
            rows: [
              { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: 1, values: { currentPeriod: '5,288' } },
              { rowId: 'r2', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売掛金', sourcePage: 1, values: { currentPeriod: '29,112' } },
            ],
          },
        ],
      },
    });
    const weak = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 1)], [noSectionChunk], 'vi');
    expect(weak.warnings.map((w) => w.code)).toContain('SECTION_DETECTION_WEAK');
    expect(weak.tables[0].rows.every((r) => r.statementSection === null)).toBe(true);
    // Vẫn giữ đủ số liệu, không bỏ dòng nào.
    expect(weak.tables[0].rows).toHaveLength(2);
  });
});

describe('B4 — column.id đổi giữa các chunk', () => {
  const first = tableChunk({
    reportType: 'incomeStatement',
    chunkIndex: 0,
    pageFrom: 1,
    pageTo: 1,
    result: {
      reportType: 'incomeStatement',
      notFound: false,
      tables: [
        {
          tableId: 'is-1',
          columns: [
            { id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' },
            { id: 'previousPeriod', labelSource: '前期', dataType: 'number', period: null },
          ],
          rows: [
            { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売上高', sourcePage: 1, values: { currentPeriod: '124,732', previousPeriod: '120,000' } },
          ],
        },
      ],
    },
  });

  /** Chunk 2 tự đặt id khác hoàn toàn nhưng vẫn 2 cột, đúng thứ tự. */
  const secondRenamed = tableChunk({
    reportType: 'incomeStatement',
    chunkIndex: 1,
    pageFrom: 2,
    pageTo: 2,
    result: {
      reportType: 'incomeStatement',
      notFound: false,
      tables: [
        {
          tableId: 'is-2',
          isContinuation: true,
          columns: [
            { id: 'col1', labelSource: '当期', dataType: 'number', period: '2025-03-31' },
            { id: 'col2', labelSource: '前期', dataType: 'number', period: '2024-03-31' },
          ],
          rows: [
            { rowId: 'r2', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売上原価', sourcePage: 2, values: { col1: '115,469', col2: '△37' } },
          ],
        },
      ],
    },
  });

  const report = mergeTabularReport('incomeStatement', [location('incomeStatement', 1, 2)], [first, secondRenamed], 'vi');

  it('vẫn nối vào bảng 1 thay vì tạo bảng rời', () => {
    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].rows.map((r) => r.label.source)).toEqual(['売上高', '売上原価']);
  });

  it('gắn warning COLUMN_ID_REMAPPED, không im lặng', () => {
    expect(report.warnings.map((w) => w.code)).toContain('COLUMN_ID_REMAPPED');
  });

  it('giá trị của chunk 2 map đúng cột theo VỊ TRÍ, không bị loại', () => {
    const row = report.tables[0].rows.find((r) => r.label.source === '売上原価')!;
    expect(row.values.currentPeriod).toEqual({ raw: '115,469', normalized: 115469 });
    expect(row.values.previousPeriod).toEqual({ raw: '△37', normalized: -37 });
    expect(report.warnings.map((w) => w.code)).not.toContain('UNKNOWN_COLUMN_DROPPED');
  });

  it('vẫn bổ sung period còn thiếu sau khi remap (không ghi đè)', () => {
    const cols = report.tables[0].columns;
    expect(cols.map((c) => c.id)).toEqual(['currentPeriod', 'previousPeriod']);
    expect(cols.find((c) => c.id === 'previousPeriod')?.period).toBe('2024-03-31');
    expect(cols.find((c) => c.id === 'currentPeriod')?.period).toBe('2025-03-31');
  });

  it('KHÁC số lượng cột → KHÔNG remap, tạo bảng mới như trước', () => {
    const secondDifferentCount = tableChunk({
      reportType: 'incomeStatement',
      chunkIndex: 1,
      pageFrom: 2,
      pageTo: 2,
      result: {
        reportType: 'incomeStatement',
        notFound: false,
        tables: [
          {
            tableId: 'is-2',
            isContinuation: true,
            columns: [{ id: 'onlyOne', labelSource: '当期', dataType: 'number', period: null }],
            rows: [
              { rowId: 'r2', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売上原価', sourcePage: 2, values: { onlyOne: '115,469' } },
            ],
          },
        ],
      },
    });
    const other = mergeTabularReport('incomeStatement', [location('incomeStatement', 1, 2)], [first, secondDifferentCount], 'vi');
    expect(other.tables).toHaveLength(2);
    expect(other.warnings.map((w) => w.code)).not.toContain('COLUMN_ID_REMAPPED');
  });

  it('KHÁC locationIndex → KHÔNG remap dù cùng số cột (giữ rule mục 2)', () => {
    const otherLocation = tableChunk({
      reportType: 'incomeStatement',
      locationIndex: 1,
      chunkIndex: 0,
      pageFrom: 40,
      pageTo: 40,
      result: {
        reportType: 'incomeStatement',
        notFound: false,
        tables: [
          {
            tableId: 'is-x',
            isContinuation: true,
            columns: [
              { id: 'colA', labelSource: '当期', dataType: 'number', period: null },
              { id: 'colB', labelSource: '前期', dataType: 'number', period: null },
            ],
            rows: [
              { rowId: 'r9', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '売上高', sourcePage: 40, values: { colA: '999' } },
            ],
          },
        ],
      },
    });
    const two = mergeTabularReport(
      'incomeStatement',
      [location('incomeStatement', 1, 2), location('incomeStatement', 40, 40)],
      [first, otherLocation],
      'vi',
    );
    expect(two.tables).toHaveLength(2);
    expect(two.warnings.map((w) => w.code)).not.toContain('COLUMN_ID_REMAPPED');
  });
});

// ─── Vòng #04 mục 1: remap cột phải khớp theo KỲ, không theo vị trí ───────────

describe('Vòng #04 — remap column.id khi AI đảo thứ tự cột', () => {
  /** Chunk 1: [currentPeriod (2025), previousPeriod (2024)]. */
  const first = (withPeriods: boolean) => tableChunk({
    reportType: 'balanceSheet',
    chunkIndex: 0,
    pageFrom: 1,
    pageTo: 1,
    result: {
      reportType: 'balanceSheet',
      notFound: false,
      tables: [
        {
          tableId: 'bs-1',
          columns: [
            { id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: withPeriods ? '2025-03-31' : null },
            { id: 'previousPeriod', labelSource: '前期', dataType: 'number', period: withPeriods ? '2024-03-31' : null },
          ],
          rows: [
            {
              rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL',
              labelSource: '現金及び預金', sourcePage: 1,
              values: { currentPeriod: '5,288', previousPeriod: '4,900' },
            },
          ],
        },
      ],
    },
  });

  /** Chunk 2: id khác, và thứ tự cột ĐẢO so với chunk 1. */
  const secondSwapped = (periods: [string | null, string | null]) => tableChunk({
    reportType: 'balanceSheet',
    chunkIndex: 1,
    pageFrom: 2,
    pageTo: 2,
    result: {
      reportType: 'balanceSheet',
      notFound: false,
      tables: [
        {
          tableId: 'bs-2',
          isContinuation: true,
          columns: [
            // cột ĐẦU của chunk 2 là kỳ TRƯỚC (đảo so với chunk 1)
            { id: 'colA', labelSource: '前期', dataType: 'number', period: periods[0] },
            { id: 'colB', labelSource: '当期', dataType: 'number', period: periods[1] },
          ],
          rows: [
            {
              rowId: 'r2', parentRowId: null, level: 1, rowType: 'DETAIL',
              labelSource: '売掛金', sourcePage: 2,
              // colA = kỳ trước = 1,111 ; colB = kỳ này = 29,112
              values: { colA: '1,111', colB: '29,112' },
            },
          ],
        },
      ],
    },
  });

  it('period khớp nhưng ĐẢO THỨ TỰ → map theo KỲ, giá trị vào đúng kỳ', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1, 2)],
      [first(true), secondSwapped(['2024-03-31', '2025-03-31'])],
      'vi',
    );

    expect(report.tables).toHaveLength(1);
    const row = report.tables[0].rows.find((r) => r.label.source === '売掛金')!;
    // Nếu map theo vị trí thì 2 giá trị này bị đổi chỗ → sai kỳ báo cáo.
    expect(row.values.currentPeriod).toEqual({ raw: '29,112', normalized: 29112 });
    expect(row.values.previousPeriod).toEqual({ raw: '1,111', normalized: 1111 });
  });

  it('warning COLUMN_ID_REMAPPED nói rõ khớp theo KỲ báo cáo', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1, 2)],
      [first(true), secondSwapped(['2024-03-31', '2025-03-31'])],
      'vi',
    );
    const warning = report.warnings.find((w) => w.code === 'COLUMN_ID_REMAPPED');
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('KỲ báo cáo');
    expect(warning!.message).toContain('colA→previousPeriod');
    expect(warning!.message).toContain('colB→currentPeriod');
  });

  it('CANARY — không bên nào có period → vẫn fallback map theo VỊ TRÍ như trước', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1, 2)],
      [first(false), secondSwapped([null, null])],
      'vi',
    );

    expect(report.tables).toHaveLength(1);
    const row = report.tables[0].rows.find((r) => r.label.source === '売掛金')!;
    // Không có period thì không có cách nào biết AI đảo cột → giữ hành vi cũ theo vị trí.
    expect(row.values.currentPeriod).toEqual({ raw: '1,111', normalized: 1111 });
    expect(row.values.previousPeriod).toEqual({ raw: '29,112', normalized: 29112 });
    const warning = report.warnings.find((w) => w.code === 'COLUMN_ID_REMAPPED');
    expect(warning!.message).toContain('VỊ TRÍ cột');
  });

  it('period hai bên KHÁC HOÀN TOÀN → KHÔNG nối bảng + TABLE_CONTINUATION_UNCERTAIN', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1, 2)],
      [first(true), secondSwapped(['2019-03-31', '2018-03-31'])],
      'vi',
    );

    // Thà tách bảng còn hơn ghép sai kỳ.
    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((w) => w.code)).toContain('TABLE_CONTINUATION_UNCERTAIN');
    expect(report.warnings.map((w) => w.code)).not.toContain('COLUMN_ID_REMAPPED');
    // Dữ liệu vẫn còn đủ, không mất dòng nào.
    expect(report.tables[0].rows).toHaveLength(1);
    expect(report.tables[1].rows).toHaveLength(1);
  });

  it('chỉ MỘT bên khai period → fallback theo vị trí, không coi là conflict', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1, 2)],
      [first(true), secondSwapped([null, null])],
      'vi',
    );
    expect(report.tables).toHaveLength(1);
    expect(report.warnings.map((w) => w.code)).toContain('COLUMN_ID_REMAPPED');
  });

  it('period trùng lặp trong cùng một bên → fallback theo vị trí (không map nhập nhằng)', () => {
    const duplicated = tableChunk({
      reportType: 'balanceSheet',
      chunkIndex: 1,
      pageFrom: 2,
      pageTo: 2,
      result: {
        reportType: 'balanceSheet',
        notFound: false,
        tables: [
          {
            tableId: 'bs-2',
            isContinuation: true,
            columns: [
              { id: 'colA', labelSource: '当期', dataType: 'number', period: '2025-03-31' },
              { id: 'colB', labelSource: '当期', dataType: 'number', period: '2025-03-31' },
            ],
            rows: [
              {
                rowId: 'r2', parentRowId: null, level: 1, rowType: 'DETAIL',
                labelSource: '売掛金', sourcePage: 2, values: { colA: '1', colB: '2' },
              },
            ],
          },
        ],
      },
    });

    const report = mergeTabularReport('balanceSheet', [location('balanceSheet', 1, 2)], [first(true), duplicated], 'vi');
    expect(report.tables).toHaveLength(1);
    const warning = report.warnings.find((w) => w.code === 'COLUMN_ID_REMAPPED');
    expect(warning!.message).toContain('VỊ TRÍ cột');
  });
});


describe('Round 13 T13.1 — không remap theo vị trí khi bảng bị cắt dọc', () => {
  const columns = (prefix: string) => Array.from({ length: 7 }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    labelSource: `${prefix} column ${index + 1}`,
    dataType: 'number' as const,
    period: null,
  }));
  const rows = (labels: string[], columnPrefix: string, page: number, valueOffset = 0) => labels.map((label, rowIndex) => ({
    rowId: `${columnPrefix}-${rowIndex + 1}`,
    parentRowId: null,
    level: 1,
    rowType: 'DETAIL',
    labelSource: label,
    sourcePage: page,
    values: Object.fromEntries(Array.from({ length: 7 }, (_, columnIndex) => [
      `${columnPrefix}${columnIndex + 1}`,
      String(valueOffset + (rowIndex + 1) * 100 + columnIndex + 1),
    ])),
  }));
  const makeSplit = (firstLabels: string[], secondLabels: string[], secondValueOffset = 0) => mergeTabularReport(
    'incomeStatement',
    [location('incomeStatement', 1, 2)],
    [
      tableChunk({
        reportType: 'incomeStatement', chunkIndex: 0, pageFrom: 1, pageTo: 1,
        result: { reportType: 'incomeStatement', notFound: false, tables: [{ tableId: 'left', columns: columns('left'), rows: rows(firstLabels, 'left', 1) }] },
      }),
      tableChunk({
        reportType: 'incomeStatement', chunkIndex: 1, pageFrom: 2, pageTo: 2,
        result: { reportType: 'incomeStatement', notFound: false, tables: [{ tableId: 'right', isContinuation: true, columns: columns('right'), rows: rows(secondLabels, 'right', 2, secondValueOffset) }] },
      }),
    ],
  );

  it('cắt DỌC: hai phần 7 cột có nhãn trùng 100% vẫn là 2 bảng, không đổi cột', () => {
    const report = makeSplit(['Opening balance', 'Closing balance'], ['Opening balance', 'Closing balance'], 1000);

    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((warning) => warning.code)).toContain('TABLE_SPLIT_HORIZONTALLY');
    expect(report.warnings.map((warning) => warning.code)).not.toContain('COLUMN_ID_REMAPPED');
    expect(report.tables[0].rows[0].values).toHaveProperty('left1', { raw: '101', normalized: 101 });
    expect(report.tables[0].rows[0].values).not.toHaveProperty('right1');
    expect(report.tables[1].rows[0].values).toHaveProperty('right1', { raw: '1101', normalized: 1101 });
    expect(report.tables[1].rows[0].values).not.toHaveProperty('left1');
  });

  it('BẢO VỆ cắt NGANG: nhãn khác hoàn toàn vẫn remap theo vị trí như hành vi cũ', () => {
    const report = makeSplit(['Revenue', 'Cost of sales'], ['Operating profit', 'Income tax']);

    expect(report.tables).toHaveLength(1);
    expect(report.warnings.map((warning) => warning.code)).toContain('COLUMN_ID_REMAPPED');
    expect(report.warnings.map((warning) => warning.code)).not.toContain('TABLE_SPLIT_HORIZONTALLY');
    expect(report.tables[0].rows.find((row) => row.label.source === 'Operating profit')?.values.left1)
      .toEqual({ raw: '101', normalized: 101 });
  });

  it('biên 50% nhãn trùng thuộc nhánh không remap', () => {
    const report = makeSplit(['Opening balance', 'Share capital'], ['Opening balance', 'Net income']);

    expect(report.tables).toHaveLength(2);
    expect(report.warnings.map((warning) => warning.code)).toContain('TABLE_SPLIT_HORIZONTALLY');
    expect(report.warnings.map((warning) => warning.code)).not.toContain('COLUMN_ID_REMAPPED');
  });

  it('bàn giao equity cắt DỌC sang union: giữ nguyên 14 cột và từng giá trị ở cột gốc', () => {
    const report = mergeTabularReport(
      'equityChangeStatement',
      [location('equityChangeStatement', 1, 2)],
      [
        tableChunk({
          reportType: 'equityChangeStatement', chunkIndex: 0, pageFrom: 1, pageTo: 1,
          result: {
            reportType: 'equityChangeStatement', notFound: false, unitSource: 'JPY',
            tables: [{
              tableId: 'equity-left', columns: columns('left'),
              rows: rows(['Opening balance', 'Closing balance'], 'left', 1),
            }],
          },
        }),
        tableChunk({
          reportType: 'equityChangeStatement', chunkIndex: 1, pageFrom: 2, pageTo: 2,
          result: {
            reportType: 'equityChangeStatement', notFound: false, unitSource: 'JPY',
            tables: [{
              tableId: 'equity-right', isContinuation: true, columns: columns('right'),
              rows: rows(['Opening balance', 'Closing balance'], 'right', 2, 1000),
            }],
          },
        }),
      ],
    );

    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].columns.map((column) => column.id)).toEqual([
      ...columns('left').map((column) => column.id),
      ...columns('right').map((column) => column.id),
    ]);
    expect(report.tables[0].rows.find((row) => row.label.source === 'Opening balance')?.values).toMatchObject({
      left1: { normalized: 101 },
      left7: { normalized: 107 },
      right1: { normalized: 1101 },
      right7: { normalized: 1107 },
    });
    expect(report.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'TABLE_SPLIT_HORIZONTALLY',
      'COLUMN_SET_UNIONED',
    ]));
    expect(report.warnings.map((warning) => warning.code)).not.toContain('COLUMN_ID_REMAPPED');
  });
});
