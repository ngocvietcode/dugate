// Customer 360 (T-S3-12; S3-R22). Bản bị thay thế (S3-R27) không làm nguồn.
import { isNameMatch, nameLevel } from '../common/name';
import { normIdNumber } from '../common/normalize';
import type { Address, DocumentParty } from '../s2/common-schema';
import type { AssetRegistryEntry } from './asset-attrs';
import type { IdState } from './id-check';
import { partyKey, type Evidence, type PartyRef, type Person, type Role } from './types';

/** Thông tin pháp nhân (chỉ có ở người `party_type = ORGANIZATION`). Khóa danh tính là mã số thuế / số đăng ký, không phải tên. */
export interface OrganizationInfo {
  tax_id: string | null;
  registration_number: string | null;
  headquarters_address: Address | null;
  representative_name: string | null;
  representative_position: string | null;
  /** Người đại diện đã gom được trong registry (cá nhân, khớp theo tên); null khi không có hoặc khớp nhiều người. */
  representative_person_id: string | null;
}

export interface Customer360Entry {
  person_id: string;
  roles: Role[];
  identity: {
    full_name: string | null;
    id_number: string | null;
    date_of_birth: string | null;
    gender: string | null;
    permanent_address: Address | null;
    current_address: Address | null;
  };
  marital_status: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | null;
  spouse_person_id: string | null;
  business: Record<string, unknown> | null;
  owned_asset_ids: string[];
  /** Chỉ khi là pháp nhân. Vắng mặt với cá nhân để output của HKD không đổi. */
  organization?: OrganizationInfo;
}

const issueDate = (e: Evidence | undefined) => (e?.data?.legal_info as { issue_date?: string | null } | null | undefined)?.issue_date ?? null;
const newestFirst = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Thông tin pháp nhân từ các party đã gom (anchor ưu tiên) và mục `fields` của giấy đăng ký doanh nghiệp. Số định danh của người đại diện
 * không được suy ra từ tên công ty; chỉ nối `representative_person_id` khi đúng MỘT cá nhân trong registry khớp tên người đại diện.
 */
function organizationOf(
  p: Person, persons: ReadonlyArray<Person>, byId: ReadonlyMap<string, Evidence>, usable: (r: PartyRef) => boolean, anchor: Evidence | null,
): OrganizationInfo {
  const refs = p.parties.filter(usable).sort((a, b) => Number(b.evidence_id === anchor?.evidence_id) - Number(a.evidence_id === anchor?.evidence_id) || a.evidence_order - b.evidence_order);
  const firstOf = <T>(pick: (party: DocumentParty) => T | null): T | null => {
    for (const r of refs) { const v = pick(r.party); if (v !== null && v !== undefined) return v; }
    return null;
  };
  const tax = firstOf((x) => normIdNumber(x.tax_id));
  const fieldOf = (key: string): unknown => {
    for (const r of refs) {
      const fields = byId.get(r.evidence_id)?.data?.fields as Record<string, unknown> | undefined;
      if (fields && fields[key] !== null && fields[key] !== undefined) return fields[key];
    }
    return null;
  };
  const repName = firstOf((x) => text(x.representative_name));
  const repPosition = firstOf((x) => text(x.representative_position));
  const matches = repName
    ? persons.filter((q) => q.party_type === 'INDIVIDUAL' && q.person_id !== p.person_id
      && [q.full_name, ...q.parties.map((r) => r.party.full_name)].some((n) => isNameMatch(nameLevel(repName, n))))
    : [];
  return {
    tax_id: tax,
    registration_number: text(fieldOf('registration_number')),
    headquarters_address: (fieldOf('headquarters_address') as Address | null) ?? null,
    representative_name: repName,
    representative_position: repPosition,
    representative_person_id: matches.length === 1 ? matches[0].person_id : null,
  };
}

