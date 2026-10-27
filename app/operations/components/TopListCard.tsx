'use client';

import { ArrowRight } from 'lucide-react';
import { formatCost, formatInt } from '../lib/format';

export interface TopListEntry {
  key: string;
  name: string;
  value: number;
  /** Optional secondary metric shown muted (e.g. total when ranking by failures) */
  subValue?: string;
  /** Emphasis color for the value */
  tone?: 'default' | 'danger' | 'money';
}

interface TopListCardProps {
  title: string;
  icon: React.ReactNode;
  entries: TopListEntry[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyText?: string;
  onSelect?: (key: string) => void;
}

export default function TopListCard({
  title, icon, entries, loading, error, onRetry,
  emptyText = 'Không có dữ liệu', onSelect,
}: TopListCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between animate-pulse">
              <div className="h-3 bg-muted rounded w-32" />
              <div className="h-3 bg-muted rounded w-10" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="py-5 text-center" role="alert">
          <p className="text-sm text-red-600 dark:text-red-400">Không thể tải dữ liệu.</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium text-primary hover:text-primary/80">
              Thử lại
            </button>
          )}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry, index) => (
            <li key={entry.key}>
              <button
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(entry.key)}
                className={`
                  w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors
                  ${onSelect ? 'hover:bg-muted cursor-pointer' : 'cursor-default'}
                `}
              >
                <span className="text-[11px] font-mono text-muted-foreground w-4 shrink-0">{index + 1}</span>
                <span className="flex-1 min-w-0 truncate text-sm text-foreground" title={entry.name}>
                  {entry.name}
                </span>
                {entry.subValue && (
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{entry.subValue}</span>
                )}
                <span
                  className={`text-sm font-semibold tabular-nums shrink-0 ${
                    entry.tone === 'danger'
                      ? 'text-red-600 dark:text-red-400'
                      : entry.tone === 'money'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-foreground'
                  }`}
                >
                  {entry.tone === 'money' ? formatCost(entry.value) : formatInt(entry.value)}
                </span>
                {onSelect && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
