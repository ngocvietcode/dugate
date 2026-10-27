// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/residence_confirmation.schema.json — KHÔNG sửa tay.
// T-DOC-04 — residence_confirmation (Giấy xác nhận thông tin cư trú (CT07/CT08))
import { z } from 'zod';

import {
  AddressSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
} from '../common-schema';

const ResidenceParty = DocumentPartySchema.extend({
  party_role: z.enum(["HOLDER", "HOUSEHOLD_MEMBER"]),
  party_type: z.literal("INDIVIDUAL"),
  id_type: z.enum(["CCCD", "CMND", "CAN_CUOC", "OTHER"]).nullable(),
  tax_id: z.null(),
  representative_name: z.null(),
  representative_position: z.null(),
  ownership: z.null(),
});

const HouseholdMemberParty = ResidenceParty.extend({
  party_index: ResidenceParty.shape.party_index.min(1),
  party_role: z.literal("HOUSEHOLD_MEMBER"),
});

const HolderParty = ResidenceParty.extend({
  party_index: z.literal(0),
  party_role: z.literal("HOLDER"),
});

const ResidenceInfo = z.object({
  place_of_origin: z.string().nullable(),
  temporary_address: AddressSchema.nullable(),
  temporary_residence_from: NullableDateSchema,
  temporary_residence_until: NullableDateSchema,
  temporary_residence_duration_raw: z.string().nullable(),
  household_head_party_index: z.number().int().min(0).nullable(),
  holder_relationship_to_household_head_raw: z.string().nullable(),
}).strict();

export const ResidenceConfirmationDataSchema = z.object({
  parties: z.tuple([HolderParty]).rest(HouseholdMemberParty),
  legal_info: LegalInfoSchema.nullable(),
  residence_info: ResidenceInfo,
  confirmation_statements: z.array(z.string()),
  validity_period_raw: z.string().nullable(),
}).strict();
export type ResidenceConfirmationData = z.infer<typeof ResidenceConfirmationDataSchema>;
