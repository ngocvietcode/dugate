// Ngưỡng policy mở tài khoản theo PHÂN KHÚC + SẢN PHẨM.
//
// Mỗi sản phẩm tài khoản có một bộ ngưỡng riêng (tuổi, hiệu lực giấy tờ, ngưỡng
// kê khai chủ sở hữu hưởng lợi, số người ký, mức rủi ro nền của phân khúc).
// Ngưỡng có thể ghi đè từ Profile (param `account_policy`)
// nhưng luôn bị kẹp khoảng ở parsePolicyOverrides trước khi tới đây.

import type { CustomerSegmentKey } from '../prompts/account-opening-prompts';
import type { AccountCheckSet, AccountPolicyOverrides } from './check-set';
import type { AccountConfigSnapshot, RiskLevel } from './types';

export interface AccountOpeningPolicy {
  segmentKey: CustomerSegmentKey;
  /** Tên phân khúc, giữ tại đây để module này chỉ phụ thuộc type (an toàn cho client bundle). */
  segmentName: string;
  productCode: string;
  configVersion: string;
  policyId: string;
  policyVersion: string;
  /** Tuổi tối thiểu của chủ tài khoản/người đại diện (năm). */
  minimumAgeYears: number;
  /** Tuổi tối đa; null nghĩa là không giới hạn. */
  maximumAgeYears: number | null;
  /** Số ngày hiệu lực còn lại tối thiểu của giấy tờ định danh. */
  minimumIdValidityDays: number;
  /** Tỷ lệ sở hữu (%) từ mức này trở lên phải kê khai chủ sở hữu hưởng lợi. */
  beneficialOwnerThresholdPercent: number;
  /** Tổng tỷ lệ sở hữu (%) phải kê khai được để coi là đủ. */
  minimumBeneficialOwnerCoveragePercent: number;
  /** Số người được đăng ký ký/giao dịch tối thiểu trên tài khoản. */
  minimumAuthorizedSignatories: number;
  /** Mức rủi ro nền của phân khúc/sản phẩm trước khi xét yếu tố hồ sơ. */
  baselineRiskLevel: RiskLevel;
  /** Mức rủi ro cao nhất còn được xử lý ở mức rà soát chuẩn (CDD). */
  maximumRiskWithoutEdd: RiskLevel;
  /** Sản phẩm luôn yêu cầu rà soát tăng cường, bất kể kết quả chấm rủi ro. */
  requiresEnhancedDueDiligence: boolean;
  /** Các trường CIF bắt buộc của phân khúc (field_path trên Customer Profile). */
  mandatoryProfileFields: Array<{ path: string; label: string }>;
  screeningProviderId: string | null;
  screeningProviderVersion: string | null;
  /** Ngưỡng đang dùng đến từ mặc định sản phẩm hay từ cấu hình Profile. */
  thresholdSource: 'DEFAULT' | 'PROFILE';
}

// ─── Trường CIF bắt buộc theo phân khúc ───────────────────────────────────────

const INDIVIDUAL_MANDATORY_FIELDS: AccountOpeningPolicy['mandatoryProfileFields'] = [
  { path: 'identity.full_name', label: 'Họ và tên' },
  { path: 'identity.id_number', label: 'Số giấy tờ định danh' },
  { path: 'identity.date_of_birth', label: 'Ngày sinh' },
  { path: 'identity.nationality', label: 'Quốc tịch' },
  { path: 'contact.permanent_address', label: 'Địa chỉ thường trú' },
  { path: 'contact.phone_number', label: 'Số điện thoại' },
  { path: 'compliance.purpose_of_account', label: 'Mục đích mở tài khoản' },
];

const NONRESIDENT_MANDATORY_FIELDS: AccountOpeningPolicy['mandatoryProfileFields'] = [
  ...INDIVIDUAL_MANDATORY_FIELDS,
  { path: 'identity.id_expiry_date', label: 'Ngày hết hạn hộ chiếu' },
  { path: 'compliance.tax_residency', label: 'Quốc gia cư trú thuế' },
  { path: 'compliance.source_of_funds', label: 'Nguồn tiền' },
];

