import { defaultCheckSet } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { toCheckResult } from '@/lib/pipelines/workflows/loan-appraisal/check-contract';
import { aggregateRuleResults, MaximumAmountRule, MaximumLtvRule, MinimumDscrRule } from '@/lib/pipelines/workflows/loan-appraisal/rules';
import type { MetricResult } from '@/lib/pipelines/workflows/loan-appraisal/types';

const checks = defaultCheckSet('FULL', 'hkd-loan').checks;
const definition = (id: string) => checks.find((check) => check.id === id)!;

describe('D-101: rule chỉ PASS sau khi đầu vào đủ tin cậy', () => {
  const cases = [
    { name: 'DSCR', key: 'dscr', rule: new MinimumDscrRule(definition('LOAN.CAPACITY.MIN_DSCR'), 1.25), pass: 1.4, fail: 0.9, expected: { minimum: 1.25 }, missing: 'DSCR_INPUT_MISSING' },
    { name: 'LTV', key: 'ltv', rule: new MaximumLtvRule(definition('LOAN.COLLATERAL.MAX_LTV'), 0.7), pass: 0.6, fail: 0.8, expected: { maximum: 0.7 }, missing: 'LTV_INPUT_MISSING' },
    { name: 'MAX_AMOUNT', key: 'requested_amount', rule: new MaximumAmountRule(definition('LOAN.PRODUCT.MAX_AMOUNT'), 100), pass: 90, fail: 110, expected: { maximum_vnd: 100 }, missing: 'REQUESTED_AMOUNT_MISSING' },
  ] as const;

  describe.each(cases)('$name', ({ key, rule, pass, fail, expected, missing }) => {
    const metric = (value: number | null, needsReview?: boolean): MetricResult => ({
      status: value === null ? 'INSUFFICIENT_DATA' : 'CALCULATED', value,
      unit: key === 'requested_amount' ? 'VND' : 'RATIO', formula: '', inputs: {}, warnings: [],
      evidence_ids: ['accepted-input', 'low-confidence-input'],
      ...(needsReview === undefined ? {} : { needs_review: needsReview, review_evidence_ids: ['low-confidence-input'] }),
    });
    const evaluate = (input: MetricResult) => rule.evaluate({ financial: {
      requested_amount: metric(90), annual_revenue: metric(null), annual_operating_profit: metric(null),
      annual_debt_service: metric(null), cfads: metric(null), dscr: metric(1.4),
      collateral_value: metric(150), ltv: metric(0.6), operating_margin: metric(null),
      [key]: input,
    } });

    it('đổi PASS thành REVIEW, giữ ngưỡng, giá trị và toàn bộ evidence', () => {
      const result = evaluate(metric(pass, true));
      expect(result).toMatchObject({ result: 'REVIEW', reason_code: 'INPUT_NEEDS_REVIEW', expected, actual: pass, evidence_ids: ['accepted-input', 'low-confidence-input'] });
      expect(result.message).toContain('độ tin cậy thấp');
      expect(aggregateRuleResults([result])).toBe('REVIEW');
      expect(toCheckResult(result)).toMatchObject({ outcome: 'REVIEW', code: 'INPUT_NEEDS_REVIEW', measure: { expected, actual: pass } });
    });

    it.each([undefined, false])('giữ PASS khi needs_review = %s', (flag) => {
      expect(evaluate(metric(pass, flag)).result).toBe('PASS');
    });

    it('giữ FAIL dù đầu vào cần rà soát', () => {
      expect(evaluate(metric(fail, true))).toEqual(evaluate(metric(fail)));
      expect(evaluate(metric(fail, true)).result).toBe('FAIL');
    });

    it('giữ INSUFFICIENT_DATA dù đầu vào cần rà soát', () => {
      expect(evaluate(metric(null, true))).toEqual(evaluate(metric(null)));
      expect(evaluate(metric(null, true))).toMatchObject({ result: 'INSUFFICIENT_DATA', reason_code: missing });
    });
  });
});
