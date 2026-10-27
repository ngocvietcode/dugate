'use client';

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  DatabaseZap,
  FileSearch,
  Gauge,
  Layers,
  LoaderCircle,
  Play,
  RefreshCw,
  Timer,
  X,
} from 'lucide-react';
import Pagination from './Pagination';
import type {
  BusinessOperationDetailItem,
  BusinessOperationDetailResponse,
  BusinessStatus,
  ConstituentRequestItem,
} from '../types';
import {
  BUSINESS_STATUS_BADGE_CONFIG,
  STATE_BADGE_CONFIG,
  type OperationState,
} from '../types';
import {
  MISSING_VALUE_DISPLAY,
  displayConstituentValue,
  formatBusinessCostUsd,
  formatBusinessDurationSeconds,
  formatBusinessTokens,
  formatConstituentCompletedAt,
  shouldShowConstituentErrorPanel,
} from '../lib/business-format';

export interface BusinessOperationDetailProps {
  token: string | null;
  response: BusinessOperationDetailResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClose?: () => void;
  onPageChange: (page: number) => void;
  timeZone: string;
}

/**
 * Drawer-ready detail surface keyed by the opaque signed operation token.
 * Loading and error branches intentionally ignore `response`, preventing data
 * from a previously selected business operation from flashing or leaking.
 */
export default function BusinessOperationDetail({
  token,
  response,
  loading = false,
  error = null,
  onRetry,
  onClose,
  onPageChange,
  timeZone,
}: BusinessOperationDetailProps) {
  if (!token) return null;

  return (
    <aside
      className="overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="business-operation-detail-title"
      data-business-operation-token={token}
    >
      <DetailHeader onClose={onClose} />
      {loading ? (
        <DetailLoading />
      ) : error ? (
        <DetailError error={error} onRetry={onRetry} />
      ) : !response || response.operation.token !== token ? (
        <DetailEmpty title="Chưa có dữ liệu nghiệp vụ" description="Không có dữ liệu chi tiết khớp với nghiệp vụ đang chọn." />
      ) : (
        <DetailContent response={response} onPageChange={onPageChange} timeZone={timeZone} />
      )}
    </aside>
  );
}

function DetailHeader({ onClose }: { onClose?: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-muted/20 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
          <FileSearch className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id="business-operation-detail-title" className="text-base font-semibold text-foreground">
            Chi tiết Business Operation
          </h2>
          <p className="text-xs text-muted-foreground">Các request thành phần được cấp quyền</p>
        </div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Đóng chi tiết Business Operation"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </header>
  );
}

