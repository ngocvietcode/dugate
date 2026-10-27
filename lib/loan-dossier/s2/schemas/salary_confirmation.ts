// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/salary_confirmation.schema.json — KHÔNG sửa tay.
// T-DOC-15 — salary_confirmation (Giấy xác nhận lương)
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

export const SalaryConfirmationDataSchema = z.object({
  parties: z.array(Party).min(1),
  salary_info: z.object({
  position: z.string().nullable(),
  months_at_employer: z.number().int().min(0).nullable(),
  monthly_salary: NullableMoneySchema,
  gross_monthly_salary: NullableMoneySchema,
  salary_period_raw: z.string().nullable(),
  confirmation_date: NullableDateSchema,
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type SalaryConfirmationData = z.infer<typeof SalaryConfirmationDataSchema>;
