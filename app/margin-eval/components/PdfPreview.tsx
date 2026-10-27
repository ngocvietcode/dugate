'use client';

// app/margin-eval/components/PdfPreview.tsx
// PDF preview with its OWN page navigation (prev/next/jump), rendered server-side
// (POST /api/margin-eval/render → PNG). You can browse pages freely without
// selecting a field. Selecting a field with a `page` jumps the viewer to it and
// draws the optional bbox overlay (normalized 0..1000, [ymin,xmin,ymax,xmax]).

import React, { useEffect, useRef, useState } from 'react';

interface PdfPreviewProps {
  file: File | null;
  /** Page requested by an external field selection (1-based). Null = keep current. */
  requestedPage?: number | null;
  bbox?: [number, number, number, number] | null;
}

export function PdfPreview({ file, requestedPage, bbox }: PdfPreviewProps) {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const urlRef = useRef<string | null>(null);

  // Reset to page 1 when the file changes.
  useEffect(() => { setPage(1); setTotalPages(0); }, [file]);

  // Jump to a field-requested page (only when it actually changes).
  useEffect(() => {
    if (requestedPage && requestedPage > 0) setPage(requestedPage);
  }, [requestedPage]);

  // Render the requested page server-side. Guarded against races and unmount:
  // an `active` flag + AbortController ensure a slower earlier request cannot
  // overwrite a newer page's image, and no object URL is created after the
  // effect is torn down (prevents both stale-image and leaked-URL bugs).
  useEffect(() => {
    if (!file) { setImgUrl(null); return; }

    let active = true;
    const controller = new AbortController();

    async function doRender(targetPage: number) {
      setLoading(true); setError(null);
      try {
        const form = new FormData();
        form.append('file', file!, file!.name);
        form.append('page', String(targetPage || 1));
        const res = await fetch('/api/margin-eval/render', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const tp = parseInt(res.headers.get('X-Total-Pages') || '0', 10);
        if (!active) return;
        if (tp > 0) setTotalPages(tp);
        const blob = await res.blob();
        if (!active) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setImgUrl(url);
      } catch (err) {
        if (!active || (err instanceof Error && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    void doRender(page);

    return () => { active = false; controller.abort(); };
  }, [file, page]);

  // Revoke the last object URL when the component unmounts.
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const overlay = bbox
    ? (() => {
        const [ymin, xmin, ymax, xmax] = bbox;
        return { left: `${(xmin / 1000) * 100}%`, top: `${(ymin / 1000) * 100}%`, width: `${((xmax - xmin) / 1000) * 100}%`, height: `${((ymax - ymin) / 1000) * 100}%` };
      })()
    : null;

  if (!file) return <div className="text-xs text-muted-foreground p-4">Upload file và chạy để xem preview.</div>;

  const maxPage = totalPages > 0 ? totalPages : Math.max(page, 1);
  const canPrev = page > 1;
  const canNext = totalPages === 0 || page < totalPages;

  return (
    <div>
      {/* Page navigation toolbar */}
      <div className="flex items-center justify-center gap-2 mb-2">
        <button onClick={() => setPage(1)} disabled={!canPrev} className="modern-button btn-outline text-xs px-2 disabled:opacity-40" title="Trang đầu">«</button>
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!canPrev} className="modern-button btn-outline text-xs px-2 disabled:opacity-40">‹ Trước</button>
        <div className="flex items-center gap-1 text-xs">
          <input
            type="number" min={1} max={maxPage} value={page}
            onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) setPage(Math.min(Math.max(1, v), maxPage)); }}
            className="w-14 px-2 py-1 rounded border border-border bg-background text-center"
          />
          <span className="text-muted-foreground">/ {totalPages > 0 ? totalPages : '?'}</span>
        </div>
        <button onClick={() => setPage((p) => (totalPages > 0 ? Math.min(totalPages, p + 1) : p + 1))} disabled={!canNext} className="modern-button btn-outline text-xs px-2 disabled:opacity-40">Sau ›</button>
        <button onClick={() => totalPages > 0 && setPage(totalPages)} disabled={totalPages === 0 || page >= totalPages} className="modern-button btn-outline text-xs px-2 disabled:opacity-40" title="Trang cuối">»</button>
      </div>

      {loading && <div className="text-xs text-muted-foreground p-2 text-center">Đang render trang {page}...</div>}
      {error && <div className="text-xs text-destructive p-2">Không render được PDF: {error}</div>}
      {imgUrl && (
        <div className="relative inline-block w-full text-center">
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgUrl} alt={`PDF page ${page}`} className="max-w-full rounded-lg border border-border/50" />
            {overlay && <div className="absolute border-2 border-red-500 bg-red-500/20 rounded pointer-events-none" style={overlay} aria-label="bbox highlight" />}
          </div>
        </div>
      )}
    </div>
  );
}
