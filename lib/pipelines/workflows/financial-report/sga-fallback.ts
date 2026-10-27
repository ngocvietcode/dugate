// lib/pipelines/workflows/financial-report/sga-fallback.ts
// UAT #01 / I2 — Suy ra `sgaBreakdown` khi tài liệu KHÔNG có bảng chi tiết riêng mà chỉ in
// số tổng chi phí bán hàng và quản lý như MỘT DÒNG trong Báo cáo kết quả kinh doanh.
//
// Vì sao làm bằng CODE thay vì thêm alias cho bước classify:
//   `販売費及び一般管理費` là một DÒNG khoản mục, không phải TIÊU ĐỀ báo cáo. Thêm nó vào
//   `REPORT_ALIASES.sgaBreakdown` sẽ khiến classify đánh dấu cả trang KQKD là location của
//   sgaBreakdown → extract bóc lẫn các dòng khác của KQKD thành chi phí bán hàng/quản lý
//   (sai số liệu, không chỉ sai nhãn) và tốn thêm lời gọi AI cho mọi file.
//
// Cách này không gọi thêm AI, kết quả tất định, và giữ đủ MỌI kỳ báo cáo của bảng KQKD.

import { makeWarning, normalizeSectionLabel } from './merge';
import {
  ROW_ID_PREFIX,
  type CellValue,
  type InternalFinancialReportPayload,
  type PageRange,
  type ReportTable,
  type TableRow,
  type TabularReport,
} from './types';

/** Nhãn dòng tổng SG&A trong Báo cáo KQKD. Khớp CHÍNH XÁC sau khi chuẩn hoá. */
const SGA_TOTAL_ROW_LABELS = [
  // JA
  '販売費及び一般管理費',
  '販売費・一般管理費',
  '販売費および一般管理費',
  '販売費一般管理費',
  '販売費及び一般管理費合計',
  // EN
  'selling, general and administrative expenses',
  'selling, general and administrative expense',
  'selling general and administrative expenses',
  'selling, general & administrative expenses',
  'sg&a expenses',
  'total selling, general and administrative expenses',
];

/**
 * Hậu tố cho biết nhãn là TIÊU ĐỀ của bảng chi tiết chứ không phải dòng tổng trong KQKD.
 * Gặp các nhãn này thì bỏ qua để không nhặt trùng với bảng chi tiết thật.
 */
const SCHEDULE_TITLE_MARKERS = ['内訳書', '明細書', '内訳', 'breakdown', 'schedule'];

export type SgaFallbackOutcome =
  | { kind: 'derived'; label: string; sourcePage: number | null; periods: string[] }
  | { kind: 'skipped'; reason: string };

interface SgaCandidate {
  row: TableRow;
  table: ReportTable;
}

/**
 * Nếu `sgaBreakdown` là NOT_FOUND mà Báo cáo KQKD có đúng MỘT dòng tổng SG&A có số liệu,
 * dựng `sgaBreakdown` dạng chỉ có dòng TOTAL (status = PARTIAL) từ chính dòng đó.
 *
 * Sửa payload TẠI CHỖ. Không tìm được / không chắc chắn → giữ nguyên NOT_FOUND, KHÔNG suy diễn.
 */
export function applySgaFallback(payload: InternalFinancialReportPayload): SgaFallbackOutcome {
  const sga = payload.sgaBreakdown;
  const incomeStatement = payload.incomeStatement;

  if (sga.status !== 'NOT_FOUND') {
    return { kind: 'skipped', reason: `sgaBreakdown đã có dữ liệu (status=${sga.status})` };
  }
  // Bị loại bằng cấu hình `report_types` thì không được tự dựng lại.
  if (sga.warnings.some((w) => w.code === 'EXCLUDED_BY_CONFIG')) {
    return { kind: 'skipped', reason: 'sgaBreakdown bị loại bởi cấu hình report_types' };
  }
  if (incomeStatement.status === 'NOT_FOUND' || incomeStatement.status === 'UNREADABLE') {
    return { kind: 'skipped', reason: `incomeStatement không dùng được (status=${incomeStatement.status})` };
  }

  const candidates = findSgaTotalRows(incomeStatement);
  if (candidates.length === 0) {
    return { kind: 'skipped', reason: 'không thấy dòng tổng SG&A trong Báo cáo KQKD' };
  }

  // UAT #04 / T6: Sony có cả KQKD năm và quý 4, mỗi bảng đều có một dòng SG&A.
  // Chỉ khi đúng một bảng cả năm mới được ưu tiên; nhiều bảng năm vẫn là dữ liệu mơ hồ và phải bỏ qua.
  const fullYearCandidates = candidates.filter((candidate) => candidate.table.periodScope === 'FULL_YEAR');
  const effectiveCandidates = fullYearCandidates.length === 1 ? fullYearCandidates : candidates;
  if (effectiveCandidates.length > 1) {
    // Nhiều dòng khớp (ví dụ báo cáo có cả bản riêng lẻ và hợp nhất) → KHÔNG đoán.
    return {
      kind: 'skipped',
      reason: `có ${effectiveCandidates.length} dòng SG&A trong Báo cáo KQKD nên không suy diễn`,
    };
  }

  const { row, table } = effectiveCandidates[0];
  const derivedFromFullYear = fullYearCandidates.length === 1;
  payload.sgaBreakdown = buildDerivedSgaReport(row, table, incomeStatement, derivedFromFullYear);

  return {
    kind: 'derived',
    label: row.label.source ?? '',
    sourcePage: row.sourcePage,
    periods: table.columns.map((column) => column.period).filter((p): p is string => !!p),
  };
}

