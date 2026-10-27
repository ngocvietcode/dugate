import {
  isEmptyValue,
  type AppraisalEvaluation,
  type ChecklistItemResult,
  type ClassifiedDoc,
  type ExtractedDoc,
} from '../prompts/loan-appraisal-prompts';
import { findMoneyEvidence, findParsedEvidence } from './evidence';
import type { FinancialInputs } from './financial-inputs';
import { aggregateRuleResults, buildRuleSet, type LoanRuleFacts } from './rules';
import { evaluateAppraisalReadiness } from './state-machine';
import type { LoanProductPolicy } from './product-policy';
import type { LoanCheckSet } from './check-set';
import type {
  DossierReadinessResult,
  EvidenceRegistry,
  FinancialMetrics,
  IntakeResult,
  LoanRecommendation,
  MetricResult,
  PolicyComplianceResult,
  ReviewResult,
  RuleResult,
} from './types';

export interface StageStrategy<I, O> {
  readonly strategyId: string;
  execute(input: I): O;
}

/** Tiền tố cảnh báo khi đầu vào bị bỏ vì xung đột giữa các bản (MD-R13). */
export const CONFLICT_PREFIX = 'Các bản của cùng chứng từ ghi khác nhau';

/** Chỉ số thiếu vì đầu vào xung đột: cảnh báo nêu trường, gắn cờ input_conflict. */
function conflictMetric(unit: MetricResult['unit'], formula: string, field: string): MetricResult {
  return { ...unavailableMetric(unit, formula, [`${CONFLICT_PREFIX} (${field}); cần rà soát trước khi tính.`]), input_conflict: true };
}

function unavailableMetric(unit: MetricResult['unit'], formula: string, warnings: string[], evidenceIds: string[] = []): MetricResult {
  return { status: 'INSUFFICIENT_DATA', value: null, unit, formula, inputs: {}, evidence_ids: [...new Set(evidenceIds)], warnings };
}

/** Chỉ số không đánh giá (khác với thiếu dữ liệu): rule đọc nó ra NOT_APPLICABLE, không hạ kết luận chung. */
function notEvaluatedMetric(unit: MetricResult['unit'], formula: string, warning: string): MetricResult {
  return { status: 'NOT_APPLICABLE', value: null, unit, formula, inputs: {}, evidence_ids: [], warnings: [warning] };
}

function sourceMetric(value: number, evidenceIds: string[], unit: MetricResult['unit'], label: string): MetricResult {
  return {
    status: 'CALCULATED', value, unit, formula: label, inputs: { source_value: value },
    evidence_ids: evidenceIds, warnings: [],
  };
}

function ratioMetric(
  numerator: MetricResult,
  denominator: MetricResult,
  formula: string,
  unit: MetricResult['unit'],
): MetricResult {
  if (numerator.status !== 'CALCULATED' || denominator.status !== 'CALCULATED' || numerator.value === null || denominator.value === null || denominator.value <= 0) {
    const conflictWarnings = [...numerator.warnings, ...denominator.warnings].filter((w) => w.startsWith(CONFLICT_PREFIX));
    const m = unavailableMetric(unit, formula, ['Thiếu dữ liệu đầu vào đã xác thực.', ...conflictWarnings], [...numerator.evidence_ids, ...denominator.evidence_ids]);
    return numerator.input_conflict || denominator.input_conflict ? { ...m, input_conflict: true } : m;
  }
  return {
    status: 'CALCULATED', value: numerator.value / denominator.value, unit, formula,
    inputs: { numerator: numerator.value, denominator: denominator.value },
    evidence_ids: [...numerator.evidence_ids, ...denominator.evidence_ids], warnings: [],
  };
}

/**
 * Tổng hợp trạng thái giai đoạn tiếp nhận hồ sơ. Strategy chỉ đọc lại intake,
 * cross-check và evidence đã có; không bóc tách lại để tránh nhân đôi nguồn sự
 * thật. Kết quả là khuyến cáo, không dùng để chặn các stage thẩm định.
 */
export class DossierReadinessStrategy implements StageStrategy<{
  classification: ClassifiedDoc[];
  extraction: ExtractedDoc[];
  evaluation: AppraisalEvaluation;
  intake: IntakeResult;
  evidence: EvidenceRegistry;
}, DossierReadinessResult> {
  readonly strategyId = 'hkd-secured-v2:dossier-readiness';

  execute(input: {
    classification: ClassifiedDoc[];
    extraction: ExtractedDoc[];
    evaluation: AppraisalEvaluation;
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
          : 'READY_FOR_APPRAISAL';

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
      appraisal_conditional: status !== 'READY_FOR_APPRAISAL',
    };
  }
}

