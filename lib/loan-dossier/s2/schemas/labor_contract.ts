// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/labor_contract.schema.json — KHÔNG sửa tay.
// T-DOC-14 — labor_contract (Hợp đồng lao động)
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
  NullableMoneySchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["EMPLOYER", "EMPLOYEE"]),
  ownership: z.null(),
});

export const LaborContractDataSchema = z.object({
  parties: z.array(Party).min(1),
  contract_info: z.object({
  contract_number: z.string().nullable(),
  contract_type_raw: z.string().nullable(),
  sign_date: NullableDateSchema,
  effective_date: NullableDateSchema,
  expiry_date: NullableDateSchema,
  position: z.string().nullable(),
  work_location_raw: z.string().nullable(),
  monthly_salary: NullableMoneySchema,
  payment_terms_raw: z.string().nullable(),
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type LaborContractData = z.infer<typeof LaborContractDataSchema>;
