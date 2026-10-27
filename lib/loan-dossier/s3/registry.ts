// Dựng role registry từ anchor (T-S3-03; S3-R02, R03, R05).
import { isOldNewPair, sameId } from '../common/id-number';
import { isNameMatch, nameLevel } from '../common/name';
import { orgNameLevel } from '../common/org-name';
import { normIdNumber } from '../common/normalize';
import type { DocumentParty } from '../s2/common-schema';
import { splitJointOwner } from './split-names';
import { confidenceOf, type Evidence, type OtherRoleDetail, type PartyRef, type Person, type Role } from './types';

const ROLE_ORDER = ['BORROWER', 'CO_BORROWER', 'COLLATERAL_OWNER', 'SPOUSE', 'REFERENCE_PERSON'];
const MAIN_ROLES: Role[] = ['borrower', 'co_borrower', 'collateral_owner'];

/** S3-R02: `party_role` → (Role, chi tiết `other`). */
export function mapRole(partyRole: string): { role: Role; detail: OtherRoleDetail | null } {
  switch (partyRole) {
    case 'BORROWER': return { role: 'borrower', detail: null };
    case 'CO_BORROWER': return { role: 'co_borrower', detail: null };
    case 'COLLATERAL_OWNER': return { role: 'collateral_owner', detail: null };
    case 'SPOUSE': return { role: 'other', detail: 'spouse' };
    case 'REFERENCE_PERSON': return { role: 'other', detail: 'reference_person' };
    default: return { role: 'other', detail: 'unspecified' };
  }
}

/** "Chính khách hàng" trên ô quan hệ của chủ TSBĐ (S3-R03 (4)). */
const SELF_PATTERNS = [/khách\s*hàng\s*vay/iu, /chính\s*chủ/iu, /bản\s*thân/iu, /chính\s*khách\s*hàng/iu];
export const isSelfRelationship = (raw: string | null | undefined) => Boolean(raw && SELF_PATTERNS.some((r) => r.test(raw.normalize('NFC'))));

const hasName = (p: DocumentParty) => Boolean(p.full_name?.trim());
const hasId = (p: DocumentParty) => normIdNumber(p.id_number) !== null;
const taxIdOf = (p: DocumentParty) => normIdNumber(p.tax_id);
const isOrg = (p: DocumentParty) => p.party_type === 'ORGANIZATION';

export interface PartyDetailLike { party_index: number; relationship_to_borrower_raw?: string | null }

/** Party anchor đã tách tên ghép, theo thứ tự duyệt S3-R05. */
export function anchorParties(anchor: Evidence, order: number): PartyRef[] {
  const parties = (anchor.data?.parties as DocumentParty[] | undefined) ?? [];
  const rank = (role: string) => { const i = ROLE_ORDER.indexOf(role); return i < 0 ? ROLE_ORDER.length : i; };
  return [...parties]
    .sort((a, b) => rank(a.party_role) - rank(b.party_role) || a.party_index - b.party_index)
    .flatMap((p) => {
      const parts = splitJointOwner(p);
      return parts.map((party, i) => ({
        evidence_id: anchor.evidence_id, evidence_order: order, doc_type_key: anchor.doc_type_key,
        party_index: p.party_index, sub_index: parts.length > 1 ? i : null, party, confidence: confidenceOf(anchor, 'parties'),
      }));
    });
}

/**
 * So 2 party trong anchor theo S3-R03 (1)–(3). Cá nhân và pháp nhân không bao giờ là cùng một chủ thể.
 * Hai pháp nhân: cùng mã số thuế → cùng; khác mã số thuế (cả hai có) → khác; không có mã → tên pháp nhân (bỏ loại hình) phải trùng.
 */
function sameAnchorPerson(a: DocumentParty, b: DocumentParty): { same: boolean; spelling: boolean } {
  if (isOrg(a) !== isOrg(b)) return { same: false, spelling: false };
  if (isOrg(a)) {
    const ta = taxIdOf(a); const tb = taxIdOf(b);
    if (ta && tb) return { same: ta === tb, spelling: false };
    const level = orgNameLevel(a.full_name, b.full_name);
    return { same: level === 'EXACT', spelling: level === 'SPELLING_DIFFERENCE' };
  }
  if (hasId(a) && hasId(b)) {
    if (sameId(a.id_number, b.id_number)) return { same: true, spelling: false };
    if (!isOldNewPair(a.id_number, b.id_number)) return { same: false, spelling: false };
  }
  const level = nameLevel(a.full_name, b.full_name);
  if (isNameMatch(level)) return { same: true, spelling: false };
  return { same: false, spelling: level === 'SPELLING_DIFFERENCE' };
}

