// Áp OCR_FIX lên evidence (COR-R07; F-R06: hàm DUY NHẤT áp bản vá, thay T-EDIT-01). Hàm thuần: không đổi đầu vào, trả bản sao.
// Không nâng `field_confidences` cấp 1 — nâng cả lá anh em chưa ai xem; lá đã sửa trả riêng ở `edited_record_ids` để LAC / registry đánh dấu đúng lá.
import { normKey } from '../common/normalize';
import type { EvidenceEnvelope } from '../s2/common-schema';
import type { CorrectionReport, OcrFix } from './schema';

export interface OcrFixOutcome {
  evidences: EvidenceEnvelope[];
  /** record_id (`{evidence_id}#{field_path}`) của mọi lá đã áp. */
  edited_record_ids: string[];
  report: Pick<CorrectionReport, 'applied' | 'skipped'>;
}

type Segment = string | number;

function parsePath(path: string): Segment[] | null {
  const out: Segment[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  let consumed = '';
  while ((m = re.exec(path))) {
    out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
    consumed += m[0];
  }
  return out.length > 0 && consumed.replace(/\./g, '') === path.replace(/\./g, '') ? out : null;
}

/** Cha của lá và khóa cuối; null khi đường dẫn không tồn tại. */
function locate(root: unknown, segments: Segment[]): { parent: Record<string | number, unknown>; key: Segment } | null {
  let node: unknown = root;
  for (const seg of segments.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return null;
    if (typeof seg === 'number' ? !Array.isArray(node) : Array.isArray(node)) return null;
    node = (node as Record<string | number, unknown>)[seg];
  }
  const key = segments[segments.length - 1];
  if (node === null || typeof node !== 'object') return null;
  if (typeof key === 'number' ? !Array.isArray(node) : Array.isArray(node)) return null;
  if (!(key in (node as object))) return null;
  return { parent: node as Record<string | number, unknown>, key };
}

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'string' && typeof b === 'string') return normKey(a) === normKey(b);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
};

export function applyOcrFixes(evidences: ReadonlyArray<EvidenceEnvelope>, fixes: ReadonlyArray<OcrFix>): OcrFixOutcome {
  const copies = evidences.map((e) => structuredClone(e)) as EvidenceEnvelope[];
  const byId = new Map(copies.map((e) => [e.evidence_id, e]));
  const applied: OcrFixOutcome['report']['applied'] = [];
  const skipped: OcrFixOutcome['report']['skipped'] = [];
  const skip = (f: OcrFix, code: OcrFixOutcome['report']['skipped'][number]['code']) => skipped.push({ correction_id: f.correction_id, kind: 'OCR_FIX', code });

  // Cùng lá: bản corrected_at mới nhất thắng (hòa → bản đứng sau), bản kia DUPLICATE_TARGET (COR-R14).
  const winner = new Map<string, number>();
  fixes.forEach((f, i) => {
    const prev = winner.get(f.record_id);
    if (prev === undefined || Date.parse(f.corrected_at) >= Date.parse(fixes[prev].corrected_at)) winner.set(f.record_id, i);
  });

  const edited: string[] = [];
  fixes.forEach((f, i) => {
    if (winner.get(f.record_id) !== i) return skip(f, 'DUPLICATE_TARGET');
    const hash = f.record_id.indexOf('#');
    const evidence = byId.get(f.record_id.slice(0, hash));
    const segments = parsePath(f.record_id.slice(hash + 1));
    if (!evidence || !segments) return skip(f, 'ORPHAN_EDIT');
    if (evidence.status === 'ERROR' || evidence.data === null) return skip(f, 'EDIT_ON_ERROR_EVIDENCE');
    const at = locate(evidence.data, segments);
    if (!at) return skip(f, 'ORPHAN_EDIT');
    const current = at.parent[at.key];
    if (current !== null && typeof current === 'object') return skip(f, 'FIELD_NOT_EDITABLE');
    if (!same(current ?? null, f.original_value)) return skip(f, 'EDIT_BASE_CHANGED');
    // Kiểu giá trị mới phải cùng kiểu lá hiện tại (null = xóa lá). Kiểm theo schema loại chứng từ để sau (T-U2-04 chưa có trên v2).
    if (f.value !== null && current !== null && current !== undefined && typeof f.value !== typeof current) return skip(f, 'INVALID_VALUE');
    at.parent[at.key] = f.value;
    edited.push(f.record_id);
    applied.push({ correction_id: f.correction_id, kind: 'OCR_FIX' });
  });

  return { evidences: copies, edited_record_ids: edited, report: { applied, skipped } };
}
