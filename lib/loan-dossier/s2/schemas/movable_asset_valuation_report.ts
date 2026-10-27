// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/movable_asset_valuation_report.schema.json — KHÔNG sửa tay.
// T-DOC-23 — movable_asset_valuation_report (Báo cáo định giá động sản)
import { z } from 'zod';

import {
  AssetDescriptorSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
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

export const MovableAssetValuationReportDataSchema = z.object({
  parties: z.array(Party).min(1),
  assets: z.array(Asset).min(1),
  asset_details: z.array(z.object({
  asset_index: z.number().int().min(0),
  vehicle_brand: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  manufacture_year: z.number().int().min(1900).max(2100).nullable(),
  color: z.string().nullable(),
  asset_condition_raw: z.string().nullable(),
  valuation_value: NullableMoneySchema,
}).strict()),
  valuation_info: z.object({
  valuation_date: NullableDateSchema,
  valuation_purpose: z.string().nullable(),
  valuation_method_raw: z.string().nullable(),
  total_valuation_value: NullableMoneySchema,
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type MovableAssetValuationReportData = z.infer<typeof MovableAssetValuationReportDataSchema>;
