'use client';

// app/ai-demo/components/CompletionBanner.tsx
// Success/failure banner shown when the pipeline completes.

import React from 'react';
import type { PipelineStep } from '../types';
import { CheckIcon, AlertTriangleIcon } from './Icons';

interface CompletionBannerProps {
  steps: PipelineStep[];
  files: { length: number };
  error?: string | null;
}

export function CompletionBanner({ steps, files, error }: CompletionBannerProps) {
  const hasError = !!error || steps.some(s => s.status === 'error');
  const totalTime = steps.reduce((sum, s) => sum + (s.duration || 0), 0);

  if (hasError) {
    return (
      <div className="modern-card p-6 text-center border-destructive/30 bg-destructive/5 animate-in fade-in slide-in-from-bottom-4 duration-500" role="alert">
        <div className="text-4xl mb-3">⚠️</div>
        <h3 className="font-heading font-bold text-xl mb-1">Pipeline gặp lỗi</h3>
        <p className="text-muted-foreground text-sm mb-2">
          {error || 'Một hoặc nhiều bước xử lý thất bại. Xem chi tiết ở trên.'}
        </p>
        <div className="flex items-center justify-center gap-6 text-sm flex-wrap mt-3">
          {steps.map(s => (
            <div key={s.id} className="flex items-center gap-1.5">
              {s.status === 'done' ? (
                <CheckIcon className="w-4 h-4 text-emerald-500" />
              ) : s.status === 'error' ? (
                <AlertTriangleIcon className="w-4 h-4 text-destructive" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-muted-foreground/30 inline-block" />
              )}
              <span className={`font-medium ${s.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                {s.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="modern-card p-6 text-center border-emerald-500/30 bg-emerald-500/5 animate-in fade-in slide-in-from-bottom-4 duration-500" role="status">
      <div className="text-4xl mb-3">🎉</div>
      <h3 className="font-heading font-bold text-xl mb-1">Pipeline hoàn tất!</h3>
      <p className="text-muted-foreground text-sm mb-4">
        Đã xử lý {files.length} file qua {steps.length} bước AI thành công.
        Tổng thời gian: {(totalTime / 1000).toFixed(1)}s
      </p>
      <div className="flex items-center justify-center gap-6 text-sm flex-wrap">
        {steps.map(s => (
          <div key={s.id} className="flex items-center gap-1.5">
            <CheckIcon className="w-4 h-4 text-emerald-500" />
            <span className="text-muted-foreground font-medium">{s.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
