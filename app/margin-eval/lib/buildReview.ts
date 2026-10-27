// app/margin-eval/lib/buildReview.ts
// Transform a mode's extracted_data.result into a flat list of tickable ReviewItems.
// Pure functions, no React — keeps the page component small and testable by eye.

import type { EvalFile, MarginMode, ReviewDocument, ReviewItem } from '../types';

// ─── Response shapes (best-effort; the AI output is validated server-side, so
// these are intentionally permissive with optional fields + `unknown` values). ──

interface ClassifyDoc {
  file_id?: string;
  name?: string;
  code?: string;
  title?: string;
  page_range?: unknown;
  confidence?: number;
}
interface FileError {
  file_id?: string;
  name?: string;
  error?: { code?: string; message?: string };
}
interface ClassifyResult { documents?: ClassifyDoc[]; errors?: FileError[] }

interface ExtractionDoc {
  name?: string;
  file_id?: string;
  doc_type?: string;
  error?: { code?: string; message?: string };
  warning?: { code?: string; message?: string };
  extracted?: { fields?: Record<string, unknown> };
}
interface ExtractionResult { documents?: ExtractionDoc[] }

interface Clause {
  clause_id?: string;
  action?: string;
  severity?: string;
  detail?: string;
  template?: string;
  customer?: string;
}
interface TemplateCheck { verdict?: string; error?: unknown; clauses_modified?: Clause[] }
interface FrameworkDoc { name?: string; file_id?: string; doc_type?: string; template_check?: TemplateCheck }
interface FrameworkResult { documents?: FrameworkDoc[] }

interface CopyDiff { location?: string; severity?: string; description?: string }
interface CopyCheck {
  verdict?: string;
  error_code?: string;
  copies_found?: unknown;
  doc_type?: string;
  group_id?: string;
  differences?: CopyDiff[];
}
interface ValidationResult {
  summary?: { overall_verdict?: string };
  copy_checks?: CopyCheck[];
  documents?: FrameworkDoc[];
}

let counter = 0;
function nextId(prefix: string): string { counter += 1; return `${prefix}-${counter}`; }

