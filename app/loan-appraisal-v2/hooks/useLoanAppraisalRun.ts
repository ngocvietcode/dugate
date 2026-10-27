'use client';

// Hook I/O cho một lần chạy: submit, mở lại (attach), huỷ, poll. Trạng thái nằm trong reducer thuần.
// API key chỉ giữ trong ref của hook, không ghi vào URL/storage/log.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { toast } from 'sonner';
import type { LoanFlow, LoanStageKey } from '@/app/loan-appraisal/types';
import { DEFAULT_PRODUCT_CODE } from '../lib/product-options';
import { ApiError, cancelOperation, getOperation, isAbortError, resumeOperation, submitWorkflow, type LacMode } from '../lib/api';
import { applyOperation, toRunErrorKind, type ApiContext } from '../lib/operation-mapper';
import { isValidOperationId } from '../lib/operation-id';
import { createPoller, type Poller } from '../lib/poller';
import {
  initialRunState,
  isBusyPhase,
  runReducer,
  type RunAction,
  type RunPhase,
  type RunState,
} from '../lib/run-reducer';
import { STAGES } from '../lib/stages';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureAction(error: unknown, context: ApiContext, stage: LoanStageKey | null): RunAction {
  const kind = error instanceof ApiError ? toRunErrorKind(error.kind, context) : 'network';
  const detail = errorMessage(error);
  const message = kind === 'network' && context === 'poll'
    ? `Mất kết nối khi theo dõi workflow sau 3 lần thử. ${detail}`
    : detail;
  return { type: 'FAILED', kind, message, stage };
}

export interface LoanAppraisalRun {
  state: RunState;
  isBusy: boolean;
  submit: (files: File[], apiKey: string, flow: LoanFlow, productCode?: string, stopAfterIntake?: boolean, lacMode?: LacMode) => Promise<void>;
  attach: (operationId: string, apiKey?: string) => Promise<void>;
  cancel: () => Promise<void>;
  /** D-51: chạy giai đoạn 2 của operation đang dừng sau giai đoạn 1. */
  resume: () => Promise<void>;
  reset: () => void;
  reportInvalidOperation: () => void;
}

