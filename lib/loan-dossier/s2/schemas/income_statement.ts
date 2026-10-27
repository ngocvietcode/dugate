// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/income_statement.schema.json — KHÔNG sửa tay.
// T-DOC-16 — income_statement (Bảng kê thu nhập (mẫu MB01.QĐi-TDCN/41))
import { z } from 'zod';

import {
  AddressSchema,
  AssetDescriptorSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableMoneySchema,
  PercentSchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["BORROWER", "CO_BORROWER"]),
  ownership: z.null(),
});

const RentalAsset = AssetDescriptorSchema.extend({
  asset_type: z.enum(["real_estate", "apartment", "vehicle", "other"]),
  usage_context_hint: z.literal("rental_income"),
});

export const IncomeStatementDataSchema = z.object({
  parties: z.array(Party).min(1),
  income_summary: z.object({
  income_source_type_raw: z.string().nullable(),
  capital_turnover: z.number().min(0).nullable(),
  total_monthly_income: NullableMoneySchema,
}).strict(),
  income_sources: z.array(z.object({
  source_index: z.number().int().min(0),
  party_index: z.number().int().min(0).nullable(),
  income_type: z.enum(["salary", "rental", "household_business", "trip_trading", "enterprise", "other"]),
  source_label_raw: z.string().nullable(),
  monthly_amount: NullableMoneySchema,
  frequency_raw: z.string().nullable(),
  salary: z.object({
  employer_name: z.string().nullable(),
  current_job_raw: z.string().nullable(),
  position: z.string().nullable(),
  months_at_employer: z.number().int().min(0).nullable(),
  workplace_address: AddressSchema.nullable(),
}).strict().nullable(),
  rental: z.object({
  asset_index: z.number().int().min(0).nullable(),
  asset_description_raw: z.string().nullable(),
  owner_name: z.string().nullable(),
  tenant_name: z.string().nullable(),
  contract_term_raw: z.string().nullable(),
}).strict().nullable(),
  household_business: z.object({
  business_name: z.string().nullable(),
  business_forms: z.array(z.enum(["PHYSICAL_PREMISES", "ONLINE"])),
  business_line: z.string().nullable(),
  operating_time_raw: z.string().nullable(),
  actual_address: AddressSchema.nullable(),
  premises_type_raw: z.string().nullable(),
  premises_area_m2: z.number().min(0).nullable(),
  net_revenue_annual: NullableMoneySchema,
  cogs_annual: NullableMoneySchema,
  gross_profit_annual: NullableMoneySchema,
  total_cost_annual: NullableMoneySchema,
  net_profit_annual: NullableMoneySchema,
}).strict().nullable(),
  trip_trading: z.object({
  vehicle_raw: z.string().nullable(),
  net_profit: NullableMoneySchema,
  net_profit_period: z.enum(["MONTHLY", "ANNUAL", "POINT_IN_TIME"]).nullable(),
}).strict().nullable(),
  enterprise: z.object({
  enterprise_name: z.string().nullable(),
  registration_or_tax_number: z.string().nullable(),
  capital_share_percent: PercentSchema.nullable(),
  registered_address: AddressSchema.nullable(),
  annual_result: NullableMoneySchema,
  avg_monthly_profit: NullableMoneySchema,
}).strict().nullable(),
}).strict()),
  assets: z.array(RentalAsset),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type IncomeStatementData = z.infer<typeof IncomeStatementDataSchema>;
