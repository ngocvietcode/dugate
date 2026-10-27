// tests/financial-report/round05-fixes.test.ts
// Vòng #05 — sửa các warning dương tính giả và chuẩn hoá ngày/tiền tệ/đơn vị.
//   mục 35 [B] findRowByKeywords loại nhãn "phần của công ty mẹ" / tổng cuối bảng
//   mục 36 [C] mapAiWarning khớp chính xác, không suy diễn bằng includes
//   mục 37 [D] validateColumnPeriods không áp cho equityChangeStatement
//   mục 38 [E] normalizeDate nhận tên tháng tiếng Anh
//   mục 39 [F] normalizeCurrency ưu tiên alias; resolveUnit bỏ tiền tố "Unit:" / "単位:"

import { mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import { normalizeCurrency, normalizeDate, resolveUnit } from '@/lib/pipelines/workflows/financial-report/number-parse';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { ReportType } from '@/lib/pipelines/workflows/financial-report/types';

// ─── Helper dựng chunk extract ────────────────────────────────────────────────

interface RowSpec {
  label: string;
  value: string;
  rowType?: string;
}

function location(reportType: ReportType): ReportLocation {
  return { reportType, pageFrom: 1, pageTo: 1, titleSource: 'T' };
}

function chunk(
  reportType: ReportType,
  rows: RowSpec[],
  options: {
    columns?: Array<{ id: string; labelSource: string; dataType?: string; period?: string | null }>;
    aiWarnings?: string[];
    unitSource?: string;
  } = {},
): TableChunkOutcome {
  const columns = options.columns ?? [
    { id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' },
  ];
  return {
    reportType,
    locationIndex: 0,
    chunkIndex: 0,
    pageFrom: 1,
    pageTo: 1,
    aiWarnings: options.aiWarnings ?? [],
    result: {
      reportType,
      notFound: false,
      unitSource: options.unitSource,
      tables: [
        {
          tableId: 't1',
          isContinuation: false,
          columns,
          rows: rows.map((r, i) => ({
            rowId: `r${i}`,
            parentRowId: null,
            level: 1,
            rowType: r.rowType ?? 'DETAIL',
            labelSource: r.label,
            sourcePage: 1,
            values: { currentPeriod: r.value },
          })),
        },
      ],
    },
  } as unknown as TableChunkOutcome;
}

function warningsOf(reportType: ReportType, chunks: TableChunkOutcome[]): string[] {
  const report = mergeTabularReport(reportType, [location(reportType)], chunks, 'vi');
  return report.warnings.map((w) => w.code);
}

// ─── [B] mục 35 ───────────────────────────────────────────────────────────────

describe('mục 35 — validateBalanceSheetTotals không nhầm dòng tổng', () => {
  it('bảng IFRS có "attributable to owners of parent" ĐỨNG TRƯỚC "Total equity" → KHÔNG TOTAL_MISMATCH', () => {
    const codes = warningsOf('balanceSheet', [
      chunk('balanceSheet', [
        { label: 'Total assets', value: '1,000', rowType: 'TOTAL' },
        { label: 'Total liabilities', value: '600', rowType: 'TOTAL' },
        { label: 'Total equity attributable to owners of parent', value: '350', rowType: 'TOTAL' },
        { label: 'Non-controlling interests', value: '50' },
        { label: 'Total equity', value: '400', rowType: 'TOTAL' },
        { label: 'Total liabilities and equity', value: '1,000', rowType: 'TOTAL' },
      ]),
    ]);
    expect(codes).not.toContain('TOTAL_MISMATCH');
  });

  it('bảng tiếng Nhật: 純資産合計 chứa chuỗi con 資産合計 nhưng KHÔNG bị nhận là tổng tài sản', () => {
    const codes = warningsOf('balanceSheet', [
      chunk('balanceSheet', [
        { label: '資産合計', value: '1,000', rowType: 'TOTAL' },
        { label: '負債合計', value: '600', rowType: 'TOTAL' },
        { label: '純資産合計', value: '400', rowType: 'TOTAL' },
        { label: '負債純資産合計', value: '1,000', rowType: 'TOTAL' },
      ]),
    ]);
    expect(codes).not.toContain('TOTAL_MISMATCH');
  });

  it('CANARY — số liệu lệch thật thì VẪN phải cảnh báo', () => {
    const codes = warningsOf('balanceSheet', [
      chunk('balanceSheet', [
        { label: 'Total assets', value: '1,000', rowType: 'TOTAL' },
        { label: 'Total liabilities', value: '600', rowType: 'TOTAL' },
        { label: 'Total equity', value: '350', rowType: 'TOTAL' },
      ]),
    ]);
    expect(codes).toContain('TOTAL_MISMATCH');
  });

  it('equityChangeStatement: dòng "当期変動額合計" gắn CHANGE không bị đếm đôi', () => {
    const codes = warningsOf('equityChangeStatement', [
      chunk('equityChangeStatement', [
        { label: '当期首残高', value: '1,000', rowType: 'OPENING_BALANCE' },
        { label: '剰余金の配当', value: '△100', rowType: 'CHANGE' },
        { label: '当期純利益', value: '300', rowType: 'CHANGE' },
        { label: '当期変動額合計', value: '200', rowType: 'CHANGE' },
        { label: '当期末残高', value: '1,200', rowType: 'CLOSING_BALANCE' },
      ]),
    ]);
    expect(codes).not.toContain('TOTAL_MISMATCH');
  });

  it.each(['包括利益', '当期包括利益', 'Comprehensive income', 'Total comprehensive income'])(
    'equityChangeStatement: dòng "%s" gắn CHANGE không bị đếm đôi',
    (comprehensiveIncomeLabel) => {
      const codes = warningsOf('equityChangeStatement', [
        chunk('equityChangeStatement', [
          { label: '当期首残高', value: '1,000', rowType: 'OPENING_BALANCE' },
          { label: '剰余金の配当', value: '△100', rowType: 'CHANGE' },
          { label: '当期純利益', value: '300', rowType: 'CHANGE' },
          { label: comprehensiveIncomeLabel, value: '200', rowType: 'CHANGE' },
          { label: '当期末残高', value: '1,200', rowType: 'CLOSING_BALANCE' },
        ]),
      ]);
      expect(codes).not.toContain('TOTAL_MISMATCH');
    },
  );

  it('CANARY — biến động vốn lệch thật vẫn cảnh báo', () => {
    const codes = warningsOf('equityChangeStatement', [
      chunk('equityChangeStatement', [
        { label: '当期首残高', value: '1,000', rowType: 'OPENING_BALANCE' },
        { label: '当期純利益', value: '300', rowType: 'CHANGE' },
        { label: '当期末残高', value: '1,500', rowType: 'CLOSING_BALANCE' },
      ]),
    ]);
    expect(codes).toContain('TOTAL_MISMATCH');
  });
});

// ─── [C] mục 36 ───────────────────────────────────────────────────────────────

describe('mục 36 — mapAiWarning không suy diễn bằng includes', () => {
  it('câu mô tả có chữ "unit"/"period" KHÔNG sinh warning', () => {
    const codes = warningsOf('balanceSheet', [
      chunk('balanceSheet', [{ label: '現金及び預金', value: '100' }], {
        aiWarnings: [
          'Unit is stated in millions of yen on page 1',
          'The period column header spans two lines',
          'Confidence in row detection is high',
        ],
      }),
    ]);
    expect(codes).not.toContain('UNIT_NOT_FOUND');
    expect(codes).not.toContain('PERIOD_AMBIGUOUS');
    expect(codes).not.toContain('LOW_CONFIDENCE_PAGE');
  });

  it('mã chính xác vẫn nhận', () => {
    const codes = warningsOf('balanceSheet', [
      chunk('balanceSheet', [{ label: '現金及び預金', value: '100' }], {
        aiWarnings: ['LOW_CONFIDENCE_PAGE'],
      }),
    ]);
    expect(codes).toContain('LOW_CONFIDENCE_PAGE');
  });

  it('alias tường minh vẫn nhận (LOW_CONFIDENCE → LOW_CONFIDENCE_PAGE)', () => {
    const codes = warningsOf('balanceSheet', [
      chunk('balanceSheet', [{ label: '現金及び預金', value: '100' }], {
        aiWarnings: ['low_confidence'],
      }),
    ]);
    expect(codes).toContain('LOW_CONFIDENCE_PAGE');
  });

  it('AI báo UNIT_NOT_FOUND nhưng đơn vị đọc được → KHÔNG gắn UNIT_NOT_FOUND', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet')],
      [chunk('balanceSheet', [{ label: '現金及び預金', value: '100' }], {
        aiWarnings: ['UNIT_NOT_FOUND'],
        unitSource: '百万円',
      })],
      'vi',
    );
    expect(report.unit?.multiplier).toBe(1_000_000);
    expect(report.warnings.map((w) => w.code)).not.toContain('UNIT_NOT_FOUND');
  });

  it('CANARY — đơn vị lạ (có source, không ra multiplier) VẪN gắn UNIT_NOT_FOUND', () => {
    const report = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet')],
      [chunk('balanceSheet', [{ label: '現金及び預金', value: '100' }], { unitSource: 'ゴールド換算' })],
      'vi',
    );
    expect(report.unit?.multiplier).toBeNull();
    expect(report.warnings.map((w) => w.code)).toContain('UNIT_NOT_FOUND');
  });
});