/** Unwrap a { value, confidence } field or return the raw value. */
function fv(f: unknown): { value: unknown; confidence: number | null } {
  if (f && typeof f === 'object' && 'value' in (f as Record<string, unknown>)) {
    const obj = f as { value: unknown; confidence?: number };
    return { value: obj.value, confidence: typeof obj.confidence === 'number' ? obj.confidence : null };
  }
  return { value: f, confidence: null };
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '∅ (null)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** First page from a page_range like "1-12" | "6" | "13-14" → 1-based number, or null. */
function firstPageOf(range: unknown): number | null {
  if (typeof range !== 'string') return null;
  const m = range.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function item(key: string, label: string, raw: unknown, extra: Partial<ReviewItem> = {}): ReviewItem {
  const { value, confidence } = fv(raw);
  return { key, label, value: str(value), confidence, judgement: 'unset', ...extra };
}

/**
 * Map an output document to its uploaded file.
 *
 * The server sanitizes file names, so `d.name` may differ from the client's
 * EvalFile.name — matching purely by name fails. Robust strategy, in order:
 *   1) exact name match (works when unchanged)
 *   2) name parsed from `d.file_id` ("input-001::<name>")
 *   3) POSITIONAL fallback within the correct role subset: framework/validation
 *      documents are the CUSTOMER files in order, so the docIndex-th document is
 *      the docIndex-th customer file. `roleFiles` is the ordered subset the
 *      caller passes (customer files for fw/validation, all files otherwise).
 */
function resolveFileId(
  files: EvalFile[],
  doc: { name?: unknown; file_id?: unknown },
  roleFiles: EvalFile[],
  docIndex: number,
): string | undefined {
  const name = typeof doc.name === 'string' ? doc.name : undefined;
  if (name) {
    const byName = files.find((f) => f.name === name);
    if (byName) return byName.id;
  }
  const fid = typeof doc.file_id === 'string' ? doc.file_id : undefined;
  if (fid) {
    const tail = fid.includes('::') ? fid.split('::').pop() : fid;
    const byTail = files.find((f) => f.name === tail);
    if (byTail) return byTail.id;
  }
  // Positional fallback within the role subset.
  return roleFiles[docIndex]?.id;
}

/** Files whose role matches the given role (default 'customer'); order preserved. */
function customerFiles(files: EvalFile[]): EvalFile[] {
  return files.filter((f) => (f.role || 'customer') === 'customer');
}

// ─── classify ───────────────────────────────────────────────────────────────

function buildClassify(result: ClassifyResult, files: EvalFile[]): ReviewDocument[] {
  const docs = result?.documents || [];
  // Group classified documents BY SOURCE FILE so each uploaded file becomes its
  // own tab (mirrors extraction/framework/validation). classify output carries
  // `file_id` like "input-001::<name>" and `name`; match back to the uploaded
  // EvalFile by name (fallback: order) so the preview follows the right file.
  const groups = new Map<string, { fileId?: string; name: string; docs: ClassifyDoc[] }>();
  docs.forEach((d, idx) => {
    const fileIdRaw = d.file_id ?? `input-${String(idx + 1).padStart(3, '0')}`;
    if (!groups.has(fileIdRaw)) {
      const name = d.name ?? fileIdRaw;
      const matched = files.find((f) => f.name === name) ?? files[groups.size];
      groups.set(fileIdRaw, { fileId: matched?.id, name: matched?.name ?? name, docs: [] });
    }
    groups.get(fileIdRaw)!.docs.push(d);
  });

  const errorsByFile = new Map<string, FileError[]>();
  for (const e of result?.errors || []) {
    const arr = errorsByFile.get(e.name ?? '') ?? [];
    arr.push(e);
    errorsByFile.set(e.name ?? '', arr);
  }

  const out: ReviewDocument[] = [];
  for (const [, group] of groups) {
    const items: ReviewItem[] = group.docs.map((d, i) => ({
      key: `doc-${i}`,
      label: `#${i + 1} · trang ${d.page_range ?? '?'}`,
      value: `${d.code ?? '?'}${d.title ? ` — ${d.title}` : ''}${typeof d.confidence === 'number' ? ` (${(d.confidence * 100).toFixed(0)}%)` : ''}`,
      confidence: typeof d.confidence === 'number' ? d.confidence : null,
      fileId: group.fileId,
      // Jump the preview to the first page of this document's page_range on click.
      page: firstPageOf(d.page_range),
      judgement: 'unset' as const,
    }));
    for (const e of errorsByFile.get(group.name) ?? []) {
      items.push({ key: `err-${e.file_id ?? ''}`, label: 'Lỗi file', value: `${e.error?.code}: ${e.error?.message}`, judgement: 'unset' });
    }
    out.push({
      docId: nextId('classify'),
      title: `${group.name} · ${group.docs.length} chứng từ`,
      subtitle: 'Tick đúng/sai từng dòng code + page_range',
      fileId: group.fileId,
      items,
    });
  }

  // Files that produced neither a document nor an error still deserve a tab.
  for (const f of files) {
    const exists = out.some((d) => d.fileId === f.id);
    if (!exists) out.push({ docId: nextId('classify'), title: `${f.name} · 0 chứng từ`, subtitle: 'Không có kết quả phân loại', fileId: f.id, items: [] });
  }

  return out;
}

// ─── extraction ───────────────────────────────────────────────────────────────

function buildExtractionFields(fields: Record<string, unknown>): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const [key, raw] of Object.entries(fields || {})) {
    const { value } = fv(raw);
    if (Array.isArray(value)) {
      value.forEach((member: any, idx: number) => {
        for (const [sk, sv] of Object.entries(member || {})) {
          items.push(item(`${key}[${idx}].${sk}`, `${key}[${idx}].${sk}`, sv));
        }
      });
    } else {
      items.push(item(key, key, raw));
    }
  }
  return items;
}

function buildExtraction(result: ExtractionResult, files: EvalFile[]): ReviewDocument[] {
  const docs = result?.documents || [];
  const roleFiles = files; // extraction: every uploaded file is a document
  return docs.map((d, i) => {
    const items: ReviewItem[] = [];
    if (d.error) {
      items.push({ key: 'error', label: 'Lỗi', value: `${d.error.code}: ${d.error.message}`, judgement: 'unset' });
    }
    if (d.warning) {
      items.push({ key: 'warning', label: 'Cảnh báo', value: `${d.warning.code}: ${d.warning.message}`, judgement: 'unset' });
    }
    const fields = d.extracted?.fields || {};
    items.push(...buildExtractionFields(fields));

    return {
      docId: nextId('ext'),
      title: `${d.name ?? `Tài liệu ${i + 1}`} · ${d.doc_type}`,
      subtitle: 'Fields — tick đúng/sai từng trường',
      fileId: resolveFileId(files, d, roleFiles, i),
      items,
    };
  });
}

