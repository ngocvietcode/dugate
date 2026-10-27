// app/structure-compare/hooks/useWorkflowPolling.ts
// Custom hook: Submit structure-compare workflow to API + poll for results.
// Supports mock mode via ?mock=true query param or NEXT_PUBLIC_MOCK_MODE=true.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { UploadedFile } from '../types';
import {
  mockSubmitWorkflow,
  mockPollOperation,
  mockResumeOperation,
  isMockEnabled,
} from '../lib/mock-workflow';

interface UseWorkflowPollingOptions {
  onStepReveal: (stepIdx: number, backendStep: Record<string, unknown>) => void;
  onComplete: () => void;
  onError: (stepIdx: number, message: string) => void;
  onProgress: (stepIdx: number, percent: number) => void;
  onWaitingForInput?: (stepIdx: number, stepData?: unknown) => void;
}

export function useWorkflowPolling(options: UseWorkflowPollingOptions) {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedCountRef = useRef(0);

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

  const processPollData = useCallback((opData: any) => {
    const stepsRes: Record<string, unknown>[] =
      opData.metadata?.pipeline_steps || opData.result?.pipeline_steps || [];
    const isDone = opData.done === true;
    const hasFailed = opData.metadata?.state === 'FAILED';
    const isWaiting = opData.metadata?.state === 'WAITING_USER_INPUT';

    // Reveal new steps
    if (stepsRes.length > revealedCountRef.current) {
      const newSteps = stepsRes.slice(revealedCountRef.current);
      for (const step of newSteps) {
        options.onStepReveal(revealedCountRef.current, step);
        revealedCountRef.current++;
      }
    }

    if (!isDone && !hasFailed && !isWaiting) {
      const pct = opData.metadata?.progress_percent ?? 0;
      options.onProgress(revealedCountRef.current, pct);
    }

    if (isDone || hasFailed || isWaiting) {
      stopPolling();
      if (hasFailed) {
        const failedIdx = opData.error?.failed_step ?? revealedCountRef.current;
        const errorMsg = opData.error?.message || 'Pipeline thất bại';
        options.onError(failedIdx, errorMsg);
        setApiError(errorMsg);
      } else if (isWaiting) {
        const currentStepData = stepsRes[revealedCountRef.current - 1];
        options.onWaitingForInput?.(revealedCountRef.current - 1, currentStepData);
      } else {
        options.onComplete();
      }
    }
  }, [options, stopPolling]);

  const startPolling = useCallback((opId: string) => {
    setOperationId(opId);
    setIsPolling(true);
    stopPolling();

    const useMock = isMockEnabled();

    pollIntervalRef.current = setInterval(async () => {
      try {
        let opData: any;
        if (useMock) {
          opData = mockPollOperation();
        } else {
          const pollRes = await fetch(`/api/v1/operations/${opId}`);
          opData = await pollRes.json();
        }
        processPollData(opData);
      } catch (pollErr) {
        console.error('[structure-compare] Polling error:', pollErr);
      }
    }, useMock ? 1000 : 2000); // Faster polling in mock mode
  }, [processPollData, stopPolling]);

  const submitWorkflow = useCallback(async (
    files: UploadedFile[],
    realFiles: File[],
    apiKeyId?: string,
  ) => {
    setApiError(null);
    revealedCountRef.current = 0;

    if (isMockEnabled()) {
      const result = mockSubmitWorkflow();
      startPolling(result.id);
      return result.id;
    }

    const formData = new FormData();
    formData.append('process', 'structure-compare');

    if (realFiles.length > 0) {
      realFiles.forEach(f => formData.append('files[]', f));
    } else {
      files.forEach(f => {
        const blob = new Blob(['(mock)'], { type: f.type || 'application/pdf' });
        formData.append('files[]', blob, f.name);
      });
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

  const resumeWorkflow = useCallback(async (confirmedMappingTable: unknown) => {
    if (isMockEnabled()) {
      mockResumeOperation();
      if (operationId) startPolling(operationId);
      return;
    }

    if (!operationId) throw new Error('No operation to resume');
    setApiError(null);

    const res = await fetch(`/api/v1/operations/${operationId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappingTable: confirmedMappingTable }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.message || `Resume failed: ${res.status}`);
    }

    startPolling(operationId);
  }, [operationId, startPolling]);

  return {
    operationId,
    isPolling,
    apiError,
    submitWorkflow,
    resumeWorkflow,
    startPolling,
    stopPolling,
    clearError: () => setApiError(null),
  };
}