export function useLoanAppraisalRun(): LoanAppraisalRun {
  const [state, dispatch] = useReducer(runReducer, undefined, initialRunState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apiKeyRef = useRef<string | undefined>(undefined);
  const revealedRef = useRef(new Set<string>());
  const pollerRef = useRef<Poller | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const suppressRevertToastRef = useRef(false);
  const previousPhaseRef = useRef<RunPhase>(state.phase);

  const currentStage = useCallback((): LoanStageKey | null => {
    const stages = stateRef.current.stages;
    return STAGES.find((stage) => stages[stage.id] === 'running')?.id ?? null;
  }, []);

  const stopAll = useCallback(() => {
    pollerRef.current?.stop();
    pollerRef.current = null;
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const startPolling = useCallback((operationId: string, apiKey?: string) => {
    pollerRef.current?.stop();
    const poller = createPoller({
      fetchOperation: (signal) => getOperation(operationId, { apiKey, compact: true, signal }),
      onData: (data) => {
        const { actions, outcome } = applyOperation(data, revealedRef.current);
        actions.forEach(dispatch);
        if (outcome === 'running') dispatch({ type: 'POLL_TICK' });
        return outcome;
      },
      onFatal: (error) => dispatch(failureAction(error, 'poll', currentStage() ?? 'classify')),
      onSoftTimeout: () => dispatch({ type: 'SOFT_TIMEOUT' }),
      onStalled: () => dispatch({ type: 'STALLED' }),
    });
    pollerRef.current = poller;
    poller.start();
  }, [currentStage]);

  // Toast theo chuyển pha (không toast lỗi: ErrorBanner đã hiển thị).
  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = state.phase;
    if (previous === state.phase) return;
    if (isBusyPhase(previous) && state.phase === 'succeeded') toast.success('Đã hoàn tất thẩm định hồ sơ.');
    if (isBusyPhase(previous) && state.phase === 'paused') toast.success('Đã xong giai đoạn 1 (phân loại và kiểm tra sơ bộ). Xem kết quả rồi chuyển sang giai đoạn 2 để bóc tách, đối chiếu và thẩm định.');
    if (isBusyPhase(previous) && state.phase === 'cancelled') toast.info('Đã huỷ phiên thẩm định.');
    if (previous === 'cancelling' && state.phase === 'running') {
      if (suppressRevertToastRef.current) suppressRevertToastRef.current = false;
      else toast.warning('Chưa nhận được trạng thái huỷ, đang tiếp tục theo dõi.');
    }
  }, [state.phase]);

  useEffect(() => stopAll, [stopAll]);

  const submit = useCallback(async (files: File[], apiKey: string, flow: LoanFlow, productCode: string = DEFAULT_PRODUCT_CODE, stopAfterIntake = false, lacMode: LacMode = 'off') => {
    const phase = stateRef.current.phase;
    if (isBusyPhase(phase)) return;
    stopAll();
    apiKeyRef.current = apiKey;
    revealedRef.current = new Set<string>();
    dispatch({ type: 'SUBMIT_START', fileCount: files.length });
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const operationId = await submitWorkflow(files, apiKey, productCode, flow, controller.signal, stopAfterIntake, lacMode);
      if (controller.signal.aborted) return;
      dispatch({ type: 'SUBMITTED', operationId });
      startPolling(operationId, apiKey);
    } catch (error) {
      if (isAbortError(error)) return;
      dispatch(failureAction(error, 'submit', 'classify'));
    }
  }, [startPolling, stopAll]);

  const attach = useCallback(async (operationId: string, apiKey?: string) => {
    if (isBusyPhase(stateRef.current.phase)) return;
    if (!isValidOperationId(operationId)) {
      dispatch({ type: 'FAILED', kind: 'invalid-op', message: 'Mã operation trên đường dẫn không hợp lệ.', stage: null });
      return;
    }
    stopAll();
    apiKeyRef.current = apiKey || undefined;
    revealedRef.current = new Set<string>();
    dispatch({ type: 'ATTACH_START', operationId });
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const data = await getOperation(operationId, { apiKey: apiKey || undefined, signal: controller.signal });
      if (controller.signal.aborted) return;
      const { actions, outcome } = applyOperation(data, revealedRef.current);
      actions.forEach(dispatch);
      if (outcome === 'running') startPolling(operationId, apiKey || undefined);
    } catch (error) {
      if (isAbortError(error)) return;
      dispatch(failureAction(error, 'attach', null));
    }
  }, [startPolling, stopAll]);

  const cancel = useCallback(async () => {
    const { phase, operationId } = stateRef.current;
    if (phase !== 'running' || !operationId) return;
    dispatch({ type: 'CANCEL_REQUESTED' });
    const controller = new AbortController();
    try {
      const body = await cancelOperation(operationId, apiKeyRef.current, controller.signal);
      // Phản hồi 200 đã mang trạng thái CANCELLED: áp ngay; 3 vòng poll là phương án dự phòng.
      const { actions, outcome } = applyOperation(body, revealedRef.current);
      if (outcome !== 'running') {
        actions.forEach(dispatch);
        pollerRef.current?.stop();
      }
    } catch (error) {
      if (isAbortError(error)) return;
      suppressRevertToastRef.current = true;
      dispatch({ type: 'CANCEL_FAILED' });
      if (error instanceof ApiError && error.kind === 'already-done') {
        toast.error('Hồ sơ đã hoàn tất, không thể huỷ.');
      } else {
        toast.error(`Không huỷ được: ${errorMessage(error)}`);
      }
    }
  }, []);

  const reset = useCallback(() => {
    stopAll();
    revealedRef.current = new Set<string>();
    dispatch({ type: 'RESET' });
  }, [stopAll]);

  /** D-51: chuyển sang giai đoạn 2 — chạy tiếp operation đang dừng sau giai đoạn 1, rồi theo dõi tới khi xong. */
  const resume = useCallback(async () => {
    const { phase, operationId } = stateRef.current;
    if (phase !== 'paused' || !operationId) return;
    dispatch({ type: 'RESUME_START' });
    try {
      await resumeOperation(operationId, apiKeyRef.current);
      dispatch({ type: 'RESUMED' });
      startPolling(operationId, apiKeyRef.current);
    } catch (error) {
      if (isAbortError(error)) return;
      const message = `Không chạy tiếp được giai đoạn 2: ${errorMessage(error)}`;
      dispatch({ type: 'RESUME_FAILED', message });
      toast.error(message);
    }
  }, [startPolling]);

  const reportInvalidOperation = useCallback(() => {
    dispatch({ type: 'FAILED', kind: 'invalid-op', message: 'Mã operation trên đường dẫn không hợp lệ.', stage: null });
  }, []);

  return { state, isBusy: isBusyPhase(state.phase), submit, attach, cancel, resume, reset, reportInvalidOperation };
}
