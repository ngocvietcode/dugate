// Chia batch PDF và ghép segment giữa các batch (T-S1-03; S1-R09; hợp nhất key_facts: T-S1-08, S1-AC18).
import type { KeyFact } from './postprocess';

export const SINGLE_BATCH_MAX_PAGES = 100;
export const BATCH_SIZE = 20;

/** ≤ 100 trang → 1 batch; > 100 → batch 20 trang. Trang 1-based, inclusive. 0 trang → []. */
export function planBatches(pageCount: number): Array<[number, number]> {
  if (pageCount <= 0) return [];
  if (pageCount <= SINGLE_BATCH_MAX_PAGES) return [[1, pageCount]];
  const out: Array<[number, number]> = [];
  for (let start = 1; start <= pageCount; start += BATCH_SIZE) {
    out.push([start, Math.min(pageCount, start + BATCH_SIZE - 1)]);
  }
  return out;
}

/** 1 đoạn liên tục cùng loại do classifier trả cho một batch (trang tuyệt đối trong file). */
export interface RawSegment {
  doc_type_key: string;
  page_range: [number, number];
  confidence: number;
  /** Trang đầu của segment là trang đầu một văn bản mới (không nối với trang trước). */
  starts_new_document: boolean;
  /** D-70: tóm tắt và dữ kiện chính của bản thể (S1-R19…R22). */
  summary: string;
  key_facts: KeyFact[];
}

/**
 * Hợp nhất dữ kiện của 2 đoạn cùng một bản thể: khử trùng đúng `(subject, key, value)`. Cùng key nhưng value khác
 * (lệch OCR giữa các trang) thì GIỮ CẢ HAI — S1 không chọn giá trị đúng (S1-R23).
 */
export function mergeKeyFacts(a: KeyFact[], b: KeyFact[]): KeyFact[] {
  const seen = new Set<string>();
  const out: KeyFact[] = [];
  for (const f of [...a, ...b]) {
    const id = JSON.stringify([f.subject, f.key, f.value]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(f);
  }
  return out;
}

/**
 * Ghép segment cuối batch k với segment đầu batch k+1 khi cùng `doc_type_key`, liền trang và
 * segment sau không báo `starts_new_document`. `confidence` ghép = min. Ghép bắc cầu được qua nhiều batch.
 */
export function mergeSegments(batches: RawSegment[][]): RawSegment[] {
  const out: RawSegment[] = [];
  let prevBatch: RawSegment[] = [];
  for (const batch of batches) {
    const current = batch.map((s) => ({ ...s, page_range: [...s.page_range] as [number, number] }));
    if (prevBatch.length > 0 && current.length > 0) {
      const batchStart = Math.min(...current.map((s) => s.page_range[0]));
      const prevEnd = Math.max(...prevBatch.map((s) => s.page_range[1]));
      for (let i = 0; i < current.length; i++) {
        const head = current[i];
        if (head.page_range[0] !== batchStart || head.starts_new_document) continue;
        const tail = prevBatch.find((p) => p.doc_type_key === head.doc_type_key && p.page_range[1] === prevEnd
          && prevEnd + 1 === head.page_range[0]);
        if (!tail) continue;
        tail.page_range = [tail.page_range[0], head.page_range[1]];
        tail.confidence = Math.min(tail.confidence, head.confidence);
        // `summary` giữ của đoạn đầu (mô tả từ trang bắt đầu văn bản); dữ kiện hợp nhất cả hai đoạn.
        tail.key_facts = mergeKeyFacts(tail.key_facts, head.key_facts);
        // Segment đã ghép có thể là tail của batch kế tiếp (văn bản trải qua > 2 batch).
        current[i] = tail;
      }
    }
    for (const s of current) if (!out.includes(s)) out.push(s);
    prevBatch = current;
  }
  return out;
}
