// components/PageStatusBadge.tsx
// Navigation lifecycle badge (stable/beta/internal/deprecated) for the page registry.
// Separate from components/StatusBadge.tsx (which is the file-conversion status pill).

import { STATUS_META, type PageStatus } from '@/lib/navigation/registry';

export function PageStatusBadge({ status, className = '' }: { status: PageStatus; className?: string }) {
  // `stable` is the default expectation — don't clutter the UI with it.
  if (status === 'stable') return null;
  const meta = STATUS_META[status];
  return (
    <span
      className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${meta.className} ${className}`}
    >
      {meta.label}
    </span>
  );
}
