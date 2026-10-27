// app/payment-account-management/hooks/usePamPolling.ts
// Submit the payment-account-management workflow + poll for results, then
// normalize the stage-specific runner result into a flat DocCard[] keyed by file_id.

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  UploadedFile,
  PamStage,
  PamMode,
  DocCard,
  CardClassification,
  CardValidation,
  CardSource,
  BankData,
} from '../types';

/**
 * Build the `metadata` form field. `data` is attached only for mode=update at
 * stage=e2e — the only combination the runner reads it in — and only when the
 * caller actually supplied something, so an empty form still exercises the
 * BANK_DATA_MISSING branch. Exported so the page can preview the exact payload.
 */
export function buildMetadata(
  mode: PamMode,
  stage: PamStage,
  bankData?: BankData | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = { mode, stage };
  const useData = mode === 'update' && stage === 'e2e' && bankData
    && Object.keys(bankData).length > 0;
  if (useData) base.data = bankData;
  return base;
}

interface UsePamPollingOptions {
  /** Called on each poll tick with overall progress. */
  onProgress: (percent: number, message?: string) => void;
  /** Called once when the run finishes: normalized cards + the raw envelope. */
  onComplete: (cards: DocCard[], envelope: unknown) => void;
  onError: (message: string) => void;
}

// ─── Result normalization ───────────────────────────────────────────────────────
// The runner returns a different shape per stage (see the control doc §6). We flatten
// all three into DocCard[], matching on file_id — never index or filename.

function asClassification(raw: unknown): CardClassification | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    code: typeof r.code === 'string' ? r.code : 'unknown',
    title: typeof r.title === 'string' ? r.title : 'N/A',
    confidence: typeof r.confidence === 'number' ? r.confidence : 0,
    reason: typeof r.reason === 'string' ? r.reason : '',
  };
}

/**
 * Read the document-level validation envelope: { overall, summary, error? }.
 * Per-field entries are NOT here — they live inside the extracted tree, attached
 * by the runner to the leaves they apply to (see FieldRenderer).
 */
function asValidation(raw: unknown): CardValidation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = (r.summary ?? {}) as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    overall: r.overall === 'fail' ? 'fail' : 'pass',
    summary: { pass: count(s.pass), fail: count(s.fail), skip: count(s.skip) },
    ...(typeof r.error === 'string' ? { error: r.error } : {}),
  };
}

function asFields(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Read a split segment's `source` block ({ file_id, name, pages }); null if absent. */
function asSource(raw: unknown): CardSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    file_id: typeof r.file_id === 'string' ? r.file_id : null,
    name: typeof r.name === 'string' ? r.name : '',
    pages: Array.isArray(r.pages) ? r.pages.filter((p): p is number => typeof p === 'number') : [],
  };
}

/**
 * Map the mode-runner payload (envelope.result) into DocCard[].
 * Falls back to a single info card if the shape is unrecognized.
 */
function normalizeResult(envelope: unknown, uploaded: UploadedFile[]): DocCard[] {
  const result = (envelope as any)?.result;
  const stage: PamStage | undefined = result?.stage;
  // The runner returns `name` (original filename) on every row. Fall back to the
  // uploaded list by position only if an older backend omitted it.
  const byName = new Map(uploaded.map(u => [u.name, u]));
  const fallbackName = (i: number) => uploaded[i]?.name ?? `Tài liệu ${i + 1}`;
  const fallbackIcon = (i: number) => uploaded[i]?.icon ?? '📄';

  // Every stage now returns result.documents[] with a full `classification` object
  // per file (classification / extraction / e2e share the same per-file shape).
  const rows: any[] = Array.isArray(result?.documents) ? result.documents : [];

  if (rows.length === 0) return [];

  return rows.map((row, i): DocCard => {
    const key = row.file_id ?? `doc_${i}`;
    const classification = asClassification(row.classification);
    const extracted = asFields(row.extracted);
    const validation = asValidation(row.validation);
    const error: string | undefined = typeof row.error === 'string' ? row.error : undefined;
    const source = asSource(row.source); // present only for split segments
    const warning: string | undefined = typeof row.warning === 'string' ? row.warning : undefined;

    // Status: error > done(has extract/validation) > classified > processing.
    let status: DocCard['status'];
    if (error && !extracted) status = 'error';
    else if (stage === 'classification') status = classification ? 'classified' : 'processing';
    else status = 'done';

    // unknown code with no data is effectively an error card.
    if (classification?.code === 'unknown' && !extracted && !validation) status = 'error';

    // Filename + icon:
    //  - non-split: row.name IS an uploaded filename → match its icon directly.
    //  - split:     row.name is a generated segment name (no match). Take the icon
    //               from the PARENT scan file (source.name); the positional fallback
    //               would be wrong here since one file yields many rows.
    const fileName = typeof row.name === 'string' && row.name ? row.name : fallbackName(i);
    const fileIcon = source
      ? byName.get(source.name)?.icon ?? '📄'
      : byName.get(fileName)?.icon ?? fallbackIcon(i);

    return {
      key,
      fileName,
      fileIcon,
      status,
      classification,
      extracted,
      validation,
      error,
      ...(source ? { source } : {}),
      ...(warning ? { warning } : {}),
    };
  });
}

