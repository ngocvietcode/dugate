// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/credit_contract.schema.json — KHÔNG sửa tay.
// T-DOC-27 — credit_contract (Hợp đồng tín dụng tại TCTD khác)
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
  NullableMoneySchema,
  PercentSchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["BORROWER", "CO_BORROWER", "LENDER"]),
  ownership: z.null(),
});

export const CreditContractDataSchema = z.object({
  parties: z.array(Party).min(1),
  contract_info: z.object({
  contract_number: z.string().nullable(),
  sign_date: NullableDateSchema,
  loan_amount: NullableMoneySchema,
  loan_purpose: z.string().nullable(),
  loan_term_months: z.number().int().min(0).nullable(),
  loan_term_raw: z.string().nullable(),
  interest_rate: PercentSchema.nullable(),
  maturity_date: NullableDateSchema,
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type CreditContractData = z.infer<typeof CreditContractDataSchema>;
