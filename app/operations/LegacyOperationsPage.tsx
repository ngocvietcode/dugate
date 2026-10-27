'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Gauge, Loader2, Search, X } from 'lucide-react';

import { useOperationsList } from './hooks/useOperationsList';
import { useOperationFilterOptions } from './hooks/useOperationFilterOptions';
import OperationsTabs from './components/OperationsTabs';
import StuckAlertBanner from './components/StuckAlertBanner';
import OverviewTab from './components/OverviewTab';
import RequestsTab from './components/RequestsTab';
import CostBreakdownTab from './components/CostBreakdownTab';
import TimeRangeControl from './components/TimeRangeControl';
import { GlobalOperationFilters } from './components/OperationFilters';
import {
  DEFAULT_TIME_PRESET, presetRange, timeRangeLabel, toApiDate,
  type TimePreset,
} from './lib/timeRange';
import type { OperationFiltersState, OperationsTab } from './types';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function OperationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) router.push('/');
  }, [session, status, router]);

  if (status === 'loading' || !session) {
    return (
      <div className="min-h-[60vh] flex justify-center items-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex justify-center items-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    }>
      <OperationsContent />
    </Suspense>
  );
}

function OperationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab') as OperationsTab | null;
  const tab: OperationsTab = tabParam === 'requests' || tabParam === 'cost' ? tabParam : 'overview';

  const presetParam = searchParams.get('range') as TimePreset | null;
  const preset: TimePreset = presetParam ?? DEFAULT_TIME_PRESET;
  let startDate: string;
  let endDate: string;
  if (preset === 'custom') {
    startDate = searchParams.get('start_date') || '';
    endDate = searchParams.get('end_date') || '';
  } else {
    const range = presetRange(preset);
    startDate = range.startDate;
    endDate = range.endDate;
  }

  // URL values stay in browser-local time for readable links and datetime inputs.
  const urlFilters: OperationFiltersState = {
    state: (searchParams.get('state') as OperationFiltersState['state']) || 'ALL',
    endpoint: searchParams.get('endpoint') || 'ALL',
    profile: searchParams.get('profile') || 'ALL',
    searchQuery: searchParams.get('q') || '',
    startDate,
    endDate,
  };
  // API boundaries are explicit UTC instants, independent of server/container TZ.
  const apiFilters: OperationFiltersState = {
    ...urlFilters,
    startDate: toApiDate(startDate),
    endDate: toApiDate(endDate),
  };

  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(searchParams.get('page_size')))
    ? Number(searchParams.get('page_size'))
    : DEFAULT_PAGE_SIZE;

  // Global filter metadata is fetched once. The paginated list is loaded only
  // while Requests is visible, so Overview/Cost do not pay for count/page SQL.
  const {
    data: filterOptions,
    error: filterOptionsError,
    retry: retryFilterOptions,
  } = useOperationFilterOptions();
  const { data, loading, error, isAutoRefreshing, retry } = useOperationsList({
    filters: apiFilters,
    page,
    pageSize,
    enabled: tab === 'requests',
    pollingEnabled: tab === 'requests',
  });

  const updateURL = useCallback((opts: {
    tab?: OperationsTab;
    state?: string;
    endpoint?: string;
    profile?: string;
    q?: string;
    preset?: TimePreset;
    customStart?: string;
    customEnd?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    const nextTab = opts.tab ?? tab;
    const nextState = opts.state ?? urlFilters.state;
    const nextEndpoint = opts.endpoint ?? urlFilters.endpoint;
    const nextProfile = opts.profile ?? urlFilters.profile;
    const nextQuery = opts.q ?? urlFilters.searchQuery;
    const nextPreset = opts.preset ?? preset;
    const nextPage = opts.page ?? page;
    const nextPageSize = opts.pageSize ?? pageSize;

    if (nextTab !== 'overview') params.set('tab', nextTab);
    // state and q are Requests-local; leaving the tab removes them from URL.
    if (nextTab === 'requests' && nextState !== 'ALL') params.set('state', nextState);
    if (nextTab === 'requests' && nextQuery) params.set('q', nextQuery);
    if (nextEndpoint !== 'ALL') params.set('endpoint', nextEndpoint);
    if (nextProfile !== 'ALL') params.set('profile', nextProfile);

    if (nextPreset === 'custom') {
      params.set('range', 'custom');
      const customStart = opts.customStart ?? (preset === 'custom' ? startDate : '');
      const customEnd = opts.customEnd ?? (preset === 'custom' ? endDate : '');
      if (customStart) params.set('start_date', customStart);
      if (customEnd) params.set('end_date', customEnd);
    } else if (nextPreset !== DEFAULT_TIME_PRESET) {
      params.set('range', nextPreset);
    }

    if (nextTab === 'requests' && nextPage > 1) params.set('page', String(nextPage));
    if (nextTab === 'requests' && nextPageSize !== DEFAULT_PAGE_SIZE) params.set('page_size', String(nextPageSize));

    const queryString = params.toString();
    router.replace(queryString ? `/operations?${queryString}` : '/operations', { scroll: false });
  }, [router, tab, urlFilters.state, urlFilters.endpoint, urlFilters.profile, urlFilters.searchQuery, preset, page, pageSize, startDate, endDate]);

  const handleTabChange = useCallback((nextTab: OperationsTab) => {
    updateURL({ tab: nextTab, page: 1 });
  }, [updateURL]);
  const handleRequestFilterChange = useCallback((filters: OperationFiltersState) => {
    updateURL({ tab: 'requests', state: filters.state, page: 1 });
  }, [updateURL]);
  const handleClearRequestFilter = useCallback(() => {
    updateURL({ tab: 'requests', state: 'ALL', page: 1 });
  }, [updateURL]);
  const handleGlobalFilterChange = useCallback((filters: OperationFiltersState) => {
    updateURL({ endpoint: filters.endpoint, profile: filters.profile, page: 1 });
  }, [updateURL]);
  const handleClearGlobalFilters = useCallback(() => {
    updateURL({ endpoint: 'ALL', profile: 'ALL', page: 1 });
  }, [updateURL]);
  const handleResetAll = useCallback(() => {
    updateURL({ state: 'ALL', endpoint: 'ALL', profile: 'ALL', q: '', preset: DEFAULT_TIME_PRESET, page: 1 });
  }, [updateURL]);
  const handlePageChange = useCallback((newPage: number) => updateURL({ page: newPage }), [updateURL]);
  const handlePageSizeChange = useCallback((newSize: number) => updateURL({ pageSize: newSize, page: 1 }), [updateURL]);
  const handleSelectState = useCallback((state: OperationFiltersState['state']) => {
    updateURL({ tab: 'requests', state, q: '', page: 1 });
  }, [updateURL]);
  const handleSelectPreset = useCallback((nextPreset: Exclude<TimePreset, 'custom'>) => {
    updateURL({ preset: nextPreset, page: 1 });
  }, [updateURL]);
  const handleApplyCustom = useCallback((start: string, end: string) => {
    updateURL({ preset: 'custom', customStart: start, customEnd: end, page: 1 });
  }, [updateURL]);
  const drillToEndpoint = useCallback((endpoint: string) => {
    updateURL({ tab: 'requests', endpoint, state: 'ALL', q: '', page: 1 });
  }, [updateURL]);
  const drillToProfile = useCallback((profile: string) => {
    updateURL({ tab: 'requests', profile, state: 'ALL', q: '', page: 1 });
  }, [updateURL]);

  const handleSearchSubmit = useCallback(async (query: string): Promise<string | null> => {
    const trimmed = query.trim();
    if (!trimmed) {
      updateURL({ q: '', page: 1 });
      return null;
    }

    if (UUID_PATTERN.test(trimmed)) {
      try {
        const params = new URLSearchParams({
          q: trimmed,
          page: '1',
          page_size: '1',
          include_filter_options: '0',
        });
        const response = await fetch(`/api/internal/operations?${params.toString()}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return body.error || `Không thể kiểm tra Operation ID (HTTP ${response.status})`;
        const exact = Array.isArray(body.operations)
          ? body.operations.find((operation: { id?: string }) => operation.id?.toLowerCase() === trimmed.toLowerCase())
          : null;
        if (!exact) return 'Không tìm thấy Operation ID trong phạm vi bạn được phép xem.';
        router.push(`/operations/${trimmed}`);
        return null;
      } catch {
        return 'Không thể kết nối để kiểm tra Operation ID. Vui lòng thử lại.';
      }
    }

    updateURL({ tab: 'requests', state: 'ALL', q: trimmed, page: 1 });
    return null;
  }, [router, updateURL]);

  const handleSearchClear = useCallback(() => updateURL({ q: '', page: 1 }), [updateURL]);

  const operations = data?.operations ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const filterEndpoints = filterOptions?.endpoints ?? [];
  const filterProfiles = filterOptions?.profiles ?? [];
  const hasNoProfile = filterOptions?.hasNoProfile ?? false;
  const hasAnyFilter = urlFilters.state !== 'ALL'
    || urlFilters.endpoint !== 'ALL'
    || urlFilters.profile !== 'ALL'
    || urlFilters.searchQuery !== ''
    || preset !== DEFAULT_TIME_PRESET;
  const rangeLabel = timeRangeLabel(preset, startDate, endDate);

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Giám sát và troubleshoot các pipeline requests.</p>
          <Link href="/operations/dashboard" className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80">
            <Gauge className="w-3.5 h-3.5" aria-hidden="true" />
            Xem Dashboard nghiệp vụ
          </Link>
        </div>
        <SearchBox
          initialValue={urlFilters.searchQuery}
          committedQuery={tab === 'requests' ? urlFilters.searchQuery : ''}
          resultCount={tab === 'requests' ? total : null}
          resultLoading={tab === 'requests' && !!urlFilters.searchQuery && loading}
          onSubmit={handleSearchSubmit}
          onClear={handleSearchClear}
        />
      </header>

      <section className="rounded-xl border border-border bg-card p-3 sm:p-4 mb-4 space-y-3" aria-label="Bộ lọc chung cho Operations">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Dữ liệu: <span className="font-semibold text-foreground/90">{rangeLabel}</span>
          </p>
          <TimeRangeControl
            preset={preset}
            startDate={startDate}
            endDate={endDate}
            onSelectPreset={handleSelectPreset}
            onApplyCustom={handleApplyCustom}
          />
        </div>
        <div className="border-t border-border/60 pt-3">
          <GlobalOperationFilters
            filters={urlFilters}
            onFilterChange={handleGlobalFilterChange}
            onClearFilters={handleClearGlobalFilters}
            endpoints={filterEndpoints}
            profiles={filterProfiles}
            hasNoProfile={hasNoProfile}
          />
          {filterOptionsError && (
            <div className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400" role="alert">
              <span>Không thể tải danh sách endpoint/profile.</span>
              <button type="button" onClick={retryFilterOptions} className="font-medium text-primary hover:text-primary/80">Thử lại</button>
            </div>
          )}
        </div>
      </section>

      <StuckAlertBanner />
      <OperationsTabs active={tab} onChange={handleTabChange} />

      {tab === 'overview' && (
        <div role="tabpanel" id="ops-tabpanel-overview" aria-labelledby="ops-tab-overview" tabIndex={0} className="focus:outline-none">
          <OverviewTab
            filters={apiFilters}
            isToday={preset === 'today'}
            onSelectState={handleSelectState}
            onDrillEndpoint={drillToEndpoint}
            onDrillProfile={drillToProfile}
          />
        </div>
      )}

      {tab === 'requests' && (
        <div role="tabpanel" id="ops-tabpanel-requests" aria-labelledby="ops-tab-requests" tabIndex={0} className="focus:outline-none">
          <RequestsTab
            filters={apiFilters}
            onFilterChange={handleRequestFilterChange}
            onClearFilters={handleClearRequestFilter}
            onResetAll={handleResetAll}
            operations={operations}
            loading={loading}
            error={error}
            onRetry={retry}
            isAutoRefreshing={isAutoRefreshing}
            total={total}
            hasAnyFilter={hasAnyFilter}
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      )}

      {tab === 'cost' && (
        <div role="tabpanel" id="ops-tabpanel-cost" aria-labelledby="ops-tab-cost" tabIndex={0} className="focus:outline-none">
          <CostBreakdownTab filters={apiFilters} onDrillProfile={drillToProfile} onDrillEndpoint={drillToEndpoint} />
        </div>
      )}
    </div>
  );
}

interface SearchBoxProps {
  initialValue: string;
  committedQuery: string;
  resultCount: number | null;
  resultLoading: boolean;
  onSubmit: (query: string) => Promise<string | null>;
  onClear: () => void;
}

function SearchBox({
  initialValue, committedQuery, resultCount, resultLoading, onSubmit, onClear,
}: SearchBoxProps) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialValue);
    setMessage(null);
  }, [initialValue]);

  const trimmed = value.trim();
  const uuidDetected = UUID_PATTERN.test(trimmed);
  const committedTextSearch = !!committedQuery && trimmed === committedQuery && !uuidDetected;

  const submit = async () => {
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setMessage(null);
    const errorMessage = await onSubmit(trimmed);
    setMessage(errorMessage);
    setSubmitting(false);
  };

  const clear = () => {
    setValue('');
    setMessage(null);
    onClear();
  };

  let statusText: string | null = message;
  let statusTone = message ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';
  if (!statusText && uuidDetected) statusText = 'Đã nhận diện Operation ID — nhấn Enter hoặc Tìm để mở.';
  if (!statusText && committedTextSearch && resultLoading) statusText = 'Đang tìm kiếm...';
  if (!statusText && committedTextSearch && !resultLoading && resultCount === 0) {
    statusText = 'Không tìm thấy operation theo Reference, Correlation ID hoặc Idempotency Key.';
    statusTone = 'text-red-600 dark:text-red-400';
  }
  if (!statusText && committedTextSearch && !resultLoading && resultCount !== null && resultCount > 0) {
    statusText = `${resultCount.toLocaleString('en-US')} kết quả phù hợp.`;
  }

  return (
    <div className="w-full sm:w-[30rem]">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          value={value}
          onChange={(event) => { setValue(event.target.value); setMessage(null); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              clear();
            }
          }}
          placeholder="Operation ID, Reference, Correlation ID..."
          className="w-full h-10 rounded-xl border border-border bg-card pl-9 pr-24 text-sm text-foreground placeholder:text-muted-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 hover:border-border/80"
          spellCheck={false}
          aria-label="Tìm kiếm operations"
          aria-describedby="operations-search-status"
        />
        {value && (
          <button type="button" onClick={clear} className="absolute right-[4.5rem] top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Xóa tìm kiếm">
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!trimmed || submitting}
          className="absolute right-1 top-1 h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Tìm'}
        </button>
      </div>
      <p id="operations-search-status" className={`mt-1 min-h-4 text-[11px] ${statusTone}`} aria-live="polite">
        {statusText}
      </p>
    </div>
  );
}
