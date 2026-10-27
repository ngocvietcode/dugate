'use client';

// app/financial-report/page.tsx
// Trang nội bộ test workflow `financial-report-translation`:
// upload PDF BCTC → gọi workflow → poll operation → render JSON song ngữ.
//
// Nằm sau NextAuth của app (middleware.ts) — KHÔNG tạo route public.
// KHÔNG có nút export Excel: sinh Excel nằm ngoài scope DU (SRS §3.2),
// exporter đặt ở handover-report/OCRBctcJapan/api-test/src/export_excel.py.
// Spec: handover-report/OCRBctcJapan/PLAN/TASK-2-UI-TEST-TOOL.md §3

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { REPORT_TYPES } from '@/lib/pipelines/workflows/financial-report/types';
import type {
  FileProcessingInfo,
  FileResult,
  FileStatus,
  FinancialReportEnvelope,
  GeneralInformation,
  NotesReport,
  PageRange,
  TabularReport,
  TargetLang,
} from '@/lib/pipelines/workflows/financial-report/types';
import type { ReportType, ReportStatus } from '@/lib/pipelines/workflows/financial-report/types';
import { ReportSection, StatusBadge } from '@/components/financial-report/ReportSection';
import { OperationsHistory } from '@/components/financial-report/OperationsHistory';
import {
  BACKGROUND_POLL_INTERVAL_MS,
  FOREGROUND_POLL_WINDOW_MS,
  LONG_FILE_PAGE_THRESHOLD,
  WORKFLOW_DEADLINE_GUIDANCE,
  financialReportToMarkdown,
  formatCompletionEstimate,
  isWorkflowDeadlineFailure,
} from '@/lib/financial-report/client-helpers';

const PROCESS = 'financial-report-translation';
const SUBMIT_URL = '/api/v2/docs/workflows';
const POLL_INTERVAL_MS = 2500;

/** The browser monitors a new operation for two minutes; the worker continues independently afterwards. */

/** Ghi nhớ operation gần nhất để mở lại trang vẫn xem được kết quả. */
const LAST_OPERATION_STORAGE_KEY = 'financial-report:last-operation-id';
const OPERATION_QUERY_PARAM = 'operation';

type LiveProgressDetails = {
  total_pages?: number;
  current_file?: number;
  file_count?: number;
  seconds_per_page?: number;
};

