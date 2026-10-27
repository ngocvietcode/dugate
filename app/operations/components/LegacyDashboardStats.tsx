'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Activity, CheckCircle2, XCircle, Loader2, Play,
  Clock, DollarSign, TrendingUp, AlertTriangle,
} from 'lucide-react';
import type { OperationFiltersState, OperationState } from '../types';
import { formatCost } from '../lib/format';

interface StatsData {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  waiting: number;
  pending: number;
  total_cost_usd: number;
  avg_duration_sec: number;
  success_rate: number;
  unpriced_count?: number;
  top_errors: Array<{ code: string; count: number }>;
}

const KPI_POLL_INTERVAL = 60_000;

interface DashboardStatsProps {
  filters: OperationFiltersState;
  pollingEnabled?: boolean;
  onSelectState: (state: OperationState | 'ALL') => void;
}

/** Safe number — guards against null/undefined from backend */
function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export default function DashboardStats({
  filters, pollingEnabled = false, onSelectState,
}: DashboardStatsProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let disposed = false;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;

    const fetchStats = async () => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      setError(null);

      try {
        const params = new URLSearchParams();
        if (filters.endpoint !== 'ALL') params.set('endpoint', filters.endpoint);
        if (filters.profile !== 'ALL') params.set('profile', filters.profile);
        if (filters.startDate) params.set('start_date', filters.startDate);
        if (filters.endDate) params.set('end_date', filters.endDate);

        const res = await fetch(`/api/internal/operations/stats?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Không thể tải KPI (HTTP ${res.status})`);
        setStats(await res.json());
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Không thể tải KPI');
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    };

    const scheduleNext = () => {
      if (pollTimeout) clearTimeout(pollTimeout);
      if (disposed || !pollingEnabled) return;
      pollTimeout = setTimeout(async () => {
        if (document.visibilityState === 'visible') await fetchStats();
        scheduleNext();
      }, KPI_POLL_INTERVAL);
    };

    const handleVisibility = () => {
      if (pollTimeout) clearTimeout(pollTimeout);
      pollTimeout = null;
      if (!pollingEnabled || document.visibilityState !== 'visible') return;
      void fetchStats().finally(scheduleNext);
    };

    setLoading(true);
    void fetchStats().finally(scheduleNext);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      if (pollTimeout) clearTimeout(pollTimeout);
      document.removeEventListener('visibilitychange', handleVisibility);
      abortRef.current?.abort();
    };
  }, [filters.endpoint, filters.profile, filters.startDate, filters.endDate, pollingEnabled, retryKey]);

  if (loading && !stats) return <StatsSkeletons />;

  if (!stats && error) {
    return (
      <div className="mb-6 rounded-xl border border-red-300 dark:border-red-800 bg-card p-5 text-center" role="alert">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">Không thể tải số liệu tổng quan</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        <button type="button" onClick={() => setRetryKey((key) => key + 1)} className="mt-3 text-xs font-medium text-primary hover:text-primary/80">
          Thử lại
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const successRate = n(stats.success_rate);
  const cards: StatCardData[] = [
    {
      icon: <Activity className="w-4 h-4" />,
      label: 'Tổng requests',
      value: n(stats.total).toLocaleString('en-US'),
      iconColor: 'text-slate-600 dark:text-slate-400',
      valueColor: 'text-foreground',
    },
    {
      icon: <CheckCircle2 className="w-4 h-4" />,
      label: 'Thành công',
      value: n(stats.succeeded).toLocaleString('en-US'),
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      valueColor: 'text-emerald-700 dark:text-emerald-400',
      filterState: 'SUCCEEDED',
    },
    {
      icon: <XCircle className="w-4 h-4" />,
      label: 'Thất bại',
      value: n(stats.failed).toLocaleString('en-US'),
      iconColor: 'text-red-600 dark:text-red-400',
      valueColor: 'text-red-700 dark:text-red-400',
      alert: n(stats.failed) > 0,
      filterState: 'FAILED',
    },
    {
      icon: n(stats.running) > 0
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <Play className="w-4 h-4" />,
      label: 'Đang chạy',
      value: n(stats.running).toLocaleString('en-US'),
      iconColor: 'text-blue-600 dark:text-blue-400',
      valueColor: 'text-blue-700 dark:text-blue-400',
      pulse: n(stats.running) > 0,
      filterState: 'RUNNING',
    },
    {
      icon: <DollarSign className="w-4 h-4" />,
      label: 'Chi phí',
      value: formatCost(n(stats.total_cost_usd)),
      iconColor: 'text-amber-600 dark:text-amber-400',
      valueColor: 'text-foreground',
    },
    {
      icon: <Clock className="w-4 h-4" />,
      label: 'Avg time',
      value: `${n(stats.avg_duration_sec).toFixed(1)}s`,
      iconColor: 'text-violet-600 dark:text-violet-400',
      valueColor: 'text-foreground',
    },
    {
      icon: <TrendingUp className="w-4 h-4" />,
      label: 'Tỷ lệ OK',
      value: `${successRate.toFixed(1)}%`,
      iconColor: successRate >= 90
        ? 'text-emerald-600 dark:text-emerald-400'
        : successRate >= 70
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400',
      valueColor: successRate >= 90
        ? 'text-emerald-700 dark:text-emerald-400'
        : successRate >= 70
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-red-700 dark:text-red-400',
    },
  ];

  return (
    <div className="mb-6 space-y-2">
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-3 py-2" role="alert">
          <p className="text-xs text-red-700 dark:text-red-300">Không thể làm mới KPI; đang hiển thị dữ liệu gần nhất. {error}</p>
          <button type="button" onClick={() => setRetryKey((key) => key + 1)} className="shrink-0 text-xs font-medium text-primary hover:text-primary/80">Thử lại</button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            {...card}
            onClick={card.filterState ? () => onSelectState(card.filterState!) : undefined}
          />
        ))}
      </div>

      {!!stats.unpriced_count && stats.unpriced_count > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <strong>{stats.unpriced_count.toLocaleString('en-US')}</strong> request có token nhưng CHƯA tính được chi phí (model chưa cấu hình giá).
            Tổng chi phí đang <strong>thiếu</strong> — cấu hình tại <span className="font-medium">Settings → Bảng giá Model</span>.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

interface StatCardData {
  icon: React.ReactNode;
  label: string;
  value: string;
  iconColor: string;
  valueColor: string;
  alert?: boolean;
  pulse?: boolean;
  filterState?: OperationState | 'ALL';
}

function StatCard({
  icon, label, value, iconColor, valueColor,
  alert, pulse, isActive, onClick,
}: StatCardData & { isActive?: boolean; onClick?: () => void }) {
  const clickable = !!onClick;

  let borderClass = 'border-border';
  if (alert) borderClass = 'border-red-300 dark:border-red-800';
  if (pulse) borderClass = 'border-blue-300 dark:border-blue-800';
  if (isActive) borderClass = 'border-primary ring-2 ring-primary/30';

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
      className={`
        relative rounded-xl border ${borderClass} bg-card p-3.5
        transition-all duration-200
        ${clickable ? 'cursor-pointer hover:shadow-md hover:border-primary/50 active:scale-[0.98]' : ''}
        ${alert ? 'bg-red-50/30 dark:bg-red-950/10' : ''}
        ${pulse ? 'bg-blue-50/30 dark:bg-blue-950/10' : ''}
        ${isActive ? 'bg-primary/5 dark:bg-primary/10' : ''}
      `}
      aria-pressed={clickable ? isActive : undefined}
      aria-label={clickable ? `Lọc theo: ${label}` : undefined}
    >
      {pulse && (
        <div className="absolute top-2 right-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
        </div>
      )}
      <div className={`inline-flex items-center justify-center w-7 h-7 rounded-lg bg-muted/60 dark:bg-muted/30 ${iconColor} mb-2`}>
        {icon}
      </div>
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5 truncate">
        {label}
      </p>
      <p className={`text-lg font-bold tabular-nums leading-tight ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}

function StatsSkeletons() {
  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-3.5 animate-pulse">
            <div className="h-7 w-7 bg-muted rounded-lg mb-2" />
            <div className="h-3 bg-muted rounded w-14 mb-1.5" />
            <div className="h-5 bg-muted rounded w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
