// Selector thuần (không React) để diễn giải AppraisalResult. Mọi field optional đều được bảo vệ.

import type {
  AppraisalResult,
  ChecklistItemResult,
  ClassifiedDoc,
  EvidenceRecord,
} from '@/app/loan-appraisal/types';
import { checklistTone, type Tone } from './tone';

export { checklistTone };

export function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** D-81, D-90: giai đoạn 1 tinh gọn — S2–S5 (OCR, người & tài sản, checklist, đối chiếu chéo) chưa chạy, sẽ chạy ở giai đoạn 2. */
export function isDeferredToPhase2(result: AppraisalResult | null | undefined): boolean {
  return result?.checklist?.status_code === 'DEFERRED_TO_PHASE_2';
}

/**
 * Các bước kiểm tra hồ sơ (Customer 360, checklist, đối chiếu chéo, master data, kiểm tra nháp) tạm tắt ở giai đoạn 2: kết quả không có dữ liệu
 * của chúng (khác với chạy nhưng rỗng). Giao diện ẩn các khối đó thay vì hiện bảng trống; kết quả cũ có đủ dữ liệu vẫn hiện như trước.
 */
export function areDossierChecksDisabled(result: AppraisalResult | null | undefined): boolean {
  return result?.checklist?.status_code === 'DOSSIER_CHECKS_DISABLED';
}

/** Khối kiểm tra hồ sơ chỉ hiện khi đã chạy (không hoãn sang giai đoạn 2, không tạm tắt). */
export function hasDossierCheckResults(result: AppraisalResult | null | undefined): boolean {
  return Boolean(result) && !isDeferredToPhase2(result) && !areDossierChecksDisabled(result);
}

/**
 * Bảng người & tài sản (Customer 360) chỉ cần S3, không cần checklist / đối chiếu chéo. S3 chạy ở giai đoạn 2 kể cả khi các bước kia tạm tắt
 * (checklist mang mã DOSSIER_CHECKS_DISABLED), nên không gắn điều kiện hiện của nó với `hasDossierCheckResults`.
 * Chưa có dữ liệu (giai đoạn 1, hoặc S3 lỗi → null) thì không hiện.
 */
export function hasCustomer360(result: AppraisalResult | null | undefined): boolean {
  return Boolean(result?.customer_360) && !isDeferredToPhase2(result);
}

export function customerNameFrom(result: AppraisalResult | null | undefined): string | null {
  const c = result?.customer_360?.customer_360?.find((x) => x.roles.includes('borrower'));
  const value = c?.identity.full_name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function filesForKey(
  key: string,
  classification: ClassifiedDoc[] | null,
  result: AppraisalResult | null,
): string[] {
  const resultItems = safeArray(result?.checklist?.items).filter((item) => item.item_key === key);
  if (resultItems.length) return [...new Set(resultItems.flatMap((item) => item.found_in.map((f) => f.file_name)))];
  return safeArray(classification)
    .filter((document) => document.matches?.some((match) => match.key === key))
    .map((document) => document.file_name);
}

export function checklistStatusLabel(status: ChecklistItemResult['status'] | undefined, hasFile: boolean): string {
  if (status === 'present') return 'Đã có';
  if (status === 'missing') return 'Thiếu';
  if (status === 'review') return 'Cần rà soát';
  return hasFile ? 'Đã nhận tài liệu' : 'Chưa có';
}

const READINESS: Record<string, { label: string; tone: Tone; headline: string }> = {
  READY_FOR_APPRAISAL: { label: 'Đủ điều kiện thẩm định', tone: 'success', headline: 'Hồ sơ đã đủ chứng từ và dữ liệu để thẩm định' },
  NEEDS_DOCUMENTS: { label: 'Cần bổ sung', tone: 'warning', headline: 'Hồ sơ còn thiếu chứng từ bắt buộc' },
  NEEDS_VERIFICATION: { label: 'Cần xác minh', tone: 'warning', headline: 'Hồ sơ cần làm rõ một số chứng từ hoặc dữ liệu' },
  NOT_PROCESSABLE: { label: 'Không xử lý được', tone: 'warning', headline: 'Không đọc được dữ liệu từ bộ hồ sơ' },
};

export function readinessMeta(status: string | undefined): { label: string; tone: Tone; headline: string } {
  return READINESS[status ?? ''] ?? { label: 'Chưa xác định', tone: 'neutral', headline: 'Chưa có kết quả tiếp nhận hồ sơ' };
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export interface SourceDocument {
  file_name: string;
  doc_type_label: string;
}

export function buildEvidenceLookup(records: EvidenceRecord[] | null | undefined): Map<string, EvidenceRecord> {
  return new Map(safeArray(records).map((record) => [record.evidence_id, record]));
}

/** Gom evidence id thành danh sách chứng từ nguồn (file × loại) không trùng lặp. */
export function sourceDocumentsOf(
  ids: string[] | null | undefined,
  lookup: Map<string, EvidenceRecord>,
): { documents: SourceDocument[]; unresolved: number } {
  const seen = new Map<string, SourceDocument>();
  let unresolved = 0;
  for (const id of safeArray(ids)) {
    const record = lookup.get(id);
    if (!record) { unresolved += 1; continue; }
    // Evidence checklist trỏ về các evidence gốc; lấy file thật của chúng.
    const sources = record.evidence_kind === 'CHECKLIST_STATUS'
      ? safeArray(record.source_evidence_ids)
        .map((sourceId) => lookup.get(sourceId))
        .filter((item): item is EvidenceRecord => Boolean(item))
      : [record];
    for (const source of sources) {
      const key = `${source.file_name}\u0000${source.doc_type_label}`;
      if (!seen.has(key)) seen.set(key, { file_name: source.file_name, doc_type_label: source.doc_type_label });
    }
  }
  return { documents: [...seen.values()], unresolved };
}

// ─── Ngoại lệ ────────────────────────────────────────────────────────────────

export interface ExceptionItem {
  id: string;
  title: string;
  detail: string;
}

function plain(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/** Danh sách ngoại lệ cần xử lý, gộp từ readiness, policy và yêu cầu bổ sung. */
export function collectExceptions(result: AppraisalResult | null | undefined): ExceptionItem[] {
  if (!result) return [];
  const readiness = result.dossier_readiness;
  const items: ExceptionItem[] = [];

  safeArray(readiness?.conflicts)
    .filter((conflict) => conflict.severity === 'error')
    .forEach((conflict, index) => items.push({ id: `X${index + 1}`, title: conflict.title, detail: conflict.message }));

  safeArray(result.policy_compliance?.rule_results)
    .filter((rule) => rule.result === 'FAIL' || rule.result === 'REVIEW')
    .forEach((rule) => items.push({
      id: rule.rule_id,
      title: rule.message,
      detail: rule.expected !== undefined && rule.actual !== undefined
        ? `Yêu cầu: ${plain(rule.expected)} · Thực tế: ${plain(rule.actual)}`
        : `Mã kiểm soát ${rule.reason_code}`,
    }));

  safeArray(readiness?.supplement_requests).slice(0, 5).forEach((request, index) => items.push({
    id: `B${index + 1}`,
    title: request,
    detail: 'Bổ sung để nâng kết quả thẩm định từ tạm thành chính thức.',
  }));

  return items;
}
