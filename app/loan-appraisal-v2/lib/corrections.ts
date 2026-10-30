// Khay hiệu chỉnh của người thẩm định (case_corrections.md COR-R16; T-COR-06). Thuần, không I/O: danh sách giữ trong state của trang,
// không bao giờ ghi localStorage (chứa PII). Mọi tham chiếu dùng mã ổn định (record_id, evidence_id + index), không dùng person-n / F<n>.
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import {
  CASE_INPUT_CONTRACT,
  CASE_INPUT_VERSION,
  type CaseInput,
  type Correction,
  type CorrectionSkipCode,
} from '@/lib/loan-dossier/corrections/schema';

export type { Correction };

/** Đích của hiệu chỉnh: hai hiệu chỉnh cùng đích thì bản sau thay bản trước (như COR-R14 ở server). */
export function correctionTarget(c: Correction): string {
  if (c.kind === 'OCR_FIX') return `fix:${c.record_id}`;
  if (c.kind === 'FACT_RESOLUTION') return `res:${[...c.record_ids].sort().join('|')}`;
  const ends = [`${c.a.evidence_id}#${c.a.index}`, `${c.b.evidence_id}#${c.b.index}`].sort().join('|');
  return `link:${c.subject_kind}:${ends}`;
}

export type CorrectionAction =
  | { type: 'add'; correction: Correction }
  | { type: 'remove'; correction_id: string }
  | { type: 'clear' };

export function correctionsReducer(state: readonly Correction[], action: CorrectionAction): Correction[] {
  switch (action.type) {
    case 'add': {
      const target = correctionTarget(action.correction);
      return [...state.filter((c) => correctionTarget(c) !== target), action.correction];
    }
    case 'remove': return state.filter((c) => c.correction_id !== action.correction_id);
    case 'clear': return [];
  }
}

let seq = 0;
export function newCorrectionId(now: number = Date.now()): string {
  seq += 1;
  return `c-${now.toString(36)}-${seq}`;
}

/** Case input từ kết quả đang xem; null khi kết quả không có niêm phong (kết quả cũ, giai đoạn 1). */
export function buildCaseInput(result: AppraisalResult, corrections: readonly Correction[]): CaseInput | null {
  if (!result.case_seal || !result.documents) return null;
  return {
    contract: CASE_INPUT_CONTRACT,
    contract_version: CASE_INPUT_VERSION,
    documents: result.documents as CaseInput['documents'],
    dossier_precheck: (result.dossier_precheck ?? null) as CaseInput['dossier_precheck'],
    case_seal: result.case_seal,
    corrections: [...corrections],
  };
}

export const caseInputJson = (input: CaseInput) => JSON.stringify(input);

export const SKIP_LABELS: Record<CorrectionSkipCode, string> = {
  ORPHAN_EDIT: 'Không tìm thấy trường trên chứng từ',
  FIELD_NOT_EDITABLE: 'Trường này là nhóm, không sửa trực tiếp được',
  EDIT_ON_ERROR_EVIDENCE: 'Chứng từ không đọc được nên không sửa được',
  EDIT_BASE_CHANGED: 'Giá trị trên chứng từ đã khác lúc bạn sửa',
  INVALID_VALUE: 'Giá trị mới sai kiểu dữ liệu',
  LINK_ORPHAN: 'Không tìm thấy người / tài sản trên chứng từ',
  LINK_UNSUPPORTED: 'Chưa hỗ trợ gộp / tách trường hợp này (hai người cùng đơn vay hoặc chủ sở hữu ghép)',
  LINK_CONTRADICTS_ID: 'Hai bên cùng số định danh / số GCN nên không tách được',
  LINK_CYCLE: 'Các hiệu chỉnh gộp / tách mâu thuẫn nhau',
  LINK_CONFLICT: 'Hai bên đã thuộc hai người khác nhau, chưa gộp được',
  RESOLUTION_ORPHAN: 'Không còn tìm thấy giá trị đã chọn',
  RESOLUTION_STALE: 'Mâu thuẫn này không còn (đã đổi sau các hiệu chỉnh khác)',
  DUPLICATE_TARGET: 'Có hiệu chỉnh mới hơn cho cùng chỗ',
};

export const KIND_LABELS: Record<Correction['kind'], string> = {
  OCR_FIX: 'Máy đọc sai',
  FACT_RESOLUTION: 'Chọn giá trị đúng',
  SAME_SUBJECT: 'Là một',
  DIFFERENT_SUBJECT: 'Không phải một',
};

// ─── Ứng viên hiệu chỉnh từ kết quả ───────────────────────────────────────────

