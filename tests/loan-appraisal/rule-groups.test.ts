import { DEFAULT_CHECK_SET, LOAN_CHECK_CATALOG, parseCheckSet, validateCheckSetValue } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { aggregateRuleResults, buildRuleSet } from '@/lib/pipelines/workflows/loan-appraisal/rules';
import { RULE_GROUPS, RULE_GROUP_KEYS, compareRuleGroups, resolveRuleGroup } from '@/lib/pipelines/workflows/loan-appraisal/rule-groups';
import { deriveProcessingStatus, LOAN_STAGE_DEFINITIONS } from '@/lib/pipelines/workflows/loan-appraisal/state-machine';
import { RecommendationStrategy } from '@/lib/pipelines/workflows/loan-appraisal/strategies';
import { resolveLoanProductPolicy } from '@/lib/pipelines/workflows/loan-appraisal/product-policy';
import type { RuleResult } from '@/lib/pipelines/workflows/loan-appraisal/types';

describe('nhóm rule thẩm định', () => {
  it('mọi rule trong catalog có group hợp lệ và khớp với suy luận từ id', () => {
    for (const check of LOAN_CHECK_CATALOG) {
      expect(RULE_GROUP_KEYS).toContain(check.group);
      expect(resolveRuleGroup({ id: check.id })).toBe(check.group);
    }
  });

  it('gán 6 rule mặc định vào đúng nhóm (REQUIRED_DOCUMENTS đã gỡ cùng các bước kiểm tra hồ sơ)', () => {
    const byId = Object.fromEntries(LOAN_CHECK_CATALOG.map((c) => [c.id, c.group]));
    expect(byId).toEqual({
      'LOAN.CAPACITY.MIN_DSCR': 'CAPACITY',
      'LOAN.COLLATERAL.MAX_LTV': 'COLLATERAL',
      'LOAN.PRODUCT.MAX_AMOUNT': 'LOAN_PLAN',
      'LOAN.CONSISTENCY.BORROWER_IDENTITY': 'DOSSIER',
      'LOAN.COLLATERAL.OWNER_MATCH': 'COLLATERAL',
      'LOAN.PURPOSE.COHERENCE': 'LOAN_PLAN',
    });
  });

  it('suy nhóm cho id cũ HKD.* và rule tuỳ chỉnh; group khai báo hợp lệ thắng suy luận', () => {
    expect(resolveRuleGroup({ rule_id: 'HKD.CAPACITY.MIN_DSCR' })).toBe('CAPACITY');
    expect(resolveRuleGroup({ id: 'LOAN.CUSTOM.CHECK_1' })).toBe('OTHER');
    expect(resolveRuleGroup({ id: 'LOAN.CUSTOM.CHECK_1', group: 'COLLATERAL' })).toBe('COLLATERAL');
    expect(resolveRuleGroup({ id: 'LOAN.CAPACITY.MIN_DSCR', group: 'bogus' })).toBe('CAPACITY');
    expect(resolveRuleGroup({})).toBe('OTHER');
  });

  it('thứ tự nhóm theo RULE_GROUPS', () => {
    expect(RULE_GROUPS.map((g) => g.key)).toEqual([...RULE_GROUP_KEYS]);
    expect(compareRuleGroups('DOSSIER', 'OTHER')).toBeLessThan(0);
  });

  it('parseCheckSet: cấu hình cũ không có group được điền từ catalog; rule tuỳ chỉnh vào OTHER; group sai bị bỏ kèm warning', () => {
    const { checkSet, warnings } = parseCheckSet({
      checks: [
        { id: 'LOAN.CAPACITY.MIN_DSCR', enabled: true },
        { id: 'LOAN.CUSTOM.CHECK_1', name: 'Tuỳ chỉnh', prompt: 'so sánh', group: 'LOAN_PLAN' },
        { id: 'LOAN.CUSTOM.CHECK_2', name: 'Sai nhóm', prompt: 'so sánh', group: 'NOPE' },
      ],
    });
    const group = (id: string) => checkSet.checks.find((c) => c.id === id)?.group;
    expect(group('LOAN.CAPACITY.MIN_DSCR')).toBe('CAPACITY');
    expect(group('LOAN.CUSTOM.CHECK_1')).toBe('LOAN_PLAN');
    expect(group('LOAN.CUSTOM.CHECK_2')).toBe('OTHER');
    expect(warnings.some((w) => w.includes('LOAN.CUSTOM.CHECK_2') && w.includes('group'))).toBe(true);
  });

  it('validateCheckSetValue chặn group không hợp lệ khi ghi cấu hình', () => {
    const base = { id: 'LOAN.CUSTOM.CHECK_1', name: 'x', kind: 'PROMPT', prompt: 'p' };
    expect(validateCheckSetValue({ checks: [{ ...base, group: 'CAPACITY' }] })).toEqual({ ok: true });
    expect(validateCheckSetValue({ checks: [{ ...base, group: 'NOPE' }] })).toMatchObject({ ok: false });
  });
});

