// app/tracing-portal/hooks/useTracingPolling.ts
// Custom hook: Submit tracing-portal workflow + poll for OCR results.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { OperationResponse, ProcessingStatus, TracingResult } from '../types';

interface UseTracingPollingOptions {
  onComplete: (result: TracingResult) => void;
  onError: (message: string) => void;
  onProgress: (percent: number, message: string) => void;
}

interface UseTracingPollingReturn {
  status: ProcessingStatus;
  progressPercent: number;
  progressMessage: string;
  operationId: string | null;
  elapsedSeconds: number;
  submit: (files: File[], apiKey: string) => Promise<void>;
  reset: () => void;
}

export function useTracingPolling(options: UseTracingPollingOptions): UseTracingPollingReturn {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [operationId, setOperationId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, []);

  const startPolling = useCallback((opId: string) => {
    const POLL_INTERVAL_MS = 3000;
    const TIMEOUT_MS = 10 * 60 * 1000;

    pollIntervalRef.current = setInterval(async () => {
      if (Date.now() - startTimeRef.current > TIMEOUT_MS) {
        stopPolling();
        setStatus('error');
        optionsRef.current.onError('Timeout: Xử lý quá 10 phút. Vui lòng kiểm tra lại trên trang Operations.');
        return;
      }

      try {
        const res = await fetch(`/api/v1/operations/${opId}`);
        if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
        const data: OperationResponse = await res.json();

        const percent = data.metadata?.progress_percent ?? 0;
        const message = data.metadata?.progress_message ?? 'Đang xử lý...';
        setProgressPercent(percent);
        setProgressMessage(message);
        optionsRef.current.onProgress(percent, message);

        if (data.done) {
          stopPolling();
          if (data.metadata?.state === 'SUCCEEDED' && data.result?.extracted_data) {
            setStatus('done');
            optionsRef.current.onComplete(data.result.extracted_data);
          } else if (data.metadata?.state === 'FAILED' || data.error) {
            setStatus('error');
            optionsRef.current.onError(data.error?.message ?? 'Xử lý thất bại. Vui lòng thử lại.');
          }
        }
      } catch (err) {
        console.error('[useTracingPolling] Poll error:', err);
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const submit = useCallback(async (files: File[], apiKey: string) => {
    setStatus('uploading');
    setProgressPercent(0);
    setProgressMessage('Đang upload...');
    setElapsedSeconds(0);

    try {
      const formData = new FormData();
      formData.append('process', 'tracing-portal');
      files.forEach((file) => formData.append('files[]', file));

      const res = await fetch('/api/v2/docs/workflows', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: formData,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error?.message ?? errBody?.detail ?? `Upload failed: ${res.status}`);
      }

      const data = await res.json();
      const opId = (data.name ?? '').replace('operations/', '');
      if (!opId) throw new Error('Không nhận được operation ID từ server.');

      setOperationId(opId);
      setStatus('processing');
      setProgressMessage('Đang xử lý OCR...');
      startTimer();
      startPolling(opId);
    } catch (err) {
      setStatus('error');
      optionsRef.current.onError(err instanceof Error ? err.message : 'Lỗi không xác định khi upload.');
    }
  }, [startPolling, startTimer]);

  const reset = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setProgressPercent(0);
    setProgressMessage('');
    setOperationId(null);
    setElapsedSeconds(0);
  }, [stopPolling]);

  return { status, progressPercent, progressMessage, operationId, elapsedSeconds, submit, reset };
}
