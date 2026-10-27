// Lắp ráp stage S3 `map_dossier_roles` (T-S3-15). Rule-based, tất định, không gọi LLM, không log PII.
import type { MapDossierData, MapDossierStageResult } from '../contracts/check-stages';
import type { DocumentParty } from '../s2/common-schema';
import { validityByDocType as loadValidity, type DocValidityRule } from '../s4/catalog';
import { pickAnchor } from './anchor';
import { finalizeAssets } from './asset-attrs';
import { collectDescriptors, groupAssets } from './asset-group';
import { verifyByBirthCerts } from './birth-cert';
import { buildCustomer360 } from './customer360';
import { computeIdState, type IdState } from './id-check';
import { matchParties } from './match-parties';
import { buildRegistry, primaryRole } from './registry';
import { classifyRelationship, type RelationshipType } from './relationship';
import { contentPreview, stageStatus } from './status';
import { findSuperseded } from './superseded';
import type { Evidence, Person } from './types';
import { buildUnmapped } from './unmapped';

export interface MapDossierInput {
  /** Output S2 (`data.evidences`). Evidence ERROR tự bị bỏ. */
  evidences: ReadonlyArray<Evidence>;
  /** Ngày nộp hồ sơ ISO `YYYY-MM-DD` (d0 của hiệu lực, V2-R01). */
  dossier_submitted_at: string;
  now?: () => Date;
  /** Mặc định nạp từ checklist_catalog.json. */
  validityByDocType?: ReadonlyMap<string, DocValidityRule>;
}

/** Người của party chủ thể mỗi evidence (HOLDER, không có → party đầu tiên đã ghép). */
function personOfEvidence(personOf: ReadonlyMap<string, string>, evidences: ReadonlyArray<Evidence>): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of evidences) {
    const parties = [...((e.data?.parties as DocumentParty[] | undefined) ?? [])].sort((a, b) => a.party_index - b.party_index);
    const lookup = (p: DocumentParty) => {
      for (const [k, v] of personOf) if (k.startsWith(`${e.evidence_id}#${p.party_index}#`)) return v;
      return undefined;
    };
    const holder = parties.find((p) => p.party_role === 'HOLDER' && lookup(p));
    const any = holder ?? parties.find((p) => lookup(p));
    const id = any ? lookup(any) : undefined;
    if (id) out.set(e.evidence_id, id);
  }
  return out;
}