// ─── [D] mục 37 ───────────────────────────────────────────────────────────────

describe('mục 37 — PERIOD_AMBIGUOUS không áp cho equityChangeStatement', () => {
  const componentColumns = [
    { id: 'capitalStock', labelSource: '資本金', dataType: 'number', period: null },
    { id: 'retainedEarnings', labelSource: '利益剰余金', dataType: 'number', period: null },
  ];

  it('cột là THÀNH PHẦN vốn, không có period → KHÔNG cảnh báo', () => {
    const codes = warningsOf('equityChangeStatement', [
      chunk('equityChangeStatement', [{ label: '当期首残高', value: '100' }], { columns: componentColumns }),
    ]);
    expect(codes).not.toContain('PERIOD_AMBIGUOUS');
  });

  it('CANARY — balanceSheet thiếu period VẪN cảnh báo', () => {
    const codes = warningsOf('balanceSheet', [
      chunk('balanceSheet', [{ label: '現金及び預金', value: '100' }], {
        columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: null }],
      }),
    ]);
    expect(codes).toContain('PERIOD_AMBIGUOUS');
  });
});

// ─── [E] mục 38 ───────────────────────────────────────────────────────────────

describe('mục 38 — normalizeDate nhận tên tháng tiếng Anh', () => {
  const months: Array<[string, string, string]> = [
    ['January', 'Jan', '01'],
    ['February', 'Feb', '02'],
    ['March', 'Mar', '03'],
    ['April', 'Apr', '04'],
    ['May', 'May', '05'],
    ['June', 'Jun', '06'],
    ['July', 'Jul', '07'],
    ['August', 'Aug', '08'],
    ['September', 'Sep', '09'],
    ['October', 'Oct', '10'],
    ['November', 'Nov', '11'],
    ['December', 'Dec', '12'],
  ];

  it.each(months)('%s — dạng "Month D, YYYY" (đầy đủ và viết tắt)', (full, abbr, mm) => {
    expect(normalizeDate(`${full} 1, 2025`)).toBe(`2025-${mm}-01`);
    expect(normalizeDate(`${abbr} 1, 2025`)).toBe(`2025-${mm}-01`);
  });

  it.each(months)('%s — dạng "D Month YYYY" (đầy đủ và viết tắt)', (full, abbr, mm) => {
    expect(normalizeDate(`30 ${full} 2025`)).toBe(`2025-${mm}-30`);
    expect(normalizeDate(`30 ${abbr} 2025`)).toBe(`2025-${mm}-30`);
  });

  it('đúng mẫu Air Water: "As of 30 September 2025"', () => {
    expect(normalizeDate('As of 30 September 2025')).toBe('2025-09-30');
  });

  it('chấp nhận hậu tố thứ tự và dấu chấm viết tắt', () => {
    expect(normalizeDate('31st March, 2026')).toBe('2026-03-31');
    expect(normalizeDate('Apr. 1, 2025')).toBe('2025-04-01');
  });

  it('KHÔNG đoán khi thiếu ngày — giữ nguyên chuỗi gốc', () => {
    expect(normalizeDate('March 2025')).toBe('March 2025');
    expect(normalizeDate('FY2024')).toBe('FY2024');
  });

  it('không phá các dạng đã hỗ trợ trước đó', () => {
    expect(normalizeDate('2025-03-31')).toBe('2025-03-31');
    expect(normalizeDate('2025/3/31')).toBe('2025-03-31');
    expect(normalizeDate('2025年3月31日')).toBe('2025-03-31');
    expect(normalizeDate('31/03/2025')).toBe('2025-03-31');
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate('   ')).toBeNull();
  });
});

