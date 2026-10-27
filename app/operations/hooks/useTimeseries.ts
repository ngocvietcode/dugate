// app/operations/hooks/useTimeseries.ts
// Fetches time-bucketed counts for the Overview trend chart.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationFiltersState, TimeseriesPoint, TimeseriesResponse } from '../types';

interface UseTimeseriesOptions {
  filters: OperationFiltersState;
  enabled?: boolean;
}

interface UseTimeseriesReturn {
  points: TimeseriesPoint[];
  bucket: 'hour' | 'day';
  truncated: boolean;
  coverageStart: string | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useTimeseries({ filters, enabled = true }: UseTimeseriesOptions): UseTimeseriesReturn {
  const [points, setPoints] = useState<TimeseriesPoint[]>([]);
  const [bucket, setBucket] = useState<'hour' | 'day'>('day');
  const [truncated, setTruncated] = useState(false);
  const [coverageStart, setCoverageStart] = useState<string | null>(null);
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
        if (filters.endpoint !== 'ALL') params.set('endpoint', filters.endpoint);
        if (filters.profile !== 'ALL') params.set('profile', filters.profile);
        if (filters.startDate) params.set('start_date', filters.startDate);
        if (filters.endDate) params.set('end_date', filters.endDate);

        const res = await fetch(`/api/internal/operations/stats/timeseries?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Không thể tải biểu đồ (HTTP ${res.status})`);
        const json = await res.json() as TimeseriesResponse;
        setPoints(json.points ?? []);
        setBucket(json.bucket ?? 'day');
        setTruncated(json.truncated ?? false);
        setCoverageStart(json.coverageStart ?? null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Không thể tải biểu đồ');
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    };

    fetchData();
    return () => controller.abort();
  }, [enabled, filters.endpoint, filters.profile, filters.startDate, filters.endDate, refreshKey]);

  return { points, bucket, truncated, coverageStart, loading, error, retry };
}
