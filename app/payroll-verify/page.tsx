'use client';

// app/payroll-verify/page.tsx
// Payroll Verify Demo — Upload PDF + Excel → Call payroll-verify workflow → Show results.

import React, { useState, useCallback } from 'react';
import type { PipelineStep, StepStatus, UploadedFile } from './types';
import { usePayrollPolling } from './hooks/usePayrollPolling';
import { ResultPanel } from './components/ResultPanel';

// ─── Initial Steps ────────────────────────────────────────────────────────────

function getInitialSteps(): PipelineStep[] {
  return [
    {
      id: 'classify',
      title: 'Phân loại file',
      subtitle: 'Xác định file PDF và Excel',
      icon: '📁',
      accentColor: 'from-violet-500 to-indigo-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
    {
      id: 'process',
      title: 'OCR PDF + Parse Excel',
      subtitle: 'Xử lý song song: OCR từng trang PDF & Parse bảng Excel',
      icon: '🔍',
      accentColor: 'from-cyan-500 to-blue-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
    {
      id: 'compare',
      title: 'Đối chiếu',
      subtitle: 'So sánh dữ liệu PDF vs Excel theo rules',
      icon: '⚖️',
      accentColor: 'from-amber-500 to-orange-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFileIcon(name: string): string {
  if (name.endsWith('.pdf')) return '📄';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return '📊';
  if (name.endsWith('.csv')) return '📊';
  return '📎';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PayrollVerifyPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [realFiles, setRealFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>(getInitialSteps());
  const [resultData, setResultData] = useState<any>(null);
  const [apiKeyId, setApiKeyId] = useState('');

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const resetPipeline = useCallback(() => {
    setSteps(getInitialSteps());
    setPipelineComplete(false);
    setPipelineError(null);
    setResultData(null);
  }, []);

  const revealStep = useCallback((stepIdx: number, backendStep: Record<string, unknown>) => {
    setSteps(prev => {
      const newSteps = [...prev];
      if (stepIdx >= newSteps.length) return prev;
      const existingOutput = newSteps[stepIdx].output;
      const newPreview = backendStep.content_preview
        ? JSON.stringify(backendStep.content_preview, null, 2)
        : null;
      // Keep accumulated log from running phase, append final result below
      const finalOutput = existingOutput && newPreview
        ? `${existingOutput}\n\n── Kết quả ──\n${newPreview}`
        : existingOutput || newPreview;
      newSteps[stepIdx] = {
        ...newSteps[stepIdx],
        status: 'done',
        progress: 100,
        output: finalOutput,
      };
      // Mark next step as running
      const nextIdx = stepIdx + 1;
      if (nextIdx < newSteps.length && newSteps[nextIdx].status === 'pending') {
        newSteps[nextIdx] = { ...newSteps[nextIdx], status: 'running', progress: 15 };
      }
      return newSteps;
    });
  }, []);

  // ── Polling Hook ──────────────────────────────────────────────────────────
  const polling = usePayrollPolling({
    onStepReveal: revealStep,
    onComplete: (extractedData) => {
      setResultData(extractedData);
      setPipelineComplete(true);
      setIsProcessing(false);
      // Mark all steps done
      setSteps(prev => prev.map(s => s.status !== 'done' ? { ...s, status: 'done', progress: 100 } : s));
    },
    onError: (stepIdx, message) => {
      setSteps(prev => prev.map((s, idx) =>
        idx === stepIdx ? { ...s, status: 'error' as StepStatus, output: message } : s
      ));
      setPipelineError(message);
      setPipelineComplete(true);
      setIsProcessing(false);
    },
    onProgress: (stepIdx, percent, message) => {
      setSteps(prev => prev.map((s, idx) =>
        idx === stepIdx && s.status !== 'done'
          ? { ...s, status: 'running' as StepStatus, progress: percent, output: message ?? s.output }
          : s
      ));
    },
  });

  // ── File handling ─────────────────────────────────────────────────────────
  const handleFileInput = useCallback((fileList: FileList) => {
    const newFiles: UploadedFile[] = Array.from(fileList).map(f => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      type: f.type,
      icon: getFileIcon(f.name),
    }));
    setFiles(prev => [...prev, ...newFiles]);
    setRealFiles(prev => [...prev, ...Array.from(fileList)]);
    resetPipeline();
  }, [resetPipeline]);

  const handleFileRemoved = useCallback((id: string) => {
    const idx = files.findIndex(f => f.id === id);
    setFiles(prev => prev.filter(f => f.id !== id));
    setRealFiles(prev => prev.filter((_, i) => i !== idx));
    resetPipeline();
  }, [files, resetPipeline]);

  const handleClearAll = useCallback(() => {
    setFiles([]);
    setRealFiles([]);
    resetPipeline();
    // Reset file input value so same files can be re-selected
    const input = document.getElementById('file-input') as HTMLInputElement | null;
    if (input) input.value = '';
  }, [resetPipeline]);

  // ── Run Pipeline ──────────────────────────────────────────────────────────
  const runPipeline = async () => {
    if (files.length < 2 || isProcessing) return;
    setIsProcessing(true);
    setPipelineError(null);
    setResultData(null);
    resetPipeline();

    setSteps(prev => prev.map((s, idx) =>
      idx === 0 ? { ...s, status: 'running' as StepStatus, progress: 5 } : s
    ));

    try {
      await polling.submitWorkflow(files, realFiles, apiKeyId || undefined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSteps(prev => prev.map((s, idx) =>
        idx === 0 ? { ...s, status: 'error' as StepStatus, output: msg } : s
      ));
      setPipelineError(msg);
      setPipelineComplete(true);
      setIsProcessing(false);
    }
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const hasPdf = files.some(f => f.name.toLowerCase().endsWith('.pdf'));
  const hasExcel = files.some(f => /\.(xlsx|xls|csv)$/i.test(f.name));
  const canRun = hasPdf && hasExcel && !isProcessing && !!apiKeyId;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen pb-20 relative overflow-hidden">
      <div className="glow-purple -top-60 -left-40 fixed opacity-30" aria-hidden="true" />
      <div className="glow-cyan -bottom-40 -right-60 fixed opacity-20" aria-hidden="true" />

      {/* Header */}
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-6">
        <div className="text-center mb-2">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary tracking-wider uppercase mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            Payroll Verify — Live API
          </div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold tracking-tight mb-3">
            <span className="text-gradient">Đối chiếu Bảng lương</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Upload file PDF (bảng lương scan) + file Excel (nguồn) → OCR → So sánh → Kết quả APPROVED / REVIEW_REQUIRED
          </p>

          {/* API Key input — bắt buộc */}
          <div className="mt-4 mx-auto max-w-sm">
            <input
              type="password"
              placeholder="Nhập API Key (bắt buộc)"
              className={`w-full px-3 py-2 text-xs bg-background border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-center ${!apiKeyId ? 'border-red-300' : 'border-border'}`}
              value={apiKeyId}
              onChange={(e) => setApiKeyId(e.target.value)}
              disabled={isProcessing}
            />
            {!apiKeyId && <p className="text-[10px] text-red-500 mt-1">Vui lòng nhập API Key để sử dụng</p>}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 space-y-6">

        {/* ─── Upload Zone ─────────────────────────────────────────────── */}
        <div className="modern-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg">📁</div>
            <div>
              <h2 className="font-heading font-bold text-lg">Upload Hồ sơ</h2>
              <p className="text-muted-foreground text-xs">
                Cần ít nhất 1 file PDF + 1 file Excel (.xlsx)
              </p>
            </div>
          </div>

          {/* Dropzone */}
          <div
            role="button"
            tabIndex={0}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer hover:border-primary/50 hover:bg-primary/5 ${isProcessing ? 'pointer-events-none opacity-50' : 'border-border'}`}
            onClick={() => document.getElementById('file-input')?.click()}
            onKeyDown={(e) => e.key === 'Enter' && document.getElementById('file-input')?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length > 0) handleFileInput(e.dataTransfer.files); }}
          >
            <div className="text-4xl mb-2">📤</div>
            <p className="font-semibold text-sm mb-1">Kéo thả file hoặc click để chọn</p>
            <p className="text-xs text-muted-foreground">PDF (bảng lương scan) + Excel (file nguồn)</p>
            <input
              id="file-input"
              type="file"
              multiple
              accept=".pdf,.xlsx"
              className="hidden"
              onChange={e => e.target.files && handleFileInput(e.target.files)}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {files.length} file đã chọn
                  {!hasPdf && <span className="text-red-500 ml-2">⚠ Thiếu PDF</span>}
                  {!hasExcel && <span className="text-red-500 ml-2">⚠ Thiếu Excel</span>}
                </span>
                {!isProcessing && (
                  <button onClick={handleClearAll} className="text-xs text-destructive hover:text-destructive/80 font-medium">
                    Xóa tất cả
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/50 border border-border/50 group hover:border-primary/30 transition-all">
                    <span className="text-xl flex-shrink-0">{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                    </div>
                    {!isProcessing && (
                      <button
                        onClick={() => handleFileRemoved(f.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded-lg transition-all"
                      >
                        <span className="text-xs text-muted-foreground hover:text-destructive">✕</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action button */}
        {files.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={runPipeline}
              disabled={!canRun || pipelineComplete}
              className="modern-button btn-primary text-sm gap-2 flex-1 sm:flex-none disabled:opacity-50"
            >
              {isProcessing ? (
                <><Spinner /> Đang xử lý...</>
              ) : pipelineComplete && !pipelineError ? (
                <>✓ Hoàn tất</>
              ) : (
                <>▶ Bắt đầu Đối chiếu</>
              )}
            </button>
            {pipelineComplete && (
              <button onClick={resetPipeline} className="modern-button btn-outline text-sm">
                ↻ Chạy lại
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {pipelineError && (
          <div className="modern-card p-4 border-destructive/30 bg-destructive/5 flex items-center gap-3">
            <span className="text-destructive text-lg">⚠️</span>
            <p className="text-sm font-medium text-destructive flex-1">{pipelineError}</p>
          </div>
        )}

        {/* ─── Pipeline Steps ──────────────────────────────────────────── */}
        {files.length > 0 && (isProcessing || pipelineComplete) && (
          <div className="space-y-3">
            {steps.map((step, i) => (
              <StepCard key={step.id} step={step} index={i} />
            ))}
          </div>
        )}

        {/* ─── Result Panel ────────────────────────────────────────────── */}
        {resultData && (
          <>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // Capture the rendered ResultPanel area as a standalone HTML file
                  const resultEl = document.getElementById('payroll-result-panel');
                  if (!resultEl) return;
                  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
                    .map(el => el.outerHTML).join('\n');
                  const html = `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Payroll Verify Result</title>${styles}</head>
<body class="${document.body.className}">${resultEl.outerHTML}</body></html>`;
                  const blob = new Blob([html], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `payroll-verify-${polling.operationId?.slice(0, 8) || 'result'}.html`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="modern-button btn-outline text-sm gap-2"
              >
                📥 Tải HTML
              </button>
            </div>
            <div id="payroll-result-panel">
              <ResultPanel data={resultData} />
            </div>
          </>
        )}
      </div>

      {/* Floating progress */}
      {isProcessing && (
        <div className="fixed bottom-6 right-6 px-4 py-2.5 rounded-2xl bg-card/90 backdrop-blur-xl border border-primary/20 shadow-lg flex items-center gap-3 z-50">
          <Spinner />
          <span className="text-sm font-medium">Đang đối chiếu...</span>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepCard({ step, index }: { step: PipelineStep; index: number }) {
  let statusIcon: React.ReactNode;
  if (step.status === 'running') statusIcon = <Spinner />;
  else if (step.status === 'done') statusIcon = <span className="text-emerald-500">✓</span>;
  else if (step.status === 'error') statusIcon = <span className="text-destructive">✕</span>;
  else statusIcon = <span className="text-muted-foreground">{step.icon}</span>;

  return (
    <div className={`modern-card p-4 flex items-center gap-4 transition-all ${
      step.status === 'running' ? 'ring-1 ring-primary/40' : ''
    } ${step.status === 'error' ? 'ring-1 ring-destructive/40' : ''} ${step.status === 'pending' ? 'opacity-50' : ''}`}>
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-lg flex-shrink-0">
        {statusIcon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground uppercase">Bước {index + 1}</span>
          {step.status === 'running' && <span className="text-[10px] text-primary font-medium animate-pulse">Đang xử lý...</span>}
        </div>
        <h3 className="font-bold text-sm">{step.title}</h3>
        <p className="text-xs text-muted-foreground">{step.subtitle}</p>
        {(step.status === 'running' || step.status === 'done') && (
          <div className="mt-2 w-full h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${step.status === 'done' ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${step.progress}%` }}
            />
          </div>
        )}
        {step.status === 'error' && step.output && (
          <p className="mt-1 text-xs text-destructive">{step.output}</p>
        )}
        {step.status === 'running' && step.output && (
          <pre className="mt-2 text-[11px] text-muted-foreground bg-muted/50 rounded-lg p-2 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed">
            {step.output}
          </pre>
        )}
        {step.status === 'done' && step.output && (
          <details className="mt-2">
            <summary className="text-xs text-primary cursor-pointer hover:underline">Xem log</summary>
            <pre className="mt-1 text-[11px] text-muted-foreground bg-muted/50 rounded-lg p-2 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed">
              {step.output}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
