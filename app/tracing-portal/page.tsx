'use client';

// app/tracing-portal/page.tsx
// Tracing Portal — Upload BBKQ (biên bản kiểm quỹ) CDM/ATM → OCR extraction quality test.

import React, { useState, useCallback, useRef } from 'react';
import { Upload, Loader2, CheckCircle, XCircle, FileText, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useTracingPolling } from './hooks/useTracingPolling';
import { ResultTable } from './components/ResultTable';
import type { ProcessingStatus, TracingResult } from './types';

const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.tiff,.tif,.webp';
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/webp'];
const MAX_FILES = 20;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function TracingPortalPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState<TracingResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { status, progressPercent, progressMessage, elapsedSeconds, submit, reset: resetPolling } =
    useTracingPolling({
      onComplete: (data) => {
        setResult(data);
        toast.success(`Hoàn tất! Trích xuất ${data.tong_so_tai_lieu} tài liệu.`);
      },
      onError: (message) => {
        setErrorMessage(message);
        toast.error(message);
      },
      onProgress: () => {},
    });

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const newFiles = Array.from(incoming).filter((f) => {
      const valid = ACCEPTED_TYPES.includes(f.type) || /\.(pdf|png|jpe?g|tiff?|webp)$/i.test(f.name);
      if (!valid) toast.error(`File không hợp lệ: ${f.name}. Chỉ chấp nhận PDF và ảnh.`);
      return valid;
    });
    const combined = [...files, ...newFiles];
    if (combined.length > MAX_FILES) {
      toast.warning(`Tối đa ${MAX_FILES} file.`);
    }
    setFiles(combined.slice(0, MAX_FILES));
  }, [files]);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleSubmit = useCallback(() => {
    if (files.length === 0) { toast.warning('Vui lòng chọn ít nhất 1 file.'); return; }
    if (!apiKey.trim()) { toast.warning('Vui lòng nhập API Key.'); return; }
    setErrorMessage(null);
    setResult(null);
    submit(files, apiKey.trim());
  }, [files, apiKey, submit]);

  const handleReset = useCallback(() => {
    resetPolling();
    setFiles([]);
    setResult(null);
    setErrorMessage(null);
  }, [resetPolling]);

  const isBusy = status === 'uploading' || status === 'processing';
  const isDone = status === 'done';
  const isError = status === 'error';
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Kiểm quỹ CDM/ATM</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Upload biên bản kiểm quỹ để test chất lượng OCR</p>
        <div className="mt-3 max-w-sm">
          <input
            type="password"
            placeholder="Nhập API Key (bắt buộc)"
            className={`w-full px-3 py-2 text-sm bg-transparent border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500/50 ${!apiKey ? 'border-red-300 dark:border-red-700' : 'border-zinc-300 dark:border-zinc-600'}`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={isBusy}
          />
          {!apiKey && <p className="text-xs text-red-500 dark:text-red-400 mt-1">Vui lòng nhập API Key để sử dụng</p>}
        </div>
      </div>

      {/* Upload Card */}
      <div className="modern-card p-6 space-y-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Kéo thả hoặc nhấn để chọn file PDF/ảnh biên bản kiểm quỹ"
          className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors cursor-pointer
            ${isDragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20' : 'border-zinc-300 dark:border-zinc-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/30'}
            ${isBusy ? 'pointer-events-none opacity-50' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        >
          <Upload className="w-8 h-8 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Kéo thả file vào đây hoặc <span className="text-blue-600 dark:text-blue-400 underline">chọn file</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">PDF, PNG, JPG, TIFF — Tối đa {MAX_FILES} file</p>
          </div>
          <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} aria-hidden="true" tabIndex={-1} />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Đã chọn
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold">{files.length}</span>
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatBytes(totalSize)}</span>
            </div>
            <ul className="max-h-48 overflow-y-auto space-y-1 pr-1" aria-label="Danh sách file đã chọn">
              {files.map((file, idx) => (
                <li key={`${file.name}-${idx}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
                    <span className="truncate text-zinc-700 dark:text-zinc-300" title={file.name}>{file.name}</span>
                    <span className="shrink-0 text-xs text-zinc-400">{formatBytes(file.size)}</span>
                  </div>
                  {!isBusy && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="shrink-0 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-colors" aria-label={`Xóa file ${file.name}`}>
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleSubmit} disabled={files.length === 0 || isBusy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white disabled:text-zinc-500 dark:disabled:text-zinc-400 font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900">
            {isBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
            {status === 'uploading' ? 'Đang upload...' : status === 'processing' ? 'Đang xử lý...' : 'Trích xuất'}
          </button>
          {(isDone || isError || files.length > 0) && (
            <button type="button" onClick={handleReset} disabled={isBusy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-sm transition-colors">
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              Làm lại
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {isBusy && (
        <div className="modern-card p-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{progressMessage || 'Đang xử lý...'}</span>
            <span className="text-zinc-500 dark:text-zinc-400">{formatDuration(elapsedSeconds)}</span>
          </div>
          <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out" style={{ width: `${Math.max(progressPercent, 5)}%` }} />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{progressPercent}% hoàn tất • {files.length} file đang xử lý</p>
        </div>
      )}

      {/* Error */}
      {isError && errorMessage && (
        <div className="modern-card border-red-200 dark:border-red-800 p-6">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-medium text-red-700 dark:text-red-400">Lỗi xử lý</p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-300">{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {isDone && result && (
        <div className="modern-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Kết quả trích xuất</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{result.tong_so_tai_lieu} tài liệu</span>
              <span>•</span>
              <span>{formatDuration(elapsedSeconds)}</span>
            </div>
          </div>
          <ResultTable documents={result.danh_sach_tai_lieu} />
        </div>
      )}
    </div>
  );
}
