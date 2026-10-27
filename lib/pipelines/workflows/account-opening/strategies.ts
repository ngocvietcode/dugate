// Strategy cho các stage deterministic của workflow mở tài khoản.
//
// Mỗi stage không dùng AI là một Strategy thuần tính toán: cùng input → cùng
// output, không gọi mạng, không phụ thuộc thời điểm ngoài `asOf` được truyền vào.
// Nhờ vậy orchestrator dựng lại các artifact này mỗi lần resume mà không sợ
// checkpoint cũ mang theo kết luận đã lỗi thời.

import type {
  AccountProduct,
  AccountSegment,
  ChecklistItemResult,
  ClassifiedDoc,
  CustomerProfile,
  ExtractedDoc,
  OnboardingEvaluation,
} from '../prompts/account-opening-prompts';
import {
  buildEvidenceRegistry,
  countEvidence,
  daysBetween,
  findDateEvidence,
  findEarliestDateEvidence,
  findMoneyEvidence,
  findTextEvidence,
  monthsBetween,
  sumPercentEvidence,
} from './evidence';
import { aggregateRuleResults, buildRuleSet, type AccountRuleFacts } from './rules';
import { evaluateAssessmentReadiness, highestRiskLevel } from './state-machine';
import type { AccountOpeningPolicy } from './segment-policy';
import type { AccountCheckSet } from './check-set';
import type {
  AccountOpeningRecommendation,
  AssessmentFinding,
  CddAssessment,
  CddFactorAssessment,
  DossierReadinessResult,
  DueDiligenceLevel,
  EligibilityMetrics,
  EvidenceRegistry,
  IntakeResult,
  MetricResult,
  PolicyComplianceResult,
  ProfileProvenanceResult,
  ReviewResult,
  RiskLevel,
  RuleResult,
  ScreeningResult,
} from './types';

export interface StageStrategy<I, O> {
  readonly strategyId: string;
  execute(input: I): O;
}

// ─── Helper dựng MetricResult ─────────────────────────────────────────────────

function unavailableMetric(
  unit: MetricResult['unit'],
  formula: string,
  warnings: string[],
  evidenceIds: string[] = [],
): MetricResult {
  return { status: 'INSUFFICIENT_DATA', value: null, unit, formula, inputs: {}, evidence_ids: [...new Set(evidenceIds)], warnings };
}

/** Chỉ tiêu không áp dụng cho phân khúc này — khác hẳn "thiếu dữ liệu". */
function notApplicableMetric(unit: MetricResult['unit'], formula: string, reason: string): MetricResult {
  return { status: 'NOT_APPLICABLE', value: null, unit, formula, inputs: {}, evidence_ids: [], warnings: [reason] };
}

