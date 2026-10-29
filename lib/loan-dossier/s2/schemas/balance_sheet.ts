// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/balance_sheet.schema.json — KHÔNG sửa tay.
// T-DOC-29 — balance_sheet (Bảng cân đối kế toán)
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

export const BalanceSheetDataSchema = z.object({
  parties: z.array(Party).min(1),
  balance_info: z.object({
  period_raw: z.string().nullable(),
  report_date: NullableDateSchema,
  total_assets: NullableMoneySchema,
  cash_and_equivalents: NullableMoneySchema,
  short_term_receivables: NullableMoneySchema,
  inventory: NullableMoneySchema,
  fixed_assets: NullableMoneySchema,
  total_liabilities: NullableMoneySchema,
  short_term_borrowings: NullableMoneySchema,
  long_term_borrowings: NullableMoneySchema,
  owner_equity: z.number().int().nullable(),
  is_audited: z.boolean().nullable(),
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type BalanceSheetData = z.infer<typeof BalanceSheetDataSchema>;
