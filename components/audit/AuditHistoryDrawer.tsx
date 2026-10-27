'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock3, Loader2, RefreshCw, X } from 'lucide-react';

type HistoryEntityType = 'PROFILE' | 'CONNECTOR';
type Summary = { kind: 'summary'; length: number; hash: string };
type AuditValue = unknown | Summary;
type AuditChange = { from?: AuditValue; to?: AuditValue };
type AuditEntry = {
  id: string;
  entityType: string;
  entityName: string | null;
  action: string;
  outcome: string;
  changes: Record<string, AuditChange> | null;
  actorUserId: string | null;
  actorRole: string | null;
  createdAt: string;
};

type HistoryResponse = { entries: AuditEntry[]; page: number; hasMore: boolean };

function isSummary(value: AuditValue): value is Summary {
  return Boolean(value && typeof value === 'object' && (value as Summary).kind === 'summary');
}

function valueLabel(value: AuditValue | undefined): string {
  if (value === undefined || value === null) return 'chưa cấu hình';
  if (value === 'configured') return 'đã cấu hình';
  if (value === 'not configured') return 'chưa cấu hình';
  if (isSummary(value)) return `${value.length.toLocaleString('vi-VN')} ký tự · #${value.hash}`;
  if (Array.isArray(value)) return value.join(', ') || 'trống';
  return String(value);
}

function outcomeClass(outcome: string): string {
  if (outcome === 'SUCCESS') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  if (outcome === 'BLOCKED') return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300';
}

export function AuditHistoryDrawer({
  entityType,
  entityId,
  entityLabel,
  open,
  onClose,
}: {
  entityType: HistoryEntityType;
  entityId: string;
  entityLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (targetPage: number, append = false) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ entityType, entityId, page: String(targetPage), pageSize: '20' });
      const response = await fetch(`/api/internal/audit-history?${params}`, { cache: 'no-store' });
      const data = await response.json() as HistoryResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Không thể tải lịch sử thay đổi');
      setEntries((previous) => append ? [...previous, ...data.entries] : data.entries);
      setPage(data.page);
      setHasMore(data.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử thay đổi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    void load(0);
    // The open transition deliberately resets the timeline to its first page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entityType, entityId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex justify-end bg-black/45" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-history-title"
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background p-5 shadow-2xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Lịch sử thay đổi</p>
            <h2 id="audit-history-title" className="mt-1 text-xl font-bold">{entityLabel}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ai đã thay đổi cấu hình, khi nào và phần nào đã thay đổi.</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="rounded-lg border border-border p-2 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Đóng lịch sử thay đổi">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div aria-live="polite" className="space-y-3">
          {loading && entries.length === 0 && <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải lịch sử…</div>}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><p>{error}</p><button type="button" onClick={() => void load(0)} className="mt-2 inline-flex items-center gap-1 font-semibold underline"><RefreshCw className="h-3.5 w-3.5" /> Thử lại</button></div>}
          {!loading && !error && entries.length === 0 && <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"><Clock3 className="mx-auto mb-2 h-7 w-7 opacity-50" />Chưa có lịch sử thay đổi được ghi nhận.</div>}
          {entries.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold">{entry.action.replaceAll('_', ' ')}</span>
                {entry.entityType !== entityType && entry.entityName && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">{entry.entityType}: {entry.entityName}</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${outcomeClass(entry.outcome)}`}>{entry.outcome}</span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString('vi-VN')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{entry.actorUserId || 'Hệ thống'}{entry.actorRole ? ` · ${entry.actorRole}` : ''}</p>
              {entry.changes && Object.keys(entry.changes).length > 0 && <dl className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                {Object.entries(entry.changes).map(([field, change]) => <div key={field} className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1"><dt className="font-semibold text-muted-foreground">{field}</dt><dd className="break-words">{valueLabel(change.from)} <span className="mx-1 text-muted-foreground" aria-hidden="true">→</span> {valueLabel(change.to)}</dd></div>)}
              </dl>}
            </article>
          ))}
          {hasMore && <button type="button" disabled={loading} onClick={() => void load(page + 1, true)} aria-label="Xem thêm lịch sử thay đổi" className="w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50">{loading ? 'Đang tải…' : 'Xem thêm'}</button>}
        </div>
      </aside>
    </div>
  );
}
