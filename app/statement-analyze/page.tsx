'use client';

// app/statement-analyze/page.tsx
// Statement Analyze Demo — Upload PDF sao kê → call statement-analyze workflow
// (OCR qua connector ext-doc-layout) → tính toán → hiển thị kết quả.

import React, { useState, useCallback } from 'react';
import type { PipelineStep, StepStatus, UploadedFile } from './types';
import { useStatementPolling } from './hooks/useStatementPolling';
import { ResultPanel } from './components/ResultPanel';

function getInitialSteps(): PipelineStep[] {
  return [
    {
      id: 'classify',
      title: 'Phân loại file',
      subtitle: 'Kiểm tra file PDF sao kê',
      icon: '📁',
      accentColor: 'from-violet-500 to-indigo-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
    {
      id: 'ocr',
      title: 'OCR Sao kê',
      subtitle: 'Tách trang & gọi connector trích xuất giao dịch từng trang',
      icon: '🔍',
      accentColor: 'from-cyan-500 to-blue-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
    {
      id: 'analyze',
      title: 'Phân tích số dư',
      subtitle: 'SDBQ, chu kỳ 6 tháng, cực trị, tổng ngày/giao dịch',
      icon: '📊',
      accentColor: 'from-amber-500 to-orange-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
    {
      id: 'enrichment',
      title: 'Chuẩn hóa dữ liệu',
      subtitle: 'Lọc mã ngân hàng, trích xuất và gom nhóm đối tác',
      icon: '🧹',
      accentColor: 'from-sky-500 to-cyan-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
    {
      id: 'revenue',
      title: 'Chuẩn hóa doanh thu',
      subtitle: 'Rule engine và LLM có chọn lọc cho giao dịch vùng xám',
      icon: '💰',
      accentColor: 'from-emerald-500 to-green-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
    {
      id: 'fraud',
      title: 'Gian lận & bất thường',
      subtitle: 'Window dressing, dòng tiền quay vòng và rủi ro hành vi',
      icon: '🛡️',
      accentColor: 'from-red-500 to-rose-600',
      status: 'pending',
      progress: 0,
      output: null,
      duration: null,
    },
  ];
}

function getFileIcon(name: string): string {
  return name.toLowerCase().endsWith('.pdf') ? '📄' : '📎';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function StatementAnalyzePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [realFiles, setRealFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>(getInitialSteps());
  const [resultData, setResultData] = useState<any>(null);
  const [apiKeyId, setApiKeyId] = useState('');
  const [extraInstruction, setExtraInstruction] = useState('');
  const [appliedInstruction, setAppliedInstruction] = useState('');

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
      const finalOutput = existingOutput && newPreview
        ? `${existingOutput}\n\n── Kết quả ──\n${newPreview}`
        : existingOutput || newPreview;
      newSteps[stepIdx] = { ...newSteps[stepIdx], status: 'done', progress: 100, output: finalOutput };
      const nextIdx = stepIdx + 1;
      if (nextIdx < newSteps.length && newSteps[nextIdx].status === 'pending') {
        newSteps[nextIdx] = { ...newSteps[nextIdx], status: 'running', progress: 15 };
      }
      return newSteps;
    });
  }, []);

  const polling = useStatementPolling({
    onStepReveal: revealStep,
    onComplete: (extractedData) => {
      setResultData(extractedData);
      setPipelineComplete(true);
      setIsProcessing(false);
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
    const input = document.getElementById('file-input') as HTMLInputElement | null;
    if (input) input.value = '';
  }, [resetPipeline]);

  const runPipeline = async () => {
    if (files.length < 1 || isProcessing) return;
    const instruction = extraInstruction.trim();
    setIsProcessing(true);
    setPipelineError(null);
    setResultData(null);
    setAppliedInstruction(instruction);
    resetPipeline();

    setSteps(prev => prev.map((s, idx) =>
      idx === 0 ? { ...s, status: 'running' as StepStatus, progress: 5 } : s
    ));

    try {
      await polling.submitWorkflow(files, realFiles, apiKeyId || undefined, instruction || undefined);
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

  const hasPdf = files.some(f => f.name.toLowerCase().endsWith('.pdf'));
  const canRun = hasPdf && !isProcessing && !!apiKeyId;

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
            Statement Analyze — Live API
          </div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold tracking-tight mb-3">
            <span className="text-gradient">Phân tích Sao kê Ngân hàng</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            Upload file PDF sao kê → OCR trích xuất giao dịch → tính số dư bình quân, chu kỳ 6 tháng SDBQ cao nhất, cực trị số dư, tổng ngày/giao dịch.
          </p>

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
        {/* Upload zone */}
        <div className="modern-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg">📁</div>
            <div>
              <h2 className="font-heading font-bold text-lg">Upload Sao kê</h2>
              <p className="text-muted-foreground text-xs">Cần ít nhất 1 file PDF sao kê (cùng 1 tài khoản)</p>
            </div>
          </div>

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
            <p className="text-xs text-muted-foreground">PDF sao kê ngân hàng</p>
            <input
              id="file-input"
              type="file"
              multiple
              accept=".pdf"
              className="hidden"
              onChange={e => e.target.files && handleFileInput(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {files.length} file đã chọn
                  {!hasPdf && <span className="text-red-500 ml-2">⚠ Thiếu PDF</span>}
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
                <>▶ Bắt đầu Phân tích</>
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

        {/* Pipeline steps */}
        {files.length > 0 && (isProcessing || pipelineComplete) && (
          <div className="space-y-3">
            {steps.map((step, i) => (
              <StepCard key={step.id} step={step} index={i} />
            ))}
          </div>
        )}

        {/* Result */}
        {resultData && (
          <div id="statement-result-panel">
            <ResultPanel data={resultData} apiKey={apiKeyId || undefined} />
          </div>
        )}

        {/* Refine & re-run with an extra instruction */}
        {pipelineComplete && !isProcessing && files.length > 0 && (
          <div className="modern-card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-lg">✏️</div>
              <div>
                <h3 className="font-heading font-bold text-sm">Bổ sung chỉ thị & chạy lại</h3>
                <p className="text-xs text-muted-foreground">
                  Kết quả chưa đúng? Thêm chỉ thị cho model rồi chạy lại từ đầu với prompt đã được gộp. Ví dụ: &quot;Năm của tất cả giao dịch là 2025&quot;.
                </p>
              </div>
            </div>

            {appliedInstruction && (
              <div className="text-[11px] text-muted-foreground bg-muted/50 border border-border/50 rounded-lg px-3 py-2">
                <span className="font-semibold">Chỉ thị đã áp dụng cho lần chạy này:</span> {appliedInstruction}
              </div>
            )}

            <textarea
              className="w-full min-h-[80px] px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
              placeholder={'Nhập chỉ thị bổ sung, ví dụ:\n- Năm của tất cả giao dịch là 2025\n- Cột số dư là cột ngoài cùng bên phải'}
              value={extraInstruction}
              onChange={(e) => setExtraInstruction(e.target.value)}
            />

            <div className="flex items-center gap-2">
              <button
                onClick={runPipeline}
                disabled={!canRun || !extraInstruction.trim()}
                className="modern-button btn-primary text-sm gap-2 disabled:opacity-50"
              >
                ↻ Chạy lại với chỉ thị
              </button>
              {extraInstruction.trim() && (
                <button onClick={() => setExtraInstruction('')} className="modern-button btn-outline text-sm">
                  Xoá chỉ thị
                </button>
              )}
              {!apiKeyId && <span className="text-[11px] text-red-500">Cần API Key để chạy lại.</span>}
            </div>
          </div>
        )}
      </div>

      {/* Floating progress */}
      {isProcessing && (
        <div className="fixed bottom-6 right-6 px-4 py-2.5 rounded-2xl bg-card/90 backdrop-blur-xl border border-primary/20 shadow-lg flex items-center gap-3 z-50">
          <Spinner />
          <span className="text-sm font-medium">Đang phân tích...</span>
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
