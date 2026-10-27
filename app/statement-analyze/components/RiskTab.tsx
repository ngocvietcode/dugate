'use client';

// app/statement-analyze/components/RiskTab.tsx
// Tab "Rủi ro" — bảng điều khiển cho chuyên gia rủi ro: KPI dòng tiền, danh sách
// phát hiện (findings) theo mức độ, và top giao dịch vào/ra. Tất cả tính client-side.

import React, { useMemo } from 'react';
import { computeRiskReport, type Severity, type TopTxn } from '../lib/risk-flags';
import { formatVnd } from '../lib/money';

const SEV_STYLE: Record<Severity, { ring: string; bg: string; text: string; label: string }> = {
  high:   { ring: 'ring-red-500/30',    bg: 'bg-red-500/10',     text: 'text-red-600',    label: 'Cao' },
  medium: { ring: 'ring-amber-500/30',  bg: 'bg-amber-500/10',   text: 'text-amber-700',  label: 'Trung bình' },
  low:    { ring: 'ring-sky-500/30',    bg: 'bg-sky-500/10',     text: 'text-sky-700',    label: 'Thấp' },
  info:   { ring: 'ring-border/50',     bg: 'bg-muted',          text: 'text-foreground', label: 'Thông tin' },
};

export function RiskTab({ analysis }: { analysis: any }) {
  const report = useMemo(() => computeRiskReport(analysis), [analysis]);
  const { findings, topInflows, topOutflows, totals } = report;
  const normalizedRevenue = analysis?.revenue_normalization?.summary?.normalized_business_revenue_after_fraud;
  const adjustedSdbq = analysis?.fraud_detection?.adjusted_balance?.adjusted_selected_avg_sdbq;
  const originalSdbq = analysis?.fraud_detection?.adjusted_balance?.original_selected_avg_sdbq;

  return (
    <div className="space-y-6">
      {/* KPI dòng tiền */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Tổng tiền vào" value={formatVnd(totals.inflow)} tone="in" />
        <Kpi label="Tổng tiền ra" value={formatVnd(totals.outflow)} tone="out" />
        <Kpi label="Dòng tiền ròng" value={formatVnd(totals.net)} tone={totals.net >= 0 ? 'in' : 'out'} />
        <Kpi label="Số phát hiện" value={String(findings.length)} tone={findings.length > 0 ? 'warn' : 'neutral'} />
      </div>

      {(typeof normalizedRevenue === 'number' || typeof adjustedSdbq === 'number') && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-primary/5 ring-1 ring-primary/20 p-3">
          <div>
            <div className="text-[10px] text-muted-foreground">Doanh thu thực sau loại trừ</div>
            <div className="text-sm font-bold text-primary">
              {typeof normalizedRevenue === 'number' ? formatVnd(normalizedRevenue) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">SDBQ điều chỉnh window dressing</div>
            <div className="text-sm font-bold text-primary">
              {typeof adjustedSdbq === 'number' ? formatVnd(adjustedSdbq) : '—'}
            </div>
            {typeof originalSdbq === 'number' && typeof adjustedSdbq === 'number' && originalSdbq !== adjustedSdbq && (
              <div className="text-[10px] text-muted-foreground">Gốc: {formatVnd(originalSdbq)}</div>
            )}
          </div>
        </div>
      )}

      {/* Findings */}
      <div>
        <h4 className="text-sm font-bold mb-2">Cảnh báo & Phát hiện ({findings.length})</h4>
        {findings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Không phát hiện dấu hiệu bất thường theo các quy tắc hiện có.</p>
        ) : (
          <div className="space-y-2">
            {findings.map((f) => {
              const s = SEV_STYLE[f.severity];
              return (
                <div key={f.id} className={`rounded-lg p-3 ring-1 ${s.ring} ${s.bg}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ${s.ring} ${s.text}`}>{s.label}</span>
                    <span className={`text-xs font-bold ${s.text}`}>{f.title}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-foreground/80">{f.detail}</p>
                  {f.txIndexes && f.txIndexes.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Dòng: {f.txIndexes.slice(0, 40).join(', ')}{f.txIndexes.length > 40 ? '…' : ''}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top giao dịch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopTable title="Top giao dịch TIỀN VÀO" rows={topInflows} tone="in" />
        <TopTable title="Top giao dịch TIỀN RA" rows={topOutflows} tone="out" />
      </div>

      <p className="text-[10px] text-muted-foreground">
        Các phát hiện là tín hiệu tất định để rà soát, không phải kết luận. Ngưỡng mang tính heuristic.
      </p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: 'in' | 'out' | 'warn' | 'neutral' }) {
  const cls =
    tone === 'in' ? 'text-emerald-600'
    : tone === 'out' ? 'text-red-600'
    : tone === 'warn' ? 'text-amber-600'
    : 'text-foreground';
  return (
    <div className="rounded-lg p-3 text-center ring-1 bg-muted ring-border/50">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-base font-bold ${cls}`}>{value}</div>
    </div>
  );
}

function TopTable({ title, rows, tone }: { title: string; rows: TopTxn[]; tone: 'in' | 'out' }) {
  const amountCls = tone === 'in' ? 'text-emerald-600' : 'text-red-600';
  return (
    <div>
      <h4 className="text-sm font-bold mb-2">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Không có dữ liệu.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-2 py-2 text-left font-semibold">#</th>
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Ngày</th>
                <th className="px-2 py-2 text-right font-semibold">Số tiền</th>
                <th className="px-2 py-2 text-left font-semibold">Diễn giải</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.index} className="border-t border-border/30">
                  <td className="px-2 py-1.5 text-muted-foreground">{r.index}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.date || '—'}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold ${amountCls}`}>{formatVnd(r.amount)}</td>
                  <td className="px-2 py-1.5 max-w-[240px] truncate" title={r.details || ''}>{r.details || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
