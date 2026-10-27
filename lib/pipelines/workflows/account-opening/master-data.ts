// Provenance cho master data hồ sơ mở tài khoản (Customer Profile).
//
// Customer Profile do LLM hợp nhất ở stage 2 nên bản thân nó không có nguồn.
// Module này đối chiếu từng trường với evidence registry để trả lời "giá trị này
// lấy từ chứng từ nào", không đổi giá trị và không dựng golden record.
//
// Ngoài provenance từng trường, module còn tính ĐỘ PHỦ TRƯỜNG CIF BẮT BUỘC của
// phân khúc. Đây là chỉ số THÔNG TIN (hiển thị trên UI và trong eligibility
// metrics), không còn rule nào chặn theo nó: chỉ những trường truy được nguồn
// chứng từ mới được tính là đã có, nên con số này phản ánh mức truy vết thật.

import type { CustomerProfile } from '../prompts/account-opening-prompts';
import { parseMoney } from './evidence';
import type {
  EvidenceRecord,
  EvidenceRegistry,
  ProfileFieldProvenance,
  ProfileProvenanceResult,
} from './types';

const GROUP_LABELS: Record<string, string> = {
  identity: 'Định danh',
  contact: 'Liên hệ',
  organization: 'Thông tin tổ chức',
  authorization: 'Thẩm quyền & ủy quyền',
  ownership: 'Cấu trúc sở hữu',
  compliance: 'Tuân thủ & KYC',
  account: 'Thông tin tài khoản',
};

