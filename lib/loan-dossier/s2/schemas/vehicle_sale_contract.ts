// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/vehicle_sale_contract.schema.json — KHÔNG sửa tay.
// T-DOC-13 — vehicle_sale_contract (Hợp đồng mua bán xe ô tô)
import { z } from 'zod';

import {
  AssetDescriptorSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
  NullableMoneySchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["SELLER", "BUYER"]),
  ownership: z.null(),
});

const Asset = AssetDescriptorSchema.extend({
  asset_type: z.enum(["vehicle"]),
  usage_context_hint: z.null(),
});

export const VehicleSaleContractDataSchema = z.object({
  parties: z.array(Party).min(2),
  assets: z.array(Asset).min(1),
  asset_details: z.array(z.object({
  asset_index: z.number().int().min(0),
  vehicle_brand: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  manufacture_year: z.number().int().min(1900).max(2100).nullable(),
  color: z.string().nullable(),
  vehicle_name: z.string().nullable(),
  unit_price: NullableMoneySchema,
}).strict()),
  contract_info: z.object({
  contract_number: z.string().nullable(),
  sign_date: NullableDateSchema,
  total_amount: NullableMoneySchema,
  payment_terms_raw: z.string().nullable(),
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type VehicleSaleContractData = z.infer<typeof VehicleSaleContractDataSchema>;
