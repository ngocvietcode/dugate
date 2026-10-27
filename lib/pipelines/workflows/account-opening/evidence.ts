// Evidence registry của hồ sơ mở tài khoản.
//
// Mọi kết luận ở các stage sau chỉ được dựa trên evidence trong registry này:
// một record = một giá trị nguyên thủy đã bóc tách được từ một chứng từ cụ thể,
// kèm độ tin cậy phân loại. Nhờ vậy mọi con số trong kết quả đều truy được về
// file gốc, và rule LLM không thể viện dẫn evidence không tồn tại.

import type { ChecklistItemResult, ClassifiedDoc, ExtractedDoc } from '../prompts/account-opening-prompts';
import type { EvidenceRecord, EvidenceRegistry } from './types';

/** Ngưỡng confidence phân loại để evidence được coi là đã chấp nhận. */
const ACCEPTED_CONFIDENCE = 0.75;

function primitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizePrimitive(value: string | number | boolean): string | number | boolean | null {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || ['N/A', 'NOT_FOUND', '-', 'KHONG CO', 'KHÔNG CÓ'].includes(trimmed.toUpperCase())) return null;
  return trimmed;
}

function flattenLeaves(value: unknown, path = '', out: Array<{ path: string; value: string | number | boolean }> = []) {
  if (primitive(value)) {
    out.push({ path: path || 'value', value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenLeaves(item, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenLeaves(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

export function buildEvidenceRegistry(
  classification: ClassifiedDoc[],
  extraction: ExtractedDoc[],
  checklist: ChecklistItemResult[] = [],
): EvidenceRegistry {
  const confidenceByFileAndType = new Map<string, number>();
  for (const file of classification) {
    for (const match of file.matches) {
      confidenceByFileAndType.set(`${file.file_name}\u0000${match.key}`, match.confidence);
    }
  }

  const records: EvidenceRecord[] = [];
  for (const [docIndex, doc] of extraction.entries()) {
    if (doc.status !== 'success') continue;
    const confidence = confidenceByFileAndType.get(`${doc.file_name}\u0000${doc.doc_type_key}`) ?? null;
    const leaves = flattenLeaves(doc.data);
    leaves.forEach((leaf, leafIndex) => {
      const normalized = normalizePrimitive(leaf.value);
      if (normalized === null) return;
      records.push({
        evidence_id: `ev-${docIndex + 1}-${leafIndex + 1}`,
        field_path: leaf.path,
        value: leaf.value,
        normalized_value: normalized,
        file_name: doc.file_name,
        doc_type_key: doc.doc_type_key,
        doc_type_label: doc.doc_type_label,
        classification_confidence: confidence,
        extraction_method: 'AI_EXTRACT',
        evidence_kind: 'EXTRACTED_FIELD',
        source_evidence_ids: [],
        review_status: confidence !== null && confidence >= ACCEPTED_CONFIDENCE ? 'ACCEPTED' : 'REVIEW',
      });
    });
  }

  // Trạng thái checklist là artifact deterministic của hồ sơ. Đăng ký nó để các
  // phát hiện "đủ/thiếu chứng từ" ở stage CDD có căn cứ dẫn chiếu thay vì kết
  // luận suông. Trạng thái "present" chỉ được ACCEPTED khi chứng từ tương ứng
  // cũng tạo ra evidence bóc tách đã chấp nhận.
  checklist.forEach((item, index) => {
    const sourceRecords = records.filter((record) => record.doc_type_key === item.key
      && record.evidence_kind === 'EXTRACTED_FIELD'
      && (item.found_in.length === 0 || item.found_in.includes(record.file_name)));
    const sourceEvidenceIds = sourceRecords.map((record) => record.evidence_id);
    const acceptedSource = sourceRecords.some((record) => record.review_status === 'ACCEPTED');
    const classificationConfidence = classification
      .flatMap((file) => file.matches)
      .filter((match) => match.key === item.key)
      .reduce<number | null>((highest, match) => highest === null ? match.confidence : Math.max(highest, match.confidence), null);
    records.push({
      evidence_id: `ev-checklist-${index + 1}`,
      field_path: `checklist.${item.key}.status`,
      value: { status: item.status, found_in: item.found_in, note: item.note ?? null },
      normalized_value: item.status,
      file_name: item.found_in.join(', ') || 'Hồ sơ tổng hợp',
      doc_type_key: item.key,
      doc_type_label: item.label,
      classification_confidence: classificationConfidence,
      extraction_method: 'AI_EXTRACT',
      evidence_kind: 'CHECKLIST_STATUS',
      source_evidence_ids: sourceEvidenceIds,
      review_status: item.status === 'present' && acceptedSource ? 'ACCEPTED' : 'REVIEW',
    });
  });

  const byFile = new Map<string, { docTypes: Set<string>; evidenceIds: string[] }>();
  const byType = new Map<string, { files: Set<string>; evidenceIds: string[] }>();
  for (const record of records) {
    const file = byFile.get(record.file_name) ?? { docTypes: new Set<string>(), evidenceIds: [] };
    file.docTypes.add(record.doc_type_key);
    file.evidenceIds.push(record.evidence_id);
    byFile.set(record.file_name, file);

    const type = byType.get(record.doc_type_key) ?? { files: new Set<string>(), evidenceIds: [] };
    type.files.add(record.file_name);
    type.evidenceIds.push(record.evidence_id);
    byType.set(record.doc_type_key, type);
  }

  return {
    records,
    by_file: [...byFile.entries()].map(([file_name, value]) => ({
      file_name,
      doc_types: [...value.docTypes],
      evidence_ids: value.evidenceIds,
    })),
    by_document_type: [...byType.entries()].map(([doc_type_key, value]) => ({
      doc_type_key,
      file_names: [...value.files],
      evidence_ids: value.evidenceIds,
    })),
  };
}

// ─── Chuẩn hoá giá trị ────────────────────────────────────────────────────────

export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let text = value.toLowerCase().replace(/vnđ|vnd|đồng|đ/g, '').trim();
  let multiplier = 1;
  if (/\btỷ\b|\bty\b/.test(text)) multiplier = 1_000_000_000;
  else if (/\btriệu\b|\btrieu\b|\btr\b/.test(text)) multiplier = 1_000_000;
  text = text.replace(/tỷ|ty|triệu|trieu|\btr\b/g, '').replace(/\s/g, '');
  if (!/[-+]?\d/.test(text)) return null;

  const dot = text.lastIndexOf('.');
  const comma = text.lastIndexOf(',');
  let normalized = text;
  if (dot >= 0 && comma >= 0) {
    const decimal = dot > comma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = text.split(thousands).join('').replace(decimal, '.');
  } else if (dot >= 0 || comma >= 0) {
    const separator = dot >= 0 ? '.' : ',';
    const parts = text.split(separator);
    normalized = parts[parts.length - 1].length === 3 ? parts.join('') : `${parts.slice(0, -1).join('')}.${parts.at(-1)}`;
  }
  const parsed = Number(normalized.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

/** Tỷ lệ phần trăm; nhận "25", "25%", "0.25" (0..1 được quy đổi về %). */
export function parsePercent(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return value > 0 && value <= 1 ? value * 100 : value;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const hasPercentSign = text.includes('%');
  const numeric = Number(text.replace(/%/g, '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  // "0.25" không kèm dấu % thì hiểu là 25%; "25%" giữ nguyên.
  if (!hasPercentSign && numeric > 0 && numeric <= 1) return numeric * 100;
  return numeric;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Chuẩn hoá ngày trên chứng từ về UTC. Hỗ trợ các định dạng OCR thường gặp:
 * dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, "ngày 01 tháng 02 năm 2030", 01 Feb 2030.
 * Ưu tiên dd/mm/yyyy (chuẩn VN) khi cả hai vị trí đều ≤ 12.
 */
export function parseDocumentDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // Năm trần (VD 2030) không đủ thông tin để so sánh ngày.
    return null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;

  const vietnamese = text.match(/ngày\s*(\d{1,2}).*?tháng\s*(\d{1,2}).*?năm\s*(\d{4})/);
  if (vietnamese) return utcDate(Number(vietnamese[3]), Number(vietnamese[2]), Number(vietnamese[1]));

  const iso = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    // Nếu vị trí đầu > 12 thì chắc chắn là ngày; ngược lại theo chuẩn VN dd/mm.
    return utcDate(Number(dmy[3]), second, first);
  }

  const named = text.match(/(\d{1,2})\s*([a-z]{3,})\.?\s*(\d{4})/);
  if (named) {
    const month = MONTH_NAMES[named[2].slice(0, 3)];
    if (month) return utcDate(Number(named[3]), month, Number(named[1]));
  }

  const monthYear = text.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (monthYear) return utcDate(Number(monthYear[2]), Number(monthYear[1]), 1);

  return null;
}

function utcDate(year: number, month: number, day: number): Date | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/** Số ngày trọn giữa hai mốc (dương nghĩa là `to` ở tương lai so với `from`). */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Số tháng tròn giữa hai mốc. */
export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() >= from.getUTCDate() ? months : months - 1;
}

// ─── Truy vấn evidence ────────────────────────────────────────────────────────

/** Chỉ evidence đã chấp nhận, không tính record trạng thái checklist. */
function candidateRecords(registry: EvidenceRegistry, docTypes?: string[]) {
  return registry.records.filter((record) => {
    if (record.review_status !== 'ACCEPTED' || record.evidence_kind === 'CHECKLIST_STATUS') return false;
    if (docTypes && docTypes.length > 0 && !docTypes.includes(record.doc_type_key)) return false;
    return true;
  });
}

export interface EvidenceMatch<T> {
  value: T;
  evidenceIds: string[];
}

export function findMoneyEvidence(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes?: string[],
): EvidenceMatch<number> | null {
  for (const record of candidateRecords(registry, docTypes)) {
    if (!pathPatterns.some((pattern) => pattern.test(record.field_path))) continue;
    const value = parseMoney(record.normalized_value);
    if (value !== null && value >= 0) return { value, evidenceIds: [record.evidence_id] };
  }
  return null;
}

export function findPercentEvidence(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes?: string[],
): EvidenceMatch<number> | null {
  for (const record of candidateRecords(registry, docTypes)) {
    if (!pathPatterns.some((pattern) => pattern.test(record.field_path))) continue;
    const value = parsePercent(record.normalized_value);
    if (value !== null) return { value, evidenceIds: [record.evidence_id] };
  }
  return null;
}

/** Tổng mọi tỷ lệ % khớp pattern (dùng cho độ phủ chủ sở hữu hưởng lợi). */
export function sumPercentEvidence(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes?: string[],
): EvidenceMatch<number> & { count: number } | null {
  const evidenceIds: string[] = [];
  let total = 0;
  let count = 0;
  for (const record of candidateRecords(registry, docTypes)) {
    if (!pathPatterns.some((pattern) => pattern.test(record.field_path))) continue;
    const value = parsePercent(record.normalized_value);
    if (value === null) continue;
    total += value;
    count += 1;
    evidenceIds.push(record.evidence_id);
  }
  return count > 0 ? { value: total, evidenceIds, count } : null;
}

export function findDateEvidence(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes?: string[],
): EvidenceMatch<Date> | null {
  for (const record of candidateRecords(registry, docTypes)) {
    if (!pathPatterns.some((pattern) => pattern.test(record.field_path))) continue;
    const value = parseDocumentDate(record.normalized_value);
    if (value) return { value, evidenceIds: [record.evidence_id] };
  }
  return null;
}

/** Ngày sớm nhất trong các evidence khớp (VD ngày hết hạn gần nhất). */
export function findEarliestDateEvidence(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes?: string[],
): EvidenceMatch<Date> | null {
  let earliest: EvidenceMatch<Date> | null = null;
  for (const record of candidateRecords(registry, docTypes)) {
    if (!pathPatterns.some((pattern) => pattern.test(record.field_path))) continue;
    const value = parseDocumentDate(record.normalized_value);
    if (!value) continue;
    if (!earliest || value.getTime() < earliest.value.getTime()) {
      earliest = { value, evidenceIds: [record.evidence_id] };
    }
  }
  return earliest;
}

/** Đếm số evidence riêng biệt khớp pattern (VD số người được ủy quyền). */
export function countEvidence(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes?: string[],
): EvidenceMatch<number> | null {
  const seen = new Set<string>();
  const evidenceIds: string[] = [];
  for (const record of candidateRecords(registry, docTypes)) {
    if (!pathPatterns.some((pattern) => pattern.test(record.field_path))) continue;
    const key = String(record.normalized_value ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    evidenceIds.push(record.evidence_id);
  }
  return evidenceIds.length > 0 ? { value: evidenceIds.length, evidenceIds } : null;
}

export function findTextEvidence(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes?: string[],
): EvidenceMatch<string> | null {
  for (const record of candidateRecords(registry, docTypes)) {
    if (!pathPatterns.some((pattern) => pattern.test(record.field_path))) continue;
    const value = String(record.normalized_value ?? '').trim();
    if (value) return { value, evidenceIds: [record.evidence_id] };
  }
  return null;
}
