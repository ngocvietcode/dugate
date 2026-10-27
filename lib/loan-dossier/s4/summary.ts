// Tổng hợp và trạng thái stage (T-S4-09; S4 §2 quy ước đếm, §4).
import { countChecklist, type ChecklistItemResult } from '../contracts/check-stages';
import { loadChecklistCatalog } from './catalog';

/** 1 phần tử / nhóm, đủ 5 nhóm theo thứ tự catalog (kể cả nhóm không có dòng). */
export function summarize(items: readonly ChecklistItemResult[]) {
  return loadChecklistCatalog().groups.map((g) => ({
    checklist_group: g.checklist_group as ChecklistItemResult['checklist_group'],
    ...countChecklist(items.filter((i) => i.checklist_group === g.checklist_group)),
  }));
}

/** `completeness_percent` toàn stage: `total_required = 0` → 100. */
export function completeness(items: readonly ChecklistItemResult[]): number {
  return countChecklist(items).completeness_percent ?? 100;
}

export interface StageVerdict {
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'INSUFFICIENT_DATA';
  code: string;
  blocking: Array<{ type: 'EXTERNAL_DATA'; key: string; message: string }>;
}

const EXTERNAL_FIELD: Record<string, string> = {
  deviation_code_present: 'deviation_code',
  loan_amount_over_3_billion: 'loan_amount',
  collateral_mortgaged_elsewhere: 'collateral_mortgaged_elsewhere',
  household_business_license_required: 'loan_amount',
};

/** Dòng #4–#8 của bảng §4 (dòng #1–#3 xử lý trước khi có dữ liệu). */
export function stageStatus(items: readonly ChecklistItemResult[], anyClassified: boolean, subjectMapping: boolean): StageVerdict {
  const blocking = [...new Set(items
    .filter((i) => i.condition_source === 'EXTERNAL_INPUT' && i.condition_result === 'INPUT_NOT_PROVIDED' && i.condition_id)
    .map((i) => EXTERNAL_FIELD[i.condition_id!] ?? i.condition_id!))]
    .map((f) => ({ type: 'EXTERNAL_DATA' as const, key: `external_input.${f}`, message: `Thiếu thông tin ${f} từ hệ thống ngoài để xác định chứng từ bắt buộc.` }));
  if (!anyClassified) return { status: 'INSUFFICIENT_DATA', code: 'MISSING_PRIMARY_EVIDENCE', blocking };
  if (!subjectMapping) return { status: 'PARTIAL_SUCCESS', code: 'SUBJECT_MAPPING_UNAVAILABLE', blocking };
  if (blocking.length > 0) return { status: 'PARTIAL_SUCCESS', code: 'MISSING_CONDITIONAL_EVIDENCE', blocking };
  if (items.some((i) => i.required && (i.status === 'NEEDS_RESCAN' || i.status === 'NEEDS_REVIEW'))) {
    return { status: 'PARTIAL_SUCCESS', code: 'CHECKLIST_ITEMS_UNRESOLVED', blocking };
  }
  return { status: 'SUCCESS', code: 'COMPLETED', blocking };
}
