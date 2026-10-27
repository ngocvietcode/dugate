// tests/financial-report/rules-r1-r4.test.ts
// Test RIÊNG cho 4 quy tắc nghiệp vụ chốt với BU (họp 2026-08):
//   R1 — Lẫn kỳ quý và kỳ năm → CHỈ lấy kỳ năm (loại bảng quý). Chỉ có quý → giữ quý.
//   R2 — Nhiều kỳ CÙNG loại → lấy HẾT (đủ cột, đủ bảng cùng loại).
//   R3 — Có hợp nhất và riêng lẻ → CHỈ lấy hợp nhất. Chỉ có riêng lẻ → giữ riêng lẻ.
//   R4 — Số âm: JSON giữ số âm THẬT (raw giữ nguyên △/▲/ngoặc). Trình bày ngoặc là ở tầng Excel.

import {
  detectConsolidation,
  detectPeriodScopeFromColumns,
} from '@/lib/pipelines/workflows/financial-report/classify';
import { mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import { parseFinancialNumber } from '@/lib/pipelines/workflows/financial-report/number-parse';
import { buildPayload } from '@/lib/pipelines/workflows/financial-report-translation';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { FinancialReportConfig, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

function config(): FinancialReportConfig {
  return {
    targetLang: 'vi', requestId: 'RULES', pagesPerChunk: 2, notesPagesPerChunk: 1,
    classifyPagesPerCall: 8, classifyRecheckUnassigned: false, classifyRecheckMaxWindows: 0,
    maxRetries: 1, maxConcurrency: 1, staggerDelayMs: 0, enableTranslation: false,
    renderScale: 2, reportTypes: [],
  };
}

function loc(reportType: ReportType, from: number, to: number, title: string, consolidation: 'CONSOLIDATED' | 'SEPARATE' | null): ReportLocation {
  return { reportType, pageFrom: from, pageTo: to, titleSource: title, consolidation };
}

function isChunk(locationIndex: number, from: number, to: number, title: string, value: string): TableChunkOutcome {
  return {
    reportType: 'incomeStatement', locationIndex, chunkIndex: 0, pageFrom: from, pageTo: to,
    result: {
      reportType: 'incomeStatement', titleSource: title, notFound: false,
      tables: [{
        columns: [{ id: 'fy2025', labelSource: '2025', dataType: 'number', period: '2025-03-31' }],
        rows: [{ rowId: 'r', labelSource: '売上高', rowType: 'DETAIL', sourcePage: from, values: { fy2025: value } }],
      }],
    },
    aiWarnings: [], failureReason: null,
  };
}

function bsChunk(locationIndex: number, page: number, title: string, value: string): TableChunkOutcome {
  return {
    reportType: 'balanceSheet', locationIndex, chunkIndex: 0, pageFrom: page, pageTo: page,
    result: {
      reportType: 'balanceSheet', titleSource: title, notFound: false,
      tables: [{
        columns: [{ id: 'cur', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
        rows: [{ rowId: 'r', labelSource: '現金及び預金', rowType: 'DETAIL', sourcePage: page, values: { cur: value } }],
      }],
    },
    aiWarnings: [], failureReason: null,
  };
}

/**
 * UAT 2026-08-06 — dựng theo dữ liệu THẬT của Sony: tiêu đề báo cáo KHÔNG chứa dấu hiệu kỳ,
 * kỳ chỉ nằm ở TIÊU ĐỀ CỘT. Cột `増減` là cột chênh lệch, không mang kỳ nào.
 * Các test R1 cũ nhúng sẵn kỳ vào tiêu đề (`［連結会計年度］`) nên không bắt được ca này.
 */
function sonyChunk(
  locationIndex: number,
  page: number,
  title: string,
  columnLabelSource: string,
  value: string,
): TableChunkOutcome {
  return {
    reportType: 'incomeStatement', locationIndex, chunkIndex: 0, pageFrom: page, pageTo: page,
    result: {
      reportType: 'incomeStatement', titleSource: title, notFound: false,
      tables: [{
        columns: [
          { id: 'c1', labelSource: columnLabelSource, dataType: 'number', period: null },
          { id: 'diff', labelSource: '増減', dataType: 'number', period: null },
        ],
        rows: [{ rowId: 'r', labelSource: '売上高', rowType: 'DETAIL', sourcePage: page, values: { c1: value, diff: '0' } }],
      }],
    },
    aiWarnings: [], failureReason: null,
  };
}

const SONY_FULL_YEAR_COLUMN = '2024年度\n(自 2024年４月１日\n 至 2025年３月31日)';
const SONY_QUARTER_COLUMN = '2024年度\n第４四半期連結会計期間\n（自 2025年1月1日\n 至 2025年3月31日）';

function classifiedWith(locations: ReportLocation[]) {
  return {
    sourceLanguage: 'ja', documentType: null, companyName: null, fromDate: null, toDate: null,
    currency: 'JPY', unit: '百万円', locations, classifiedWindows: 1, failedWindows: 0,
    failureReasons: [], unassignedPages: [],
  } as never;
}

describe('R1 — lẫn kỳ quý và kỳ năm thì chỉ lấy kỳ năm', () => {
  it('có cả năm và quý → loại bảng quý, chỉ giữ bảng năm, ghi bảng bị loại vào cảnh báo', () => {
    const report = mergeTabularReport(
      'incomeStatement',
      [
        loc('incomeStatement', 11, 12, '連結損益計算書［第４四半期連結会計期間］', 'CONSOLIDATED'),
        loc('incomeStatement', 8, 9, '連結損益計算書［連結会計年度］', 'CONSOLIDATED'),
      ],
      [isChunk(0, 11, 12, '連結損益計算書［第４四半期連結会計期間］', '2,804'), isChunk(1, 8, 9, '連結損益計算書［連結会計年度］', '12,034')],
    );
    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].periodScope).toBe('FULL_YEAR');
    expect(report.tables[0].rows[0].values.fy2025.normalized).toBe(12034);
    expect(report.warnings.find((w) => w.code === 'MULTIPLE_VARIANTS_MERGED')?.message).toContain('R1');
  });

  it('CHỈ có kỳ quý (không có năm) → GIỮ bảng quý + cảnh báo FULL_YEAR_VARIANT_MISSING', () => {
    const report = mergeTabularReport(
      'incomeStatement',
      [loc('incomeStatement', 11, 12, '連結損益計算書［第４四半期連結会計期間］', 'CONSOLIDATED')],
      [isChunk(0, 11, 12, '連結損益計算書［第４四半期連結会計期間］', '2,804')],
    );
    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].periodScope).toBe('QUARTER');
    expect(report.warnings.map((w) => w.code)).toContain('FULL_YEAR_VARIANT_MISSING');
    expect(report.warnings.map((w) => w.code)).not.toContain('SEPARATE_SET_EXCLUDED');
  });

  // Hồi quy cho lỗi UAT 2026-08-06: Sony giữ cả 4 bảng KQKD vì tiêu đề không có dấu hiệu kỳ.
  it('kỳ CHỈ có ở tiêu đề cột (ca Sony thật) → vẫn loại bảng quý, giữ bảng năm', () => {
    const report = mergeTabularReport(
      'incomeStatement',
      [
        loc('incomeStatement', 11, 11, '（４）連結損益計算書', 'CONSOLIDATED'),
        loc('incomeStatement', 8, 8, '連結損益計算書', 'CONSOLIDATED'),
      ],
      [
        sonyChunk(0, 11, '（４）連結損益計算書', SONY_QUARTER_COLUMN, '2,804'),
        sonyChunk(1, 8, '連結損益計算書', SONY_FULL_YEAR_COLUMN, '12,034'),
      ],
    );

    expect(report.tables).toHaveLength(1);
    expect(report.tables[0].periodScope).toBe('FULL_YEAR');
    expect(report.tables[0].rows[0].values.c1.normalized).toBe(12034);
    expect(report.warnings.find((w) => w.code === 'MULTIPLE_VARIANTS_MERGED')?.message).toContain('R1');
    // Đã xác định được kỳ năm nên KHÔNG được báo thiếu biến thể cả năm nữa.
    expect(report.warnings.map((w) => w.code)).not.toContain('FULL_YEAR_VARIANT_MISSING');
  });

  it('suy kỳ từ cột: bỏ qua cột 増減, nhiều loại kỳ lẫn nhau thì trả UNKNOWN', () => {
    expect(detectPeriodScopeFromColumns([
      { id: 'c1', label: { source: SONY_FULL_YEAR_COLUMN, translated: null }, dataType: 'number', period: null },
      { id: 'diff', label: { source: '増減', translated: null }, dataType: 'number', period: null },
    ])).toBe('FULL_YEAR');

    expect(detectPeriodScopeFromColumns([
      { id: 'c1', label: { source: SONY_QUARTER_COLUMN, translated: null }, dataType: 'number', period: null },
    ])).toBe('QUARTER');

    // Lẫn quý và năm trong cùng một bảng → không đủ chắc để R1 loại bảng.
    expect(detectPeriodScopeFromColumns([
      { id: 'c1', label: { source: SONY_FULL_YEAR_COLUMN, translated: null }, dataType: 'number', period: null },
      { id: 'c2', label: { source: SONY_QUARTER_COLUMN, translated: null }, dataType: 'number', period: null },
    ])).toBe('UNKNOWN');

    expect(detectPeriodScopeFromColumns([
      { id: 'c1', label: { source: '金額', translated: null }, dataType: 'number', period: null },
    ])).toBe('UNKNOWN');
  });
});