const ROLE_SORT: Role[] = ['borrower', 'co_borrower', 'collateral_owner', 'other'];

function primaryRole(roles: Role[]): Role {
  return MAIN_ROLES.find((r) => roles.includes(r)) ?? 'other';
}

/**
 * Duyệt party anchor theo thứ tự vai trò, gộp party là cùng người (S3-R03), sinh `person-n` (S3-R05).
 * Party không tên, không số bị bỏ — trừ chủ TSBĐ ghi quan hệ "chính khách hàng" (gộp vào borrower).
 */
export function buildRegistry(anchor: Evidence, order = 0): Person[] {
  const details = (anchor.data?.party_details as PartyDetailLike[] | undefined) ?? [];
  const relationRaw = (idx: number) => details.find((d) => d.party_index === idx)?.relationship_to_borrower_raw ?? null;
  const persons: Person[] = [];

  const addRole = (p: Person, ref: PartyRef) => {
    const { role, detail } = mapRole(ref.party.party_role);
    if (!p.roles.includes(role)) p.roles.push(role);
    if (role === 'other' && p.other_role_detail === null) p.other_role_detail = detail;
    p.anchor_party_by_role[role] ??= ref.party_index;
    if (!p.anchor_party_indexes.includes(ref.party_index)) p.anchor_party_indexes.push(ref.party_index);
  };
  const attach = (p: Person, ref: PartyRef, warnings: string[]) => {
    addRole(p, ref);
    p.parties.push(ref);
    for (const id of [ref.party.id_number, ...ref.party.previous_id_numbers]) {
      const n = normIdNumber(id);
      if (n) p.known_ids.add(n);
    }
    const tax = taxIdOf(ref.party);
    if (tax && isOrg(ref.party)) p.known_tax_ids.add(tax);
    p.declared_id_number ??= normIdNumber(ref.party.id_number);
    p.full_name ??= ref.party.full_name?.trim() || null;
    p.mapped.push({
      evidence_id: ref.evidence_id, doc_type_key: ref.doc_type_key, party_index: ref.party_index, sub_index: ref.sub_index,
      party_role: ref.party.party_role, matched_by: 'ANCHOR', match_confidence: ref.confidence, name_level: null, warnings,
    });
  };

  for (const ref of anchorParties(anchor, order)) {
    const x = ref.party;
    if (!hasName(x) && !hasId(x) && !(isOrg(x) && taxIdOf(x))) {
      const borrower = persons.find((p) => p.roles.includes('borrower'));
      if (x.party_role === 'COLLATERAL_OWNER' && borrower && isSelfRelationship(relationRaw(ref.party_index))) attach(borrower, ref, []);
      continue;
    }
    const warnings: string[] = [];
    let target: Person | null = null;
    for (const p of persons) {
      const verdicts = p.parties.filter((r) => r.evidence_id === anchor.evidence_id).map((r) => sameAnchorPerson(x, r.party));
      if (verdicts.some((v) => v.same)) { target ??= p; continue; }
      if (verdicts.some((v) => v.spelling)) {
        warnings.push('NAME_SPELLING_DIFFERENCE');
        for (const m of p.mapped) if (!m.warnings.includes('NAME_SPELLING_DIFFERENCE')) m.warnings.push('NAME_SPELLING_DIFFERENCE');
      }
    }
    if (!target) {
      target = {
        person_id: `person-${persons.length + 1}`, party_type: isOrg(x) ? 'ORGANIZATION' : 'INDIVIDUAL', roles: [], other_role_detail: null,
        full_name: null, declared_id_number: null, known_ids: new Set(), known_tax_ids: new Set(), parties: [], mapped: [],
        anchor_party_by_role: {}, anchor_party_indexes: [],
      };
      persons.push(target);
    }
    attach(target, ref, [...new Set(warnings)]);
  }

  // S3-R02: có vai trò chính thì không giữ `other`.
  for (const p of persons) {
    if (p.roles.some((r) => r !== 'other')) {
      p.roles = p.roles.filter((r) => r !== 'other');
      p.other_role_detail = null;
    }
    p.roles.sort((a, b) => ROLE_SORT.indexOf(a) - ROLE_SORT.indexOf(b));
  }
  return persons;
}

export { primaryRole };
