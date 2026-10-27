// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/vehicle_registration.schema.json — KHÔNG sửa tay.
// T-DOC-20 — vehicle_registration (Chứng nhận đăng ký xe ô tô)
import { z } from 'zod';

import {
  AssetDescriptorSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
} from '../common-schema';

const OwnerParty = DocumentPartySchema.extend({
  party_role: z.enum(["OWNER"]),
});

const Asset = AssetDescriptorSchema.extend({
  asset_type: z.enum(["vehicle"]),
  usage_context_hint: z.null(),
});

export const VehicleRegistrationDataSchema = z.object({
  parties: z.array(OwnerParty).min(1),
  assets: z.array(Asset).min(1),
  asset_details: z.array(z.object({
  asset_index: z.number().int().min(0),
  vehicle_brand: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  manufacture_year: z.number().int().min(1900).max(2100).nullable(),
  color: z.string().nullable(),
  seats: z.number().int().min(0).nullable(),
  engine_capacity_raw: z.string().nullable(),
  first_registration_date: NullableDateSchema,
}).strict()),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type VehicleRegistrationData = z.infer<typeof VehicleRegistrationDataSchema>;