const HOUSEHOLD_MANDATORY_FIELDS: AccountOpeningPolicy['mandatoryProfileFields'] = [
  { path: 'identity.full_name', label: 'Họ và tên chủ hộ' },
  { path: 'identity.id_number', label: 'Số giấy tờ định danh chủ hộ' },
  { path: 'organization.business_name', label: 'Tên hộ kinh doanh' },
  { path: 'organization.household_business_number', label: 'Số GCN đăng ký hộ kinh doanh' },
  { path: 'organization.tax_id', label: 'Mã số thuế' },
  { path: 'organization.business_line', label: 'Ngành nghề kinh doanh' },
  { path: 'contact.business_address', label: 'Địa chỉ kinh doanh' },
  { path: 'compliance.purpose_of_account', label: 'Mục đích mở tài khoản' },
];

const ORGANIZATION_MANDATORY_FIELDS: AccountOpeningPolicy['mandatoryProfileFields'] = [
  { path: 'organization.business_name', label: 'Tên tổ chức' },
  { path: 'organization.registration_number', label: 'Số đăng ký doanh nghiệp' },
  { path: 'organization.tax_id', label: 'Mã số thuế' },
  { path: 'organization.business_line', label: 'Ngành nghề kinh doanh' },
  { path: 'organization.registration_address', label: 'Địa chỉ đăng ký' },
  { path: 'identity.legal_representative_name', label: 'Người đại diện theo pháp luật' },
  { path: 'identity.legal_representative_id_number', label: 'Số giấy tờ người đại diện' },
  { path: 'authorization.appointment_document', label: 'Văn bản bổ nhiệm người đại diện' },
  { path: 'ownership.beneficial_owners', label: 'Chủ sở hữu hưởng lợi' },
  { path: 'compliance.purpose_of_account', label: 'Mục đích mở tài khoản' },
];

const LARGE_CORPORATE_MANDATORY_FIELDS: AccountOpeningPolicy['mandatoryProfileFields'] = [
  ...ORGANIZATION_MANDATORY_FIELDS,
  { path: 'ownership.parent_company', label: 'Công ty mẹ / cấu trúc sở hữu' },
  { path: 'authorization.board_resolution', label: 'Nghị quyết mở tài khoản' },
  { path: 'compliance.tax_residency', label: 'Quốc gia cư trú thuế' },
  { path: 'compliance.expected_monthly_turnover', label: 'Doanh số giao dịch dự kiến' },
];

// ─── Policy từng sản phẩm ─────────────────────────────────────────────────────

const KHCN_STANDARD_V1: AccountOpeningPolicy = {
  segmentKey: 'KHCN',
  segmentName: 'Khách hàng cá nhân (KHCN)',
  productCode: 'casa-khcn-standard',
  configVersion: '1.0.0',
  policyId: 'AOP-KHCN-STANDARD',
  policyVersion: '1.0.0',
  minimumAgeYears: 18,
  maximumAgeYears: null,
  minimumIdValidityDays: 30,
  // Không áp dụng chủ sở hữu hưởng lợi cho cá nhân: ngưỡng 0 nghĩa là bỏ qua.
  beneficialOwnerThresholdPercent: 0,
  minimumBeneficialOwnerCoveragePercent: 0,
  minimumAuthorizedSignatories: 1,
  baselineRiskLevel: 'LOW',
  maximumRiskWithoutEdd: 'MEDIUM',
  requiresEnhancedDueDiligence: false,
  mandatoryProfileFields: INDIVIDUAL_MANDATORY_FIELDS,
  screeningProviderId: null,
  screeningProviderVersion: null,
  thresholdSource: 'DEFAULT',
};

