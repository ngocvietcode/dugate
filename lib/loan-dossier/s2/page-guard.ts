// Hạ confidence khi đọc nhầm trang (T-S2-05; S2-R15).

export interface PageGuardCheck {
  /** Field cấp 1 của `data` bị hạ khi lệch trang. */
  field: string;
  /** Trang giá trị được đọc ra. Rỗng = không có giá trị, bỏ qua. */
  pages: ReadonlyArray<number>;
  /** Trang chứa tiêu đề mục; null = không có yêu cầu. */
  heading_page: number | null;
}

export const PAGE_GUARD_CAP = 0.5;

/**
 * Field đọc từ trang không chứa tiêu đề mục → confidence = min(cũ, 0.5). ≥ 2 field bị hạ → mọi field cấp 1
 * về tối đa 0.5. Không bao giờ nâng confidence.
 */
export function applyPageGuard(
  fieldConfidences: Readonly<Record<string, number>>,
  checks: ReadonlyArray<PageGuardCheck>,
): { field_confidences: Record<string, number>; misplaced: string[] } {
  const misplaced = [...new Set(checks
    .filter((c) => c.heading_page !== null && c.pages.length > 0 && !c.pages.includes(c.heading_page))
    .map((c) => c.field))];
  const out = { ...fieldConfidences };
  const cap = (k: string) => { out[k] = Math.min(out[k] ?? 0, PAGE_GUARD_CAP); };
  if (misplaced.length >= 2) Object.keys(out).forEach(cap);
  else misplaced.forEach(cap);
  return { field_confidences: out, misplaced };
}

/** Mục cố định của `loan_application` (S2-R15) — khóa `section_pages` model phải báo. */
export const LOAN_APPLICATION_SECTIONS = ['business_info', 'loan_info', 'financial_info', 'assets', 'bank_section'] as const;

/**
 * Dựng các phép kiểm cho `loan_application`: field cấp 1 phải đọc từ trang có tiêu đề mục của nó; riêng
 * `bank_proposed_amount` ("Vốn vay tại VPBank") phải ở trang có "PHẦN DÀNH CHO NGÂN HÀNG" — lệch thì hạ `loan_info`.
 */
export function loanApplicationChecks(
  data: Record<string, unknown>,
  sourcePages: Readonly<Record<string, number[]>>,
  sectionPages: Readonly<Record<string, number | null>>,
): PageGuardCheck[] {
  const checks: PageGuardCheck[] = ['business_info', 'loan_info', 'financial_info', 'assets'].map((field) => ({
    field, pages: sourcePages[field] ?? [], heading_page: sectionPages[field] ?? null,
  }));
  const loanInfo = data.loan_info as { bank_proposed_amount_page?: number | null; bank_proposed_amount?: number | null } | null | undefined;
  if (loanInfo?.bank_proposed_amount != null && loanInfo.bank_proposed_amount_page != null) {
    checks.push({ field: 'loan_info', pages: [loanInfo.bank_proposed_amount_page], heading_page: sectionPages.bank_section ?? null });
  }
  return checks;
}
