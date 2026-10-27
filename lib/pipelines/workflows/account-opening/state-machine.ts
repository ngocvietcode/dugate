import type {
  AccountPhaseKey,
  AccountStageKey,
  AssessmentStatus,
  DossierReadinessResult,
  PhaseStatus,
  RiskLevel,
  RuleResult,
} from './types';

export interface StageDefinition {
  key: AccountStageKey;
  label: string;
  processor: string;
  required: boolean;
  phase: AccountPhaseKey;
}

export const ACCOUNT_STAGE_DEFINITIONS: StageDefinition[] = [
  { key: 'classify', label: 'Phân loại tài liệu', processor: 'ext-classifier', required: true, phase: 'DOSSIER_INTAKE' },
  { key: 'extract_evidence', label: 'Bóc tách & lập evidence', processor: 'ext-data-extractor', required: true, phase: 'DOSSIER_INTAKE' },
  { key: 'consolidate_profile', label: 'Customer Profile & checklist', processor: 'ext-fact-verifier', required: true, phase: 'DOSSIER_INTAKE' },
  { key: 'evaluate_eligibility', label: 'Điều kiện mở tài khoản', processor: 'account-eligibility-strategy', required: true, phase: 'ONBOARDING_ASSESSMENT' },
  { key: 'assess_cdd_risk', label: 'Rà soát khách hàng (CDD)', processor: 'account-cdd-strategy', required: true, phase: 'ONBOARDING_ASSESSMENT' },
  { key: 'evaluate_policy_compliance', label: 'Policy & tuân thủ theo phân khúc', processor: 'account-rule-engine', required: true, phase: 'ONBOARDING_ASSESSMENT' },
  { key: 'screen_watchlists', label: 'Sàng lọc danh sách cảnh báo', processor: 'account-screening-strategy', required: false, phase: 'ONBOARDING_ASSESSMENT' },
  { key: 'synthesize_decision', label: 'Kết luận & định tuyến rà soát', processor: 'account-decision-strategy', required: true, phase: 'ONBOARDING_ASSESSMENT' },
];

export const ACCOUNT_PHASE_DEFINITIONS: Array<{ key: AccountPhaseKey; label: string; description: string }> = [
  {
    key: 'DOSSIER_INTAKE',
    label: 'Tiếp nhận & hoàn thiện hồ sơ',
    description: 'Phân loại chứng từ, bóc tách dữ liệu, hợp nhất Customer Profile, kiểm tra chéo và tính đầy đủ.',
  },
  {
    key: 'ONBOARDING_ASSESSMENT',
    label: 'Đánh giá & kết luận mở tài khoản',
    description: 'Kiểm tra điều kiện, rà soát khách hàng theo phân khúc, chạy policy rule, sàng lọc và kết luận.',
  },
];

/** Index của các stage thuộc một phase, dùng để đọc step artifact theo vị trí. */
export function stageIndexesOfPhase(phase: AccountPhaseKey): number[] {
  return ACCOUNT_STAGE_DEFINITIONS.reduce<number[]>((acc, definition, index) => {
    if (definition.phase === phase) acc.push(index);
    return acc;
  }, []);
}

/** Suy phase cho artifact cũ chỉ có stage_key hoặc numeric step. */
export function phaseOfStage(stage: AccountStageKey | string | number | undefined): AccountPhaseKey {
  if (typeof stage === 'number') {
    return ACCOUNT_STAGE_DEFINITIONS[stage]?.phase ?? 'ONBOARDING_ASSESSMENT';
  }
  return ACCOUNT_STAGE_DEFINITIONS.find((definition) => definition.key === stage)?.phase ?? 'ONBOARDING_ASSESSMENT';
}

/**
 * Trạng thái tổng hợp của một phase theo nguyên tắc xấu nhất thắng. Không suy ra
 * COMPLETE khi còn stage bắt buộc chưa chạy.
 */
