// Dựng hồ sơ 360 — nguồn sự thật duy nhất của hồ sơ vay (loan_360.md §2, §3; D-110, D-114). Hàm thuần, tất định, không gọi model,
// không log. Thứ tự: đề nghị vay (anchor) → khách hàng → nguồn thu, hộ kinh doanh → nghĩa vụ nợ → tài sản → số cho stage 2 → vấn đề.
import type { MapDossierData } from '../contracts/check-stages';
import type { LoanApplicationContext } from '../context/schema';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { buildBusinessUnits, type BusinessResult } from './business';
import { buildCollateral } from './collateral';
import { buildCustomers } from './customers';
import { buildIncomeStreams } from './income';
import { buildConflicts, buildIssues, subjectLabeler } from './issues';
import { buildObligations } from './obligations';
import { buildTrade } from './trade';
import { loadMergePolicies, type MergePolicies } from './policies';
import { PROFILE360_VERSION, type BasisValue, type FinancialBasis, type Profile360 } from './schema';
import { basisAt, buildLookup, fieldAt, normText, sumBasis, text, valueAt, type Lookup } from './sources';

export interface BuildProfile360Input {
  evidences: ReadonlyArray<EvidenceEnvelope>;
  /** Output S3; null khi S3 lỗi (chỉ còn khoản vay và đơn vị không có chủ). */
  s3: MapDossierData | null;
  lac: LoanApplicationContext;
  /** Phân khúc sản phẩm (`loan_products.json`): `HKD` | `SME`… */
  segment: string | null;
  /** Mặc định nạp `catalog/data/merge_policies.json`; null = catalog hỏng. */
  policies?: MergePolicies | null;
  /** Ngày nộp hồ sơ `YYYY-MM-DD` (d0, V2-R01) để xét giấy tờ hết hạn; vắng → không xét. */
  as_of?: string | null;
}

const LOAN_FIELDS = ['requested_amount', 'bank_proposed_amount', 'loan_term_months', 'interest_rate'] as const;

/** Số tiền / kỳ hạn / lãi suất của đơn vay gốc; đơn vay khác ghi khác (LAC-R03 `DISPUTED`) → không đưa vào stage 2, ghi xung đột. */
function loanBasis(lookup: Lookup, loan: Profile360['loan'], key: (typeof LOAN_FIELDS)[number]): BasisValue | null {
  return loan[key].trust === 'DISPUTED' ? null : basisAt(lookup.anchor, `loan_info.${key}`);
}

/** Đơn vị doanh nghiệp của chính khách vay pháp nhân (L360-B08). */
export function borrowerEnterprise(business: Pick<BusinessResult, 'units'>, borrowerId: string | null): string | null {
  return business.units.find((u) => u.kind === 'ENTERPRISE' && !!borrowerId && u.owner_person_ids.includes(borrowerId))?.business_id ?? null;
}

/**
 * OQ-360-13 (D-112): BCKQKD gần nhất (theo `period_to`) nối `FILED_BY` VERIFIED tới doanh nghiệp khách vay. Lợi nhuận dùng cho DSCR =
 * lợi nhuận trước thuế + chi phí lãi vay (không in chi phí lãi vay → chỉ lợi nhuận trước thuế). Không có → null, stage 2 báo thiếu dữ liệu.
 */
function smeBasis(lookup: Lookup, relations: Profile360['relations'], unitId: string | null): Pick<FinancialBasis, 'sme_annual_revenue' | 'sme_profit_before_interest'> {
  const filed = new Set(relations.filter((r) => r.type === 'FILED_BY' && r.to === unitId && r.verification === 'VERIFIED').map((r) => r.from));
  const latest = lookup.evidences
    .filter((e) => e.doc_type_key === 'financial_performance_report' && filed.has(e.evidence_id))
    .sort((a, b) => String(valueAt(b.data, 'performance_info.period_to') ?? '').localeCompare(String(valueAt(a.data, 'performance_info.period_to') ?? '')))[0];
  const pbt = basisAt(latest, 'performance_info.profit_before_tax');
  return {
    sme_annual_revenue: basisAt(latest, 'performance_info.net_revenue'),
    sme_profit_before_interest: pbt ? sumBasis([pbt, basisAt(latest, 'performance_info.interest_expense')]) : null,
  };
}

