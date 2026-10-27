'use client';

import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  DatabaseZap,
  Play,
  RefreshCw,
  SearchX,
} from 'lucide-react';
import Pagination from './Pagination';
import type {
  BusinessOperationListItem,
  BusinessOperationListPage,
  BusinessOperationSort,
  BusinessStatus,
} from '../types';
import { BUSINESS_OPERATION_SORT_OPTIONS, BUSINESS_STATUS_BADGE_CONFIG } from '../types';
import {
  formatBusinessCostUsd,
  formatBusinessDurationSeconds,
  formatBusinessTokens,
  isHighBusinessTokenCount,
  isSlowBusinessDuration,
} from '../lib/business-format';

export interface BusinessOperationsTableProps {
  list: BusinessOperationListPage | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenOperation: (token: string) => void;
  onPageChange: (page: number) => void;
  timeZone: string;
  sort: BusinessOperationSort;
  onSortChange: (sort: BusinessOperationSort) => void;
}

/**
 * Business-level Operations list. Items deliberately stay in API order
 * (`updatedTime DESC`, then identifier ASC); the client never re-sorts them.
 */
export default function BusinessOperationsTable({
  list,
  loading = false,
  error = null,
  onRetry,
  onOpenOperation,
  onPageChange,
  timeZone,
  sort,
  onSortChange,
}: BusinessOperationsTableProps) {
  if (loading) return <BusinessOperationsTableSkeleton />;

  if (error) {
    return (
      <TableState
        icon={<SearchX className="h-7 w-7" />}
        title="Không thể tải danh sách nghiệp vụ"
        description={error}
        tone="danger"
        action={onRetry ? { label: 'Thử lại', onClick: onRetry } : undefined}
      />
    );
  }

  if (!list || list.items.length === 0) {
    return (
      <TableState
        icon={<Boxes className="h-7 w-7" />}
        title="Không có Business Operation phù hợp"
        description="Không có nghiệp vụ được cấp quyền trong bộ lọc hiện tại."
      />
    );
  }

  return (
    <section aria-labelledby="business-operations-list-title">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="business-operations-list-title" className="text-base font-semibold text-foreground">
            Danh sách Business Operations
          </h2>
          <p className="text-xs text-muted-foreground">
            Một dòng cho mỗi nghiệp vụ; thứ tự cập nhật mới nhất do máy chủ cung cấp.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Sắp xếp danh sách</span>
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as BusinessOperationSort)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="Sắp xếp danh sách"
            >
              {BUSINESS_OPERATION_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatBusinessTokens(list.total)} nghiệp vụ · 50 dòng/trang
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm" aria-labelledby="business-operations-list-title">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <ColumnHeader>Business Operation</ColumnHeader>
                <ColumnHeader>Profile · Loại operation</ColumnHeader>
                <ColumnHeader className="text-right">Requests</ColumnHeader>
                <ColumnHeader className="text-right">Tokens · Chi phí</ColumnHeader>
                <ColumnHeader className="text-right">Thời gian xử lý</ColumnHeader>
                <ColumnHeader>Thời gian</ColumnHeader>
                <th className="w-12 px-3 py-3"><span className="sr-only">Mở chi tiết</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {list.items.map((operation) => (
                <BusinessOperationRow
                  key={operation.token}
                  operation={operation}
                  onOpen={() => onOpenOperation(operation.token)}
                  timeZone={timeZone}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-xs tabular-nums text-muted-foreground">
          Trang {list.page}/{list.totalPages} · Hiển thị {list.items.length}/{formatBusinessTokens(list.total)} nghiệp vụ
        </p>
        <Pagination
          page={list.page}
          totalPages={list.totalPages}
          onPageChange={onPageChange}
          ariaLabel="Phân trang danh sách Business Operations"
        />
      </div>
    </section>
  );
}

function BusinessOperationRow({
  operation,
  onOpen,
  timeZone,
}: {
  operation: BusinessOperationListItem;
  onOpen: () => void;
  timeZone: string;
}) {
  return (
    <tr className="group transition-colors hover:bg-muted/30" data-business-operation-token={operation.token}>
      <td className="px-4 py-3 align-top">
        <button
          type="button"
          onClick={onOpen}
          className="max-w-[280px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={`Mở Business Operation ${operation.operationIdentifier}`}
        >
          <span className="block break-all font-mono text-xs font-semibold text-foreground group-hover:text-primary">
            {operation.operationIdentifier}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <BusinessStatusBadge status={operation.businessStatus} />
            {operation.invalidData && (
              <Marker label="Dữ liệu trạng thái không hợp lệ" tone="danger" icon={<AlertTriangle />} />
            )}
            {operation.missingData && (
              <Marker label="Thiếu dữ liệu nguồn" tone="warning" icon={<DatabaseZap />} />
            )}
          </span>
        </button>
      </td>
      <td className="px-4 py-3 align-top">
        <p className="text-xs font-medium text-foreground">{operation.profileScope.name}</p>
        <div className="mt-1 flex max-w-[300px] flex-wrap gap-1">
          {operation.operationTypes.length > 0 ? operation.operationTypes.map((operationType) => (
            <span key={operationType} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {operationType}
            </span>
          )) : <span className="text-xs text-muted-foreground">—</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-right align-top font-medium tabular-nums text-foreground">
        {formatBusinessTokens(operation.requestCount)}
      </td>
      <td className="px-4 py-3 text-right align-top">
        {isHighBusinessTokenCount(operation.totalTokens) ? (
          <p className="text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-300" title="Nhiều token">
            {formatBusinessTokens(operation.totalTokens)} tokens
          </p>
        ) : (
          <p className="text-xs tabular-nums text-foreground">{formatBusinessTokens(operation.totalTokens)} tokens</p>
        )}
        <p className="mt-1 text-xs font-semibold tabular-nums text-foreground">
          {formatBusinessCostUsd(operation.totalCostUsd)}
        </p>
        {operation.unpricedRequestCount > 0 && (
          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300" title="Tổng chi phí chưa đầy đủ">
            <CircleDollarSign className="h-3 w-3" aria-hidden="true" />
            {formatBusinessTokens(operation.unpricedRequestCount)} chưa định giá
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right align-top">
        {isSlowBusinessDuration(operation.durationSeconds) ? (
          <span className="inline-flex flex-col items-end gap-1" title="Vượt ngưỡng thời gian">
            <span className="text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-300">
              {formatBusinessDurationSeconds(operation.durationSeconds)}
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Chậm
            </span>
          </span>
        ) : (
          <span className="text-xs tabular-nums text-foreground">
            {formatBusinessDurationSeconds(operation.durationSeconds)}
          </span>
        )}
      </td>
      <td className="px-4 py-3 align-top text-xs tabular-nums text-muted-foreground">
        <p className="flex items-center gap-1.5" title={`Bắt đầu: ${operation.startTime}`}>
          <Play className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>Bắt đầu:</span>
          {formatDateTime(operation.startTime, timeZone)}
        </p>
        {operation.endTime ? (
          <p className="mt-1 flex items-center gap-1.5" title={`Hoàn tất: ${operation.endTime}`}>
            <CheckCircle2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>Hoàn tất:</span>
            {formatDateTime(operation.endTime, timeZone)}
          </p>
        ) : (
          <p className="mt-1 flex items-center gap-1.5" title={`Cập nhật: ${operation.updatedTime}`}>
            <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>Cập nhật:</span>
            {formatDateTime(operation.updatedTime, timeZone)}
          </p>
        )}
      </td>
      <td className="px-3 py-3 align-middle">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={`Mở chi tiết ${operation.operationIdentifier}`}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

function BusinessStatusBadge({ status }: { status: BusinessStatus }) {
  const config = BUSINESS_STATUS_BADGE_CONFIG[status];
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

function Marker({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: 'warning' | 'danger';
  icon: React.ReactElement<{ className?: string }>;
}) {
  const className = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${className}`} title={label}>
      <span className="[&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

function ColumnHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}>
      {children}
    </th>
  );
}

function TableState({
  icon,
  title,
  description,
  action,
  tone = 'default',
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  tone?: 'default' | 'danger';
}) {
  return (
    <div className={`rounded-xl border bg-card px-6 py-16 text-center ${tone === 'danger' ? 'border-red-300 dark:border-red-800' : 'border-dashed border-border'}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted ${tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground/50'}`} aria-hidden="true">
        {icon}
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="mt-4 text-sm font-medium text-primary hover:text-primary/80">
          {action.label}
        </button>
      )}
    </div>
  );
}

function BusinessOperationsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Đang tải danh sách Business Operations" aria-busy="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex animate-pulse gap-5 border-b border-border/50 px-4 py-4 last:border-0">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="h-5 w-52 rounded bg-muted" />
          <div className="ml-auto h-5 w-24 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function formatDateTime(value: string, timeZone: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return '—';
  return timestamp.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone,
  });
}
