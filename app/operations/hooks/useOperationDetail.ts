// app/operations/hooks/useOperationDetail.ts
// Custom hook: Fetch operation detail with polling for active states.

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import type { OperationDetail, OperationState } from '../types';

const POLL_INTERVAL = 2000;

/** States that require active polling */
const ACTIVE_STATES: OperationState[] = ['RUNNING', 'PENDING'];

/** States that indicate the operation is done (stop polling) */
const TERMINAL_STATES: OperationState[] = [
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'WAITING_USER_INPUT',
];

function isActiveState(state: OperationState): boolean {
  return ACTIVE_STATES.includes(state);
}

interface UseOperationDetailReturn {
  operation: OperationDetail | null;
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
  pollError: string | null;
  refresh: () => Promise<void>;
  isPolling: boolean;
}

export function useOperationDetail(id: string): UseOperationDetailReturn {
  const [operation, setOperation] = useState<OperationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStateRef = useRef<OperationState | null>(null);
  // Client-side log accumulation for progressMessage
  const prevMsgRef = useRef<string>('');
  const logLinesRef = useRef<string[]>([]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    setIsPolling(true);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/internal/operations/${id}`);
        if (!res.ok) {
          setPollError('Mất kết nối tạm. Hệ thống sẽ tự thử lại.');
          return;
        }

        const data: OperationDetail = await res.json();
        setPollError(null);
        const prevState = prevStateRef.current;

        // Prefer the bounded server history so completed and reopened operations retain progress.
        const historyLines = (data.progressHistory ?? []).map((entry) => {
          const timestamp = new Date(entry.t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return `[${timestamp}] ${entry.message}`;
        });
        if (historyLines.length === 0 && data.progressMessage && data.progressMessage !== prevMsgRef.current) {
          prevMsgRef.current = data.progressMessage;
          logLinesRef.current.push(data.progressMessage);
          if (logLinesRef.current.length > 80) logLinesRef.current = logLinesRef.current.slice(-80);
        }
        const displayData: OperationDetail = {
          ...data,
          progressMessage: historyLines.length > 0 ? historyLines.join('\n') : (logLinesRef.current.join('\n') || data.progressMessage),
        };

        setOperation(displayData);
        prevStateRef.current = data.state;

        // Toast notification on state transition from RUNNING → terminal
        if (
          prevState &&
          isActiveState(prevState) &&
          TERMINAL_STATES.includes(data.state)
        ) {
          if (data.state === 'SUCCEEDED') {
            toast.success('Operation hoàn thành thành công');
          } else if (data.state === 'FAILED') {
            toast.error(`Operation thất bại: ${data.errorMessage || 'Unknown error'}`);
          } else if (data.state === 'CANCELLED') {
            toast.info('Operation đã bị hủy');
          } else if (data.state === 'WAITING_USER_INPUT') {
            toast.info('Operation đang chờ xác nhận từ người dùng');
          }
        }

        // Stop polling when state is no longer active
        if (!isActiveState(data.state)) {
          stopPolling();
        }
      } catch {
        setPollError('Mất kết nối tạm. Hệ thống sẽ tự thử lại.');
      }
    }, POLL_INTERVAL);
  }, [id, stopPolling]);

  /** Fetch operation detail */
  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    stopPolling();

    try {
      const res = await fetch(`/api/internal/operations/${id}`);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorStatus(res.status);
        throw new Error(body.error || `Error ${res.status}`);
      }

      const data: OperationDetail = await res.json();
      setOperation({
        ...data,
        progressMessage: (data.progressHistory ?? []).length > 0
          ? (data.progressHistory ?? []).map((entry) => `[${new Date(entry.t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ${entry.message}`).join('\n')
          : data.progressMessage,
      });
      prevStateRef.current = data.state;

      // Start polling if operation is in an active state
      if (isActiveState(data.state)) {
        startPolling();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [id, stopPolling, startPolling]);

  /** Manual refresh */
  const refresh = useCallback(async () => {
    await fetchDetail();
  }, [fetchDetail]);

  // Fetch on mount and when id changes
  useEffect(() => {
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return {
    operation,
    loading,
    error,
    errorStatus,
    pollError,
    refresh,
    isPolling,
  };
}
