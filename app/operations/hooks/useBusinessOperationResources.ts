'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { BusinessOperationProfileFilterOption } from '../lib/business-filters';
import {
  INITIAL_BUSINESS_OPERATION_DETAIL_STATE,
  apiProblemMessage,
  businessOperationDetailReducer,
} from '../lib/business-page';
import type { BusinessOperationDetailResponse } from '../types';

export interface BusinessOperationFilterOptionsData {
  profiles: BusinessOperationProfileFilterOption[];
  operationTypes: string[];
}

export interface UseBusinessOperationFilterOptionsReturn {
  data: BusinessOperationFilterOptionsData;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useBusinessOperationFilterOptions(): UseBusinessOperationFilterOptionsReturn {
  const [data, setData] = useState<BusinessOperationFilterOptionsData>({
    profiles: [],
    operationTypes: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch('/api/internal/business-operations/filter-options', {
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(apiProblemMessage(
            body,
            `Không thể tải bộ lọc Business Operations (HTTP ${response.status})`,
          ));
        }
        const options = body as {
          profiles?: Array<{ id: string; name: string }>;
          operationTypes?: string[];
          hasInternalScope?: boolean;
        };
        setData({
          profiles: [
            ...(Array.isArray(options.profiles) ? options.profiles : []),
            ...(options.hasInternalScope ? [{ id: null, name: 'Nội bộ' }] : []),
          ],
          operationTypes: Array.isArray(options.operationTypes) ? options.operationTypes : [],
        });
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(requestError instanceof Error
          ? requestError.message
          : 'Không thể tải bộ lọc Business Operations');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [refreshKey]);

  return {
    data,
    loading,
    error,
    retry: useCallback(() => setRefreshKey((current) => current + 1), []),
  };
}

export interface UseBusinessOperationDetailReturn {
  token: string | null;
  page: number;
  response: BusinessOperationDetailResponse | null;
  loading: boolean;
  error: string | null;
  open: (token: string) => void;
  close: () => void;
  changePage: (page: number) => void;
  retry: () => void;
}

export function useBusinessOperationDetail(): UseBusinessOperationDetailReturn {
  const [state, dispatch] = useReducer(
    businessOperationDetailReducer,
    INITIAL_BUSINESS_OPERATION_DETAIL_STATE,
  );
  const stateRef = useRef(state);
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  stateRef.current = state;

  const load = useCallback((token: string, page: number) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const sequence = ++sequenceRef.current;
    dispatch({ type: 'request-started', token, page, sequence });

    void (async () => {
      try {
        const params = new URLSearchParams({ page: String(page) });
        const response = await fetch(
          `/api/internal/business-operations/${encodeURIComponent(token)}/requests?${params.toString()}`,
          { signal: controller.signal },
        );
        const body: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(apiProblemMessage(
            body,
            `Không thể tải chi tiết Business Operation (HTTP ${response.status})`,
          ));
        }
        dispatch({
          type: 'request-succeeded',
          token,
          sequence,
          response: body as BusinessOperationDetailResponse,
        });
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        dispatch({
          type: 'request-failed',
          token,
          sequence,
          error: requestError instanceof Error
            ? requestError.message
            : 'Không thể tải chi tiết Business Operation',
        });
      }
    })();
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    sequenceRef.current += 1;
    dispatch({ type: 'closed' });
  }, []);

  return {
    token: state.token,
    page: state.page,
    response: state.response,
    loading: state.loading,
    error: state.error,
    open: useCallback((token: string) => load(token, 1), [load]),
    close,
    changePage: useCallback((page: number) => {
      const token = stateRef.current.token;
      if (token !== null && Number.isSafeInteger(page) && page >= 1) load(token, page);
    }, [load]),
    retry: useCallback(() => {
      const current = stateRef.current;
      if (current.token !== null) load(current.token, current.page);
    }, [load]),
  };
}