export function runMapDossier(input: MapDossierInput): MapDossierStageResult {
  const now = () => (input.now ? input.now() : new Date()).toISOString();
  const started_at = now();
  const evidences = input.evidences.filter((e) => e.status === 'SUCCESS' && e.data);
  const anchor = pickAnchor(evidences);

  // Người
  const persons: Person[] = anchor ? buildRegistry(anchor, evidences.indexOf(anchor)) : [];
  const { unmatched, personOf } = anchor ? matchParties(persons, evidences, anchor.evidence_id) : { unmatched: [], personOf: new Map<string, string>() };
  const unmapped = anchor ? buildUnmapped(unmatched, evidences, new Set(personOf.keys()), anchor.evidence_id) : [];
  const idStates = new Map<string, IdState>(persons.map((p) => [p.person_id, computeIdState(p)]));

  // Tài sản (dựng cả khi không có anchor — S3-R01)
  const assets = finalizeAssets(groupAssets(collectDescriptors(evidences)), personOf, evidences);

  // Bản bị thay thế
  const superseded = findSuperseded(evidences, personOfEvidence(personOf, evidences), assets, input.validityByDocType ?? loadValidity(), input.dossier_submitted_at);
  const supersededIds = new Set(superseded.map((s) => s.evidence_id));

  const customer_360 = anchor ? buildCustomer360(persons, idStates, assets, evidences, anchor, supersededIds) : [];

  // Quan hệ nhân thân chủ TSBĐ ↔ khách vay (S3-R20, R21)
  const relationship_verifications: MapDossierData['relationship_verifications'] = [];
  const borrower = persons.find((p) => p.roles.includes('borrower'));
  const details = (anchor?.data?.party_details as Array<{ party_index: number; relationship_to_borrower: RelationshipType | null; relationship_to_borrower_raw: string | null }> | undefined) ?? [];
  const namesOf = (p: Person) => [...new Set([p.full_name, ...p.parties.map((r) => r.party.full_name)].filter((n): n is string => Boolean(n)))];
  if (borrower && borrower.party_type === 'INDIVIDUAL') {
    for (const q of persons) {
      // Nhân thân (cha/mẹ, anh/chị/em) chỉ có nghĩa giữa hai cá nhân; chủ TSBĐ là pháp nhân hay khách vay là pháp nhân thì không xét.
      if (q.party_type !== 'INDIVIDUAL' || !q.roles.includes('collateral_owner') || q.roles.includes('borrower') || q.roles.includes('co_borrower')) continue;
      const k = q.anchor_party_by_role.collateral_owner!;
      const detail = details.find((d) => d.party_index === k);
      const anchorParty = q.parties.find((r) => r.evidence_id === anchor!.evidence_id && r.party_index === k)?.party;
      const raw = detail?.relationship_to_borrower_raw ?? anchorParty?.party_role_raw ?? null;
      const isSpouse = customer_360.find((c) => c.person_id === borrower.person_id)?.spouse_person_id === q.person_id;
      const { relationship_type, required_count } = classifyRelationship(raw, detail?.relationship_to_borrower ?? null, isSpouse);
      const usable = evidences.filter((e) => !supersededIds.has(e.evidence_id));
      const { verified_documents, verified_count } = verifyByBirthCerts(namesOf(borrower), namesOf(q), relationship_type, usable);
      relationship_verifications.push({
        subject_person_id: borrower.person_id, collateral_owner_person_id: q.person_id, relationship_type, relationship_raw: raw,
        required_count, verified_count, verified_documents: verified_documents as unknown as Array<Record<string, unknown>>,
      });
    }
  }

  const role_registry: MapDossierData['role_registry'] = persons.map((p) => {
    const s = idStates.get(p.person_id)!;
    return {
      person_id: p.person_id,
      roles: p.roles,
      primary_role: primaryRole(p.roles),
      other_role_detail: primaryRole(p.roles) === 'other' ? p.other_role_detail ?? 'unspecified' : null,
      full_name: p.full_name,
      declared_id_number: p.declared_id_number,
      current_id_number: s.current_id_number,
      historical_id_numbers: s.historical_id_numbers,
      observed_id_numbers: s.observed_id_numbers,
      id_number_check: s.id_number_check,
      id_number_sources: s.id_number_sources as unknown as Array<Record<string, unknown>>,
      role_conflict: s.role_conflict,
      role_conflict_details: s.role_conflict_details as unknown as Array<Record<string, unknown>>,
      mapped_evidences: p.mapped as unknown as Array<Record<string, unknown>>,
    };
  });

  const data: MapDossierData = {
    role_registry,
    unmapped_evidences: unmapped,
    asset_registry: assets.map((a) => ({
      ...a,
      sources: a.sources as unknown as Array<Record<string, unknown>>,
      identifier_conflicts: a.identifier_conflicts as unknown as Array<Record<string, unknown>>,
    })) as MapDossierData['asset_registry'],
    relationship_verifications,
    customer_360: customer_360 as MapDossierData['customer_360'],
    superseded_evidences: superseded,
  };
  const { status, code } = stageStatus(data, anchor !== null);
  return {
    stage_key: 'map_dossier_roles',
    status,
    status_code: code,
    message: null,
    started_at,
    finished_at: now(),
    content_preview: contentPreview(data),
    data,
    blocking_inputs: anchor ? [] : [{ type: 'DOCUMENT', key: 'loan_application', message: 'Thiếu giấy đề nghị vay vốn đọc được người vay.' }],
  };
}
