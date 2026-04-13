'use client';

// app/ai-demo/page.tsx
// AI Document Pipeline Demo — Refactored with extracted components and hooks.
//
// Architecture:
//   page.tsx            → Orchestrator (state + mode toggle)
//   components/         → Presentational components
//   hooks/              → Business logic (polling, mock pipeline)
//   lib/mock-data.ts    → Mock data generators
//   types.ts            → Shared TypeScript types

import React, { useState, useRef, useCallback, useMemo } from 'react';
import type { PipelineStep, StepStatus, UploadedFile } from './types';
import { getInitialSteps } from './lib/mock-data';
import { UploadZone } from './components/UploadZone';
import { PipelineStepCard } from './components/PipelineStepCard';
import { CompletionBanner } from './components/CompletionBanner';
import { JsonEditor } from './components/JsonEditor';
import { SpinnerIcon, CheckIcon } from './components/Icons';
import { useMockPipeline } from './hooks/useMockPipeline';
import { useWorkflowPolling } from './hooks/useWorkflowPolling';

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AiDemoPage() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [realFiles, setRealFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [mode, setMode] = useState<'mock' | 'api'>('api');
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
      const extracted = backendStep.extracted_data;
      if (extracted) {
        if (stepIdx === 1 && Array.isArray(backendStep.sub_results)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          uiStep.filesProgress = (backendStep.sub_results as any[]).map((r, idx) => ({
            id: r.doc_id || `sub-${idx}`,
            file: { id: r.doc_id, name: r.doc_label || `Document ${idx + 1}`, size: 0, type: '', icon: '📄' },
            status: (r.status === 'success' ? 'done' : 'error') as StepStatus,
            progress: 100,
            output: r.content || JSON.stringify(r.extracted_data, null, 2),
            duration: null,
          }));
          uiStep.output = null;
        } else {
          uiStep.output = typeof extracted === 'string'
            ? extracted
            : JSON.stringify(extracted, null, 2);
        }
      } else if (typeof backendStep.content_preview === 'string') {
        uiStep.output = backendStep.content_preview;
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

  // ── Mock Pipeline Hook ───────────────────────────────────────────────────
  const { runFullMockPipeline, retryMockStep } = useMockPipeline({ files, setSteps });

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
    setIsProcessing(true);
    setPipelineError(null);
    setWaitingHitl(null);
    resetPipeline();

    // Mark step 1 as running for immediate UX feedback
    setSteps(prev => prev.map((s, idx) =>
      idx === 0 ? { ...s, status: 'running' as StepStatus, progress: 5 } : s
    ));

    if (mode === 'mock') {
      try {
        await runFullMockPipeline();
        setPipelineComplete(true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setPipelineError(msg);
        setPipelineComplete(true);
      }
      setIsProcessing(false);
    } else {
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
    }
  };

  // ── Retry step ────────────────────────────────────────────────────────────
  const retryStep = async (stepIndex: number) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setPipelineComplete(false);
    setPipelineError(null);

    if (mode === 'mock') {
      await retryMockStep(stepIndex);
      setSteps(prev => {
        if (prev.every(s => s.status === 'done')) setPipelineComplete(true);
        return prev;
      });
    } else {
      // For API mode, re-submit the entire workflow (individual step retry not yet supported)
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
          {/* Mode indicator */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary tracking-wider uppercase mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            {mode === 'mock' ? 'Demo Mode — Mock Data' : 'Live Mode — Real API'}
          </div>

          <h1 className="text-3xl md:text-4xl font-heading font-bold tracking-tight mb-3">
            <span className="text-gradient">AI Document Pipeline</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Upload chứng từ → Phân loại tự động → OCR bóc tách → Đối chiếu Nghị quyết → Soạn Tờ trình
          </p>

          {/* Mode toggle */}
          <div className="mt-4 inline-flex items-center gap-1 p-1 rounded-xl bg-muted/80 border border-border/50">
            <button
              onClick={() => setMode('mock')}
              disabled={isProcessing}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'mock'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              🎭 Mock Demo
            </button>
            <button
              onClick={() => setMode('api')}
              disabled={isProcessing}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'api'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              🚀 Real API
            </button>
          </div>

          {/* Optional Profile Key ID Input */}
          <div className={`mt-4 mx-auto max-w-sm transition-all duration-300 ${mode === 'api' ? 'opacity-100 max-h-20' : 'opacity-0 max-h-0 overflow-hidden'}`}>
            <input
              type="text"
              placeholder="Target Profile API Key ID (Optional)"
              className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-center"
              value={testApiKeyId}
              onChange={(e) => setTestApiKeyId(e.target.value)}
              disabled={isProcessing}
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground opacity-80">
              Để trống để dùng cấu hình mặc định (System Admin)
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
                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={handleResumePipeline}
                        disabled={isProcessing}
                        className="px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-500 transition-all focus:ring-4 focus:ring-emerald-500/20 active:scale-95 flex items-center gap-2.5 shadow-xl shadow-emerald-900/20 disabled:opacity-50"
                      >
                        {isProcessing ? <SpinnerIcon className="w-5 h-5 text-white" /> : (
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        )}
                        Lưu & Tiếp tục Pipeline
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
