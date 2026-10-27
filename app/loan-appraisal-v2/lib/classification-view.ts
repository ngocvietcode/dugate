// Chuyển kết quả phân loại S1 thành dữ liệu hiển thị cho giai đoạn 1. Hàm thuần, test bằng fixture.
import type { DossierFile } from '@/app/loan-appraisal/types';
import docTypes from '@/lib/loan-dossier/catalog/data/doc_types.json';
import { formatVnd, labelOf } from './dossier-view';

const LABELS = new Map<string, string>(
  (docTypes as { doc_types: Array<{ doc_type_key: string; doc_type_label: string }> }).doc_types.map((d) => [d.doc_type_key, d.doc_type_label]),
);

/** Nhãn tiếng Việt của loại chứng từ; không có trong catalog thì giữ nguyên key. */
export function docTypeLabelOf(key: string): string {
  return LABELS.get(key) ?? key;
}

/** Nhãn cho các key của `key_facts` (danh mục `summary_fields`) mà bảng nhãn OCR chưa có. */
const KEY_FACT_LABELS: Record<string, string> = {
  amount: 'Số tiền', collateral_identifier: 'Định danh tài sản bảo đảm', income_source: 'Nguồn thu', loan_purpose: 'Mục đích vay',
  previous_id_number: 'Số định danh cũ',
};

const SUBJECT_LABELS: Record<string, string> = {
  borrower: 'Người vay', co_borrower: 'Người đồng vay', guarantor: 'Người bảo lãnh', collateral_owner: 'Chủ tài sản bảo đảm', spouse: 'Vợ/chồng',
};

/** `borrower` → "Người vay"; `person-2` → "Người 2"; `asset-1` → "Tài sản 1"; nhãn lạ giữ nguyên. */
export function subjectLabel(subject: string): string {
  const known = SUBJECT_LABELS[subject.toLowerCase()];
  if (known) return known;
  const m = subject.match(/^(person|asset)-(\d+)$/i);
  if (m) return `${m[1].toLowerCase() === 'person' ? 'Người' : 'Tài sản'} ${m[2]}`;
  return subject;
}

export function keyFactLabel(key: string): string {
  return KEY_FACT_LABELS[key] ?? labelOf(key);
}

/** Số tiền nguyên hiển thị theo VND; giá trị khác giữ nguyên văn như in trên chứng từ (có thể sai chính tả do OCR). */
function factValue(key: string, value: string): string {
  return key === 'amount' && /^\d{4,}$/.test(value.replace(/[.,\s]/g, '')) ? formatVnd(Number(value.replace(/[.,\s]/g, ''))) : value;
}

export interface KeyFactRow { key: string; label: string; value: string; page: number | null }
export interface KeyFactGroup { subject: string; label: string; rows: KeyFactRow[] }

/** Gom `key_facts` theo đối tượng (giữ thứ tự xuất hiện). Bỏ giá trị rỗng/null: chỉ hiện điều thật sự đọc được. */
export function keyFactGroups(facts: ReadonlyArray<{ subject: string; key: string; value: string | null; page: number | null }>): KeyFactGroup[] {
  const out = new Map<string, KeyFactGroup>();
  for (const f of facts) {
    const value = (f.value ?? '').trim();
    if (!value) continue;
    const g = out.get(f.subject) ?? { subject: f.subject, label: subjectLabel(f.subject), rows: [] };
    g.rows.push({ key: f.key, label: keyFactLabel(f.key), value: factValue(f.key, value), page: f.page });
    out.set(f.subject, g);
  }
  return [...out.values()];
}

export interface ClassifiedDocView {
  key: string;
  label: string;
  /** "tr. 1" hoặc "tr. 1–3". */
  pages: string;
  confidence_percent: number;
  needs_review: boolean;
  summary: string;
  facts: KeyFactGroup[];
}

export interface ClassifiedFileView {
  file_id: string;
  file_name: string;
  page_count: number | null;
  docs: ClassifiedDocView[];
}

const pageText = (range: readonly [number, number] | number[]): string => (range[0] === range[1] ? `tr. ${range[0]}` : `tr. ${range[0]}–${range[1]}`);

/**
 * Mỗi file nhận diện được → các mẫu biểu (bản thể) bên trong; mỗi mẫu biểu có `summary` và `key_facts` RIÊNG của nó
 * (S1 sinh theo từng instance, không có tóm tắt chung cho cả file). File lỗi/chưa nhận diện hiện ở thẻ riêng.
 */
export function classifiedFileViews(files: ReadonlyArray<DossierFile>): ClassifiedFileView[] {
  return files.filter((f) => f.status === 'CLASSIFIED').map((f) => ({
    file_id: f.file_id,
    file_name: f.file_name,
    page_count: f.page_count,
    docs: f.matches.flatMap((m) => m.instances.map((i) => ({
      key: `${m.doc_type_key}:${i.instance_index}`,
      label: docTypeLabelOf(m.doc_type_key),
      pages: pageText(i.page_range),
      confidence_percent: Math.round(i.confidence * 100),
      needs_review: m.needs_manual_review,
      summary: i.summary,
      facts: keyFactGroups(i.key_facts ?? []),
    }))),
  }));
}

export function classificationCounts(files: ReadonlyArray<DossierFile>): { files: number; classified: number; docs: number; unclassified: number } {
  const views = classifiedFileViews(files);
  return { files: files.length, classified: views.length, docs: views.reduce((n, v) => n + v.docs.length, 0), unclassified: files.length - views.length };
}