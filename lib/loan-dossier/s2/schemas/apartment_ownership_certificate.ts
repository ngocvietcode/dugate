// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/apartment_ownership_certificate.schema.json — KHÔNG sửa tay.
// T-DOC-18 — apartment_ownership_certificate (GCN quyền sở hữu căn hộ chung cư)
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
  asset_type: z.enum(["apartment"]),
  usage_context_hint: z.null(),
});

export const ApartmentOwnershipCertificateDataSchema = z.object({
  parties: z.array(OwnerParty).min(1),
  assets: z.array(Asset).min(1),
  asset_details: z.array(z.object({
  asset_index: z.number().int().min(0),
  land_area_m2: z.number().min(0).nullable(),
  land_use_purpose: z.string().nullable(),
  land_use_term_raw: z.string().nullable(),
  land_use_origin: z.string().nullable(),
  house_type: z.string().nullable(),
  construction_area_m2: z.number().min(0).nullable(),
  floor_area_m2: z.number().min(0).nullable(),
  number_of_floors: z.number().int().min(0).nullable(),
  floor: z.string().nullable(),
  ownership_form: z.string().nullable(),
}).strict()),
  change_records: z.array(z.object({
  record_index: z.number().int().min(0),
  change_date: NullableDateSchema,
  change_type: z.enum(["TRANSFER", "GIFT", "INHERITANCE", "OTHER"]).nullable(),
  content_raw: z.string().nullable(),
  party_indexes: z.array(z.number().int().min(0)),
}).strict()),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type ApartmentOwnershipCertificateData = z.infer<typeof ApartmentOwnershipCertificateDataSchema>;
