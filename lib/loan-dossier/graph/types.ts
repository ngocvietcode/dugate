// Kiểu của DossierGraph: người / tài sản / chứng từ là node, mọi quan hệ là cạnh (lib/loan-dossier/graph).
// Mỗi thuộc tính của người hoặc tài sản chỉ nằm ở MỘT node; các mảng id chéo của S3 (owned_asset_ids,
// owner_person_ids, spouse_person_id, mapped_evidences…) là cạnh và được suy ra khi chiếu.
import type { MultiDirectedGraph } from 'graphology';

import type { MapDossierData } from '../contracts/check-stages';

type RoleRegistryEntry = MapDossierData['role_registry'][number];
type Customer360Entry = MapDossierData['customer_360'][number];
type AssetRegistryEntry = MapDossierData['asset_registry'][number];
type RelationshipVerification = MapDossierData['relationship_verifications'][number];
type SupersededEvidence = MapDossierData['superseded_evidences'][number];
type UnmappedEvidence = MapDossierData['unmapped_evidences'][number];
/** Thông tin pháp nhân KHÔNG kèm epresentative_person_id: quan hệ đại diện là cạnh LEGAL_REP_OF, không lưu hai chỗ. */
export type OrganizationAttrs = Omit<NonNullable<Customer360Entry['organization']>, 'representative_person_id'>;

/** `seq`: thứ tự trong mảng gốc, để chiếu lại đúng thứ tự (S3 tất định theo thứ tự này). */
export interface PersonNode {
  kind: 'person';
  seq: number;
  /** `roles` chỉ lưu một lần (S3 ghi ở cả role_registry và customer_360). */
  roles: RoleRegistryEntry['roles'];
  registry: Omit<RoleRegistryEntry, 'person_id' | 'roles' | 'mapped_evidences'>;
  identity: Customer360Entry['identity'];
  marital_status: Customer360Entry['marital_status'];
  business: Customer360Entry['business'];
  /** Chỉ khi là pháp nhân (SME); null với cá nhân. */
  organization: OrganizationAttrs | null;
}

export interface AssetNode {
  kind: 'asset';
  seq: number;
  attrs: Omit<AssetRegistryEntry, 'asset_id' | 'owner_person_ids' | 'current_owner_person_ids' | 'sources'>;
}

export interface EvidenceNode {
  kind: 'evidence';
  /** Có khi evidence là bản bị thay thế (S3-R27); `superseded_by` là cạnh SUPERSEDED_BY. */
  superseded: (Omit<SupersededEvidence, 'evidence_id' | 'superseded_by_evidence_ids'> & { seq: number }) | null;
}

export interface UnmappedNode {
  kind: 'unmapped';
  seq: number;
  entry: Omit<UnmappedEvidence, 'evidence_id'>;
}

export type DossierNode = PersonNode | AssetNode | EvidenceNode | UnmappedNode;

/** person|asset → evidence. `entry` là phần tử `mapped_evidences[]` / `sources[]` nguyên bản. */
export interface MentionedInEdge { type: 'MENTIONED_IN'; seq: number; entry: Record<string, unknown> }
/** person → asset. Một cạnh cho mỗi cặp; vị trí trong `owner_person_ids` / `current_owner_person_ids` (null = không thuộc). */
export interface OwnsEdge { type: 'OWNS'; ownerSeq: number | null; currentSeq: number | null }
/** person → person (theo Customer 360). Có hướng để giữ nguyên `spouse_person_id` từng người. */
export interface SpouseOfEdge { type: 'SPOUSE_OF' }
/** khách vay → chủ TSBĐ (S3-R20). */
export interface RelativeOfEdge { type: 'RELATIVE_OF'; seq: number; detail: Omit<RelationshipVerification, 'subject_person_id' | 'collateral_owner_person_id'> }
/** người đại diện → pháp nhân (customer_360[].organization.representative_person_id). Chỉ khi gom được đúng một cá nhân. */
export interface LegalRepOfEdge { type: 'LEGAL_REP_OF' }
/** evidence bị thay thế → evidence thay thế. `seq` = vị trí trong `superseded_by_evidence_ids`. */
export interface SupersededByEdge { type: 'SUPERSEDED_BY'; seq: number }
/** unmapped → evidence chứa party chưa ghép được. */
export interface UnmappedInEdge { type: 'UNMAPPED_IN' }

export type DossierEdge = MentionedInEdge | OwnsEdge | SpouseOfEdge | RelativeOfEdge | LegalRepOfEdge | SupersededByEdge | UnmappedInEdge;

export type DossierGraph = MultiDirectedGraph<DossierNode, DossierEdge>;
