// Kiểu dùng chung của S3 `map_dossier_roles`. Hàm S3 đều thuần, tất định, không log PII (S3-R26).
import type { NameLevel } from '../common/name';
import type { DocumentParty, EvidenceEnvelope } from '../s2/common-schema';

export type Evidence = EvidenceEnvelope;
export type Role = 'borrower' | 'co_borrower' | 'collateral_owner' | 'other';
export type OtherRoleDetail = 'spouse' | 'reference_person' | 'guarantor' | 'unspecified';
export type MatchedBy = 'ANCHOR' | 'ID_NUMBER' | 'FULL_NAME';

export const ID_DOC_TYPES: ReadonlySet<string> = new Set(['id_card', 'vneid', 'qr_code_info']);
export const COUNTERPARTY_ROLES: ReadonlySet<string> = new Set(['SELLER', 'EMPLOYER', 'LENDER']);

/** Một party (có thể là party con sau khi tách chủ sở hữu ghép — S3-R04) kèm vị trí nguồn. */
export interface PartyRef {
  evidence_id: string;
  /** Vị trí evidence trong `evidences[]` — dùng để sắp tất định. */
  evidence_order: number;
  doc_type_key: string;
  party_index: number;
  /** Thứ tự party con khi tách tên ghép; null = party gốc không tách. */
  sub_index: number | null;
  party: DocumentParty;
  /** `field_confidences.parties` của evidence. */
  confidence: number;
}

/** Phần tử `role_registry[].mapped_evidences[]`. */
export interface MappedEvidence {
  evidence_id: string;
  doc_type_key: string;
  party_index: number;
  sub_index: number | null;
  party_role: string;
  matched_by: MatchedBy;
  match_confidence: number;
  name_level: NameLevel | null;
  warnings: string[];
}

/** Người trong registry trong lúc dựng (trước khi xuất `RoleRegistryEntry`). */
export interface Person {
  person_id: string;
  /** Cá nhân hay pháp nhân (doanh nghiệp). Quyết định luật khớp: số định danh + tên người, hay mã số thuế + tên pháp nhân. */
  party_type: 'INDIVIDUAL' | 'ORGANIZATION';
  roles: Role[];
  other_role_detail: OtherRoleDetail | null;
  full_name: string | null;
  declared_id_number: string | null;
  /** `K(p)`: mọi số định danh đã biết (đã chuẩn hóa). */
  known_ids: Set<string>;
  /** Mã số thuế đã biết (chỉ chữ số). Chỉ pháp nhân dùng; cá nhân luôn rỗng. */
  known_tax_ids: Set<string>;
  /** Mọi party đã ghép vào người này (anchor + chứng từ khác), theo thứ tự ghép. */
  parties: PartyRef[];
  mapped: MappedEvidence[];
  /** party_index của party anchor theo vai trò (để tra `party_details`). */
  anchor_party_by_role: Partial<Record<Role, number>>;
  /** party_index của mọi party anchor đã gộp vào người này. */
  anchor_party_indexes: number[];
}

export const partyKey = (r: Pick<PartyRef, 'evidence_id' | 'party_index' | 'sub_index'>) =>
  `${r.evidence_id}#${r.party_index}#${r.sub_index ?? '-'}`;

export const confidenceOf = (e: Evidence, field: string) => e.field_confidences[field] ?? 0;
