'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, FileText, File, X, Loader2, KeyRound } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { FieldDef, DiscriminatorOption } from '@/lib/endpoints/uiSchema';

// Re-export for backward compatibility with existing importers.
export type { FieldDef } from '@/lib/endpoints/uiSchema';

interface ServiceTestClientProps {
  serviceSlug: string;
  title: string;
  description: string;
  discriminatorName?: string;
  /** Friendly label for the discriminator select (defaults to discriminatorName). */
  discriminatorLabel?: string;
  discriminatorOptions?: DiscriminatorOption[];
  /** Fields always shown, regardless of the selected sub-case. */
  extraFields?: FieldDef[];
  /** Fields shown only when the matching discriminator value is selected. */
  subCaseFields?: Record<string, FieldDef[]>;
  isCompareMode?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Pretty JSON preview (for extraction results) ────────────────────────────
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Resolve the human-readable content string from the various response shapes. */
function resolvePreviewText(result: any): string {
  if (typeof result?.result?.content === 'string') return result.result.content;
  if (typeof result?.content === 'string') return result.content;
  if (typeof result?.result === 'string') {
    try {
      const parsed = JSON.parse(result.result);
      return typeof parsed?.content === 'string' ? parsed.content : result.result;
    } catch { return result.result; }
  }
  if (typeof result?.response === 'string') return result.response;
  if (typeof result?.data?.result === 'string') return result.data.result;
  return '';
}

/** Parse a content string as JSON (tolerating ```json fences). Returns null if not JSON. */
function tryParseJson(text: string): unknown | null {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

function JsonValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-foreground/60">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="font-medium text-purple-500">{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span className="text-blue-500">{value}</span>;
  }
  if (typeof value === 'string') {
    const isEmpty = value.trim() === '';
    const isNa = /^(n\/a|not_found|null)$/i.test(value.trim());
    return (
      <span className={isEmpty || isNa ? 'italic text-muted-foreground/60' : 'break-words text-foreground'}>
        {isEmpty ? '—' : value}
      </span>
    );
  }
  if (Array.isArray(value)) return <JsonArray items={value} />;
  if (isPlainObject(value)) return <JsonObject obj={value} />;
  return <span>{String(value)}</span>;
}

function JsonArray({ items }: { items: unknown[] }) {
  if (items.length === 0) return <span className="italic text-muted-foreground/60">[]</span>;
  const allPrimitive = items.every((i) => i === null || typeof i !== 'object');
  if (allPrimitive) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span key={i} className="inline-block rounded bg-muted px-2 py-0.5 text-xs">
            <JsonValue value={it} />
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">#{i + 1}</div>
          <JsonValue value={it} />
        </div>
      ))}
    </div>
  );
}

function JsonObject({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj);
  if (entries.length === 0) return <span className="italic text-muted-foreground/60">{'{}'}</span>;
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => {
        const nested = Array.isArray(v)
          ? v.some((x) => x && typeof x === 'object')
          : isPlainObject(v);
        return (
          <div key={k} className={nested ? 'flex flex-col gap-1' : 'flex flex-col gap-0.5 sm:flex-row sm:gap-3'}>
            <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground sm:w-56 sm:text-right">{k}</span>
            <div className={nested ? 'border-l-2 border-border/50 pl-3' : 'min-w-0 flex-1 text-sm'}>
              <JsonValue value={v} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function JsonView({ data }: { data: unknown }) {
  return (
    <div className="text-sm leading-relaxed">
      <JsonValue value={data} />
    </div>
  );
}

// ── Bounding-box preview (image overlay) ────────────────────────────────────
type Box2d = [number, number, number, number]; // [ymin, xmin, ymax, xmax], normalized 0–1000
interface BoundingBox {
  id: string;
  field?: string;
  value?: unknown;
  page?: number | null;
  box_2d?: Box2d | null;
}

/** Collect `_bounding_boxes` from an object result or an array of document objects. */
function collectBoundingBoxes(parsed: unknown): BoundingBox[] {
  const out: BoundingBox[] = [];
  const pushFrom = (obj: any, prefix: string) => {
    const arr = obj && typeof obj === 'object' ? obj._bounding_boxes : null;
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== 'object' || b.id == null) continue;
      const box = Array.isArray(b.box_2d) && b.box_2d.length === 4 && b.box_2d.every((n: unknown) => typeof n === 'number')
        ? (b.box_2d as Box2d)
        : null;
      out.push({ id: prefix + String(b.id), field: b.field, value: b.value, page: b.page ?? null, box_2d: box });
    }
  };
  if (Array.isArray(parsed)) parsed.forEach((doc, i) => pushFrom(doc, `d${i}_`));
  else pushFrom(parsed, '');
  return out;
}

function isPlacedBox(b: BoundingBox): boolean {
  return Array.isArray(b.box_2d) && b.box_2d.length === 4;
}

/** Remove `_bounding_boxes` so the JSON view stays clean (boxes shown separately). */
function stripBoxes(parsed: unknown): unknown {
  const strip = (o: any) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    const rest = { ...o };
    delete rest._bounding_boxes;
    return rest;
  };
  return Array.isArray(parsed) ? parsed.map(strip) : strip(parsed);
}

