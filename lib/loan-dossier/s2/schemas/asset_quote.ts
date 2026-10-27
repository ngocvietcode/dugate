// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/asset_quote.schema.json — KHÔNG sửa tay.
// T-DOC-24 — asset_quote (Báo giá tài sản)
import { z } from 'zod';

import {
  AssetDescriptorSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableMoneySchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["CUSTOMER", "OWNER"]),
  ownership: z.null(),
});

const Asset = AssetDescriptorSchema.extend({
  asset_type: z.enum(["vehicle", "other"]),
  usage_context_hint: z.null(),
});

export const AssetQuoteDataSchema = z.object({
  parties: z.array(Party).min(1),
  assets: z.array(Asset).min(1),
  asset_details: z.array(z.object({
  asset_index: z.number().int().min(0),
  vehicle_brand: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  manufacture_year: z.number().int().min(1900).max(2100).nullable(),
  color: z.string().nullable(),
  asset_name: z.string().nullable(),
  quantity: z.number().min(0).nullable(),
  quoted_value: NullableMoneySchema,
}).strict()),
  quote_info: z.object({
  quoting_company: z.string().nullable(),
  quote_number: z.string().nullable(),
  total_quoted_value: NullableMoneySchema,
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type AssetQuoteData = z.infer<typeof AssetQuoteDataSchema>;
