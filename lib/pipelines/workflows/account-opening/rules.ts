// Rule engine deterministic của hồ sơ mở tài khoản (Specification pattern).
//
// Config (check set) quyết định rule nào chạy, severity, exception và tham số
// ngưỡng; PHÉP SO SÁNH luôn nằm trong code để kết quả tái lập được. Thiếu dữ liệu
// thì trả INSUFFICIENT_DATA — không bao giờ suy đoán thành PASS hay FAIL.

import type { ChecklistItemResult } from '../prompts/account-opening-prompts';
import { compareRiskLevel } from './state-machine';
import type { AccountCheckDefinition, AccountCheckSet } from './check-set';
import type { AccountOpeningPolicy } from './segment-policy';
import type { CddAssessment, EligibilityMetrics, MetricResult, RuleResult } from './types';

export interface AccountRuleFacts {
  checklist: ChecklistItemResult[];
  eligibility: EligibilityMetrics;
  cdd: CddAssessment;
}

export interface AccountRule<TFacts> {
  readonly ruleId: string;
  readonly version: string;
  evaluate(facts: TFacts): RuleResult;
}

/**
 * Rule engine lấy severity, exception_allowed, version, phạm vi và tham số ngưỡng
 * từ cấu hình check set.
 */
abstract class BaseRule implements AccountRule<AccountRuleFacts> {
  constructor(protected readonly definition: AccountCheckDefinition) {}

  get ruleId(): string { return this.definition.id; }
  get version(): string { return this.definition.version; }

  abstract evaluate(facts: AccountRuleFacts): RuleResult;

  protected result(
    input: Omit<RuleResult, 'rule_id' | 'rule_version' | 'severity' | 'exception_allowed' | 'check_kind' | 'check_name' | 'check_scope'>,
  ): RuleResult {
    return {
      rule_id: this.ruleId,
      rule_version: this.version,
      severity: this.definition.severity,
      exception_allowed: this.definition.exception_allowed,
      check_kind: 'DETERMINISTIC',
      check_name: this.definition.name,
      check_scope: { segments: this.definition.segments, products: this.definition.products },
      ...input,
    };
  }

  /** Chỉ tiêu không áp dụng cho phân khúc này ⇒ NOT_APPLICABLE, không phải FAIL. */
  protected notApplicable(metric: MetricResult, reasonCode: string, message: string): RuleResult {
    return this.result({
      result: 'NOT_APPLICABLE',
      expected: null,
      actual: null,
      reason_code: reasonCode,
      message,
      evidence_ids: metric.evidence_ids,
    });
  }
}

export class RequiredDocumentsRule extends BaseRule {
  evaluate(facts: AccountRuleFacts): RuleResult {
    const missing = facts.checklist.filter((item) => item.required && item.status !== 'present');
    return this.result({
      result: missing.length === 0 ? 'PASS' : 'REVIEW',
      expected: 'Tất cả chứng từ bắt buộc của phân khúc ở trạng thái present',
      actual: missing.map((item) => item.key),
      reason_code: missing.length === 0 ? 'REQUIRED_DOCUMENTS_PRESENT' : 'REQUIRED_DOCUMENTS_INCOMPLETE',
      message: missing.length === 0
        ? 'Đã có đủ chứng từ bắt buộc.'
        : `Cần rà soát/bổ sung ${missing.length} chứng từ bắt buộc.`,
      evidence_ids: [],
    });
  }
}

/**
 * Hiệu lực giấy tờ định danh. Lấy mốc xấu nhất giữa giấy tờ chính và giấy tờ cư
 * trú (thị thực/thẻ tạm trú) vì cả hai đều phải còn hiệu lực.
 */
export class DocumentValidityRule extends BaseRule {
  constructor(definition: AccountCheckDefinition, private readonly minimumDays: number) { super(definition); }

