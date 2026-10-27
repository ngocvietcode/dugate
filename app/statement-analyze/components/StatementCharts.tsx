'use client';

// app/statement-analyze/components/StatementCharts.tsx
// Trực quan hóa kết quả phân tích sao kê bằng recharts:
//   1. Dòng tiền vào / ra / ròng theo tháng (tính từ data_raw — toàn kỳ).
//   2. Số dư Max / Min / SDBQ theo tháng được chọn (từ monthly_balances).
//   3. Cơ cấu tiền vào theo phân loại doanh thu (từ revenue_normalization).
// Mọi số tiền hiển thị theo TRIỆU VND cho gọn; tooltip vẫn hiện giá trị đầy đủ.

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { parseVndAmount, parseDMY, formatVnd } from '../lib/money';

const COLORS = {
  inflow: '#16b37e',
  outflow: '#cbd8d1',
  net: '#12241c',
  max: '#0b7a4b',
  min: '#b91c1c',
  sdbq: '#b45309',
};

const COMPOSITION_COLORS = ['#0b7a4b', '#16b37e', '#b45309', '#94a3b8', '#b91c1c'];
const toMillion = (n: number) => Math.round((n / 1_000_000) * 100) / 100;

interface MonthlyFlow {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

function aggregateMonthlyFlow(transactions: any[]): MonthlyFlow[] {
  const map = new Map<string, { inflow: number; outflow: number; key: number }>();
  for (const tx of transactions || []) {
    const d = parseDMY(tx?.transaction_date ?? null);
    if (!d) continue;
    const monthKey = `${String(d.month).padStart(2, '0')}/${d.year}`;
    const sortKey = d.year * 12 + d.month;
    const agg = map.get(monthKey) ?? { inflow: 0, outflow: 0, key: sortKey };
    agg.inflow += parseVndAmount(tx?.credit ?? null) ?? 0;
    agg.outflow += parseVndAmount(tx?.debit ?? null) ?? 0;
    map.set(monthKey, agg);
  }
  return [...map.entries()]
    .sort((a, b) => a[1].key - b[1].key)
    .map(([month, v]) => ({
      month,
      inflow: toMillion(v.inflow),
      outflow: toMillion(v.outflow),
      net: toMillion(v.inflow - v.outflow),
    }));
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
      <h4 className="text-sm font-bold mb-0.5">{title}</h4>
      {hint && <p className="text-[11px] text-muted-foreground mb-3">{hint}</p>}
      <div style={{ width: '100%', height: 280 }}>{children}</div>
    </div>
  );
}

const tooltipVndM = (value: unknown, name: unknown): [string, string] => {
  const n = typeof value === 'number' ? value : Number(value);
  return [`${formatVnd(Number.isFinite(n) ? n : null)} tr`, String(name ?? '')];
};

export function StatementCharts({ analysis }: { analysis: any }) {
  const monthlyFlow = useMemo(() => aggregateMonthlyFlow(analysis?.data_raw || []), [analysis]);

  const monthlyBalances = useMemo(() => {
    const rows = Array.isArray(analysis?.monthly_balances) ? analysis.monthly_balances : [];
    return rows.map((m: any) => ({
      month: m.month,
      max: m.max_balance != null ? toMillion(m.max_balance) : null,
      min: m.min_balance != null ? toMillion(m.min_balance) : null,
      sdbq: m.sdbq != null ? toMillion(m.sdbq) : null,
    }));
  }, [analysis]);

  const composition = useMemo(() => {
    const s = analysis?.revenue_normalization?.summary;
    if (!s) return [];
    return [
      { name: 'Doanh thu KD thực', value: toMillion(s.normalized_business_revenue_after_fraud ?? 0) },
      { name: 'Thu nhập cá nhân', value: toMillion(s.personal_income ?? 0) },
      { name: 'Phi kinh doanh', value: toMillion(s.non_business_inflow ?? 0) },
      { name: 'Khác', value: toMillion(s.other_inflow ?? 0) },
      { name: 'Chờ rà soát', value: toMillion(s.pending_review_inflow ?? 0) },
    ].filter((item) => item.value > 0);
  }, [analysis]);

  const hasFlow = monthlyFlow.length > 0;
  const hasBalances = monthlyBalances.length > 0;
  const hasComposition = composition.length > 0;

  if (!hasFlow && !hasBalances && !hasComposition) {
    return <p className="text-sm text-muted-foreground">Chưa đủ dữ liệu để dựng biểu đồ.</p>;
  }

  return (
    <div className="space-y-4">
      {hasFlow && (
        <ChartCard
          title="Dòng tiền vào · ra · ròng theo tháng (triệu VND)"
          hint="Tổng hợp toàn kỳ từ cột Ghi có / Ghi nợ trong data raw."
        >
          <ResponsiveContainer>
            <ComposedChart data={monthlyFlow} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4eae7" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={48} />
              <Tooltip formatter={tooltipVndM} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="inflow" name="Tiền vào" fill={COLORS.inflow} radius={[3, 3, 0, 0]} />
              <Bar dataKey="outflow" name="Tiền ra" fill={COLORS.outflow} radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="net" name="Ròng" stroke={COLORS.net} strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {hasBalances && (
          <ChartCard
            title="Số dư Max / Min / SDBQ theo tháng (triệu VND)"
            hint="Các tháng được chọn (≤ 6 tháng SDBQ cao nhất)."
          >
            <ResponsiveContainer>
              <ComposedChart data={monthlyBalances} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4eae7" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip formatter={tooltipVndM} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="max" name="Số dư Max" stroke={COLORS.max} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="min" name="Số dư Min" stroke={COLORS.min} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="sdbq" name="SDBQ" stroke={COLORS.sdbq} strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {hasComposition && (
          <ChartCard
            title="Cơ cấu tiền vào theo phân loại (triệu VND)"
            hint="Dựa trên bước chuẩn hóa doanh thu; đã loại phần bất thường khỏi doanh thu KD thực."
          >
            <ResponsiveContainer>
              <PieChart>
                <Pie data={composition} dataKey="value" nameKey="name" cx="45%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {composition.map((_entry, i) => (
                    <Cell key={i} fill={COMPOSITION_COLORS[i % COMPOSITION_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={tooltipVndM} />
                <Legend wrapperStyle={{ fontSize: 12 }} layout="vertical" align="right" verticalAlign="middle" />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>
    </div>
  );
}
