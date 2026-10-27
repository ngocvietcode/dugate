// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/qr_code_info.schema.json — KHÔNG sửa tay.
// T-DOC-03 — qr_code_info (Thông tin sau khi quét mã QR CCCD)
import { z } from 'zod';

import {
  DocumentPartySchema,
} from '../common-schema';

const HolderParty = DocumentPartySchema.extend({
  party_index: z.literal(0),
  party_role: z.literal("HOLDER"),
  party_type: z.literal("INDIVIDUAL"),
  id_type: z.enum(["CCCD", "CAN_CUOC"]).nullable(),
  current_address: z.null(),
  tax_id: z.null(),
  representative_name: z.null(),
  representative_position: z.null(),
  ownership: z.null(),
});

export const QrCodeInfoDataSchema = z.object({
  parties: z.array(HolderParty).min(1).max(1),
  qr_raw_text: z.string().nullable(),
}).strict();
export type QrCodeInfoData = z.infer<typeof QrCodeInfoDataSchema>;