export function buildCustomer360(
  persons: ReadonlyArray<Person>,
  idStates: ReadonlyMap<string, IdState>,
  assets: ReadonlyArray<AssetRegistryEntry>,
  evidences: ReadonlyArray<Evidence>,
  anchor: Evidence | null,
  superseded: ReadonlySet<string>,
): Customer360Entry[] {
  const byId = new Map(evidences.map((e) => [e.evidence_id, e]));
  const usable = (r: PartyRef) => !superseded.has(r.evidence_id);
  const anchorParty = (p: Person) => p.parties.find((r) => r.evidence_id === anchor?.evidence_id);
  const details = (anchor?.data?.party_details as Array<{ party_index: number; marital_status: Customer360Entry['marital_status'] }> | undefined) ?? [];

  /** Party nguồn số hiện tại: party giấy tờ định danh có id_number = số hiện tại. */
  const currentSource = (p: Person): PartyRef | undefined => {
    const current = idStates.get(p.person_id)?.current_id_number;
    return current ? p.parties.find((r) => usable(r) && r.party.id_number?.replace(/\D/g, '') === current) : undefined;
  };

  // vợ/chồng: cặp HUSBAND/WIFE trên cùng giấy đăng ký kết hôn
  const personOfKey = new Map<string, string>();
  for (const p of persons) for (const r of p.parties) personOfKey.set(partyKey(r), p.person_id);
  const spouseFromCert = new Map<string, string>();
  for (const e of evidences) {
    if (e.status !== 'SUCCESS' || e.doc_type_key !== 'marriage_certificate' || superseded.has(e.evidence_id)) continue;
    const parties = (e.data?.parties as DocumentParty[] | undefined) ?? [];
    const who = (role: string) => {
      const party = parties.find((x) => x.party_role === role);
      return party ? personOfKey.get(partyKey({ evidence_id: e.evidence_id, party_index: party.party_index, sub_index: null })) : undefined;
    };
    const h = who('HUSBAND'); const w = who('WIFE');
    if (h && w && h !== w) { spouseFromCert.set(h, w); spouseFromCert.set(w, h); }
  }
  // người từ party SPOUSE của anchor là vợ/chồng của khách vay chính. Khách vay là pháp nhân thì không có vợ/chồng
  // (người trong party SPOUSE là của người đại diện / chủ sở hữu, chưa đủ căn cứ để nối) → không gán.
  const borrower = persons.find((p) => p.roles.includes('borrower'));
  const individualBorrower = borrower && borrower.party_type === 'INDIVIDUAL' ? borrower : undefined;
  const spouseFromAnchor = persons.find((p) => anchor && p.parties.some((r) => r.evidence_id === anchor.evidence_id && r.party.party_role === 'SPOUSE'));

  return persons.map((p) => {
    const state = idStates.get(p.person_id);
    const src = currentSource(p);
    const anc = anchorParty(p);
    const pick = <T>(f: (party: DocumentParty) => T | null): T | null => {
      const v1 = src ? f(src.party) : null;
      if (v1 !== null && v1 !== undefined) return v1;
      return anc ? f(anc.party) ?? null : null;
    };
    const holders = p.parties
      .filter((r) => usable(r) && r.party.party_role === 'HOLDER')
      .sort((a, b) => newestFirst(issueDate(byId.get(a.evidence_id)), issueDate(byId.get(b.evidence_id))) || a.evidence_order - b.evidence_order);
    const address = (k: 'permanent_address' | 'current_address'): Address | null =>
      holders.map((r) => r.party[k]).find((v) => v !== null) ?? pick((x) => x[k]);

    // marital_status: HOLDER mới nhất có data.marital_status → MARRIED nếu là HUSBAND/WIFE → anchor party_details → null
    let marital: Customer360Entry['marital_status'] = null;
    for (const r of holders) {
      const ms = byId.get(r.evidence_id)?.data?.marital_status as Customer360Entry['marital_status'] | undefined;
      if (ms) { marital = ms; break; }
    }
    if (!marital && p.parties.some((r) => usable(r) && (r.party.party_role === 'HUSBAND' || r.party.party_role === 'WIFE'))) marital = 'MARRIED';
    if (!marital) {
      for (const idx of p.anchor_party_indexes) {
        const ms = details.find((d) => d.party_index === idx)?.marital_status ?? null;
        if (ms) { marital = ms; break; }
      }
    }

    let spouse = spouseFromCert.get(p.person_id) ?? null;
    if (!spouse && spouseFromAnchor && individualBorrower && spouseFromAnchor.person_id !== individualBorrower.person_id && spouseFromAnchor.party_type === 'INDIVIDUAL') {
      if (p.person_id === individualBorrower.person_id) spouse = spouseFromAnchor.person_id;
      else if (p.person_id === spouseFromAnchor.person_id) spouse = individualBorrower.person_id;
    }

    let business: Record<string, unknown> | null = null;
    if (p.roles.includes('borrower') || p.roles.includes('co_borrower')) {
      if (p.roles.includes('borrower') && anchor?.data?.business_info) business = anchor.data.business_info as Record<string, unknown>;
      if (!business) {
        const withBiz = p.parties
          .filter(usable)
          .map((r) => byId.get(r.evidence_id))
          .find((e) => e?.data?.business_info);
        business = (withBiz?.data?.business_info as Record<string, unknown> | undefined) ?? null;
      }
    }

    return {
      person_id: p.person_id,
      roles: p.roles,
      identity: {
        full_name: p.full_name,
        id_number: state?.current_id_number ?? p.declared_id_number,
        date_of_birth: pick((x) => x.date_of_birth),
        gender: pick((x) => x.gender),
        permanent_address: address('permanent_address'),
        current_address: address('current_address'),
      },
      marital_status: marital,
      spouse_person_id: spouse,
      business,
      owned_asset_ids: assets.filter((a) => a.current_owner_person_ids.includes(p.person_id)).map((a) => a.asset_id),
      ...(p.party_type === 'ORGANIZATION' ? { organization: organizationOf(p, persons, byId, usable, anchor) } : {}),
    };
  });
}