// ─── [F] mục 39 ───────────────────────────────────────────────────────────────

describe('mục 39 — normalizeCurrency ưu tiên bảng alias', () => {
  it('"YEN" (3 ký tự) → JPY, không còn passthrough thành "YEN"', () => {
    expect(normalizeCurrency('YEN')).toBe('JPY');
    expect(normalizeCurrency('Yen')).toBe('JPY');
    expect(normalizeCurrency('yen')).toBe('JPY');
  });

  it('các alias khác', () => {
    expect(normalizeCurrency('円')).toBe('JPY');
    expect(normalizeCurrency('¥')).toBe('JPY');
    expect(normalizeCurrency('JPY')).toBe('JPY');
    expect(normalizeCurrency('US Dollar')).toBe('USD');
    expect(normalizeCurrency('đồng')).toBe('VND');
    expect(normalizeCurrency('EUR')).toBe('EUR');
  });

  it('mã ISO 3 ký tự chưa có alias vẫn passthrough hoa hoá', () => {
    expect(normalizeCurrency('krw')).toBe('KRW');
    expect(normalizeCurrency('thb')).toBe('THB');
  });

  it('không nhận diện được → giữ nguyên chuỗi', () => {
    expect(normalizeCurrency('không rõ')).toBe('không rõ');
    expect(normalizeCurrency(null)).toBeNull();
  });
});

