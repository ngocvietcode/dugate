import { useCallback, useEffect, useRef, useState } from 'react';

export interface OperationFilterOptions {
  endpoints: string[];
  profiles: Array<{ id: string; name: string }>;
  hasNoProfile: boolean;
}

interface UseOperationFilterOptionsReturn {
  data: OperationFilterOptions | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useOperationFilterOptions(): UseOperationFilterOptionsReturn {
  const [data, setData] = useState<OperationFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const response = await fetch('/api/internal/operations/filter-options', {
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || `Không thể tải bộ lọc (HTTP ${response.status})`);
        }
        setData({
          endpoints: body.endpoints ?? [],
          profiles: body.profiles ?? [],
          hasNoProfile: body.has_no_profile ?? false,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Không thể tải bộ lọc Operations');
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    };

    void run();
    return () => controller.abort();
  }, [refreshKey]);

  return { data, loading, error, retry };
}