function readLiveProgressDetails(value: unknown): LiveProgressDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const details = value as Record<string, unknown>;
  return {
    total_pages: typeof details.total_pages === 'number' ? details.total_pages : undefined,
    current_file: typeof details.current_file === 'number' ? details.current_file : undefined,
    file_count: typeof details.file_count === 'number' ? details.file_count : undefined,
    seconds_per_page: typeof details.seconds_per_page === 'number' ? details.seconds_per_page : undefined,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nowTime(): string {
  return new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Tải một object ra file .json. Dùng cho cả envelope và từng report ([I]). */
function downloadObject(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Bỏ ký tự không hợp lệ trong tên file tải về. */
function safeStem(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '_');
}

/** 3 mức của envelope.code theo SRS: 200 = trọn vẹn, 207 = partial, còn lại = lỗi. */
function envelopeMeta(code: number): { card: string; badge: string; text: string } {
  if (code === 200) {
    return {
      card: '',
      badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
      text: 'text-muted-foreground',
    };
  }
  if (code === 207) {
    return {
      card: 'border-amber-500/40 bg-amber-500/5',
      badge: 'bg-amber-500/10 text-amber-600 border-amber-500/40',
      text: 'text-amber-700 font-medium',
    };
  }
  return {
    card: 'border-destructive/30 bg-destructive/5',
    badge: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
    text: 'text-destructive font-medium',
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinancialReportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [targetLang, setTargetLang] = useState<TargetLang>('vi');
  const [apiKey, setApiKey] = useState('');

  const [isRunning, setIsRunning] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<FinancialReportEnvelope | null>(null);
  const [copied, setCopied] = useState(false);
  const [operationCopied, setOperationCopied] = useState(false);
  const [operationStartedAt, setOperationStartedAt] = useState<Date | null>(null);
  const [progressDetails, setProgressDetails] = useState<LiveProgressDetails | null>(null);

  const [lookupId, setLookupId] = useState('');
  /** Foreground monitoring ended, but the worker continues and persists the operation result. */
  const [stillRunning, setStillRunning] = useState(false);
  const [rememberedId, setRememberedId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backgroundPollingRef = useRef(false);
  const nextBackgroundPollAtRef = useRef(0);
  const lastMessageRef = useRef<string>('');

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    backgroundPollingRef.current = false;
    nextBackgroundPollAtRef.current = 0;
  }, []);

  const appendLog = useCallback((message: string) => {
    setLogs((prev) => {
      const next = [...prev, `[${nowTime()}] ${message}`];
      return next.length > 120 ? next.slice(-120) : next;
    });
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setIsRunning(false);
    setOperationId(null);
    setProgressPercent(0);
    setLogs([]);
    setError(null);
    setEnvelope(null);
    setStillRunning(false);
    setOperationCopied(false);
    setOperationStartedAt(null);
    setProgressDetails(null);
    lastMessageRef.current = '';
  }, [stopPolling]);

  /** Ghi nhớ operation để reload trang / chia sẻ link vẫn xem lại được (I4). */
  const rememberOperation = useCallback((opId: string) => {
    try {
      window.localStorage.setItem(LAST_OPERATION_STORAGE_KEY, opId);
    } catch {
      // Trình duyệt chặn localStorage → chỉ mất tiện ích ghi nhớ, không ảnh hưởng luồng chính.
    }
    const url = new URL(window.location.href);
    url.searchParams.set(OPERATION_QUERY_PARAM, opId);
    window.history.replaceState(null, '', url.toString());
  }, []);

  // ── Upload ──────────────────────────────────────────────────────────────
  const addFiles = useCallback((list: FileList) => {
    const pdfs = Array.from(list).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    const rejected = list.length - pdfs.length;
    if (pdfs.length > 0) setFiles((prev) => [...prev, ...pdfs]);
    if (rejected > 0) setError(`${rejected} file bị bỏ qua: workflow này chỉ nhận PDF.`);
    else setError(null);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Xem lại một operation đã có (I4) ────────────────────────────────────
  /**
   * Đọc operation theo id đúng MỘT lần.
   * Trả `'done'` nếu đã có kết quả, `'running'` nếu còn đang chạy, `'error'` nếu không đọc được.
   */
  const fetchOperationOnce = useCallback(async (opId: string): Promise<'done' | 'running' | 'error'> => {
    try {
      const res = await fetch(`/api/v1/operations/${opId}`, {
        headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          data.detail || data.message
          || `Không đọc được operation ${opId} (HTTP ${res.status}). `
             + 'Operation tạo bằng API Key thì phải nhập đúng API Key đó ở trên.',
        );
        return 'error';
      }

      const state: string | undefined = data.metadata?.state;
      setProgressDetails(readLiveProgressDetails(data.metadata?.progress_details));
      if (state === 'FAILED') {
        setError(data.error?.message || 'Workflow thất bại.');
        appendLog(`FAILED: ${data.error?.code ?? ''} ${data.error?.message ?? ''}`);
        return 'done';
      }

      const extracted = data.result?.extracted_data as FinancialReportEnvelope | null;
      if (data.done === true && extracted) {
        setEnvelope(extracted);
        setProgressPercent(100);
        appendLog(`Đã tải kết quả operation ${opId}: code=${extracted.code}, ${extracted.data?.length ?? 0} file.`);
        return 'done';
      }

      return 'running';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return 'error';
    }
  }, [apiKey, appendLog]);

  // ── Poll ────────────────────────────────────────────────────────────────
  const startPolling = useCallback((opId: string, startedAt = new Date()) => {
    stopPolling();
    setStillRunning(false);
    backgroundPollingRef.current = false;
    nextBackgroundPollAtRef.current = 0;

    pollRef.current = setInterval(async () => {
      const now = Date.now();
      if (!backgroundPollingRef.current && now - startedAt.getTime() >= FOREGROUND_POLL_WINDOW_MS) {
        // The worker is durable; keep a low-frequency in-page check rather than requiring manual refresh.
        backgroundPollingRef.current = true;
        nextBackgroundPollAtRef.current = now;
        setIsRunning(false);
        setStillRunning(true);
        appendLog('Đã chuyển sang theo dõi nền 25 giây/lần — có thể đóng trang và mở lại bằng operation ID.');
      }
      if (backgroundPollingRef.current && now < nextBackgroundPollAtRef.current) return;
      if (backgroundPollingRef.current) nextBackgroundPollAtRef.current = now + BACKGROUND_POLL_INTERVAL_MS;

      try {
        const res = await fetch(`/api/v1/operations/${opId}`, {
          headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
        });
        const data = await res.json();

        if (!res.ok) {
          stopPolling();
          setIsRunning(false);
          setError(data.detail || data.message || `Lỗi polling ${res.status}`);
          return;
        }

        const state: string | undefined = data.metadata?.state;
        const percent: number = data.metadata?.progress_percent ?? 0;
        const message: string | undefined = data.metadata?.progress_message ?? undefined;
        setProgressDetails(readLiveProgressDetails(data.metadata?.progress_details));

        setProgressPercent(percent);
        if (message && message !== lastMessageRef.current) {
          lastMessageRef.current = message;
          appendLog(message);
        }

        if (data.done === true || state === 'FAILED') {
          stopPolling();
          setIsRunning(false);
          setStillRunning(false);
          document.title = '✓ Hoàn tất — OCR & Dịch BCTC';

          if (state === 'FAILED') {
            setError(data.error?.message || 'Workflow thất bại.');
            appendLog(`FAILED: ${data.error?.code ?? ''} ${data.error?.message ?? ''}`);
            return;
          }

          const extracted = data.result?.extracted_data as FinancialReportEnvelope | null;
          if (!extracted) {
            setError('Workflow xong nhưng không có extracted_data trong operation.');
            return;
          }
          setEnvelope(extracted);
          setProgressPercent(100);
          appendLog(`Hoàn tất: code=${extracted.code}, ${extracted.data?.length ?? 0} file.`);
        }
      } catch (err) {
        // Browser connectivity is not a workflow failure; retain background polling and surface the retry.
        appendLog(`Không đọc được tiến trình, sẽ thử lại: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, POLL_INTERVAL_MS);
  }, [apiKey, appendLog, stopPolling]);

  /** Gắn vào một operation: hiện kết quả nếu xong, còn chạy thì theo dõi tiếp (I4). */
  const attachToOperation = useCallback(async (rawId: string) => {
    const opId = rawId.trim().replace(/^operations\//, '');
    if (!opId) return;

    stopPolling();
    setError(null);
    setEnvelope(null);
    setStillRunning(false);
    setLogs([]);
    lastMessageRef.current = '';
    const startedAt = new Date();
    setOperationId(opId);
    setOperationStartedAt(startedAt);
    rememberOperation(opId);
    appendLog(`Đang đọc operation ${opId}...`);

    setIsRunning(true);
    const outcome = await fetchOperationOnce(opId);
    if (outcome === 'running') {
      appendLog('Operation còn đang chạy — tiếp tục theo dõi foreground.');
      startPolling(opId, startedAt);
      return;
    }
    setIsRunning(false);
  }, [appendLog, fetchOperationOnce, rememberOperation, startPolling, stopPolling]);

  // Mở trang bằng link ?operation=<id> → tự nạp. Không có thì gợi ý operation gần nhất.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(OPERATION_QUERY_PARAM);
    if (fromUrl) {
      setLookupId(fromUrl);
      void attachToOperation(fromUrl);
      return;
    }
    try {
      const saved = window.localStorage.getItem(LAST_OPERATION_STORAGE_KEY);
      if (saved) setRememberedId(saved);
    } catch {
      // localStorage bị chặn → bỏ qua tiện ích ghi nhớ.
    }
    // Chỉ chạy 1 lần khi mở trang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────────
  const run = useCallback(async () => {
    if (files.length === 0 || !apiKey || isRunning) return;

    reset();
    setIsRunning(true);
    appendLog(`Gửi ${files.length} file, targetLang=${targetLang}...`);

    try {
      const formData = new FormData();
      formData.append('process', PROCESS);
      formData.append('targetLang', targetLang);
      // I7: dùng field `files` đúng cURL của SRS (field BLOS gọi thật). `normalizeFiles()`
      // vẫn nhận `files[]` cho caller cũ, nhưng trang này đi cùng nhánh với hệ tích hợp.
      files.forEach((f) => formData.append('files', f));

      const res = await fetch(SUBMIT_URL, {
        method: 'POST',
        body: formData,
        headers: { 'X-API-Key': apiKey },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.message || `API Error ${res.status}`);
      }

      const opId: string | undefined =
        typeof data.name === 'string' ? data.name.replace('operations/', '') : data.id;
      if (!opId) throw new Error('Response không có operation id.');

      const startedAt = new Date();
      setOperationId(opId);
      setOperationStartedAt(startedAt);
      setLookupId(opId);
      // Ghi nhớ ngay khi có operation ID, trước khi workflow chạy xong.
      rememberOperation(opId);
      appendLog(`Nhận operation ${opId}. Theo dõi foreground tối đa 2 phút.`);
      startPolling(opId, startedAt);
    } catch (err) {
      setIsRunning(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiKey, appendLog, files, isRunning, rememberOperation, reset, startPolling, targetLang]);

  // ── JSON actions ────────────────────────────────────────────────────────
  const jsonText = envelope ? JSON.stringify(envelope, null, 2) : '';

  const copyJson = useCallback(async () => {
    if (!jsonText) return;
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Không copy được vào clipboard (trình duyệt chặn).');
    }
  }, [jsonText]);

  const downloadJson = useCallback(() => {
    if (!jsonText) return;
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stem = safeStem(envelope?.data?.[0]?.fileName || operationId || 'result');
    a.download = `financial-report-${stem}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [envelope, jsonText, operationId]);

  const downloadMarkdown = useCallback(() => {
    if (!envelope) return;
    const blob = new Blob([financialReportToMarkdown(envelope)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stem = safeStem(envelope.data?.[0]?.fileName || operationId || 'result');
    a.download = `financial-report-${stem}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [envelope, operationId]);

  const copyOperationId = useCallback(async () => {
    if (!operationId) return;
    try {
      await navigator.clipboard.writeText(operationId);
      setOperationCopied(true);
      setTimeout(() => setOperationCopied(false), 2000);
    } catch {
      setError('Không copy được operation ID (trình duyệt chặn).');
    }
  }, [operationId]);

  const canRun = files.length > 0 && !!apiKey && !isRunning;
  const etaText = operationStartedAt
    ? formatCompletionEstimate(
      operationStartedAt,
      progressDetails?.total_pages,
      progressDetails?.seconds_per_page,
      progressPercent,
    )
    : null;
  const isLongRunningFile = (progressDetails?.total_pages ?? 0) >= LONG_FILE_PAGE_THRESHOLD;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen pb-20">
      <div className="max-w-6xl mx-auto px-4 pt-8 space-y-6">

        {/* Header */}
        <header className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs font-semibold text-amber-600 tracking-wider uppercase">
            Internal — Test workflow
          </div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold tracking-tight">
            <span className="text-gradient">OCR &amp; Dịch Báo cáo tài chính</span>
          </h1>
          <p className="text-muted-foreground text-sm max-w-2xl mx-auto leading-relaxed">
            Upload PDF báo cáo tài chính nước ngoài (tiếng Nhật hoặc tiếng Anh) → workflow{' '}
            <code className="font-mono text-xs">{PROCESS}</code> → JSON song ngữ chuẩn hóa.
            Sinh file Excel/Word nằm ngoài phạm vi DU (SRS §3.2).
          </p>
        </header>

        {/* Form */}
        <section className="modern-card p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="api-key" className="block text-xs font-semibold mb-1">
                API Key <span className="text-rose-500">*</span>
              </label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                placeholder="x-api-key"
                className={`w-full px-3 py-2 text-xs bg-background border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 ${
                  apiKey ? 'border-border' : 'border-rose-300'
                }`}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={isRunning}
              />
            </div>
            <div>
              <label htmlFor="target-lang" className="block text-xs font-semibold mb-1">
                Ngôn ngữ đích (targetLang)
              </label>
              <select
                id="target-lang"
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value === 'en' ? 'en' : 'vi')}
                disabled={isRunning}
              >
                <option value="vi">vi — Tiếng Việt</option>
                <option value="en">en — Tiếng Anh</option>
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Trình duyệt theo dõi trực tiếp trong 2 phút, sau đó tự kiểm tra nền mỗi 25 giây. Workflow chạy trên server nên bạn có thể đóng trang;
            mở lại bằng operation ID hoặc link `?operation=` để xem kết quả.
          </p>

          {/* Dropzone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Chọn file PDF báo cáo tài chính"
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer hover:border-primary/50 hover:bg-primary/5 ${
              isRunning ? 'pointer-events-none opacity-50' : 'border-border'
            }`}
            onClick={() => document.getElementById('fr-file-input')?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('fr-file-input')?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
            }}
          >
            <p className="font-semibold text-sm mb-1">Kéo thả PDF hoặc click để chọn</p>
            <p className="text-xs text-muted-foreground">Chỉ nhận .pdf — mỗi lần chạy có thể gửi nhiều file</p>
            <input
              id="fr-file-input"
              type="file"
              multiple
              accept=".pdf"
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/50 border border-border/50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{f.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatBytes(f.size)}</p>
                  </div>
                  {!isRunning && (
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Bỏ file ${f.name}`}
                      className="text-xs text-muted-foreground hover:text-destructive px-1"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="modern-button btn-primary text-sm gap-2 disabled:opacity-50"
            >
              {isRunning ? 'Đang xử lý...' : '▶ Chạy workflow'}
            </button>
            {(envelope || error) && !isRunning && (
              <button type="button" onClick={reset} className="modern-button btn-outline text-sm">
                ↻ Chạy lại
              </button>
            )}
            {operationId && (
              <div className="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px]" role="status" aria-live="polite">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Operation ID đã sẵn sàng:</span>
                  <code className="font-mono text-muted-foreground">{operationId}</code>
                  <button type="button" onClick={() => void copyOperationId()} className="modern-button btn-outline text-xs">
                    {operationCopied ? '✓ Đã copy' : 'Sao chép ID'}
                  </button>
                </div>
                {etaText && <p className="mt-1 text-muted-foreground">{etaText}</p>}
                {progressDetails?.total_pages && <p className="text-muted-foreground">File hiện tại: {progressDetails.total_pages} trang ({progressDetails.current_file}/{progressDetails.file_count}).</p>}
                {isLongRunningFile && <p className="mt-1 text-amber-700">PDF dài: workflow tiếp tục chạy nền an toàn; bạn có thể đóng trang và dùng ID/link này để mở lại.</p>}
              </div>
            )}
          </div>

          {isRunning && (
            <div className="space-y-1">
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 rounded-full"
                  style={{ width: `${Math.max(5, progressPercent)}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{progressPercent}%</p>
            </div>
          )}
        </section>

        <OperationsHistory
          key={operationId ?? 'initial'}
          disabled={isRunning}
          onSelect={(operationName) => {
            setLookupId(operationName.replace(/^operations\//, ''));
            void attachToOperation(operationName);
          }}
        />

        {/* Xem lại kết quả theo operation ID (I4) */}
        <section className="modern-card p-4 space-y-2">
          <h2 className="text-xs font-semibold">Xem lại kết quả đã chạy</h2>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Kết quả KHÔNG mất khi trình duyệt ngừng theo dõi. Dán operation ID để tải lại đầy đủ trên trang này.
            Với lần chạy do phiên hiện tại tạo, ưu tiên mục “Các lần chạy của tôi”; API key chỉ vẫn cần cho thao tác gửi workflow mới.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="text"
              placeholder="operation id (ví dụ 71f4dbd1-1a9b-4dcb-b3ad-63cf3c400943)"
              className="flex-1 min-w-[260px] px-3 py-2 text-xs font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && lookupId.trim() && !isRunning) {
                  e.preventDefault();
                  void attachToOperation(lookupId);
                }
              }}
              disabled={isRunning}
            />
            <button
              type="button"
              onClick={() => void attachToOperation(lookupId)}
              disabled={!lookupId.trim() || isRunning}
              className="modern-button btn-outline text-xs disabled:opacity-50"
            >
              Tải kết quả
            </button>
            {rememberedId && rememberedId !== operationId && (
              <button
                type="button"
                onClick={() => {
                  setLookupId(rememberedId);
                  void attachToOperation(rememberedId);
                }}
                disabled={isRunning}
                className="modern-button btn-outline text-xs disabled:opacity-50"
                title={rememberedId}
              >
                ↻ Operation gần nhất
              </button>
            )}
            <a href="/operations" className="text-xs text-muted-foreground hover:text-primary underline">
              Mở trang Operations
            </a>
          </div>
        </section>

        {/* Foreground window elapsed — this is not a workflow failure. */}
        {stillRunning && operationId && (
          <div className="modern-card p-4 border-amber-500/40 bg-amber-500/5 space-y-2" role="status">
            <p className="text-sm font-medium text-amber-700">
              Đã kết thúc theo dõi foreground sau 2 phút. Workflow vẫn đang chạy trên server và kết quả sẽ được lưu vào operation.
            </p>
            {etaText && <p className="text-[11px] text-amber-700">{etaText}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void attachToOperation(operationId)}
                className="modern-button btn-primary text-xs"
              >
                Tải lại kết quả
              </button>
              <button
                type="button"
                onClick={() => void copyOperationId()}
                className="modern-button btn-outline text-xs"
              >
                {operationCopied ? '✓ Đã copy' : 'Sao chép operation ID'}
              </button>
              <code className="text-[11px] text-muted-foreground font-mono">{operationId}</code>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="modern-card p-4 border-destructive/30 bg-destructive/5">
            <p className="text-sm font-medium text-destructive">{error}</p>
            {isWorkflowDeadlineFailure(error) && (
              <p className="mt-2 text-xs leading-relaxed text-destructive/90">{WORKFLOW_DEADLINE_GUIDANCE}</p>
            )}
          </div>
        )}

        {/* Log */}
        {logs.length > 0 && (
          <details className="modern-card p-4" open={isRunning}>
            <summary className="text-xs font-semibold cursor-pointer">Log tiến trình ({logs.length})</summary>
            <pre className="mt-2 text-[11px] text-muted-foreground bg-muted/50 rounded-lg p-2 whitespace-pre-wrap break-words max-h-72 overflow-y-auto font-mono leading-relaxed">
              {logs.join('\n')}
            </pre>
          </details>
        )}

        {/* Result */}
        {envelope && (
          <section className="space-y-4">
            <div className={`modern-card p-4 flex flex-wrap items-center gap-3 ${envelopeMeta(envelope.code).card}`}>
              <div className="flex-1 min-w-[200px]">
                <p className="text-xs">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold mr-2 ${envelopeMeta(envelope.code).badge}`}
                  >
                    code={envelope.code}
                  </span>
                  <span className={envelopeMeta(envelope.code).text}>{envelope.message}</span>
                </p>
                <p className="text-[11px] text-muted-foreground font-mono">
                  requestId={envelope.requestId} · targetLang={envelope.targetLang} · {envelope.timestamp}
                </p>
              </div>
              <button type="button" onClick={copyJson} className="modern-button btn-outline text-xs">
                {copied ? '✓ Đã copy' : 'Copy JSON'}
              </button>
              <button type="button" onClick={downloadJson} className="modern-button btn-outline text-xs">
                Download JSON
              </button>
              <button type="button" onClick={downloadMarkdown} className="modern-button btn-outline text-xs">
                Download Markdown
              </button>
            </div>

            {(envelope.data ?? []).map((fileResult) => (
              <FileResultView key={fileResult.fileId} result={fileResult} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Kết quả 1 file ───────────────────────────────────────────────────────────

// CODE-REVIEW-01 mục 16: contract Q7 có 3 trạng thái. Trước đây chỉ phân biệt FAILED nên
// PARTIAL_SUCCESS bị tô xanh như thành công và errorCode/errorMessage bị ẩn hoàn toàn.
const FILE_STATUS_META: Record<FileStatus, { card: string; badge: string; note: string }> = {
  SUCCESS: {
    card: '',
    badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    note: '',
  },
  PARTIAL_SUCCESS: {
    card: 'border-amber-500/40 bg-amber-500/5',
    badge: 'bg-amber-500/10 text-amber-600 border-amber-500/40',
    note: 'Có dữ liệu nhưng THIẾU một phần — kiểm tra phần "Quá trình xử lý" bên dưới trước khi dùng số.',
  },
  FAILED: {
    card: 'border-destructive/30 bg-destructive/5',
    badge: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
    note: 'Không có dữ liệu nào được trả về cho file này.',
  },
};

// [I] Vòng #05 mục 42: 6 report xếp dọc 1 trang (balanceSheet 50 dòng × 2 kỳ, notes 18 section)
// khiến người soát phải cuộn rất nhiều. Chia tab + badge status ngay trên tab để nhìn hàng tab
// là biết file có vấn đề ở đâu.
const OVERVIEW_TAB = 'overview' as const;
type ActiveTab = typeof OVERVIEW_TAB | ReportType;

/** Nhãn ngắn cho thanh tab (nhãn đầy đủ vẫn ở trong ReportSection). */
const TAB_LABELS: Record<ReportType, string> = {
  balanceSheet: 'Cân đối KT',
  incomeStatement: 'Kết quả HĐKD',
  comprehensiveIncome: 'Thu nhập toàn diện',
  cashFlowStatement: 'Lưu chuyển tiền',
  equityChangeStatement: 'Biến động VCSH',
  sgaBreakdown: 'Chi phí BH&QL',
  notesToFinancialStatements: 'Thuyết minh',
};

/** Dấu tròn màu theo status — đọc được cả khi tab không active. */
const TAB_DOT: Record<ReportStatus, string> = {
  FOUND: 'bg-emerald-500',
  PARTIAL: 'bg-amber-500',
  NOT_FOUND: 'bg-muted-foreground/40',
  UNREADABLE: 'bg-rose-500',
};

function FileResultView({ result }: { result: FileResult }) {
  const meta = FILE_STATUS_META[result.status] ?? FILE_STATUS_META.FAILED;
  const degraded = result.status !== 'SUCCESS';
  const [activeTab, setActiveTab] = useState<ActiveTab>(OVERVIEW_TAB);

  const report = result.report;
  const stem = safeStem(result.fileName);
  const visibleReportTypes = report
    ? REPORT_TYPES.filter((reportType) => report[reportType] !== undefined)
    : [];

  const statusOf = (reportType: ReportType): ReportStatus => {
    const data = report?.[reportType];
    return data?.status ?? 'UNREADABLE';
  };

  return (
    <div className="space-y-3">
      <div className={`modern-card p-4 ${meta.card}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading font-bold text-base">{result.fileName}</h2>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.badge}`}
          >
            {result.status}
          </span>
          <code className="text-[10px] text-muted-foreground font-mono">{result.fileId}</code>
        </div>

        {/* LUÔN hiện errorCode/errorMessage khi có, không chỉ riêng FAILED. */}
        {degraded && (result.errorCode || result.errorMessage) && (
          <p className={`mt-2 text-sm ${result.status === 'FAILED' ? 'text-destructive' : 'text-amber-700'}`}>
            <code className="font-mono font-bold">{result.errorCode}</code>
            {result.errorMessage && <> — {result.errorMessage}</>}
            {/* `diagnostic` là chi tiết kỹ thuật, KHÔNG nằm trong errorMessage (câu cho người
                dùng cuối). Trang này là trang nội bộ nên hiện ra để DEV khỏi phải đọc log
                container — đúng ca đã gặp: errorCode nói "ảnh mờ" trong khi nguyên nhân thật
                là một lời gọi AI thất bại ở trang 21-22. */}
            {result.diagnostic && (
              <span className="mt-1 block font-mono text-xs text-muted-foreground">
                {result.diagnostic}
              </span>
            )}
          </p>
        )}
        {degraded && meta.note && <p className="mt-1 text-xs text-muted-foreground">{meta.note}</p>}

        {/* Thanh tab */}
        {report && (
          <div role="tablist" aria-label={`Báo cáo của ${result.fileName}`} className="mt-4 flex flex-wrap gap-1">
            <button
              type="button"
              role="tab"
              id={`${result.fileId}-tab-${OVERVIEW_TAB}`}
              aria-selected={activeTab === OVERVIEW_TAB}
              aria-controls={`${result.fileId}-panel-${OVERVIEW_TAB}`}
              onClick={() => setActiveTab(OVERVIEW_TAB)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                activeTab === OVERVIEW_TAB
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted'
              }`}
            >
              Tổng quan
            </button>
            {visibleReportTypes.map((reportType) => {
              const status = statusOf(reportType);
              const active = activeTab === reportType;
              return (
                <button
                  key={reportType}
                  type="button"
                  role="tab"
                  id={`${result.fileId}-tab-${reportType}`}
                  aria-selected={active}
                  aria-controls={`${result.fileId}-panel-${reportType}`}
                  onClick={() => setActiveTab(reportType)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${TAB_DOT[status] ?? TAB_DOT.UNREADABLE}`} aria-hidden />
                  {TAB_LABELS[reportType]}
                  <span className="sr-only"> — trạng thái {status}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {report && activeTab === OVERVIEW_TAB && (
        <div
          role="tabpanel"
          id={`${result.fileId}-panel-${OVERVIEW_TAB}`}
          aria-labelledby={`${result.fileId}-tab-${OVERVIEW_TAB}`}
          className="modern-card p-4"
        >
          {result.processingInfo && <ProcessingInfoView info={result.processingInfo} />}
          <GeneralInfoView info={report.generalInformation} />
          <ReportStatusOverview result={result} onSelect={setActiveTab} />
        </div>
      )}

      {report &&
        visibleReportTypes.filter((reportType) => reportType === activeTab).map((reportType) => {
          const data = report[reportType];
          if (!data) return null;
          return (
          <div
            key={reportType}
            role="tabpanel"
            id={`${result.fileId}-panel-${reportType}`}
            aria-labelledby={`${result.fileId}-tab-${reportType}`}
            className="space-y-2"
          >
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => downloadObject(`${stem}-${reportType}.json`, data)}
                className="modern-button btn-outline text-xs"
              >
                Download JSON — {TAB_LABELS[reportType]}
              </button>
            </div>
            <ReportSection
              reportType={reportType}
              report={data}
              defaultOpen
            />
          </div>
          );
        })}

      {/* File FAILED: không có report nào, không dựng tab. */}
      {!report && result.processingInfo && (
        <div className="modern-card p-4">
          <ProcessingInfoView info={result.processingInfo} />
        </div>
      )}
    </div>
  );
}

/** Bảng tổng hợp status + warning của 6 report, click để nhảy sang tab tương ứng. */
function ReportStatusOverview({
  result,
  onSelect,
}: {
  result: FileResult;
  onSelect: (tab: ActiveTab) => void;
}) {
  const report = result.report;
  if (!report) return null;

  const visibleReportTypes = REPORT_TYPES.filter((reportType) => report[reportType] !== undefined);

  return (
    <div className="mt-4 overflow-x-auto">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        6 báo cáo
      </p>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-semibold">Báo cáo</th>
            <th className="py-1 pr-3 font-semibold">Trạng thái</th>
            <th className="py-1 font-semibold">Cảnh báo</th>
          </tr>
        </thead>
        <tbody>
          {visibleReportTypes.map((reportType) => {
            const data = report[reportType];
            if (!data) return null;
            const warnings = data.warnings;
            return (
              <tr key={reportType} className="border-t border-border/50 align-top">
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelect(reportType)}
                    className="text-left font-medium hover:text-primary hover:underline"
                  >
                    {TAB_LABELS[reportType]}
                  </button>
                </td>
                <td className="py-1.5 pr-3">
                  <StatusBadge status={data?.status ?? 'UNREADABLE'} />
                </td>
                <td className="py-1.5 text-[11px] text-muted-foreground">
                  {warnings.length === 0 ? (
                    '—'
                  ) : (
                    <ul className="space-y-0.5">
                      {warnings.map((warning, index) => (
                        <li key={`${warning.code}-${index}`}>
                          <code className="font-mono text-amber-700">{warning.code}</code>
                          {warning.message ? ` — ${warning.message}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── processingInfo (mục 16 / Q7) ─────────────────────────────────────────────

function formatRanges(ranges: PageRange[]): string {
  if (!ranges || ranges.length === 0) return '—';
  return ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(', ');
}

const TRANSLATION_STATUS_LABEL: Record<FileProcessingInfo['translationStatus'], string> = {
  DONE: 'đã dịch xong',
  SKIPPED: 'tắt chủ động',
  PARTIAL: 'dịch thiếu một phần',
  FAILED: 'dịch thất bại',
};

/** Tên field đọc đúng theo types.ts::FileProcessingInfo. */
function ProcessingInfoView({ info }: { info: FileProcessingInfo }) {
  const hasChunkLoss = info.extractChunksFailed > 0 || info.classifyWindowsFailed > 0;
  const translationBad = info.translationStatus === 'FAILED' || info.translationStatus === 'PARTIAL';

  const items: Array<[string, React.ReactNode, boolean]> = [
    ['Số trang', info.totalPages, false],
    ['Loại báo cáo nhận diện', `${info.reportsFound}/7`, info.reportsFound === 0],
    [
      'Chunk bóc tách lỗi',
      `${info.extractChunksFailed}/${info.extractChunksTotal}`,
      info.extractChunksFailed > 0,
    ],
    [
      'Cửa sổ phân loại lỗi',
      `${info.classifyWindowsFailed}/${info.classifyWindowsTotal}`,
      info.classifyWindowsFailed > 0,
    ],
    ['Trang không bóc được', formatRanges(info.failedPageRanges), info.failedPageRanges.length > 0],
    [
      'Bước dịch',
      `${info.translationStatus} — ${TRANSLATION_STATUS_LABEL[info.translationStatus] ?? ''}`,
      translationBad,
    ],
    ['Nội dung chưa dịch', info.untranslatedItems, info.untranslatedItems > 0],
  ];

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Quá trình xử lý
      </p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-xs">
        {items.map(([label, value, warn]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-muted-foreground min-w-[140px]">{label}</dt>
            <dd className={`font-medium ${warn ? 'text-amber-700 font-bold' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {/* Lý do THẬT của từng cửa sổ/chunk lỗi. Không có phần này thì không phân biệt được
          "AI quá tải" với "PDF mờ" mà phải vào container đọc log. */}
      {info.failureReasons.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
            Lý do lỗi kỹ thuật ({info.failureReasons.length})
          </summary>
          <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
            {info.failureReasons.map((reason, i) => (
              <li key={i} className="break-all">• {reason}</li>
            ))}
          </ul>
        </details>
      )}
      {(hasChunkLoss || info.failedPageRanges.length > 0) && (
        <p className="mt-2 text-[11px] text-amber-700">
          Các trang trên KHÔNG được bóc tách — cần đọc tay để bù dữ liệu.
        </p>
      )}
    </div>
  );
}

function GeneralInfoView({ info }: { info: GeneralInformation }) {
  const items: Array<[string, React.ReactNode]> = [
    [
      'Tên công ty',
      <>
        {info.companyName.source ?? '—'}
        {info.companyName.translated && <span className="text-primary"> / {info.companyName.translated}</span>}
      </>,
    ],
    ['Ngôn ngữ nguồn', info.sourceLanguage],
    ['Ngôn ngữ đích', info.targetLanguage],
    ['Từ ngày', info.fromDate ?? '—'],
    ['Đến ngày', info.toDate ?? '—'],
    ['Tiền tệ', info.currency ?? '—'],
    [
      'Đơn vị',
      <>
        {info.unit.source ?? '—'}
        {info.unit.translated && <span className="text-primary"> / {info.unit.translated}</span>}
        {info.unit.multiplier ? (
          <span className="text-muted-foreground"> (×{info.unit.multiplier.toLocaleString('vi-VN')})</span>
        ) : null}
      </>,
    ],
  ];

  return (
    <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="text-muted-foreground min-w-[100px]">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