function DetailContent({
  response,
  onPageChange,
  timeZone,
}: {
  response: BusinessOperationDetailResponse;
  onPageChange: (page: number) => void;
  timeZone: string;
}) {
  const { operation, requests } = response;

  return (
    <div>
      <OperationSummary operation={operation} timeZone={timeZone} />

      <section className="border-t border-border px-5 py-5" aria-labelledby="constituent-requests-title">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="constituent-requests-title" className="text-sm font-semibold text-foreground">
              Constituent Requests
            </h3>
            <p className="text-xs text-muted-foreground">Thứ tự tạo tăng dần do máy chủ cung cấp.</p>
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatBusinessTokens(requests.total)} request · 100 request/trang
          </p>
        </div>

        {requests.items.length === 0 ? (
          <DetailEmpty
            title="Không có request thành phần"
            description="Nghiệp vụ này hiện không có request thành phần nào được cấp quyền."
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] text-sm" aria-labelledby="constituent-requests-title">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <ColumnHeader>Request</ColumnHeader>
                      <ColumnHeader>Loại operation</ColumnHeader>
                      <ColumnHeader>Trạng thái</ColumnHeader>
                      <ColumnHeader>Bắt đầu</ColumnHeader>
                      <ColumnHeader>Hoàn tất</ColumnHeader>
                      <ColumnHeader className="text-right">Input token</ColumnHeader>
                      <ColumnHeader className="text-right">Output token</ColumnHeader>
                      <ColumnHeader className="text-right">Chi phí</ColumnHeader>
                    </tr>
                  </thead>
                  {requests.items.map((request) => (
                    <ConstituentRequestRows key={request.id} request={request} timeZone={timeZone} />
                  ))}
                </table>
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-xs tabular-nums text-muted-foreground">
                Trang {requests.page}/{requests.totalPages} · Hiển thị {requests.items.length}/{formatBusinessTokens(requests.total)} request
              </p>
              <Pagination
                page={requests.page}
                totalPages={requests.totalPages}
                onPageChange={onPageChange}
                ariaLabel="Phân trang Constituent Requests"
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function OperationSummary({ operation, timeZone }: { operation: BusinessOperationDetailItem; timeZone: string }) {
  return (
    <section className="px-5 py-5" aria-label="Tóm tắt Business Operation">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-all font-mono text-base font-semibold text-foreground">{operation.operationIdentifier}</p>
          <p className="mt-1 text-xs text-muted-foreground">{operation.profileScope.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <BusinessStatusBadge status={operation.businessStatus} />
          {operation.invalidData && <SummaryMarker label="Dữ liệu trạng thái không hợp lệ" tone="danger" />}
          {operation.missingData && <SummaryMarker label="Thiếu dữ liệu nguồn" tone="warning" />}
          {operation.unpricedRequestCount > 0 && <SummaryMarker label={`${operation.unpricedRequestCount} request chưa định giá`} tone="warning" />}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryMetric icon={<Gauge />} label="Requests" value={formatBusinessTokens(operation.requestCount)} />
        <SummaryMetric icon={<Coins />} label="Tổng tokens" value={formatBusinessTokens(operation.totalTokens)} />
        <SummaryMetric icon={<CircleDollarSign />} label="Tổng chi phí" value={formatBusinessCostUsd(operation.totalCostUsd)} />
        <SummaryMetric icon={<Timer />} label="Thời gian xử lý" value={formatBusinessDurationSeconds(operation.durationSeconds)} />
        <SummaryMetric icon={<Play />} label="Bắt đầu" value={formatDateTime(operation.startTime, timeZone)} />
        <SummaryMetric icon={<RefreshCw />} label="Cập nhật" value={formatDateTime(operation.updatedTime, timeZone)} />
        <SummaryMetric icon={<CheckCircle2 />} label="Hoàn tất" value={operation.endTime ? formatDateTime(operation.endTime, timeZone) : MISSING_VALUE_DISPLAY} />
        <SummaryMetric icon={<Layers />} label="Loại operation" value={operation.operationTypes.length > 0 ? operation.operationTypes.join(', ') : MISSING_VALUE_DISPLAY} />
      </dl>
    </section>
  );
}

function ConstituentRequestRows({ request, timeZone }: { request: ConstituentRequestItem; timeZone: string }) {
  const showError = shouldShowConstituentErrorPanel(request.state);
  return (
    <tbody className="border-b border-border/60 last:border-b-0" data-request-id={request.id}>
      <tr className="align-top hover:bg-muted/20">
        <td className="px-4 py-3">
          <a
            href={`/operations/${encodeURIComponent(request.id)}`}
            className="inline-flex items-center gap-1.5 break-all font-mono text-xs font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {request.id}
            <ArrowLeft className="h-3 w-3 rotate-180" aria-hidden="true" />
          </a>
          <div className="mt-1 flex flex-wrap gap-1">
            {request.missingData && (
              <SmallMarker icon={<DatabaseZap />} label="Thiếu dữ liệu nguồn" />
            )}
            {request.unpricedCost && (
              <SmallMarker icon={<CircleDollarSign />} label="Chưa định giá" />
            )}
          </div>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-foreground">
          {displayConstituentValue(request.operationType)}
        </td>
        <td className="px-4 py-3"><RequestStateBadge state={request.state} /></td>
        <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground" title={request.startedAt}>
          {formatDateTime(request.startedAt, timeZone)}
        </td>
        <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground" title={request.completedAt ?? undefined}>
          {formatConstituentCompletedAt(request.completedAt, (iso) => formatDateTime(iso, timeZone))}
        </td>
        <td className="px-4 py-3 text-right text-xs tabular-nums text-foreground">
          {displayConstituentValue(request.inputTokens, formatBusinessTokens)}
        </td>
        <td className="px-4 py-3 text-right text-xs tabular-nums text-foreground">
          {displayConstituentValue(request.outputTokens, formatBusinessTokens)}
        </td>
        <td className="px-4 py-3 text-right text-xs font-semibold tabular-nums text-foreground">
          {displayConstituentValue(request.costUsd, formatBusinessCostUsd)}
        </td>
      </tr>
      {showError && (
        <tr>
          <td colSpan={8} className="px-4 pb-3 pt-0">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert" aria-label={`Lỗi xử lý request ${request.id}`}>
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                Lỗi xử lý
              </p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr]">
                <dt className="font-medium">Mã lỗi</dt>
                <dd className="break-words font-mono">{displayConstituentValue(request.errorCode)}</dd>
                <dt className="font-medium">Thông báo lỗi</dt>
                <dd className="whitespace-pre-wrap break-words">{displayConstituentValue(request.errorMessage)}</dd>
              </dl>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}

function RequestStateBadge({ state }: { state: string }) {
  const knownConfig = STATE_BADGE_CONFIG[state as OperationState];
  if (knownConfig) {
    return <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${knownConfig.className}`}>{knownConfig.label}</span>;
  }
  return (
    <span className="inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      {state || MISSING_VALUE_DISPLAY}
    </span>
  );
}

function BusinessStatusBadge({ status }: { status: BusinessStatus }) {
  const config = BUSINESS_STATUS_BADGE_CONFIG[status];
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${config.className}`}>{config.label}</span>;
}

function SummaryMarker({ label, tone }: { label: string; tone: 'warning' | 'danger' }) {
  const className = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${className}`}>
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function SmallMarker({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" title={label}>
      <span className="[&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

function SummaryMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5" title={label}>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </dt>
      <dd className="mt-1 break-words text-xs font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function DetailLoading() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-16 text-center" aria-busy="true" aria-label="Đang tải chi tiết Business Operation">
      <LoaderCircle className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-foreground">Đang tải request thành phần…</p>
    </div>
  );
}

function DetailError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-16 text-center" role="alert">
      <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-foreground">Không thể tải chi tiết Business Operation</p>
      <p className="mt-1 text-xs text-muted-foreground">{error}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 text-sm font-medium text-primary hover:text-primary/80">
          Thử lại
        </button>
      )}
    </div>
  );
}

function DetailEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center" role="status">
      <FileSearch className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function ColumnHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}>{children}</th>;
}

function formatDateTime(value: string, timeZone: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return MISSING_VALUE_DISPLAY;
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
