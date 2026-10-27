import type { FinancialMetrics, RuleResult } from './types';
import type { LoanProductPolicy } from './product-policy';
import type { LoanCheckDefinition, LoanCheckSet } from './check-set';
import { resolveRuleGroup } from './rule-groups';

export interface LoanRuleFacts {
  financial: FinancialMetrics;
}

export interface CreditRule<TFacts> {
  readonly ruleId: string;
  readonly version: string;
  evaluate(facts: TFacts): RuleResult;
}

/**
 * Rule engine lấy severity, exception_allowed, version và tham số ngưỡng từ
 * cấu hình check set. Bản thân phép so sánh vẫn nằm trong code để kết quả
 * tái lập được — config không thể đổi cách tính.
 */
abstract class BaseRule implements CreditRule<LoanRuleFacts> {
  constructor(protected readonly definition: LoanCheckDefinition) {}

  get ruleId(): string { return this.definition.id; }
  get version(): string { return this.definition.version; }

  abstract evaluate(facts: LoanRuleFacts): RuleResult;

  /** MD-R10: đầu vào là trường CONFLICT của master_dossier → REVIEW, không FAIL/PASS. */
  protected conflict(metric: { warnings: string[]; evidence_ids: string[] }): RuleResult {
    return this.result({
      result: 'REVIEW', expected: null, actual: null, reason_code: 'INPUT_VALUE_CONFLICT',
      message: metric.warnings.find((w) => w.startsWith('Các bản của cùng chứng từ')) ?? 'Đầu vào không thống nhất giữa các bản; cần rà soát.',
      evidence_ids: metric.evidence_ids,
    });
  }

  protected result(
    input: Omit<RuleResult, 'rule_id' | 'rule_version' | 'severity' | 'exception_allowed' | 'check_kind' | 'check_name' | 'group'>,
  ): RuleResult {
    return {
      rule_id: this.ruleId,
      rule_version: this.version,
      severity: this.definition.severity,
      exception_allowed: this.definition.exception_allowed,
      check_kind: 'DETERMINISTIC',
      check_name: this.definition.name,
      group: resolveRuleGroup(this.definition),
      ...input,
    };
  }
}

export class MinimumDscrRule extends BaseRule {
  constructor(definition: LoanCheckDefinition, private readonly minimum: number) { super(definition); }

  evaluate(facts: LoanRuleFacts): RuleResult {
    const metric = facts.financial.dscr;
    if (metric.input_conflict) return this.conflict(metric);
    if (metric.status !== 'CALCULATED' || metric.value === null) {
      return this.result({
        result: 'INSUFFICIENT_DATA', expected: { minimum: this.minimum }, actual: null,
        reason_code: 'DSCR_INPUT_MISSING', message: 'Không đủ dữ liệu CFADS/nghĩa vụ nợ để tính DSCR.',
        evidence_ids: metric.evidence_ids,
      });
    }
    const pass = metric.value >= this.minimum;
    return this.result({
      result: pass ? 'PASS' : 'FAIL', expected: { minimum: this.minimum }, actual: metric.value,
      reason_code: pass ? 'DSCR_THRESHOLD_MET' : 'DSCR_BELOW_MINIMUM',
      message: `DSCR ${metric.value.toFixed(2)}×; ngưỡng ${this.minimum.toFixed(2)}×.`,
      evidence_ids: metric.evidence_ids,
    });
  }
}

export class MaximumLtvRule extends BaseRule {
  constructor(definition: LoanCheckDefinition, private readonly maximum: number) { super(definition); }

  evaluate(facts: LoanRuleFacts): RuleResult {
    const metric = facts.financial.ltv;
    if (metric.input_conflict) return this.conflict(metric);
    if (metric.status === 'NOT_APPLICABLE') {
      return this.result({
        result: 'NOT_APPLICABLE', expected: { maximum: this.maximum }, actual: null,
        reason_code: 'LTV_NOT_EVALUATED', message: metric.warnings[0] ?? 'Chưa đánh giá LTV.',
        evidence_ids: [],
      });
    }
    if (metric.status !== 'CALCULATED' || metric.value === null) {
      return this.result({
        result: 'INSUFFICIENT_DATA', expected: { maximum: this.maximum }, actual: null,
        reason_code: 'LTV_INPUT_MISSING', message: 'Không đủ số tiền đề nghị hoặc giá trị TSBĐ để tính LTV.',
        evidence_ids: metric.evidence_ids,
      });
    }
    const pass = metric.value <= this.maximum;
    return this.result({
      result: pass ? 'PASS' : 'FAIL', expected: { maximum: this.maximum }, actual: metric.value,
      reason_code: pass ? 'LTV_THRESHOLD_MET' : 'LTV_ABOVE_MAXIMUM',
      message: `LTV ${(metric.value * 100).toFixed(1)}%; trần ${(this.maximum * 100).toFixed(1)}%.`,
      evidence_ids: metric.evidence_ids,
    });
  }
}

export class MaximumAmountRule extends BaseRule {
  constructor(definition: LoanCheckDefinition, private readonly maximumVnd: number) { super(definition); }

  evaluate(facts: LoanRuleFacts): RuleResult {
    const metric = facts.financial.requested_amount;
    if (metric.input_conflict) return this.conflict(metric);
    if (metric.status !== 'CALCULATED' || metric.value === null) {
      return this.result({
        result: 'INSUFFICIENT_DATA', expected: { maximum_vnd: this.maximumVnd }, actual: null,
        reason_code: 'REQUESTED_AMOUNT_MISSING', message: 'Không xác định được số tiền đề nghị vay.',
        evidence_ids: metric.evidence_ids,
      });
    }
    const pass = metric.value <= this.maximumVnd;
    return this.result({
      result: pass ? 'PASS' : 'FAIL', expected: { maximum_vnd: this.maximumVnd }, actual: metric.value,
      reason_code: pass ? 'AMOUNT_WITHIN_PRODUCT_LIMIT' : 'AMOUNT_ABOVE_PRODUCT_LIMIT',
      message: pass ? 'Số tiền đề nghị trong hạn mức sản phẩm.' : 'Số tiền đề nghị vượt hạn mức sản phẩm.',
      evidence_ids: metric.evidence_ids,
    });
  }
}

/**
 * Dựng rule engine từ check set. Chỉ những kiểm tra DETERMINISTIC đang bật và
 * có cài đặt trong code được đưa vào; tham số lấy từ config, thiếu thì lấy
 * ngưỡng policy.
 */
export function buildRuleSet(policy: LoanProductPolicy, checkSet: LoanCheckSet): CreditRule<LoanRuleFacts>[] {
  const rules: CreditRule<LoanRuleFacts>[] = [];
  for (const definition of checkSet.checks) {
    if (!definition.enabled || definition.kind !== 'DETERMINISTIC') continue;
    switch (definition.id) {
      case 'LOAN.CAPACITY.MIN_DSCR':
        rules.push(new MinimumDscrRule(definition, definition.params?.minimum ?? policy.minimumDscr));
        break;
      case 'LOAN.COLLATERAL.MAX_LTV':
        rules.push(new MaximumLtvRule(definition, definition.params?.maximum ?? policy.maximumLtv));
        break;
      case 'LOAN.PRODUCT.MAX_AMOUNT':
        rules.push(new MaximumAmountRule(definition, definition.params?.maximum_vnd ?? policy.maximumAmountVnd));
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