  evaluate(facts: AccountRuleFacts): RuleResult {
    const candidates = [facts.eligibility.primary_id_validity_days, facts.eligibility.residency_permit_validity_days]
      .filter((metric) => metric.status === 'CALCULATED' && metric.value !== null);

    if (candidates.length === 0) {
      const evidenceIds = [
        ...facts.eligibility.primary_id_validity_days.evidence_ids,
        ...facts.eligibility.residency_permit_validity_days.evidence_ids,
      ];
      return this.result({
        result: 'INSUFFICIENT_DATA',
        expected: { minimum_days: this.minimumDays },
        actual: null,
        reason_code: 'ID_EXPIRY_NOT_FOUND',
        message: 'Không đọc được ngày hết hạn giấy tờ định danh nên chưa kết luận được hiệu lực.',
        evidence_ids: [...new Set(evidenceIds)],
      });
    }

    const worst = candidates.reduce((lowest, metric) => (metric.value! < lowest.value! ? metric : lowest));
    const days = worst.value!;
    const pass = days >= this.minimumDays;
    return this.result({
      result: pass ? 'PASS' : 'FAIL',
      expected: { minimum_days: this.minimumDays },
      actual: days,
      reason_code: days < 0 ? 'ID_DOCUMENT_EXPIRED' : pass ? 'ID_VALIDITY_SUFFICIENT' : 'ID_VALIDITY_BELOW_MINIMUM',
      message: days < 0
        ? `Giấy tờ định danh đã hết hạn ${Math.abs(days)} ngày.`
        : `Giấy tờ định danh còn hiệu lực ${days} ngày; yêu cầu tối thiểu ${this.minimumDays} ngày.`,
      evidence_ids: worst.evidence_ids,
    });
  }
}

export class MinimumAgeRule extends BaseRule {
  constructor(
    definition: AccountCheckDefinition,
    private readonly minimumAge: number,
    private readonly maximumAge: number | null,
  ) { super(definition); }

  evaluate(facts: AccountRuleFacts): RuleResult {
    const metric = facts.eligibility.applicant_age;
    if (metric.status !== 'CALCULATED' || metric.value === null) {
      return this.result({
        result: 'INSUFFICIENT_DATA',
        expected: { minimum_age: this.minimumAge, maximum_age: this.maximumAge },
        actual: null,
        reason_code: 'DATE_OF_BIRTH_MISSING',
        message: 'Không xác định được ngày sinh của chủ tài khoản / người đại diện.',
        evidence_ids: metric.evidence_ids,
      });
    }
    const age = metric.value;
    const tooYoung = age < this.minimumAge;
    const tooOld = this.maximumAge !== null && age > this.maximumAge;
    const pass = !tooYoung && !tooOld;
    return this.result({
      result: pass ? 'PASS' : 'FAIL',
      expected: { minimum_age: this.minimumAge, maximum_age: this.maximumAge },
      actual: age,
      reason_code: tooYoung ? 'APPLICANT_BELOW_MINIMUM_AGE' : tooOld ? 'APPLICANT_ABOVE_MAXIMUM_AGE' : 'APPLICANT_AGE_ELIGIBLE',
      message: pass
        ? `Tuổi ${age} đạt điều kiện sản phẩm.`
        : tooYoung
          ? `Tuổi ${age} chưa đạt mức tối thiểu ${this.minimumAge}.`
          : `Tuổi ${age} vượt mức tối đa ${this.maximumAge}.`,
      evidence_ids: metric.evidence_ids,
    });
  }
}

export class BeneficialOwnerDisclosureRule extends BaseRule {
  constructor(
    definition: AccountCheckDefinition,
    private readonly minimumCoveragePercent: number,
    private readonly disclosureThresholdPercent: number,
  ) { super(definition); }