/** Giá trị quá ngắn dễ khớp nhầm (ví dụ "1", "A") nên không dùng để truy nguồn. */
const MIN_MATCHABLE_LENGTH = 3;
const CONTAINS_MATCH_MIN_LENGTH = 8;
const MONEY_RELATIVE_TOLERANCE = 0.005;

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(value: string): string {
  return stripDiacritics(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function humanizeSegment(segment: string): string {
  return segment
    .replace(/\[(\d+)\]/g, ' #$1')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function displayValue(value: string | number | boolean): string {
  if (typeof value === 'number') return value.toLocaleString('vi-VN');
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  return value.trim();
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function flattenLeaves(
  value: unknown,
  path: string,
  out: Array<{ path: string; value: string | number | boolean }>,
): Array<{ path: string; value: string | number | boolean }> {
  if (isPrimitive(value)) {
    out.push({ path, value });
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

function isEmptyValue(value: string | number | boolean): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return !trimmed || ['N/A', 'NOT_FOUND', '-', 'KHONG CO', 'KHÔNG CÓ'].includes(trimmed.toUpperCase());
}

/**
 * Một evidence được coi là nguồn của trường Customer Profile khi giá trị trùng
 * khớp về nghĩa. So sánh tiền/số theo số học vì OCR viết nhiều định dạng.
 */
function matchesEvidence(value: string | number | boolean, record: EvidenceRecord): boolean {
  const recordValue = record.normalized_value;
  if (recordValue === null) return false;

  const fieldMoney = parseMoney(value);
  const recordMoney = parseMoney(recordValue);
  if (fieldMoney !== null && recordMoney !== null && fieldMoney !== 0) {
    const tolerance = Math.abs(fieldMoney) * MONEY_RELATIVE_TOLERANCE;
    if (Math.abs(fieldMoney - recordMoney) <= tolerance) return true;
  }

  const fieldText = normalizeText(String(value));
  const recordText = normalizeText(String(recordValue));
  if (!fieldText || !recordText) return false;
  if (fieldText.length < MIN_MATCHABLE_LENGTH) return false;
  if (fieldText === recordText) return true;

  // Chuỗi dài (địa chỉ, tên tổ chức) thường bị cắt bớt khi hợp nhất.
  if (fieldText.length >= CONTAINS_MATCH_MIN_LENGTH || recordText.length >= CONTAINS_MATCH_MIN_LENGTH) {
    if (fieldText.includes(recordText) || recordText.includes(fieldText)) return true;
  }
  return false;
}

/** field_path của provenance khớp một trường CIF bắt buộc (kể cả field lồng/mảng). */
function matchesMandatoryPath(fieldPath: string, mandatoryPath: string): boolean {
  return fieldPath === mandatoryPath
    || fieldPath.startsWith(`${mandatoryPath}.`)
    || fieldPath.startsWith(`${mandatoryPath}[`);
}

/** Thứ tự ưu tiên khi một trường bắt buộc có nhiều leaf với provenance khác nhau. */
const PROVENANCE_RANK: Record<ProfileFieldProvenance['provenance'], number> = {
  VERIFIED: 3,
  NEEDS_REVIEW: 2,
  UNVERIFIED: 1,
};

export function buildProfileProvenance(
  customerProfile: CustomerProfile,
  evidence: EvidenceRegistry,
  mandatoryFields: Array<{ path: string; label: string }> = [],
): ProfileProvenanceResult {
  const extractedRecords = evidence.records.filter((record) => record.evidence_kind !== 'CHECKLIST_STATUS');
  const fields: ProfileFieldProvenance[] = [];

  for (const [group, groupValue] of Object.entries(customerProfile ?? {})) {
    if (!groupValue || typeof groupValue !== 'object') continue;
    const leaves = flattenLeaves(groupValue, '', []);
    for (const leaf of leaves) {
      if (isEmptyValue(leaf.value)) continue;
      const matched = extractedRecords.filter((record) => matchesEvidence(leaf.value, record));
      const accepted = matched.filter((record) => record.review_status === 'ACCEPTED');
      const cited = accepted.length > 0 ? accepted : matched;
      fields.push({
        group,
        group_label: GROUP_LABELS[group] ?? humanizeSegment(group),
        field_path: `${group}.${leaf.path}`,
        label: humanizeSegment(leaf.path.split('.').at(-1) ?? leaf.path),
        value: displayValue(leaf.value),
        provenance: accepted.length > 0 ? 'VERIFIED' : matched.length > 0 ? 'NEEDS_REVIEW' : 'UNVERIFIED',
        evidence_ids: [...new Set(cited.map((record) => record.evidence_id))],
        source_documents: [...new Set(cited.map((record) => record.file_name))],
      });
    }
  }

  const verified = fields.filter((field) => field.provenance === 'VERIFIED').length;
  const needsReview = fields.filter((field) => field.provenance === 'NEEDS_REVIEW').length;
  const unverified = fields.filter((field) => field.provenance === 'UNVERIFIED').length;

  // Trường bắt buộc: lấy provenance tốt nhất trong các leaf thuộc trường đó.
  // MISSING = Customer Profile không có giá trị nào cho trường này.
  const mandatory = mandatoryFields.map((required) => {
    const related = fields.filter((field) => matchesMandatoryPath(field.field_path, required.path));
    if (related.length === 0) {
      return { field_path: required.path, label: required.label, status: 'MISSING' as const };
    }
    const best = related.reduce((highest, field) =>
      PROVENANCE_RANK[field.provenance] > PROVENANCE_RANK[highest.provenance] ? field : highest);
    return { field_path: required.path, label: required.label, status: best.provenance };
  });

  // Chỉ trường truy được về chứng từ mới tính là đã có: giá trị do LLM tự điền mà
  // không có evidence (UNVERIFIED) không đủ để mở CIF.
  const covered = mandatory.filter((item) => item.status === 'VERIFIED' || item.status === 'NEEDS_REVIEW').length;

  return {
    fields,
    summary: {
      total: fields.length,
      verified,
      needs_review: needsReview,
      unverified,
      traceable_percent: fields.length === 0 ? 0 : Math.round(((verified + needsReview) / fields.length) * 100),
    },
    mandatory_fields: mandatory,
    mandatory_coverage_percent: mandatory.length === 0 ? 100 : Math.round((covered / mandatory.length) * 100),
  };
}
