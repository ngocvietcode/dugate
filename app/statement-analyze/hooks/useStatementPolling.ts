// app/statement-analyze/hooks/useStatementPolling.ts
// Custom hook: Submit statement-analyze workflow + poll for results.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { UploadedFile } from '../types';

interface UseStatementPollingOptions {
  onStepReveal: (stepIdx: number, backendStep: Record<string, unknown>) => void;
  onComplete: (extractedData: unknown) => void;
  onError: (stepIdx: number, message: string) => void;
  onProgress: (stepIdx: number, percent: number, message?: string) => void;
}

const TOTAL_STEPS = 6;

export function useStatementPolling(options: UseStatementPollingOptions) {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedCountRef = useRef(0);
  const prevMessageRef = useRef<string>('');
  const logRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback((opId: string) => {
    setOperationId(opId);
    setIsPolling(true);
    stopPolling();

    const startTime = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max

    pollIntervalRef.current = setInterval(async () => {
      if (Date.now() - startTime > TIMEOUT_MS) {
        stopPolling();
        options.onError(0, 'Timeout: Workflow chạy quá 10 phút. Vui lòng kiểm tra lại trên trang Operations.');
        return;
      }

      try {
        // Poll bằng session (cookie tự gửi). Operation gắn createdByUserId = user
        // hiện tại nên chủ sở hữu xem được; không cần gửi API key của profile.
        const pollRes = await fetch(`/api/v1/operations/${opId}`);
        const opData = await pollRes.json();

        const stepsRes: Array<Record<string, unknown>> =
          opData.metadata?.pipeline_steps || opData.result?.pipeline_steps || [];
        const isDone = opData.done === true;
        const hasFailed = opData.metadata?.state === 'FAILED';

        // Reveal new steps
        if (stepsRes.length > revealedCountRef.current) {
          const newSteps = stepsRes.slice(revealedCountRef.current);
          for (const step of newSteps) {
            options.onStepReveal(revealedCountRef.current, step);
            revealedCountRef.current++;
          }
        }

        // Update progress — accumulate messages client-side for running log
        if (!isDone && !hasFailed && revealedCountRef.current < TOTAL_STEPS) {
          const pct = Math.max(5, opData.metadata?.progress_percent ?? 0);
          const msg: string | undefined = opData.metadata?.progress_message ?? undefined;
          if (msg && msg !== prevMessageRef.current) {
            prevMessageRef.current = msg;
            const timestamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            logRef.current.push(`[${timestamp}] ${msg}`);
            if (logRef.current.length > 80) logRef.current = logRef.current.slice(-80);
          }
          const accumulatedLog = logRef.current.length > 0 ? logRef.current.join('\n') : undefined;
          options.onProgress(revealedCountRef.current, pct, accumulatedLog);
        }

        if (isDone || hasFailed) {
          stopPolling();
          if (hasFailed) {
            const failedIdx = opData.error?.failed_step ?? revealedCountRef.current;
            const errorMsg = opData.error?.message || 'Workflow failed';
            options.onError(failedIdx, errorMsg);
          } else {
            const extracted = opData.result?.extracted_data || opData.metadata?.extracted_data;
            options.onComplete(extracted);
          }
        }
      } catch (pollErr) {
        console.error('Polling error:', pollErr);
      }
    }, 2000);
  }, [options, stopPolling]);

  const submitWorkflow = useCallback(async (
    _files: UploadedFile[],
    realFiles: File[],
    apiKeyId?: string,
    extraInstruction?: string,
  ) => {
    revealedCountRef.current = 0;
    prevMessageRef.current = '';
    logRef.current = [];

    const formData = new FormData();
    formData.append('process', 'statement-analyze');
    formData.append('allowed_extensions', '.pdf');

    const instruction = (extraInstruction ?? '').trim();
    if (instruction) formData.append('extra_instruction', instruction);

    if (realFiles.length > 0) {
      realFiles.forEach(f => formData.append('files[]', f));
    } else {
      throw new Error('Cần upload ít nhất 1 file PDF sao kê để chạy statement-analyze.');
    }

    const headers: Record<string, string> = {};
    if (apiKeyId) headers['X-API-Key'] = apiKeyId;

    const res = await fetch('/api/v1/docs/workflows', { method: 'POST', body: formData, headers });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || `API Error ${res.status}`);
    }

    const opId = data.name?.replace('operations/', '') || data.id;
    if (!opId) throw new Error('No operation ID returned');

    startPolling(opId);
    return opId;
  }, [startPolling]);

  return {
    operationId,
    isPolling,
    submitWorkflow,
    stopPolling,
  };
}
