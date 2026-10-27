// Ràng buộc mảng của JSON Schema mà zod không có sẵn — dùng bởi schema sinh tự động trong thư mục này.
import { z, type ZodTypeAny } from 'zod';

/** `uniqueItems: true` — so theo JSON. */
export function uniqueItems(arr: readonly unknown[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  arr.forEach((v, i) => {
    const k = JSON.stringify(v);
    if (seen.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: 'phần tử trùng (uniqueItems)' });
    seen.add(k);
  });
}

export interface ContainsRule {
  schema: ZodTypeAny;
  min: number;
  max: number | null;
  label: string;
}

/** `allOf: [{contains, minContains, maxContains}…]` — đếm phần tử khớp `schema` cho từng luật. */
export function containsRule(rules: readonly ContainsRule[]) {
  return (arr: readonly unknown[], ctx: z.RefinementCtx): void => {
    for (const r of rules) {
      const n = arr.filter((v) => r.schema.safeParse(v).success).length;
      if (n < r.min || (r.max !== null && n > r.max)) {
        const range = r.max === null ? `≥ ${r.min}` : r.min === r.max ? `đúng ${r.min}` : `${r.min}–${r.max}`;
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `cần ${range} phần tử khớp ${r.label}, có ${n}` });
      }
    }
  };
}