describe('R2 — nhiều kỳ CÙNG loại thì lấy hết', () => {
  it('nhiều cột kỳ trong CÙNG bảng → giữ đủ mọi cột', () => {
    const chunk: TableChunkOutcome = {
      reportType: 'incomeStatement', locationIndex: 0, chunkIndex: 0, pageFrom: 4, pageTo: 4,
      result: {
        reportType: 'incomeStatement', notFound: false,
        tables: [{
          columns: [
            { id: 'fy2023', labelSource: '2023', dataType: 'number', period: '2023-03-31' },
            { id: 'fy2024', labelSource: '2024', dataType: 'number', period: '2024-03-31' },
          ],
          rows: [{ rowId: 'r', labelSource: 'Revenue', rowType: 'DETAIL', sourcePage: 4, values: { fy2023: '5,268', fy2024: '5,174' } }],
        }],
      },
      aiWarnings: [], failureReason: null,
    };
    const report = mergeTabularReport('incomeStatement', [loc('incomeStatement', 4, 4, 'P/L year', null)], [chunk]);
    expect(report.tables[0].columns.map((c) => c.id)).toEqual(['fy2023', 'fy2024']);
    expect(report.tables[0].rows[0].values.fy2023.normalized).toBe(5268);
    expect(report.tables[0].rows[0].values.fy2024.normalized).toBe(5174);
  });

  it('hai bảng CÙNG kỳ năm (không có quý) → giữ CẢ HAI, không loại bảng nào', () => {
    const report = mergeTabularReport(
      'incomeStatement',
      [
        loc('incomeStatement', 8, 9, '連結損益計算書［連結会計年度］', 'CONSOLIDATED'),
        loc('incomeStatement', 10, 10, '連結包括利益計算書［連結会計年度］', 'CONSOLIDATED'),
      ],
      [isChunk(0, 8, 9, '連結損益計算書［連結会計年度］', '12,034'), isChunk(1, 10, 10, '連結包括利益計算書［連結会計年度］', '200')],
    );
    expect(report.tables).toHaveLength(2);
    expect(report.warnings.find((w) => w.code === 'MULTIPLE_VARIANTS_MERGED')?.message ?? '').not.toContain('R1');
  });
});

