// Điều kiện ngữ nghĩa bằng LLM (T-S4-04; S4-R10). Mỗi port gọi tối đa 1 lần; lỗi/nhãn lạ → INPUT_NOT_PROVIDED.
import { docTypesPresent, type ChecklistContext, type ConditionResult } from './context';

export const INCOME_LABELS = ['salary', 'rental', 'household_business', 'enterprise'] as const;
export type IncomeLabel = typeof INCOME_LABELS[number];

export interface LlmClassifierPort {
  /** Nhãn của các nguồn thu (tập đóng INCOME_LABELS). Ném lỗi khi LLM lỗi/timeout. */
  classifyIncomeSource(texts: string[]): Promise<string[]>;
  /** Trả lời đóng YES/NO cho 2 câu hỏi mục đích vay. */
  classifyLoanPurpose(texts: string[]): Promise<{ vehicle_purchase: string; factory_purchase: string }>;
}

export const SEMANTIC_CONDITIONS = [
  'loan_purpose_vehicle_purchase', 'loan_purpose_factory_purchase',
  'income_source_salary', 'income_source_rental', 'income_source_household_business', 'income_source_enterprise',
] as const;
export type SemanticConditionId = typeof SEMANTIC_CONDITIONS[number];
export type SemanticResults = Record<SemanticConditionId, ConditionResult>;

const HKD_PATTERN = /h[ộo]\s*kinh\s*doanh|\bhkd\b/iu;

function loanApps(ctx: ChecklistContext) {
  return ctx.evidences.filter((e) => e.status === 'SUCCESS' && e.doc_type_key === 'loan_application' && !ctx.superseded.has(e.evidence_id));
}

/** Chuỗi nguồn thu từ loan_application (income_details[].source + repayment_source). */
export function incomeTexts(ctx: ChecklistContext): string[] {
  const out: string[] = [];
  for (const e of loanApps(ctx)) {
    const fin = e.data?.financial_info as { income_details?: Array<{ source: string | null }>; repayment_source?: string | null } | null | undefined;
    for (const d of fin?.income_details ?? []) if (d.source?.trim()) out.push(d.source.trim());
    if (fin?.repayment_source?.trim()) out.push(fin.repayment_source.trim());
  }
  return [...new Set(out)];
}

export function purposeTexts(ctx: ChecklistContext): string[] {
  const out: string[] = [];
  for (const e of loanApps(ctx)) {
    const li = e.data?.loan_info as { loan_purposes?: string[] } | null | undefined;
    for (const p of li?.loan_purposes ?? []) if (p?.trim()) out.push(p.trim());
  }
  return [...new Set(out)];
}

const yesNo = (v: unknown): ConditionResult => (v === 'YES' ? 'MET' : v === 'NO' ? 'NOT_MET' : 'INPUT_NOT_PROVIDED');

/** Tính cả 6 điều kiện `LLM_SEMANTIC`; `needed` giới hạn chỉ gọi LLM khi có dòng cần (S4-R12). */
export async function evaluateSemanticConditions(
  ctx: ChecklistContext,
  port: LlmClassifierPort | null,
  needed: ReadonlySet<string>,
): Promise<SemanticResults> {
  const present = docTypesPresent(ctx);
  const has = (...keys: string[]) => keys.some((k) => present.has(k));
  const out = Object.fromEntries(SEMANTIC_CONDITIONS.map((c) => [c, 'INPUT_NOT_PROVIDED'])) as SemanticResults;

  // Mục đích vay — 1 lần gọi cho 2 điều kiện
  if (needed.has('loan_purpose_vehicle_purchase') || needed.has('loan_purpose_factory_purchase')) {
    const texts = purposeTexts(ctx);
    if (texts.length > 0 && port) {
      try {
        const r = await port.classifyLoanPurpose(texts);
        out.loan_purpose_vehicle_purchase = yesNo(r?.vehicle_purchase);
        out.loan_purpose_factory_purchase = yesNo(r?.factory_purchase);
      } catch { /* lỗi/timeout LLM → INPUT_NOT_PROVIDED */ }
    }
  }

  // Nguồn thu — 1 lần gọi cho 4 điều kiện
  const incomeNeeded = ['income_source_salary', 'income_source_rental', 'income_source_household_business', 'income_source_enterprise', 'household_business_license_required']
    .some((c) => needed.has(c));
  if (incomeNeeded) {
    const texts = incomeTexts(ctx);
    const rentalAsset = (ctx.s3?.asset_registry ?? []).some((a) => (a.usage_contexts as string[]).includes('rental_income'));
    const borrowerType = loanApps(ctx).map((e) => (e.data?.loan_info as { borrower_type?: string | null } | null)?.borrower_type).find((b) => b);
    const hkdByType = Boolean(borrowerType && HKD_PATTERN.test(borrowerType));
    let labels: Set<string> | null = null;
    if (texts.length > 0 && port) {
      try {
        const raw = await port.classifyIncomeSource(texts);
        if (Array.isArray(raw) && raw.every((l) => (INCOME_LABELS as readonly string[]).includes(l))) labels = new Set(raw);
      } catch { /* → INPUT_NOT_PROVIDED */ }
    }
    const fromLabels = (label: IncomeLabel, fallbackDocs: string[] | null): ConditionResult => {
      if (labels) return labels.has(label) ? 'MET' : 'NOT_MET';
      if (texts.length === 0 && fallbackDocs && has(...fallbackDocs)) return 'MET';
      return 'INPUT_NOT_PROVIDED';
    };
    out.income_source_salary = fromLabels('salary', ['labor_contract', 'salary_confirmation', 'payroll_bank_statement']);
    out.income_source_rental = rentalAsset ? 'MET' : fromLabels('rental', ['asset_lease_contract', 'rental_payment_receipt', 'rental_asset_photo']);
    out.income_source_household_business = hkdByType ? 'MET' : fromLabels('household_business', null);
    out.income_source_enterprise = fromLabels('enterprise', ['enterprise_registration_license']);
  }
  return out;
}

// Prompt của 2 port LLM nằm ở lib/pipelines/workflows/loan-appraisal/condition-prompts.ts (cấu hình được qua Profile).
