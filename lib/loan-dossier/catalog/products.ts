// Danh mục SẢN PHẨM VAY (loan_products.json): nguồn duy nhất cho `getLoanProduct`, policy mặc định và danh sách sản phẩm của UI.
//
// Thêm sản phẩm = thêm một phần tử vào loan_products.json + một chương trình checklist có cùng product_code trong
// checklist_programs.json. Không cần sửa code. Bộ kiểm tra chéo `validateProductsAgainstPrograms` (chạy ở test) bắt thiếu một trong hai.
// Hướng dẫn đầy đủ: docs/loan-appraisal/ADD-NEW-PRODUCT-FLOW.md.
import { z } from 'zod';

import { parseCatalogFile } from './index';
import raw from './data/loan_products.json';

const PolicySchema = z.object({
  config_version: z.string().min(1),
  policy_id: z.string().min(1),
  policy_version: z.string().min(1),
  minimum_dscr: z.number().min(0.5).max(5),
  maximum_ltv: z.number().min(0.1).max(1),
  maximum_amount_vnd: z.number().min(1_000_000).max(1_000_000_000_000),
  default_tenor_months: z.number().int().min(1).max(360),
  scorecard_id: z.string().nullable(),
  scorecard_version: z.string().nullable(),
}).strict();
export type ProductPolicyConfig = z.infer<typeof PolicySchema>;

const ProductSchema = z.object({
  product_code: z.string().regex(/^[a-z][a-z0-9-]*$/, 'product_code: chữ thường, số và dấu gạch ngang'),
  /**
   * Phân khúc khách hàng của sản phẩm (HKD, SME, CORPORATE, RETAIL). Đi vào `case.profile.segment` của JSON tích hợp; consumer dùng nó
   * để chọn phần mở rộng (`extensions["segment.<x>"]`). Thêm bộ hồ sơ mới = thêm giá trị ở đây + `SEGMENTS` trong integration-contract.ts.
   */
  segment: z.enum(['HKD', 'SME', 'CORPORATE', 'RETAIL']),
  name: z.string().min(1),
  description: z.string(),
  policy: PolicySchema,
}).strict();
export type LoanProductConfig = z.infer<typeof ProductSchema>;

const ProductsFileSchema = z.object({
  version: z.string(),
  description: z.string().optional(),
  default_product_code: z.string(),
  products: z.array(ProductSchema).min(1),
}).strict().superRefine((c, ctx) => {
  const seen = new Set<string>();
  c.products.forEach((p, i) => {
    if (seen.has(p.product_code)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['products', i, 'product_code'], message: `trùng ${p.product_code}` });
    seen.add(p.product_code);
  });
  if (!seen.has(c.default_product_code)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['default_product_code'], message: `${c.default_product_code} không có trong products` });
  }
});
export type LoanProductsCatalog = z.infer<typeof ProductsFileSchema>;

let cache: LoanProductsCatalog | null = null;

export function loadLoanProducts(): LoanProductsCatalog {
  if (!cache) cache = parseCatalogFile('loan_products.json', raw, ProductsFileSchema);
  return cache;
}

/** Kiểm một catalog sản phẩm khác (test / mở rộng); ném lỗi nếu sai. */
export function parseLoanProducts(value: unknown): LoanProductsCatalog {
  return ProductsFileSchema.parse(value);
}

export function listLoanProductConfigs(catalog = loadLoanProducts()): readonly LoanProductConfig[] {
  return catalog.products;
}

export function loanProductConfig(code: string | null | undefined, catalog = loadLoanProducts()): LoanProductConfig | undefined {
  if (typeof code !== 'string') return undefined;
  return catalog.products.find((p) => p.product_code === code);
}

export function defaultLoanProductCode(catalog = loadLoanProducts()): string {
  return catalog.default_product_code;
}

/**
 * Kiểm chéo sản phẩm ↔ chương trình checklist: mỗi sản phẩm phải thuộc đúng một chương trình, và mỗi `product_code` của
 * chương trình phải là sản phẩm đã khai. Trả danh sách lỗi (rỗng = hợp lệ). Hàm thuần, nhận dữ liệu qua tham số để test.
 */
export function validateProductsAgainstPrograms(
  products: ReadonlyArray<{ product_code: string }>,
  programs: ReadonlyArray<{ program_key: string; product_codes: readonly string[] }>,
): string[] {
  const problems: string[] = [];
  const known = new Set(products.map((p) => p.product_code));
  for (const p of products) {
    const owners = programs.filter((g) => g.product_codes.includes(p.product_code));
    if (owners.length === 0) problems.push(`Sản phẩm ${p.product_code} chưa có chương trình checklist trong checklist_programs.json.`);
    if (owners.length > 1) problems.push(`Sản phẩm ${p.product_code} thuộc nhiều chương trình: ${owners.map((o) => o.program_key).join(', ')}.`);
  }
  for (const g of programs) {
    for (const code of g.product_codes) {
      if (!known.has(code)) problems.push(`Chương trình ${g.program_key} tham chiếu product_code ${code} chưa khai trong loan_products.json.`);
    }
  }
  return problems;
}