describe('mục 39 — resolveUnit bỏ tiền tố "Unit:" / "単位:"', () => {
  it('"(単位:百万円)" → source sạch + multiplier đúng', () => {
    const unit = resolveUnit('(単位:百万円)', 'vi');
    expect(unit.source).toBe('百万円');
    expect(unit.multiplier).toBe(1_000_000);
    expect(unit.translated).toBe('Triệu yên');
  });

  it('"単位:千円" và "Unit: millions of yen"', () => {
    expect(resolveUnit('単位:千円', 'vi').source).toBe('千円');
    expect(resolveUnit('単位:千円', 'vi').multiplier).toBe(1_000);

    const en = resolveUnit('Unit: millions of yen', 'en');
    expect(en.source).toBe('millions of yen');
    expect(en.multiplier).toBe(1_000_000);
    expect(en.translated).toBe('Million yen');
  });

  it('"In millions of yen" / "(Millions of yen)"', () => {
    expect(resolveUnit('In millions of yen', 'vi').source).toBe('millions of yen');
    expect(resolveUnit('(Millions of yen)', 'vi').source).toBe('Millions of yen');
  });

  it('không có tiền tố thì giữ nguyên', () => {
    expect(resolveUnit('百万円', 'vi').source).toBe('百万円');
  });

  it('REGRESSION — normalized không bị nhân multiplier, rỗng vẫn ra null', () => {
    expect(resolveUnit(null, 'vi')).toEqual({ source: null, translated: null, multiplier: null });
    expect(resolveUnit('   ', 'vi')).toEqual({ source: null, translated: null, multiplier: null });
  });
});


