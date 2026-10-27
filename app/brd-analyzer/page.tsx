'use client';

// app/brd-analyzer/page.tsx
// Màn hình "BRD Quality Evaluator" — upload BRD → đánh giá 32 tiêu chí → điểm /50, %, Đạt/Không đạt.
// UI độc lập; xử lý qua workflow brd-analyze (dùng API Connector đã cấu hình).

import React, { useCallback, useRef, useState } from 'react';
import { useBrdAnalysis } from './useBrdAnalysis';
import {
  Section,
  ScoreHeaderCard,
  GroupBars,
  QuestionTable,
  AssessmentPanel,
  StepStream,
  ScorecardHeaderCard,
  WeightDistribution,
  CriteriaCards,
  MethodologyOverview,
  ResultSummaryStrip,
} from './components';

const ACCEPT = '.pdf,.docx,.xlsx,.xls';

const HERO_PILLS = ['Prioritization Scorecard', 'Business Value 0.6', 'Technical Effort 0.3', 'Reusability 0.1', '32 tiêu chí', 'Đạt ≥ 85%'];

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return '📕';
  if (ext === 'doc' || ext === 'docx') return '📘';
  if (ext === 'xls' || ext === 'xlsx') return '📗';
  return '📄';
}

export default function BrdAnalyzerPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [apiKeyId, setApiKeyId] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState<'scorecard' | 'detail'>('scorecard');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { status, progressPercent, progressMessage, steps, result, error, analyze, reset } = useBrdAnalysis();

  const isProcessing = status === 'submitting' || status === 'running';

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const onRun = () => analyze(files, apiKeyId);
  const onReset = () => {
    reset();
    setFiles([]);
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brd-evaluation.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen pb-24 relative overflow-hidden">
      <div className="glow-cyan -top-72 -left-40 fixed opacity-40" aria-hidden="true" />
      <div className="glow-purple -bottom-52 -right-72 fixed opacity-30" aria-hidden="true" />

      {/* Hero */}
      <header className="relative">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 to-transparent" aria-hidden="true" />
        <div className="max-w-6xl mx-auto px-4 pt-12 pb-8">
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-semibold text-primary uppercase tracking-wider">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              BA Review
            </span>
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">
              Governance-ready
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
            <span className="text-gradient">BRD Prioritization &amp; Evaluation</span>
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-2xl mt-3 leading-relaxed">
            Hai phần đánh giá trong một lần xử lý: <b>Phần 1</b> — Prioritization Scorecard (Final Score 2–10 →
            Priority/Action); <b>Phần 2</b> — đánh giá chi tiết chất lượng BRD theo 32 tiêu chí (thang 50, đạt ≥ 85%).
          </p>

          <div className="flex flex-wrap gap-2 mt-5">
            {HERO_PILLS.map((p) => (
              <span key={p} className="px-3 py-1 text-xs font-medium rounded-full bg-card border border-border text-muted-foreground">
                {p}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 space-y-10">
        {/* Methodology */}
        <Section eyebrow="Phương pháp luận" title="Cách đánh giá" desc="Hai phần độc lập, render trực tiếp từ cấu hình tiêu chí.">
          <MethodologyOverview />
        </Section>

        {/* Intake / Upload */}
        <Section eyebrow="Request Intake" title="Tải lên tài liệu BRD" desc="Hỗ trợ PDF, DOCX, XLSX.">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div
                className={`modern-card p-7 border-2 border-dashed transition-colors cursor-pointer h-full ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !isProcessing && inputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} disabled={isProcessing} />
                <div className="text-center">
                  <div className="text-4xl mb-3">📥</div>
                  <p className="text-sm font-medium">Kéo thả hoặc bấm để chọn file BRD</p>
                  <p className="text-xs text-muted-foreground mt-1">Có thể chọn nhiều file</p>
                </div>

                {files.length > 0 && (
                  <ul className="mt-5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg px-3 py-2">
                        <span>{fileIcon(f.name)}</span>
                        <span className="flex-1 truncate">{f.name}</span>
                        <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                        {!isProcessing && (
                          <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive transition-colors" aria-label="Xoá file">
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="modern-card p-5 flex flex-col">
              <label className="text-xs font-medium text-muted-foreground mb-1.5">Profile API Key ID</label>
              <input
                type="text"
                placeholder="Bắt buộc"
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 mb-4"
                value={apiKeyId}
                onChange={(e) => setApiKeyId(e.target.value)}
                disabled={isProcessing}
              />
              <button onClick={onRun} disabled={isProcessing || files.length === 0} className="modern-button btn-primary text-sm w-full">
                {isProcessing ? 'Đang đánh giá...' : '⚡ Đánh giá BRD'}
              </button>
              {(status === 'done' || status === 'error') && (
                <div className="flex gap-2 mt-2">
                  <button onClick={onReset} className="modern-button btn-outline text-sm flex-1">
                    ↻ Làm lại
                  </button>
                  {status === 'done' && result && (
                    <button onClick={downloadJson} className="modern-button btn-outline text-sm flex-1">
                      ⬇ JSON
                    </button>
                  )}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                Xử lý qua workflow <code className="text-foreground">brd-analyze</code> dùng các API Connector đã cấu hình.
              </p>
            </div>
          </div>
        </Section>

        {/* Error */}
        {error && (
          <div className="modern-card p-4 border-destructive/30 bg-destructive/5 flex items-center gap-3" role="alert">
            <span className="text-destructive text-lg">⚠️</span>
            <p className="text-sm font-medium text-destructive flex-1">{error}</p>
          </div>
        )}

        {/* Progress */}
        {isProcessing && (
          <div className="modern-card p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{progressMessage || 'Đang xử lý...'}</span>
              <span className="text-sm font-semibold text-primary">{progressPercent}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-blue-400 transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}

        {/* Tiến trình + nguồn đọc file */}
        {steps.length > 0 && <StepStream steps={steps} />}

        {/* Results */}
        {status === 'done' && result && (
          <Section
            eyebrow="Evaluation Result"
            title="Kết quả đánh giá BRD"
            desc={`Scorecard ${result.scorecard.finalScore}/10 (${result.scorecard.priority}) · Chi tiết BRD ${result.evaluation.percent}% — ${result.evaluation.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}`}
          >
            {/* Tabs */}
            <ResultSummaryStrip result={result} />
            <div className="flex gap-2 mb-6 border-b border-border">
              <button
                onClick={() => setTab('scorecard')}
                className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
                  tab === 'scorecard' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Phần 1 · Prioritization Scorecard
              </button>
              <button
                onClick={() => setTab('detail')}
                className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
                  tab === 'detail' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Phần 2 · Đánh giá chi tiết BRD
              </button>
            </div>

            {tab === 'scorecard' ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1">
                    <ScorecardHeaderCard scorecard={result.scorecard} />
                  </div>
                  <div className="lg:col-span-2">
                    <WeightDistribution scorecard={result.scorecard} />
                  </div>
                </div>
                <CriteriaCards scorecard={result.scorecard} />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1">
                    <ScoreHeaderCard result={result.evaluation} />
                  </div>
                  <div className="lg:col-span-2">
                    <GroupBars groups={result.evaluation.groups} />
                  </div>
                </div>
                <QuestionTable result={result.evaluation} />
                <AssessmentPanel result={result.evaluation} />
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
