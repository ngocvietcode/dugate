// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/local_cmnd_confirmation.schema.json — KHÔNG sửa tay.
// T-DOC-06 — local_cmnd_confirmation (Xác nhận CMND của chính quyền địa phương)
import { z } from 'zod';

import {
  DocumentPartySchema,
  IdNumberSchema,
  LegalInfoSchema,
  NullableDateSchema,
} from '../common-schema';

const HolderParty = DocumentPartySchema.extend({
  party_index: z.literal(0),
  party_role: z.literal("HOLDER"),
  party_type: z.literal("INDIVIDUAL"),
  id_type: z.enum(["CCCD", "CAN_CUOC", "CMND", "OTHER"]).nullable(),
  tax_id: z.null(),
  representative_name: z.null(),
  representative_position: z.null(),
  ownership: z.null(),
});

const PreviousIdDocument = z.object({
  id_number: IdNumberSchema.nullable(),
  id_type: z.enum(["CCCD", "CMND", "CAN_CUOC", "PASSPORT", "TAX_ID", "OTHER"]).nullable(),
  issue_date: NullableDateSchema,
  issue_place: z.string().nullable(),
}).strict();

export const LocalCmndConfirmationDataSchema = z.object({
  parties: z.array(HolderParty).min(1).max(1),
  legal_info: LegalInfoSchema.nullable(),
  previous_id_documents: z.array(PreviousIdDocument),
  confirmation_statement: z.string().nullable(),
}).strict();
export type LocalCmndConfirmationData = z.infer<typeof LocalCmndConfirmationDataSchema>;
