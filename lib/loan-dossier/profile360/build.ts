// Dựng lớp 2 của hồ sơ 360 (T-360-02, T-360-07, T-360-12; loan_360.md §3). Hàm thuần, tất định, không gọi model, không log.
// Chưa nối vào stage tài chính / rule (T-360-03): đây là view có kiểu, mỗi trường dẫn về fact LAC.
import { normIdNumber } from '../common/normalize';
import type { MapDossierData } from '../contracts/check-stages';
import type { LacFact, LoanApplicationContext } from '../context/schema';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { buildBusinessUnits } from './business';
import { buildIncomeStreams } from './income';
import { loadMergePolicies, type MergePolicies } from './policies';
import { PROFILE360_VERSION, type Profile360, type ProfileField } from './schema';
import { buildLookup, normText, pickField } from './sources';

export interface BuildProfile360Input {
  evidences: ReadonlyArray<EvidenceEnvelope>;
  /** Output S3; null khi S3 lỗi (chỉ còn khoản vay và đơn vị không có chủ). */
  s3: MapDossierData | null;
  lac: LoanApplicationContext;
  /** Mặc định nạp `catalog/data/merge_policies.json`; null = catalog hỏng. */
  policies?: MergePolicies | null;
}

const LOAN_FIELDS = ['requested_amount', 'bank_proposed_amount', 'loan_term_months', 'interest_rate'] as const;
const usable = (f: LacFact) => !f.hidden && f.trust !== 'SUPERSEDED';

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

export function buildProfile360(input: BuildProfile360Input): Profile360 {
  const { s3, lac } = input;
  const policies = input.policies === undefined ? loadMergePolicies() : input.policies;
  const lookup = buildLookup(input.evidences, s3, lac);
  const factsOf = (subjectId: string, field: string) => lac.facts.filter((f) => f.subject_id === subjectId && f.field === field && usable(f));

  const loan = Object.fromEntries(LOAN_FIELDS.map((k) => [
    k, pickField(factsOf('loan', `loan_info.${k}`).map((f) => ({ value: f.value, fact: f })), 'identity', String),
  ])) as Profile360['loan'];

  const c360 = new Map((s3?.customer_360 ?? []).map((c) => [c.person_id, c]));
  const parties: Profile360['parties'] = (s3?.role_registry ?? []).map((p) => {
    const entry = c360.get(p.person_id);
    const identity = entry?.identity;
    return {
      person_id: p.person_id,
      // Registry S3 không xuất party_type; Customer 360 chỉ có `organization` ở pháp nhân.
      party_type: entry?.organization ? 'ORGANIZATION' : 'INDIVIDUAL',
      roles: [...p.roles],
      full_name: fromS3(identity?.full_name ?? p.full_name ?? null, factsOf(p.person_id, 'parties[].full_name'), normText),
      id_number: fromS3(identity?.id_number ?? null, factsOf(p.person_id, 'parties[].id_number'), normIdNumber),
      date_of_birth: fromS3(identity?.date_of_birth ?? null, factsOf(p.person_id, 'parties[].date_of_birth'), (v) => v),
    };
  });

  const assets: Profile360['assets'] = (s3?.asset_registry ?? []).map((a) => ({
    asset_id: a.asset_id, asset_type: a.asset_type, usage_contexts: [...a.usage_contexts], current_owner_person_ids: [...a.current_owner_person_ids],
  }));

  const business = buildBusinessUnits(lookup, s3);
  const income = buildIncomeStreams(lookup, s3, business, policies);

  return {
    profile_version: PROFILE360_VERSION,
    loan,
    parties,
    assets,
    business_units: business.units,
    income_streams: income.income_streams,
    relations: [...business.relations, ...income.relations],
    gaps: [...(policies ? [] : [{ code: 'MERGE_POLICY_INVALID' as const, count: 1 }]), ...income.gaps],
    meta: { lac_source_hash: lac.meta.source_hash, merge_policy_version: policies?.policy_version ?? null },
  };
}
