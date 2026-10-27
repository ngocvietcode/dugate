// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/same_person_commitment.schema.json — KHÔNG sửa tay.
// T-DOC-07 — same_person_commitment (Cam kết 2 CMND/CCCD là 1 người)
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

export const SamePersonCommitmentDataSchema = z.object({
  parties: z.array(HolderParty).min(1).max(1),
  legal_info: LegalInfoSchema.nullable(),
  previous_id_documents: z.array(PreviousIdDocument),
  commitment_statement: z.string().nullable(),
}).strict();
export type SamePersonCommitmentData = z.infer<typeof SamePersonCommitmentDataSchema>;
