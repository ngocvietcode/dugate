// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/vneid.schema.json — KHÔNG sửa tay.
// T-DOC-02 — vneid (Căn cước điện tử (VNeID))
import { z } from 'zod';

import {
  AddressSchema,
  DocumentPartySchema,
  LegalInfoSchema,
} from '../common-schema';

const HolderParty = DocumentPartySchema.extend({
  party_index: z.literal(0),
  party_role: z.literal("HOLDER"),
  party_type: z.literal("INDIVIDUAL"),
  id_type: z.enum(["CCCD", "CAN_CUOC"]).nullable(),
  tax_id: z.null(),
  representative_name: z.null(),
  representative_position: z.null(),
  ownership: z.null(),
});

const ElectronicIdInfo = z.object({
  place_of_origin: z.string().nullable(),
  place_of_birth_registration: z.string().nullable(),
  temporary_address: AddressSchema.nullable(),
  screen_count: z.number().int().min(1),
}).strict();

export const VneidDataSchema = z.object({
  parties: z.array(HolderParty).min(1).max(1),
  legal_info: LegalInfoSchema.nullable(),
  electronic_id_info: ElectronicIdInfo,
}).strict();
export type VneidData = z.infer<typeof VneidDataSchema>;
