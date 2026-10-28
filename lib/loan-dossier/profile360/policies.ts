// Chính sách chọn giá trị của hồ sơ 360 (T-360-10; L360-G01). Catalog hỏng → không chọn giá trị, không đoán.
import { z } from 'zod';

import raw from '../catalog/data/merge_policies.json';

export const MergePoliciesSchema = z.object({
  policy_version: z.string().min(1),
  description: z.string().optional(),
  income_monthly_amount: z.enum(['MIN']),
  /** D-112: giá trị TSBĐ dùng tính LTV = thấp nhất các chứng thư định giá của tài sản. */
  collateral_value: z.enum(['MIN']),
  /** Chênh lệch giữa định giá cao nhất và thấp nhất của một tài sản (tỷ lệ trên giá thấp nhất) vượt ngưỡng → `VALUATION_GAP`. */
  valuation_gap_ratio: z.number().gt(0),
});

export type MergePolicies = z.infer<typeof MergePoliciesSchema>;

export function parseMergePolicies(input: unknown): MergePolicies | null {
  const parsed = MergePoliciesSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const loadMergePolicies = (): MergePolicies | null => parseMergePolicies(raw);

/** Số tiền theo tháng của một luồng thu nhập theo chính sách; null khi không có số hoặc không có chính sách. */
export function chooseMonthlyAmount(values: readonly number[], policies: MergePolicies | null): number | null {
  if (!policies || values.length === 0) return null;
  return Math.min(...values);
}