export function usePamPolling(options: UsePamPollingOptions) {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadedRef = useRef<UploadedFile[]>([]);

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
        options.onError('Timeout: Workflow chạy quá 10 phút. Kiểm tra lại ở trang Operations.');
        return;
      }

      try {
        const res = await fetch(`/api/v1/operations/${opId}`);
        const opData = await res.json();

        const isDone = opData.done === true;
        const hasFailed = opData.metadata?.state === 'FAILED';

        if (!isDone && !hasFailed) {
          const pct = Math.max(5, opData.metadata?.progress_percent ?? 0);
          options.onProgress(pct, opData.metadata?.progress_message ?? undefined);
          return;
        }

        stopPolling();
        if (hasFailed) {
          options.onError(opData.error?.message || 'Workflow thất bại.');
          return;
        }

        // envelope = { request_id, skill_code, status, metadata, result }
        const envelope = opData.result?.extracted_data ?? null;
        const cards = normalizeResult(envelope, uploadedRef.current);
        options.onProgress(100, 'Hoàn tất.');
        options.onComplete(cards, envelope);
      } catch (err) {
        // Transient fetch error — keep polling until timeout.
        console.error('PAM polling error:', err);
      }
    }, 2000);
  }, [options, stopPolling]);

  const submitWorkflow = useCallback(async (
    uploaded: UploadedFile[],
    realFiles: File[],
    stage: PamStage,
    mode: PamMode,
    apiKey?: string,
    /**
     * Core-bank data for mode=update, sent as `metadata.data`. Only used by the
     * runner at stage=e2e; omitted when empty so the runner reports
     * BANK_DATA_MISSING rather than receiving an empty object.
     */
    bankData?: BankData | null,
  ) => {
    if (realFiles.length === 0) {
      throw new Error('Cần upload ít nhất 1 file PDF hoặc ảnh (đơn/tài liệu).');
    }
    uploadedRef.current = uploaded;

    const formData = new FormData();
    formData.append('process', 'payment-account-management');
    formData.append('allowed_extensions', '.pdf,.jpg,.jpeg,.png');
    // mode + stage selected in the UI. `data` is only meaningful for mode=update
    // at stage=e2e; other combinations ignore it, so we leave it off entirely.
    const metadata = buildMetadata(mode, stage, bankData);
    formData.append('metadata', JSON.stringify(metadata));
    realFiles.forEach(f => formData.append('files[]', f));

    const headers: Record<string, string> = {};
    if (apiKey) headers['X-API-Key'] = apiKey;

    const res = await fetch('/api/v1/docs/workflows', { method: 'POST', body: formData, headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.message || `API Error ${res.status}`);
    }

    const opId = data.name?.replace('operations/', '') || data.id;
    if (!opId) throw new Error('Không nhận được operation ID.');

    startPolling(opId);
    return opId;
  }, [startPolling]);

  return { operationId, isPolling, submitWorkflow, stopPolling };
}
