// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/financial_performance_report.schema.json — KHÔNG sửa tay.
// T-DOC-30 — financial_performance_report (Báo cáo kết quả hoạt động kinh doanh)
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
  NullableMoneySchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["HOLDER"]),
  ownership: z.null(),
});

export const FinancialPerformanceReportDataSchema = z.object({
  parties: z.array(Party).min(1),
  performance_info: z.object({
  period_raw: z.string().nullable(),
  period_from: NullableDateSchema,
  period_to: NullableDateSchema,
  net_revenue: NullableMoneySchema,
  cogs: NullableMoneySchema,
  gross_profit: z.number().int().nullable(),
  interest_expense: NullableMoneySchema,
  profit_before_tax: z.number().int().nullable(),
  profit_after_tax: z.number().int().nullable(),
  is_audited: z.boolean().nullable(),
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type FinancialPerformanceReportData = z.infer<typeof FinancialPerformanceReportDataSchema>;
