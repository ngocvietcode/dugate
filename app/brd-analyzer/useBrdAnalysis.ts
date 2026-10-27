// app/brd-analyzer/useBrdAnalysis.ts
// Hook: submit workflow brd-analyze + poll operation cho tới khi xong.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrdResult } from '@/lib/brd/types';

export type AnalysisStatus = 'idle' | 'submitting' | 'running' | 'done' | 'error';

export interface StepInfo {
  step: number;
  stepName: string;
  processor: string;
  data: unknown;
}

interface UseBrdAnalysisState {
  status: AnalysisStatus;
  progressPercent: number;
  progressMessage: string;
  steps: StepInfo[];
  result: BrdResult | null;
  error: string | null;
  operationId: string | null;
}

const INITIAL: UseBrdAnalysisState = {
  status: 'idle',
  progressPercent: 0,
  progressMessage: '',
  steps: [],
  result: null,
  error: null,
  operationId: null,
};

export function useBrdAnalysis() {
  const [state, setState] = useState<UseBrdAnalysisState>(INITIAL);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setState(INITIAL);
  }, [stopPolling]);

  const startPolling = useCallback((opId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/operations/${opId}`);
        const data = await res.json();
        const meta = data.metadata ?? {};
        const steps: StepInfo[] = (meta.pipeline_steps ?? []).map((s: Record<string, unknown>) => ({
          step: Number(s.step ?? 0),
          stepName: String(s.stepName ?? ''),
          processor: String(s.processor ?? ''),
          data: s.content_preview ?? s.extracted_data ?? null,
        }));

        const isDone = data.done === true;
        const failed = meta.state === 'FAILED';

        setState((prev) => ({
          ...prev,
          progressPercent: Number(meta.progress_percent ?? prev.progressPercent),
          progressMessage: String(meta.progress_message ?? prev.progressMessage),
          steps: steps.length ? steps : prev.steps,
        }));

        if (isDone || failed) {
          stopPolling();
          if (failed) {
            setState((prev) => ({
              ...prev,
              status: 'error',
              error: data.error?.message || 'Phân tích thất bại.',
            }));
          } else {
            const result = (data.result?.extracted_data ?? null) as BrdResult | null;
            setState((prev) => ({
              ...prev,
              status: 'done',
              progressPercent: 100,
              result,
            }));
          }
        }
      } catch {
        // lỗi mạng tạm thời — thử lại ở interval kế
      }
    }, 1500);
  }, [stopPolling]);

  const analyze = useCallback(
    async (files: File[], apiKeyId: string) => {
      if (files.length === 0) {
        setState((p) => ({ ...p, status: 'error', error: 'Vui lòng chọn ít nhất 1 file BRD.' }));
        return;
      }
      if (!apiKeyId.trim()) {
        setState((p) => ({ ...p, status: 'error', error: 'Vui lòng nhập Profile API Key ID.' }));
        return;
      }

      setState({ ...INITIAL, status: 'submitting', progressMessage: 'Đang gửi yêu cầu...' });

      try {
        const fd = new FormData();
        fd.append('process', 'brd-analyze');
        fd.append('allowed_extensions', '.pdf,.docx,.xlsx,.xls');
        files.forEach((f) => fd.append('files[]', f));

        // The workflow endpoint authenticates by raw API key only; a bare Profile
        // UUID is an identifier, never a credential.
        const res = await fetch('/api/v1/docs/workflows', {
          method: 'POST',
          body: fd,
          headers: { 'X-API-Key': apiKeyId.trim() },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || data.message || `API Error ${res.status}`);
        }
        const opId: string = data.name?.replace('operations/', '') || data.id;
        if (!opId) throw new Error('Không nhận được operation ID.');

        setState((p) => ({ ...p, status: 'running', operationId: opId }));
        startPolling(opId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((p) => ({ ...p, status: 'error', error: msg }));
      }
    },
    [startPolling],
  );

  return { ...state, analyze, reset };
}
