// Tách chủ sở hữu ghép (T-S3-02; S3-R04).
import type { DocumentParty } from '../s2/common-schema';

const SEPARATOR = /\s+(?:VÀ|CÙNG)\s+|\s*[&,;]\s*/giu;

/**
 * `full_name` chứa ` VÀ `, ` & `, `,`, `;`, ` CÙNG ` và **mọi** đoạn ≥ 2 từ → tách thành party con theo thứ tự;
 * con giữ `party_index`, `party_role`, `party_role_raw`, `party_type` của gốc, `id_number = null` và các field
 * định danh cá nhân khác về null (thuộc về ai không xác định). Không tách → trả `[party]`.
 */
export function splitJointOwner(party: DocumentParty): DocumentParty[] {
  const name = party.full_name;
  if (!name) return [party];
  const parts = name.normalize('NFC').split(SEPARATOR).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2 || parts.some((s) => s.split(/\s+/).length < 2)) return [party];
  return parts.map((full_name) => ({
    ...party,
    full_name,
    id_number: null,
    id_issue_date: null,
    id_issue_place: null,
    previous_id_numbers: [],
    date_of_birth: null,
    gender: null,
  }));
}
