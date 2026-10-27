'use client';

import { Suspense, useCallback, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import BusinessOperationsDashboardView from './components/BusinessOperationsDashboardView';
import { type BusinessTrendDrillDown } from './components/TrendChart';
import {
  clientFilterFromAppliedFilter,
  useBusinessOperationsDashboard,
} from './hooks/useBusinessOperationsDashboard';
import {
  useBusinessOperationDetail,
  useBusinessOperationFilterOptions,
} from './hooks/useBusinessOperationResources';
import {
  createBusinessOperationsTrendDrillDown,
  serializeBusinessOperationsFilter,
  type BusinessOperationsTrendDrillDownBucket,
} from './lib/business-filters';
import { parseBusinessOperationsPageFilter } from './lib/business-page';
import type { BusinessOperationSort, BusinessOperationsFilterState } from './types';

export default function OperationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) router.push('/');
  }, [session, status, router]);

  if (status === 'loading' || !session) return <PageLoading />;

  return (
    <Suspense fallback={<PageLoading />}>
      <OperationsContent />
    </Suspense>
  );
}

function PageLoading() {
  return (
    <div className="min-h-[60vh] flex justify-center items-center" aria-label="Đang tải Operations" aria-busy="true">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function OperationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilterRef = useRef<BusinessOperationsFilterState | null>(null);
  if (initialFilterRef.current === null) {
    initialFilterRef.current = parseBusinessOperationsPageFilter(searchParams);
  }

  const dashboard = useBusinessOperationsDashboard({ initialFilter: initialFilterRef.current });
  const filterOptions = useBusinessOperationFilterOptions();
  const detail = useBusinessOperationDetail();
  const pendingDrillDownRef = useRef<BusinessOperationsTrendDrillDownBucket | undefined>(undefined);

  // URL follows the server-confirmed snapshot only. Failed/forbidden filter requests
  // retain the prior URL together with the prior data/filter/query timestamp.
  useEffect(() => {
    if (dashboard.data === null) return;
    const params = serializeBusinessOperationsFilter(
      dashboard.data.appliedFilter,
      pendingDrillDownRef.current,
    );
    router.replace(`/operations/dashboard?${params.toString()}`, { scroll: false });
  }, [dashboard.data, router]);

  const requestFilter = useCallback((draft: BusinessOperationsFilterState) => {
    pendingDrillDownRef.current = undefined;
    detail.close();
    dashboard.setDraftFilter(draft);
    void dashboard.applyDraftFilter();
  }, [dashboard, detail]);

  const changePage = useCallback((page: number) => {
    if (dashboard.appliedFilter === null) return;
    const next = {
      ...clientFilterFromAppliedFilter(dashboard.appliedFilter),
      page,
    };
    dashboard.setDraftFilter(next);
    void dashboard.applyDraftFilter();
  }, [dashboard]);

  const changeSort = useCallback((sort: BusinessOperationSort) => {
    if (dashboard.appliedFilter === null) return;
    const next = { ...clientFilterFromAppliedFilter(dashboard.appliedFilter), sort, page: 1 };
    dashboard.setDraftFilter(next);
    void dashboard.applyDraftFilter();
  }, [dashboard]);

  const drillIntoTrend = useCallback((selection: BusinessTrendDrillDown) => {
    if (dashboard.appliedFilter === null) return;
    const drillDown = createBusinessOperationsTrendDrillDown(
      dashboard.appliedFilter,
      selection,
      selection.status,
    );
    pendingDrillDownRef.current = drillDown.bucket;
    detail.close();
    dashboard.setDraftFilter(clientFilterFromAppliedFilter(drillDown.filter));
    void dashboard.applyDraftFilter();
  }, [dashboard, detail]);

  return (
    <BusinessOperationsDashboardView
      data={dashboard.data}
      phase={dashboard.phase}
      draftFilter={dashboard.draftFilter}
      appliedFilter={dashboard.appliedFilter}
      initialFilter={initialFilterRef.current}
      error={dashboard.error}
      staleWarning={dashboard.staleWarning}
      filterOptions={filterOptions.data}
      filterOptionsLoading={filterOptions.loading}
      filterOptionsError={filterOptions.error}
      onRetryFilterOptions={filterOptions.retry}
      onDraftChange={dashboard.setDraftFilter}
      onRequestApply={requestFilter}
      onRetry={() => { void dashboard.retry(); }}
      onRefresh={() => { void dashboard.refresh(); }}
      onTrendDrillDown={drillIntoTrend}
      onListPageChange={changePage}
      onListSortChange={changeSort}
      detailToken={detail.token}
      detailResponse={detail.response}
      detailLoading={detail.loading}
      detailError={detail.error}
      onOpenDetail={detail.open}
      onCloseDetail={detail.close}
      onRetryDetail={detail.retry}
      onDetailPageChange={detail.changePage}
    />
  );
}
