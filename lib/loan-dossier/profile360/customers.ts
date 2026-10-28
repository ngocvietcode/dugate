// Khách hàng của hồ sơ (D-114): mọi người / pháp nhân S3 đã gom, xếp theo vai trò (người vay → đồng vay → chủ TSBĐ → khác), định danh
// do S3 chọn dẫn về fact LAC, quan hệ nhân thân, cờ của S3 và chi tiết còn lại từ LAC. Hàm thuần, tất định.
import { normIdNumber } from '../common/normalize';
import type { MapDossierData } from '../contracts/check-stages';
import type { Address } from '../s2/common-schema';
import type { LacFact } from '../context/schema';
import type { Customer, ProfileField } from './schema';
import { detailsOf, normText, type Lookup } from './sources';

const IDENTITY_FIELDS = new Set([
  'parties[].full_name', 'parties[].id_number', 'parties[].date_of_birth', 'parties[].previous_id_numbers[]', 'parties[].tax_id',
  'parties[].permanent_address.full_text', 'parties[].current_address.full_text',
]);
const addressText = (a: Address | null | undefined): string | null =>
  a ? (a.full_text?.trim() || [a.street, a.ward, a.district, a.province].filter((x) => x && x.trim()).join(', ') || null) : null;
const ROLE_RANK = ['borrower', 'co_borrower', 'collateral_owner'];
const rankOf = (roles: readonly string[]) => Math.min(...roles.map((r) => { const i = ROLE_RANK.indexOf(r.split(':')[0]); return i < 0 ? ROLE_RANK.length : i; }), ROLE_RANK.length);

/** Giá trị S3 đã chọn (`customer_360.identity`), dẫn về các fact cùng giá trị sau chuẩn hóa. */
function fromS3(chosen: string | null, facts: readonly LacFact[], norm: (v: string) => string | null): ProfileField {
  if (chosen === null) return { value: null, fact_ids: [], trust: null, review: null };
  const target = norm(chosen);
  const same = facts.filter((f) => norm(String(f.value)) === target);
  return {
    value: chosen,
    fact_ids: same.map((f) => f.fact_id),
    trust: same[0]?.trust ?? null,
    review: same.length > 0 && same.every((f) => f.review === 'ACCEPTED') ? 'ACCEPTED' : 'REVIEW',
  };
}

function relationsOf(s3: MapDossierData, personId: string): Customer['relations'] {
  const out: Customer['relations'] = [];
  const c360 = s3.customer_360.find((c) => c.person_id === personId);
  if (c360?.spouse_person_id) out.push({ type: 'SPOUSE_OF', person_id: c360.spouse_person_id, verification: 'NOT_REQUIRED', detail: null });
  for (const r of s3.relationship_verifications) {
    const other = r.subject_person_id === personId ? r.collateral_owner_person_id : r.collateral_owner_person_id === personId ? r.subject_person_id : null;
    if (!other) continue;
    const verification = r.required_count === null ? 'NOT_REQUIRED' : r.verified_count >= r.required_count ? 'VERIFIED' : r.verified_count > 0 ? 'PARTIAL' : 'UNVERIFIED';
    const detail = [r.relationship_type, r.required_count !== null ? `giấy khai sinh ${r.verified_count}/${r.required_count}` : null].filter(Boolean).join(' · ') || null;
    out.push({ type: 'RELATIVE_OF', person_id: other, verification, detail });
  }
  // Người đại diện theo pháp luật chỉ nối theo tên (customer360.ts `organizationOf`): PARTIAL cho tới khi bóc được CCCD (T-360-09).
  if (c360?.organization?.representative_person_id) out.push({ type: 'REPRESENTED_BY', person_id: c360.organization.representative_person_id, verification: 'PARTIAL', detail: null });
  for (const org of s3.customer_360) {
    if (org.organization?.representative_person_id === personId) out.push({ type: 'LEGAL_REP_OF', person_id: org.person_id, verification: 'PARTIAL', detail: null });
  }
  return out;
}

export function buildCustomers(lookup: Lookup, s3: MapDossierData | null): Customer[] {
  if (!s3) return [];
  const { lac } = lookup;
  const subjects = new Map(lac.subjects.map((s) => [s.subject_id, s]));
  const c360 = new Map(s3.customer_360.map((c) => [c.person_id, c]));
  const factsOf = (personId: string, field: string) => lac.facts.filter((f) => f.subject_id === personId && f.field === field && !f.hidden && f.trust !== 'SUPERSEDED');
  return s3.role_registry
    .map((p, order) => ({ p, order }))
    .sort((a, b) => rankOf(subjects.get(a.p.person_id)?.roles ?? a.p.roles) - rankOf(subjects.get(b.p.person_id)?.roles ?? b.p.roles) || a.order - b.order)
    .map(({ p }) => {
      const entry = c360.get(p.person_id);
      const subject = subjects.get(p.person_id);
      return {
        person_id: p.person_id,
        party_type: entry?.organization ? 'ORGANIZATION' : 'INDIVIDUAL',
        roles: subject?.roles ?? [...p.roles],
        full_name: fromS3(entry?.identity.full_name ?? p.full_name ?? null, factsOf(p.person_id, 'parties[].full_name'), normText),
        id_number: fromS3(entry?.identity.id_number ?? null, factsOf(p.person_id, 'parties[].id_number'), normIdNumber),
        date_of_birth: fromS3(entry?.identity.date_of_birth ?? null, factsOf(p.person_id, 'parties[].date_of_birth'), (v) => v),
        historical_id_numbers: [...p.historical_id_numbers],
        permanent_address: addressText(entry?.identity.permanent_address),
        current_address: addressText(entry?.identity.current_address),
        marital_status: entry?.organization ? null : entry?.marital_status ?? null,
        organization: entry?.organization ? {
          tax_id: entry.organization.tax_id,
          registration_number: entry.organization.registration_number,
          headquarters_address: addressText(entry.organization.headquarters_address) ?? addressText(entry.identity.permanent_address),
          representative_position: entry.organization.representative_position,
        } : null,
        relations: relationsOf(s3, p.person_id),
        flags: [...(subject?.flags ?? [])],
        documents: [...(subject?.mentioned_in ?? [])],
        details: detailsOf(lac, p.person_id, IDENTITY_FIELDS),
      } satisfies Customer;
    });
}
