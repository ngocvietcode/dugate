// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/marriage_certificate.schema.json — KHÔNG sửa tay.
// T-DOC-08 — marriage_certificate (Giấy chứng nhận đăng ký kết hôn)
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
} from '../common-schema';
import { containsRule } from './_helpers';

const SpouseParty = DocumentPartySchema.extend({
  party_index: DocumentPartySchema.shape.party_index.max(1),
  party_role: z.enum(["HUSBAND", "WIFE"]),
  party_type: z.literal("INDIVIDUAL"),
  tax_id: z.null(),
  representative_name: z.null(),
  representative_position: z.null(),
  ownership: z.null(),
});

export const MarriageCertificateDataSchema = z.object({
  parties: z.array(SpouseParty).min(2).max(2).superRefine(containsRule([
    { schema: z.object({ party_role: z.literal("HUSBAND"), }).passthrough(), min: 1, max: 1, label: "party_role = HUSBAND" },
    { schema: z.object({ party_role: z.literal("WIFE"), }).passthrough(), min: 1, max: 1, label: "party_role = WIFE" },
  ])),
  legal_info: LegalInfoSchema.nullable(),
  marital_status: z.literal("MARRIED"),
  registration_date: NullableDateSchema,
  registration_book_number: z.string().nullable(),
  place_of_registration: z.string().nullable(),
}).strict();
export type MarriageCertificateData = z.infer<typeof MarriageCertificateDataSchema>;
