'use client';

// components/financial-report/ReportTable.tsx
// Render MỘT bảng số liệu của workflow `financial-report-translation`.
//
// GENERIC: cột sinh từ `columns[]`, dòng sinh từ `rows[]`. KHÔNG hardcode cột
// theo loại báo cáo → dùng chung cho cả 5 báo cáo dạng bảng (BS/IS/CF/Equity/SGA).
// Spec: handover-report/OCRBctcJapan/PLAN/TASK-2-UI-TEST-TOOL.md §3

import React from 'react';
import type {
  CellValue,
  ReportTable as ReportTableData,
  StatementSection,
  TableColumn,
  TableRow,
} from '@/lib/pipelines/workflows/financial-report/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 });

function formatNormalized(value: number): string {
  // Số âm hiển thị dạng kế toán (1.250) để BU quen mắt; value gốc vẫn là số âm.
  return value < 0 ? `(${numberFormatter.format(Math.abs(value))})` : numberFormatter.format(value);
}

/** Thụt lề theo `level` (level 1 = ngoài cùng). */
function indentPx(level: number): number {
  const depth = Number.isFinite(level) && level > 1 ? level - 1 : 0;
  return Math.min(depth, 8) * 14;
}

function rowEmphasis(row: TableRow): string {
  switch (row.rowType) {
    case 'TOTAL':
      return 'font-bold bg-muted/40';
    case 'SUBTOTAL':
      return 'font-bold';
    case 'SECTION':
      return 'font-semibold bg-muted/20';
    case 'OPENING_BALANCE':
    case 'CLOSING_BALANCE':
      return 'font-medium';
    default:
      return '';
  }
}

function columnHeaderText(col: TableColumn): string {
  return col.label.source || col.label.translated || col.id;
}

// ─── statementSection (mục 17 / Q9) ───────────────────────────────────────────
// Chỉ balanceSheet có giá trị; báo cáo khác luôn null nên cột được ẩn hoàn toàn.

const SECTION_META: Record<StatementSection, { label: string; className: string }> = {
  ASSETS: { label: 'TS', className: 'bg-sky-500/10 text-sky-600 border-sky-500/30' },
  LIABILITIES: { label: 'NPT', className: 'bg-orange-500/10 text-orange-600 border-orange-500/30' },
  EQUITY: { label: 'VCSH', className: 'bg-violet-500/10 text-violet-600 border-violet-500/30' },
};

const SECTION_TITLE: Record<StatementSection, string> = {
  ASSETS: 'Tài sản',
  LIABILITIES: 'Nợ phải trả',
  EQUITY: 'Vốn chủ sở hữu',
};

function SectionBadge({ section }: { section: StatementSection | null }) {
  if (!section) {
    return (
      <span
        title="Không suy được khối của dòng này (statementSection = null)"
        className="inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold bg-muted text-muted-foreground border-border"
      >
        ?
      </span>
    );
  }
  const meta = SECTION_META[section];
  return (
    <span
      title={SECTION_TITLE[section]}
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

// ─── Cells ────────────────────────────────────────────────────────────────────

function ValueCell({ cell }: { cell: CellValue | undefined }) {
  // `values` bỏ key khi không có giá trị → không được hiểu là 0.
  if (!cell) {
    return (
      <td className="px-2 py-1 text-right text-muted-foreground/50 border-b border-border/40" aria-label="không có giá trị">
        —
      </td>
    );
  }

  const isNegative = typeof cell.normalized === 'number' && cell.normalized < 0;
  const hasNumber = typeof cell.normalized === 'number';

  return (
    <td
      className={`px-2 py-1 text-right border-b border-border/40 font-mono tabular-nums whitespace-nowrap ${
        isNegative ? 'text-rose-500' : ''
      }`}
      title={hasNumber ? `raw: ${cell.raw} · normalized: ${cell.normalized}` : `raw: ${cell.raw} · không parse được thành số`}
    >
      <span className="text-xs">{cell.raw}</span>
      {hasNumber ? (
        <span className="block text-[10px] text-muted-foreground font-normal">
          {formatNormalized(cell.normalized as number)}
        </span>
      ) : (
        <span className="block text-[10px] text-amber-600 font-normal">không phải số</span>
      )}
    </td>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export interface ReportTableProps {
  table: ReportTableData;
  /** Nhãn phụ hiển thị phía trên bảng (ví dụ tableId hoặc "Bảng 1/2"). */
  caption?: string;
}

export function ReportTable({ table, caption }: ReportTableProps) {
  const { columns, rows } = table;
  // Cột "Khối" chỉ hiện khi báo cáo thực sự có statementSection (= balanceSheet).
  const hasSections = rows.some((r) => r.statementSection != null);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic px-1 py-2">
        Bảng <code className="font-mono">{table.tableId}</code> không có dòng dữ liệu nào.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {caption && (
        <p className="text-[11px] text-muted-foreground font-mono px-1">
          {caption} · {columns.length} cột · {rows.length} dòng
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">
            {caption ?? table.tableId} — {rows.length} dòng, {columns.length} cột giá trị
          </caption>
          <thead className="bg-muted/60">
            <tr>
              {hasSections && (
                <th scope="col" className="px-2 py-2 text-center font-semibold border-b border-border whitespace-nowrap">
                  Khối
                </th>
              )}
              <th scope="col" className="px-2 py-2 text-left font-semibold border-b border-border min-w-[220px]">
                Khoản mục (nguồn)
              </th>
              <th scope="col" className="px-2 py-2 text-left font-semibold border-b border-border min-w-[200px]">
                Bản dịch
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className="px-2 py-2 text-right font-semibold border-b border-border whitespace-nowrap"
                >
                  <span className="block">{columnHeaderText(col)}</span>
                  {col.label.translated && col.label.translated !== col.label.source && (
                    <span className="block text-[10px] font-normal text-muted-foreground">{col.label.translated}</span>
                  )}
                  {col.period && (
                    <span className="block text-[10px] font-normal text-muted-foreground font-mono">{col.period}</span>
                  )}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-center font-semibold border-b border-border whitespace-nowrap">
                Trang
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowId} className={`hover:bg-primary/5 ${rowEmphasis(row)}`}>
                {hasSections && (
                  <td className="px-2 py-1 text-center border-b border-border/40 align-top">
                    <SectionBadge section={row.statementSection} />
                  </td>
                )}
                <th
                  scope="row"
                  className="px-2 py-1 text-left font-inherit border-b border-border/40 align-top"
                  style={{ paddingLeft: 8 + indentPx(row.level) }}
                >
                  <span>{row.label.source || <span className="text-muted-foreground italic">(không có)</span>}</span>
                  <span className="block text-[10px] text-muted-foreground font-mono font-normal">
                    {row.rowId} · {row.rowType}
                  </span>
                </th>
                <td className="px-2 py-1 border-b border-border/40 align-top">
                  {row.label.translated ?? <span className="text-muted-foreground/60 italic">chưa dịch</span>}
                </td>
                {columns.map((col) => (
                  <ValueCell key={col.id} cell={row.values?.[col.id]} />
                ))}
                <td className="px-2 py-1 text-center text-muted-foreground border-b border-border/40 font-mono align-top">
                  {row.sourcePage ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ReportTable;
