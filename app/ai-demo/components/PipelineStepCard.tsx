'use client';

// app/ai-demo/components/PipelineStepCard.tsx
// Individual pipeline step card with progress, output, and collapse toggle.

import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { PipelineStep } from '../types';
import { SpinnerIcon, CheckIcon, AlertTriangleIcon } from './Icons';
import { ParallelFileGrid } from './ParallelFileGrid';

interface PipelineStepCardProps {
  step: PipelineStep;
  stepIndex: number;
  totalSteps: number;
  isProcessing: boolean;
  onRetry: (stepIndex: number) => void;
  onToggleCollapse: (stepIndex: number) => void;
  isLastStep: boolean;
}

export const PipelineStepCard = React.forwardRef<HTMLDivElement, PipelineStepCardProps>(
  function PipelineStepCard({ step, stepIndex, totalSteps, isProcessing, onRetry, onToggleCollapse, isLastStep }, ref) {

    const statusIcon = () => {
      switch (step.status) {
        case 'running':
          return <SpinnerIcon className="w-6 h-6 text-primary" />;
        case 'done':
          return <CheckIcon className="w-6 h-6 text-emerald-500" />;
        case 'error':
          return <AlertTriangleIcon className="w-6 h-6 text-destructive" />;
        default:
          return <span>{step.icon}</span>;
      }
    };

    const statusRingClass = () => {
      switch (step.status) {
        case 'done':  return 'bg-emerald-500/15 ring-1 ring-emerald-500/30';
        case 'running': return 'bg-primary/15 ring-1 ring-primary/30';
        case 'error': return 'bg-destructive/15 ring-1 ring-destructive/30';
        default: return 'bg-muted ring-1 ring-border/50';
      }
    };

    const cardClass = [
      'modern-card mb-4 overflow-hidden transition-all duration-500',
      step.status === 'running' ? 'ring-1 ring-primary/40 shadow-[0_0_30px_rgba(var(--primary)/0.12)]' : '',
      step.status === 'error' ? 'ring-1 ring-destructive/40 shadow-[0_0_20px_rgba(var(--destructive)/0.1)]' : '',
      step.status === 'pending' && !isProcessing ? 'opacity-60' : '',
    ].filter(Boolean).join(' ');

    const hasOutput = !!step.output || (step.isParallel && step.filesProgress && step.filesProgress.length > 0);
    const isTotrinh = step.id === 'totrinh';

    return (
      <div ref={ref} className="relative" role="article" aria-label={`Bước ${stepIndex + 1}: ${step.title}`}>
        {/* Vertical connector line */}
        {!isLastStep && (
          <div className={`absolute left-[27px] top-[72px] w-0.5 h-[calc(100%-40px)] transition-all duration-500 ${
            step.status === 'done' ? 'bg-gradient-to-b from-primary/60 to-primary/20' : 'bg-border/50'
          }`} />
        )}

        <div className={cardClass}>
          {/* Step header */}
          <div className="p-5 flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 flex-1">
              {/* Status icon */}
              <div className={`w-[54px] h-[54px] rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 transition-all duration-500 ${statusRingClass()}`}>
                {statusIcon()}
              </div>

              {/* Step info */}
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    Bước {stepIndex + 1}
                  </span>
                  {step.status === 'done' && step.duration != null && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      ✓ {(step.duration / 1000).toFixed(1)}s
                    </span>
                  )}
                  {step.status === 'running' && (
                    <span className="inline-flex items-center gap-1 text-xs text-primary font-medium animate-pulse">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                      </span>
                      Đang xử lý...
                    </span>
                  )}
                  {step.status === 'error' && (
                    <span className="text-xs text-destructive font-medium">
                      ❌ Lỗi
                    </span>
                  )}
                </div>
                <h3 className="font-heading font-bold text-lg leading-tight">{step.title}</h3>
                <p className="text-muted-foreground text-sm mt-0.5">{step.subtitle}</p>

                {/* Progress bar */}
                {(step.status === 'running' || step.status === 'done') && (
                  <div className="mt-3 w-full h-1.5 bg-muted rounded-full overflow-hidden flex" role="progressbar" aria-valuenow={step.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div
                      className={`h-full transition-all duration-200 ease-out ${
                        step.status === 'done'
                          ? 'bg-emerald-500 rounded-full'
                          : 'bg-gradient-to-r from-primary via-primary to-primary/60 rounded-full'
                      }`}
                      style={{ width: `${step.progress}%` }}
                    />
                  </div>
                )}

                {/* Error message */}
                {step.status === 'error' && step.output && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                    {step.output}
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-2 pt-1 flex-shrink-0">
              {(step.status === 'done' || step.status === 'error') && !isProcessing && (
                <button
                  onClick={() => onRetry(stepIndex)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-600 dark:text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 transition-colors flex items-center gap-1.5 border border-amber-500/20"
                  aria-label={`Thử lại bước ${stepIndex + 1}`}
                >
                  <span>↻</span> Thử lại
                </button>
              )}
              {hasOutput && step.status !== 'error' && (
                <button
                  onClick={() => onToggleCollapse(stepIndex)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 transition-colors border border-border/50"
                  aria-label={step.isCollapsed ? 'Mở rộng kết quả' : 'Thu gọn kết quả'}
                >
                  {step.isCollapsed ? 'Mở rộng ▼' : 'Thu gọn ▲'}
                </button>
              )}
            </div>
          </div>

          {/* Output panel — single step */}
          {step.output && !step.isParallel && !step.isCollapsed && step.status !== 'error' && (
            <div className="border-t border-border/50 animate-in slide-in-from-top-2 fade-in duration-300">
              <div className="px-5 py-3 flex items-center justify-between bg-muted/30">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  {isTotrinh ? '📝 Tờ trình Output' : '📤 JSON Output'}
                </span>
                {step.status === 'done' && (
                  <button
                    onClick={() => navigator.clipboard.writeText(step.output || '')}
                    className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                    aria-label="Copy output"
                  >
                    📋 Copy
                  </button>
                )}
              </div>
              <div className="px-5 py-4 max-h-[500px] overflow-y-auto bg-card/30">
                {isTotrinh ? (
                  <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none text-foreground prose-headings:font-heading prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:leading-relaxed prose-a:text-primary prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-table:border prose-th:bg-muted/50 prose-td:border-t prose-td:p-2 prose-th:p-2 prose-hr:border-border/50">
                    <ReactMarkdown>{step.output}</ReactMarkdown>
                  </div>
                ) : (
                  <pre className="text-xs font-mono leading-relaxed text-foreground whitespace-pre-wrap break-all">
                    {typeof step.output === 'object' ? JSON.stringify(step.output, null, 2) : step.output}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Output panel — parallel */}
          {step.isParallel && step.filesProgress && step.filesProgress.length > 0 && !step.isCollapsed && (
            <ParallelFileGrid filesProgress={step.filesProgress} />
          )}
        </div>
      </div>
    );
  },
);
