'use client';

// app/doc-compare/page.tsx
// So sánh Văn bản Nâng cao — Upload 2 văn bản, phân tích mục lục, so sánh từng mục

import React, { useState, useRef, useCallback, useMemo } from 'react';
import type { PipelineStep, StepStatus, UploadedFile } from './types';
import { getInitialSteps, getFileIcon, formatBytes } from './lib/mock-data';
import { useWorkflowPolling } from './hooks/useWorkflowPolling';

import { PipelineStepCard } from '@/app/doc-pipeline/components/PipelineStepCard';
import { CompletionBanner } from '@/app/doc-pipeline/components/CompletionBanner';
import { SpinnerIcon, CheckIcon } from '@/app/doc-pipeline/components/Icons';

// ─── File Slot Component ──────────────────────────────────────────────────────

interface FileSlotProps {
  label: string;
  slotIndex: number;
  file: UploadedFile | null;
  isProcessing: boolean;
  onFileSelected: (file: UploadedFile, realFile: File, slotIndex: number) => void;
  onFileRemoved: (slotIndex: number) => void;
}

function FileSlot({ label, slotIndex, file, isProcessing, onFileSelected, onFileRemoved }: FileSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (rawFile: File) => {
    const uploaded: UploadedFile = {
      id: `slot-${slotIndex}-${Date.now()}`,
      name: rawFile.name,
      size: rawFile.size,
      type: rawFile.type,
      icon: getFileIcon(rawFile.name),
    };
    onFileSelected(uploaded, rawFile, slotIndex);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  };

  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">{label}</p>
      {file ? (
        <div className="modern-card p-4 flex items-center gap-3 border-blue-500/20 bg-blue-500/5">
          <span className="text-2xl">{file.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          </div>
          {!isProcessing && (
            <button
              onClick={() => onFileRemoved(slotIndex)}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors p-1"
              aria-label="Xóa file"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-200 ${
            isDragging
              ? 'border-blue-500/60 bg-blue-500/10'
              : 'border-border hover:border-blue-500/40 hover:bg-muted/30'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <span className="text-2xl opacity-50">📄</span>
          <p className="text-xs text-muted-foreground text-center">
            Kéo thả hoặc <span className="text-blue-400">chọn file</span>
          </p>
          <p className="text-[10px] text-muted-foreground/60">PDF, DOCX, XLSX</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.doc,.xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            disabled={isProcessing}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DocComparePage() {
  const [files, setFiles] = useState<(UploadedFile | null)[]>([null, null]);
  const [realFiles, setRealFiles] = useState<(File | null)[]>([null, null]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [testApiKeyId, setTestApiKeyId] = useState('');
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [steps, setSteps] = useState<PipelineStep[]>(getInitialSteps());

  const currentRunningStep = useMemo(
    () => steps.findIndex(s => s.status === 'running'),
    [steps],
  );

  const allFilesReady = files[0] !== null && files[1] !== null;

  const resetPipeline = useCallback(() => {
    setSteps(getInitialSteps());
    setPipelineComplete(false);
    setPipelineError(null);
  }, []);

  const toggleCollapse = useCallback((stepIndex: number) => {
    setSteps(prev => prev.map((s, idx) =>
      idx === stepIndex ? { ...s, isCollapsed: !s.isCollapsed } : s,
    ));
  }, []);

  const scrollToStep = useCallback((stepIdx: number) => {
    setTimeout(() => {
      stepRefs.current[stepIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }, []);

  const handleFileSelected = useCallback((file: UploadedFile, realFile: File, slotIndex: number) => {
    setFiles(prev => { const n = [...prev]; n[slotIndex] = file; return n; });
    setRealFiles(prev => { const n = [...prev]; n[slotIndex] = realFile; return n; });
    resetPipeline();
  }, [resetPipeline]);

  const handleFileRemoved = useCallback((slotIndex: number) => {
    setFiles(prev => { const n = [...prev]; n[slotIndex] = null; return n; });
    setRealFiles(prev => { const n = [...prev]; n[slotIndex] = null; return n; });
    resetPipeline();
  }, [resetPipeline]);

  const revealStep = useCallback((stepIdx: number, backendStep: Record<string, unknown>) => {
    setSteps(prev => {
      const newSteps = [...prev];
      if (stepIdx >= newSteps.length) return prev;
      const uiStep = { ...newSteps[stepIdx] };

      uiStep.status = 'done';
      uiStep.progress = 100;

      // Step 0 (OCR) shows per-file results
      if (stepIdx === 0 && Array.isArray(backendStep.sub_results)) {
        uiStep.filesProgress = (backendStep.sub_results as any[]).map((r, idx) => ({
          id: r.doc_id ?? `sub-${idx}`,
          file: { id: r.doc_id ?? `sub-${idx}`, name: r.doc_label ?? `File ${idx + 1}`, size: 0, type: '', icon: '📄' },
          status: (r.status === 'success' ? 'done' : 'error') as StepStatus,
          progress: 100,
          output: r.content ?? null,
          duration: null,
        }));
        uiStep.output = null;
      } else {
        const extracted = backendStep.extracted_data;
        if (extracted) {
          uiStep.output = typeof extracted === 'string'
            ? extracted
            : JSON.stringify(extracted, null, 2);
        } else if (typeof backendStep.content_preview === 'string') {
          uiStep.output = backendStep.content_preview;
        }
      }

      newSteps[stepIdx] = uiStep;
      const nextIdx = stepIdx + 1;
      if (nextIdx < newSteps.length && newSteps[nextIdx].status === 'pending') {
        newSteps[nextIdx] = { ...newSteps[nextIdx], status: 'running', progress: 15 };
      }
      return newSteps;
    });
    scrollToStep(stepIdx);
  }, [scrollToStep]);

  const polling = useWorkflowPolling({
    onStepReveal: revealStep,
    onComplete: () => { setPipelineComplete(true); setIsProcessing(false); },
    onError: (stepIdx, message) => {
      setSteps(prev => prev.map((s, idx) =>
        idx === stepIdx ? { ...s, status: 'error' as StepStatus, output: message } : s,
      ));
      setPipelineError(message);
      setPipelineComplete(true);
      setIsProcessing(false);
    },
    onProgress: (stepIdx, percent) => {
      setSteps(prev => prev.map((s, idx) =>
        idx === stepIdx && s.status !== 'done'
          ? { ...s, status: 'running' as StepStatus, progress: percent }
          : s,
      ));
    },
  });

  const runPipeline = async () => {
    if (!allFilesReady || isProcessing) return;
    if (!testApiKeyId.trim()) {
      setPipelineError('Vui lòng nhập Profile API Key ID để chạy so sánh.');
      return;
    }

    setIsProcessing(true);
    setPipelineError(null);
    resetPipeline();
    setSteps(prev => prev.map((s, idx) =>
      idx === 0 ? { ...s, status: 'running' as StepStatus, progress: 5 } : s,
    ));

    try {
      const uploadedFiles = files.filter(Boolean) as UploadedFile[];
      const rawFiles = realFiles.filter(Boolean) as File[];
      await polling.submitWorkflow(uploadedFiles, rawFiles, testApiKeyId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSteps(prev => prev.map((s, idx) =>
        idx === 0 ? { ...s, status: 'error' as StepStatus, output: msg } : s,
      ));
      setPipelineError(msg);
      setPipelineComplete(true);
      setIsProcessing(false);
    }
  };

  const handleAbort = useCallback(async () => {
    if (!polling.operationId) return;
    if (!window.confirm('Hủy workflow? Thao tác này không thể khôi phục.')) return;
    try {
      await fetch(`/api/v1/operations/${polling.operationId}/cancel`, { method: 'POST' });
    } catch {}
    polling.stopPolling();
    setPipelineError('Workflow đã bị hủy bởi người dùng.');
    setPipelineComplete(true);
    setIsProcessing(false);
  }, [polling]);

  const uploadedFileList = files.filter(Boolean) as UploadedFile[];

  return (
    <div className="min-h-screen pb-20 relative overflow-hidden">
      {/* Background ambient glows */}
      <div className="fixed -top-60 -left-40 opacity-20 pointer-events-none" aria-hidden="true"
        style={{ width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)' }} />
      <div className="fixed -bottom-40 -right-60 opacity-20 pointer-events-none" aria-hidden="true"
        style={{ width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)' }} />

      {/* Header */}
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-6">
        <div className="text-center mb-2">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-semibold text-blue-400 tracking-wider uppercase mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
            </span>
            Advanced Document Comparison
          </div>

          <h1 className="text-3xl md:text-4xl font-heading font-bold tracking-tight mb-3">
            <span className="text-gradient">So sánh Văn bản Nâng cao</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Upload 2 văn bản quy trình/quy định → OCR → Phân tích Mục lục → So sánh từng mục (phát hiện thêm/xóa/sửa) → Báo cáo chi tiết
          </p>

          <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
            {['Phát hiện Thêm mục', 'Phát hiện Xóa mục', 'Nội dung Sửa đổi', 'Báo cáo Markdown'].map(badge => (
              <span key={badge}
                className="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 uppercase tracking-wider">
                {badge}
              </span>
            ))}
          </div>

          <div className="mt-4 mx-auto max-w-sm">
            <input
              type="text"
              placeholder="Target Profile API Key ID (Bắt buộc)"
              className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-center"
              value={testApiKeyId}
              onChange={(e) => setTestApiKeyId(e.target.value)}
              disabled={isProcessing}
              id="input-api-key-id"
            />
            <p className="mt-1.5 text-[10px] text-destructive opacity-80">
              * Bắt buộc phải nhập Profile API Key ID
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 space-y-6">

        {/* ─── 2-File Upload Slots ─────────────────────────────────────── */}
        <div className="modern-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-base">📂</span>
            <h2 className="text-sm font-semibold">Upload 2 Văn bản</h2>
            {allFilesReady && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Sẵn sàng so sánh
              </span>
            )}
          </div>

          <div className="flex gap-4 flex-col sm:flex-row">
            <FileSlot
              label="Văn bản gốc (VB1)"
              slotIndex={0}
              file={files[0]}
              isProcessing={isProcessing}
              onFileSelected={handleFileSelected}
              onFileRemoved={handleFileRemoved}
            />

            {/* VS divider */}
            <div className="flex items-center justify-center">
              <div className="w-px h-full bg-border sm:w-8 sm:h-px hidden sm:block" />
              <div className="px-3 py-1.5 rounded-full bg-muted/50 border border-border text-xs font-bold text-muted-foreground shrink-0">
                VS
              </div>
              <div className="w-px h-full bg-border sm:w-8 sm:h-px hidden sm:block" />
            </div>

            <FileSlot
              label="Văn bản so sánh (VB2)"
              slotIndex={1}
              file={files[1]}
              isProcessing={isProcessing}
              onFileSelected={handleFileSelected}
              onFileRemoved={handleFileRemoved}
            />
          </div>
        </div>

        {/* Action button */}
        {allFilesReady && (
          <div className="flex items-center gap-3">
            <button
              onClick={runPipeline}
              disabled={isProcessing || pipelineComplete}
              className="modern-button btn-primary text-sm gap-2 flex-1 sm:flex-none"
              id="btn-start-doc-compare"
              style={!isProcessing && !pipelineComplete ? { background: 'linear-gradient(135deg, #3b82f6, #2563eb)' } : undefined}
            >
              {isProcessing ? (
                <><SpinnerIcon className="w-4 h-4" /> Đang so sánh...</>
              ) : pipelineComplete && !pipelineError ? (
                <><CheckIcon className="w-4 h-4" /> Hoàn tất</>
              ) : (
                <>🔍 Bắt đầu So sánh Văn bản</>
              )}
            </button>
            {isProcessing && (
              <button onClick={handleAbort} className="modern-button btn-outline text-sm text-destructive border-destructive/30">
                ✕ Hủy
              </button>
            )}
            {pipelineComplete && (
              <button onClick={() => resetPipeline()} className="modern-button btn-outline text-sm" id="btn-reset-doc-compare">
                ↻ So sánh lại
              </button>
            )}
          </div>
        )}

        {/* Error toast */}
        {pipelineError && !pipelineComplete && (
          <div className="modern-card p-4 border-destructive/30 bg-destructive/5 flex items-center gap-3 animate-in slide-in-from-top-2 duration-300" role="alert">
            <span className="text-destructive text-lg">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">{pipelineError}</p>
            </div>
            <button onClick={() => setPipelineError(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">✕</button>
          </div>
        )}

        {/* Pipeline Steps */}
        {allFilesReady && (
          <div className="space-y-0 relative">
            <div className="absolute left-[27px] top-[40px] bottom-[40px] w-px bg-gradient-to-b from-blue-500/30 via-blue-500/10 to-transparent z-0" />
            {steps.map((step, i) => (
              <React.Fragment key={step.id}>
                <PipelineStepCard
                  ref={el => { stepRefs.current[i] = el; }}
                  step={step}
                  stepIndex={i}
                  totalSteps={steps.length}
                  isProcessing={isProcessing}
                  onRetry={() => {}}
                  onToggleCollapse={toggleCollapse}
                  isLastStep={i === steps.length - 1}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Completion Banner */}
        {pipelineComplete && (
          <CompletionBanner steps={steps} files={uploadedFileList} error={pipelineError} />
        )}
      </div>

      {/* Floating progress badge */}
      {isProcessing && (
        <div
          className="fixed bottom-6 right-6 px-4 py-2.5 rounded-2xl bg-card/90 backdrop-blur-xl border border-blue-500/20 shadow-lg flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300 z-50"
          role="status" aria-live="polite"
        >
          <SpinnerIcon className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium">Đang so sánh 2 văn bản...</span>
          <span className="text-xs text-muted-foreground">
            {currentRunningStep >= 0 ? `Bước ${currentRunningStep + 1}/${steps.length}` : 'Khởi tạo...'}
          </span>
        </div>
      )}
    </div>
  );
}
