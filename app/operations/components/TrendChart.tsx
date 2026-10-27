'use client';

import { AlertTriangle, BarChart3, RotateCcw } from 'lucide-react';
import type {
  BusinessOperationTrendPoint,
  BusinessTrendStatus,
} from '../types';
import { formatBusinessTokens } from '../lib/business-format';

const STATUS_SERIES: ReadonlyArray<{
  status: BusinessTrendStatus;
  label: string;
  className: string;
  textClassName: string;
}> = [
  {
    status: 'IN_PROGRESS',
    label: 'Đang xử lý',
    className: 'bg-sky-500 hover:bg-sky-600',
    textClassName: 'text-sky-700 dark:text-sky-400',
  },
  {
    status: 'SUCCEEDED',
    label: 'Thành công',
    className: 'bg-emerald-500 hover:bg-emerald-600',
    textClassName: 'text-emerald-700 dark:text-emerald-400',
  },
  {
    status: 'FAILED',
    label: 'Thất bại',
    className: 'bg-red-500 hover:bg-red-600',
    textClassName: 'text-red-700 dark:text-red-400',
  },
];

export interface BusinessTrendDrillDown {
  status: BusinessTrendStatus;
  start: string;
  end: string;
  startInclusive: true;
  endInclusive: boolean;
  localKey: string;
  occurrence: number;
}

export interface TrendChartProps {
  points: BusinessOperationTrendPoint[];
  bucket: 'hour' | 'day';
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onDrillDown?: (selection: BusinessTrendDrillDown) => void;
}

export function createTrendDrillDown(
  point: BusinessOperationTrendPoint,
  status: BusinessTrendStatus,
): BusinessTrendDrillDown {
  return {
    status,
    start: point.start,
    end: point.end,
    startInclusive: point.startInclusive,
    endInclusive: point.endInclusive,
    localKey: point.localKey,
    occurrence: point.occurrence,
  };
}

/** Gap-filled stacked business-status trend. Every supplied zero bucket remains visible. */
export default function TrendChart({
  points,
  bucket,
  loading = false,
  error = null,
  onRetry,
  onDrillDown,
}: TrendChartProps) {
  if (loading) return <TrendSkeleton />;

  if (error) {
    return (
      <section className="rounded-xl border border-red-300 bg-card p-6 text-center dark:border-red-800" role="alert" aria-labelledby="business-trend-error-title">
        <AlertTriangle className="mx-auto h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
        <h2 id="business-trend-error-title" className="mt-2 text-sm font-semibold text-red-700 dark:text-red-300">Không thể tải xu hướng nghiệp vụ</h2>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Thử lại
          </button>
        )}
      </section>
    );
  }

  const maxBucketTotal = Math.max(1, ...points.map((point) => point.total));

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="business-trend-title">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="business-trend-title" className="text-base font-semibold text-foreground">Xu hướng nghiệp vụ</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Theo {bucket === 'hour' ? 'giờ địa phương' : 'ngày địa phương'} · chọn một phần cột để lọc danh sách
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Chú giải trạng thái">
          {STATUS_SERIES.map((series) => (
            <span key={series.status} className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${series.textClassName}`}>
              <span className={`h-2.5 w-2.5 rounded-sm ${series.className.split(' ')[0]}`} aria-hidden="true" />
              {series.label}
            </span>
          ))}
        </div>
      </header>

      {points.length === 0 ? (
        <div className="flex h-52 flex-col items-center justify-center text-center" role="status">
          <BarChart3 className="h-9 w-9 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">Không có dữ liệu xu hướng</p>
          <p className="mt-1 text-xs text-muted-foreground">API chưa trả về khoảng thời gian để hiển thị.</p>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto pb-1">
          <div className="flex h-56 min-w-[520px] items-end gap-1.5 border-b border-border px-1" role="group" aria-label="Biểu đồ cột chồng theo trạng thái nghiệp vụ">
            {points.map((point, index) => {
              const bucketHeight = (point.total / maxBucketTotal) * 100;
              const pointKey = `${point.localKey}:${point.occurrence}:${index}`;
              const bucketLabel = formatTrendBucketLabel(point.localKey, bucket, point.occurrence);

              return (
                <div key={pointKey} className="group relative flex h-full min-w-[18px] flex-1 flex-col justify-end">
                  <div className="pointer-events-none absolute bottom-[calc(100%+0.25rem)] left-1/2 z-10 hidden -translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-2 text-[11px] shadow-lg group-hover:block group-focus-within:block">
                    <p className="whitespace-nowrap font-semibold text-foreground">{bucketLabel}</p>
                    <p className="mt-1 whitespace-nowrap text-muted-foreground">Tổng: {formatBusinessTokens(point.total)}</p>
                    {STATUS_SERIES.map((series) => (
                      <p key={series.status} className={`whitespace-nowrap ${series.textClassName}`}>
                        {series.label}: {formatBusinessTokens(point.counts[series.status])}
                      </p>
                    ))}
                  </div>

                  <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-muted/40" style={{ height: point.total === 0 ? '3px' : `${Math.max(bucketHeight, 2)}%` }}>
                    {point.total === 0 ? (
                      <span className="h-[3px] w-full bg-muted-foreground/25" aria-label={`${bucketLabel}: 0 nghiệp vụ`} />
                    ) : (
                      STATUS_SERIES.map((series) => {
                        const count = point.counts[series.status];
                        if (count === 0) return null;
                        const segmentHeight = (count / point.total) * 100;
                        const selection = createTrendDrillDown(point, series.status);

                        return (
                          <button
                            key={series.status}
                            type="button"
                            className={`w-full min-h-[3px] transition-colors focus:relative focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${series.className}`}
                            style={{ height: `${segmentHeight}%` }}
                            onClick={() => onDrillDown?.(selection)}
                            aria-label={`${bucketLabel}, ${series.label}: ${formatBusinessTokens(count)} nghiệp vụ`}
                            title={`${bucketLabel} · ${series.label}: ${formatBusinessTokens(count)}`}
                          />
                        );
                      })
                    )}
                  </div>
                  <span className="mt-2 truncate text-center text-[9px] text-muted-foreground" title={bucketLabel}>
                    {shortTrendBucketLabel(point.localKey, bucket)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function formatTrendBucketLabel(
  localKey: string,
  bucket: 'hour' | 'day',
  occurrence = 0,
): string {
  const normalized = localKey.replace('T', ' ');
  const suffix = occurrence > 0 ? ` (${occurrence + 1})` : '';
  return `${bucket === 'hour' ? 'Giờ' : 'Ngày'} ${normalized}${suffix}`;
}

function shortTrendBucketLabel(localKey: string, bucket: 'hour' | 'day'): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}))?/.exec(localKey);
  if (!dateMatch) return localKey;
  const [, , month, day, hour] = dateMatch;
  return bucket === 'hour' && hour ? `${hour}h` : `${day}/${month}`;
}

function TrendSkeleton() {
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Đang tải xu hướng nghiệp vụ" aria-busy="true">
      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-5 flex h-52 items-end gap-1.5">
        {Array.from({ length: 18 }).map((_, index) => (
          <div key={index} className="flex-1 animate-pulse rounded-t bg-muted" style={{ height: `${15 + (index % 6) * 12}%` }} />
        ))}
      </div>
    </section>
  );
}
