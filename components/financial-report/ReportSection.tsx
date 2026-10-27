'use client';

// components/financial-report/ReportSection.tsx
// Render MỘT report trong payload `financial-report-translation`:
// tiêu đề, status badge, pageRanges, warnings, và thân báo cáo.
//
// - 5 báo cáo dạng bảng → ReportTable (generic).
// - notesToFinancialStatements → render text theo `sections[]`, KHÔNG dùng ReportTable.
// - NOT_FOUND → hiện rõ "không có trong tài liệu", KHÔNG render bảng rỗng.
// Spec: handover-report/OCRBctcJapan/PLAN/TASK-2-UI-TEST-TOOL.md §3

import React from 'react';
import type {
  NotesReport,
  PageRange,
  ReportStatus,
  ReportType,
  TabularReport,
  UnitInfo,
} from '@/lib/pipelines/workflows/financial-report/types';
import { ReportTable } from './ReportTable';

// ─── Nhãn tiếng Việt của 6 report ─────────────────────────────────────────────

export const REPORT_LABELS: Record<ReportType, string> = {
  balanceSheet: 'Bảng cân đối kế toán',
  incomeStatement: 'Báo cáo kết quả hoạt động kinh doanh',
  comprehensiveIncome: 'Báo cáo thu nhập toàn diện',
  cashFlowStatement: 'Báo cáo lưu chuyển tiền tệ',
  equityChangeStatement: 'Báo cáo biến động vốn chủ sở hữu',
  sgaBreakdown: 'Chi phí bán hàng và quản lý doanh nghiệp',
  notesToFinancialStatements: 'Bảng thuyết minh báo cáo tài chính',
};

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_META: Record<ReportStatus, { label: string; className: string }> = {
  FOUND: { label: 'FOUND', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  PARTIAL: { label: 'PARTIAL', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  NOT_FOUND: { label: 'NOT_FOUND', className: 'bg-muted text-muted-foreground border-border' },
  UNREADABLE: { label: 'UNREADABLE', className: 'bg-rose-500/10 text-rose-600 border-rose-500/30' },
};

export function StatusBadge({ status }: { status: ReportStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.UNREADABLE;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold tracking-wide ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

// ─── Đơn vị RIÊNG của báo cáo (mục 18 / Q10) ──────────────────────────────────

/**
 * Hiển thị `report.unit` cạnh badge status.
 * Mỗi báo cáo có thể in đơn vị khác nhau (bảng cân đối theo 百万円, chi phí bán hàng theo 円);
 * không hiện ra thì người soát dùng sai đơn vị tới 1.000.000 lần mà không biết.
 * `unit == null` → báo cáo dùng đơn vị chung ở generalInformation, không hiện badge.
 */
export function UnitBadge({ unit }: { unit: UnitInfo | null }) {
  if (!unit || (!unit.source && !unit.translated && unit.multiplier == null)) return null;

  const unknownMultiplier = unit.multiplier == null;
  const label = unit.source || unit.translated || '?';

  return (
    <span
      title={
        unknownMultiplier
          ? 'Đơn vị riêng của báo cáo này nhưng KHÔNG nhận diện được hệ số quy đổi'
          : 'Đơn vị riêng của báo cáo này (khác đơn vị chung của file nếu có)'
      }
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
        unknownMultiplier
          ? 'bg-rose-500/10 text-rose-600 border-rose-500/30'
          : 'bg-primary/10 text-primary border-primary/30'
      }`}
    >
      <span aria-hidden="true">⊞</span>
      {label}
      {unit.translated && unit.translated !== unit.source && <span className="font-normal">/ {unit.translated}</span>}
      {unit.multiplier != null ? (
        <span className="font-normal">×{unit.multiplier.toLocaleString('vi-VN')}</span>
      ) : (
        <span className="font-normal">hệ số ?</span>
      )}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPageRanges(ranges: PageRange[]): string {
  if (!ranges || ranges.length === 0) return '—';
  return ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(', ');
}

function isTabular(report: TabularReport | NotesReport): report is TabularReport {
  return Array.isArray((report as TabularReport).tables);
}

function countRows(report: TabularReport): number {
  return report.tables.reduce((sum, t) => sum + t.rows.length, 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export interface ReportSectionProps {
  reportType: ReportType;
  report: TabularReport | NotesReport;
  /** Mặc định mở với report có dữ liệu, đóng với NOT_FOUND. */
  defaultOpen?: boolean;
}

export function ReportSection({ reportType, report, defaultOpen }: ReportSectionProps) {
  const label = REPORT_LABELS[reportType];
  const hasContent = report.status !== 'NOT_FOUND' && report.status !== 'UNREADABLE';
  const open = defaultOpen ?? hasContent;

  const itemCount = isTabular(report) ? countRows(report) : report.sections.length;

  return (
    <details className="modern-card overflow-hidden" open={open}>
      <summary className="cursor-pointer list-none px-4 py-3 hover:bg-primary/5 transition-colors">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading font-bold text-sm">{label}</span>
          <StatusBadge status={report.status} />
          <code className="text-[10px] text-muted-foreground font-mono">{reportType}</code>
          <UnitBadge unit={report.unit} />
          <span className="flex-1" />
          <span className="text-[11px] text-muted-foreground">
            Trang {formatPageRanges(report.pageRanges)}
            {hasContent && ` · ${itemCount} ${isTabular(report) ? 'dòng' : 'mục'}`}
          </span>
        </div>
        {report.title && (report.title.source || report.title.translated) && (
          <p className="text-xs text-muted-foreground mt-1">
            {report.title.source}
            {report.title.translated && <span className="text-primary"> / {report.title.translated}</span>}
          </p>
        )}
      </summary>

      <div className="px-4 pb-4 space-y-3">
        {/* Warnings */}
        {report.warnings.length > 0 && (
          <ul className="space-y-1">
            {report.warnings.map((w, i) => (
              <li
                key={`${w.code}-${i}`}
                className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700"
              >
                <span aria-hidden="true">⚠</span>
                <span>
                  <code className="font-mono font-bold">{w.code}</code>
                  {w.message && <> — {w.message}</>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* NOT_FOUND / UNREADABLE — không render bảng rỗng */}
        {report.status === 'NOT_FOUND' && (
          <p className="text-sm px-3 py-3 rounded-lg bg-muted/50 border border-border text-muted-foreground">
            Báo cáo này <strong>không có trong tài liệu</strong>. Hệ thống không bịa số liệu.
          </p>
        )}
        {report.status === 'UNREADABLE' && (
          <p className="text-sm px-3 py-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600">
            Không đọc được nội dung báo cáo này (UNREADABLE). Xem warnings để biết chi tiết.
          </p>
        )}

        {/* Thân báo cáo */}
        {hasContent && isTabular(report) && (
          report.tables.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Không có bảng nào được bóc tách.</p>
          ) : (
            <div className="space-y-4">
              {report.tables.map((table, idx) => (
                <ReportTable
                  key={table.tableId}
                  table={table}
                  caption={`Bảng ${idx + 1}/${report.tables.length} · ${table.tableId}`}
                />
              ))}
            </div>
          )
        )}

        {hasContent && !isTabular(report) && <NoteSections report={report} />}
      </div>
    </details>
  );
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function NoteSections({ report }: { report: NotesReport }) {
  if (report.sections.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Không có mục thuyết minh nào.</p>;
  }

  return (
    <div className="space-y-3">
      {report.sections.map((section) => (
        <article key={section.sectionId} className="rounded-lg border border-border/60 p-3 space-y-2">
          <header className="flex flex-wrap items-baseline gap-2">
            <h4 className="font-semibold text-sm">
              {section.title.source || <span className="text-muted-foreground italic">(không có tiêu đề)</span>}
            </h4>
            {section.title.translated && <span className="text-sm text-primary">/ {section.title.translated}</span>}
            <span className="flex-1" />
            <span className="text-[10px] text-muted-foreground font-mono">
              {section.sectionId} · trang {section.sourcePage ?? '—'}
            </span>
          </header>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Nguyên bản</p>
              <p className="text-xs whitespace-pre-wrap break-words leading-relaxed">{section.sourceText}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Bản dịch</p>
              {section.translatedText ? (
                <p className="text-xs whitespace-pre-wrap break-words leading-relaxed">{section.translatedText}</p>
              ) : (
                <p className="text-xs text-muted-foreground/60 italic">chưa dịch</p>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export default ReportSection;
