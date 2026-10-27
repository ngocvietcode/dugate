// Fetch the Requests tab list with bounded pagination and non-overlapping polling.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationFiltersState, OperationListItemView } from '../types';

const AUTO_REFRESH_INTERVAL = 5_000;

export interface OperationsListData {
  operations: OperationListItemView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface UseOperationsListOptions {
  filters: OperationFiltersState;
  page: number;
  pageSize: number;
  enabled?: boolean;
  pollingEnabled?: boolean;
}

interface UseOperationsListReturn {
  data: OperationsListData | null;
  loading: boolean;
  error: string | null;
  isAutoRefreshing: boolean;
  retry: () => void;
}

function buildQueryString(filters: OperationFiltersState, page: number, pageSize: number): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  params.set('include_filter_options', '0');
  if (filters.state !== 'ALL') params.set('state', filters.state);
  if (filters.endpoint !== 'ALL') params.set('endpoint', filters.endpoint);
  if (filters.profile !== 'ALL') params.set('profile', filters.profile);
  if (filters.searchQuery.trim()) params.set('q', filters.searchQuery.trim());
  if (filters.startDate) params.set('start_date', filters.startDate);
  if (filters.endDate) params.set('end_date', filters.endDate);
  return params.toString();
}

export function useOperationsList({
  filters, page, pageSize, enabled = true, pollingEnabled = true,
}: UseOperationsListOptions): UseOperationsListReturn {
  const [data, setData] = useState<OperationsListData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchPageRef = useRef<(isPolling?: boolean) => Promise<void>>(async () => {});
  const hasActiveRef = useRef(false);
  const paramsRef = useRef({ filters, page, pageSize, enabled, pollingEnabled });
  paramsRef.current = { filters, page, pageSize, enabled, pollingEnabled };

  const stopAutoRefresh = useCallback(() => {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    pollTimeoutRef.current = null;
    setIsAutoRefreshing(false);
  }, []);

  const scheduleAutoRefresh = useCallback(() => {
    stopAutoRefresh();
    const current = paramsRef.current;
    if (!current.enabled || !current.pollingEnabled || !hasActiveRef.current) return;
    if (document.visibilityState !== 'visible') return;
    setIsAutoRefreshing(true);
    pollTimeoutRef.current = setTimeout(() => {
      void fetchPageRef.current(true);
    }, AUTO_REFRESH_INTERVAL);
  }, [stopAutoRefresh]);

  const fetchPage = useCallback(async (isPolling = false) => {
    if (!isPolling) {
      stopAutoRefresh();
      setLoading(true);
      setError(null);
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const current = paramsRef.current;
      const query = buildQueryString(current.filters, current.page, current.pageSize);
      const response = await fetch(`/api/internal/operations?${query}`, {
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Error ${response.status}`);

      const nextData: OperationsListData = {
        operations: body.operations ?? [],
        total: body.total ?? 0,
        page: body.page ?? 1,
        pageSize: body.page_size ?? current.pageSize,
        totalPages: body.total_pages ?? 1,
      };
      setData(nextData);
      setError(null);
      hasActiveRef.current = nextData.operations.some(
        (operation) => operation.state === 'RUNNING' || operation.state === 'PENDING',
      );
      scheduleAutoRefresh();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách operations');
      scheduleAutoRefresh();
    } finally {
      if (!isPolling && abortRef.current === controller) setLoading(false);
    }
  }, [scheduleAutoRefresh, stopAutoRefresh]);
  fetchPageRef.current = fetchPage;

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') scheduleAutoRefresh();
      else stopAutoRefresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [scheduleAutoRefresh, stopAutoRefresh]);

  useEffect(() => {
    stopAutoRefresh();
    abortRef.current?.abort();
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchPage(false);
    return () => abortRef.current?.abort();
  }, [
    enabled, pollingEnabled, filters.state, filters.endpoint, filters.profile,
    filters.searchQuery, filters.startDate, filters.endDate, page, pageSize,
    fetchPage, stopAutoRefresh,
  ]);

  useEffect(() => () => {
    stopAutoRefresh();
    abortRef.current?.abort();
  }, [stopAutoRefresh]);

  const retry = useCallback(() => { void fetchPage(false); }, [fetchPage]);
  return { data, loading, error, isAutoRefreshing, retry };
}
