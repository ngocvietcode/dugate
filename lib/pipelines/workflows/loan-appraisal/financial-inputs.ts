// Đầu vào tài chính của stage 2 (T-360-03; D-114): đọc `financial_basis` của hồ sơ 360 — nguồn sự thật duy nhất. Không đọc OCR thẳng,
// nên số trên màn hình Customer 360 và số dùng tính DSCR / LTV là một. Cách chọn từng số nằm ở `lib/loan-dossier/profile360/build.ts`:
// đơn vay gốc (anchor) cho số tiền / kỳ hạn / lãi suất / nợ hiện hữu; mỗi HKD một lần cho doanh thu / lợi nhuận năm; giá trị TSBĐ thấp nhất
// các chứng thư (D-112).
import type { BasisValue, Profile360 } from '@/lib/loan-dossier/profile360/schema';

/**
 * `reviewIds` (E9, D-101): nguồn có độ tin cậy đọc của field cấp 1 < ACCEPT_CONFIDENCE hoặc không có (cùng quy tắc REVIEW của
 * V2-R04). Đầu vào vẫn được dùng để tính; chỉ số phụ thuộc mang cờ `needs_review`. Vắng / rỗng = mọi nguồn đã ACCEPTED.
 */
export interface SourcedNumber { value: number; evidenceIds: string[]; reviewIds?: string[] }

export interface FinancialInputs {
  requested: SourcedNumber | null;
  revenue: SourcedNumber | null;
  profit: SourcedNumber | null;
  debtService: SourcedNumber | null;
  collateral: SourcedNumber | null;
  tenor: SourcedNumber | null;
  rate: SourcedNumber | null;
  existingMonthly: SourcedNumber | null;
  /** Đầu vào để trống vì các giấy đề nghị vay ghi khác nhau (LAC-R03 `DISPUTED`) — giá trị là tên trường để ghi cảnh báo. */
  conflicts?: Partial<Record<'requested' | 'revenue' | 'profit' | 'collateral' | 'tenor' | 'rate' | 'existingMonthly', string>>;
}

const sourced = (b: BasisValue | null): SourcedNumber | null => (b
  ? { value: b.value, evidenceIds: [...new Set(b.record_ids)], ...(b.review_record_ids.length ? { reviewIds: [...new Set(b.review_record_ids)] } : {}) }
  : null);

export function financialInputsFromProfile(profile: Profile360 | null): FinancialInputs {
  const basis = profile?.financial_basis;
  const disputed = (key: 'bank_proposed_amount' | 'loan_term_months' | 'interest_rate') => profile?.loan[key].trust === 'DISPUTED';
  const conflicts: FinancialInputs['conflicts'] = {
    ...(disputed('bank_proposed_amount') ? { requested: 'bank_proposed_amount' } : {}),
    ...(disputed('loan_term_months') ? { tenor: 'loan_term_months' } : {}),
    ...(disputed('interest_rate') ? { rate: 'interest_rate' } : {}),
  };
  return {
    requested: sourced(basis?.loan_amount ?? null),
    tenor: sourced(basis?.tenor_months ?? null),
    rate: sourced(basis?.interest_rate ?? null),
    existingMonthly: sourced(basis?.existing_monthly_debt ?? null),
    revenue: sourced(basis?.hkd_annual_revenue ?? null),
    profit: sourced(basis?.hkd_annual_profit ?? null),
    debtService: null,
    collateral: sourced(basis?.collateral_value ?? null),
    ...(Object.keys(conflicts).length ? { conflicts } : {}),
  };
}
