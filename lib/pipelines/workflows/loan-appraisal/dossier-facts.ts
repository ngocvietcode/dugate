// Dữ kiện hồ sơ gọn cho prompt LLM (người, tài sản, khoản vay, nguồn thu). Hàm thuần. Tách khỏi `intake-review.ts`
// (bước đang tắt) vì kiểm tra sơ bộ / output giai đoạn 1 (`precheck-intake.ts`) vẫn dùng (D-97).
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { assetIdentity } from './intake-assessment';

export interface DossierFactsInput {
  product_name: string;
  flow: string | null;
  file_count: number;
  s3: MapDossierData | null;
  evidences: ReadonlyArray<EvidenceEnvelope>;
}

interface LoanInfoLike { requested_amount?: unknown; bank_proposed_amount?: unknown; loan_purposes?: unknown; interest_rate_code?: unknown }
interface FinancialInfoLike { income_details?: Array<{ source?: string | null }>; repayment_source?: string | null }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Thông tin hồ sơ cho LLM: người, tài sản, khoản vay, nguồn thu. Không gồm số giấy tờ của người. */
export function buildDossierFacts(input: DossierFactsInput): Record<string, unknown> {
  const apps = input.evidences.filter((e) => e.status === 'SUCCESS' && e.doc_type_key === 'loan_application');
  const loan = apps.map((e) => e.data?.loan_info as LoanInfoLike | null | undefined).find((l) => l) ?? null;
  const fin = apps.map((e) => e.data?.financial_info as FinancialInfoLike | null | undefined).find((f) => f) ?? null;
  const income = [...new Set([...(fin?.income_details ?? []).map((d) => str(d.source)), str(fin?.repayment_source)].filter((x): x is string => x !== null))];
  return {
    product: input.product_name,
    flow: input.flow,
    file_count: input.file_count,
    evidence_count: input.evidences.length,
    readable_evidence_count: input.evidences.filter((e) => e.status === 'SUCCESS').length,
    persons: (input.s3?.customer_360 ?? []).map((c) => ({ person_id: c.person_id, name: c.identity.full_name ?? null, roles: c.roles })),
    assets: (input.s3?.asset_registry ?? []).map((a) => ({
      asset_id: a.asset_id, type: a.asset_type, identity: assetIdentity(a), usage: a.usage_contexts, context_status: a.context_status,
    })),
    loan: loan
      ? {
        requested_amount: loan.requested_amount ?? null,
        bank_proposed_amount: loan.bank_proposed_amount ?? null,
        purposes: Array.isArray(loan.loan_purposes) ? loan.loan_purposes.filter((p): p is string => typeof p === 'string').slice(0, 5) : [],
        interest_rate_code: loan.interest_rate_code ?? null,
      }
      : null,
    income_sources: income.slice(0, 6),
  };
}
