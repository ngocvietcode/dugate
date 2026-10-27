'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, RotateCcw, X } from 'lucide-react';
import { useStuckOperations } from '../hooks/useStuckOperations';
import OperationStateBadge from './OperationStateBadge';

export default function StuckAlertBanner() {
  const { data, loading, error, retry } = useStuckOperations();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const closeModal = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (loading && !data) return <StuckBannerSkeleton />;

  if (error && !data) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3" role="alert">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        <button type="button" onClick={retry} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary">
          <RotateCcw className="w-3.5 h-3.5" /> Thử lại
        </button>
      </div>
    );
  }

  if (!data || data.count === 0) return null;
  const longest = data.items[0];

  return (
    <>
      <div className="mb-4 rounded-xl border border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-4 py-3" role="alert">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            <span className="relative flex h-5 w-5 shrink-0 mt-0.5" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-40" />
              <AlertTriangle className="relative w-5 h-5 text-red-600 dark:text-red-400" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                {data.count} request nghi treo
                <span className="font-normal text-red-700/80 dark:text-red-400/80">
                  {' '}— RUNNING &gt; {data.thresholds.running_min} phút hoặc PENDING &gt; {data.thresholds.pending_min} phút
                </span>
              </p>
              {longest && (
                <p className="text-xs text-red-700/80 dark:text-red-400/70 truncate mt-0.5">
                  Lâu nhất: <span className="font-mono">{longest.id.slice(0, 8)}</span>
                  {longest.endpointSlug ? ` · ${longest.endpointSlug}` : ''}
                  {longest.profileName ? ` · ${longest.profileName}` : ''}
                  {' '}· treo {formatMinutes(longest.stuckMinutes)}
                </p>
              )}
              {error && <p className="mt-1 text-xs text-red-700 dark:text-red-400">Không thể làm mới; đang hiển thị dữ liệu gần nhất.</p>}
            </div>
          </div>

          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors self-start sm:self-auto"
          >
            Xem ngay <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="stuck-dialog-title"
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 id="stuck-dialog-title" className="text-base font-semibold text-foreground">Request nghi treo</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Heuristic theo lần cập nhật cuối; đây không phải cơ chế retry/resume của DU.
                </p>
              </div>
              <button ref={closeRef} type="button" onClick={closeModal} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Đóng danh sách request treo">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto p-4">
              {data.count > data.items.length && (
                <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
                  Đang hiển thị {data.items.length}/{data.count} request treo lâu nhất.
                </p>
              )}
              <ul className="space-y-2">
                {data.items.map((item) => {
                  const reference = item.clientReference || item.correlationId;
                  return (
                    <li key={item.id} className="rounded-xl border border-border p-3 hover:bg-muted/30">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-foreground" title={item.id}>{item.id}</span>
                            <OperationStateBadge state={item.state} />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground truncate">
                            {item.endpointSlug || 'Không rõ endpoint'} · {item.profileName || 'Không có profile'}
                            {reference ? ` · ${reference}` : ''}
                          </p>
                          <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                            Không cập nhật {formatMinutes(item.stuckMinutes)} · lần cuối {formatDateTime(item.updatedAt)}
                          </p>
                        </div>
                        <Link href={`/operations/${item.id}`} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80">
                          Xem chi tiết <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} phút`;
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  return minutes > 0 ? `${hours}h${minutes}p` : `${hours} giờ`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

export function StuckBannerSkeleton() {
  return (
    <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="w-3 h-3 animate-spin" /> Đang kiểm tra request treo...
    </div>
  );
}
