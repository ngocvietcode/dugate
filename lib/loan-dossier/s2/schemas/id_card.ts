// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/id_card.schema.json — KHÔNG sửa tay.
// T-DOC-01 — id_card (Căn cước công dân / CMND / Thẻ căn cước)
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
} from '../common-schema';

const HolderParty = DocumentPartySchema.extend({
  party_index: z.literal(0),
  party_role: z.literal("HOLDER"),
  party_type: z.literal("INDIVIDUAL"),
  id_type: z.enum(["CCCD", "CMND", "CAN_CUOC"]).nullable(),
  tax_id: z.null(),
  representative_name: z.null(),
  representative_position: z.null(),
  ownership: z.null(),
});

const CardInfo = z.object({
  has_chip: z.boolean().nullable(),
  has_front_side: z.boolean(),
  has_back_side: z.boolean(),
  place_of_origin: z.string().nullable(),
  place_of_birth_registration: z.string().nullable(),
  identifying_marks: z.string().nullable(),
  valid_until_raw: z.string().nullable(),
}).strict();

export const IdCardDataSchema = z.object({
  parties: z.array(HolderParty).min(1).max(1),
  legal_info: LegalInfoSchema.nullable(),
  card_info: CardInfo,
}).strict();
export type IdCardData = z.infer<typeof IdCardDataSchema>;
