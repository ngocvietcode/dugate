import { z } from 'zod';
import { Actor } from './common';

export const ReviewMode = z.enum(['DELEGATED', 'EMBEDDED', 'NONE']);
export type ReviewMode = z.infer<typeof ReviewMode>;

export const ReviewTask = z.object({
  taskId: z.string(),
  runId: z.string(),
  kind: z.enum(['DISCREPANCY', 'PERSON_LINK', 'PHASE1_ITEM']),
  ref: z.string().describe('X#, mention D#:idx hoặc key checklist'),
  severity: z.string().nullable(),
  title: z.string(),
  status: z.enum(['OPEN', 'DONE']),
});
export type ReviewTask = z.infer<typeof ReviewTask>;

export const DecisionAction = z.enum([
  'CONFIRM', // xác nhận phân loại / liên kết như hệ thống đề xuất
  'RECLASSIFY', // đổi loại sai lệch (A | B | C)
  'CORRECT_VALUE', // sửa giá trị sau khi đọc lại ảnh (chỉ lỗi A)
  'REQUEST_SUPPLEMENT', // yêu cầu RM bổ sung (lỗi B)
  'REJECT_LINK', // liên kết người sai
]);
export type DecisionAction = z.infer<typeof DecisionAction>;

export const ReviewDecisionBody = z.object({
  action: DecisionAction,
  newClass: z.enum(['A', 'B', 'C']).optional(),
  value: z.unknown().optional(),
  reason: z.string().min(3, 'bắt buộc ghi lý do'),
});
export type ReviewDecisionBody = z.infer<typeof ReviewDecisionBody>;

export const ReviewDecision = ReviewDecisionBody.extend({
  taskId: z.string(),
  actor: Actor,
  at: z.string().describe('ISO time do server ghi'),
});
export type ReviewDecision = z.infer<typeof ReviewDecision>;
