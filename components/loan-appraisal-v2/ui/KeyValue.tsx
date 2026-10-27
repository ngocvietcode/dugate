import type { ReactNode } from 'react';

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export function KeyValueGrid({ children, columns = 'sm:grid-cols-2 lg:grid-cols-4' }: { children: ReactNode; columns?: string }) {
  return <dl className={`grid gap-2 ${columns}`}>{children}</dl>;
}