describe('bỏ 5C khỏi giai đoạn 2', () => {
  it('không còn stage assess_5c, stress_and_score, consolidate_dossier; 5 stage liên tục', () => {
    const keys = LOAN_STAGE_DEFINITIONS.map((d) => d.key);
    for (const gone of ['assess_5c', 'stress_and_score', 'consolidate_dossier']) expect(keys).not.toContain(gone);
    expect(keys).toEqual(['classify', 'extract_evidence', 'calculate_financials', 'evaluate_policy_compliance', 'synthesize_recommendation']);
  });

  const pass = { result: 'PASS' } as RuleResult;
  const readyReadiness = { status: 'READY_FOR_APPRAISAL', appraisal_conditional: false, blocking_reasons: [], supplement_requests: [] } as never;

  it('deriveProcessingStatus chỉ dựa trên policy + rule + readiness', () => {
    expect(deriveProcessingStatus('PASS', [pass], readyReadiness)).toBe('COMPLETE');
    expect(deriveProcessingStatus('REVIEW', [pass], readyReadiness)).toBe('REVIEW_REQUIRED');
    expect(deriveProcessingStatus('FAIL', [pass], readyReadiness)).toBe('BLOCKED');
    expect(deriveProcessingStatus('PASS', [{ result: 'NOT_RUN' } as RuleResult], readyReadiness)).toBe('PARTIAL');
  });

  it('RecommendationStrategy: rule đều đạt + đủ dữ liệu → CONSIDER (trước đây 5C C3 luôn REVIEW nên luôn REFER)', () => {
    const calculated = (value: number) => ({ status: 'CALCULATED', value, evidence_ids: [], warnings: [] });
    const out = new RecommendationStrategy(resolveLoanProductPolicy('hkd-loan')).execute({
      financial: { requested_amount: calculated(1e9), collateral_value: calculated(3e9), dscr: calculated(2), ltv: calculated(0.3) } as never,
      policy: { status: 'PASS', rule_results: [pass], exceptions: [], external_checks: [], policy_id: 'p', policy_version: '1' } as never,
      intake: { missing_required_keys: [], review_required_keys: [] } as never,
      readiness: readyReadiness,
    });
    expect(out.recommendation.recommendation).toBe('CONSIDER');
    expect(out.recommendation.reason_codes).not.toContain('FIVE_C_EVIDENCE_REVIEW_REQUIRED');
    expect(out.review.route).toBe('CREDIT_REVIEW');
  });

  it('RecommendationStrategy: policy cần rà soát → REFER / RISK_REVIEW', () => {
    const calculated = (value: number) => ({ status: 'CALCULATED', value, evidence_ids: [], warnings: [] });
    const out = new RecommendationStrategy(resolveLoanProductPolicy('hkd-loan')).execute({
      financial: { requested_amount: calculated(1e9), collateral_value: calculated(3e9), dscr: calculated(2), ltv: calculated(0.3) } as never,
      policy: { status: 'REVIEW', rule_results: [], exceptions: [], external_checks: [], policy_id: 'p', policy_version: '1' } as never,
      intake: { missing_required_keys: [], review_required_keys: [] } as never,
      readiness: readyReadiness,
    });
    expect(out.recommendation.recommendation).toBe('REFER');
    expect(out.review.route).toBe('RISK_REVIEW');
  });
});

