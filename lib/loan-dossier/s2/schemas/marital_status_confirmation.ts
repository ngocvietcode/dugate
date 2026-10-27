// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/marital_status_confirmation.schema.json — KHÔNG sửa tay.
// T-DOC-05 — marital_status_confirmation (Giấy xác nhận tình trạng hôn nhân)
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
} from '../common-schema';

const HolderParty = DocumentPartySchema.extend({
  party_index: z.literal(0),
  party_role: z.literal("HOLDER"),
  party_type: z.literal("INDIVIDUAL"),
  id_type: z.enum(["CCCD", "CMND", "CAN_CUOC", "PASSPORT", "OTHER"]).nullable(),
  tax_id: z.null(),
  representative_name: z.null(),
  representative_position: z.null(),
  ownership: z.null(),
});

const ResidencePeriod = z.object({
  place_raw: z.string().nullable(),
  from_date: NullableDateSchema,
  to_date: NullableDateSchema,
}).strict();

export const MaritalStatusConfirmationDataSchema = z.object({
  parties: z.array(HolderParty).min(1).max(1),
  legal_info: LegalInfoSchema.nullable(),
  marital_status: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]).nullable(),
  marital_status_raw: z.string().nullable(),
  residence_period: ResidencePeriod.nullable(),
  usage_purpose: z.string().nullable(),
  validity_period_raw: z.string().nullable(),
}).strict();
export type MaritalStatusConfirmationData = z.infer<typeof MaritalStatusConfirmationDataSchema>;
