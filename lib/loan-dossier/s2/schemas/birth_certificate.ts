// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/birth_certificate.schema.json — KHÔNG sửa tay.
// T-DOC-09 — birth_certificate (Giấy khai sinh)
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
} from '../common-schema';
import { containsRule } from './_helpers';

const BirthParty = DocumentPartySchema.extend({
  party_index: DocumentPartySchema.shape.party_index.max(2),
  party_role: z.enum(["CHILD", "FATHER", "MOTHER"]),
  party_type: z.literal("INDIVIDUAL"),
  tax_id: z.null(),
  representative_name: z.null(),
  representative_position: z.null(),
  ownership: z.null(),
});

export const BirthCertificateDataSchema = z.object({
  parties: z.array(BirthParty).min(1).max(3).superRefine(containsRule([
    { schema: z.object({ party_role: z.literal("CHILD"), }).passthrough(), min: 1, max: 1, label: "party_role = CHILD" },
    { schema: z.object({ party_role: z.literal("FATHER"), }).passthrough(), min: 0, max: 1, label: "party_role = FATHER" },
    { schema: z.object({ party_role: z.literal("MOTHER"), }).passthrough(), min: 0, max: 1, label: "party_role = MOTHER" },
  ])),
  legal_info: LegalInfoSchema.nullable(),
  place_of_birth: z.string().nullable(),
  registration_date: NullableDateSchema,
  registration_book_number: z.string().nullable(),
  place_of_registration: z.string().nullable(),
}).strict();
export type BirthCertificateData = z.infer<typeof BirthCertificateDataSchema>;
