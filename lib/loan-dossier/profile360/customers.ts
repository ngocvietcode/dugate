// Khách hàng của hồ sơ (D-114): mọi người / pháp nhân S3 đã gom, xếp theo vai trò (người vay → đồng vay → chủ TSBĐ → khác), định danh
// do S3 chọn dẫn về fact LAC, quan hệ nhân thân, cờ của S3 và chi tiết còn lại từ LAC. Hàm thuần, tất định.
import { normIdNumber } from '../common/normalize';
import type { MapDossierData } from '../contracts/check-stages';
import type { Address, DocumentParty } from '../s2/common-schema';
import type { LacFact } from '../context/schema';
import type { Customer, IdentityDocument, ProfileField } from './schema';
import { detailsOf, normText, text, valueAt, type Lookup } from './sources';

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

const ID_DOC_TYPES = new Set(['id_card', 'vneid', 'qr_code_info']);

/** Giấy tờ định danh của mỗi người (L360-G08): party HOLDER của CCCD / VNeID / QR, hết hạn so với ngày nộp hồ sơ. */
function identityDocuments(lookup: Lookup, asOf: string | null): Map<string, IdentityDocument[]> {
  const out = new Map<string, IdentityDocument[]>();
  for (const e of lookup.evidences) {
    if (!ID_DOC_TYPES.has(e.doc_type_key)) continue;
    const holder = ((e.data?.parties as DocumentParty[] | undefined) ?? []).find((p) => p.party_role === 'HOLDER');
    const person = holder ? lookup.personOf(e.evidence_id, holder.party_index)?.person_id : undefined;
    if (!holder || !person) continue;
    const doc: IdentityDocument = {
      doc_type_key: e.doc_type_key,
      number: normIdNumber(holder.id_number),
      issue_date: text(holder.id_issue_date) ?? text(valueAt(e.data, 'legal_info.issue_date')),
      valid_until: text(valueAt(e.data, 'legal_info.valid_until')),
      expired: null,
    };
    doc.expired = asOf && doc.valid_until ? doc.valid_until < asOf : null;
    const list = out.get(person) ?? [];
    // Hai bản chụp cùng loại, cùng số, cùng ngày cấp là một giấy.
    if (!list.some((d) => d.doc_type_key === doc.doc_type_key && d.number === doc.number && d.issue_date === doc.issue_date)) list.push(doc);
    out.set(person, list);
  }
  return out;
}

/** Quan hệ cùng hộ trên xác nhận cư trú (L360-G07): mỗi thành viên đã gom → chủ hộ; chỉ là căn cứ bổ sung, không đổi xác minh nhân thân. */
function householdRelations(lookup: Lookup): Map<string, Customer['relations']> {
  const out = new Map<string, Customer['relations']>();
  for (const e of lookup.evidences) {
    if (e.doc_type_key !== 'residence_confirmation') continue;
    const headIdx = valueAt(e.data, 'residence_info.household_head_party_index');
    const head = typeof headIdx === 'number' ? lookup.personOf(e.evidence_id, headIdx)?.person_id : undefined;
    if (!head) continue;
    for (const p of (e.data?.parties as DocumentParty[] | undefined) ?? []) {
      const person = lookup.personOf(e.evidence_id, p.party_index)?.person_id;
      if (!person || person === head) continue;
      const detail = p.party_role === 'HOLDER' ? text(valueAt(e.data, 'residence_info.holder_relationship_to_household_head_raw')) : text(p.party_role_raw);
      const list = out.get(person) ?? [];
      if (!list.some((r) => r.person_id === head)) list.push({ type: 'HOUSEHOLD_MEMBER_OF', person_id: head, verification: 'NOT_REQUIRED', detail });
      out.set(person, list);
    }
  }
  return out;
}

/**
 * L360-B10: người đại diện xác minh khi số định danh in trên GCN ĐKDN (`fields.representative_id_number`) trùng số định danh của một cá nhân
 * trong hồ sơ. Trùng → cặp `REPRESENTED_BY` / `LEGAL_REP_OF` VERIFIED (thay bản PARTIAL nối theo tên); không trùng ai → giữ nguyên.
 */
function verifyLegalReps(lookup: Lookup, customers: Customer[]): void {
  const byId = new Map(customers.map((c) => [c.person_id, c]));
  for (const e of lookup.evidences) {
    if (e.doc_type_key !== 'enterprise_registration_license') continue;
    const holder = ((e.data?.parties as DocumentParty[] | undefined) ?? []).find((p) => p.party_role === 'HOLDER');
    const org = holder ? byId.get(lookup.personOf(e.evidence_id, holder.party_index)?.person_id ?? '') : undefined;
    const repId = normIdNumber(text(valueAt(e.data, 'fields.representative_id_number')));
    if (!org || !repId) continue;
    const rep = customers.find((c) => c.party_type === 'INDIVIDUAL' && (c.id_number.value === repId || c.historical_id_numbers.includes(repId)));
    if (!rep) continue;
    org.relations = [...org.relations.filter((r) => r.type !== 'REPRESENTED_BY'), { type: 'REPRESENTED_BY', person_id: rep.person_id, verification: 'VERIFIED', detail: null }];
    rep.relations = [...rep.relations.filter((r) => !(r.type === 'LEGAL_REP_OF' && r.person_id === org.person_id)), { type: 'LEGAL_REP_OF', person_id: org.person_id, verification: 'VERIFIED', detail: null }];
  }
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
  // Người đại diện theo pháp luật S3 nối theo tên (customer360.ts `organizationOf`): PARTIAL; `verifyLegalReps` nâng lên VERIFIED theo CCCD.
  if (c360?.organization?.representative_person_id) out.push({ type: 'REPRESENTED_BY', person_id: c360.organization.representative_person_id, verification: 'PARTIAL', detail: null });
  for (const org of s3.customer_360) {
    if (org.organization?.representative_person_id === personId) out.push({ type: 'LEGAL_REP_OF', person_id: org.person_id, verification: 'PARTIAL', detail: null });
  }
  return out;
}

export function buildCustomers(lookup: Lookup, s3: MapDossierData | null, asOf: string | null): Customer[] {
  if (!s3) return [];
  const { lac } = lookup;
  const idDocs = identityDocuments(lookup, asOf);
  const household = householdRelations(lookup);
  const subjects = new Map(lac.subjects.map((s) => [s.subject_id, s]));
  const c360 = new Map(s3.customer_360.map((c) => [c.person_id, c]));
  const factsOf = (personId: string, field: string) => lac.facts.filter((f) => f.subject_id === personId && f.field === field && !f.hidden && f.trust !== 'SUPERSEDED');
  const customers = s3.role_registry
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
        relations: [...relationsOf(s3, p.person_id), ...(household.get(p.person_id) ?? [])],
        flags: [...(subject?.flags ?? [])],
        documents: [...(subject?.mentioned_in ?? [])],
        id_documents: idDocs.get(p.person_id) ?? [],
        details: detailsOf(lac, p.person_id, IDENTITY_FIELDS),
      } satisfies Customer;
    });
  verifyLegalReps(lookup, customers);
  return customers;
}
