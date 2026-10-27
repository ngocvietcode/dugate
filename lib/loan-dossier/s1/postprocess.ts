// Hậu xử lý kết quả classifier cho 1 file (T-S1-04; S1-R03, R04, R06, R07, R14).
import { docTypeByKey } from '../catalog';
import { fileOutcome, type FileOutcome } from './file-status';

export const ACCEPT_THRESHOLD = 0.8;
export const REJECT_THRESHOLD = 0.5;

/** Chất lượng trang do classifier báo (dùng khi không còn match nào). */
export type PageQuality = 'OK' | 'EMPTY' | 'LOW_QUALITY';

/** Một dữ kiện chính của chứng từ (D-70, S1-R21): `value` chép nguyên văn, S1 không chuẩn hóa. */
export interface KeyFact {
  subject: string;
  key: string;
  value: string | null;
  page: number | null;
}

export interface RawInstance {
  page_range: [number, number];
  confidence: number;
  starts_new_document?: boolean;
  summary?: string;
  key_facts?: KeyFact[];
}

export interface RawMatch {
  doc_type_key: string;
  confidence: number;
  instances: RawInstance[];
}

/** Kết quả classifier đã parse (sau khi ghép batch) của 1 file. */
export interface RawClassification {
  page_quality: PageQuality;
  matches: RawMatch[];
}

export interface ClassifyInstance {
  instance_index: number;
  page_range: [number, number];
  confidence: number;
  summary: string;
  key_facts: KeyFact[];
}

export interface ClassifyMatch {
  doc_type_key: string;
  confidence: number;
  needs_manual_review: boolean;
  needs_extraction: boolean;
  instances_count: number;
  hint_mismatch: boolean;
  instances: ClassifyInstance[];
}

export interface PostprocessResult extends FileOutcome {
  matches: ClassifyMatch[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** S1-R20: chỉ giữ key thuộc `summary_fields` của đúng loại (loại LIGHT không có danh mục → rỗng). `value` giữ nguyên (S1-R22). */
function allowedFacts(facts: KeyFact[] | undefined, allowed: readonly string[] | undefined): KeyFact[] {
  if (!facts || !allowed || allowed.length === 0) return [];
  return facts.filter((f) => allowed.includes(f.key));
}

/**
 * Áp ngưỡng theo từng instance (< 0.50 bỏ), confidence match = min của instance còn lại,
 * `needs_manual_review` khi < 0.80. Loại không có trong catalog bị bỏ; trùng `doc_type_key` giữ match
 * confidence cao hơn. `needs_extraction` tra catalog, bỏ qua giá trị model. `upload_hint` chỉ đặt
 * `hint_mismatch`, không đổi kết quả.
 */
export function postprocess(raw: RawClassification, hint: string | null | undefined): PostprocessResult {
  const byKey = new Map<string, ClassifyMatch>();
  for (const m of raw.matches) {
    const docType = docTypeByKey(m.doc_type_key);
    if (!docType) continue;
    const kept = m.instances
      .filter((i) => i.confidence >= REJECT_THRESHOLD)
      .sort((a, b) => a.page_range[0] - b.page_range[0] || a.page_range[1] - b.page_range[1]);
    if (kept.length === 0) continue;
    const confidence = round(Math.min(...kept.map((i) => i.confidence)));
    const match: ClassifyMatch = {
      doc_type_key: m.doc_type_key,
      confidence,
      needs_manual_review: confidence < ACCEPT_THRESHOLD,
      needs_extraction: docType.needs_extraction,
      instances_count: kept.length,
      hint_mismatch: Boolean(hint) && docType.checklist_group !== hint,
      instances: kept.map((i, idx) => ({
        instance_index: idx + 1,
        page_range: [i.page_range[0], i.page_range[1]],
        confidence: round(i.confidence),
        summary: i.summary ?? '',
        key_facts: allowedFacts(i.key_facts, docType.summary_fields),
      })),
    };
    const prev = byKey.get(m.doc_type_key);
    if (!prev || match.confidence > prev.confidence) byKey.set(m.doc_type_key, match);
  }
  const matches = [...byKey.values()];
  if (matches.length > 0) return { ...fileOutcome('CLASSIFIED'), matches };
  const kind = raw.page_quality === 'EMPTY' ? 'EMPTY_OR_UNREADABLE'
    : raw.page_quality === 'LOW_QUALITY' ? 'LOW_QUALITY_UNREADABLE' : 'UNCLASSIFIED';
  return { ...fileOutcome(kind), matches: [] };
}
