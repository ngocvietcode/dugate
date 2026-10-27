// app/operations/hooks/useStuckOperations.ts
// Polls the stuck-operations endpoint for the global alert banner.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StuckResponse } from '../types';

const POLL_INTERVAL = 60_000;

interface UseStuckOperationsReturn {
  data: StuckResponse | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useStuckOperations(): UseStuckOperationsReturn {
  const [data, setData] = useState<StuckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let disposed = false;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;

    const fetchStuck = async () => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      setError(null);
      try {
        const res = await fetch('/api/internal/operations/stuck', { signal: controller.signal });
        if (!res.ok) throw new Error(`Không thể kiểm tra request treo (HTTP ${res.status})`);
        setData(await res.json());
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Không thể kiểm tra request treo');
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    };

    const scheduleNext = () => {
      if (pollTimeout) clearTimeout(pollTimeout);
      if (disposed) return;
      pollTimeout = setTimeout(async () => {
        if (document.visibilityState === 'visible') await fetchStuck();
        scheduleNext();
      }, POLL_INTERVAL);
    };

    const handleVisibility = () => {
      if (pollTimeout) clearTimeout(pollTimeout);
      pollTimeout = null;
      if (document.visibilityState !== 'visible') return;
      void fetchStuck().finally(scheduleNext);
    };

    setLoading(true);
    void fetchStuck().finally(scheduleNext);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      if (pollTimeout) clearTimeout(pollTimeout);
      document.removeEventListener('visibilitychange', handleVisibility);
      abortRef.current?.abort();
    };
  }, [refreshKey]);

  return { data, loading, error, retry };
}
