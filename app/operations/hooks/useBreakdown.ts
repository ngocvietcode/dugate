// app/operations/hooks/useBreakdown.ts
// Fetches profile/endpoint breakdown aggregation for the given filters + time range.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BreakdownRow, OperationFiltersState } from '../types';

interface UseBreakdownOptions {
  groupBy: 'profile' | 'endpoint';
  filters: OperationFiltersState;
  enabled?: boolean;
}

interface UseBreakdownReturn {
  rows: BreakdownRow[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useBreakdown({ groupBy, filters, enabled = true }: UseBreakdownOptions): UseBreakdownReturn {
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        const params = new URLSearchParams();
        params.set('group_by', groupBy);
        if (filters.endpoint !== 'ALL') params.set('endpoint', filters.endpoint);
        if (filters.profile !== 'ALL') params.set('profile', filters.profile);
        if (filters.startDate) params.set('start_date', filters.startDate);
        if (filters.endDate) params.set('end_date', filters.endDate);

        const res = await fetch(`/api/internal/operations/stats/breakdown?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Không thể tải dữ liệu tổng hợp (HTTP ${res.status})`);
        const json = await res.json();
        setRows(json.rows ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu tổng hợp');
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    };

    fetchData();
    return () => controller.abort();
  }, [groupBy, enabled, filters.endpoint, filters.profile, filters.startDate, filters.endDate, refreshKey]);

  return { rows, loading, error, retry };
}