const KHCN_NONRESIDENT_V1: AccountOpeningPolicy = {
  segmentKey: 'KHCN',
  segmentName: 'Khách hàng cá nhân (KHCN)',
  productCode: 'casa-khcn-nonresident',
  configVersion: '1.0.0',
  policyId: 'AOP-KHCN-NONRESIDENT',
  policyVersion: '1.0.0',
  minimumAgeYears: 18,
  maximumAgeYears: null,
  // Khách không cư trú: yêu cầu hiệu lực giấy tờ dài hơn vì khó bổ sung sau.
  minimumIdValidityDays: 90,
  beneficialOwnerThresholdPercent: 0,
  minimumBeneficialOwnerCoveragePercent: 0,
  minimumAuthorizedSignatories: 1,
  baselineRiskLevel: 'HIGH',
  maximumRiskWithoutEdd: 'MEDIUM',
  requiresEnhancedDueDiligence: true,
  mandatoryProfileFields: NONRESIDENT_MANDATORY_FIELDS,
  screeningProviderId: null,
  screeningProviderVersion: null,
  thresholdSource: 'DEFAULT',
};

const HKD_STANDARD_V1: AccountOpeningPolicy = {
  segmentKey: 'HKD',
  segmentName: 'Hộ kinh doanh (HKD)',
  productCode: 'casa-hkd-standard',
  configVersion: '1.0.0',
  policyId: 'AOP-HKD-STANDARD',
  policyVersion: '1.0.0',
  minimumAgeYears: 18,
  maximumAgeYears: null,
  minimumIdValidityDays: 30,
  beneficialOwnerThresholdPercent: 0,
  minimumBeneficialOwnerCoveragePercent: 0,
  minimumAuthorizedSignatories: 1,
  baselineRiskLevel: 'MEDIUM',
  maximumRiskWithoutEdd: 'MEDIUM',
  requiresEnhancedDueDiligence: false,
  mandatoryProfileFields: HOUSEHOLD_MANDATORY_FIELDS,
  screeningProviderId: null,
  screeningProviderVersion: null,
  thresholdSource: 'DEFAULT',
};

const SME_STANDARD_V1: AccountOpeningPolicy = {
  segmentKey: 'SME',
  segmentName: 'Doanh nghiệp vừa và nhỏ (SME)',
  productCode: 'casa-sme-standard',
  configVersion: '1.0.0',
  policyId: 'AOP-SME-STANDARD',
  policyVersion: '1.0.0',
  minimumAgeYears: 18,
  maximumAgeYears: null,
  minimumIdValidityDays: 30,
  beneficialOwnerThresholdPercent: 25,
  minimumBeneficialOwnerCoveragePercent: 75,
  minimumAuthorizedSignatories: 1,
  baselineRiskLevel: 'MEDIUM',
  maximumRiskWithoutEdd: 'MEDIUM',
  requiresEnhancedDueDiligence: false,
  mandatoryProfileFields: ORGANIZATION_MANDATORY_FIELDS,
  screeningProviderId: null,
  screeningProviderVersion: null,
  thresholdSource: 'DEFAULT',
};

const KHDN_STANDARD_V1: AccountOpeningPolicy = {
  segmentKey: 'KHDN',
  segmentName: 'Khách hàng doanh nghiệp lớn (KHDN)',
  productCode: 'casa-khdn-standard',
  configVersion: '1.0.0',
  policyId: 'AOP-KHDN-STANDARD',
  policyVersion: '1.0.0',
  minimumAgeYears: 18,
  maximumAgeYears: null,
  minimumIdValidityDays: 60,
  // Cấu trúc nhiều tầng: hạ ngưỡng kê khai xuống 10% và yêu cầu phủ cao hơn.
  beneficialOwnerThresholdPercent: 10,
  minimumBeneficialOwnerCoveragePercent: 90,
  minimumAuthorizedSignatories: 2,
  baselineRiskLevel: 'MEDIUM',
  maximumRiskWithoutEdd: 'MEDIUM',
  requiresEnhancedDueDiligence: true,
  mandatoryProfileFields: LARGE_CORPORATE_MANDATORY_FIELDS,
  screeningProviderId: null,
  screeningProviderVersion: null,
  thresholdSource: 'DEFAULT',
};

const POLICIES: Record<string, AccountOpeningPolicy> = {
  [KHCN_STANDARD_V1.productCode]: KHCN_STANDARD_V1,
  [KHCN_NONRESIDENT_V1.productCode]: KHCN_NONRESIDENT_V1,
  [HKD_STANDARD_V1.productCode]: HKD_STANDARD_V1,
  [SME_STANDARD_V1.productCode]: SME_STANDARD_V1,
  [KHDN_STANDARD_V1.productCode]: KHDN_STANDARD_V1,
};

