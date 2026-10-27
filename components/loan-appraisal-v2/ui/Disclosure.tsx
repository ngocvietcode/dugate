'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { FOCUS_RING } from './toneClasses';

/** details/summary gốc; nội dung nặng chỉ mount khi đã mở (`lazy`). */
export function Disclosure({ summary, children, defaultOpen = false, lazy = true, className = '' }: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  lazy?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className={`group rounded-lg border border-border bg-muted/30 ${className}`}
    >
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs font-semibold text-foreground ${FOCUS_RING}`}>
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      {(open || !lazy) && <div className="border-t border-border px-3 py-3">{children}</div>}
    </details>
  );
}
