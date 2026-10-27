// Trạng thái stage + content_preview (T-S3-13; S3 §4, S3-R25) và kiểm tra nhất quán output (T-S3-14; S3 §2).
import type { MapDossierData } from '../contracts/check-stages';

export function stageStatus(data: MapDossierData, hasAnchor: boolean): { status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'INSUFFICIENT_DATA'; code: string } {
  if (!hasAnchor) return { status: 'INSUFFICIENT_DATA', code: 'LOAN_APPLICATION_MISSING' };
  if (data.role_registry.some((p) => p.role_conflict)) return { status: 'PARTIAL_SUCCESS', code: 'ROLE_CONFLICT_PRESENT' };
  if (data.unmapped_evidences.length > 0) return { status: 'PARTIAL_SUCCESS', code: 'UNMAPPED_DOCUMENTS_PRESENT' };
  if (data.asset_registry.some((a) => a.context_status !== 'CONFIRMED')) return { status: 'PARTIAL_SUCCESS', code: 'ASSET_CONTEXT_UNRESOLVED' };
  return { status: 'SUCCESS', code: 'COMPLETED' };
}

export function contentPreview(data: MapDossierData) {
  return {
    person_count: data.role_registry.length,
    mapped_evidence_count: new Set(data.role_registry.flatMap((p) => p.mapped_evidences.map((m) => m.evidence_id as string))).size,
    unmapped_party_count: data.unmapped_evidences.length,
    role_conflict_count: data.role_registry.filter((p) => p.role_conflict).length,
    id_review_count: data.role_registry.filter((p) => p.id_number_check.requires_review).length,
    asset_count: data.asset_registry.length,
    unconfirmed_asset_count: data.asset_registry.filter((a) => a.context_status !== 'CONFIRMED').length,
    relationship_verification_count: data.relationship_verifications.length,
  };
}

/** Vi phạm ràng buộc nhất quán của S3 §2 (rỗng = tốt). `successIds`: evidence SUCCESS của input. */
export function checkInvariants(data: MapDossierData, successIds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const persons = new Set(data.role_registry.map((p) => p.person_id));
  const assets = new Set(data.asset_registry.map((a) => a.asset_id));
  const refPerson = (where: string, id: string | null) => { if (id !== null && !persons.has(id)) out.push(`${where}: ${id} không tồn tại`); };
  const refAsset = (where: string, id: string | null) => { if (id !== null && !assets.has(id)) out.push(`${where}: ${id} không tồn tại`); };

  data.asset_registry.forEach((a) => [...a.owner_person_ids, ...a.current_owner_person_ids].forEach((id) => refPerson(`asset_registry.${a.asset_id}`, id)));
  data.relationship_verifications.forEach((r, i) => {
    refPerson(`relationship_verifications.${i}`, r.subject_person_id);
    refPerson(`relationship_verifications.${i}`, r.collateral_owner_person_id);
    if (r.verified_count !== r.verified_documents.length) out.push(`relationship_verifications.${i}: verified_count ≠ verified_documents.length`);
  });
  data.customer_360.forEach((c, i) => {
    if (data.role_registry[i]?.person_id !== c.person_id) out.push(`customer_360.${i}: person_id lệch thứ tự role_registry`);
    refPerson(`customer_360.${i}.spouse_person_id`, c.spouse_person_id);
    c.owned_asset_ids.forEach((id) => refAsset(`customer_360.${i}.owned_asset_ids`, id));
    if (c.organization) {
      refPerson(`customer_360.${i}.organization.representative_person_id`, c.organization.representative_person_id);
      if (c.spouse_person_id !== null) out.push(`customer_360.${i}: pháp nhân không có vợ/chồng`);
    }
  });
  if (data.customer_360.length !== data.role_registry.length) out.push('customer_360 khác số phần tử role_registry');
  data.role_registry.forEach((p) => {
    const observed = new Set(p.observed_id_numbers);
    for (const n of [...p.historical_id_numbers, ...(p.current_id_number ? [p.current_id_number] : [])]) {
      if (!observed.has(n)) out.push(`role_registry.${p.person_id}: observed thiếu ${'*'.repeat(3)}`);
    }
  });
  const seen = new Set<string>();
  const mark = (k: string, where: string) => { if (seen.has(k)) out.push(`${where}: (evidence, party) xuất hiện > 1 lần`); seen.add(k); };
  data.role_registry.forEach((p) => p.mapped_evidences.forEach((m) => mark(`${m.evidence_id}#${m.party_index}#${m.sub_index ?? '-'}`, `mapped.${p.person_id}`)));
  data.unmapped_evidences.forEach((u) => mark(`${u.evidence_id}#${u.party_index ?? 'null'}#-`, 'unmapped'));
  const supersededIds = new Set(data.superseded_evidences.map((s) => s.evidence_id));
  data.superseded_evidences.forEach((s) => {
    if (!successIds.has(s.evidence_id)) out.push(`superseded ${s.evidence_id}: không phải evidence SUCCESS`);
    if (s.superseded_by_evidence_ids.some((id) => id === s.evidence_id || supersededIds.has(id))) out.push(`superseded ${s.evidence_id}: bản thay thế không hợp lệ`);
    refPerson(`superseded ${s.evidence_id}`, s.person_id);
    refAsset(`superseded ${s.evidence_id}`, s.asset_id);
  });
  return out;
}
