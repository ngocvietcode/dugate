// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/vehicle_inspection.schema.json — KHÔNG sửa tay.
// T-DOC-21 — vehicle_inspection (Giấy chứng nhận đăng kiểm xe)
import { z } from 'zod';

import {
  AssetDescriptorSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["OWNER"]),
  ownership: z.null(),
});

const Asset = AssetDescriptorSchema.extend({
  asset_type: z.enum(["vehicle"]),
  usage_context_hint: z.null(),
});

export const VehicleInspectionDataSchema = z.object({
  parties: z.array(Party),
  assets: z.array(Asset).min(1),
  asset_details: z.array(z.object({
  asset_index: z.number().int().min(0),
  vehicle_brand: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  manufacture_year: z.number().int().min(1900).max(2100).nullable(),
  color: z.string().nullable(),
  country_of_manufacture: z.string().nullable(),
  modification_status_raw: z.string().nullable(),
  seats: z.number().int().min(0).nullable(),
  payload_kg: z.number().min(0).nullable(),
  gross_weight_kg: z.number().min(0).nullable(),
}).strict()),
  inspection_info: z.object({
  inspection_number: z.string().nullable(),
  management_number: z.string().nullable(),
  inspection_date: NullableDateSchema,
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type VehicleInspectionData = z.infer<typeof VehicleInspectionDataSchema>;
