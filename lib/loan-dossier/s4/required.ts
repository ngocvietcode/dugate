// Xác định `required` (T-S4-06; bảng `required` của S4 §3.2).
import type { ChecklistItem } from './catalog';
import type { ConditionResult } from './context';
import type { FlowRequirement } from './programs';

export interface RequiredResult {
  required: boolean;
  /** `on_input_missing = NEEDS_REVIEW` ∧ điều kiện INPUT_NOT_PROVIDED → ép NEEDS_REVIEW (S4-R13 #1). */
  forceReview: boolean;
  /** `requires_exact_doc_when_met` ∧ MET → tắt thay thế. */
  allowSubstitute: boolean;
}

/** `req` = mức yêu cầu của mục ở luồng của lần chạy, đã áp chương trình + ghi đè Profile (S4-R24, R25). */
export function resolveRequired(
  item: ChecklistItem,
  conditionResult: ConditionResult | null,
  req: FlowRequirement,
  onInputMissing: 'REQUIRED' | 'NOT_REQUIRED' | 'NEEDS_REVIEW' | null,
): RequiredResult {
  if (req === 'REQUIRED') return { required: true, forceReview: false, allowSubstitute: true };
  if (req !== 'CONDITIONAL') return { required: false, forceReview: false, allowSubstitute: true };
  if (conditionResult === 'MET') return { required: true, forceReview: false, allowSubstitute: !item.requires_exact_doc_when_met };
  if (conditionResult === 'NOT_MET') return { required: false, forceReview: false, allowSubstitute: true };
  // INPUT_NOT_PROVIDED (hoặc thiếu kết quả) → theo on_input_missing
  if (onInputMissing === 'NOT_REQUIRED') return { required: false, forceReview: false, allowSubstitute: true };
  if (onInputMissing === 'NEEDS_REVIEW') return { required: true, forceReview: true, allowSubstitute: true };
  return { required: true, forceReview: false, allowSubstitute: true };
}
