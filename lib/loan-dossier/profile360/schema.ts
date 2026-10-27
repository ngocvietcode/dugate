// Lớp 2 của hồ sơ 360 (spec cross_cutting/loan_360.md §3, §3.1, §3.2; D-108). Zod là nguồn duy nhất, kiểu suy ra từ đây.
// Dựng bằng code từ S2 + S3 + LAC, không gọi model. Mang giá trị thật (PII): chỉ ở bộ nhớ worker, không log.
import { z } from 'zod';

import { LacTrustSchema } from '../context/schema';

export const PROFILE360_VERSION = '0.1' as const;

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

/** Một trường đã chọn giá trị: `fact_ids` là mọi fact LAC góp vào trường, kể cả giá trị không được chọn. */
export const ProfileFieldSchema = z.object({
  value: Scalar.nullable(),
  fact_ids: z.array(z.string()),
  trust: LacTrustSchema.nullable(),
  review: z.enum(['ACCEPTED', 'REVIEW']).nullable(),
}).strict();

export const VerificationSchema = z.enum(['VERIFIED', 'PARTIAL', 'UNVERIFIED']);

export const LoanSchema = z.object({
  requested_amount: ProfileFieldSchema,
  bank_proposed_amount: ProfileFieldSchema,
  loan_term_months: ProfileFieldSchema,
  interest_rate: ProfileFieldSchema,
}).strict();

export const PartySchema = z.object({
  person_id: z.string(),
  party_type: z.enum(['INDIVIDUAL', 'ORGANIZATION']),
  roles: z.array(z.string()),
  full_name: ProfileFieldSchema,
  id_number: ProfileFieldSchema,
  date_of_birth: ProfileFieldSchema,
}).strict();

export const AssetSchema = z.object({
  asset_id: z.string(),
  asset_type: z.string(),
  usage_contexts: z.array(z.string()),
  current_owner_person_ids: z.array(z.string()),
}).strict();

export const BusinessFlagSchema = z.enum(['BUSINESS_MATCH_REVIEW', 'BUSINESS_NUMBER_MISMATCH']);

export const BusinessUnitSchema = z.object({
  business_id: z.string().regex(/^biz-\d+$/),
  /** v1 chỉ HKD; `ENTERPRISE` thêm ở T-360-09. */
  kind: z.literal('HKD'),
  name: ProfileFieldSchema,
  registration_number: ProfileFieldSchema,
  tax_id: ProfileFieldSchema,
  business_line: ProfileFieldSchema,
  business_address: ProfileFieldSchema,
  owner_person_ids: z.array(z.string()),
  /** Loại chứng từ nhắc tới đơn vị (đếm theo evidence), để biết GCN ĐKHKD / xác nhận địa phương có hay không. */
  mentioned_in: z.array(z.object({ doc_type_key: z.string(), count: z.number().int().min(1) }).strict()),
  flags: z.array(BusinessFlagSchema),
}).strict();

export const IncomeKindSchema = z.enum(['salary', 'rental', 'household_business', 'trip_trading', 'enterprise', 'other']);

export const IncomeAmountSchema = z.object({
  /** Số tiền theo tháng như chứng từ ghi. */
  value: z.number(),
  doc_type_key: z.string(),
  fact_ids: z.array(z.string()),
}).strict();

export const IncomeStreamSchema = z.object({
  income_id: z.string().regex(/^inc-\d+$/),
  kind: IncomeKindSchema,
  person_id: z.string().nullable(),
  business_id: z.string().nullable(),
  asset_id: z.string().nullable(),
  /** Bên trả lương (chỉ `salary`). */
  employer: ProfileFieldSchema.nullable(),
  amounts: z.array(IncomeAmountSchema),
  /** Số tiền theo tháng chọn theo `merge_policies.json` (L360-G01); null khi không có số hoặc catalog hỏng. */
  monthly_amount: z.number().nullable(),
  /** Có chứng từ bóc tách nhẹ chứng minh nguồn thu tồn tại (sao kê lương, VssID, HĐ thuê…); không góp số tiền (L360-G03). */
  evidenced: z.boolean(),
}).strict();

export const ProfileRelationSchema = z.object({
  type: z.enum(['OPERATES', 'EARNS_FROM']),
  from: z.string(),
  to: z.string(),
  verification: VerificationSchema,
}).strict();

export const ProfileGapCodeSchema = z.enum(['MERGE_POLICY_INVALID', 'DECLARED_INCOME_NOT_LINKED', 'INCOME_OWNER_NOT_MAPPED']);

export const Profile360Schema = z.object({
  profile_version: z.literal(PROFILE360_VERSION),
  loan: LoanSchema,
  parties: z.array(PartySchema),
  assets: z.array(AssetSchema),
  business_units: z.array(BusinessUnitSchema),
  income_streams: z.array(IncomeStreamSchema),
  relations: z.array(ProfileRelationSchema),
  /** Số mục bị ảnh hưởng, không chứa giá trị. */
  gaps: z.array(z.object({ code: ProfileGapCodeSchema, count: z.number().int().min(1) }).strict()),
  meta: z.object({ lac_source_hash: z.string(), merge_policy_version: z.string().nullable() }).strict(),
}).strict();

export type ProfileField = z.infer<typeof ProfileFieldSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
export type BusinessUnit = z.infer<typeof BusinessUnitSchema>;
export type BusinessFlag = z.infer<typeof BusinessFlagSchema>;
export type IncomeKind = z.infer<typeof IncomeKindSchema>;
export type IncomeStream = z.infer<typeof IncomeStreamSchema>;
export type ProfileRelation = z.infer<typeof ProfileRelationSchema>;
export type ProfileGapCode = z.infer<typeof ProfileGapCodeSchema>;
export type Profile360 = z.infer<typeof Profile360Schema>;
