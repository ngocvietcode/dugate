'use client';

// app/structure-compare/components/PipelineStepCard.tsx
// Visual step card showing pipeline phase status (pending, running, done, error).

import React from 'react';
import type { PipelineStep } from '../types';

interface PipelineStepCardProps {
  step: PipelineStep;
  isActive: boolean;
  stepIndex: number;
}

export function PipelineStepCard({ step, isActive, stepIndex }: PipelineStepCardProps) {
  const statusStyles: Record<string, string> = {
    pending: 'border-gray-200 bg-gray-50 opacity-60',
    running: 'border-blue-300 bg-blue-50 ring-2 ring-blue-200',
    done: 'border-green-200 bg-green-50',
    error: 'border-red-200 bg-red-50',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    pending: <span className="text-gray-400">○</span>,
    running: (
      <span className="inline-block animate-spin text-blue-500">⟳</span>
    ),
    done: <span className="text-green-500">✓</span>,
    error: <span className="text-red-500">✗</span>,
  };

  return (
    <div
      className={`rounded-lg border p-4 transition-all duration-300 ${statusStyles[step.status] || statusStyles.pending}`}
      role="listitem"
      aria-label={`${step.title} - ${step.status}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-medium shadow-sm">
          {statusIcons[step.status]}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">
              Bước {stepIndex + 1}
            </span>
            <h3 className="text-sm font-semibold text-gray-800">
              {step.title}
            </h3>
          </div>
          <p className="text-xs text-gray-500">{step.subtitle}</p>
        </div>
        {step.duration !== null && (
          <span className="text-xs text-gray-400">
            {(step.duration / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Progress bar for running state */}
      {step.status === 'running' && step.progress > 0 && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${step.progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-blue-600">{step.output || 'Đang xử lý...'}</p>
        </div>
      )}

      {/* Output for completed state */}
      {step.status === 'done' && step.output && (
        <p className="mt-2 text-xs text-green-700">{step.output}</p>
      )}

      {/* Error message */}
      {step.status === 'error' && step.output && (
        <p className="mt-2 text-xs text-red-600">{step.output}</p>
      )}
    </div>
  );
}