/**
 * Danh sách policy mặc định, dùng cho UI cấu hình /profiles để hiển thị ngưỡng
 * gốc của từng sản phẩm làm placeholder. Trả bản sao để caller không sửa được
 * hằng số của module.
 */
export function listAccountOpeningPolicies(): AccountOpeningPolicy[] {
  return Object.values(POLICIES).map((policy) => ({ ...policy }));
}

export function accountPolicyDefaults(productCode: string): AccountOpeningPolicy | null {
  const policy = POLICIES[productCode];
  return policy ? { ...policy } : null;
}

export function resolveAccountOpeningPolicy(
  productCode: string,
  overrides?: AccountPolicyOverrides,
): AccountOpeningPolicy {
  const policy = POLICIES[productCode];
  if (!policy) throw new Error(`INVALID_INPUT: Unsupported account product_code "${productCode}".`);
  if (!overrides || Object.keys(overrides).length === 0) return policy;
  // Ngưỡng do Profile cấu hình đã được kẹp khoảng ở parsePolicyOverrides.
  // thresholdSource được đánh dấu để config_snapshot phản ánh đúng nguồn ngưỡng.
  return {
    ...policy,
    ...(overrides.minimumAgeYears !== undefined ? { minimumAgeYears: overrides.minimumAgeYears } : {}),
    ...(overrides.maximumAgeYears !== undefined ? { maximumAgeYears: overrides.maximumAgeYears } : {}),
    ...(overrides.minimumIdValidityDays !== undefined ? { minimumIdValidityDays: overrides.minimumIdValidityDays } : {}),
    ...(overrides.beneficialOwnerThresholdPercent !== undefined
      ? { beneficialOwnerThresholdPercent: overrides.beneficialOwnerThresholdPercent }
      : {}),
    ...(overrides.minimumBeneficialOwnerCoveragePercent !== undefined
      ? { minimumBeneficialOwnerCoveragePercent: overrides.minimumBeneficialOwnerCoveragePercent }
      : {}),
    ...(overrides.minimumAuthorizedSignatories !== undefined
      ? { minimumAuthorizedSignatories: overrides.minimumAuthorizedSignatories }
      : {}),
    thresholdSource: 'PROFILE',
  };
}

export function snapshotPolicy(policy: AccountOpeningPolicy, checkSet?: AccountCheckSet): AccountConfigSnapshot {
  return {
    segment_key: policy.segmentKey,
    segment_name: policy.segmentName,
    product_code: policy.productCode,
    product_config_version: policy.configVersion,
    policy_id: policy.policyId,
    policy_version: policy.policyVersion,
    screening_provider_id: policy.screeningProviderId,
    screening_provider_version: policy.screeningProviderVersion,
    // Ghi lại ngưỡng THỰC DÙNG của lần chạy này để kết quả luôn tái lập được,
    // kể cả khi Profile đổi cấu hình sau đó.
    thresholds: {
      minimum_age_years: policy.minimumAgeYears,
      maximum_age_years: policy.maximumAgeYears,
      minimum_id_validity_days: policy.minimumIdValidityDays,
      beneficial_owner_threshold_percent: policy.beneficialOwnerThresholdPercent,
      minimum_beneficial_owner_coverage_percent: policy.minimumBeneficialOwnerCoveragePercent,
      minimum_authorized_signatories: policy.minimumAuthorizedSignatories,
    },
    baseline_risk_level: policy.baselineRiskLevel,
    maximum_risk_without_edd: policy.maximumRiskWithoutEdd,
    threshold_source: policy.thresholdSource,
    ...(checkSet ? {
      check_set: {
        program: checkSet.program,
        version: checkSet.version,
        source: checkSet.source,
        output_schema: checkSet.output_schema,
        deterministic_count: checkSet.checks.filter((check) => check.kind === 'DETERMINISTIC' && check.enabled).length,
        prompt_count: checkSet.checks.filter((check) => check.kind === 'PROMPT' && check.enabled).length,
      },
    } : {}),
  };
}