  evaluate(facts: AccountRuleFacts): RuleResult {
    const metric = facts.eligibility.beneficial_owner_coverage_percent;
    if (metric.status === 'NOT_APPLICABLE') {
      return this.notApplicable(
        metric,
        'BENEFICIAL_OWNER_NOT_APPLICABLE',
        'Phân khúc không yêu cầu kê khai chủ sở hữu hưởng lợi.',
      );
    }
    if (metric.status !== 'CALCULATED' || metric.value === null) {
      return this.result({
        result: 'INSUFFICIENT_DATA',
        expected: {
          minimum_coverage_percent: this.minimumCoveragePercent,
          disclosure_threshold_percent: this.disclosureThresholdPercent,
        },
        actual: null,
        reason_code: 'BENEFICIAL_OWNER_DECLARATION_MISSING',
        message: 'Không đọc được tỷ lệ sở hữu của chủ sở hữu hưởng lợi từ hồ sơ.',
        evidence_ids: metric.evidence_ids,
      });
    }
    const pass = metric.value >= this.minimumCoveragePercent;
    return this.result({
      result: pass ? 'PASS' : 'FAIL',
      expected: {
        minimum_coverage_percent: this.minimumCoveragePercent,
        disclosure_threshold_percent: this.disclosureThresholdPercent,
      },
      actual: metric.value,
      reason_code: pass ? 'BENEFICIAL_OWNER_DISCLOSURE_SUFFICIENT' : 'BENEFICIAL_OWNER_DISCLOSURE_INCOMPLETE',
      message: `Tổng tỷ lệ sở hữu kê khai ${metric.value.toFixed(1)}%; yêu cầu tối thiểu `
        + `${this.minimumCoveragePercent}% (ngưỡng phải kê khai: từ ${this.disclosureThresholdPercent}% sở hữu).`,
      evidence_ids: metric.evidence_ids,
    });
  }
}

export class AuthorizedSignatoryRule extends BaseRule {
  constructor(definition: AccountCheckDefinition, private readonly minimumCount: number) { super(definition); }

  evaluate(facts: AccountRuleFacts): RuleResult {
    const metric = facts.eligibility.authorized_signatory_count;
    if (metric.status === 'NOT_APPLICABLE') {
      return this.notApplicable(
        metric,
        'SIGNATORY_NOT_APPLICABLE',
        'Phân khúc không yêu cầu đăng ký nhiều người ký trên tài khoản.',
      );
    }
    if (metric.status !== 'CALCULATED' || metric.value === null) {
      return this.result({
        result: 'INSUFFICIENT_DATA',
        expected: { minimum_count: this.minimumCount },
        actual: null,
        reason_code: 'SIGNATORY_LIST_MISSING',
        message: 'Không đọc được danh sách người đại diện/người được ủy quyền trên biểu mẫu.',
        evidence_ids: metric.evidence_ids,
      });
    }
    const pass = metric.value >= this.minimumCount;
    return this.result({
      result: pass ? 'PASS' : 'REVIEW',
      expected: { minimum_count: this.minimumCount },
      actual: metric.value,
      reason_code: pass ? 'SIGNATORY_COUNT_SUFFICIENT' : 'SIGNATORY_COUNT_BELOW_MINIMUM',
      message: `Có ${metric.value} người ký/được ủy quyền; yêu cầu tối thiểu ${this.minimumCount}.`,
      evidence_ids: metric.evidence_ids,
    });
  }
}

/**
 * Mức rủi ro so với ngưỡng xử lý của sản phẩm. Vượt ngưỡng KHÔNG phải FAIL:
 * hồ sơ vẫn được xử lý nhưng phải chuyển tuyến rà soát tăng cường (EDD).
 */
export class DueDiligenceLevelRule extends BaseRule {
  constructor(private readonly policy: AccountOpeningPolicy, definition: AccountCheckDefinition) { super(definition); }

