// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/loan_application.schema.json — KHÔNG sửa tay.
// T-DOC-10 — loan_application (Giấy đề nghị vay vốn kiêm phương án vay)
import { z } from 'zod';

import {
  AddressSchema,
  AssetDescriptorSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
  NullableMoneySchema,
  PercentSchema,
} from '../common-schema';
import { uniqueItems } from './_helpers';

const LoanApplicationParty = DocumentPartySchema.extend({
  party_role: z.enum(["BORROWER", "CO_BORROWER", "SPOUSE", "COLLATERAL_OWNER", "REFERENCE_PERSON", "LEGAL_REPRESENTATIVE", "GUARANTOR", "CAPITAL_MEMBER"]),
  ownership: z.null(),
});

const LoanApplicationFormSection = z.enum(["SECTION_2_PERSONAL_INFO", "SECTION_2_SPOUSE_INFO", "SECTION_2_7_REFERENCE_PERSON", "SECTION_4_2_COLLATERAL_OWNER", "SECTION_4_3_COLLATERAL_OWNER", "SECTION_5_SECOND_BORROWER", "SECTION_6_COLLATERAL_OWNER"]);

const PartyDetail = z.object({
  party_index: z.number().int().min(0),
  form_section: LoanApplicationFormSection,
  source_page: z.number().int().min(1).nullable(),
  is_section_page_verified: z.boolean().nullable(),
  marital_status: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]).nullable(),
  marital_status_raw: z.string().nullable(),
  relationship_to_borrower: z.enum(["PARENT_CHILD", "SIBLING", "SPOUSE", "OTHER"]).nullable(),
  relationship_to_borrower_raw: z.string().nullable(),
}).strict();

const CollateralAsset = AssetDescriptorSchema.extend({
  usage_context_hint: z.literal("collateral"),
});

const AssetDetail = z.object({
  asset_index: z.number().int().min(0),
  collateral_type_raw: z.string().nullable(),
  owner_names_raw: z.string().nullable(),
  owner_party_indexes: z.array(z.number().int().min(0)),
  declared_value: NullableMoneySchema,
  vehicle_brand: z.string().nullable(),
  vehicle_model: z.string().nullable(),
}).strict();

const BusinessInfo = z.object({
  business_name: z.string().nullable(),
  business_line: z.string().nullable(),
  business_address: AddressSchema.nullable(),
  tax_id: z.string().nullable(),
  registration_number: z.string().nullable(),
}).strict();

const LoanPurposeCategory = z.enum(["PURCHASE_VEHICLE", "PURCHASE_GOODS", "PURCHASE_FACTORY_LAND", "CONSTRUCTION_REPAIR", "WORKING_CAPITAL", "OTHER"]);

const LoanInfo = z.object({
  borrower_type: z.string().nullable(),
  requested_amount: NullableMoneySchema,
  requested_amount_page: z.number().int().min(1).nullable(),
  bank_proposed_amount: NullableMoneySchema,
  bank_proposed_amount_page: z.number().int().min(1).nullable(),
  loan_term_months: z.number().int().min(0).nullable(),
  interest_rate: z.number().min(0).max(100).nullable(),
  interest_rate_code: z.string().nullable(),
  interest_rate_raw: z.string().nullable(),
  interest_margin: z.number().min(0).max(100).nullable(),
  preferential_period_months: z.number().int().min(0).nullable(),
  loan_purposes: z.array(z.string()),
  loan_purpose_detail: z.string().nullable(),
  loan_purpose_categories: z.array(LoanPurposeCategory).superRefine(uniqueItems),
  disbursement_method: z.string().nullable(),
  principal_repayment_method: z.string().nullable(),
  interest_repayment_method: z.string().nullable(),
  principal_grace_months: z.number().int().min(0).nullable(),
}).strict();

const IncomeDetail = z.object({
  source: z.string().nullable(),
  amount: NullableMoneySchema,
  period: z.enum(["MONTHLY", "ANNUAL", "POINT_IN_TIME"]).nullable(),
}).strict();

const FinancialInfo = z.object({
  total_income: NullableMoneySchema,
  total_income_period: z.enum(["MONTHLY", "ANNUAL", "POINT_IN_TIME"]).nullable(),
  repayment_source: z.string().nullable(),
  income_details: z.array(IncomeDetail),
  has_existing_debt: z.boolean().nullable(),
  existing_monthly_debt_payment: NullableMoneySchema,
}).strict();

const CollateralSummary = z.object({
  total_collateral_value: NullableMoneySchema,
  notes: z.array(z.string()),
}).strict();

const OfficerInfo = z.object({
  case_code: z.string().nullable(),
  dao_code: z.string().nullable(),
  branch: z.string().nullable(),
  decision_date: NullableDateSchema,
  approval_flow_raw: z.string().nullable(),
}).strict();

export const LoanApplicationDataSchema = z.object({
  parties: z.array(LoanApplicationParty),
  party_details: z.array(PartyDetail),
  assets: z.array(CollateralAsset),
  asset_details: z.array(AssetDetail),
  business_info: BusinessInfo.nullable(),
  loan_info: LoanInfo.nullable(),
  financial_info: FinancialInfo.nullable(),
  collateral_summary: CollateralSummary.nullable(),
  ltv: PercentSchema.nullable(),
  officer_info: OfficerInfo.nullable(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type LoanApplicationData = z.infer<typeof LoanApplicationDataSchema>;