/**
 * Model-provided coordinates are often a few pixels tight/off, which visually
 * clips the value. Expand each box by a small, controlled margin so the value
 * always sits comfortably inside — proportional to the box size (bigger boxes
 * grow a bit more) with a minimum floor, clamped to the 0–1000 page bounds.
 * Returns CSS percentages (0–100) ready for absolute positioning.
 */
const BBOX_PAD_RATIO = 0.08; // 8% of the box's own dimension per side
const BBOX_PAD_MIN = 10;     // floor in normalized units (1% of page) — helps thin text lines
const BBOX_PAD_MAX = 45;     // cap so large boxes don't balloon

function padBox([ymin, xmin, ymax, xmax]: Box2d): { left: number; top: number; width: number; height: number } {
  const clampPad = (size: number) => Math.min(BBOX_PAD_MAX, Math.max(BBOX_PAD_MIN, size * BBOX_PAD_RATIO));
  const padX = clampPad(Math.max(0, xmax - xmin));
  const padY = clampPad(Math.max(0, ymax - ymin));
  const clamp = (n: number) => Math.min(1000, Math.max(0, n));
  const x0 = clamp(xmin - padX);
  const y0 = clamp(ymin - padY);
  const x1 = clamp(xmax + padX);
  const y1 = clamp(ymax + padY);
  return { left: x0 / 10, top: y0 / 10, width: (x1 - x0) / 10, height: (y1 - y0) / 10 };
}