export function derivePhaseStatus(
  phase: AccountPhaseKey,
  steps: Array<{ status?: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'WAITING_REVIEW' } | undefined>,
): PhaseStatus {
  const indexes = stageIndexesOfPhase(phase);
  const entries = indexes.map((index) => ({ definition: ACCOUNT_STAGE_DEFINITIONS[index], step: steps[index] }));
  const executed = entries.filter((entry) => Boolean(entry.step));

  if (entries.some((entry) => entry.step?.status === 'FAILED')) return 'BLOCKED';
  if (executed.length === 0) return 'PENDING';

  const missingRequired = entries.some((entry) => entry.definition.required && !entry.step);
  if (missingRequired) return 'RUNNING';

  if (entries.some((entry) => entry.step?.status === 'PARTIAL_SUCCESS' || entry.step?.status === 'WAITING_REVIEW')) return 'PARTIAL';
  return 'COMPLETE';
}

/** Thứ tự mức rủi ro để so sánh với ngưỡng policy. */
const RISK_ORDER: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, UNDETERMINED: 4 };

export function compareRiskLevel(left: RiskLevel, right: RiskLevel): number {
  return RISK_ORDER[left] - RISK_ORDER[right];
}

/** Mức rủi ro cao nhất trong danh sách; rỗng thì coi là chưa xác định. */
export function highestRiskLevel(levels: RiskLevel[]): RiskLevel {
  if (levels.length === 0) return 'UNDETERMINED';
  return levels.reduce((highest, level) => (compareRiskLevel(level, highest) > 0 ? level : highest), 'LOW' as RiskLevel);
}

/**
 * Đánh giá mức sẵn sàng đánh giá hồ sơ. Đây là KHUYẾN CÁO, không phải quyền chạy:
 * caller không được dùng kết quả này để bỏ qua stage hay dừng workflow. Hồ sơ
 * thiếu chứng từ vẫn chạy hết pipeline và vẫn có artifact đánh giá, nhưng kết quả
 * bị đánh dấu là tạm và phải chuyển tuyến bổ sung hồ sơ.
 */
export function evaluateAssessmentReadiness(readiness: DossierReadinessResult | undefined): {
  conditional: boolean;
  supplementRequired: boolean;
  reasonCodes: string[];
} {
  if (!readiness) {
    return { conditional: true, supplementRequired: true, reasonCodes: ['DOSSIER_READINESS_UNKNOWN'] };
  }
  const supplementRequired = readiness.status !== 'READY_FOR_ASSESSMENT';
  return {
    conditional: readiness.assessment_conditional || supplementRequired,
    supplementRequired,
    reasonCodes: supplementRequired
      ? [...new Set(['DOSSIER_SUPPLEMENT_REQUIRED', ...readiness.blocking_reasons])]
      : [],
  };
}

export function deriveProcessingStatus(
  policyStatus: AssessmentStatus,
  ruleResults: RuleResult[],
  cddStatus?: AssessmentStatus,
  readiness?: DossierReadinessResult,
): 'COMPLETE' | 'PARTIAL' | 'REVIEW_REQUIRED' | 'BLOCKED' {
  if (policyStatus === 'FAIL') return 'BLOCKED';
  // Hồ sơ chưa đầy đủ không chặn xử lý, nhưng kết quả phải ở trạng thái cần rà soát.
  if (evaluateAssessmentReadiness(readiness).conditional) return 'REVIEW_REQUIRED';
  if (cddStatus === 'FAIL' || cddStatus === 'REVIEW' || cddStatus === 'PASS_WITH_CONDITIONS') return 'REVIEW_REQUIRED';
  if (policyStatus === 'REVIEW' || policyStatus === 'PASS_WITH_CONDITIONS') return 'REVIEW_REQUIRED';
  if (ruleResults.some((item) => item.result === 'NOT_RUN' || item.result === 'INSUFFICIENT_DATA')) return 'PARTIAL';
  return 'COMPLETE';
}
