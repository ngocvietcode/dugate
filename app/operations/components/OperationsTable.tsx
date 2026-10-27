'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, SearchX } from 'lucide-react';
import type { OperationListItem } from '../types';
import OperationStateBadge from './OperationStateBadge';
import { formatCost, formatTokens } from '../lib/format';

// ─── Helpers ──────────────────────────────────────────

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'vừa xong';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h trước`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d trước`;
  // Fallback to date
  return new Date(dateStr).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

/** Duration between two ISO timestamps → "3.2s" or "1m 5s" */
function formatDuration(startStr: string, endStr: string): string {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

/** States where a progress bar is meaningful (still in flight) */
const IN_FLIGHT_STATES = new Set(['RUNNING', 'PENDING', 'WAITING_USER_INPUT']);

// ─── Types ──────────────────────────────────────────

type OperationListItemView = OperationListItem & {
  idempotencyKey?: string | null;
  hasUnpricedCost?: boolean;
};

interface OperationsTableProps {
  operations: OperationListItemView[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyWithFilter?: boolean;
  onClearFilters?: () => void;
}

export default function OperationsTable({
  operations,
  loading, error, onRetry, emptyWithFilter, onClearFilters,
}: OperationsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Carry the current list URL (with all active filters) into the detail page so
  // "Quay lại danh sách" returns to the exact same filtered view.
  const listQuery = searchParams.toString();
  const listUrl = listQuery ? `/operations?${listQuery}` : '/operations';
  const openDetail = (id: string) => {
    router.push(`/operations/${id}?from=${encodeURIComponent(listUrl)}`);
  };

  if (loading) return <TableSkeleton />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-300 dark:border-red-800 bg-card flex flex-col items-center justify-center py-16 text-center" role="alert">
        <SearchX className="w-7 h-7 text-red-600 dark:text-red-400 mb-3" />
        <p className="text-sm font-medium text-red-700 dark:text-red-300">Không thể tải danh sách operations</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-3 text-sm font-medium text-primary hover:text-primary/80">
            Thử lại
          </button>
        )}
      </div>
    );
  }

  if (operations.length === 0 && !emptyWithFilter) {
    return (
      <div className="rounded-xl border border-border bg-card flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <Activity className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-base font-medium text-foreground mb-1">Chưa có operation nào</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Các operation sẽ xuất hiện khi có request gửi đến pipeline API.
        </p>
      </div>
    );
  }

  if (operations.length === 0 && emptyWithFilter) {
    return (
      <div className="rounded-xl border border-border bg-card flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <SearchX className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-base font-medium text-foreground mb-1">Không tìm thấy operation phù hợp</p>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">
          Thử thay đổi bộ lọc hoặc mở rộng khoảng thời gian.
        </p>
        {onClearFilters && (
          <button type="button" onClick={onClearFilters} className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">
            Xóa tất cả bộ lọc
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <ColumnHeader className="min-w-[150px]">Tác vụ</ColumnHeader>
              <ColumnHeader className="min-w-[190px]">Reference</ColumnHeader>
              <ColumnHeader className="min-w-[160px]">Nguồn</ColumnHeader>
              <ColumnHeader className="w-[120px]">Tiến trình</ColumnHeader>
              <ColumnHeader className="w-[120px] text-right">Token · Chi phí</ColumnHeader>
              <ColumnHeader className="w-[90px] text-right">Thời gian</ColumnHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {operations.map((operation) => {
              const references = [
                operation.clientReference && { label: 'Client Ref', value: operation.clientReference },
                operation.correlationId && { label: 'Correlation', value: operation.correlationId },
                operation.idempotencyKey && { label: 'Idempotency', value: operation.idempotencyKey },
              ].filter((item): item is { label: string; value: string } => Boolean(item));
              const reference = references[0] ?? null;
              const referenceTitle = references.map((item) => `${item.label}: ${item.value}`).join('\n');
              const totalTokens = operation.totalInputTokens + operation.totalOutputTokens;

              return (
                <tr
                  key={operation.id}
                  className={`
                    group cursor-pointer transition-colors
                    hover:bg-muted/40 dark:hover:bg-muted/20
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50
                  `}
                  role="link"
                  tabIndex={0}
                  onClick={() => openDetail(operation.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetail(operation.id);
                    }
                  }}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-foreground group-hover:text-primary transition-colors" title={operation.id}>
                        {operation.id.slice(0, 8)}
                      </span>
                      <OperationStateBadge state={operation.state} />
                    </div>
                  </td>

                  <td className="px-3 py-2.5 max-w-[260px]" title={referenceTitle || undefined}>
                    {reference ? (
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{reference.label}</p>
                        <p className="truncate font-mono text-xs text-foreground">{reference.value}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="mb-0.5">
                      {operation.profileName ? (
                        <span className="text-xs text-foreground">{operation.profileName}</span>
                      ) : (
                        <span className="text-xs text-amber-600 dark:text-amber-400">No profile</span>
                      )}
                    </div>
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono bg-muted/50 dark:bg-muted/30 text-muted-foreground rounded">
                      {operation.endpointSlug ?? '—'}
                    </span>
                  </td>

                  <td className="px-3 py-2.5">
                    {IN_FLIGHT_STATES.has(operation.state) ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[50px]">
                          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.min(operation.progressPercent, 100)}%` }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{operation.progressPercent}%</span>
                      </div>
                    ) : operation.done ? (
                      <span className="text-xs text-muted-foreground tabular-nums" title="Thời gian xử lý">
                        {/* completedAt = terminal-state time; fall back to updatedAt for legacy rows. */}
                        {formatDuration(operation.createdAt, operation.completedAt ?? operation.updatedAt)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-right">
                    {totalTokens > 0 || operation.totalCostUsd > 0 ? (
                      <div className="leading-tight">
                        <span
                          className="text-xs tabular-nums text-muted-foreground"
                          title={`Input: ${formatTokens(operation.totalInputTokens)} / Output: ${formatTokens(operation.totalOutputTokens)}`}
                        >
                          {totalTokens > 0 ? formatTokens(totalTokens) : '—'}
                        </span>
                        <span className="text-muted-foreground/40 mx-1">·</span>
                        {operation.totalCostUsd > 0 ? (
                          <span className="text-xs tabular-nums text-foreground font-medium">{formatCost(operation.totalCostUsd)}</span>
                        ) : operation.hasUnpricedCost ? (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400" title="Model chưa cấu hình giá">N/A</span>
                        ) : (
                          <span className="text-xs tabular-nums text-foreground font-medium">$0</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-right">
                    <span
                      className="text-xs tabular-nums text-muted-foreground whitespace-nowrap"
                      title={`Tạo: ${formatDateTime(operation.createdAt)}${operation.done ? `\nXong: ${formatDateTime(operation.completedAt ?? operation.updatedAt)}` : ''}`}
                    >
                      {formatRelativeTime(operation.createdAt)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider ${className}`}>
      {children}
    </th>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
      <div className="border-b border-border bg-muted/30 px-3 py-3 flex gap-6">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-3 bg-muted rounded w-16" />)}
      </div>
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="border-b border-border/50 px-3 py-3.5 flex items-center gap-6">
          <div className="h-4 bg-muted rounded w-28" />
          <div className="h-4 bg-muted rounded w-40" />
          <div className="h-4 bg-muted rounded w-28" />
          <div className="h-2 bg-muted rounded w-16" />
          <div className="h-4 bg-muted rounded w-20 ml-auto" />
          <div className="h-4 bg-muted rounded w-14" />
        </div>
      ))}
    </div>
  );
}