function DocumentBBoxViewer({ pages, boxes, highlightedId, onHover }: {
  pages: string[];
  boxes: BoundingBox[];
  highlightedId: string | null;
  onHover: (id: string | null) => void;
}) {
  const singlePage = pages.length === 1;
  return (
    <div className="space-y-4">
      {pages.map((url, pageIdx) => {
        // Single image → assume all placed boxes belong to it. Multiple images →
        // match by page index (box.page).
        const pageBoxes = boxes.filter(
          (b) => isPlacedBox(b) && (singlePage || b.page === pageIdx),
        );
        return (
          <div key={pageIdx} className="relative block w-full overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`page ${pageIdx + 1}`} className="block h-auto w-full select-none" draggable={false} />
            {pageBoxes.map((b) => {
              const active = b.id === highlightedId;
              const rect = padBox(b.box_2d as Box2d);
              return (
                <div
                  key={b.id}
                  data-bbox-id={b.id}
                  title={String(b.value ?? '')}
                  onMouseEnter={() => onHover(b.id)}
                  onMouseLeave={() => onHover(null)}
                  className={`absolute cursor-pointer rounded-sm transition-colors ${active ? 'bg-primary/30 ring-2 ring-primary' : 'bg-primary/5 ring-1 ring-primary/50 hover:bg-primary/20'}`}
                  style={{
                    left: `${rect.left}%`,
                    top: `${rect.top}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                  }}
                >
                  {active && b.value != null && String(b.value).trim() !== '' && (
                    <span className="pointer-events-none absolute left-0 top-full z-10 mt-1 max-w-[240px] whitespace-normal break-words rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground shadow-lg">
                      {String(b.value)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function BoundingBoxList({ boxes, highlightedId, onHover }: {
  boxes: BoundingBox[];
  highlightedId: string | null;
  onHover: (id: string | null) => void;
}) {
  if (!boxes.length) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
        Bounding boxes ({boxes.length})
      </div>
      <div className="space-y-1">
        {boxes.map((b) => {
          const active = b.id === highlightedId;
          return (
            <div
              key={b.id}
              onMouseEnter={() => onHover(b.id)}
              onMouseLeave={() => onHover(null)}
              className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs transition-colors ${active ? 'bg-primary/15 ring-1 ring-primary' : 'hover:bg-muted'}`}
            >
              <span className="shrink-0 font-mono text-muted-foreground">{b.field || b.id}</span>
              <span className="min-w-0 flex-1 break-words text-foreground">{String(b.value ?? '')}</span>
              {!isPlacedBox(b) && <span className="shrink-0 text-[10px] italic text-amber-600">no coords</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);
}
function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

/**
 * Resolve uploaded files into page image URLs (images → object URLs, PDFs → pages
 * rendered to canvas data URLs via pdf.js) and render the bounding-box overlay.
 */
function BBoxDocumentViewer({ files, boxes, highlightedId, onHover }: {
  files: File[];
  boxes: BoundingBox[];
  highlightedId: string | null;
  onHover: (id: string | null) => void;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    (async () => {
      const images = files.filter(isImageFile);
      const pdfs = files.filter(isPdfFile);
      const imgUrls = images.map((f) => {
        const u = URL.createObjectURL(f);
        objectUrls.push(u);
        return u;
      });
      if (!pdfs.length) {
        if (!cancelled) { setPages(imgUrls); setStatus('idle'); }
        return;
      }
      setStatus('loading');
      try {
        const pdfjs: any = await import('pdfjs-dist');
        // Worker version pinned to the loaded package version.
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        const pdfUrls: string[] = [];
        for (const pf of pdfs) {
          const data = await pf.arrayBuffer();
          const doc = await pdfjs.getDocument({ data }).promise;
          for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            await page.render({ canvasContext: ctx, viewport }).promise;
            pdfUrls.push(canvas.toDataURL('image/png'));
          }
        }
        if (!cancelled) { setPages([...imgUrls, ...pdfUrls]); setStatus('idle'); }
      } catch {
        if (!cancelled) { setPages(imgUrls); setStatus('error'); }
      }
    })();
    return () => {
      cancelled = true;
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang render trang PDF…
      </div>
    );
  }
  if (!pages.length) {
    return <div className="text-sm italic text-muted-foreground/70">Không có ảnh/PDF để hiển thị overlay.</div>;
  }
  return (
    <div className="space-y-2">
      {status === 'error' && (
        <p className="text-xs italic text-amber-600">Không render được PDF (kiểm tra kết nối mạng để tải pdf.js worker).</p>
      )}
      <DocumentBBoxViewer pages={pages} boxes={boxes} highlightedId={highlightedId} onHover={onHover} />
    </div>
  );
}

export default function ServiceTestClient({
  serviceSlug,
  title,
  description,
  discriminatorName,
  discriminatorLabel,
  discriminatorOptions,
  extraFields = [],
  subCaseFields,
  isCompareMode = false,
}: ServiceTestClientProps) {
  const [apiKey, setApiKey] = useState<string>('');
  const [viewMode, setViewMode] = useState<'json' | 'preview' | 'curl'>('preview');
  const [curlCommand, setCurlCommand] = useState<string | null>(null);

  // Form State
  const [files, setFiles] = useState<File[]>([]);
  const [targetFile, setTargetFile] = useState<File | null>(null); // For compare mode
  const [dragging, setDragging] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});

  // Request State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [execTime, setExecTime] = useState<number | null>(null);
  const [highlightedBoxId, setHighlightedBoxId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetFileInputRef = useRef<HTMLInputElement>(null);

  // Seed defaults without clobbering values the user has already set.
  // NOTE: `extraFields` defaults to a fresh `[]` on every render, so this effect
  // re-runs each render. The updater MUST return the previous state reference
  // unchanged when there is nothing to seed — otherwise every run produces a new
  // object, React re-renders, the effect fires again, and we spin in an infinite
  // render loop ("Maximum update depth exceeded") that freezes the whole app,
  // including the header nav in the root layout.
  useEffect(() => {
    setFormData(prev => {
      let changed = false;
      const next = { ...prev };
      if (
        discriminatorName &&
        discriminatorOptions?.length &&
        !next[discriminatorName]
      ) {
        next[discriminatorName] = discriminatorOptions[0].value;
        changed = true;
      }
      extraFields.forEach(f => {
        if (f.defaultValue && !next[f.name]) {
          next[f.name] = f.defaultValue;
          changed = true;
        }
      });
      // Bail out (keep the same reference) when nothing changed so React can
      // skip the re-render and the loop cannot start.
      return changed ? next : prev;
    });
  }, [discriminatorName, discriminatorOptions, extraFields]);

  // Load API Key from sessionStorage.
  // [SEC 18/09 P2.2] sessionStorage, not localStorage: this is a /api/v1 credential
  // that may carry the ADMIN role, so it must not outlive the tab or a sign-out.
  useEffect(() => {
    const saved = sessionStorage.getItem('du_test_api_key');
    if (saved) setApiKey(saved);
  }, []);

  // Currently selected discriminator value + the fields relevant to it.
  const currentDiscriminator = discriminatorName
    ? (formData[discriminatorName] || discriminatorOptions?.[0]?.value || '')
    : '';
  const activeSubCaseFields: FieldDef[] =
    (discriminatorName && subCaseFields?.[currentDiscriminator]) || [];
  const selectedOption = discriminatorOptions?.find((o) => o.value === currentDiscriminator);

  // Names of fields currently visible → only these get submitted.
  const visibleFieldNames = new Set<string>([
    ...(discriminatorName ? [discriminatorName] : []),
    ...extraFields.map((f) => f.name),
    ...activeSubCaseFields.map((f) => f.name),
  ]);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    sessionStorage.setItem('du_test_api_key', val);
  };

  // -- File Handling
  const acceptFiles = (incoming: FileList | File[], isTarget = false) => {
    const arr = Array.from(incoming);
    setError(null);
    if (isCompareMode && isTarget) {
      if (arr.length > 0) setTargetFile(arr[0]);
    } else {
      if (isCompareMode && arr.length > 0) {
        setFiles([arr[0]]); // Compare only takes 1 source
      } else {
        setFiles(prev => [...prev, ...arr]);
      }
    }
  };

  const removeFile = (name: string, isTarget = false) => {
    if (isTarget) setTargetFile(null);
    else setFiles(prev => prev.filter(f => f.name !== name));
  };

  const renderDropzone = (isTarget = false) => {
    const currentFiles = isTarget ? (targetFile ? [targetFile] : []) : files;
    const acceptExt = '.pdf,.docx,.doc,.png,.jpg,.jpeg';
    const label = isTarget ? 'Target File (V2)' : (isCompareMode ? 'Source File (V1)' : 'Kéo thả tài liệu vào đây (tuỳ chọn)');
    const multiple = !isCompareMode;

    return (
      <div
        onClick={() => currentFiles.length === 0 && (isTarget ? targetFileInputRef.current?.click() : fileInputRef.current?.click())}
        onDragOver={(e) => { e.preventDefault(); !isTarget && setDragging(true); }}
        onDragLeave={() => !isTarget && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          !isTarget && setDragging(false);
          if (e.dataTransfer.files.length > 0) acceptFiles(e.dataTransfer.files, isTarget);
        }}
        className={`relative border-2 border-dashed rounded-3xl transition-colors duration-200 cursor-pointer overflow-hidden
          ${currentFiles.length === 0 ? 'p-10 text-center hover:bg-muted/50' : 'p-5 bg-card/50'}
          ${!isTarget && dragging ? 'border-primary bg-primary/5' : 'border-border'}
        `}
      >
        <input
          ref={isTarget ? targetFileInputRef : fileInputRef}
          type="file"
          accept={acceptExt}
          multiple={multiple}
          className="sr-only"
          onChange={e => e.target.files && acceptFiles(e.target.files, isTarget)}
        />

        {currentFiles.length === 0 ? (
          <>
            <Upload className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="font-semibold text-foreground text-sm">{label}</p>
            <p className="text-xs text-muted-foreground mt-1">Hỗ trợ PDF, DOCX, Hình ảnh</p>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
            {currentFiles.map(f => (
              <div key={f.name} className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeFile(f.name, isTarget); }}
                  className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderField = (field: FieldDef) => (
    <div key={field.name}>
      <label className="block text-sm font-bold mb-1.5">{field.label}</label>
      {field.type === 'select' ? (
        <select
          className="input-field py-2.5"
          value={formData[field.name] || ''}
          onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
        >
          <option value="">-- Mặc định --</option>
          {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          className="input-field font-mono text-xs leading-relaxed min-h-[100px]"
          placeholder={field.placeholder}
          value={formData[field.name] || ''}
          onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
        />
      ) : (
        <input
          type="text"
          className="input-field py-2.5"
          placeholder={field.placeholder}
          value={formData[field.name] || ''}
          onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
        />
      )}
    </div>
  );

  // -- Submission
  const handleSubmit = async () => {
    if (!apiKey.trim()) {
      setError('Vui lòng nhập Profile API Key để thực hiện request.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    const start = Date.now();

    setCurlCommand(null);

    try {
      const form = new FormData();

      let curlStr = `curl -X POST ${window.location.origin}/api/v2/docs/${serviceSlug}?sync=true \\\n`;
      curlStr += `  -H "x-api-key: ${apiKey}" \\\n`;
      // Note: we don't need __service or __apiKeyId since we hit the endpoint directly

      // Append only fields visible for the current sub-case (avoid sending stale
      // values from a previously selected discriminator).
      Object.entries(formData).forEach(([k, v]) => {
        if (v && visibleFieldNames.has(k)) {
          form.append(k, v);
          curlStr += `  -F "${k}=${v}" \\\n`;
        }
      });

      // Append files
      if (isCompareMode) {
        if (files[0]) {
          form.append('source_file', files[0]);
          curlStr += `  -F "source_file=@${files[0].name}" \\\n`;
        }
        if (targetFile) {
          form.append('target_file', targetFile);
          curlStr += `  -F "target_file=@${targetFile.name}" \\\n`;
        }
      } else {
        files.forEach(f => {
          form.append('files[]', f);
          curlStr += `  -F "files[]=@${f.name}" \\\n`;
        });
      }

      curlStr = curlStr.replace(/ \\\n$/, '');
      setCurlCommand(curlStr);

      const res = await fetch(`/api/v2/docs/${serviceSlug}?sync=true`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey
        },
        body: form,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail ?? data.error ?? data.title ?? 'Lỗi xử lý từ server');
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối tới server.');
    } finally {
      setLoading(false);
      setExecTime(Date.now() - start);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8">

      {/* LEFT COLUMN: Controls & Input */}
      <div className="lg:col-span-5 space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight flex items-center gap-3">
            {title}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{description}</p>
        </div>

        {/* Profile API Key */}
        <div className="modern-card p-5 space-y-3 shadow-sm border border-destructive/20">
          <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            Profile API Key (Bắt buộc)
          </label>
          <input
            type="password"
            className="input-field py-2.5 font-mono text-sm tracking-widest border-primary/20 focus:border-primary"
            placeholder="Nhập API Key của Profile để chạy test..."
            value={apiKey}
            onChange={e => handleApiKeyChange(e.target.value)}
          />
          <p className="text-xs text-destructive opacity-80 mt-1">* Bắt buộc phải nhập Profile API Key ID để chạy test.</p>
        </div>

        {/* Parameters Form */}
        <div className="modern-card p-5 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 border-b border-border pb-2">Tham số API</h3>

          {discriminatorName && discriminatorOptions && (
            <div>
              <label className="block text-sm font-bold mb-1.5">
                {discriminatorLabel || discriminatorName} *
              </label>
              <select
                className="input-field py-2.5 font-mono text-sm"
                value={formData[discriminatorName] || ''}
                onChange={e => setFormData({ ...formData, [discriminatorName]: e.target.value })}
              >
                {discriminatorOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {selectedOption?.description && (
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {selectedOption.description}
                </p>
              )}
            </div>
          )}

          {/* Shared fields (always shown) */}
          {extraFields.map(renderField)}

          {/* Fields specific to the selected sub-case */}
          {activeSubCaseFields.map(renderField)}

          {discriminatorName && extraFields.length === 0 && activeSubCaseFields.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              Sub-case này không cần tham số bổ sung — chỉ cần nạp tài liệu và chạy.
            </p>
          )}
        </div>

        {/* File Uploads */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">Tài liệu đầu vào <span className="font-normal text-xs normal-case">(tuỳ chọn)</span></h3>
          <div className="grid grid-cols-1 gap-4">
            {renderDropzone(false)}
            {isCompareMode && renderDropzone(true)}
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm font-semibold p-4 rounded-xl border border-destructive/20 whitespace-pre-wrap leading-relaxed">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || (isCompareMode && !targetFile && !formData['reference_data'])}
          className="w-full btn-primary modern-button py-3 text-lg font-bold shadow-lg shadow-primary/20"
        >
          {loading ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Đang xử lý...</> : 'Bắt đầu xử lý đồng bộ'}
        </button>
      </div>

      {/* RIGHT COLUMN: Results */}
      <div className="lg:col-span-7 flex flex-col">
        <div className="modern-card flex-1 flex flex-col overflow-hidden bg-card border-border relative min-h-[500px]">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div className="flex bg-background rounded-md border border-border p-0.5">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-3 py-1 text-xs font-bold uppercase tracking-widest rounded transition-colors ${viewMode === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  Preview
                </button>
                <button
                  onClick={() => setViewMode('json')}
                  className={`px-3 py-1 text-xs font-bold uppercase tracking-widest rounded transition-colors ${viewMode === 'json' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  JSON
                </button>
                <button
                  onClick={() => setViewMode('curl')}
                  className={`px-3 py-1 text-xs font-bold uppercase tracking-widest rounded transition-colors ${viewMode === 'curl' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  cURL
                </button>
              </div>
            </div>
            {execTime !== null && !loading && (
              <span className="text-xs font-mono text-muted-foreground font-semibold">
                Thời gian: {(execTime / 1000).toFixed(2)}s
              </span>
            )}
          </div>

          <div className={`flex-1 overflow-auto relative ${viewMode !== 'preview' ? 'bg-[#1e1e1e] p-4 text-sm font-mono text-emerald-400' : 'bg-background p-6'}`}>
            {loading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-50">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
                <p>Hệ thống AI đang phân tích tài liệu...</p>
                <p className="text-xs mt-2">Việc này có thể mất từ vài giây đến 1 phút.</p>
              </div>
            ) : viewMode === 'curl' ? (
              <pre className="whitespace-pre-wrap break-words text-blue-400">
                {curlCommand || 'Bạn cần nhấn "Bắt đầu xử lý" để sinh lệnh cURL.'}
              </pre>
            ) : result ? (
              viewMode === 'json' ? (
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(result, null, 2)}
                </pre>
              ) : (() => {
                const text = resolvePreviewText(result);
                const parsed = tryParseJson(text);
                if (parsed) {
                  const boxes = collectBoundingBoxes(parsed);
                  const hasRenderableDoc = files.some((f) => isImageFile(f) || isPdfFile(f));
                  if (boxes.length && hasRenderableDoc) {
                    const anyPlaced = boxes.some(isPlacedBox);
                    return (
                      <div className="space-y-4">
                        {/* Image overlay + box list side by side (both render fine in a
                            narrow column). The full JSON goes below at full width so
                            long values never get crushed into one-char-per-line. */}
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="self-start lg:sticky lg:top-4">
                            <BBoxDocumentViewer
                              files={files}
                              boxes={boxes}
                              highlightedId={highlightedBoxId}
                              onHover={setHighlightedBoxId}
                            />
                            {!anyPlaced && (
                              <p className="mt-2 text-xs italic text-amber-600">
                                Model không trả toạ độ (box_2d = null) nên không vẽ được bounding box — có thể model chưa hỗ trợ định vị hình ảnh.
                              </p>
                            )}
                          </div>
                          <BoundingBoxList boxes={boxes} highlightedId={highlightedBoxId} onHover={setHighlightedBoxId} />
                        </div>
                        <div className="rounded-xl border border-border bg-muted/20 p-4 sm:p-5">
                          <JsonView data={stripBoxes(parsed)} />
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="rounded-xl border border-border bg-muted/20 p-4 sm:p-5">
                      <JsonView data={parsed} />
                    </div>
                  );
                }
                return (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-a:text-primary prose-table:w-full prose-th:border prose-th:border-border prose-th:p-2 prose-td:border prose-td:border-border prose-td:p-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {text || 'Không tìm thấy nội dung hợp lệ trong phản hồi. Hãy kiểm tra tab JSON.'}
                    </ReactMarkdown>
                  </div>
                );
              })()
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-30">
                Chưa có dữ liệu phản hồi
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
