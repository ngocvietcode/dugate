'use client';

// app/margin-eval/page.tsx
// Margin Deposit — Human-in-the-loop Eval UI.
// Upload files → chọn 1 trong 4 mode → chạy workflow thật → xem từng field →
// tick đúng/sai → chấm accuracy + token/cost/time. Preview PDF + highlight bbox.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DOC_TYPES, type DocType, type EvalFile, type FileRole, type Judgement, type MarginMode, type ReviewDocument, type ReviewItem, type RunStatus, type UsageStats } from './types';
import { useMarginEval } from './hooks/useMarginEval';
import { buildReviewDocuments } from './lib/buildReview';
import { ReviewPanel } from './components/ReviewPanel';
import { PdfPreview } from './components/PdfPreview';

const MODES: { key: MarginMode; label: string; hint: string }[] = [
  { key: 'classify', label: 'Classify', hint: 'Phân loại — không cần doc_type' },
  { key: 'extraction', label: 'Extraction', hint: 'Bóc tách field — mỗi file 1 chứng từ, cần doc_type' },
  { key: 'framework', label: 'Framework', hint: 'Đối chiếu khung — cần doc_type + role customer/template' },
  { key: 'validation', label: 'Validation', hint: 'Copy-check + template-check — cần group_id cho TTKQ/BBTL' },
];

