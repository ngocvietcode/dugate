'use client';

// app/lc-checker/page.tsx
// LC Document Checker — Kiểm tra Bộ Chứng từ LC theo UCP 600 / ISBP 821
//
// Architecture:
//   page.tsx            → Orchestrator (state management)
//   components/         → Reused from doc-pipeline (UploadZone, PipelineStepCard, etc.)
//   hooks/              → useWorkflowPolling (lc-checker slug)
//   lib/mock-data.ts    → getInitialSteps for LC workflow
//   types.ts            → Shared TypeScript types

import React, { useState, useRef, useCallback, useMemo } from 'react';
import type { PipelineStep, StepStatus, UploadedFile } from './types';
import { getInitialSteps } from './lib/mock-data';
import { useWorkflowPolling } from './hooks/useWorkflowPolling';

// Reuse components from doc-pipeline (they are fully generic)
import { UploadZone } from '@/app/doc-pipeline/components/UploadZone';
import { PipelineStepCard } from '@/app/doc-pipeline/components/PipelineStepCard';
import { CompletionBanner } from '@/app/doc-pipeline/components/CompletionBanner';
import { JsonEditor } from '@/app/doc-pipeline/components/JsonEditor';
import { SpinnerIcon, CheckIcon } from '@/app/doc-pipeline/components/Icons';

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LcCheckerPage() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [realFiles, setRealFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [testApiKeyId, setTestApiKeyId] = useState('');
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [steps, setSteps] = useState<PipelineStep[]>(getInitialSteps());

  // -- HITL State --
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

      // Steps 0 (Classify) and 1 (OCR) use parallel per-file filesProgress
      if ((stepIdx === 0 || stepIdx === 1) && Array.isArray(backendStep.sub_results)) {
        uiStep.filesProgress = (backendStep.sub_results as any[]).map((r, idx) => {
          const name = r.doc_label ?? r.file ?? `Document ${idx + 1}`;
          const outputStr: string | null =
            r.content
            ?? (r.extracted_data != null ? JSON.stringify(r.extracted_data, null, 2) : null)
            ?? (r.logical_documents?.length ? JSON.stringify(r.logical_documents, null, 2) : null);
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

  // ── File handling & Resume ────────────────────────────────────────────────
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
    const confirmed = window.confirm('Hủy pipeline kiểm tra LC? Thao tác này không thể khôi phục.');
    if (!confirmed) return;
    try {
      await fetch(`/api/v1/operations/${polling.operationId}/cancel`, { method: 'POST' });
    } catch {
      // best-effort — ignore network errors
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
      setPipelineError('Vui lòng nhập Profile API Key ID để chạy kiểm tra LC.');
      return;
    }

    setIsProcessing(true);
    setPipelineError(null);
    setWaitingHitl(null);
    resetPipeline();

    setSteps(prev => prev.map((s, idx) =>
      idx === 0 ? { ...s, status: 'running' as StepStatus, progress: 5 } : s
    ));

    try {
      await polling.submitWorkflow(files, realFiles, testApiKeyId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to start LC checker workflow:', msg);
      setSteps(prev => prev.map((s, idx) =>
        idx === 0 ? { ...s, status: 'error' as StepStatus, output: msg } : s
      ));
      setPipelineError(msg);
      setPipelineComplete(true);
      setIsProcessing(false);
    }
  };

  const retryStep = async (_stepIndex: number) => {
    if (isProcessing) return;

    if (!testApiKeyId.trim()) {
      setPipelineError('Vui lòng nhập Profile API Key ID để chạy kiểm tra LC.');
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
      <div className="glow-amber -top-60 -left-40 fixed opacity-20" aria-hidden="true" style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.15) 0%, transparent 70%)' }} />
      <div className="glow-cyan -bottom-40 -right-60 fixed opacity-20" aria-hidden="true" />

      {/* Header */}
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-6">
        <div className="text-center mb-2">

          {/* Live indicator */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs font-semibold text-amber-400 tracking-wider uppercase mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
            Live Mode — UCP 600 / ISBP 821
          </div>

          <h1 className="text-3xl md:text-4xl font-heading font-bold tracking-tight mb-3">
            <span className="text-gradient">LC Document Checker</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Upload bộ chứng từ LC → Phân loại → OCR bóc tách → Kiểm tra UCP 600 / ISBP 821 → Báo cáo Discrepancy
          </p>

          {/* LC Standards badges */}
          <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
            {['UCP 600', 'ISBP 821', 'eUCP', 'ICC Standards'].map(badge => (
              <span
                key={badge}
                className="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 uppercase tracking-wider"
              >
                {badge}
              </span>
            ))}
          </div>

          {/* Required Profile Key ID Input */}
          <div className="mt-4 mx-auto max-w-sm">
            <input
              type="text"
              placeholder="Target Profile API Key ID (Bắt buộc)"
              className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500/50 text-center"
              value={testApiKeyId}
              onChange={(e) => setTestApiKeyId(e.target.value)}
              disabled={isProcessing}
              id="input-api-key-id"
            />
            <p className="mt-1.5 text-[10px] text-destructive opacity-80">
              * Bắt buộc phải nhập Profile API Key ID để chạy kiểm tra
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 space-y-6">

        {/* ─── Upload Zone ───────────────────────────────────────────── */}
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
              id="btn-start-lc-checker"
              style={!isProcessing && !pipelineComplete ? { background: 'linear-gradient(135deg, #f59e0b, #d97706)' } : undefined}
            >
              {isProcessing ? (
                <><SpinnerIcon className="w-4 h-4" /> Đang kiểm tra...</>
              ) : pipelineComplete && !pipelineError ? (
                <><CheckIcon className="w-4 h-4" /> Hoàn tất</>
              ) : (
                <>⚖️ Bắt đầu Kiểm tra Chứng từ LC</>
              )}
            </button>
            {pipelineComplete && (
              <button
                onClick={() => resetPipeline()}
                className="modern-button btn-outline text-sm"
                id="btn-reset-lc-checker"
              >
                ↻ Kiểm tra lại
              </button>
            )}
          </div>
        )}

        {/* ─── Error toast ────────────────────────────────────────────── */}
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
            {/* Vertical timeline line */}
            <div className="absolute left-[27px] top-[40px] bottom-[40px] w-px bg-gradient-to-b from-amber-500/30 via-amber-500/10 to-transparent z-0" />

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

                {/* HITL Block — inserted AFTER Step 2 (Index 1, OCR) */}
                {i === 1 && waitingHitl && (
                  <div className="ml-0 md:ml-14 mb-10 mt-4 relative z-10 animate-in slide-in-from-top-4 duration-500">

                    {/* HITL notice */}
                    <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
                      <span className="text-2xl mt-0.5">🔍</span>
                      <div>
                        <p className="text-sm font-semibold text-amber-400">Xác nhận trước khi kiểm tra UCP 600</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Vui lòng kiểm tra dữ liệu đã bóc tách từ bộ chứng từ. Chỉnh sửa nếu cần, sau đó nhấn <strong>Tiếp tục</strong> để chạy kiểm tra tuân thủ UCP 600 / ISBP 821.
                        </p>
                      </div>
                    </div>

                    <JsonEditor
                      value={waitingHitl.jsonStr}
                      onChange={val => setWaitingHitl({ ...waitingHitl, jsonStr: val })}
                    />

                    <div className="mt-6 flex items-center justify-end gap-3">
                      {/* Resume button */}
                      <button
                        onClick={handleResumePipeline}
                        disabled={isProcessing}
                        className="px-8 py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-500 transition-all focus:ring-4 focus:ring-amber-500/20 active:scale-95 flex items-center gap-2.5 shadow-xl shadow-amber-900/20 disabled:opacity-50"
                        id="btn-resume-lc-check"
                      >
                        {isProcessing ? <SpinnerIcon className="w-5 h-5 text-white" /> : (
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        )}
                        Xác nhận & Kiểm tra UCP 600
                      </button>

                      {/* Abort button */}
                      <button
                        onClick={handleAbortPipeline}
                        disabled={isProcessing}
                        className="px-6 py-3 bg-destructive/10 text-destructive font-semibold rounded-xl hover:bg-destructive/20 transition-all focus:ring-4 focus:ring-destructive/20 active:scale-95 flex items-center gap-2 border border-destructive/30 disabled:opacity-50"
                        id="btn-abort-lc-check"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="15" y1="9" x2="9" y2="15"/>
                          <line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                        Hủy
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
          className="fixed bottom-6 right-6 px-4 py-2.5 rounded-2xl bg-card/90 backdrop-blur-xl border border-amber-500/20 shadow-lg flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300 z-50"
          role="status"
          aria-live="polite"
        >
          <SpinnerIcon className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium">
            Kiểm tra {files.length} chứng từ...
          </span>
          <span className="text-xs text-muted-foreground">
            {currentRunningStep >= 0 ? `Bước ${currentRunningStep + 1}/${steps.length}` : 'Khởi tạo...'}
          </span>
        </div>
      )}
    </div>
  );
}