describe('R3 — có hợp nhất và riêng lẻ thì chỉ lấy hợp nhất', () => {
  it('detectConsolidation nhận đúng 連結 / 個別 / 単体 / non-consolidated', () => {
    expect(detectConsolidation('連結貸借対照表')).toBe('CONSOLIDATED');
    expect(detectConsolidation('Consolidated Statement of Financial Position')).toBe('CONSOLIDATED');
    expect(detectConsolidation('個別貸借対照表')).toBe('SEPARATE');
    expect(detectConsolidation('単体損益計算書')).toBe('SEPARATE');
    expect(detectConsolidation('Non-consolidated Balance Sheet')).toBe('SEPARATE');
    expect(detectConsolidation('貸借対照表')).toBeNull();
  });

  it('BS có cả hợp nhất và riêng lẻ → CHỈ giữ hợp nhất + SEPARATE_SET_EXCLUDED', () => {
    const classified = classifiedWith([
      loc('balanceSheet', 3, 3, '個別貸借対照表', 'SEPARATE'),
      loc('balanceSheet', 40, 40, '連結貸借対照表', 'CONSOLIDATED'),
    ]);
    const payload = buildPayload(config(), classified, {
      tableChunks: [bsChunk(0, 3, '個別貸借対照表', '5,288'), bsChunk(1, 40, '連結貸借対照表', '9,999')],
      notesChunks: [],
    } as never);

    expect(payload.balanceSheet.tables).toHaveLength(1);
    expect(payload.balanceSheet.tables[0].rows[0].values.cur.normalized).toBe(9999);
    expect(payload.balanceSheet.tables[0].consolidation).toBe('CONSOLIDATED');
    expect(payload.balanceSheet.warnings.map((w) => w.code)).toContain('SEPARATE_SET_EXCLUDED');
  });

  it('BS CHỈ có riêng lẻ → GIỮ riêng lẻ + SEPARATE_ONLY_KEPT (không từ chối doanh nghiệp không có công ty con)', () => {
    const classified = classifiedWith([loc('balanceSheet', 3, 3, '個別貸借対照表', 'SEPARATE')]);
    const payload = buildPayload(config(), classified, {
      tableChunks: [bsChunk(0, 3, '個別貸借対照表', '5,288')],
      notesChunks: [],
    } as never);

    expect(payload.balanceSheet.tables).toHaveLength(1);
    expect(payload.balanceSheet.tables[0].rows[0].values.cur.normalized).toBe(5288);
    expect(payload.balanceSheet.warnings.map((w) => w.code)).toContain('SEPARATE_ONLY_KEPT');
    expect(payload.balanceSheet.warnings.map((w) => w.code)).not.toContain('SEPARATE_SET_EXCLUDED');
  });

  // Hồi quy UAT Meidensha 2026-08-07: bộ riêng lẻ J-GAAP in tiêu đề TRẦN (貸借対照表, không có 個別);
  // 個別 chỉ ở tiêu đề mục + notes. R3 phải loại được bảng trần khi tài liệu có mục riêng lẻ.
  it('BS hợp nhất + bảng TRẦN (null), tài liệu có notes 個別 → loại bảng trần, giữ hợp nhất', () => {
    const classified = classifiedWith([
      loc('balanceSheet', 8, 9, '連結貸借対照表', 'CONSOLIDATED'),
      loc('balanceSheet', 17, 18, '貸借対照表', null),
      loc('notesToFinancialStatements', 26, 26, '個別財務諸表に関する注記', 'SEPARATE'),
    ]);
    const payload = buildPayload(config(), classified, {
      tableChunks: [bsChunk(0, 8, '連結貸借対照表', '9,999'), bsChunk(1, 17, '貸借対照表', '5,288')],
      notesChunks: [],
    } as never);

    expect(payload.balanceSheet.tables).toHaveLength(1);
    expect(payload.balanceSheet.tables[0].consolidation).toBe('CONSOLIDATED');
    expect(payload.balanceSheet.tables[0].rows[0].values.cur.normalized).toBe(9999);
    expect(payload.balanceSheet.warnings.map((w) => w.code)).toContain('SEPARATE_SET_EXCLUDED');
  });

  it('BẢO VỆ — bảng trần (null) KHÔNG bị loại khi tài liệu KHÔNG có dấu hiệu mục riêng lẻ', () => {
    const classified = classifiedWith([
      loc('balanceSheet', 5, 7, '連結貸借対照表', 'CONSOLIDATED'),
      loc('balanceSheet', 40, 40, '貸借対照表', null),
    ]);
    const payload = buildPayload(config(), classified, {
      tableChunks: [bsChunk(0, 5, '連結貸借対照表', '9,999'), bsChunk(1, 40, '貸借対照表', '5,288')],
      notesChunks: [],
    } as never);

    // Không có location SEPARATE nào → không đủ căn cứ coi bảng trần là riêng lẻ → GIỮ cả hai.
    expect(payload.balanceSheet.tables).toHaveLength(2);
    expect(payload.balanceSheet.warnings.map((w) => w.code)).not.toContain('SEPARATE_SET_EXCLUDED');
  });

  it('BẢO VỆ — loại chỉ có bảng trần (không sibling hợp nhất) + mục riêng lẻ → GIỮ, không loại nhầm', () => {
    const classified = classifiedWith([
      loc('incomeStatement', 17, 17, '損益計算書', null),
      loc('notesToFinancialStatements', 26, 26, '個別財務諸表に関する注記', 'SEPARATE'),
    ]);
    const payload = buildPayload(config(), classified, {
      tableChunks: [isChunk(0, 17, 17, '損益計算書', '111')],
      notesChunks: [],
    } as never);

    // Không có bản hợp nhất để giữ lại → không được loại bản trần (có thể là dữ liệu duy nhất).
    expect(payload.incomeStatement.tables).toHaveLength(1);
    expect(payload.incomeStatement.warnings.map((w) => w.code)).not.toContain('SEPARATE_SET_EXCLUDED');
  });
});

describe('R4 — số âm: JSON giữ số âm thật, raw giữ nguyên ký hiệu gốc', () => {
  it('△ / ▲ / ngoặc / dấu trừ đều thành số âm thật', () => {
    expect(parseFinancialNumber('△37')).toBe(-37);
    expect(parseFinancialNumber('▲1,250')).toBe(-1250);
    expect(parseFinancialNumber('(1,250)')).toBe(-1250);
    expect(parseFinancialNumber('-1,250')).toBe(-1250);
  });

  it('merge giữ normalized âm và raw nguyên văn (không đổi △ thành ngoặc trong JSON)', () => {
    const report = mergeTabularReport('balanceSheet', [loc('balanceSheet', 1, 1, '貸借対照表', null)], [bsChunk(0, 1, '貸借対照表', '△37')]);
    expect(report.tables[0].rows[0].values.cur).toEqual({ raw: '△37', normalized: -37 });
  });
});