describe('giai đoạn 2 tạm tắt các bước kiểm tra hồ sơ: khuyến nghị chỉ dựa trên tài chính + rule', () => {
  const pass = { result: 'PASS' } as RuleResult;
  const calc = (value: number) => ({ status: 'CALCULATED', value, unit: 'VND', formula: '', inputs: {}, evidence_ids: [], warnings: [] });
  const notEvaluated = { status: 'NOT_APPLICABLE', value: null, unit: 'RATIO', formula: '', inputs: {}, evidence_ids: [], warnings: ['chưa đánh giá'] };
  const financial = (ltv: unknown) => ({ requested_amount: calc(1e9), collateral_value: ltv === 'ok' ? calc(3e9) : notEvaluated, dscr: calc(2), ltv: ltv === 'ok' ? calc(0.33) : notEvaluated }) as never;
  const policy = (status: string) => ({ status, rule_results: [], exceptions: [], external_checks: [], policy_id: 'p', policy_version: '1' }) as never;
  const strategy = () => new RecommendationStrategy(resolveLoanProductPolicy('hkd-loan'));

  it('không truyền readiness / intake: không bị coi là thiếu chứng từ; LTV chưa đánh giá không làm INSUFFICIENT_DATA', () => {
    const out = strategy().execute({ financial: financial('na'), policy: policy('PASS') });
    expect(out.recommendation.recommendation).toBe('CONSIDER');
    expect(out.review.route).toBe('CREDIT_REVIEW');
    expect(out.recommendation.reason_codes).not.toContain('REQUIRED_DOCUMENTS_INCOMPLETE');
    expect(out.recommendation.reason_codes).not.toContain('DOSSIER_READINESS_UNKNOWN');
    expect(out.recommendation.reason_codes).not.toContain('FINANCIAL_INPUT_INSUFFICIENT');
    expect(out.recommendation.conditions_precedent).toEqual(['Hoàn tất AML/PEP/sanctions bởi hệ thống/provider được phê duyệt.']);
  });

  it('policy cần rà soát vẫn → REFER / RISK_REVIEW; DSCR thiếu → INSUFFICIENT_DATA', () => {
    expect(strategy().execute({ financial: financial('na'), policy: policy('REVIEW') }).recommendation.recommendation).toBe('REFER');
    const noDscr = { ...(financial('na') as object), dscr: { ...(calc(0) as object), status: 'INSUFFICIENT_DATA', value: null } } as never;
    expect(strategy().execute({ financial: noDscr, policy: policy('PASS') }).recommendation.recommendation).toBe('INSUFFICIENT_DATA');
  });

  it('deriveProcessingStatus không truyền readiness: chỉ dựa trên policy và rule (trước đây luôn REVIEW_REQUIRED)', () => {
    expect(deriveProcessingStatus('PASS', [pass])).toBe('COMPLETE');
    expect(deriveProcessingStatus('REVIEW', [pass])).toBe('REVIEW_REQUIRED');
    expect(deriveProcessingStatus('FAIL', [pass])).toBe('BLOCKED');
  });

  it('rule LTV: chỉ số NOT_APPLICABLE → kết quả NOT_APPLICABLE (không làm policy REVIEW)', () => {
    const rule = buildRuleSet(resolveLoanProductPolicy('hkd-loan'), DEFAULT_CHECK_SET).find((r) => r.ruleId === 'LOAN.COLLATERAL.MAX_LTV')!;
    const res = rule.evaluate({ financial: financial('na') });
    expect(res.result).toBe('NOT_APPLICABLE');
    expect(res.reason_code).toBe('LTV_NOT_EVALUATED');
    expect(aggregateRuleResults([res])).toBe('PASS');
  });

  it('rule REQUIRED_DOCUMENTS đã gỡ: không có trong catalog / bộ rule; cấu hình cũ còn id này được bỏ êm (không warning, vẫn hợp lệ khi lưu)', () => {
    expect(LOAN_CHECK_CATALOG.map((c) => c.id)).not.toContain('LOAN.INTAKE.REQUIRED_DOCUMENTS');
    expect(buildRuleSet(resolveLoanProductPolicy('hkd-loan'), DEFAULT_CHECK_SET).map((r) => r.ruleId)).not.toContain('LOAN.INTAKE.REQUIRED_DOCUMENTS');
    for (const id of ['LOAN.INTAKE.REQUIRED_DOCUMENTS', 'HKD.INTAKE.REQUIRED_DOCUMENTS']) {
      const parsed = parseCheckSet({ checks: [{ id, enabled: true }, { id: 'LOAN.CAPACITY.MIN_DSCR', enabled: true }] });
      expect(parsed.checkSet.checks.map((c) => c.id)).not.toContain('LOAN.INTAKE.REQUIRED_DOCUMENTS');
      expect(parsed.warnings.filter((w) => w.includes('REQUIRED_DOCUMENTS'))).toEqual([]);
      expect(validateCheckSetValue({ checks: [{ id, enabled: true }] })).toEqual({ ok: true });
    }
  });
});
