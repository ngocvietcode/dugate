// Số định danh và bản trùng (T-S5-07; S5-R08, R09).
import { idKind } from '../common/id-number';
import type { Verdict } from './metric';

export interface IdValue { normalized: string | null; id_status: 'CURRENT' | 'HISTORICAL' | 'OBSERVED' | null }

/**
 * ≥ 2 số CURRENT khác nhau → MISMATCH/CURRENT_ID_NUMBER_CONFLICT/HIGH. Khác nhau chỉ do số 9 HISTORICAL và số 12
 * CURRENT → UNDETERMINED/HISTORICAL_ID_NUMBER/REVIEW. Trả null khi không thuộc hai trường hợp (để xét tiếp).
 */
export function adjudicateIdNumber(values: readonly IdValue[]): Verdict | null {
  const current = new Set(values.filter((v) => v.id_status === 'CURRENT' && v.normalized).map((v) => v.normalized!));
  if (current.size >= 2) {
    return { match_status: 'MISMATCH', reason_code: 'CURRENT_ID_NUMBER_CONFLICT', severity: 'HIGH', reason: 'Có từ 2 số định danh hiện tại khác nhau cho cùng người.' };
  }
  const distinct = [...new Set(values.map((v) => v.normalized).filter((n): n is string => n !== null))];
  if (distinct.length <= 1) return null;
  const explained = distinct.every((n) => {
    const v = values.find((x) => x.normalized === n)!;
    return current.has(n) || (v.id_status === 'HISTORICAL' && idKind(n) === 'ID9');
  });
  if (explained && current.size === 1) {
    return { match_status: 'UNDETERMINED', reason_code: 'HISTORICAL_ID_NUMBER', severity: 'REVIEW', reason: 'Khác nhau do CMND 9 số cũ và CCCD 12 số hiện tại; giữ cả hai số để rà soát.' };
  }
  return null;
}

export interface IdSource { evidence_id: string; doc_type_key: string; normalized: string | null }

/** Chứng từ tự nó nối các số định danh của một người: QR trên CCCD, cam kết 2 CMND/CCCD, xác nhận CMND địa phương. */
export const ID_LINKING_DOC_TYPES: Readonly<Record<string, string>> = {
  qr_code_info: 'Mã QR trên CCCD',
  same_person_commitment: 'Giấy cam kết 2 CMND/CCCD là một người',
  local_cmnd_confirmation: 'Giấy xác nhận CMND của địa phương',
};

/**
 * D-61: một khách hàng có thể có 2 số định danh (CMND 9 số cũ + CCCD 12 số). Nếu một chứng từ nối số (`ID_LINKING_DOC_TYPES`)
 * thể hiện ĐỦ mọi số đang so → chính chứng từ đó cho biết đó là cùng một người → MATCH/ID_LINKED_BY_DOCUMENT, không cảnh báo.
 * Không áp khi chứng từ nối chỉ có một phần các số (còn số lạ bên ngoài): trả null để xét theo S5-R08.
 */
export function adjudicateIdLinkedByDocument(sources: readonly IdSource[]): Verdict | null {
  const distinct = new Set(sources.map((s) => s.normalized).filter((n): n is string => n !== null));
  if (distinct.size < 2) return null;
  const perDoc = new Map<string, { doc_type_key: string; ids: Set<string> }>();
  for (const s of sources) {
    if (!(s.doc_type_key in ID_LINKING_DOC_TYPES) || s.normalized === null) continue;
    if (!perDoc.has(s.evidence_id)) perDoc.set(s.evidence_id, { doc_type_key: s.doc_type_key, ids: new Set() });
    perDoc.get(s.evidence_id)!.ids.add(s.normalized);
  }
  const linker = [...perDoc.values()].find((d) => d.ids.size === distinct.size);
  if (!linker) return null;
  return {
    match_status: 'MATCH', reason_code: 'ID_LINKED_BY_DOCUMENT', severity: 'INFO',
    reason: `${ID_LINKING_DOC_TYPES[linker.doc_type_key]} thể hiện cả hai số định danh (CMND cũ và CCCD hiện tại) nên xác định là cùng một người; giữ cả hai số.`,
  };
}

export interface DupValue { normalized: unknown; duplicate_group_id: string | null; duplicate_status: string | null }

/** 2 bản cùng nhóm trùng CONFLICTING_DUPLICATES có giá trị khác nhau → MISMATCH/DUPLICATE_VALUE_CONFLICT. */
export function adjudicateDuplicates(values: readonly DupValue[]): Verdict | null {
  const groups = new Map<string, Set<string>>();
  for (const v of values) {
    if (v.duplicate_status !== 'CONFLICTING_DUPLICATES' || !v.duplicate_group_id) continue;
    if (!groups.has(v.duplicate_group_id)) groups.set(v.duplicate_group_id, new Set());
    groups.get(v.duplicate_group_id)!.add(JSON.stringify(v.normalized));
  }
  if ([...groups.values()].some((s) => s.size >= 2)) {
    return { match_status: 'MISMATCH', reason_code: 'DUPLICATE_VALUE_CONFLICT', severity: 'REVIEW', reason: 'Các bản trùng của cùng chứng từ có giá trị khác nhau; không tự chọn bản chuẩn.' };
  }
  return null;
}