function formatBytes(b: number) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`; }

export default function MarginEvalPage() {
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<MarginMode>('extraction');
  const [files, setFiles] = useState<EvalFile[]>([]);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [progress, setProgress] = useState<{ percent: number; message?: string }>({ percent: 0 });
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<ReviewDocument[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const evalRun = useMarginEval({
    onProgress: (percent, message) => setProgress({ percent, message }),
    onComplete: (result, u) => {
      setDocs(buildReviewDocuments(mode, result, files));
      setUsage(u);
      setActiveIndex(0);
      setSelected(null);
      setStatus('done');
    },
    onError: (msg) => { setError(msg); setStatus('error'); },
  });

  // Mirror the current files in a ref so the unmount cleanup can revoke every
  // outstanding object URL without re-running on each files change (which would
  // otherwise revoke URLs still in use).
  const filesRef = useRef<EvalFile[]>([]);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => () => {
    filesRef.current.forEach((f) => { if (f.objectUrl) URL.revokeObjectURL(f.objectUrl); });
  }, []);

  const needsMeta = mode !== 'classify';
  const needsRole = mode === 'framework' || mode === 'validation';
  const needsGroup = mode === 'validation';

  // ── File handling ──
  const addFiles = useCallback((list: FileList) => {
    const added: EvalFile[] = Array.from(list).map((f) => ({
      id: crypto.randomUUID(), file: f, name: f.name, size: f.size,
      doc_type: '', role: 'customer' as FileRole, group_id: '',
      objectUrl: URL.createObjectURL(f), pageCount: 0,
    }));
    setFiles((prev) => [...prev, ...added]);
    setStatus('idle'); setDocs([]); setError(null);

    // Fetch page count per file (best-effort) so the report can include it.
    added.forEach(async (ef) => {
      try {
        const form = new FormData();
        form.append('file', ef.file, ef.name);
        const res = await fetch('/api/margin-eval/pageinfo', { method: 'POST', body: form });
        if (!res.ok) return;
        const info = await res.json();
        setFiles((prev) => prev.map((x) => (x.id === ef.id ? { ...x, pageCount: info.pages || 0 } : x)));
      } catch { /* ignore — page count is optional */ }
    });
  }, []);

  const updateFile = useCallback((id: string, patch: Partial<EvalFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => { const t = prev.find((f) => f.id === id); if (t?.objectUrl) URL.revokeObjectURL(t.objectUrl); return prev.filter((f) => f.id !== id); });
    setStatus('idle'); setDocs([]);
  }, []);

  const clearAll = useCallback(() => {
    files.forEach((f) => f.objectUrl && URL.revokeObjectURL(f.objectUrl));
    setFiles([]); setStatus('idle'); setDocs([]); setError(null); setSelected(null);
  }, [files]);

  // ── Validation of the form before run ──
  const canRun = useMemo(() => {
    if (!apiKey || files.length === 0 || status === 'running' || status === 'submitting') return false;
    if (needsMeta && files.some((f) => !f.doc_type)) return false;
    if (needsGroup) {
      const bad = files.some((f) => (f.role || 'customer') === 'customer'
        && (f.doc_type === 'thoa_thuan_ky_quy' || f.doc_type === 'thanh_ly_ky_quy') && !f.group_id?.trim());
      if (bad) return false;
    }
    return true;
  }, [apiKey, files, status, needsMeta, needsGroup]);

  const run = async () => {
    setStatus('submitting'); setError(null); setDocs([]); setUsage(null); setSelected(null);
    try {
      await evalRun.submit({ mode, files, apiKey });
      setStatus('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const judge = useCallback((docId: string, key: string, j: Judgement) => {
    setDocs((prev) => prev.map((d) => d.docId !== docId ? d : { ...d, items: d.items.map((it) => it.key === key ? { ...it, judgement: j } : it) }));
  }, []);

  // Batch-judge many items of one document in a SINGLE state update (avoids the
  // N re-renders / N array re-allocations of calling judge() in a loop).
  // `keys === null` means "all items"; otherwise only the listed keys, and
  // `onlyUnset` restricts the update to items still unjudged.
  const judgeDoc = useCallback((docId: string, keys: string[] | null, j: Judgement, onlyUnset = false) => {
    const keySet = keys ? new Set(keys) : null;
    setDocs((prev) => prev.map((d) => d.docId !== docId ? d : {
      ...d,
      items: d.items.map((it) => {
        if (keySet && !keySet.has(it.key)) return it;
        if (onlyUnset && it.judgement !== 'unset') return it;
        return { ...it, judgement: j };
      }),
    }));
  }, []);

  const selectItem = useCallback((item: ReviewItem) => setSelected(item), []);

  // Switching document tab: clear the selected item so the preview follows the
  // active document's own file (page 1) instead of a stale field from another doc.
  const changeActive = useCallback((idx: number) => { setActiveIndex(idx); setSelected(null); }, []);

  const bulkJudge = useCallback((j: Judgement) => {
    setDocs((prev) => prev.map((d) => ({ ...d, items: d.items.map((it) => it.judgement === 'unset' ? { ...it, judgement: j } : it) })));
  }, []);

  const exportSession = useCallback(() => {
    const payload = {
      exported_at: new Date().toISOString(),
      mode,
      operation_id: evalRun.operationId,
      usage,
      files: files.map((f) => ({ name: f.name, size_bytes: f.size, page_count: f.pageCount ?? 0, doc_type: f.doc_type, role: f.role, group_id: f.group_id })),
      documents: docs.map((d) => ({ title: d.title, items: d.items.map((it) => ({ key: it.key, label: it.label, value: it.value, judgement: it.judgement })) })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `margin-eval-${mode}-${evalRun.operationId?.slice(0, 8) || 'session'}.json`;
    a.click(); URL.revokeObjectURL(url);
  }, [mode, evalRun.operationId, usage, files, docs]);

  // Preview file resolution: selected item's file first, else the active
  // document's own file (resolveFileId now always yields one via positional
  // fallback), else the first uploaded file so preview is never blank.
  const activeDocFileId = docs[activeIndex]?.fileId;
  const previewFileId = selected?.fileId ?? activeDocFileId;
  const selectedFile = previewFileId
    ? (files.find((f) => f.id === previewFileId)?.file ?? null)
    : (files[0]?.file ?? null);
  const busy = status === 'running' || status === 'submitting';

  // Export is only offered once EVERY field has been judged (no 'unset' left).
  const totalItems = docs.reduce((n, d) => n + d.items.length, 0);
  const unjudged = docs.reduce((n, d) => n + d.items.filter((it) => it.judgement === 'unset').length, 0);
  const allJudged = docs.length > 0 && totalItems > 0 && unjudged === 0;

  return (
    <div className="min-h-screen pb-20">
      <div className="max-w-7xl mx-auto px-4 pt-8 space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-heading font-bold text-gradient mb-2">Margin Deposit — Eval</h1>
          <p className="text-muted-foreground text-sm">Upload → chạy mode → tick đúng/sai từng field → chấm chất lượng, token, chi phí.</p>
          <input
            type="password" placeholder="Nhập x-api-key (bắt buộc)"
            className={`mt-4 mx-auto block w-full max-w-sm px-3 py-2 text-xs bg-background border rounded-lg text-center ${!apiKey ? 'border-red-300' : 'border-border'}`}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={busy}
          />
        </div>

        {/* Mode selector */}
        <div className="modern-card p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {MODES.map((m) => (
              <button key={m.key} onClick={() => { setMode(m.key); setStatus('idle'); setDocs([]); }} disabled={busy}
                className={`p-3 rounded-xl text-left border transition-all ${mode === m.key ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border hover:border-primary/40'}`}>
                <div className="font-bold text-sm">{m.label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{m.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Upload + per-file meta */}
        <div className="modern-card p-4">
          <div
            role="button" tabIndex={0}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 ${busy ? 'opacity-50 pointer-events-none' : 'border-border'}`}
            onClick={() => document.getElementById('me-file-input')?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          >
            <div className="text-3xl mb-1">📤</div>
            <p className="text-sm font-semibold">Kéo thả PDF hoặc click để chọn</p>
            <input id="me-file-input" type="file" multiple accept=".pdf" className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-muted-foreground uppercase">{files.length} file</span>
                {!busy && <button onClick={clearAll} className="text-xs text-destructive font-medium">Xóa tất cả</button>}
              </div>
              {files.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/50">
                  <span className="text-lg">📄</span>
                  <div className="flex-1 min-w-[140px]">
                    <p className="text-sm font-medium truncate">{f.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatBytes(f.size)}</p>
                  </div>
                  {needsMeta && (
                    <select value={f.doc_type} onChange={(e) => updateFile(f.id, { doc_type: e.target.value as DocType })} disabled={busy}
                      className={`text-xs px-2 py-1 rounded border bg-background ${!f.doc_type ? 'border-red-300' : 'border-border'}`}>
                      <option value="">-- doc_type --</option>
                      {DOC_TYPES.map((dt) => <option key={dt} value={dt}>{dt}</option>)}
                    </select>
                  )}
                  {needsRole && (
                    <select value={f.role} onChange={(e) => updateFile(f.id, { role: e.target.value as FileRole })} disabled={busy}
                      className="text-xs px-2 py-1 rounded border border-border bg-background">
                      <option value="customer">customer</option>
                      <option value="template">template</option>
                    </select>
                  )}
                  {needsGroup && (f.role || 'customer') === 'customer' && (
                    <input value={f.group_id} onChange={(e) => updateFile(f.id, { group_id: e.target.value })} disabled={busy}
                      placeholder="group_id" className="text-xs px-2 py-1 rounded border border-border bg-background w-28" />
                  )}
                  {!busy && <button onClick={() => removeFile(f.id)} className="text-xs text-muted-foreground hover:text-destructive">✕</button>}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button onClick={run} disabled={!canRun} className="modern-button btn-primary text-sm disabled:opacity-50">
              {busy ? 'Đang chạy...' : '▶ Chạy đánh giá'}
            </button>
            {status === 'done' && <span className="text-xs text-emerald-600 font-medium">✓ Hoàn tất</span>}
          </div>
          {busy && <p className="text-xs text-muted-foreground mt-2">{progress.message || `Đang xử lý... ${progress.percent}%`}</p>}
          {error && <p className="text-xs text-destructive mt-2">⚠️ {error}</p>}
        </div>

        {/* Usage summary */}
        {usage && (
          <div className="modern-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div><div className="text-[10px] text-muted-foreground uppercase">Input tokens</div><div className="font-bold">{usage.input_tokens.toLocaleString()}</div></div>
            <div><div className="text-[10px] text-muted-foreground uppercase">Output tokens</div><div className="font-bold">{usage.output_tokens.toLocaleString()}</div></div>
            <div><div className="text-[10px] text-muted-foreground uppercase">Cost (USD)</div><div className="font-bold">${usage.cost_usd.toFixed(6)}</div></div>
            <div><div className="text-[10px] text-muted-foreground uppercase">Thời gian</div><div className="font-bold">{usage.seconds}s</div></div>
          </div>
        )}

        {/* Review + preview */}
        {docs.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button onClick={() => bulkJudge('correct')} className="modern-button btn-outline text-xs">Đánh dấu còn lại: Đúng</button>
                {allJudged ? (
                  <button onClick={exportSession} className="modern-button btn-primary text-xs">📥 Export JSON</button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Còn <span className="font-semibold text-amber-600">{unjudged}</span>/{totalItems} field chưa chấm — chấm hết để export.
                  </span>
                )}
              </div>
              <ReviewPanel documents={docs} onJudge={judge} onJudgeDoc={judgeDoc} onSelectItem={selectItem} selectedKey={selected?.key ?? null} activeIndex={activeIndex} onActiveIndexChange={changeActive} />
            </div>
            <div className="lg:sticky lg:top-2 self-start">
              <div className="modern-card p-3">
                <div className="text-xs font-semibold text-muted-foreground mb-2">
                  Preview {selected?.page ? `· trang ${selected.page}` : ''} {selected?.bbox ? '· có bbox' : ''}
                </div>
                <PdfPreview file={selectedFile} requestedPage={selected?.page ?? null} bbox={selected?.bbox ?? null} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
