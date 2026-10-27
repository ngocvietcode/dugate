// app/operations/hooks/useThroughput.ts
// Fetch throughput (requests received per bucket) for rate-limit sizing.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThroughputResponse, OperationFiltersState } from '../types';

interface UseThroughputOptions {
  filters: OperationFiltersState;
  bucket: 'minute' | 'hour';
  enabled?: boolean;
}

interface UseThroughputReturn {
  data: ThroughputResponse | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useThroughput({
  filters, bucket, enabled = true,
}: UseThroughputOptions): UseThroughputReturn {
  const [data, setData] = useState<ThroughputResponse | null>(null);
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

    const run = async () => {
      try {
        const params = new URLSearchParams();
        params.set('bucket', bucket);
        params.set('summary_only', 'true');
        if (filters.endpoint !== 'ALL') params.set('endpoint', filters.endpoint);
        if (filters.profile !== 'ALL') params.set('profile', filters.profile);
        if (filters.startDate) params.set('start_date', filters.startDate);
        if (filters.endDate) params.set('end_date', filters.endDate);

        const res = await fetch(`/api/internal/operations/stats/throughput?${params.toString()}`, {
          signal: controller.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Không thể tải throughput (HTTP ${res.status})`);
        setData(body);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Không thể tải throughput');
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    };

    run();
    return () => controller.abort();
  }, [enabled, bucket, filters.endpoint, filters.profile, filters.startDate, filters.endDate, refreshKey]);

  return { data, loading, error, retry };
}
