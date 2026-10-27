// app/margin-eval/hooks/useMarginEval.ts
// Submit margin-deposit-profile workflow (1 of 4 modes) + poll until done.
// Returns the raw extracted_data.result + usage so the page can build review items.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { EvalFile, MarginMode, UsageStats } from '../types';

interface SubmitArgs {
  mode: MarginMode;
  files: EvalFile[];
  apiKey: string;
}

interface UseMarginEvalOptions {
  onProgress?: (percent: number, message?: string) => void;
  onComplete: (result: unknown, usage: UsageStats) => void;
  onError: (message: string) => void;
}

const POLL_INTERVAL_MS = 2500;
const TIMEOUT_MS = 15 * 60 * 1000;

export function useMarginEval(options: UseMarginEvalOptions) {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef<number>(0);
  // True once polling is torn down (stopPolling / unmount) so an in-flight
  // request that resolves afterwards does not schedule another tick.
  const stoppedRef = useRef<boolean>(false);

  useEffect(() => () => { stoppedRef.current = true; if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const stopPolling = useCallback(() => {
    stoppedRef.current = true;
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    setIsPolling(false);
  }, []);

  // Recursive setTimeout instead of setInterval: the next poll is scheduled
  // ONLY after the current request settles, so a slow /operations response can
  // never stack overlapping requests.
  const startPolling = useCallback((opId: string, apiKey: string) => {
    setOperationId(opId);
    setIsPolling(true);
    startedRef.current = Date.now();
    stoppedRef.current = false;
    if (pollRef.current) clearTimeout(pollRef.current);

    const tick = async () => {
      if (stoppedRef.current) return;
      if (Date.now() - startedRef.current > TIMEOUT_MS) {
        stopPolling();
        options.onError('Timeout: workflow chạy quá 15 phút.');
        return;
      }
      try {
        const res = await fetch(`/api/v1/operations/${opId}`, { headers: apiKey ? { 'X-API-Key': apiKey } : {} });
        const op = await res.json();
        if (stoppedRef.current) return;
        if (!op.done) {
          options.onProgress?.(op.metadata?.progress_percent ?? 0, op.metadata?.progress_message ?? undefined);
          schedule();
          return;
        }
        stopPolling();
        const seconds = (Date.now() - startedRef.current) / 1000;
        const usageRaw = op.result?.usage || {};
        const usage: UsageStats = {
          input_tokens: usageRaw.input_tokens || 0,
          output_tokens: usageRaw.output_tokens || 0,
          cost_usd: usageRaw.cost_usd || 0,
          seconds: Number(seconds.toFixed(1)),
        };
        if (op.metadata?.state === 'FAILED') {
          options.onError(op.error?.message || 'Workflow FAILED');
          return;
        }
        const result = op.result?.extracted_data?.result ?? op.result?.extracted_data ?? {};
        options.onComplete(result, usage);
      } catch (err) {
        // keep polling on transient network error
        console.error('poll error', err);
        if (!stoppedRef.current) schedule();
      }
    };

    const schedule = () => {
      if (stoppedRef.current) return;
      pollRef.current = setTimeout(() => { void tick(); }, POLL_INTERVAL_MS);
    };

    schedule();
  }, [options, stopPolling]);

  const submit = useCallback(async ({ mode, files, apiKey }: SubmitArgs) => {
    if (files.length === 0) throw new Error('Chưa chọn file nào.');

    const metadata: Record<string, unknown> = { mode };
    if (mode !== 'classify') {
      metadata.file_meta = files.map((f) => {
        const entry: Record<string, unknown> = { doc_type: f.doc_type };
        if (mode === 'framework' || mode === 'validation') entry.role = f.role || 'customer';
        if (mode === 'validation' && (f.role || 'customer') === 'customer' && f.group_id) entry.group_id = f.group_id;
        return entry;
      });
    }

    const form = new FormData();
    form.append('process', 'margin-deposit');
    form.append('metadata', JSON.stringify(metadata));
    files.forEach((f) => form.append('files[]', f.file, f.name));

    const res = await fetch('/api/v1/docs/workflows', {
      method: 'POST',
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || `API Error ${res.status}`);
    const opId = (data.name || '').replace('operations/', '') || data.id;
    if (!opId) throw new Error('Không nhận được operation id.');
    startPolling(opId, apiKey);
    return opId;
  }, [startPolling]);

  return { operationId, isPolling, submit, stopPolling };
}
