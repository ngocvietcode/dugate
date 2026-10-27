// Đầu vào tài chính theo spec-v3 (T-V2-06; V2-R06). Mọi số đã là số trong schema — không parse chuỗi.
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { pickAnchor } from '@/lib/loan-dossier/s3/anchor';

import { ACCEPT_CONFIDENCE } from './evidence-v3';

/**
 * `reviewIds` (E9, D-101): nguồn có độ tin cậy đọc của field cấp 1 < ACCEPT_CONFIDENCE hoặc không có (cùng quy tắc REVIEW của
 * V2-R04). Đầu vào vẫn được dùng để tính; chỉ số phụ thuộc mang cờ `needs_review`. Vắng / rỗng = mọi nguồn đã ACCEPTED.
 */
export interface SourcedNumber { value: number; evidenceIds: string[]; reviewIds?: string[] }

export interface FinancialInputs {
  requested: SourcedNumber | null;
  revenue: SourcedNumber | null;
  profit: SourcedNumber | null;
  debtService: SourcedNumber | null;
  collateral: SourcedNumber | null;
  tenor: SourcedNumber | null;
  rate: SourcedNumber | null;
  existingMonthly: SourcedNumber | null;
  /** MD-R13: đầu vào để trống vì master_dossier báo CONFLICT — giá trị là tên trường để ghi cảnh báo. */
  conflicts?: Partial<Record<'requested' | 'revenue' | 'profit' | 'collateral' | 'tenor' | 'rate' | 'existingMonthly', string>>;
}

export const VALUATION_TYPES = ['real_estate_valuation_report', 'external_valuation_certificate', 'movable_asset_valuation_report'];
const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
/** Độ tin cậy đọc là của field CẤP 1 (`field_confidences`), giống `buildEvidenceRegistryV3`. */
const isLowConfidence = (e: EvidenceEnvelope, path: string): boolean => {
  const conf = e.field_confidences[path.split(/[.[]/)[0]];
  return !(typeof conf === 'number' && conf >= ACCEPT_CONFIDENCE);
};
/** `path` đọc giá trị (dạng chấm); `id` là field_path ghi vào evidence_id (dạng V2-R04, có thể dùng [i]). */
const sourced = (e: EvidenceEnvelope, value: number, path: string, id = path): SourcedNumber => {
  const evidenceId = `${e.evidence_id}#${id}`;
  return { value, evidenceIds: [evidenceId], ...(isLowConfidence(e, path) ? { reviewIds: [evidenceId] } : {}) };
};
const num = (e: EvidenceEnvelope, path: string, id = path): SourcedNumber | null => {
  const v = get(e.data, path);
  return typeof v === 'number' && Number.isFinite(v) ? sourced(e, v, path, id) : null;
};
const sum = (xs: SourcedNumber[]): SourcedNumber | null => {
  if (xs.length === 0) return null;
  const reviewIds = xs.flatMap((x) => x.reviewIds ?? []);
  return { value: xs.reduce((a, b) => a + b.value, 0), evidenceIds: xs.flatMap((x) => x.evidenceIds), ...(reviewIds.length ? { reviewIds } : {}) };
};

/**
 * - Số tiền vay = `loan_info.bank_proposed_amount` ("Số tiền cho vay"); null → thiếu dữ liệu, KHÔNG thay bằng requested_amount.
 * - Kỳ hạn = `loan_term_months`; lãi suất = `interest_rate` (%/năm), không bao giờ đọc `interest_rate_code`.
 * - Nợ hiện hữu = `existing_monthly_debt_payment`; `has_existing_debt = false` → 0; cả hai null → thiếu dữ liệu.
 * - Doanh thu/lợi nhuận HKD = `income_sources[]` loại `household_business`, field `*_annual` (VND/năm).
 * - Giá trị TSBĐ = `asset_details[].valuation_value` của báo cáo/chứng thư định giá gắn tài sản `collateral` trong
 *   `asset_registry`, không bị thay thế; nhiều nguồn cho một tài sản → bản có `issue_date` mới nhất; cộng các tài sản.
 */
export function financialInputsV3(envelopes: ReadonlyArray<EvidenceEnvelope>, s3: MapDossierData | null): FinancialInputs {
  const superseded = new Set((s3?.superseded_evidences ?? []).map((s) => s.evidence_id));
  const usable = envelopes.filter((e) => e.status === 'SUCCESS' && e.data && !superseded.has(e.evidence_id));
  const anchor = pickAnchor(usable);

  let existingMonthly: SourcedNumber | null = null;
  if (anchor) {
    existingMonthly = num(anchor, 'financial_info.existing_monthly_debt_payment');
    if (!existingMonthly && get(anchor.data, 'financial_info.has_existing_debt') === false) {
      existingMonthly = sourced(anchor, 0, 'financial_info.has_existing_debt');
    }
  }

  const revenues: SourcedNumber[] = [];
  const profits: SourcedNumber[] = [];
  for (const e of usable.filter((x) => x.doc_type_key === 'income_statement')) {
    const sources = (e.data!.income_sources as Array<{ income_type: string; household_business?: Record<string, unknown> | null }> | undefined) ?? [];
    sources.forEach((s, i) => {
      if (s.income_type !== 'household_business') return;
      const r = num(e, `income_sources.${i}.household_business.net_revenue_annual`, `income_sources[${i}].household_business.net_revenue_annual`);
      const p = num(e, `income_sources.${i}.household_business.net_profit_annual`, `income_sources[${i}].household_business.net_profit_annual`);
      if (r) revenues.push(r);
      if (p) profits.push(p);
    });
    // Mỗi bảng kê chỉ lấy 1 lần; nhiều bảng kê → bản đầu tiên (không cộng trùng thu nhập).
    if (revenues.length || profits.length) break;
  }

  // Giá trị TSBĐ theo tài sản collateral của S3
  const perAsset: SourcedNumber[] = [];
  for (const a of s3?.asset_registry ?? []) {
    if (!(a.usage_contexts as string[]).includes('collateral')) continue;
    const candidates: Array<{ v: SourcedNumber; issue: string | null; order: number }> = [];
    for (const src of a.sources as Array<{ evidence_id: string; asset_index: number }>) {
      const e = usable.find((x) => x.evidence_id === src.evidence_id && VALUATION_TYPES.includes(x.doc_type_key));
      if (!e) continue;
      const details = (e.data!.asset_details as Array<{ asset_index: number; valuation_value?: number | null }> | undefined) ?? [];
      const i = details.findIndex((d) => d.asset_index === src.asset_index);
      const v = i >= 0 ? details[i].valuation_value : null;
      if (typeof v !== 'number') continue;
      candidates.push({
        v: sourced(e, v, 'asset_details', `asset_details[${i}].valuation_value`),
        issue: (get(e.data, 'legal_info.issue_date') as string | null | undefined) ?? null,
        order: usable.indexOf(e),
      });
    }
    candidates.sort((x, y) => (x.issue === y.issue ? x.order - y.order : x.issue === null ? 1 : y.issue === null ? -1 : x.issue < y.issue ? 1 : -1));
    if (candidates[0]) perAsset.push(candidates[0].v);
  }

  return {
    requested: anchor ? num(anchor, 'loan_info.bank_proposed_amount') : null,
    tenor: anchor ? num(anchor, 'loan_info.loan_term_months') : null,
    rate: anchor ? num(anchor, 'loan_info.interest_rate') : null,
    existingMonthly,
    revenue: revenues[0] ?? null,
    profit: profits[0] ?? null,
    debtService: null,
    collateral: sum(perAsset),
  };
}
