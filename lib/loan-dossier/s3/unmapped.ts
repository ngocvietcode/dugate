// Dựng `unmapped_evidences` (T-S3-05; S3-R10).
import type { DocumentParty } from '../s2/common-schema';
import type { UnmatchedParty } from './match-parties';
import { COUNTERPARTY_ROLES, type Evidence } from './types';

export interface UnmappedEvidence {
  evidence_id: string;
  file_id: string;
  file_name: string;
  doc_type_key: string;
  party_index: number | null;
  full_name: string | null;
  id_number: string | null;
  reason_code: 'NO_IDENTITY_MATCH' | 'NAME_SPELLING_DIFFERENCE' | 'NO_IDENTITY_FIELDS' | 'AMBIGUOUS_IDENTITY_MATCH';
  message: string | null;
}

/** Thông báo không chứa tên/số (đã có ở field riêng của phần tử). */
const MESSAGE: Record<UnmappedEvidence['reason_code'], string> = {
  NO_IDENTITY_MATCH: 'Người trên chứng từ không khớp người nào trong giấy đề nghị vay.',
  NAME_SPELLING_DIFFERENCE: 'Tên gần giống một người trong hồ sơ nhưng khác dấu/chính tả; cần xác nhận.',
  NO_IDENTITY_FIELDS: 'Chứng từ không có tên và số định danh đọc được.',
  AMBIGUOUS_IDENTITY_MATCH: 'Người trên chứng từ khớp nhiều người trong hồ sơ; cần xác nhận.',
};

const eligible = (p: DocumentParty) => p.party_type === 'INDIVIDUAL' && !COUNTERPARTY_ROLES.has(p.party_role);
const hasIdentity = (p: DocumentParty) => Boolean(p.full_name?.trim() || p.id_number?.trim());

/**
 * (a) evidence có party đủ điều kiện mà không party nào ghép được → mỗi party đủ điều kiện chưa ghép 1 phần tử;
 * (b) có ≥ 1 party ghép được → chỉ party chủ sở hữu hiện tại chưa ghép; (c) không party nào có tên/số → 1 phần tử
 * `party_index = null`; (d) tổ chức / bên đối tác không bao giờ sinh phần tử; (e) evidence ERROR và anchor không tham gia.
 * Thứ tự theo `evidences[]` rồi `party_index`.
 */
export function buildUnmapped(
  unmatched: ReadonlyArray<UnmatchedParty>,
  evidences: ReadonlyArray<Evidence>,
  matchedKeys: ReadonlySet<string>,
  anchorId: string | null,
): UnmappedEvidence[] {
  const out: UnmappedEvidence[] = [];
  const byEvidence = new Map<string, UnmatchedParty[]>();
  for (const u of unmatched) byEvidence.set(u.evidence_id, [...(byEvidence.get(u.evidence_id) ?? []), u]);
  for (const e of evidences) {
    if (e.status !== 'SUCCESS' || !e.data || e.evidence_id === anchorId) continue;
    const parties = (e.data.parties as DocumentParty[] | undefined) ?? [];
    if (parties.length === 0) continue;
    const base = { evidence_id: e.evidence_id, file_id: e.file_id, file_name: e.file_name, doc_type_key: e.doc_type_key };
    if (!parties.some(hasIdentity)) {
      if (parties.some(eligible)) out.push({ ...base, party_index: null, full_name: null, id_number: null, reason_code: 'NO_IDENTITY_FIELDS', message: MESSAGE.NO_IDENTITY_FIELDS });
      continue;
    }
    const anyMatched = [...matchedKeys].some((k) => k.startsWith(`${e.evidence_id}#`));
    const candidates = (byEvidence.get(e.evidence_id) ?? [])
      .filter((u) => eligible(u.party))
      .filter((u) => !anyMatched || u.party.ownership?.is_current_owner === true)
      .sort((a, b) => a.party_index - b.party_index || (a.sub_index ?? -1) - (b.sub_index ?? -1));
    for (const u of candidates) {
      // party không tên/số trong evidence có party khác có danh tính → không khớp (party_index ≠ null).
      const reason = u.reason === 'NO_IDENTITY_FIELDS' ? 'NO_IDENTITY_MATCH' : u.reason;
      out.push({
        ...base, party_index: u.party_index, full_name: u.party.full_name, id_number: u.party.id_number,
        reason_code: reason, message: MESSAGE[reason],
      });
    }
  }
  return out;
}
