// Dựng hồ sơ 360 — nguồn sự thật duy nhất của hồ sơ vay (loan_360.md §2, §3; D-110, D-114). Hàm thuần, tất định, không gọi model,
// không log. Thứ tự: đề nghị vay (anchor) → khách hàng → nguồn thu, hộ kinh doanh → nghĩa vụ nợ → tài sản → số cho stage 2 → vấn đề.
import type { MapDossierData } from '../contracts/check-stages';
import type { LoanApplicationContext } from '../context/schema';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { buildBusinessUnits } from './business';
import { buildCollateral } from './collateral';
import { buildCustomers } from './customers';
import { buildIncomeStreams } from './income';
import { buildConflicts, buildIssues, subjectLabeler } from './issues';
import { buildObligations } from './obligations';
import { loadMergePolicies, type MergePolicies } from './policies';
import { PROFILE360_VERSION, type BasisValue, type FinancialBasis, type Profile360 } from './schema';
import { basisAt, buildLookup, fieldAt, sumBasis, text, valueAt, type Lookup } from './sources';

export interface BuildProfile360Input {
  evidences: ReadonlyArray<EvidenceEnvelope>;
  /** Output S3; null khi S3 lỗi (chỉ còn khoản vay và đơn vị không có chủ). */
  s3: MapDossierData | null;
  lac: LoanApplicationContext;
  /** Phân khúc sản phẩm (`loan_products.json`): `HKD` | `SME`… */
  segment: string | null;
  /** Mặc định nạp `catalog/data/merge_policies.json`; null = catalog hỏng. */
  policies?: MergePolicies | null;
}

const LOAN_FIELDS = ['requested_amount', 'bank_proposed_amount', 'loan_term_months', 'interest_rate'] as const;

/** Số tiền / kỳ hạn / lãi suất của đơn vay gốc; đơn vay khác ghi khác (LAC-R03 `DISPUTED`) → không đưa vào stage 2, ghi xung đột. */
function loanBasis(lookup: Lookup, loan: Profile360['loan'], key: (typeof LOAN_FIELDS)[number]): BasisValue | null {
  return loan[key].trust === 'DISPUTED' ? null : basisAt(lookup.anchor, `loan_info.${key}`);
}

function financialBasis(lookup: Lookup, loan: Profile360['loan'], profile: Pick<Profile360, 'income_streams' | 'collateral'>): FinancialBasis {
  const anchor = lookup.anchor;
  let existing = basisAt(anchor, 'financial_info.existing_monthly_debt_payment');
  if (!existing && anchor && valueAt(anchor.data, 'financial_info.has_existing_debt') === false) {
    const record = `${anchor.evidence_id}#financial_info.has_existing_debt`;
    existing = { value: 0, record_ids: [record], review_record_ids: [] };
  }
  // Mỗi HKD một luồng (đã gộp nhiều bảng kê): cộng các HKD khác nhau, không cộng trùng một HKD.
  const hkd = profile.income_streams.filter((s) => s.kind === 'household_business');
  const collateral = profile.collateral.filter((a) => a.usage_contexts.includes('collateral') && a.chosen_value !== null).map((a) => {
    const v = a.valuations.find((x) => x.value === a.chosen_value)!;
    return { value: v.value, record_ids: [v.record_id], review_record_ids: v.review === 'REVIEW' ? [v.record_id] : [] };
  });
  return {
    loan_amount: loanBasis(lookup, loan, 'bank_proposed_amount'),
    tenor_months: loanBasis(lookup, loan, 'loan_term_months'),
    interest_rate: loanBasis(lookup, loan, 'interest_rate'),
    existing_monthly_debt: existing,
    hkd_annual_revenue: sumBasis(hkd.map((s) => s.annual_revenue)),
    hkd_annual_profit: sumBasis(hkd.map((s) => s.annual_profit)),
    collateral_value: sumBasis(collateral),
  };
}

export function buildProfile360(input: BuildProfile360Input): Profile360 {
  const { s3, lac } = input;
  const policies = input.policies === undefined ? loadMergePolicies() : input.policies;
  const lookup = buildLookup(input.evidences, s3, lac);
  const anchor = lookup.anchor;

  const loan: Profile360['loan'] = {
    ...(Object.fromEntries(LOAN_FIELDS.map((k) => [k, fieldAt(anchor, `loan_info.${k}`, lookup)])) as Record<(typeof LOAN_FIELDS)[number], Profile360['loan']['requested_amount']>),
    purposes: [...new Set([
      ...(((valueAt(anchor?.data, 'loan_info.loan_purposes') as unknown[] | undefined) ?? []).map(text)),
      text(valueAt(anchor?.data, 'loan_info.loan_purpose_detail')),
    ].filter((x): x is string => !!x))],
  };

  const customers = buildCustomers(lookup, s3);
  const borrowerId = customers.find((c) => c.roles.includes('borrower'))?.person_id ?? null;
  const business = buildBusinessUnits(lookup, s3, input.segment);
  const income = buildIncomeStreams(lookup, s3, business, policies);
  const obligations = buildObligations(lookup, borrowerId);
  const collateral = buildCollateral(lookup, s3, policies);

  const label = subjectLabeler(customers, collateral, business);
  const conflicts = buildConflicts(lac, label);
  const declaredIncomeRows = income.gaps.find((g) => g.code === 'DECLARED_INCOME_NOT_LINKED')?.count ?? 0;
  const issues = buildIssues({ lac, customers, business, income: income.income_streams, obligations, collateral, policies, declaredIncomeRows }, conflicts, label);

  return {
    profile_version: PROFILE360_VERSION,
    application: { evidence_id: anchor?.evidence_id ?? null, product_code: lac.product_code, segment: input.segment },
    loan,
    customers,
    income_streams: income.income_streams,
    business_units: business.units,
    obligations,
    collateral,
    relations: [...business.relations, ...income.relations],
    financial_basis: financialBasis(lookup, loan, { income_streams: income.income_streams, collateral }),
    conflicts,
    issues,
    gaps: [...(policies ? [] : [{ code: 'MERGE_POLICY_INVALID' as const, count: 1 }]), ...income.gaps],
    meta: { lac_source_hash: lac.meta.source_hash, merge_policy_version: policies?.policy_version ?? null },
  };
}
