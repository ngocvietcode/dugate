'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  Clock3,
  ListChecks,
  RefreshCcw,
  RotateCcw,
} from 'lucide-react';
import DashboardStats from './DashboardStats';
import BusinessBreakdownGrid from './BusinessBreakdownGrid';
import TrendChart, { type BusinessTrendDrillDown } from './TrendChart';
import BusinessOperationsTable from './BusinessOperationsTable';
import BusinessOperationDetail from './BusinessOperationDetail';
import { BusinessOperationFilters } from './OperationFilters';
import type {
  BusinessDashboardPhase,
  BusinessDashboardRequestError,
} from '../hooks/useBusinessOperationsDashboard';
import type { BusinessOperationFilterOptionsData } from '../hooks/useBusinessOperationResources';
import type {
  BusinessOperationDetailResponse,
  BusinessOperationSort,
  BusinessOperationsDashboardFilter,
  BusinessOperationsDashboardResponse,
  BusinessOperationsFilterState,
  BusinessOperationsSummary,
} from '../types';

const EMPTY_SUMMARY: BusinessOperationsSummary = {
  totalCases: 0,
  tokensProcessed: 0,
  totalCostUsd: '0',
  logicSuccessRate: null,
  aiExtractionRate: null,
  p95DurationSeconds: null,
  unpricedRequestCount: 0,
  costIncomplete: false,
};

export interface BusinessOperationsDashboardViewProps {
  data: BusinessOperationsDashboardResponse | null;
  phase: BusinessDashboardPhase;
  draftFilter: BusinessOperationsFilterState;
  appliedFilter: BusinessOperationsDashboardFilter | null;
  initialFilter: BusinessOperationsFilterState;
  error: BusinessDashboardRequestError | null;
  staleWarning: BusinessDashboardRequestError | null;
  filterOptions: BusinessOperationFilterOptionsData;
  filterOptionsLoading: boolean;
  filterOptionsError: string | null;
  onRetryFilterOptions: () => void;
  onDraftChange: (draft: BusinessOperationsFilterState) => void;
  onRequestApply: (draft: BusinessOperationsFilterState) => void;
  onRetry: () => void;
  onRefresh: () => void;
  onTrendDrillDown: (selection: BusinessTrendDrillDown) => void;
  onListPageChange: (page: number) => void;
  onListSortChange: (sort: BusinessOperationSort) => void;
  detailToken: string | null;
  detailResponse: BusinessOperationDetailResponse | null;
  detailLoading: boolean;
  detailError: string | null;
  onOpenDetail: (token: string) => void;
  onCloseDetail: () => void;
  onRetryDetail: () => void;
  onDetailPageChange: (page: number) => void;
}