function findSgaTotalRows(incomeStatement: TabularReport): SgaCandidate[] {
  const candidates: SgaCandidate[] = [];

  for (const table of incomeStatement.tables) {
    for (const row of table.rows) {
      const text = normalizeSectionLabel(row.label.source);
      if (!text) continue;
      if (SCHEDULE_TITLE_MARKERS.some((marker) => text.includes(marker))) continue;
      if (!SGA_TOTAL_ROW_LABELS.includes(text)) continue;
      // Dòng tiêu đề nhóm không mang số → không dùng làm số tổng.
      if (row.rowType === 'SECTION') continue;
      if (!hasNumericValue(row.values)) continue;

      candidates.push({ row, table });
    }
  }

  return candidates;
}

function hasNumericValue(values: Record<string, CellValue>): boolean {
  return Object.values(values).some((value) => value.normalized !== null);
}

function buildDerivedSgaReport(
  row: TableRow,
  table: ReportTable,
  incomeStatement: TabularReport,
  derivedFromFullYear: boolean,
): TabularReport {
  const derivedRow: TableRow = {
    rowId: `${ROW_ID_PREFIX.sgaBreakdown}-001`,
    parentRowId: null,
    level: 1,
    rowType: 'TOTAL',
    statementSection: null,
    label: { source: row.label.source, translated: row.label.translated },
    sourcePage: row.sourcePage,
    values: cloneValues(row.values),
  };
  const sourceDetail = [
    row.sourcePage ? `Nguồn: trang ${row.sourcePage}.` : null,
    // UAT #04 / T6: giải thích rõ vì sao chọn bảng năm thay vì bảng quý khi có nhiều biến thể.
    derivedFromFullYear ? 'Đã ưu tiên bảng kỳ cả năm.' : null,
  ].filter((detail): detail is string => detail !== null).join(' ');

  return {
    status: 'PARTIAL',
    // Tiêu đề lấy đúng nhãn đọc được trên tài liệu; bước dịch phía sau sẽ dịch nhãn này.
    title: { source: row.label.source, translated: null },
    pageRanges: resolvePageRanges(row.sourcePage, incomeStatement.pageRanges),
    // Đơn vị hiệu lực của KQKD; null → downstream dùng `generalInformation.unit`.
    unit: incomeStatement.unit ? { ...incomeStatement.unit } : null,
    warnings: [
      makeWarning('DETAIL_NOT_FOUND'),
      makeWarning(
        'SGA_DERIVED_FROM_INCOME_STATEMENT',
        sourceDetail || undefined,
      ),
    ],
    tables: [
      {
        tableId: 'sgaBreakdown-1',
        // Giữ NGUYÊN bộ cột của KQKD để không mất kỳ nào (quyết định của BU: có bao nhiêu kỳ
        // thì trả bấy nhiêu kỳ). Clone để không chia sẻ tham chiếu với báo cáo KQKD.
        columns: table.columns.map((column) => ({
          ...column,
          label: { ...column.label },
        })),
        rows: [derivedRow],
      },
    ],
  };
}

function cloneValues(values: Record<string, CellValue>): Record<string, CellValue> {
  const cloned: Record<string, CellValue> = {};
  for (const [key, value] of Object.entries(values)) {
    cloned[key] = { raw: value.raw, normalized: value.normalized };
  }
  return cloned;
}

function resolvePageRanges(sourcePage: number | null, fallback: PageRange[]): PageRange[] {
  if (sourcePage != null) return [{ from: sourcePage, to: sourcePage }];
  return fallback.map((range) => ({ ...range }));
}
