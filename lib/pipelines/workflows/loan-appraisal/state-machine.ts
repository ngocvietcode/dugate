import type {
  AssessmentStatus,
  DossierReadinessResult,
  LoanPhaseKey,
  LoanStageKey,
  PhaseStatus,
  RuleResult,
} from './types';

export interface StageDefinition {
  key: LoanStageKey;
  label: string;
  processor: string;
  required: boolean;
  phase: LoanPhaseKey;
}

export const LOAN_STAGE_DEFINITIONS: StageDefinition[] = [
  { key: 'classify', label: 'Phân loại tài liệu', processor: 'ext-classifier', required: true, phase: 'DOSSIER_INTAKE' },
  { key: 'extract_evidence', label: 'Bóc tách & lập evidence', processor: 'ext-data-extractor', required: true, phase: 'CREDIT_APPRAISAL' },
  { key: 'calculate_financials', label: 'Tính toán tài chính', processor: 'loan-financial-strategy', required: true, phase: 'CREDIT_APPRAISAL' },
  { key: 'evaluate_policy_compliance', label: 'Policy & tuân thủ', processor: 'loan-rule-engine', required: true, phase: 'CREDIT_APPRAISAL' },
  { key: 'synthesize_recommendation', label: 'Khuyến nghị & định tuyến', processor: 'loan-decision-strategy', required: true, phase: 'CREDIT_APPRAISAL' },
];

export const LOAN_PHASE_DEFINITIONS: Array<{ key: LoanPhaseKey; label: string; description: string }> = [
  {
    key: 'DOSSIER_INTAKE',
    label: 'Phân loại & kiểm tra sơ bộ',
    description: 'Phân loại chứng từ và kiểm tra sơ bộ checklist bằng AI (dừng chờ người dùng chuyển giai đoạn 2).',
  },
  {
    key: 'CREDIT_APPRAISAL',
    label: 'Bóc tách & thẩm định',
    description: 'Bóc tách OCR, phân tích tài chính, bộ rule (engine + LLM) và khuyến nghị. Các bước kiểm tra hồ sơ (Customer 360, checklist, đối chiếu chéo) đang tạm tắt.',
  },
];

/** Index của các stage thuộc một phase, dùng để đọc step artifact theo vị trí. */
export function stageIndexesOfPhase(phase: LoanPhaseKey): number[] {
  return LOAN_STAGE_DEFINITIONS.reduce<number[]>((acc, definition, index) => {
    if (definition.phase === phase) acc.push(index);
    return acc;
  }, []);
}

/** Suy phase cho artifact cũ chỉ có stage_key hoặc numeric step. */
export function phaseOfStage(stage: LoanStageKey | string | number | undefined): LoanPhaseKey {
  if (typeof stage === 'number') {
    return LOAN_STAGE_DEFINITIONS[stage]?.phase ?? 'CREDIT_APPRAISAL';
  }
  return LOAN_STAGE_DEFINITIONS.find((definition) => definition.key === stage)?.phase ?? 'CREDIT_APPRAISAL';
}

/**
 * Trạng thái tổng hợp của một phase theo nguyên tắc xấu nhất thắng. Không suy ra
 * COMPLETE khi còn stage bắt buộc chưa chạy.
 */
export function derivePhaseStatus(
  phase: LoanPhaseKey,
  steps: Array<{ status?: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'WAITING_REVIEW' } | undefined>,
): PhaseStatus {
  const indexes = stageIndexesOfPhase(phase);
  const entries = indexes.map((index) => ({ definition: LOAN_STAGE_DEFINITIONS[index], step: steps[index] }));
  const executed = entries.filter((entry) => Boolean(entry.step));

  if (entries.some((entry) => entry.step?.status === 'FAILED')) return 'BLOCKED';
  if (executed.length === 0) return 'PENDING';

  const missingRequired = entries.some((entry) => entry.definition.required && !entry.step);
  if (missingRequired) return 'RUNNING';

  if (entries.some((entry) => entry.step?.status === 'PARTIAL_SUCCESS' || entry.step?.status === 'WAITING_REVIEW')) return 'PARTIAL';
  return 'COMPLETE';
}

export function policyOutcomeToAssessment(
  outcome: 'PASS' | 'PASS_WITH_CONDITIONS' | 'FAIL' | 'REVIEW',
): AssessmentStatus {
  return outcome;
}

/**
 * Đánh giá mức sẵn sàng thẩm định. Đây là KHUYẾN CÁO, không phải quyền chạy:
 * caller không được dùng kết quả này để bỏ qua stage hay dừng workflow. Hồ sơ
 * thiếu chứng từ vẫn chạy hết pipeline và vẫn có artifact thẩm định, nhưng kết
 * quả bị đánh dấu là tạm và phải chuyển tuyến bổ sung hồ sơ.
 */
export function evaluateAppraisalReadiness(readiness: DossierReadinessResult | undefined): {
  conditional: boolean;
  supplementRequired: boolean;
  reasonCodes: string[];
} {
  if (!readiness) {
    return { conditional: true, supplementRequired: true, reasonCodes: ['DOSSIER_READINESS_UNKNOWN'] };
  }
  const supplementRequired = readiness.status !== 'READY_FOR_APPRAISAL';
  return {
    conditional: readiness.appraisal_conditional || supplementRequired,
    supplementRequired,
    reasonCodes: supplementRequired
      ? [...new Set(['DOSSIER_SUPPLEMENT_REQUIRED', ...readiness.blocking_reasons])]
      : [],
  };
}

/**
 * `readiness` chỉ truyền khi các bước kiểm tra hồ sơ chạy (hiện tạm tắt ở giai đoạn 2). Không có thì trạng thái chỉ dựa trên policy và kết
 * quả các rule, thay vì coi là "chưa rõ mức sẵn sàng" rồi luôn hạ xuống REVIEW_REQUIRED.
 */
export function deriveProcessingStatus(
  policyStatus: AssessmentStatus,
  ruleResults: RuleResult[],
  readiness?: DossierReadinessResult,
): 'COMPLETE' | 'PARTIAL' | 'REVIEW_REQUIRED' | 'BLOCKED' {
  if (policyStatus === 'FAIL') return 'BLOCKED';
  // Hồ sơ chưa đầy đủ không chặn xử lý, nhưng kết quả phải ở trạng thái cần rà soát.
  if (readiness && evaluateAppraisalReadiness(readiness).conditional) return 'REVIEW_REQUIRED';
  if (policyStatus === 'REVIEW' || policyStatus === 'PASS_WITH_CONDITIONS') return 'REVIEW_REQUIRED';
  if (ruleResults.some((item) => item.result === 'NOT_RUN' || item.result === 'INSUFFICIENT_DATA')) return 'PARTIAL';
  return 'COMPLETE';
}
