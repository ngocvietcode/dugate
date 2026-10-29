// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/vat_tax_return.schema.json — KHÔNG sửa tay.
// T-DOC-28 — vat_tax_return (Tờ khai thuế GTGT (mẫu 01/GTGT))
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
  NullableMoneySchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["TAXPAYER"]),
  ownership: z.null(),
});

export const VatTaxReturnDataSchema = z.object({
  parties: z.array(Party).min(1),
  tax_return_info: z.object({
  tax_period_raw: z.string().nullable(),
  period_type: z.enum(["MONTH", "QUARTER"]).nullable(),
  period_from: NullableDateSchema,
  period_to: NullableDateSchema,
  filing_type: z.enum(["ORIGINAL", "SUPPLEMENTARY"]).nullable(),
  sales_revenue: NullableMoneySchema,
  output_vat: NullableMoneySchema,
  deductible_input_vat: NullableMoneySchema,
  vat_payable: NullableMoneySchema,
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type VatTaxReturnData = z.infer<typeof VatTaxReturnDataSchema>;