function asciiLower(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

function firstNumber(text: string): number | null {
  const match = text.match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** "60", "60 tháng", "5 năm" → số tháng. Ngoài khoảng 1..600 tháng coi là không hợp lệ. */
export function parseTenorMonths(raw: unknown): number | null {
  const text = asciiLower(raw);
  const value = typeof raw === 'number' ? raw : firstNumber(text);
  if (value === null) return null;
  const months = /(nam|year)/.test(text) ? value * 12 : value;
  return months >= 1 && months <= 600 ? Math.round(months) : null;
}

/** "9,5%/năm", 9.5, 0.095 → lãi suất %/năm. Lãi suất theo tháng được quy đổi ×12. */
export function parseRatePercent(raw: unknown): number | null {
  const text = asciiLower(raw);
  let value = typeof raw === 'number' ? raw : firstNumber(text);
  if (value === null) return null;
  if (value > 0 && value < 1 && !text.includes('%')) value *= 100;
  if (/(\/\s*thang|month)/.test(text)) value *= 12;
  return value >= 0 && value <= 100 ? value : null;
}

/** Cờ "không có nghĩa vụ nợ hiện hữu": chỉ nhận giá trị false/"không" rõ ràng. */
function parseNoExistingDebt(raw: unknown): true | null {
  if (raw === false) return true;
  const text = asciiLower(raw).trim();
  return ['false', 'khong', 'khong co', 'no', 'none'].includes(text) ? true : null;
}

/** Số tiền trả hàng năm của khoản vay mới theo phương pháp niên kim (trả đều). */
function annualAnnuityPayment(principal: number, annualRatePercent: number, months: number): number {
  const monthlyRate = annualRatePercent / 100 / 12;
  const monthly = monthlyRate === 0
    ? principal / months
    : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  return monthly * 12;
}

export class HkdSecuredFinancialStrategy implements StageStrategy<{ evidence: EvidenceRegistry; inputs?: FinancialInputs; skipCollateral?: boolean }, FinancialMetrics> {
  readonly strategyId = 'hkd-secured-v2:financial';

  /**
   * skipCollateral: không đánh giá giá trị TSBĐ / LTV (NOT_APPLICABLE). Dùng khi bước gom tài sản (Customer 360) tạm tắt vì
   * TSBĐ được chọn theo sset_registry của S3; không có S3 thì không biết tài sản nào là TSBĐ.
   */
  execute({ evidence, inputs, skipCollateral = false }: { evidence: EvidenceRegistry; inputs?: FinancialInputs; skipCollateral?: boolean }): FinancialMetrics {
    const { requested, revenue, profit, debtService, collateral, tenor, rate, existingMonthly, conflicts } = inputs ?? legacyFinancialInputs(evidence);
    return computeFinancials({ requested, revenue, profit, debtService, collateral, tenor, rate, existingMonthly, conflicts }, skipCollateral);
  }
}

/** Đầu vào kiểu v2 cũ (tìm field theo regex trên registry). Đường mới dùng `financialInputsV3` (V2-R06). */
function legacyFinancialInputs(evidence: EvidenceRegistry): FinancialInputs {
    const requested = findMoneyEvidence(evidence, [/loan_(limit|amount)/i, /requested_amount/i, /loan_amount\.number/i], ['loan_request']);
    // Bảng kê thu nhập (danh mục): hkd_net_revenue, hkd_net_profit của mục II.3.1 HKD.
    const revenue = findMoneyEvidence(evidence, [/(^|\.)hkd_net_revenue$/i, /net_revenue/i, /annual_revenue/i], ['income_statement']);
    const profit = findMoneyEvidence(evidence, [/(^|\.)hkd_net_profit$/i, /annual_operating_profit/i, /operating_profit/i], ['income_statement']);
    const debtService = findMoneyEvidence(evidence, [/annual_debt_service/i, /total_debt_service/i, /debt_obligation/i], ['cic', 'income_statement', 'loan_request']);
    // Báo cáo/chứng thư định giá, báo giá là nguồn giá trị TSBĐ (field `asset_value`).
    const collateral = findMoneyEvidence(
      evidence,
      [/(^|\.)asset_value(\.number)?$/i, /valuation\.total_value/i, /latest_consulting_value/i, /collateral_value(?!_info)/i],
      ['valuation'],
    ) ?? findMoneyEvidence(evidence, [/valuation\.total_value/i, /latest_consulting_value/i, /collateral_value(?!_info)/i], ['collateral_cert']);

    // Nghĩa vụ nợ năm khi hồ sơ không ghi sẵn: khoản vay mới (niên kim từ số tiền,
    // kỳ hạn, lãi suất trên giấy đề nghị vay) + nghĩa vụ hiện hữu × 12. Chỉ tính
    // khi nghĩa vụ hiện hữu được khai rõ (kể cả khai "không có"), không giả định 0.
    // "Lãi suất" trên giấy đề nghị vay (danh mục: interest_rate) là MÃ BIỂU lãi
    // suất (LC10, LC9...), KHÔNG phải %/năm — chỉ nhận field lãi suất phần trăm
    // (danh mục: interest_rate_percent). Nghĩa vụ nợ hiện hữu cũng lấy từ giấy đề
    // nghị vay (existing_monthly_debt_payment / has_existing_debt).
    const tenor = findParsedEvidence(evidence, [/(^|\.)loan_term$/i, /loan_tenor_months/i, /requested_tenor/i], ['loan_request'], parseTenorMonths);
    const rate = findParsedEvidence(evidence, [/interest_rate_percent/i], ['loan_request'], parseRatePercent);
    const existingMonthly = findMoneyEvidence(evidence, [/(^|\.)existing_monthly_debt_payment$/i, /existing_obligations\.monthly_debt_payment/i], ['loan_request'])
      ?? (() => {
        const none = findParsedEvidence(evidence, [/(^|\.)has_existing_debt$/i], ['loan_request'], parseNoExistingDebt);
        return none ? { value: 0, evidenceIds: none.evidenceIds } : null;
      })();
    return { requested, revenue, profit, debtService, collateral, tenor, rate, existingMonthly };
}

function computeFinancials({ requested, revenue, profit, debtService, collateral, tenor, rate, existingMonthly, conflicts = {} }: FinancialInputs, skipCollateral = false): FinancialMetrics {
    const requestedAmount = requested
      ? sourceMetric(requested.value, requested.evidenceIds, 'VND', 'Số tiền cho vay (bank_proposed_amount) trích xuất từ hồ sơ')
      : conflicts.requested ? conflictMetric('VND', 'requested_amount', conflicts.requested)
      : unavailableMetric('VND', 'requested_amount', ['Không tìm thấy số tiền cho vay có cấu trúc.']);
    const annualRevenue = revenue
      ? sourceMetric(revenue.value, revenue.evidenceIds, 'VND', 'Doanh thu năm theo dữ liệu hồ sơ')
      : conflicts.revenue ? conflictMetric('VND', 'verified_annual_revenue', conflicts.revenue)
      : unavailableMetric('VND', 'verified_annual_revenue', ['Chưa đủ dữ liệu để xác thực doanh thu năm.']);
    const annualProfit = profit
      ? sourceMetric(profit.value, profit.evidenceIds, 'VND', 'Lợi nhuận hoạt động năm theo dữ liệu hồ sơ')
      : conflicts.profit ? conflictMetric('VND', 'annual_operating_profit', conflicts.profit)
      : unavailableMetric('VND', 'annual_operating_profit', ['Chưa có lợi nhuận hoạt động năm.']);
    const debtConflict = [!requested && conflicts.requested, !tenor && conflicts.tenor, !rate && conflicts.rate, !existingMonthly && conflicts.existingMonthly]
      .filter((x): x is string => typeof x === 'string');
    const annualDebtService = debtService
      ? sourceMetric(debtService.value, debtService.evidenceIds, 'VND', 'Tổng nghĩa vụ nợ năm theo dữ liệu hồ sơ')
      : requested && tenor && rate && existingMonthly
        ? (() => {
          const newLoanAnnual = annualAnnuityPayment(requested.value, rate.value, tenor.value);
          const existingAnnual = existingMonthly.value * 12;
          return {
            status: 'CALCULATED' as const,
            value: newLoanAnnual + existingAnnual,
            unit: 'VND' as const,
            formula: 'annual_debt_service = niên kim khoản vay mới (số tiền, kỳ hạn, lãi suất) × 12 tháng + nghĩa vụ nợ hiện hữu hàng tháng × 12',
            inputs: {
              requested_amount: requested.value,
              tenor_months: tenor.value,
              interest_rate_percent: rate.value,
              new_loan_annual_payment: Math.round(newLoanAnnual),
              existing_monthly_payment: existingMonthly.value,
            },
            evidence_ids: [...new Set([...requested.evidenceIds, ...tenor.evidenceIds, ...rate.evidenceIds, ...existingMonthly.evidenceIds])],
            warnings: ['Khoản vay mới được giả định trả đều (niên kim); cần đối chiếu lịch trả nợ thực tế.'],
          } satisfies MetricResult;
        })()
        : debtConflict.length > 0 ? conflictMetric('VND', 'annual_debt_service', debtConflict.join(', '))
        : unavailableMetric('VND', 'annual_debt_service', [
          `Thiếu dữ liệu để tính nghĩa vụ nợ năm: ${[
            !requested && 'số tiền vay',
            !tenor && 'thời hạn vay',
            !rate && 'lãi suất',
            !existingMonthly && 'nghĩa vụ nợ hiện hữu hàng tháng',
          ].filter(Boolean).join(', ')}.`,
        ]);
    // Chỉ dùng lợi nhuận hoạt động làm proxy CFADS khi hồ sơ có field rõ ràng; không dùng gross inflow.
    const cfads = annualProfit.status === 'CALCULATED'
      ? { ...annualProfit, formula: 'CFADS proxy = annual_operating_profit; cần policy bổ sung thuế/capex/WC nếu có', warnings: ['CFADS đang dùng proxy lợi nhuận hoạt động; cần chuyên gia xác nhận.'] }
      : annualProfit.input_conflict ? { ...annualProfit, formula: 'CFADS proxy = annual_operating_profit' }
      : unavailableMetric('VND', 'CFADS = operating cash flow - tax - maintenance capex - working capital', ['Không dùng gross account inflow để tính DSCR.']);
    const collateralValue = collateral
      ? sourceMetric(collateral.value, collateral.evidenceIds, 'VND', 'Giá trị TSBĐ hợp lệ theo báo cáo định giá')
      : conflicts.collateral ? conflictMetric('VND', 'eligible_collateral_value', conflicts.collateral)
      : unavailableMetric('VND', 'eligible_collateral_value', ['Không tìm thấy giá trị TSBĐ hợp lệ.']);

    return {
      requested_amount: requestedAmount,
      annual_revenue: annualRevenue,
      annual_operating_profit: annualProfit,
      annual_debt_service: annualDebtService,
      cfads,
      dscr: ratioMetric(cfads, annualDebtService, 'DSCR = CFADS / annual debt service', 'RATIO'),
      collateral_value: skipCollateral
        ? notEvaluatedMetric('VND', 'eligible_collateral_value', 'Chưa đánh giá giá trị TSBĐ: cần bước gom tài sản (Customer 360), đang tạm tắt ở giai đoạn 2.')
        : collateralValue,
      ltv: skipCollateral
        ? notEvaluatedMetric('RATIO', 'LTV = requested amount / eligible collateral value', 'Chưa đánh giá LTV: giá trị TSBĐ cần bước gom tài sản (Customer 360), đang tạm tắt ở giai đoạn 2.')
        : ratioMetric(requestedAmount, collateralValue, 'LTV = requested amount / eligible collateral value', 'RATIO'),
      operating_margin: ratioMetric(annualProfit, annualRevenue, 'Operating margin = annual operating profit / annual revenue', 'PERCENT'),
    };
}

export interface PolicyStrategyInput {
  facts: LoanRuleFacts;
  /** Kết quả rule LLM đã chuẩn hoá; gộp chung vào rule_results để đánh giá tổng. */
  promptResults?: RuleResult[];
}

export class PolicyStrategy implements StageStrategy<PolicyStrategyInput, PolicyComplianceResult> {
  readonly strategyId = 'hkd-secured-v2:policy';
  constructor(private readonly policy: LoanProductPolicy, private readonly checkSet: LoanCheckSet) {}

  execute({ facts, promptResults = [] }: PolicyStrategyInput): PolicyComplianceResult {
    const results = [
      ...buildRuleSet(this.policy, this.checkSet).map((rule) => rule.evaluate(facts)),
      ...promptResults,
    ];
    const externalChecks: PolicyComplianceResult['external_checks'] = [
      { check: 'AML', status: 'NOT_RUN', reason_code: 'PROVIDER_NOT_CONFIGURED' },
      { check: 'PEP', status: 'NOT_RUN', reason_code: 'PROVIDER_NOT_CONFIGURED' },
      { check: 'SANCTIONS', status: 'NOT_RUN', reason_code: 'PROVIDER_NOT_CONFIGURED' },
      { check: 'ADVERSE_MEDIA', status: 'NOT_RUN', reason_code: 'PROVIDER_NOT_CONFIGURED' },
    ];
    return {
      policy_id: this.policy.policyId,
      policy_version: this.policy.policyVersion,
      status: aggregateRuleResults(results),
      rule_results: results,
      exceptions: results.filter((item) => item.result === 'FAIL' && item.exception_allowed).map((item) => item.rule_id),
      external_checks: externalChecks,
    };
  }
}

/**
 * Khuyến nghị cuối cùng, chạy SAU khi đã có chỉ số tài chính và kết quả mọi rule (engine + LLM). Chỉ dựa trên hai thứ đó: các bước kiểm tra
 * hồ sơ (checklist, Customer 360, đối chiếu, readiness) đang tạm tắt ở giai đoạn 2 nên không còn là căn cứ. `intake` / `readiness` là
 * tuỳ chọn để dùng lại khi các bước đó chạy.
 */
export class RecommendationStrategy implements StageStrategy<{
  financial: FinancialMetrics;
  policy: PolicyComplianceResult;
  intake?: IntakeResult;
  readiness?: DossierReadinessResult;
}, { recommendation: LoanRecommendation; review: ReviewResult }> {
  readonly strategyId = 'hkd-secured-v2:recommendation';
  constructor(private readonly productPolicy: LoanProductPolicy) {}

  execute(input: {
    financial: FinancialMetrics;
    policy: PolicyComplianceResult;
    intake?: IntakeResult;
    readiness?: DossierReadinessResult;
  }) {
    const requested = input.financial.requested_amount.value;
    const collateral = input.financial.collateral_value.value;
    const dscrPass = input.financial.dscr.status === 'CALCULATED'
      && input.financial.dscr.value !== null
      && input.financial.dscr.value >= this.productPolicy.minimumDscr;
    const amountCandidates = [requested, this.productPolicy.maximumAmountVnd];
    if (collateral !== null) amountCandidates.push(collateral * this.productPolicy.maximumLtv);
    const suggested = requested !== null && dscrPass ? Math.floor(Math.min(...amountCandidates.filter((value): value is number => value !== null))) : null;
    // Hồ sơ chưa đầy đủ không chặn thẩm định; nó chỉ hạ kết quả xuống mức tạm và chuyển tuyến bổ sung.
    // Không có readiness / intake (các bước kiểm tra hồ sơ đang tắt) thì không có căn cứ về chứng từ: không coi là thiếu.
    const gate = input.readiness ? evaluateAppraisalReadiness(input.readiness) : { supplementRequired: false, reasonCodes: [] as string[] };
    const hasMissingDocs = gate.supplementRequired
      || (input.intake?.missing_required_keys.length ?? 0) > 0
      || (input.intake?.review_required_keys.length ?? 0) > 0;
    const hasPolicyReview = input.policy.status !== 'PASS';
    // LTV NOT_APPLICABLE (chưa đánh giá TSBĐ) không phải thiếu dữ liệu: chỉ số tiền vay và DSCR quyết định.
    const insufficient = requested === null
      || input.financial.dscr.status !== 'CALCULATED'
      || (input.financial.ltv.status !== 'CALCULATED' && input.financial.ltv.status !== 'NOT_APPLICABLE');
    const reasons = [
      ...gate.reasonCodes,
      ...(hasMissingDocs ? ['REQUIRED_DOCUMENTS_INCOMPLETE'] : []),
      ...(hasPolicyReview ? ['POLICY_REVIEW_REQUIRED'] : []),
      ...(insufficient ? ['FINANCIAL_INPUT_INSUFFICIENT'] : []),
      'EXTERNAL_COMPLIANCE_NOT_RUN',
    ];
    const recommendation: LoanRecommendation = {
      recommendation: insufficient ? 'INSUFFICIENT_DATA' : hasMissingDocs || hasPolicyReview ? 'REFER' : 'CONSIDER',
      suggested_amount_vnd: suggested,
      suggested_tenor_months: suggested !== null ? this.productPolicy.defaultTenorMonths : null,
      conditions_precedent: [
        ...(input.readiness?.supplement_requests ?? []),
        'Hoàn tất AML/PEP/sanctions bởi hệ thống/provider được phê duyệt.',
      ],
      covenants: dscrPass ? [`Duy trì DSCR ≥ ${this.productPolicy.minimumDscr.toFixed(2)}×.`] : [],
      reason_codes: [...new Set(reasons)],
      review_required: true,
    };
    const review: ReviewResult = {
      required: true,
      route: hasMissingDocs ? 'REQUEST_DOCUMENTS' : hasPolicyReview || insufficient ? 'RISK_REVIEW' : 'CREDIT_REVIEW',
      reasons: recommendation.reason_codes,
      required_role: hasMissingDocs ? 'CREDIT_OFFICER' : 'CREDIT_APPROVER',
    };
    return { recommendation, review };
  }
}
