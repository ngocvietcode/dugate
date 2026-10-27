import type { LoanCheckSet, LoanPolicyOverrides } from './check-set';
import type { LoanConfigSnapshot } from './types';
import { listLoanProductConfigs, loanProductConfig, type LoanProductConfig } from '@/lib/loan-dossier/catalog/products';

export interface LoanProductPolicy {
  productCode: string;
  configVersion: string;
  policyId: string;
  policyVersion: string;
  minimumDscr: number;
  maximumLtv: number;
  maximumAmountVnd: number;
  defaultTenorMonths: number;
  scorecardId: string | null;
  scorecardVersion: string | null;
  /** Ngưỡng đang dùng đến từ mặc định sản phẩm hay từ cấu hình Profile. */
  thresholdSource: 'DEFAULT' | 'PROFILE';
}

/** Policy mặc định của một sản phẩm, đọc từ `loan_products.json` (thêm sản phẩm không cần sửa code). */
function fromConfig(product: LoanProductConfig): LoanProductPolicy {
  const p = product.policy;
  return {
    productCode: product.product_code,
    configVersion: p.config_version,
    policyId: p.policy_id,
    policyVersion: p.policy_version,
    minimumDscr: p.minimum_dscr,
    maximumLtv: p.maximum_ltv,
    maximumAmountVnd: p.maximum_amount_vnd,
    defaultTenorMonths: p.default_tenor_months,
    // Không công bố rating/PD cho tới khi scorecard được Credit Risk phê duyệt.
    scorecardId: p.scorecard_id,
    scorecardVersion: p.scorecard_version,
    thresholdSource: 'DEFAULT',
  };
}

/** Danh sách policy sản phẩm vay (dùng cho trang cấu hình + validate phạm vi rule). */
export function listLoanProductPolicies(): LoanProductPolicy[] {
  return listLoanProductConfigs().map(fromConfig);
}

/** Ngưỡng mặc định của một sản phẩm, null nếu không có sản phẩm này. */
export function loanPolicyDefaults(productCode: string): LoanProductPolicy | null {
  const product = loanProductConfig(productCode);
  return product ? fromConfig(product) : null;
}
export function resolveLoanProductPolicy(
  productCode: string,
  overrides?: LoanPolicyOverrides,
): LoanProductPolicy {
  const policy = loanPolicyDefaults(productCode);
  if (!policy) throw new Error(`INVALID_INPUT: Unsupported loan product_code "${productCode}".`);
  if (!overrides || Object.keys(overrides).length === 0) return policy;
  // Ngưỡng do Profile cấu hình đã được kẹp khoảng ở parsePolicyOverrides.
  // policyVersion được đánh dấu để config_snapshot phản ánh đúng nguồn ngưỡng.
  return {
    ...policy,
    ...(overrides.minimumDscr !== undefined ? { minimumDscr: overrides.minimumDscr } : {}),
    ...(overrides.maximumLtv !== undefined ? { maximumLtv: overrides.maximumLtv } : {}),
    ...(overrides.maximumAmountVnd !== undefined ? { maximumAmountVnd: overrides.maximumAmountVnd } : {}),
    ...(overrides.defaultTenorMonths !== undefined ? { defaultTenorMonths: overrides.defaultTenorMonths } : {}),
    thresholdSource: 'PROFILE',
  };
}

export function snapshotPolicy(policy: LoanProductPolicy, checkSet?: LoanCheckSet): LoanConfigSnapshot {
  return {
    product_code: policy.productCode,
    product_config_version: policy.configVersion,
    policy_id: policy.policyId,
    policy_version: policy.policyVersion,
    scorecard_id: policy.scorecardId,
    scorecard_version: policy.scorecardVersion,
    // Ghi lại ngưỡng THỰC DÙNG của lần chạy này để kết quả luôn tái lập được,
    // kể cả khi Profile đổi cấu hình sau đó.
    thresholds: {
      minimum_dscr: policy.minimumDscr,
      maximum_ltv: policy.maximumLtv,
      maximum_amount_vnd: policy.maximumAmountVnd,
    },
    threshold_source: policy.thresholdSource,
    ...(checkSet ? {
      check_set: {
        program: checkSet.program,
        version: checkSet.version,
        source: checkSet.source,
        output_schema: checkSet.output_schema,
        flow: checkSet.flow,
        deterministic_count: checkSet.checks.filter((check) => check.kind === 'DETERMINISTIC' && check.enabled).length,
        prompt_count: checkSet.checks.filter((check) => check.kind === 'PROMPT' && check.enabled).length,
      },
    } : {}),
  };
}