// ─── Vòng fix sau pilot: TOTAL_MISMATCH không được do CHÍNH CODE gây ra ───────
//
// Ca thật trên Air Water (operation e7561bc7): equityChangeStatement có đồng thời
//   UNKNOWN_COLUMN_DROPPED — 1 giá trị bị loại
//   TOTAL_MISMATCH — số dư đầu kỳ 298517 + biến động -7661 ≠ số dư cuối kỳ 308032
// Thiếu đúng 17176. `buildValues()` loại giá trị thuộc column id không khai báo, nên phép
// tính chắc chắn không cân — nhưng lỗi ở phía mình làm mất dữ liệu, KHÔNG phải AI đọc sai số.
// Báo TOTAL_MISMATCH lúc đó khiến người đọc đi soi lại số của AI một cách vô ích.

describe('equityChangeStatement — có giá trị bị loại thì KHÔNG kết luận lệch tổng', () => {
  /** Dựng chunk có 1 giá trị nằm ở column id KHÔNG khai báo trong columns[]. */
  function chunkWithStrayValue(): TableChunkOutcome {
    const base = chunk('equityChangeStatement', [
      { label: '当期首残高', value: '298,517', rowType: 'OPENING_BALANCE' },
      { label: '剰余金の配当', value: '△7,661', rowType: 'CHANGE' },
      { label: '当期末残高', value: '308,032', rowType: 'CLOSING_BALANCE' },
    ]);
    // Thêm một dòng biến động mà AI đặt vào column id lạ → sẽ bị buildValues() loại bỏ.
    const table = base.result!.tables![0] as unknown as {
      rows: Array<Record<string, unknown>>;
    };
    table.rows.push({
      rowId: 'r-stray',
      parentRowId: null,
      level: 1,
      rowType: 'CHANGE',
      labelSource: '自己株式の処分',
      sourcePage: 1,
      values: { thisColumnWasNeverDeclared: '17,176' },
    });
    return base;
  }

  it('giá trị bị loại → có UNKNOWN_COLUMN_DROPPED và KHÔNG có TOTAL_MISMATCH', () => {
    const codes = warningsOf('equityChangeStatement', [chunkWithStrayValue()]);
    expect(codes).toContain('UNKNOWN_COLUMN_DROPPED');
    expect(codes).not.toContain('TOTAL_MISMATCH');
  });

  it('nói rõ vì sao bỏ kiểm tra, không im lặng', () => {
    const report = mergeTabularReport(
      'equityChangeStatement', [location('equityChangeStatement')], [chunkWithStrayValue()], 'vi',
    );
    const dropped = report.warnings.find((w) => w.code === 'UNKNOWN_COLUMN_DROPPED');
    expect(dropped?.message ?? '').toContain('Bỏ kiểm tra lệch tổng');
  });

  it('CANARY — không có giá trị nào bị loại thì lệch tổng thật vẫn phải cảnh báo', () => {
    const codes = warningsOf('equityChangeStatement', [
      chunk('equityChangeStatement', [
        { label: '当期首残高', value: '298,517', rowType: 'OPENING_BALANCE' },
        { label: '剰余金の配当', value: '△7,661', rowType: 'CHANGE' },
        { label: '当期末残高', value: '308,032', rowType: 'CLOSING_BALANCE' },
      ]),
    ]);
    expect(codes).not.toContain('UNKNOWN_COLUMN_DROPPED');
    expect(codes).toContain('TOTAL_MISMATCH');
  });
});