/** Pure page surface: one committed dashboard response feeds every aggregate widget. */
export default function BusinessOperationsDashboardView({
  data,
  phase,
  draftFilter,
  appliedFilter,
  initialFilter,
  error,
  staleWarning,
  filterOptions,
  filterOptionsLoading,
  filterOptionsError,
  onRetryFilterOptions,
  onDraftChange,
  onRequestApply,
  onRetry,
  onRefresh,
  onTrendDrillDown,
  onListPageChange,
  onListSortChange,
  detailToken,
  detailResponse,
  detailLoading,
  detailError,
  onOpenDetail,
  onCloseDetail,
  onRetryDetail,
  onDetailPageChange,
}: BusinessOperationsDashboardViewProps) {
  const effectiveAppliedFilter = appliedFilter ?? appliedFilterFromDraft(initialFilter);
  const calendarTimezone = data?.calendarTimezone ?? 'Asia/Ho_Chi_Minh';
  const initialLoading = data === null && phase === 'initial-loading';
  const loadingNewFilter = data !== null && phase === 'loading-new-filter';
  const refreshing = data !== null && phase === 'refreshing';
  const controlsDisabled = initialLoading || loadingNewFilter || filterOptionsLoading;

  return (
    <main className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Phân tích nghiệp vụ theo profile và operation trong cùng một snapshot.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start text-xs text-muted-foreground">
          <Link
            href="/operations"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 font-medium text-foreground hover:bg-muted"
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            Giám sát request
          </Link>
          {data && (
            <span className="inline-flex items-center gap-1.5" title={data.queryTimestamp}>
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              Snapshot: <time dateTime={data.queryTimestamp}>{formatSnapshotTimestamp(data.queryTimestamp, calendarTimezone)}</time>
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={initialLoading || loadingNewFilter || refreshing}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {refreshing ? 'Đang làm mới' : 'Làm mới'}
          </button>
        </div>
      </header>

      <section className="mb-5 rounded-xl border border-border bg-card p-4" aria-label="Bộ lọc dashboard nghiệp vụ">
        <BusinessOperationFilters
          draftFilter={draftFilter}
          appliedFilter={effectiveAppliedFilter}
          calendarTimezone={calendarTimezone}
          profiles={filterOptions.profiles}
          operationTypes={filterOptions.operationTypes}
          onDraftChange={onDraftChange}
          onRequestApply={onRequestApply}
          disabled={controlsDisabled}
        />
        {filterOptionsError && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400" role="alert">
            <span>{filterOptionsError}</span>
            <button type="button" onClick={onRetryFilterOptions} className="font-medium text-primary hover:text-primary/80">Thử lại</button>
          </div>
        )}
      </section>

      {error && data === null ? (
        <InitialDashboardError error={error} onRetry={onRetry} />
      ) : (
        <div className="space-y-6">
          {staleWarning && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between" role="alert">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  <strong>Dữ liệu chưa được làm mới.</strong>{' '}
                  Snapshot lúc {data ? formatSnapshotTimestamp(data.queryTimestamp, calendarTimezone) : 'gần nhất'} vẫn đang được hiển thị. {staleWarning.message}
                </p>
              </div>
              <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 font-medium text-primary hover:text-primary/80">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Thử lại
              </button>
            </div>
          )}

          {loadingNewFilter && <p className="text-xs font-medium text-primary" role="status">Đang tải snapshot cho bộ lọc mới…</p>}

          <DashboardStats summary={data?.summary ?? EMPTY_SUMMARY} loading={initialLoading || loadingNewFilter} />
          <BusinessBreakdownGrid cards={data?.breakdownCards ?? []} loading={initialLoading || loadingNewFilter} onOpenOperation={onOpenDetail} />
          <TrendChart
            points={data?.trend.points ?? []}
            bucket={data?.trend.bucket ?? (draftFilter.range === 'today' ? 'hour' : 'day')}
            loading={initialLoading || loadingNewFilter}
            onDrillDown={onTrendDrillDown}
          />
          <BusinessOperationsTable
            list={data?.list ?? null}
            loading={initialLoading || loadingNewFilter}
            onOpenOperation={onOpenDetail}
            onPageChange={onListPageChange}
            timeZone={calendarTimezone}
            sort={effectiveAppliedFilter.sort}
            onSortChange={onListSortChange}
          />
          <BusinessOperationDetail
            token={detailToken}
            response={detailResponse}
            loading={detailLoading}
            error={detailError}
            onRetry={onRetryDetail}
            onClose={onCloseDetail}
            onPageChange={onDetailPageChange}
            timeZone={calendarTimezone}
          />
        </div>
      )}
    </main>
  );
}

function InitialDashboardError({ error, onRetry }: { error: BusinessDashboardRequestError; onRetry: () => void }) {
  return (
    <section className="rounded-xl border border-red-300 bg-card px-6 py-14 text-center dark:border-red-800" role="alert">
      <AlertTriangle className="mx-auto h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
      <h2 className="mt-3 text-base font-semibold text-foreground">Không thể tải dashboard Operations</h2>
      <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <RotateCcw className="h-4 w-4" aria-hidden="true" /> Thử lại
      </button>
    </section>
  );
}

function appliedFilterFromDraft(filter: BusinessOperationsFilterState): BusinessOperationsDashboardFilter {
  const query = filter.query.trim();
  return {
    range: filter.range,
    profile: filter.profile,
    operationType: filter.operationType,
    status: filter.status,
    search: query ? { query, mode: filter.searchMode } : null,
    sort: filter.sort,
    page: filter.page,
  };
}

function formatSnapshotTimestamp(value: string, timeZone: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return value;
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
