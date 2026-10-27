// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/external_valuation_certificate.schema.json — KHÔNG sửa tay.
// T-DOC-25 — external_valuation_certificate (Chứng thư định giá công ty định giá ngoài)
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
  asset_type: z.enum(["real_estate", "apartment"]),
  usage_context_hint: z.null(),
});

export const ExternalValuationCertificateDataSchema = z.object({
  parties: z.array(Party).min(1),
  assets: z.array(Asset).min(1),
  asset_details: z.array(z.object({
  asset_index: z.number().int().min(0),
  land_area_m2: z.number().min(0).nullable(),
  land_use_status: z.string().nullable(),
  land_value: NullableMoneySchema,
  construction_value: NullableMoneySchema,
  valuation_value: NullableMoneySchema,
  asset_grade: z.string().nullable(),
}).strict()),
  valuation_info: z.object({
  appraisal_company: z.enum(["THINH_DIEN", "SBA", "CITICS", "FARGO", "VVFC", "OTHER"]).nullable(),
  form_variant: z.null(),
  valuation_certificate_number: z.string().nullable(),
  valuation_date: NullableDateSchema,
  valuation_purpose: z.string().nullable(),
  collateral_info_text: z.string().nullable(),
  validity_period_raw: z.string().nullable(),
  total_valuation_value: NullableMoneySchema,
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type ExternalValuationCertificateData = z.infer<typeof ExternalValuationCertificateDataSchema>;
