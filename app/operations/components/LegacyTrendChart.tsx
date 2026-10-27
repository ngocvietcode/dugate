'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, RotateCcw } from 'lucide-react';
import type { TimeseriesPoint } from '../types';
import { formatCost, formatTokens } from '../lib/format';

type Metric = 'request' | 'cost' | 'token';

interface TrendChartProps {
  points: TimeseriesPoint[];
  bucket: 'hour' | 'day';
  truncated?: boolean;
  coverageStart?: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function TrendChart({
  points, bucket, truncated, coverageStart, loading, error, onRetry,
}: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>('request');

  const metricValue = (p: TimeseriesPoint): number =>
    metric === 'request' ? p.total : metric === 'cost' ? p.cost : p.tokensIn + p.tokensOut;

  const maxValue = useMemo(
    () => Math.max(0, ...points.map(metricValue)),
    [points, metric],
  );
  const scaleMax = maxValue > 0 ? maxValue : 1;

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="h-4 w-32 bg-muted rounded animate-pulse mb-4" />
        <div className="h-40 flex items-end gap-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="flex-1 bg-muted rounded-t animate-pulse" style={{ height: `${20 + (i % 5) * 15}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-300 dark:border-red-800 bg-card p-6 text-center" role="alert">
        <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-red-700 dark:text-red-300">Không thể tải biểu đồ xu hướng</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80">
            <RotateCcw className="w-3.5 h-3.5" /> Thử lại
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground">
          Xu hướng <span className="text-muted-foreground font-normal">/ {bucket === 'hour' ? 'giờ' : 'ngày'}</span>
        </h3>
        <div className="flex items-center gap-3">
          {metric === 'request' && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <LegendDot className="bg-emerald-500" label="Thành công" />
              <LegendDot className="bg-red-500" label="Thất bại" />
            </div>
          )}
          <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-xs">
            <MetricBtn active={metric === 'request'} onClick={() => setMetric('request')} label="Request" />
            <MetricBtn active={metric === 'cost'} onClick={() => setMetric('cost')} label="Chi phí" />
            <MetricBtn active={metric === 'token'} onClick={() => setMetric('token')} label="Token" />
          </div>
        </div>
      </div>

      {truncated && coverageStart && (
        <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-400">
          Biểu đồ giới hạn {bucket === 'hour' ? '300 giờ' : '300 ngày'} gần nhất, từ {formatCoverageDate(coverageStart)}.
        </p>
      )}

      {points.length > 0 && (
        <p className="text-[11px] text-muted-foreground mb-1">
          Cao nhất/{bucket === 'hour' ? 'giờ' : 'ngày'}: <span className="font-medium text-foreground/80">{formatMetric(metric, maxValue)}</span>
          <span className="ml-2 sm:hidden">· Chạm vào cột để xem chi tiết</span>
        </p>
      )}

      {points.length === 0 ? (
        <div className="h-40 flex flex-col items-center justify-center text-center gap-2">
          <BarChart3 className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Không có dữ liệu trong khoảng thời gian này.</p>
        </div>
      ) : (
        <>
          <div className="relative h-40 flex items-end gap-[2px]">
            {points.map((p, i) => {
              const value = metricValue(p);
              const height = (value / scaleMax) * 100;
              const tooltipPosition = i === 0
                ? 'left-0'
                : i === points.length - 1
                  ? 'right-0'
                  : 'left-1/2 -translate-x-1/2';
              return (
                <button
                  type="button"
                  key={p.ts}
                  className="relative flex-1 h-full flex items-end min-w-[2px] group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => setHover((current) => (current === i ? null : i))}
                  aria-label={`${formatBucketLabel(p.ts, bucket)}: ${formatMetric(metric, value)}`}
                >
                  <span className="w-full flex flex-col justify-end rounded-t overflow-hidden" style={{ height: `${height}%` }}>
                    {metric === 'request' ? (
                      <>
                        {p.failed > 0 && <span className="w-full bg-red-500" style={{ height: `${(p.failed / Math.max(p.total, 1)) * 100}%` }} />}
                        {p.total - p.succeeded - p.failed > 0 && (
                          <span className="w-full bg-slate-400 dark:bg-slate-500" style={{ height: `${((p.total - p.succeeded - p.failed) / Math.max(p.total, 1)) * 100}%` }} />
                        )}
                        {p.succeeded > 0 && <span className="w-full bg-emerald-500" style={{ height: `${(p.succeeded / Math.max(p.total, 1)) * 100}%` }} />}
                      </>
                    ) : (
                      <span className={`w-full ${metric === 'cost' ? 'bg-amber-500' : 'bg-violet-500'}`} style={{ height: '100%' }} />
                    )}
                  </span>

                  {hover === i && (
                    <span className={`absolute z-10 -translate-y-2 bottom-full ${tooltipPosition} pointer-events-none`}>
                      <span className="block rounded-lg border border-border bg-popover shadow-lg px-2.5 py-1.5 text-[11px] whitespace-nowrap text-left">
                        <span className="block font-medium text-foreground mb-0.5">{formatBucketLabel(p.ts, bucket)}</span>
                        {metric === 'request' && (
                          <>
                            <span className="block text-muted-foreground">Tổng: <span className="text-foreground font-medium tabular-nums">{formatTokens(p.total)}</span></span>
                            <span className="block text-emerald-600 dark:text-emerald-400">OK: {formatTokens(p.succeeded)}</span>
                            <span className="block text-red-600 dark:text-red-400">Fail: {formatTokens(p.failed)}</span>
                          </>
                        )}
                        {metric === 'cost' && (
                          <span className="block text-amber-600 dark:text-amber-400">Chi phí: <span className="font-medium tabular-nums">{formatCost(p.cost)}</span></span>
                        )}
                        {metric === 'token' && (
                          <span className="block text-violet-600 dark:text-violet-400">Token: <span className="font-medium tabular-nums">{formatTokens(p.tokensIn + p.tokensOut)}</span></span>
                        )}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
            <span>{formatBucketLabel(points[0].ts, bucket)}</span>
            {points.length > 2 && <span>{formatBucketLabel(points[Math.floor(points.length / 2)].ts, bucket)}</span>}
            <span>{formatBucketLabel(points[points.length - 1].ts, bucket)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function formatCoverageDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

function formatMetric(metric: Metric, value: number): string {
  if (metric === 'cost') return formatCost(value);
  return formatTokens(value);
}

function MetricBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 h-6 rounded-md font-medium transition-all ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-2 h-2 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function formatBucketLabel(ts: string, bucket: 'hour' | 'day'): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  if (bucket === 'hour') {
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}h`;
  }
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}