function financialBasis(lookup: Lookup, loan: Profile360['loan'], profile: Pick<Profile360, 'income_streams' | 'collateral' | 'relations'>, smeUnit: string | null): FinancialBasis {
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
    // D-117: tài sản chờ xác nhận gộp → giá trị vẫn vào LTV nhưng là bản ghi cần xem (tham khảo, chưa chính thức).
    return { value: v.value, record_ids: [v.record_id], review_record_ids: v.review === 'REVIEW' || a.match_review ? [v.record_id] : [] };
  });
  return {
    loan_amount: loanBasis(lookup, loan, 'bank_proposed_amount'),
    tenor_months: loanBasis(lookup, loan, 'loan_term_months'),
    interest_rate: loanBasis(lookup, loan, 'interest_rate'),
    existing_monthly_debt: existing,
    hkd_annual_revenue: sumBasis(hkd.map((s) => s.annual_revenue)),
    hkd_annual_profit: sumBasis(hkd.map((s) => s.annual_profit)),
    ...smeBasis(lookup, profile.relations, smeUnit),
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

  const asOf = input.as_of ?? null;
  const customers = buildCustomers(lookup, s3, asOf);
  const borrowerId = customers.find((c) => c.roles.includes('borrower'))?.person_id ?? null;
  const business = buildBusinessUnits(lookup, s3, input.segment);
  const income = buildIncomeStreams(lookup, s3, business, policies);
  const obligations = buildObligations(lookup, borrowerId);
  const collateral = buildCollateral(lookup, s3, policies);
  const trade = buildTrade(lookup, s3);
  // L360-G06: địa điểm kinh doanh trùng địa chỉ tài sản (full_text chuẩn hóa; chưa có bảng ánh xạ địa danh 2025 → chỉ so trùng tuyệt đối).
  const located = business.units.flatMap((u) => {
    const addr = typeof u.business_address.value === 'string' ? normText(u.business_address.value) : null;
    if (!addr) return [];
    return collateral.filter((a) => a.details.some((f) => /address|dia_chi/i.test(f.field) && typeof f.value === 'string' && normText(f.value) === addr))
      .map((a) => ({ type: 'LOCATED_AT' as const, from: u.business_id, to: a.asset_id, verification: 'PARTIAL' as const }));
  });

  const label = subjectLabeler(customers, collateral, business);
  const conflicts = buildConflicts(lac, label);
  const declaredIncomeRows = income.gaps.find((g) => g.code === 'DECLARED_INCOME_NOT_LINKED')?.count ?? 0;
  const smeUnit = input.segment === 'SME' ? borrowerEnterprise(business, borrowerId) : null;
  const issues = buildIssues({ lac, customers, business, income: income.income_streams, obligations, collateral, policies, declaredIncomeRows, trade, loan, segment: input.segment, smeUnit }, conflicts, label);
  const relations = [...business.relations, ...income.relations, ...located];

  return {
    profile_version: PROFILE360_VERSION,
    application: { evidence_id: anchor?.evidence_id ?? null, product_code: lac.product_code, segment: input.segment },
    loan,
    customers,
    income_streams: income.income_streams,
    business_units: business.units,
    obligations,
    collateral,
    counterparties: trade.counterparties,
    purchase_deals: trade.deals,
    relations,
    financial_basis: financialBasis(lookup, loan, { income_streams: income.income_streams, collateral, relations }, smeUnit),
    conflicts,
    issues,
    gaps: [...(policies ? [] : [{ code: 'MERGE_POLICY_INVALID' as const, count: 1 }]), ...income.gaps],
    meta: { lac_source_hash: lac.meta.source_hash, merge_policy_version: policies?.policy_version ?? null, as_of: asOf },
  };
}