  evaluate(facts: AccountRuleFacts): RuleResult {
    const { risk_rating: rating, due_diligence_level: level, factors } = facts.cdd;
    const evidenceIds = [...new Set(factors.flatMap((factor) => factor.evidence_ids))];

    if (rating === 'UNDETERMINED') {
      return this.result({
        result: 'INSUFFICIENT_DATA',
        expected: { maximum_risk_without_edd: this.policy.maximumRiskWithoutEdd },
        actual: { risk_rating: rating, due_diligence_level: level },
        reason_code: 'RISK_RATING_UNDETERMINED',
        message: 'Chưa đủ evidence để xếp mức rủi ro khách hàng.',
        evidence_ids: evidenceIds,
      });
    }

    const withinThreshold = compareRiskLevel(rating, this.policy.maximumRiskWithoutEdd) <= 0
      && !this.policy.requiresEnhancedDueDiligence;
    return this.result({
      result: withinThreshold ? 'PASS' : 'REVIEW',
      expected: {
        maximum_risk_without_edd: this.policy.maximumRiskWithoutEdd,
        requires_edd: this.policy.requiresEnhancedDueDiligence,
      },
      actual: { risk_rating: rating, due_diligence_level: level },
      reason_code: withinThreshold ? 'RISK_WITHIN_PRODUCT_THRESHOLD' : 'ENHANCED_DUE_DILIGENCE_REQUIRED',
      message: withinThreshold
        ? `Mức rủi ro ${rating} trong ngưỡng xử lý ${this.policy.maximumRiskWithoutEdd} của sản phẩm.`
        : `Mức rủi ro ${rating} yêu cầu rà soát tăng cường (${level}) trước khi mở tài khoản.`,
      evidence_ids: evidenceIds,
    });
  }
}

/**
 * Dựng rule engine từ check set. Chỉ những kiểm tra DETERMINISTIC đang bật và có
 * cài đặt trong code được đưa vào; tham số lấy từ config, thiếu thì lấy ngưỡng
 * policy của phân khúc/sản phẩm.
 */
export function buildRuleSet(
  policy: AccountOpeningPolicy,
  checkSet: AccountCheckSet,
): AccountRule<AccountRuleFacts>[] {
  const rules: AccountRule<AccountRuleFacts>[] = [];
  for (const definition of checkSet.checks) {
    if (!definition.enabled || definition.kind !== 'DETERMINISTIC') continue;
    switch (definition.id) {
      case 'AO.INTAKE.REQUIRED_DOCUMENTS':
        rules.push(new RequiredDocumentsRule(definition));
        break;
      case 'AO.IDENTITY.DOCUMENT_VALIDITY':
        rules.push(new DocumentValidityRule(definition, definition.params?.minimum_days ?? policy.minimumIdValidityDays));
        break;
      case 'AO.ELIGIBILITY.MIN_AGE':
        rules.push(new MinimumAgeRule(
          definition,
          definition.params?.minimum_age ?? policy.minimumAgeYears,
          definition.params?.maximum_age ?? policy.maximumAgeYears,
        ));
        break;
      case 'AO.OWNERSHIP.BENEFICIAL_OWNER_DISCLOSURE':
        rules.push(new BeneficialOwnerDisclosureRule(
          definition,
          definition.params?.minimum_percent ?? policy.minimumBeneficialOwnerCoveragePercent,
          policy.beneficialOwnerThresholdPercent,
        ));
        break;
      case 'AO.AUTHORIZATION.SIGNATORY_REGISTERED':
        rules.push(new AuthorizedSignatoryRule(
          definition,
          definition.params?.minimum_count ?? policy.minimumAuthorizedSignatories,
        ));
        break;
      case 'AO.RISK.DUE_DILIGENCE_LEVEL':
        rules.push(new DueDiligenceLevelRule(policy, definition));
        break;
      default:
        break;
    }
  }
  return rules;
}

export function aggregateRuleResults(results: RuleResult[]): 'PASS' | 'PASS_WITH_CONDITIONS' | 'FAIL' | 'REVIEW' {
  if (results.some((item) => item.result === 'FAIL' && item.severity === 'BLOCKER' && !item.exception_allowed)) return 'FAIL';
  if (results.some((item) => item.result === 'REVIEW' || item.result === 'INSUFFICIENT_DATA' || item.result === 'NOT_RUN')) return 'REVIEW';
  if (results.some((item) => item.result === 'FAIL' && item.exception_allowed)) return 'PASS_WITH_CONDITIONS';
  if (results.some((item) => item.result === 'FAIL')) return 'REVIEW';
  return 'PASS';
}