// ─── framework ───────────────────────────────────────────────────────────────

function buildFramework(result: FrameworkResult, files: EvalFile[]): ReviewDocument[] {
  const docs = result?.documents || [];
  const roleFiles = customerFiles(files); // only customer files produce documents
  return docs.map((d, i) => {
    const tc = d.template_check;
    const items: ReviewItem[] = [];
    items.push({ key: 'verdict', label: 'Verdict', value: tc?.verdict ?? '∅', judgement: 'unset' });
    if (tc?.error) items.push({ key: 'error', label: 'Error', value: String(tc.error), judgement: 'unset' });
    for (const [ci, clause] of (tc?.clauses_modified || []).entries()) {
      const detail = clause.detail ? ` — ${clause.detail}` : '';
      const tv = clause.template ? ` | khung: ${clause.template}` : '';
      const cv = clause.customer ? ` | KH: ${clause.customer}` : '';
      items.push({ key: `clause-${ci}`, label: `${clause.clause_id} [${clause.action}/${clause.severity}]`, value: `${detail}${tv}${cv}`.trim() || '(không mô tả)', judgement: 'unset' });
    }
    return {
      docId: nextId('fw'),
      title: `${d.name ?? `Tài liệu ${i + 1}`} · ${d.doc_type}`,
      subtitle: 'Đối chiếu khung — tick verdict + từng điểm lệch',
      fileId: resolveFileId(files, d, roleFiles, i),
      items,
    };
  });
}

// ─── validation ───────────────────────────────────────────────────────────────

function buildValidation(result: ValidationResult, files: EvalFile[]): ReviewDocument[] {
  const out: ReviewDocument[] = [];
  out.push({
    docId: nextId('val-sum'),
    title: `Tổng kết · overall_verdict = ${result?.summary?.overall_verdict ?? '∅'}`,
    subtitle: 'Tick verdict tổng',
    items: [{ key: 'overall', label: 'overall_verdict', value: result?.summary?.overall_verdict ?? '∅', judgement: 'unset' }],
  });
  for (const [ci, cc] of (result?.copy_checks || []).entries()) {
    const items: ReviewItem[] = [
      { key: 'verdict', label: 'verdict', value: `${cc.verdict}${cc.error_code ? ` (${cc.error_code})` : ''}`, judgement: 'unset' },
      { key: 'copies', label: 'copies_found', value: String(cc.copies_found), judgement: 'unset' },
    ];
    for (const [di, diff] of (cc.differences || []).entries()) {
      items.push({ key: `diff-${di}`, label: `${diff.location} [${diff.severity}]`, value: diff.description ?? '', judgement: 'unset' });
    }
    out.push({ docId: nextId('val-cc'), title: `Copy-check · ${cc.doc_type} · ${cc.group_id}`, subtitle: 'Đối chiếu N bản sao', items });
  }
  const valRoleFiles = customerFiles(files);
  for (const [di, d] of (result?.documents || []).entries()) {
    const tc = d.template_check;
    const items: ReviewItem[] = [{ key: 'verdict', label: 'template verdict', value: tc?.verdict ?? '∅', judgement: 'unset' }];
    if (tc?.error) items.push({ key: 'error', label: 'error', value: String(tc.error), judgement: 'unset' });
    for (const [ci, clause] of (tc?.clauses_modified || []).entries()) {
      items.push({ key: `clause-${ci}`, label: `${clause.clause_id} [${clause.action}]`, value: clause.detail || '(không mô tả)', judgement: 'unset' });
    }
    out.push({ docId: nextId('val-tc'), title: `Template-check · ${d.name ?? d.doc_type}`, subtitle: 'Đối chiếu khung', fileId: resolveFileId(files, d, valRoleFiles, di), items });
  }
  return out;
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

export function buildReviewDocuments(mode: MarginMode, result: unknown, files: EvalFile[]): ReviewDocument[] {
  counter = 0;
  const r = (result ?? {}) as ClassifyResult & ExtractionResult & FrameworkResult & ValidationResult;
  switch (mode) {
    case 'classify': return buildClassify(r, files);
    case 'extraction': return buildExtraction(r, files);
    case 'framework': return buildFramework(r, files);
    case 'validation': return buildValidation(r, files);
    default: return [];
  }
}
