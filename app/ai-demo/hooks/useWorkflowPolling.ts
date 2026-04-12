// app/ai-demo/hooks/useWorkflowPolling.ts
// Custom hook: Submit workflow to real API + poll for results.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { PipelineStep, StepStatus, UploadedFile } from '../types';

interface UseWorkflowPollingOptions {
  onStepReveal: (stepIdx: number, backendStep: Record<string, unknown>) => void;
  onComplete: () => void;
  onError: (stepIdx: number, message: string) => void;
  onProgress: (stepIdx: number, percent: number) => void;
  onWaitingForInput?: (stepIdx: number, stepData?: any) => void;
}

export function useWorkflowPolling(options: UseWorkflowPollingOptions) {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedCountRef = useRef(0);

  // Cleanup polling on unmount
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

  const submitWorkflow = useCallback(async (
    files: UploadedFile[],
    realFiles: File[],
    apiKeyId?: string,
  ) => {
    setApiError(null);
    revealedCountRef.current = 0;

    const formData = new FormData();
    formData.append('process', 'disbursement');
    if (apiKeyId) {
      formData.append('apiKeyId', apiKeyId);
    }

    if (realFiles.length > 0) {
      realFiles.forEach(f => formData.append('files[]', f));
    } else {
      files.forEach(f => {
        const blob = new Blob(['(mock file content)'], { type: f.type || 'application/pdf' });
        formData.append('files[]', blob, f.name);
      });
    }

    const res = await fetch('/api/v1/workflows', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || `API Error ${res.status}`);
    }

    const opId = data.name?.replace('operations/', '') || data.id;
    if (!opId) throw new Error('No operation ID returned');

    startPolling(opId);
    return opId;
  }, [options, stopPolling]);

  const startPolling = useCallback((opId: string) => {
    setOperationId(opId);
    setIsPolling(true);
    stopPolling();

    // Start polling
    pollIntervalRef.current = setInterval(async () => {
      try {
        const pollRes = await fetch(`/api/v1/operations/${opId}`);
        const opData = await pollRes.json();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stepsRes: any[] = opData.metadata?.pipeline_steps || opData.result?.pipeline_steps || [];
        const isDone = opData.done === true;
        const hasFailed = opData.metadata?.state === 'FAILED';
        const isWaiting = opData.metadata?.state === 'WAITING_USER_INPUT';

        // Reveal new steps as they come in
        if (stepsRes.length > revealedCountRef.current) {
          const newSteps = stepsRes.slice(revealedCountRef.current);
          for (const step of newSteps) {
            options.onStepReveal(revealedCountRef.current, step);
            revealedCountRef.current++;
          }
        }

        // Update progress for currently running step
        if (!isDone && !hasFailed && !isWaiting && revealedCountRef.current < 4) {
          const pct = Math.max(15, (opData.metadata?.progress_percent ?? 0) - revealedCountRef.current * 25);
          options.onProgress(revealedCountRef.current, pct);
        }

        if (isDone || hasFailed || isWaiting) {
          stopPolling();

          if (hasFailed) {
            const failedIdx = opData.error?.failed_step ?? revealedCountRef.current;
            const errorMsg = opData.error?.message || 'Pipeline failed';
            options.onError(failedIdx, errorMsg);
            setApiError(errorMsg);
          } else if (isWaiting) {
            // Signal UI to show Editor form
            const currentStepData = stepsRes[revealedCountRef.current - 1];
            options.onWaitingForInput?.(revealedCountRef.current - 1, currentStepData);
          } else {
            options.onComplete();
          }
        }
      } catch (pollErr) {
        console.error('Polling error:', pollErr);
      }
    }, 1500);
  }, [options, stopPolling]);

  return {
    operationId,
    isPolling,
    apiError,
    submitWorkflow,
    startPolling,
    stopPolling,
    clearError: () => setApiError(null),
  };
}
