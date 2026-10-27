'use client';

// app/ai-demo/components/ParallelFileGrid.tsx
// Sub-cards for parallel file processing within a pipeline step.

import React from 'react';
import type { FileProgress } from '../types';
import { SpinnerIcon, CheckIcon } from './Icons';

interface ParallelFileGridProps {
  filesProgress: FileProgress[];
}

export function ParallelFileGrid({ filesProgress }: ParallelFileGridProps) {
  if (filesProgress.length === 0) return null;

  return (
    <div className="border-t border-border/50 bg-muted/10 p-4 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="space-y-3">
        {filesProgress.map((fp) => (
          <div key={fp.id} className="modern-card border border-border/50 bg-card/50 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-3">
                <span aria-hidden="true">{fp.file.icon}</span>
                <div>
                  <p className="text-sm font-medium">{fp.file.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {fp.status === 'running' && (
                      <><SpinnerIcon className="w-3 h-3 text-primary" /> Đang bóc tách ({fp.progress}%)</>
                    )}
                    {fp.status === 'done' && (
                      <><CheckIcon className="w-3 h-3 text-emerald-500" /> Hoàn tất {fp.duration != null ? `${(fp.duration / 1000).toFixed(1)}s` : ''}</>
                    )}
                    {fp.status === 'pending' && <span>Chờ xử lý...</span>}
                    {fp.status === 'error' && (
                      <span className="text-destructive">❌ Lỗi</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {fp.output && (
              <div className="px-4 py-3 bg-black/5 dark:bg-white/5 max-h-[200px] overflow-y-auto">
                <pre className="text-xs font-mono leading-relaxed text-foreground/80 whitespace-pre-wrap break-all">
                  {typeof fp.output === 'object' ? JSON.stringify(fp.output, null, 2) : fp.output}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