function calculatedMetric(
  value: number,
  unit: MetricResult['unit'],
  formula: string,
  inputs: Record<string, number | string | null>,
  evidenceIds: string[],
  warnings: string[] = [],
): MetricResult {
  return { status: 'CALCULATED', value, unit, formula, inputs, evidence_ids: [...new Set(evidenceIds)], warnings };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─── Stage 3a: evidence + intake ─────────────────────────────────────────────

export class IntakeEvidenceStrategy implements StageStrategy<{
  classification: ClassifiedDoc[];
  extraction: ExtractedDoc[];
  evaluation: OnboardingEvaluation;
}, { evidence: EvidenceRegistry; intake: IntakeResult }> {
  readonly strategyId = 'account-opening-v1:intake-evidence';

  execute(input: { classification: ClassifiedDoc[]; extraction: ExtractedDoc[]; evaluation: OnboardingEvaluation }) {
    const evidence = buildEvidenceRegistry(input.classification, input.extraction, input.evaluation.checklist);
    const required = input.evaluation.checklist.filter((item) => item.required);
    const present = required.filter((item) => item.status === 'present').length;
    const intake: IntakeResult = {
      required_present: present,
      required_total: required.length,
      completeness_percent: required.length ? Math.round((present / required.length) * 100) : 100,
      checklist: input.evaluation.checklist,
      missing_required_keys: required.filter((item) => item.status === 'missing').map((item) => item.key),
      review_required_keys: required.filter((item) => item.status === 'review').map((item) => item.key),
      extraction_errors: input.extraction
        .filter((item) => item.status === 'error')
        .map((item) => ({ file_name: item.file_name, doc_type_key: item.doc_type_key, error: item.error ?? 'Extraction failed' })),
    };
    return { evidence, intake };
  }
}

/**
 * Tổng hợp trạng thái giai đoạn tiếp nhận hồ sơ. Strategy chỉ đọc lại intake,
 * cross-check và evidence đã có; không bóc tách lại để tránh nhân đôi nguồn sự
 * thật. Kết quả là khuyến cáo, không dùng để chặn các stage đánh giá.
 */
export class DossierReadinessStrategy implements StageStrategy<{
  classification: ClassifiedDoc[];
  extraction: ExtractedDoc[];
  evaluation: OnboardingEvaluation;
  intake: IntakeResult;
  evidence: EvidenceRegistry;
}, DossierReadinessResult> {
  readonly strategyId = 'account-opening-v1:dossier-readiness';

  execute(input: {
    classification: ClassifiedDoc[];
    extraction: ExtractedDoc[];
    evaluation: OnboardingEvaluation;
    intake: IntakeResult;
    evidence: EvidenceRegistry;
  }): DossierReadinessResult {
    const labelByKey = new Map(input.intake.checklist.map((item) => [item.key, item.label]));
    const evidenceIdsByFile = new Map(input.evidence.by_file.map((entry) => [entry.file_name, entry.evidence_ids]));

    const unclassifiedFiles = input.classification
      .filter((item) => item.status !== 'classified')
      .map((item) => ({ file_name: item.file_name, reason: item.reason ?? 'Không nhận dạng được loại chứng từ' }));

    const conflicts = input.evaluation.cross_check.map((finding) => {
      const documents = finding.documents ?? [];
      return {
        severity: finding.severity,
        title: finding.title,
        message: finding.message,
        documents,
        evidence_ids: [...new Set(documents.flatMap((file) => evidenceIdsByFile.get(file) ?? []))],
      };
    });

    const blockingConflicts = conflicts.filter((item) => item.severity === 'error');
    const classifiedCount = input.classification.filter((item) => item.status === 'classified').length;
    const extractedCount = input.extraction.filter((item) => item.status === 'success').length;

    const supplementRequests = [
      ...input.intake.missing_required_keys.map((key) => `Bổ sung chứng từ bắt buộc: ${labelByKey.get(key) ?? key}`),
      ...input.intake.review_required_keys.map((key) => `Làm rõ/hoàn thiện chứng từ: ${labelByKey.get(key) ?? key}`),
      ...unclassifiedFiles.map((item) => `Xác nhận loại chứng từ cho tài liệu: ${item.file_name}`),
      ...input.intake.extraction_errors.map((item) => `Cung cấp lại bản đọc được cho: ${item.file_name}`),
      ...blockingConflicts.map((item) => `Xử lý dữ liệu không khớp: ${item.title}`),
    ];

    const blockingReasons = [
      ...(input.intake.missing_required_keys.length > 0 ? ['REQUIRED_DOCUMENTS_MISSING'] : []),
      ...(input.intake.review_required_keys.length > 0 ? ['DOCUMENTS_NEED_REVIEW'] : []),
      ...(unclassifiedFiles.length > 0 ? ['UNCLASSIFIED_DOCUMENTS'] : []),
      ...(input.intake.extraction_errors.length > 0 ? ['EXTRACTION_ERRORS'] : []),
      ...(blockingConflicts.length > 0 ? ['CROSS_DOCUMENT_CONFLICT'] : []),
    ];

    const status: DossierReadinessResult['status'] = classifiedCount === 0 || extractedCount === 0
      ? 'NOT_PROCESSABLE'
      : input.intake.missing_required_keys.length > 0
        ? 'NEEDS_DOCUMENTS'
        : blockingReasons.length > 0
          ? 'NEEDS_VERIFICATION'
          : 'READY_FOR_ASSESSMENT';

    return {
      status,
      completeness_percent: input.intake.completeness_percent,
      required_present: input.intake.required_present,
      required_total: input.intake.required_total,
      missing_required_keys: input.intake.missing_required_keys,
      review_required_keys: input.intake.review_required_keys,
      unclassified_files: unclassifiedFiles,
      extraction_errors: input.intake.extraction_errors,
      conflicts,
      supplement_requests: [...new Set(supplementRequests)],
      blocking_reasons: [...new Set(blockingReasons)],
      assessment_conditional: status !== 'READY_FOR_ASSESSMENT',
    };
  }
}

// ─── Stage 3: chỉ tiêu điều kiện mở tài khoản (deterministic) ─────────────────
// Mọi chỉ tiêu chỉ lấy từ evidence ĐÃ CHẤP NHẬN. Chỉ tiêu không thuộc phạm vi
// phân khúc trả NOT_APPLICABLE để rule engine không hiểu nhầm là thiếu dữ liệu.

/** Các loại chứng từ định danh chính (không tính giấy tờ cư trú, kế toán trưởng). */
function primaryIdentityDocKeys(product: AccountProduct): string[] {
  return product.requiredDocs
    .filter((doc) => doc.identityDocument && doc.key !== 'entry_permit' && doc.key !== 'chief_accountant_id')
    .map((doc) => doc.key);
}

function hasDoc(product: AccountProduct, key: string): boolean {
  return product.requiredDocs.some((doc) => doc.key === key);
}

const DOB_PATTERNS = [/(^|\.)date_of_birth$/i, /personal_info\.date_of_birth/i, /\.date_of_birth$/i];
const EXPIRY_PATTERNS = [/expiry_date/i, /valid_until/i, /expiration/i, /date_of_departure/i];
// initial_registration_date = tên field của preset business-license (account-opening);
// initial_registration = tên field thật mà payment-account-management/OCR trả về cho
// mã dang_ky_kinh_doanh — giữ cả hai để không phụ thuộc vào nguồn OCR nào.
const REGISTRATION_DATE_PATTERNS = [/(^|\.)initial_registration(_date)?$/i, /(^|\.)issue_date$/i];
const CHARTER_CAPITAL_PATTERNS = [/charter_capital(\.|_)?/i, /total_capital/i];
const REVENUE_PATTERNS = [/last_year_revenue/i, /net_revenue/i, /annual_revenue/i, /revenue/i];
const OWNERSHIP_PERCENT_PATTERNS = [/contribution_percentage/i, /ownership_percentage/i, /(^|\.)percentage$/i];
const SIGNATORY_PATTERNS = [
  /legal_representatives\[\d+\]\.full_name/i,
  /authorized_users\[\d+\]\.full_name/i,
  /chief_accountant(_authorized)?\.full_name/i,
];

export interface EligibilityStrategyInput {
  evidence: EvidenceRegistry;
  intake: IntakeResult;
  provenance: ProfileProvenanceResult;
  /** Mốc thời gian đánh giá; truyền vào để kết quả tái lập được khi chạy lại. */
  asOf: Date;
}

export class EligibilityStrategy implements StageStrategy<EligibilityStrategyInput, EligibilityMetrics> {
  readonly strategyId = 'account-opening-v1:eligibility';

  constructor(
    private readonly product: AccountProduct,
    private readonly segment: AccountSegment,
    private readonly policy: AccountOpeningPolicy,
  ) {}

  execute(input: EligibilityStrategyInput): EligibilityMetrics {
    const { evidence, intake, provenance, asOf } = input;
    const identityKeys = primaryIdentityDocKeys(this.product);
    const asOfLabel = isoDate(asOf);

    return {
      applicant_age: this.applicantAge(evidence, identityKeys, asOf, asOfLabel),
      primary_id_validity_days: this.primaryIdValidity(evidence, identityKeys, asOf, asOfLabel),
      residency_permit_validity_days: this.residencyPermitValidity(evidence, asOf, asOfLabel),
      organization_age_months: this.organizationAge(evidence, asOf, asOfLabel),
      charter_capital: this.charterCapital(evidence),
      declared_annual_revenue: this.declaredRevenue(evidence),
      beneficial_owner_coverage_percent: this.beneficialOwnerCoverage(evidence),
      authorized_signatory_count: this.signatoryCount(evidence),
      mandatory_profile_coverage_percent: this.mandatoryProfileCoverage(provenance),
      document_completeness_percent: calculatedMetric(
        intake.completeness_percent,
        'PERCENT',
        'completeness = chứng từ bắt buộc present / tổng chứng từ bắt buộc',
        { required_present: intake.required_present, required_total: intake.required_total },
        [],
      ),
    };
  }

  private applicantAge(evidence: EvidenceRegistry, identityKeys: string[], asOf: Date, asOfLabel: string): MetricResult {
    const formula = 'age = số năm tròn từ ngày sinh đến thời điểm đánh giá';
    // Ưu tiên ngày sinh trên giấy tờ định danh; biểu mẫu chỉ dùng khi không có.
    const found = findDateEvidence(evidence, DOB_PATTERNS, identityKeys)
      ?? findDateEvidence(evidence, DOB_PATTERNS, ['account_form']);
    if (!found) {
      return unavailableMetric('YEARS', formula, ['Không tìm thấy ngày sinh có cấu trúc trong hồ sơ.']);
    }
    const months = monthsBetween(found.value, asOf);
    if (months < 0) {
      return unavailableMetric('YEARS', formula, ['Ngày sinh đọc được nằm ở tương lai; cần kiểm tra lại chứng từ.'], found.evidenceIds);
    }
    return calculatedMetric(
      Math.floor(months / 12),
      'YEARS',
      formula,
      { date_of_birth: isoDate(found.value), as_of: asOfLabel },
      found.evidenceIds,
    );
  }

  private primaryIdValidity(evidence: EvidenceRegistry, identityKeys: string[], asOf: Date, asOfLabel: string): MetricResult {
    const formula = 'validity_days = ngày hết hạn giấy tờ định danh - thời điểm đánh giá';
    // Lấy mốc hết hạn SỚM NHẤT: hồ sơ chỉ hợp lệ khi mọi giấy tờ còn hiệu lực.
    const found = findEarliestDateEvidence(evidence, EXPIRY_PATTERNS, identityKeys);
    if (!found) {
      return unavailableMetric('DAYS', formula, ['Không đọc được ngày hết hạn của giấy tờ định danh.']);
    }
    return calculatedMetric(
      daysBetween(asOf, found.value),
      'DAYS',
      formula,
      { expiry_date: isoDate(found.value), as_of: asOfLabel },
      found.evidenceIds,
    );
  }

  private residencyPermitValidity(evidence: EvidenceRegistry, asOf: Date, asOfLabel: string): MetricResult {
    const formula = 'validity_days = ngày hết hạn thị thực/thẻ cư trú - thời điểm đánh giá';
    if (!hasDoc(this.product, 'entry_permit')) {
      return notApplicableMetric('DAYS', formula, 'Sản phẩm không yêu cầu giấy tờ cư trú tại Việt Nam.');
    }
    const found = findEarliestDateEvidence(evidence, EXPIRY_PATTERNS, ['entry_permit', 'work_permit']);
    if (!found) {
      return unavailableMetric('DAYS', formula, ['Không đọc được thời hạn cư trú trên thị thực/thẻ tạm trú.']);
    }
    return calculatedMetric(
      daysBetween(asOf, found.value),
      'DAYS',
      formula,
      { expiry_date: isoDate(found.value), as_of: asOfLabel },
      found.evidenceIds,
    );
  }

  private organizationAge(evidence: EvidenceRegistry, asOf: Date, asOfLabel: string): MetricResult {
    const formula = 'organization_age_months = số tháng từ ngày đăng ký lần đầu đến thời điểm đánh giá';
    if (!hasDoc(this.product, 'business_registration')) {
      return notApplicableMetric('MONTHS', formula, 'Phân khúc không có giấy chứng nhận đăng ký kinh doanh.');
    }
    const found = findDateEvidence(evidence, REGISTRATION_DATE_PATTERNS, ['business_registration', 'tax_registration']);
    if (!found) {
      return unavailableMetric('MONTHS', formula, ['Không đọc được ngày đăng ký kinh doanh lần đầu.']);
    }
    const months = monthsBetween(found.value, asOf);
    if (months < 0) {
      return unavailableMetric('MONTHS', formula, ['Ngày đăng ký kinh doanh nằm ở tương lai; cần kiểm tra lại chứng từ.'], found.evidenceIds);
    }
    return calculatedMetric(
      months,
      'MONTHS',
      formula,
      { initial_registration_date: isoDate(found.value), as_of: asOfLabel },
      found.evidenceIds,
    );
  }

  private charterCapital(evidence: EvidenceRegistry): MetricResult {
    const formula = 'charter_capital = vốn điều lệ theo đăng ký doanh nghiệp / điều lệ';
    if (!this.segment.isOrganization) {
      return notApplicableMetric('VND', formula, 'Phân khúc không phải tổ chức nên không có vốn điều lệ.');
    }
    const found = findMoneyEvidence(evidence, CHARTER_CAPITAL_PATTERNS, ['business_registration', 'company_charter', 'account_form']);
    return found
      ? calculatedMetric(found.value, 'VND', formula, { source_value: found.value }, found.evidenceIds)
      : unavailableMetric('VND', formula, ['Không tìm thấy vốn điều lệ có cấu trúc trong hồ sơ.']);
  }

  private declaredRevenue(evidence: EvidenceRegistry): MetricResult {
    const formula = 'declared_annual_revenue = doanh thu năm gần nhất khách hàng khai/chứng minh';
    const found = findMoneyEvidence(evidence, REVENUE_PATTERNS, [
      'account_form', 'financial_statement', 'source_of_funds', 'business_registration',
    ]);
    return found
      ? calculatedMetric(found.value, 'VND', formula, { source_value: found.value }, found.evidenceIds)
      : unavailableMetric('VND', formula, ['Chưa có số liệu doanh thu/thu nhập năm có cấu trúc.']);
  }

  private beneficialOwnerCoverage(evidence: EvidenceRegistry): MetricResult {
    const formula = 'coverage = tổng tỷ lệ sở hữu (%) của các chủ sở hữu hưởng lợi đã kê khai';
    if (this.policy.beneficialOwnerThresholdPercent <= 0) {
      return notApplicableMetric('PERCENT', formula, 'Phân khúc không yêu cầu kê khai chủ sở hữu hưởng lợi.');
    }
    const found = sumPercentEvidence(evidence, OWNERSHIP_PERCENT_PATTERNS, [
      'beneficial_owner_declaration', 'account_form', 'ownership_structure', 'business_registration',
    ]);
    if (found) {
      // Tổng > 100% thường do OCR đếm trùng một người ở nhiều chứng từ; kẹp về
      // 100 và ghi cảnh báo thay vì âm thầm cho qua ngưỡng.
      const capped = Math.min(found.value, 100);
      return calculatedMetric(
        capped,
        'PERCENT',
        formula,
        { declared_total_percent: found.value, owners_counted: found.count },
        found.evidenceIds,
        found.value > 100 ? ['Tổng tỷ lệ kê khai vượt 100%; có thể trùng người giữa các chứng từ, đã kẹp về 100%.'] : [],
      );
    }

    // Doanh nghiệp một chủ sở hữu (TNHH MTV/DNTN) không có cổ đông kê khai %
    // sở hữu — GCN đăng ký kinh doanh chỉ có field "owner" duy nhất, không có
    // "shareholders". Đây KHÔNG phải thiếu dữ liệu: chủ sở hữu duy nhất mặc
    // định nắm 100% quyền sở hữu hưởng lợi. Chỉ suy luận khi business_type xác
    // nhận rõ loại hình này, tránh coi mọi trường hợp thiếu % là 100% một cách
    // sai lệch.
    const businessType = findTextEvidence(evidence, BUSINESS_TYPE_PATTERNS, ['business_registration']);
    if (businessType && isSingleMemberEnterprise(businessType.value)) {
      const ownerIdentity = findTextEvidence(evidence, OWNER_IDENTITY_PATTERNS, ['business_registration']);
      const evidenceIds = [...businessType.evidenceIds, ...(ownerIdentity?.evidenceIds ?? [])];
      return calculatedMetric(
        100,
        'PERCENT',
        formula,
        { declared_total_percent: 100, owners_counted: 1, inference: 'SINGLE_MEMBER_ENTERPRISE' },
        evidenceIds,
        ['Loại hình một chủ sở hữu (TNHH MTV/DNTN) không kê khai tỷ lệ % sở hữu; suy coverage 100% từ chủ sở hữu duy nhất trên GCN đăng ký kinh doanh.'],
      );
    }

    return unavailableMetric('PERCENT', formula, ['Không đọc được tỷ lệ sở hữu của chủ sở hữu hưởng lợi.']);
  }

  private signatoryCount(evidence: EvidenceRegistry): MetricResult {
    const formula = 'count = số người đại diện/được ủy quyền riêng biệt đăng ký trên tài khoản';
    if (!this.segment.isOrganization) {
      return notApplicableMetric('COUNT', formula, 'Phân khúc cá nhân/hộ kinh doanh chỉ có chủ tài khoản đứng tên.');
    }
    const found = countEvidence(evidence, SIGNATORY_PATTERNS, [
      'account_form', 'authorization_doc', 'appointment_decision', 'signature_specimen',
    ]);
    return found
      ? calculatedMetric(found.value, 'COUNT', formula, { distinct_names: found.value }, found.evidenceIds)
      : unavailableMetric('COUNT', formula, ['Không đọc được danh sách người đại diện/được ủy quyền.']);
  }

  private mandatoryProfileCoverage(provenance: ProfileProvenanceResult): MetricResult {
    const formula = 'coverage = trường CIF bắt buộc truy được nguồn chứng từ / tổng trường bắt buộc';
    const covered = provenance.mandatory_fields.filter(
      (field) => field.status === 'VERIFIED' || field.status === 'NEEDS_REVIEW',
    );
    const evidenceIds = provenance.fields
      .filter((field) => covered.some((item) => field.field_path.startsWith(item.field_path)))
      .flatMap((field) => field.evidence_ids);
    return calculatedMetric(
      provenance.mandatory_coverage_percent,
      'PERCENT',
      formula,
      { covered: covered.length, required_total: provenance.mandatory_fields.length },
      evidenceIds,
    );
  }
}

// ─── Stage 4: rà soát khách hàng (CDD) ────────────────────────────────────────
// Năm yếu tố R1..R5. Mọi phát hiện phải dẫn chiếu evidence: finding không có
// evidence hợp lệ bị loại, và một yếu tố "PASS" mà không còn điểm mạnh nào có
// evidence được chấp nhận thì bị hạ xuống REVIEW. Yếu tố không thuộc phạm vi
// phân khúc trả NOT_RUN (không có finding) để không nhiễu kết quả.

function finding(code: string, severity: AssessmentFinding['severity'], message: string, evidenceIds: string[]): AssessmentFinding {
  return { code, severity, message, evidence_ids: [...new Set(evidenceIds)] };
}

function checklistEvidenceIds(registry: EvidenceRegistry, keys: string[], acceptedOnly = false): string[] {
  return registry.records
    .filter((record) => record.evidence_kind === 'CHECKLIST_STATUS'
      && keys.includes(record.doc_type_key)
      && (!acceptedOnly || record.review_status === 'ACCEPTED'))
    .map((record) => record.evidence_id);
}

/** Mọi loại chứng từ trong danh sách đều có trạng thái checklist ACCEPTED. */
function hasAcceptedChecklistEvidence(registry: EvidenceRegistry, keys: string[]): boolean {
  if (keys.length === 0) return false;
  return keys.every((key) => registry.records.some((record) => record.evidence_kind === 'CHECKLIST_STATUS'
    && record.doc_type_key === key
    && record.review_status === 'ACCEPTED'));
}

interface FactorSpec {
  code: CddFactorAssessment['code'];
  name: CddFactorAssessment['name'];
  label: string;
  applicable: boolean;
  status: CddFactorAssessment['status'];
  riskLevel: RiskLevel;
  strengths: AssessmentFinding[];
  weaknesses: AssessmentFinding[];
}

function buildFactor(spec: FactorSpec, registry: EvidenceRegistry): CddFactorAssessment {
  if (!spec.applicable) {
    // Không áp dụng cho phân khúc: NOT_RUN, không sinh finding và không đẩy rủi ro.
    return {
      code: spec.code,
      name: spec.name,
      label: spec.label,
      status: 'NOT_RUN',
      risk_level: 'LOW',
      strengths: [],
      weaknesses: [],
      evidence_ids: [],
      review_required: false,
    };
  }

  const validIds = new Set(registry.records.map((record) => record.evidence_id));
  const acceptedIds = new Set(registry.records.filter((record) => record.review_status === 'ACCEPTED').map((record) => record.evidence_id));
  const sanitize = (items: AssessmentFinding[], positive: boolean) => items
    .map((item) => ({
      ...item,
      evidence_ids: item.evidence_ids.filter((id) => (positive ? acceptedIds : validIds).has(id)),
    }))
    .filter((item) => item.evidence_ids.length > 0);

  const strengths = sanitize(spec.strengths, true);
  const weaknesses = sanitize(spec.weaknesses, false);
  const unsupported = strengths.length !== spec.strengths.length || weaknesses.length !== spec.weaknesses.length;
  const status = unsupported || (spec.status === 'PASS' && strengths.length === 0) ? 'REVIEW' : spec.status;
  // Mất căn cứ ⇒ không được giữ mức rủi ro thấp đã suy ra từ căn cứ đó.
  const riskLevel: RiskLevel = status === 'PASS' ? spec.riskLevel : spec.riskLevel === 'LOW' ? 'MEDIUM' : spec.riskLevel;

  return {
    code: spec.code,
    name: spec.name,
    label: spec.label,
    status,
    risk_level: riskLevel,
    strengths,
    weaknesses,
    evidence_ids: [...new Set([...strengths, ...weaknesses].flatMap((item) => item.evidence_ids))],
    review_required: status !== 'PASS',
  };
}

const NATIONALITY_PATTERNS = [/nationality/i, /quoc_tich/i];
// residency_status là tên field thật do payment-account-management/OCR trả về
// (enum "Cư trú"/"Không cư trú" ở cả cấp tổ chức và cấp người); residential_state
// giữ lại để tương thích ngược với dữ liệu cũ nếu còn tồn tại.
const COUNTRY_PATTERNS = [/residency_status/i, /tax_residency/i, /residential_state/i, /country/i];
const PURPOSE_PATTERNS = [/purpose/i, /account_purpose/i, /registered_services/i];
const FUNDS_PATTERNS = [/source_of_funds/i, /income/i, /revenue/i, /salary/i];
/** Nhận diện loại hình doanh nghiệp một chủ sở hữu (TNHH một thành viên / DNTN). */
const BUSINESS_TYPE_PATTERNS = [/(^|\.)business_type$/i];
const SINGLE_MEMBER_KEYWORDS = ['một thành viên', 'mot thanh vien', 'mtv', 'doanh nghiệp tư nhân', 'doanh nghiep tu nhan'];
/** Định danh chủ sở hữu duy nhất trên GCN đăng ký kinh doanh (field "owner"). */
const OWNER_IDENTITY_PATTERNS = [/(^|\.)owner\.full_name$/i, /(^|\.)owner\.id_no$/i];

/** Giá trị business_type được coi là doanh nghiệp một chủ sở hữu (không có cổ đông kê khai %). */
function isSingleMemberEnterprise(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return SINGLE_MEMBER_KEYWORDS.some((keyword) => normalized.includes(
    keyword.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
  ));
}

/** Giá trị quốc tịch/quốc gia được coi là Việt Nam. */
function isVietnam(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return normalized.includes('viet') || normalized === 'vn';
}

export interface CddStrategyInput {
  evidence: EvidenceRegistry;
  eligibility: EligibilityMetrics;
  checklist: ChecklistItemResult[];
  customerProfile: CustomerProfile;
}

export class CddRiskStrategy implements StageStrategy<CddStrategyInput, CddAssessment> {
  readonly strategyId = 'account-opening-v1:cdd-risk';

  constructor(
    private readonly product: AccountProduct,
    private readonly segment: AccountSegment,
    private readonly policy: AccountOpeningPolicy,
  ) {}

  execute(input: CddStrategyInput): CddAssessment {
    const { evidence, eligibility } = input;
    const isOrganization = this.segment.isOrganization;

    const factors: CddFactorAssessment[] = [
      this.identityFactor(evidence, eligibility),
      this.geographyFactor(evidence),
      this.structureFactor(evidence, eligibility, isOrganization),
      this.purposeFactor(evidence, eligibility),
      this.authorizationFactor(evidence, eligibility, isOrganization),
    ];

    const applicable = factors.filter((factor) => factor.status !== 'NOT_RUN');
    const statuses = applicable.map((factor) => factor.status);
    const overallStatus = statuses.includes('FAIL') ? 'FAIL'
      : statuses.includes('REVIEW') ? 'REVIEW'
        : statuses.includes('PASS_WITH_CONDITIONS') ? 'PASS_WITH_CONDITIONS'
          : applicable.length === 0 ? 'NOT_RUN' : 'PASS';

    // Mức rủi ro = xấu nhất giữa mức nền của phân khúc/sản phẩm và các yếu tố.
    // Thiếu căn cứ để chấm bất kỳ yếu tố nào ⇒ UNDETERMINED, không mặc định LOW.
    const factorRisks = applicable.map((factor) => factor.risk_level);
    const riskRating: RiskLevel = applicable.length === 0
      ? 'UNDETERMINED'
      : highestRiskLevel([this.policy.baselineRiskLevel, ...factorRisks]);

    const escalationReasons: string[] = [];
    if (this.policy.requiresEnhancedDueDiligence) {
      escalationReasons.push(`PRODUCT_REQUIRES_EDD:${this.product.code}`);
    }
    if (this.policy.baselineRiskLevel === 'HIGH') {
      escalationReasons.push(`SEGMENT_BASELINE_RISK_HIGH:${this.segment.key}`);
    }
    for (const factor of applicable) {
      if (factor.risk_level === 'HIGH') escalationReasons.push(`FACTOR_RISK_HIGH:${factor.code}`);
      if (factor.risk_level === 'UNDETERMINED') escalationReasons.push(`FACTOR_RISK_UNDETERMINED:${factor.code}`);
    }

    const dueDiligenceLevel = this.resolveDueDiligenceLevel(riskRating, overallStatus);

    return {
      factors,
      overall_status: overallStatus,
      risk_rating: riskRating,
      due_diligence_level: dueDiligenceLevel,
      escalation_reasons: [...new Set(escalationReasons)],
    };
  }

  /**
   * SDD chỉ dành cho hồ sơ rủi ro thấp đã PASS toàn bộ yếu tố áp dụng; mọi trường
   * hợp vượt ngưỡng sản phẩm hoặc chưa xác định đều rơi về EDD.
   */
  private resolveDueDiligenceLevel(rating: RiskLevel, status: CddAssessment['overall_status']): DueDiligenceLevel {
    if (this.policy.requiresEnhancedDueDiligence) return 'EDD';
    if (rating === 'HIGH' || rating === 'UNDETERMINED') return 'EDD';
    if (rating === 'LOW' && this.policy.baselineRiskLevel === 'LOW' && status === 'PASS') return 'SDD';
    return 'CDD';
  }

  private identityFactor(evidence: EvidenceRegistry, eligibility: EligibilityMetrics): CddFactorAssessment {
    const identityKeys = primaryIdentityDocKeys(this.product);
    const documentsReady = hasAcceptedChecklistEvidence(evidence, identityKeys);
    const validity = eligibility.primary_id_validity_days;
    const validityKnown = validity.status === 'CALCULATED' && validity.value !== null;
    const expired = validityKnown && validity.value! < 0;
    const validityOk = validityKnown && validity.value! >= this.policy.minimumIdValidityDays;

    const strengths: AssessmentFinding[] = [];
    const weaknesses: AssessmentFinding[] = [];
    if (documentsReady && validityOk) {
      strengths.push(finding(
        'IDENTITY_DOCUMENTS_VERIFIED',
        'INFO',
        `Giấy tờ định danh có nguồn bóc tách được chấp nhận và còn hiệu lực ${validity.value} ngày.`,
        [...checklistEvidenceIds(evidence, identityKeys, true), ...validity.evidence_ids],
      ));
    }
    if (!documentsReady) {
      weaknesses.push(finding(
        'IDENTITY_DOCUMENTS_INCOMPLETE',
        'WARNING',
        'Trạng thái checklist cho thấy giấy tờ định danh còn thiếu hoặc chờ rà soát.',
        checklistEvidenceIds(evidence, identityKeys),
      ));
    }
    if (expired) {
      weaknesses.push(finding(
        'IDENTITY_DOCUMENT_EXPIRED',
        'ERROR',
        `Giấy tờ định danh đã hết hạn ${Math.abs(validity.value!)} ngày.`,
        validity.evidence_ids,
      ));
    } else if (!validityKnown) {
      weaknesses.push(finding(
        'IDENTITY_EXPIRY_UNKNOWN',
        'WARNING',
        'Không đọc được ngày hết hạn giấy tờ định danh nên chưa xác thực được hiệu lực.',
        [...checklistEvidenceIds(evidence, identityKeys), ...validity.evidence_ids],
      ));
    } else if (!validityOk) {
      weaknesses.push(finding(
        'IDENTITY_VALIDITY_TOO_SHORT',
        'WARNING',
        `Giấy tờ định danh chỉ còn ${validity.value} ngày, dưới mức yêu cầu ${this.policy.minimumIdValidityDays} ngày.`,
        validity.evidence_ids,
      ));
    }

    return buildFactor({
      code: 'R1',
      name: 'Identity',
      label: 'Định danh & xác thực khách hàng',
      applicable: true,
      status: expired ? 'FAIL' : documentsReady && validityOk ? 'PASS' : 'REVIEW',
      riskLevel: expired ? 'HIGH' : documentsReady && validityOk ? 'LOW' : 'MEDIUM',
      strengths,
      weaknesses,
    }, evidence);
  }

  private geographyFactor(evidence: EvidenceRegistry): CddFactorAssessment {
    const nationality = findTextEvidence(evidence, NATIONALITY_PATTERNS)
      ?? findTextEvidence(evidence, COUNTRY_PATTERNS);
    // Sản phẩm dành cho người không cư trú luôn mang yếu tố nước ngoài, kể cả khi
    // OCR không đọc được quốc tịch.
    const foreignByProduct = this.product.code === 'casa-khcn-nonresident';

    if (!nationality) {
      return buildFactor({
        code: 'R2',
        name: 'Geography',
        label: 'Địa bàn, quốc tịch & cư trú',
        applicable: true,
        status: 'REVIEW',
        riskLevel: foreignByProduct ? 'HIGH' : 'UNDETERMINED',
        strengths: [],
        weaknesses: [finding(
          'GEOGRAPHY_EVIDENCE_MISSING',
          'WARNING',
          'Không đọc được quốc tịch/quốc gia cư trú từ chứng từ nên chưa chấm được yếu tố địa bàn.',
          evidence.records.filter((record) => record.doc_type_key === 'account_form').map((record) => record.evidence_id).slice(0, 3),
        )],
      }, evidence);
    }

    const domestic = isVietnam(nationality.value) && !foreignByProduct;
    return buildFactor({
      code: 'R2',
      name: 'Geography',
      label: 'Địa bàn, quốc tịch & cư trú',
      applicable: true,
      status: domestic ? 'PASS' : 'REVIEW',
      riskLevel: domestic ? 'LOW' : 'HIGH',
      strengths: domestic
        ? [finding('GEOGRAPHY_DOMESTIC', 'INFO', `Khách hàng trong nước (${nationality.value}).`, nationality.evidenceIds)]
        : [],
      weaknesses: domestic
        ? []
        : [finding(
          'GEOGRAPHY_FOREIGN_ELEMENT',
          'WARNING',
          `Hồ sơ có yếu tố nước ngoài (${nationality.value}); cần rà soát danh sách cảnh báo và cư trú thuế.`,
          nationality.evidenceIds,
        )],
    }, evidence);
  }

  private structureFactor(
    evidence: EvidenceRegistry,
    eligibility: EligibilityMetrics,
    isOrganization: boolean,
  ): CddFactorAssessment {
    const coverage = eligibility.beneficial_owner_coverage_percent;
    const ownershipKeys = ['beneficial_owner_declaration', 'ownership_structure']
      .filter((key) => hasDoc(this.product, key));
    const declared = coverage.status === 'CALCULATED' && coverage.value !== null;
    const sufficient = declared && coverage.value! >= this.policy.minimumBeneficialOwnerCoveragePercent;

    return buildFactor({
      code: 'R3',
      name: 'Structure',
      label: 'Cấu trúc sở hữu & chủ sở hữu hưởng lợi',
      applicable: isOrganization && coverage.status !== 'NOT_APPLICABLE',
      status: sufficient ? 'PASS' : 'REVIEW',
      riskLevel: sufficient ? 'LOW' : declared ? 'MEDIUM' : 'HIGH',
      strengths: sufficient
        ? [finding(
          'BENEFICIAL_OWNER_DISCLOSED',
          'INFO',
          `Đã kê khai ${coverage.value!.toFixed(1)}% tỷ lệ sở hữu, đạt mức yêu cầu ${this.policy.minimumBeneficialOwnerCoveragePercent}%.`,
          [...coverage.evidence_ids, ...checklistEvidenceIds(evidence, ownershipKeys, true)],
        )]
        : [],
      weaknesses: sufficient
        ? []
        : [finding(
          declared ? 'BENEFICIAL_OWNER_COVERAGE_LOW' : 'BENEFICIAL_OWNER_NOT_DISCLOSED',
          'WARNING',
          declared
            ? `Tỷ lệ sở hữu kê khai ${coverage.value!.toFixed(1)}% chưa đạt mức ${this.policy.minimumBeneficialOwnerCoveragePercent}%; chuỗi sở hữu chưa truy được đến cá nhân cuối cùng.`
            : 'Chưa kê khai được chủ sở hữu hưởng lợi từ chứng từ trong hồ sơ.',
          [...coverage.evidence_ids, ...checklistEvidenceIds(evidence, ownershipKeys)],
        )],
    }, evidence);
  }

  private purposeFactor(evidence: EvidenceRegistry, eligibility: EligibilityMetrics): CddFactorAssessment {
    const purpose = findTextEvidence(evidence, PURPOSE_PATTERNS, ['account_form']);
    const funds = findTextEvidence(evidence, FUNDS_PATTERNS, ['account_form', 'source_of_funds', 'financial_statement'])
      ?? (eligibility.declared_annual_revenue.status === 'CALCULATED'
        ? { value: String(eligibility.declared_annual_revenue.value), evidenceIds: eligibility.declared_annual_revenue.evidence_ids }
        : null);
    const documented = Boolean(purpose && funds);

    return buildFactor({
      code: 'R4',
      name: 'Purpose',
      label: 'Mục đích mở tài khoản & nguồn tiền',
      applicable: true,
      status: documented ? 'PASS' : 'REVIEW',
      riskLevel: documented ? 'LOW' : 'MEDIUM',
      strengths: documented
        ? [finding(
          'PURPOSE_AND_FUNDS_DOCUMENTED',
          'INFO',
          `Mục đích mở tài khoản và nguồn tiền đều có căn cứ trên chứng từ (${purpose!.value.slice(0, 80)}).`,
          [...purpose!.evidenceIds, ...funds!.evidenceIds],
        )]
        : [],
      weaknesses: documented
        ? []
        : [finding(
          'PURPOSE_OR_FUNDS_UNDOCUMENTED',
          'WARNING',
          'Chưa có đủ căn cứ về mục đích mở tài khoản và/hoặc nguồn tiền dự kiến.',
          [
            ...(purpose?.evidenceIds ?? []),
            ...(funds?.evidenceIds ?? []),
            ...checklistEvidenceIds(evidence, ['account_form', 'source_of_funds']),
          ],
        )],
    }, evidence);
  }

  private authorizationFactor(
    evidence: EvidenceRegistry,
    eligibility: EligibilityMetrics,
    isOrganization: boolean,
  ): CddFactorAssessment {
    const authorizationKeys = ['appointment_decision', 'board_resolution', 'company_charter']
      .filter((key) => hasDoc(this.product, key));
    const documentsReady = hasAcceptedChecklistEvidence(evidence, authorizationKeys);
    const signatories = eligibility.authorized_signatory_count;
    const countKnown = signatories.status === 'CALCULATED' && signatories.value !== null;
    const countOk = countKnown && signatories.value! >= this.policy.minimumAuthorizedSignatories;
    const ready = documentsReady && countOk;

    return buildFactor({
      code: 'R5',
      name: 'Authorization',
      label: 'Thẩm quyền đại diện & ủy quyền',
      applicable: isOrganization && authorizationKeys.length > 0,
      status: ready ? 'PASS' : 'REVIEW',
      riskLevel: ready ? 'LOW' : 'MEDIUM',
      strengths: ready
        ? [finding(
          'AUTHORIZATION_CHAIN_DOCUMENTED',
          'INFO',
          `Văn bản bổ nhiệm/nghị quyết có nguồn được chấp nhận và có ${signatories.value} người ký đăng ký.`,
          [...checklistEvidenceIds(evidence, authorizationKeys, true), ...signatories.evidence_ids],
        )]
        : [],
      weaknesses: ready
        ? []
        : [finding(
          documentsReady ? 'AUTHORIZATION_SIGNATORY_INSUFFICIENT' : 'AUTHORIZATION_DOCUMENTS_INCOMPLETE',
          'WARNING',
          documentsReady
            ? `Số người ký/được ủy quyền (${countKnown ? signatories.value : 'chưa xác định'}) chưa đạt mức ${this.policy.minimumAuthorizedSignatories}.`
            : 'Văn bản bổ nhiệm, nghị quyết hoặc điều lệ chưa đủ evidence được chấp nhận để xác định thẩm quyền.',
          [...checklistEvidenceIds(evidence, authorizationKeys), ...signatories.evidence_ids],
        )],
    }, evidence);
  }
}

// ─── Stage 5: policy & tuân thủ ───────────────────────────────────────────────

export interface PolicyStrategyInput {
  facts: AccountRuleFacts;
  /** Kết quả rule LLM đã chuẩn hoá; gộp chung vào rule_results để đánh giá tổng. */
  promptResults?: RuleResult[];
}

export class PolicyStrategy implements StageStrategy<PolicyStrategyInput, PolicyComplianceResult> {
  readonly strategyId = 'account-opening-v1:policy';

  constructor(
    private readonly policy: AccountOpeningPolicy,
    private readonly checkSet: AccountCheckSet,
  ) {}

  execute({ facts, promptResults = [] }: PolicyStrategyInput): PolicyComplianceResult {
    const results = [
      ...buildRuleSet(this.policy, this.checkSet).map((rule) => rule.evaluate(facts)),
      ...promptResults,
    ];
    return {
      policy_id: this.policy.policyId,
      policy_version: this.policy.policyVersion,
      status: aggregateRuleResults(results),
      rule_results: results,
      exceptions: results.filter((item) => item.result === 'FAIL' && item.exception_allowed).map((item) => item.rule_id),
    };
  }
}

// ─── Stage 6: sàng lọc danh sách cảnh báo ─────────────────────────────────────
// Không có provider nào được cấu hình trong phạm vi workflow này. Strategy trả
// NOT_RUN cho mọi phép sàng lọc thay vì kết quả "sạch" giả — kết luận cuối vẫn
// thuộc hệ thống onboarding có quyền gọi provider thật.

export interface ScreeningStrategyInput {
  customerProfile: CustomerProfile;
  cdd: CddAssessment;
}

export class ScreeningStrategy implements StageStrategy<ScreeningStrategyInput, ScreeningResult> {
  readonly strategyId = 'account-opening-v1:screening';

  constructor(private readonly policy: AccountOpeningPolicy) {}

  execute(input: ScreeningStrategyInput): ScreeningResult {
    const identity = (input.customerProfile.identity ?? {}) as Record<string, unknown>;
    const organization = (input.customerProfile.organization ?? {}) as Record<string, unknown>;
    const subject = [
      identity.full_name,
      identity.legal_representative_name,
      organization.business_name,
    ].find((value): value is string => typeof value === 'string' && !!value.trim()) ?? null;

    const checks: ScreeningResult['checks'] = (['AML', 'PEP', 'SANCTIONS', 'ADVERSE_MEDIA', 'CIF_DUPLICATE', 'BLACKLIST'] as const)
      .map((check) => ({
        check,
        subject,
        status: 'NOT_RUN' as const,
        reason_code: 'PROVIDER_NOT_CONFIGURED',
      }));

    return {
      status: 'NOT_CONFIGURED',
      provider_id: this.policy.screeningProviderId,
      provider_version: this.policy.screeningProviderVersion,
      checks,
      reason_codes: [
        'SCREENING_PROVIDER_NOT_CONFIGURED',
        ...(input.cdd.due_diligence_level === 'EDD' ? ['EDD_SCREENING_REQUIRED'] : []),
      ],
    };
  }
}

// ─── Stage 7: kết luận & định tuyến ───────────────────────────────────────────

export interface DecisionStrategyInput {
  eligibility: EligibilityMetrics;
  policy: PolicyComplianceResult;
  intake: IntakeResult;
  cdd: CddAssessment;
  readiness: DossierReadinessResult;
  screening: ScreeningResult;
}

export class DecisionStrategy implements StageStrategy<DecisionStrategyInput, {
  recommendation: AccountOpeningRecommendation;
  review: ReviewResult;
}> {
  readonly strategyId = 'account-opening-v1:decision';

  constructor(
    private readonly product: AccountProduct,
    private readonly accountPolicy: AccountOpeningPolicy,
  ) {}

  execute(input: DecisionStrategyInput) {
    // Hồ sơ chưa đầy đủ không chặn đánh giá; nó chỉ hạ kết quả xuống mức tạm và
    // chuyển tuyến bổ sung để khách hàng hoàn thiện sau.
    const gate = evaluateAssessmentReadiness(input.readiness);
    const hasMissingDocs = gate.supplementRequired
      || input.intake.missing_required_keys.length > 0
      || input.intake.review_required_keys.length > 0;
    const hasPolicyReview = input.policy.status !== 'PASS';
    const hasCddReview = input.cdd.overall_status !== 'PASS';
    const requiresEdd = input.cdd.due_diligence_level === 'EDD';

    // Không đủ dữ liệu để kết luận: chưa xác định được định danh chủ tài khoản.
    const insufficient = input.eligibility.applicant_age.status !== 'CALCULATED'
      || input.eligibility.primary_id_validity_days.status !== 'CALCULATED';

    const blockedRules = input.policy.rule_results.filter(
      (rule) => rule.result === 'FAIL' && rule.severity === 'BLOCKER' && !rule.exception_allowed,
    );

    const reasonCodes = [
      ...gate.reasonCodes,
      ...(hasMissingDocs ? ['REQUIRED_DOCUMENTS_INCOMPLETE'] : []),
      ...(hasPolicyReview ? ['POLICY_REVIEW_REQUIRED'] : []),
      ...(hasCddReview ? ['CDD_REVIEW_REQUIRED'] : []),
      ...(requiresEdd ? ['ENHANCED_DUE_DILIGENCE_REQUIRED'] : []),
      ...(insufficient ? ['IDENTITY_DATA_INSUFFICIENT'] : []),
      ...blockedRules.map((rule) => rule.reason_code),
      ...input.cdd.escalation_reasons,
      ...input.screening.reason_codes,
    ];

    const recommendation: AccountOpeningRecommendation = {
      recommendation: insufficient
        ? 'INSUFFICIENT_DATA'
        : hasMissingDocs || hasPolicyReview || hasCddReview || requiresEdd
          ? 'REFER'
          : 'ELIGIBLE_TO_OPEN',
      proposed_account_type: insufficient || blockedRules.length > 0 ? null : this.product.accountType,
      risk_rating: input.cdd.risk_rating,
      due_diligence_level: input.cdd.due_diligence_level,
      conditions_precedent: [
        ...input.readiness.supplement_requests,
        'Hoàn tất sàng lọc AML/PEP/sanctions/adverse media và đối chiếu CIF trùng bởi hệ thống được phê duyệt.',
        ...(requiresEdd
          ? [`Thực hiện rà soát tăng cường (EDD) theo mức rủi ro ${input.cdd.risk_rating} trước khi kích hoạt tài khoản.`]
          : []),
        ...(this.accountPolicy.beneficialOwnerThresholdPercent > 0
          ? [`Xác nhận đã kê khai đủ chủ sở hữu hưởng lợi từ ${this.accountPolicy.beneficialOwnerThresholdPercent}% sở hữu.`]
          : []),
      ],
      restrictions: [
        ...(requiresEdd ? ['Chưa kích hoạt giao dịch trực tuyến/quốc tế cho tới khi hoàn tất EDD.'] : []),
        ...(hasMissingDocs ? ['Chỉ mở ở trạng thái chờ hoàn thiện hồ sơ, chưa cho phát sinh giao dịch.'] : []),
      ],
      reason_codes: [...new Set(reasonCodes)],
      review_required: true,
    };

    // Sàng lọc chưa cấu hình ⇒ không hồ sơ nào được đi thẳng: STRAIGHT_THROUGH chỉ
    // khả dụng khi provider sàng lọc đã chạy xong ở phiên bản sau.
    const screeningPending = input.screening.status !== 'COMPLETED';
    const route: ReviewResult['route'] = hasMissingDocs
      ? 'REQUEST_DOCUMENTS'
      : requiresEdd || blockedRules.length > 0
        ? 'COMPLIANCE_REVIEW'
        : hasPolicyReview || hasCddReview || insufficient || screeningPending
          ? 'KYC_REVIEW'
          : 'STRAIGHT_THROUGH';

    const review: ReviewResult = {
      required: route !== 'STRAIGHT_THROUGH',
      route,
      reasons: recommendation.reason_codes,
      required_role: hasMissingDocs
        ? 'ONBOARDING_OFFICER'
        : requiresEdd || blockedRules.length > 0
          ? 'COMPLIANCE_OFFICER'
          : 'KYC_REVIEWER',
    };

    return { recommendation, review };
  }
}
