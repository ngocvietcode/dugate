'use client';

// app/doc-pipeline/page.tsx
// AI Document Pipeline Demo — Real API mode only.
//
// Architecture:
//   page.tsx            → Orchestrator (state management)
//   components/         → Presentational components
//   hooks/              → Business logic (polling)
//   lib/mock-data.ts    → Shared utilities (getInitialSteps, getFileIcon, formatBytes)
//   types.ts            → Shared TypeScript types

import React, { useState, useRef, useCallback, useMemo } from 'react';
import type { PipelineStep, StepStatus, UploadedFile } from './types';
import { getInitialSteps } from './lib/mock-data';
import { UploadZone } from './components/UploadZone';
import { PipelineStepCard } from './components/PipelineStepCard';
import { CompletionBanner } from './components/CompletionBanner';
import { JsonEditor } from './components/JsonEditor';
import { SpinnerIcon, CheckIcon } from './components/Icons';
import { useWorkflowPolling } from './hooks/useWorkflowPolling';

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AiDemoPage() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [realFiles, setRealFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [testApiKeyId, setTestApiKeyId] = useState('');
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [steps, setSteps] = useState<PipelineStep[]>(getInitialSteps());
  
  // -- HitL State --
  const [waitingHitl, setWaitingHitl] = useState<{ stepIdx: number; data: any; jsonStr: string } | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentRunningStep = useMemo(
    () => steps.findIndex(s => s.status === 'running'),
    [steps],
  );

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const resetPipeline = useCallback(() => {
    setSteps(getInitialSteps());
    setPipelineComplete(false);
    setPipelineError(null);
  }, []);

  const toggleCollapse = useCallback((stepIndex: number) => {
    setSteps(prev => prev.map((s, idx) =>
      idx === stepIndex ? { ...s, isCollapsed: !s.isCollapsed } : s
    ));
  }, []);

  const scrollToStep = useCallback((stepIdx: number) => {
    setTimeout(() => {
      stepRefs.current[stepIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }, []);

  // ── Reveal a backend step into UI ─────────────────────────────────────────
  const revealStep = useCallback((stepIdx: number, backendStep: Record<string, unknown>) => {
    setSteps(prev => {
      const newSteps = [...prev];
      if (stepIdx >= newSteps.length) return prev;
      const uiStep = { ...newSteps[stepIdx] };

      uiStep.status = 'done';
      uiStep.progress = 100;

      // Map output based on step type
      // Steps 0 (Classify) and 1 (OCR) both use parallel per-file filesProgress
      if ((stepIdx === 0 || stepIdx === 1) && Array.isArray(backendStep.sub_results)) {
        uiStep.filesProgress = (backendStep.sub_results as any[]).map((r, idx) => {
            // Support both new shape (doc_id/doc_label/content) and old shape (file/logical_documents)
            const name = r.doc_label ?? r.file ?? `Document ${idx + 1}`;
            const outputStr: string | null =
              r.content                                                                       // new shape: JSON string from classifier
              ?? (r.extracted_data != null ? JSON.stringify(r.extracted_data, null, 2) : null) // new shape: object fallback
              ?? (r.logical_documents?.length ? JSON.stringify(r.logical_documents, null, 2) : null); // old shape fallback
            return {
              id: r.doc_id ?? r.file ?? `sub-${idx}`,
              file: { id: r.doc_id ?? r.file, name, size: 0, type: '', icon: '📄' },
              status: (r.status === 'success' ? 'done' : 'error') as StepStatus,
              progress: 100,
              output: outputStr,
              duration: null,
            };
          });
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

      // Mark next step as running
      const nextIdx = stepIdx + 1;
      if (nextIdx < newSteps.length && newSteps[nextIdx].status === 'pending') {
        newSteps[nextIdx] = { ...newSteps[nextIdx], status: 'running', progress: 15 };
      }

      return newSteps;
    });
    scrollToStep(stepIdx);
  }, [scrollToStep]);

  // ── API Polling Hook ────────────────────────────────────────────────────
  const polling = useWorkflowPolling({
    onStepReveal: revealStep,
    onComplete: () => {
      setPipelineComplete(true);
      setIsProcessing(false);
    },
    onError: (stepIdx, message) => {
      setSteps(prev => prev.map((s, idx) =>
        idx === stepIdx ? { ...s, status: 'error' as StepStatus, output: message } : s
      ));
      setPipelineError(message);
      setPipelineComplete(true);
      setIsProcessing(false);
    },
    onProgress: (stepIdx, percent) => {
      setSteps(prev => prev.map((s, idx) =>
        idx === stepIdx && s.status !== 'done'
          ? { ...s, status: 'running' as StepStatus, progress: percent }
          : s
      ));
    },
    onWaitingForInput: (stepIdx, data) => {
      setWaitingHitl({
        stepIdx,
        data,
        jsonStr: JSON.stringify(data?.extracted_data || {}, null, 2)
      });
      setIsProcessing(false);
      setSteps(prev => prev.map((s, idx) =>
        idx === stepIdx ? { ...s, status: 'done', progress: 100 } : s
      ));
    }
  });

  // ── File handling & Resume ──────────────────────────────────────────────────────────
  const handleResumePipeline = useCallback(async () => {
    if (!waitingHitl || !polling.operationId) return;
    try {
      setIsProcessing(true);
      const parsedData = JSON.parse(waitingHitl.jsonStr);
      
      const res = await fetch(`/api/v1/operations/${polling.operationId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: waitingHitl.stepIdx,
          extracted_data: parsedData
        })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      setWaitingHitl(null);
      polling.startPolling(polling.operationId);
    } catch(err) {
      alert('Lỗi JSON hoặc Lỗi Mạng: ' + (err instanceof Error ? err.message : String(err)));
      setIsProcessing(false);
    }
  }, [waitingHitl, polling]);

  const handleAbortPipeline = useCallback(async () => {
    if (!polling.operationId) return;
    const confirmed = window.confirm('Hủy pipeline? Thao tác này không thể khôi phục.');
    if (!confirmed) return;
    try {
      await fetch(`/api/v1/operations/${polling.operationId}/cancel`, { method: 'POST' });
    } catch {
      // best-effort — ignore network errors on abort
    } finally {
      polling.stopPolling();
      setWaitingHitl(null);
      setPipelineError('Pipeline đã bị hủy bởi người dùng.');
      setPipelineComplete(true);
      setIsProcessing(false);
    }
  }, [polling]);

  const handleFilesAdded = useCallback((uploadedFiles: UploadedFile[], fileObjects?: File[]) => {
    if (fileObjects && fileObjects.length > 0) {
      setRealFiles(prev => [...prev, ...fileObjects]);
    } else {
      setRealFiles([]);
    }
    setFiles(prev => [...prev, ...uploadedFiles]);
    resetPipeline();
  }, [resetPipeline]);

  const handleFileRemoved = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    resetPipeline();
  }, [resetPipeline]);

  const handleClearAll = useCallback(() => {
    setFiles([]);
    setRealFiles([]);
    resetPipeline();
  }, [resetPipeline]);

  // ── Run Pipeline ──────────────────────────────────────────────────────────
  const runPipeline = async () => {
    if (files.length === 0 || isProcessing) return;
    
    if (!testApiKeyId.trim()) {
      setPipelineError('Vui lòng nhập Profile API Key ID để chạy chức năng test.');
      return;
    }

    setIsProcessing(true);
    setPipelineError(null);
    setWaitingHitl(null);
    resetPipeline();

    // Mark step 1 as running for immediate UX feedback
    setSteps(prev => prev.map((s, idx) =>
      idx === 0 ? { ...s, status: 'running' as StepStatus, progress: 5 } : s
    ));

    try {
      await polling.submitWorkflow(files, realFiles, testApiKeyId);
      // Polling is now active — completion handled by hook callbacks
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to start workflow:', msg);
      setSteps(prev => prev.map((s, idx) =>
        idx === 0 ? { ...s, status: 'error' as StepStatus, output: msg } : s
      ));
      setPipelineError(msg);
      setPipelineComplete(true);
      setIsProcessing(false);
    }
  };

  // ── Retry step ────────────────────────────────────────────────────────────
  // Re-submits the entire workflow (individual step retry not yet supported)
  const retryStep = async (_stepIndex: number) => {
    if (isProcessing) return;

    if (!testApiKeyId.trim()) {
      setPipelineError('Vui lòng nhập Profile API Key ID để chạy chức năng test.');
      return;
    }

    setIsProcessing(true);
    setPipelineComplete(false);
    setPipelineError(null);

    setSteps(getInitialSteps());
    setSteps(prev => prev.map((s, idx) =>
      idx === 0 ? { ...s, status: 'running' as StepStatus, progress: 5 } : s
    ));
    try {
      await polling.submitWorkflow(files, realFiles, testApiKeyId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSteps(prev => prev.map((s, idx) =>
        idx === 0 ? { ...s, status: 'error' as StepStatus, output: msg } : s
      ));
      setPipelineError(msg);
      setPipelineComplete(true);
    }
    setIsProcessing(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen pb-20 relative overflow-hidden">
      {/* Background ambient glows */}
      <div className="glow-purple -top-60 -left-40 fixed opacity-30" aria-hidden="true" />
      <div className="glow-cyan -bottom-40 -right-60 fixed opacity-20" aria-hidden="true" />

      {/* Header */}
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-6">
        <div className="text-center mb-2">
          {/* Live indicator */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary tracking-wider uppercase mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            Live Mode — Real API
          </div>

          <h1 className="text-3xl md:text-4xl font-heading font-bold tracking-tight mb-3">
            <span className="text-gradient">AI Document Pipeline</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Upload chứng từ → Phân loại tự động → OCR bóc tách → Đối chiếu Nghị quyết → Soạn Tờ trình
          </p>

          {/* Required Profile Key ID Input */}
          <div className="mt-4 mx-auto max-w-sm">
            <input
              type="text"
              placeholder="Target Profile API Key ID (Bắt buộc)"
              className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-center"
              value={testApiKeyId}
              onChange={(e) => setTestApiKeyId(e.target.value)}
              disabled={isProcessing}
            />
            <p className="mt-1.5 text-[10px] text-destructive opacity-80">
              * Bắt buộc phải nhập Profile API Key ID để chạy test
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 space-y-6">

        {/* ─── Upload Zone ─────────────────────────────────────────────── */}
        <UploadZone
          files={files}
          isProcessing={isProcessing}
          onFilesAdded={handleFilesAdded}
          onFileRemoved={handleFileRemoved}
          onClearAll={handleClearAll}
        />

        {/* Action button */}
        {files.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={runPipeline}
              disabled={isProcessing || pipelineComplete}
              className="modern-button btn-primary text-sm gap-2 flex-1 sm:flex-none"
              id="btn-start-pipeline"
            >
              {isProcessing ? (
                <><SpinnerIcon className="w-4 h-4" /> Đang xử lý...</>
              ) : pipelineComplete && !pipelineError ? (
                <><CheckIcon className="w-4 h-4" /> Hoàn tất</>
              ) : (
                <>▶ Bắt đầu xử lý AI Pipeline</>
              )}
            </button>
            {pipelineComplete && (
              <button
                onClick={() => resetPipeline()}
                className="modern-button btn-outline text-sm"
                id="btn-reset-pipeline"
              >
                ↻ Chạy lại
              </button>
            )}
          </div>
        )}

        {/* ─── Error toast ──────────────────────────────────────────────── */}
        {pipelineError && !pipelineComplete && (
          <div className="modern-card p-4 border-destructive/30 bg-destructive/5 flex items-center gap-3 animate-in slide-in-from-top-2 duration-300" role="alert">
            <span className="text-destructive text-lg">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">{pipelineError}</p>
            </div>
            <button
              onClick={() => setPipelineError(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Đóng thông báo lỗi"
            >
              ✕
            </button>
          </div>
        )}

        {/* ─── Pipeline Steps ──────────────────────────────────────────── */}
        {files.length > 0 && (
          <div className="space-y-0 relative">
            {/* Vertical timeline line (extended) */}
            <div className="absolute left-[27px] top-[40px] bottom-[40px] w-px bg-gradient-to-b from-primary/30 via-primary/10 to-transparent z-0" />

            {steps.map((step, i) => (
              <React.Fragment key={step.id}>
                <PipelineStepCard
                  ref={el => { stepRefs.current[i] = el; }}
                  step={step}
                  stepIndex={i}
                  totalSteps={steps.length}
                  isProcessing={isProcessing}
                  onRetry={retryStep}
                  onToggleCollapse={toggleCollapse}
                  isLastStep={i === steps.length - 1}
                />

                {/* HITL Block Inserted AFTER Step 2 (Index 1) */}
                {i === 1 && waitingHitl && (
                  <div className="ml-0 md:ml-14 mb-10 mt-4 relative z-10 animate-in slide-in-from-top-4 duration-500">
                    <JsonEditor
                      value={waitingHitl.jsonStr}
                      onChange={val => setWaitingHitl({ ...waitingHitl, jsonStr: val })}
                    />
                    <div className="mt-6 flex items-center justify-end gap-3">
                      {/* Resume button */}
                      <button
                        onClick={handleResumePipeline}
                        disabled={isProcessing}
                        className="px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-500 transition-all focus:ring-4 focus:ring-emerald-500/20 active:scale-95 flex items-center gap-2.5 shadow-xl shadow-emerald-900/20 disabled:opacity-50"
                        id="btn-resume-pipeline"
                      >
                        {isProcessing ? <SpinnerIcon className="w-5 h-5 text-white" /> : (
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        )}
                        Lưu & Tiếp tục Pipeline
                      </button>

                      {/* Abort button */}
                      <button
                        onClick={handleAbortPipeline}
                        disabled={isProcessing}
                        className="px-6 py-3 bg-destructive/10 text-destructive font-semibold rounded-xl hover:bg-destructive/20 transition-all focus:ring-4 focus:ring-destructive/20 active:scale-95 flex items-center gap-2 border border-destructive/30 disabled:opacity-50"
                        id="btn-abort-pipeline"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="15" y1="9" x2="9" y2="15"/>
                          <line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                        Hủy Pipeline
                      </button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}



        {/* ─── Completion Banner ───────────────────────────────────────── */}
        {pipelineComplete && (
          <CompletionBanner steps={steps} files={files} error={pipelineError} />
        )}
      </div>

      {/* Floating progress badge */}
      {isProcessing && (
        <div
          className="fixed bottom-6 right-6 px-4 py-2.5 rounded-2xl bg-card/90 backdrop-blur-xl border border-primary/20 shadow-lg flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300 z-50"
          role="status"
          aria-live="polite"
        >
          <SpinnerIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">
            Xử lý {files.length} file...
          </span>
          <span className="text-xs text-muted-foreground">
            {currentRunningStep >= 0 ? `Bước ${currentRunningStep + 1}/${steps.length}` : 'Khởi tạo...'}
          </span>
        </div>
      )}
    </div>
  );
}