type Profile = NonNullable<AppraisalResult['profile_360']>;
type Map360 = NonNullable<AppraisalResult['customer_360']>;

/** Tên người kèm năm sinh và vai trò (COR-R16). */
export function personLabel(profile: Profile | null | undefined, personId: string): string {
  const c = profile?.customers.find((x) => x.person_id === personId);
  if (!c) return personId;
  const year = typeof c.date_of_birth.value === 'string' ? c.date_of_birth.value.slice(0, 4) : null;
  const role = c.roles.includes('borrower') ? 'khách vay' : c.roles.includes('co_borrower') ? 'đồng vay' : c.roles.includes('collateral_owner') ? 'chủ TSBĐ' : null;
  const name = typeof c.full_name.value === 'string' ? c.full_name.value : personId;
  const extra = [year, role].filter(Boolean).join(', ');
  return extra ? `${name} (${extra})` : name;
}

export interface Occurrence { evidence_id: string; index: number; doc_type_key: string }

export interface PersonOccurrences {
  person_id: string;
  label: string;
  /** Lần xuất hiện trên đơn vay (anchor) — đầu dùng cho liên kết. */
  anchor: Occurrence | null;
  /** Lần xuất hiện được gộp từ chứng từ khác (có thể tách ra). */
  others: Array<Occurrence & { matched_by: string }>;
}

export function personOccurrences(result: AppraisalResult): PersonOccurrences[] {
  const map = result.customer_360 as Map360 | null | undefined;
  return (map?.role_registry ?? []).map((p) => {
    const mapped = p.mapped_evidences as Array<{ evidence_id: string; party_index: number; doc_type_key: string; matched_by: string; sub_index: number | null }>;
    const anchor = mapped.find((m) => m.matched_by === 'ANCHOR' && m.sub_index === null);
    return {
      person_id: p.person_id,
      label: personLabel(result.profile_360, p.person_id),
      anchor: anchor ? { evidence_id: anchor.evidence_id, index: anchor.party_index, doc_type_key: anchor.doc_type_key } : null,
      others: mapped.filter((m) => m.matched_by !== 'ANCHOR' && m.sub_index === null).map((m) => ({ evidence_id: m.evidence_id, index: m.party_index, doc_type_key: m.doc_type_key, matched_by: m.matched_by })),
    };
  });
}

/** Party trên chứng từ chưa gắn được vào ai (để "Là người …"). */
export function unmappedParties(result: AppraisalResult): Array<Occurrence & { name: string | null }> {
  const map = result.customer_360 as Map360 | null | undefined;
  return (map?.unmapped_evidences ?? [])
    .filter((u): u is typeof u & { party_index: number } => u.party_index !== null)
    .map((u) => ({ evidence_id: u.evidence_id, index: u.party_index, doc_type_key: u.doc_type_key, name: u.full_name }));
}

export interface AssetOccurrences { asset_id: string; label: string; sources: Occurrence[] }

export function assetOccurrences(result: AppraisalResult): AssetOccurrences[] {
  const map = result.customer_360 as Map360 | null | undefined;
  return (map?.asset_registry ?? []).map((a) => {
    const ids = a.identifiers as Record<string, unknown>;
    const ident = ['certificate_number', 'license_plate', 'chassis_number', 'apartment_number'].map((k) => ids[k]).find((v) => typeof v === 'string' && v);
    const sources = (a.sources as Array<{ evidence_id: string; asset_index: number; doc_type_key: string }>).map((s) => ({ evidence_id: s.evidence_id, index: s.asset_index, doc_type_key: s.doc_type_key }));
    return { asset_id: a.asset_id, label: ident ? `${a.asset_type} ${String(ident)}` : a.asset_type, sources };
  });
}

/** Lá scalar của một chứng từ (để "Máy đọc sai"): record_id, đường dẫn, giá trị hiện tại. */
export function evidenceLeaves(evidence: { evidence_id: string; data: Record<string, unknown> | null }): Array<{ record_id: string; path: string; value: string | number | boolean }> {
  const out: Array<{ record_id: string; path: string; value: string | number | boolean }> = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k);
    else if ((typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && path) out.push({ record_id: `${evidence.evidence_id}#${path}`, path, value: v });
  };
  walk(evidence.data, '');
  return out;
}

/** Số ngày giữ nội dung Operation mặc định (OPERATION_CONTENT_RETENTION_DAYS). Sau hạn, chỉ tính lại được từ file đã tải (COR-R17). */
export const DEFAULT_RETENTION_DAYS = 7;
