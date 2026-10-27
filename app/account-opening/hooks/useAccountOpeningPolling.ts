import { useState, useCallback, useRef, useEffect } from 'react';
import type { AccountStageKey, BackendWorkflowStep } from '../types';

interface UseAccountOpeningPollingOptions {
  onStepReveal: (stageKey: string, backendStep: BackendWorkflowStep) => void;
  onComplete: (result: unknown) => void;
  onError: (stageKey: string, message: string) => void;
  onProgress: (stageKey: string | undefined, percent: number, message?: string) => void;
}

/** Thứ tự stage của workflow; dùng làm fallback khi artifact cũ chỉ có `step` numeric. */
const STAGE_KEYS: AccountStageKey[] = [
  'classify',
  'extract_evidence',
  'consolidate_profile',
  'evaluate_eligibility',
  'assess_cdd_risk',
  'evaluate_policy_compliance',
  'screen_watchlists',
  'synthesize_decision',
];

function stageKeyOf(step: BackendWorkflowStep, fallbackIndex: number): string {
  return step.stage_key || STAGE_KEYS[step.step ?? fallbackIndex] || `stage-${step.step ?? fallbackIndex}`;
}

export function useAccountOpeningPolling(options: UseAccountOpeningPollingOptions) {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedKeysRef = useRef(new Set<string>());
  const prevMessageRef = useRef<string>('');
  const logRef = useRef<string[]>([]);
  const consecutivePollErrorsRef = useRef(0);
  const currentStageRef = useRef<AccountStageKey>('classify');

  useEffect(() => () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback((opId: string, apiKey?: string) => {
    setOperationId(opId);
    stopPolling();
    setIsPolling(true);
    consecutivePollErrorsRef.current = 0;
    currentStageRef.current = 'classify';
    const startTime = Date.now();
    const timeoutMs = 10 * 60 * 1000;

    pollIntervalRef.current = setInterval(async () => {
      if (Date.now() - startTime > timeoutMs) {
        stopPolling();
        options.onError(currentStageRef.current, 'Timeout: Workflow chạy quá 10 phút. Kiểm tra lại trên trang Operations.');
        return;
      }

      try {
        const headers: Record<string, string> = {};
        if (apiKey) headers['X-API-Key'] = apiKey;
        const pollRes = await fetch(`/api/v1/operations/${opId}`, { headers });
        const opData = await pollRes.json();
        if (!pollRes.ok) throw new Error(opData.detail || opData.error || `Poll error ${pollRes.status}`);
        consecutivePollErrorsRef.current = 0;

        const rawSteps: BackendWorkflowStep[] = opData.metadata?.pipeline_steps || opData.result?.pipeline_steps || [];
        const businessSteps = rawSteps.filter((step) => step.processor !== 'webhook');
        for (const [index, step] of businessSteps.entries()) {
          const stageKey = stageKeyOf(step, index);
          if (revealedKeysRef.current.has(stageKey)) continue;
          options.onStepReveal(stageKey, step);
          revealedKeysRef.current.add(stageKey);
        }

        const isDone = opData.done === true;
        const state = opData.metadata?.state as string | undefined;
        const hasFailed = state === 'FAILED';
        const currentStep = Number(opData.metadata?.current_step ?? 0);
        const currentStage = STAGE_KEYS[currentStep];
        if (currentStage) currentStageRef.current = currentStage;

        if (!isDone && !hasFailed) {
          const pct = Math.max(5, opData.metadata?.progress_percent ?? 0);
          const msg: string | undefined = opData.metadata?.progress_message ?? undefined;
          if (msg && msg !== prevMessageRef.current) {
            prevMessageRef.current = msg;
            const ts = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            logRef.current.push(`[${ts}] ${msg}`);
            if (logRef.current.length > 80) logRef.current = logRef.current.slice(-80);
          }
          options.onProgress(currentStage, pct, logRef.current.length ? logRef.current.join('\n') : undefined);
        }

        if (isDone || hasFailed) {
          stopPolling();
          if (hasFailed) {
            const failedIndex = Number(opData.error?.failed_step ?? currentStep);
            options.onError(STAGE_KEYS[failedIndex] || currentStage || 'classify', opData.error?.message || 'Workflow failed');
          } else {
            options.onComplete(opData.result?.extracted_data || opData.metadata?.extracted_data);
          }
        }
      } catch (error) {
        consecutivePollErrorsRef.current += 1;
        console.error('Account opening polling error:', error);
        if (consecutivePollErrorsRef.current >= 3) {
          stopPolling();
          const detail = error instanceof Error ? error.message : String(error);
          options.onError(
            currentStageRef.current,
            `Mất kết nối khi theo dõi workflow sau 3 lần thử. ${detail}`,
          );
        }
      }
    }, 2000);
  }, [options, stopPolling]);

  const submitWorkflow = useCallback(async (
    realFiles: File[],
    apiKey: string | undefined,
    segment: string,
    productCode: string,
  ) => {
    revealedKeysRef.current = new Set<string>();
    prevMessageRef.current = '';
    logRef.current = [];
    if (realFiles.length === 0) throw new Error('Cần upload ít nhất 1 tài liệu để tiếp nhận hồ sơ.');

    const formData = new FormData();
    formData.append('process', 'account-opening');
    formData.append('segment', segment);
    formData.append('product_code', productCode);
    realFiles.forEach((file) => formData.append('files[]', file));
    const headers: Record<string, string> = {};
    if (apiKey) headers['X-API-Key'] = apiKey;

    const response = await fetch('/api/v1/docs/workflows', { method: 'POST', body: formData, headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.message || `API Error ${response.status}`);
    const opId = data.name?.replace('operations/', '') || data.id;
    if (!opId) throw new Error('No operation ID returned');
    startPolling(opId, apiKey);
    return opId;
  }, [startPolling]);

  return { operationId, isPolling, submitWorkflow, stopPolling };
}
