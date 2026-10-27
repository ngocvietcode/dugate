'use client';

import { useMemo, useState, useCallback } from 'react';
import { Loader2, Users, Boxes, ArrowUpDown, Download, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useBreakdown } from '../hooks/useBreakdown';
import type { OperationFiltersState, BreakdownRow } from '../types';
import { formatCost, formatTokens, normalizeCost } from '../lib/format';

type GroupBy = 'profile' | 'endpoint';
type SortKey = 'cost' | 'total' | 'failed' | 'tokens';

interface CostBreakdownTabProps {
  filters: OperationFiltersState;
  onDrillProfile: (profileKey: string) => void;
  onDrillEndpoint: (endpointKey: string) => void;
}

export default function CostBreakdownTab({ filters, onDrillProfile, onDrillEndpoint }: CostBreakdownTabProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('profile');
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const { rows, loading, error, retry } = useBreakdown({ groupBy, filters });

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => metric(b, sortKey) - metric(a, sortKey));
    return arr;
  }, [rows, sortKey]);

  const totals = useMemo(() => {
    const aggregate = rows.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        succeeded: acc.succeeded + r.succeeded,
        failed: acc.failed + r.failed,
        tokens: acc.tokens + r.tokensIn + r.tokensOut,
        cost: acc.cost + r.cost,
        unpriced: acc.unpriced + (r.unpricedCount || 0),
      }),
      { total: 0, succeeded: 0, failed: 0, tokens: 0, cost: 0, unpriced: 0 },
    );
    return { ...aggregate, cost: normalizeCost(aggregate.cost) };
  }, [rows]);

  const [exporting, setExporting] = useState(false);
  const handleExportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('group_by', groupBy);
      params.set('format', 'csv');
      if (filters.endpoint !== 'ALL') params.set('endpoint', filters.endpoint);
      if (filters.profile !== 'ALL') params.set('profile', filters.profile);
      if (filters.startDate) params.set('start_date', filters.startDate);
      if (filters.endDate) params.set('end_date', filters.endDate);
      const res = await fetch(`/api/internal/operations/stats/breakdown?${params.toString()}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        toast.error(b.error || `Export thất bại (HTTP ${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `breakdown-${groupBy}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Đã export bảng tổng hợp (CSV).');
    } catch {
      toast.error('Lỗi kết nối khi export');
    } finally {
      setExporting(false);
    }
  }, [groupBy, filters]);

  const drill = (key: string) => {
    if (groupBy === 'profile') { if (key !== '__none__') onDrillProfile(key); }
    else if (key !== '__none__') onDrillEndpoint(key);
  };

  return (
    <div className="space-y-4">
      {/* Group-by toggle + export */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Nhóm theo:</span>
          <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
            <ToggleBtn active={groupBy === 'profile'} onClick={() => setGroupBy('profile')} icon={<Users className="w-3.5 h-3.5" />} label="Profile" />
            <ToggleBtn active={groupBy === 'endpoint'} onClick={() => setGroupBy('endpoint')} icon={<Boxes className="w-3.5 h-3.5" />} label="Endpoint" />
          </div>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={exporting || rows.length === 0}
          className="h-9 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-foreground border border-border rounded-lg hover:bg-muted disabled:opacity-50 transition-all"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Export CSV
        </button>
      </div>

      {/* Unpriced warning */}
      {totals.unpriced > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Tổng chi phí <strong>chưa đầy đủ</strong>: có <strong>{totals.unpriced.toLocaleString('en-US')}</strong> request chưa cấu hình giá model.
            Cấu hình tại <span className="font-medium">Settings → Bảng giá Model</span>.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  {groupBy === 'profile' ? 'Profile' : 'Endpoint'}
                </th>
                <SortableTh label="Requests" active={sortKey === 'total'} onClick={() => setSortKey('total')} />
                <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">OK</th>
                <SortableTh label="Lỗi" active={sortKey === 'failed'} onClick={() => setSortKey('failed')} />
                <SortableTh label="Tokens" active={sortKey === 'tokens'} onClick={() => setSortKey('tokens')} />
                <SortableTh label="Chi phí" active={sortKey === 'cost'} onClick={() => setSortKey('cost')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /></td></tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center" role="alert">
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    <button type="button" onClick={retry} className="mt-2 text-xs font-medium text-primary hover:text-primary/80">Thử lại</button>
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center text-sm text-muted-foreground">Không có dữ liệu trong khoảng thời gian này.</td></tr>
              ) : (
                sorted.map((r) => (
                  <tr
                    key={r.key}
                    className="hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => drill(r.key)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${r.key === '__none__' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                          {r.name}
                        </span>
                        {r.unpricedCount > 0 && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                            title={`${r.unpricedCount} request chưa cấu hình giá model`}
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {r.unpricedCount} chưa có giá
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatTokens(r.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatTokens(r.succeeded)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.failed > 0
                        ? <span className="text-red-600 dark:text-red-400 font-medium">{formatTokens(r.failed)}</span>
                        : <span className="text-muted-foreground/40">0</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatTokens(r.tokensIn + r.tokensOut)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground font-medium">
                      {formatCost(r.cost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && !error && sorted.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                  <td className="px-4 py-2.5 text-sm text-foreground">Tổng ({sorted.length})</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatTokens(totals.total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatTokens(totals.succeeded)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-600 dark:text-red-400">{formatTokens(totals.failed)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatTokens(totals.tokens)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatCost(totals.cost)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Nhấn 1 dòng để xem chi tiết các request tương ứng.</p>
    </div>
  );
}

function metric(r: BreakdownRow, key: SortKey): number {
  switch (key) {
    case 'total': return r.total;
    case 'failed': return r.failed;
    case 'tokens': return r.tokensIn + r.tokensOut;
    case 'cost': return r.cost;
  }
}

function ToggleBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium transition-all ${
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
      aria-pressed={active}
    >
      {icon}{label}
    </button>
  );
}

function SortableTh({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">
      <button onClick={onClick} className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? 'text-primary' : ''}`}>
        {label}
        <ArrowUpDown className="w-3 h-3" />
      </button>
    </th>
  );
}
