import type { BackendWorkflowStep, LoanPhaseKey, LoanStageKey, StepStatus } from '@/app/loan-appraisal/types';

export interface StageDef {
  id: LoanStageKey;
  label: string;
  caption: string;
  phase: LoanPhaseKey;
}

/**
 * Các bước hiển thị. dossier_precheck chỉ có ở giao diện: backend ghi kết quả kiểm tra sơ bộ vào checkpoint của classify (cùng stage 0),
 * không có stage riêng và không có chỉ số step; xem BACKEND_STAGE_KEYS cho thứ tự theo chỉ số của backend.
 */
export const STAGES: ReadonlyArray<StageDef> = [
  { id: 'classify', label: 'Phân loại chứng từ', caption: 'Nhận dạng loại hồ sơ', phase: 'DOSSIER_INTAKE' },
  { id: 'dossier_precheck', label: 'Kiểm tra sơ bộ', caption: 'AI đối chiếu checklist và quan hệ chứng từ', phase: 'DOSSIER_INTAKE' },
  { id: 'extract_evidence', label: 'OCR & bóc tách', caption: 'Trích xuất dữ liệu có nguồn', phase: 'CREDIT_APPRAISAL' },
  { id: 'calculate_financials', label: 'Phân tích tài chính', caption: 'CFADS, DSCR', phase: 'CREDIT_APPRAISAL' },
  { id: 'evaluate_policy_compliance', label: 'Bộ rule thẩm định', caption: 'Rule engine và rule LLM theo nhóm', phase: 'CREDIT_APPRAISAL' },
  { id: 'synthesize_recommendation', label: 'Khuyến nghị & định tuyến', caption: 'Tuyến xử lý hồ sơ', phase: 'CREDIT_APPRAISAL' },
];

export const PHASES: ReadonlyArray<{ key: LoanPhaseKey; order: number; label: string; description: string }> = [
  {
    key: 'DOSSIER_INTAKE',
    order: 1,
    label: 'Phân loại & kiểm tra sơ bộ',
    description: 'Phân loại chứng từ và kiểm tra sơ bộ checklist, quan hệ giữa các chứng từ bằng AI; xác định nội dung cần bổ sung trước khi chuyển giai đoạn 2.',
  },
  {
    key: 'CREDIT_APPRAISAL',
    order: 2,
    label: 'Bóc tách & thẩm định',
    description: 'OCR, phân tích tài chính, bộ rule (engine + LLM) và khuyến nghị. Các bước kiểm tra hồ sơ (Customer 360, checklist, đối chiếu chéo) đang tạm tắt.',
  },
];

/** Thứ tự stage theo chỉ số `step`/`current_step` của backend: giống STAGES nhưng không có bước chỉ của giao diện. */
export const BACKEND_STAGE_KEYS: ReadonlyArray<LoanStageKey> = STAGES.filter((stage) => stage.id !== 'dossier_precheck').map((stage) => stage.id);

/** Thứ tự hiển thị (có dossier_precheck); dùng để suy ra bước kế tiếp. */
export const LEGACY_STAGE_KEYS: ReadonlyArray<LoanStageKey> = STAGES.map((stage) => stage.id);

export type StageMap = Record<LoanStageKey, StepStatus>;

export function initialStages(): StageMap {
  const map = {} as StageMap;
  for (const stage of STAGES) map[stage.id] = 'pending';
  return map;
}

export function isStageKey(value: string): value is LoanStageKey {
  return LEGACY_STAGE_KEYS.includes(value as LoanStageKey);
}

export function stageKeyOf(step: BackendWorkflowStep, fallbackIndex: number): string {
  return step.stage_key || BACKEND_STAGE_KEYS[step.step ?? fallbackIndex] || `stage-${step.step ?? fallbackIndex}`;
}

export type PhaseStatus = StepStatus | 'partial';

export function phaseStatusOf(stages: StageMap, phase: LoanPhaseKey): PhaseStatus {
  const group = STAGES.filter((stage) => stage.phase === phase).map((stage) => stages[stage.id]);
  if (group.some((status) => status === 'error')) return 'error';
  if (group.some((status) => status === 'running')) return 'running';
  if (group.length > 0 && group.every((status) => status === 'done')) return 'done';
  if (group.some((status) => status === 'done')) return 'partial';
  return 'pending';
}

export function completedStageCount(stages: StageMap): number {
  return STAGES.filter((stage) => stages[stage.id] === 'done').length;
}
