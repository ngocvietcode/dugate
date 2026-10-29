// Hồ sơ 360 — NGUỒN SỰ THẬT DUY NHẤT của một hồ sơ vay (loan_360.md §2, §3; D-108, D-114). Zod là nguồn duy nhất, kiểu suy ra từ đây.
// Dựng bằng code từ S2 + S3 + LAC, không gọi model. Tài chính (stage 2), giao diện và danh sách vấn đề đều đọc từ đây, không đọc OCR thẳng.
// Trục đọc: Đề nghị vay → Khách hàng → Nguồn trả nợ (thu nhập, hộ kinh doanh) → Nghĩa vụ nợ → Tài sản bảo đảm.
// Mang giá trị thật (PII): lưu cùng mức với `customer_360`, không log.
import { z } from 'zod';

import { LacTrustSchema } from '../context/schema';

export const PROFILE360_VERSION = '1.0' as const;

const Scalar = z.union([z.string(), z.number(), z.boolean()]);
const Review = z.enum(['ACCEPTED', 'REVIEW']);

/** Một trường đã chọn giá trị: `fact_ids` là mọi fact LAC góp vào trường, kể cả giá trị không được chọn. */
export const ProfileFieldSchema = z.object({
  value: Scalar.nullable(),
  fact_ids: z.array(z.string()),
  trust: LacTrustSchema.nullable(),
  review: Review.nullable(),
}).strict();

/** Một dữ kiện chi tiết của chủ thể (từ LAC): phần còn lại sau các trường có cấu trúc, để hiển thị đủ mà không đọc OCR. */
export const DetailFactSchema = z.object({
  fact_id: z.string(),
  /** Trường chung của LAC (`parties[].phone_number`…), để payload tích hợp có đường dẫn ổn định. */
  field: z.string(),
  label: z.string(),
  value: Scalar,
  trust: LacTrustSchema,
  review: Review,
  doc_types: z.array(z.string()),
}).strict();

export const VerificationSchema = z.enum(['VERIFIED', 'PARTIAL', 'UNVERIFIED', 'NOT_REQUIRED']);
const DocCount = z.object({ doc_type_key: z.string(), count: z.number().int().min(1) }).strict();

export const ApplicationSchema = z.object({
  /** Giấy đề nghị vay được chọn làm gốc (anchor S3). Mọi số của khoản vay lấy từ bản này; bản khác lệch → `DISPUTED`. */
  evidence_id: z.string().nullable(),
  product_code: z.string(),
  segment: z.string().nullable(),
}).strict();

export const LoanSchema = z.object({
  requested_amount: ProfileFieldSchema,
  bank_proposed_amount: ProfileFieldSchema,
  loan_term_months: ProfileFieldSchema,
  interest_rate: ProfileFieldSchema,
  purposes: z.array(z.string()),
}).strict();

export const CustomerRelationSchema = z.object({
  /** `HOUSEHOLD_MEMBER_OF`: cùng hộ trên xác nhận cư trú (CT07), `person_id` = chủ hộ; chỉ là căn cứ bổ sung (L360-G07, OQ-360-17). */
  type: z.enum(['SPOUSE_OF', 'RELATIVE_OF', 'LEGAL_REP_OF', 'REPRESENTED_BY', 'HOUSEHOLD_MEMBER_OF']),
  person_id: z.string(),
  verification: VerificationSchema,
  /** Loại quan hệ nhân thân, số giấy khai sinh đã xác minh… (không giá trị định danh). */
  detail: z.string().nullable(),
}).strict();

/** Một giấy tờ định danh của khách hàng (L360-G08). Hai bản chụp cùng loại, cùng số, cùng ngày cấp là một giấy. */
export const IdentityDocumentSchema = z.object({
  doc_type_key: z.string(),
  number: z.string().nullable(),
  issue_date: z.string().nullable(),
  valid_until: z.string().nullable(),
  /** Hết hiệu lực tại ngày nộp hồ sơ (`meta.as_of`); null khi không biết ngày hết hạn hoặc ngày nộp. */
  expired: z.boolean().nullable(),
}).strict();

export const CustomerSchema = z.object({
  person_id: z.string(),
  party_type: z.enum(['INDIVIDUAL', 'ORGANIZATION']),
  /** Vai trò S3, thứ tự: borrower, co_borrower, collateral_owner, other(:chi tiết). */
  roles: z.array(z.string()),
  full_name: ProfileFieldSchema,
  id_number: ProfileFieldSchema,
  date_of_birth: ProfileFieldSchema,
  /** Số CMND / CCCD cũ S3 đã giải thích được (S3-R12). */
  historical_id_numbers: z.array(z.string()),
  /** Địa chỉ do S3 chọn (giấy tờ định danh mới nhất). */
  permanent_address: z.string().nullable(),
  current_address: z.string().nullable(),
  marital_status: z.string().nullable(),
  /** Chỉ pháp nhân: khóa danh tính là mã số thuế / số ĐKDN, không có số định danh cá nhân, ngày sinh, hôn nhân. */
  organization: z.object({
    tax_id: z.string().nullable(),
    registration_number: z.string().nullable(),
    headquarters_address: z.string().nullable(),
    representative_position: z.string().nullable(),
  }).strict().nullable(),
  relations: z.array(CustomerRelationSchema),
  /** Cờ của S3 (`ROLE_CONFLICT`, `ID_NUMBER_REVIEW`, `LOW_MATCH_CONFIDENCE`, `NAME_SPELLING_DIFFERENCE`). */
  flags: z.array(z.string()),
  documents: z.array(DocCount),
  id_documents: z.array(IdentityDocumentSchema),
  details: z.array(DetailFactSchema),
}).strict();

/** Bên ngoài hồ sơ vay xuất hiện trên chứng từ (bên bán, chủ lao động, bên cho vay…) (L360-G09). */
export const CounterpartySchema = z.object({
  counterparty_id: z.string().regex(/^cp-\d+$/),
  party_type: z.enum(['INDIVIDUAL', 'ORGANIZATION']),
  name: z.string().nullable(),
  tax_id: z.string().nullable(),
  id_number: z.string().nullable(),
  /** Vai trò cộng dồn trên các chứng từ: `SELLER`, `EMPLOYER`, `LENDER`, `QUOTER`. */
  roles: z.array(z.string()),
  /** Đối tác chính là một người trong hồ sơ (S3 ghép được) → bên liên quan (L360-B05). */
  person_id: z.string().nullable(),
  documents: z.array(DocCount),
}).strict();

/** Giao dịch mua tài trợ bằng khoản vay (L360-G04): báo giá, HĐ mua, bảng kê cùng bên bán + cùng đối tượng là một giao dịch. */
export const PurchaseDealSchema = z.object({
  deal_id: z.string().regex(/^deal-\d+$/),
  kind: z.enum(['VEHICLE', 'GOODS']),
  /** Mô tả đối tượng (hãng / model / năm / màu của xe; mô tả hàng hóa). */
  object: z.string().nullable(),
  seller_counterparty_id: z.string().nullable(),
  asset_id: z.string().nullable(),
  /** `EXACT` = nối bằng số khung / số máy / số HĐ; `PARTIAL` = nối bằng hãng + model + năm hoặc chỉ bằng bên bán. */
  link: z.enum(['EXACT', 'PARTIAL', 'SINGLE']),
  prices: z.array(z.object({ value: z.number(), source: z.enum(['QUOTE', 'CONTRACT', 'PURCHASE_LIST']), doc_type_key: z.string(), fact_ids: z.array(z.string()) }).strict()),
  /** Giá dùng đối chiếu số tiền vay: giá HĐ nếu có, không thì báo giá thấp nhất, không thì bảng kê. */
  price: z.number().nullable(),
}).strict();

export const BusinessFlagSchema = z.enum(['BUSINESS_MATCH_REVIEW', 'BUSINESS_NUMBER_MISMATCH']);

export const BusinessUnitSchema = z.object({
  business_id: z.string().regex(/^biz-\d+$/),
  /** `ENTERPRISE` = doanh nghiệp (GCN ĐKDN, BCTC, tờ khai GTGT; T-360-09). Khách vay SME là pháp nhân: đơn vị của nó có
   * `owner_person_ids = [person_id của chính pháp nhân]` (L360-B08). Sản phẩm SME không dựng HKD từ đơn vay (D-112). */
  kind: z.enum(['HKD', 'ENTERPRISE']),
  name: ProfileFieldSchema,
  registration_number: ProfileFieldSchema,
  tax_id: ProfileFieldSchema,
  business_line: ProfileFieldSchema,
  business_address: ProfileFieldSchema,
  owner_person_ids: z.array(z.string()),
  mentioned_in: z.array(DocCount),
  flags: z.array(BusinessFlagSchema),
}).strict();

export const IncomeKindSchema = z.enum(['salary', 'rental', 'household_business', 'trip_trading', 'enterprise', 'other']);

export const IncomeAmountSchema = z.object({
  value: z.number(),
  doc_type_key: z.string(),
  fact_ids: z.array(z.string()),
}).strict();

/** Số đã chọn kèm `record_id` nguồn, để stage 2 dẫn evidence và gắn cờ cần soát (V2-R04). */
export const BasisValueSchema = z.object({
  value: z.number(),
  record_ids: z.array(z.string()),
  /** Nguồn có độ tin cậy đọc < 0.80 hoặc không có. */
  review_record_ids: z.array(z.string()),
}).strict();

export const IncomeStreamSchema = z.object({
  income_id: z.string().regex(/^inc-\d+$/),
  kind: IncomeKindSchema,
  person_id: z.string().nullable(),
  business_id: z.string().nullable(),
  asset_id: z.string().nullable(),
  employer: ProfileFieldSchema.nullable(),
  /** Số tiền theo tháng như từng chứng từ ghi. */
  amounts: z.array(IncomeAmountSchema),
  /** Số theo tháng chọn theo `merge_policies.json`; null khi không có số hoặc catalog hỏng. */
  monthly_amount: z.number().nullable(),
  /** Chỉ HKD: doanh thu / lợi nhuận năm trên bảng kê (đầu vào CFADS của stage 2). */
  annual_revenue: BasisValueSchema.nullable(),
  annual_profit: BasisValueSchema.nullable(),
  /** Có chứng từ ngoài lời khai chứng minh nguồn thu tồn tại (sao kê lương, VssID, GCN ĐKHKD…). */
  evidenced: z.boolean(),
}).strict();

export const ObligationSchema = z.object({
  obligation_id: z.string().regex(/^obl-\d+$/),
  /** `DECLARED` = khai trên đơn vay; `CREDIT_CONTRACT` = HĐ tín dụng tại TCTD khác; `CIC` = nhóm nợ trên báo cáo CIC. */
  kind: z.enum(['DECLARED', 'CREDIT_CONTRACT', 'CIC']),
  person_id: z.string().nullable(),
  lender: z.string().nullable(),
  principal: z.number().nullable(),
  monthly_payment: z.number().nullable(),
  maturity_date: z.string().nullable(),
  debt_group: z.string().nullable(),
  fact_ids: z.array(z.string()),
}).strict();

export const ValuationSchema = z.object({
  value: z.number(),
  valuation_date: z.string().nullable(),
  appraiser: z.string().nullable(),
  doc_type_key: z.string(),
  record_id: z.string(),
  review: Review,
}).strict();

export const CollateralSchema = z.object({
  asset_id: z.string(),
  asset_type: z.string(),
  /** Số GCN / biển số / số khung… để nhận diện, null khi chưa đọc được. */
  key: z.string().nullable(),
  usage_contexts: z.array(z.string()),
  context_status: z.string(),
  owners: z.array(z.object({ person_id: z.string(), current: z.boolean() }).strict()),
  valuations: z.array(ValuationSchema),
  /** Giá trị dùng tính LTV theo `merge_policies.json` (D-112: thấp nhất các chứng thư). */
  chosen_value: z.number().nullable(),
  details: z.array(DetailFactSchema),
}).strict();

export const FinancialBasisSchema = z.object({
  loan_amount: BasisValueSchema.nullable(),
  tenor_months: BasisValueSchema.nullable(),
  interest_rate: BasisValueSchema.nullable(),
  existing_monthly_debt: BasisValueSchema.nullable(),
  hkd_annual_revenue: BasisValueSchema.nullable(),
  hkd_annual_profit: BasisValueSchema.nullable(),
  /** SME (OQ-360-13, D-112): BCKQKD gần nhất của chính khách vay (`FILED_BY` VERIFIED). Doanh thu thuần; lợi nhuận trước thuế + chi phí lãi vay. */
  sme_annual_revenue: BasisValueSchema.nullable(),
  sme_profit_before_interest: BasisValueSchema.nullable(),
  collateral_value: BasisValueSchema.nullable(),
}).strict();

export const ConflictSchema = z.object({
  conflict_id: z.string(),
  subject_id: z.string(),
  subject_label: z.string(),
  field: z.string(),
  field_label: z.string(),
  kind: z.enum(['DISPUTED', 'PROBABLE_OCR_ERROR']),
  options: z.array(z.object({ fact_id: z.string(), value: Scalar, doc_types: z.array(z.string()) }).strict()).min(2),
}).strict();

export const IssueCodeSchema = z.enum([
  'FIELD_CONFLICT', 'PROBABLE_OCR_ERROR', 'ROLE_CONFLICT', 'ID_NUMBER_REVIEW', 'LOW_MATCH_CONFIDENCE', 'PARTY_NOT_MAPPED',
  'RELATIVE_NOT_VERIFIED', 'BUSINESS_NUMBER_MISMATCH', 'BUSINESS_MATCH_REVIEW', 'BUSINESS_OWNER_NOT_VERIFIED',
  'INCOME_NOT_EVIDENCED', 'INCOME_AMOUNT_MISSING', 'INCOME_OWNER_NOT_MAPPED', 'DECLARED_INCOME_NOT_LINKED',
  'ADVERSE_DEBT_GROUP', 'UNDECLARED_DEBT', 'VALUATION_GAP', 'COLLATERAL_NOT_VALUED', 'COLLATERAL_CONTEXT_AMBIGUOUS',
  'EVIDENCE_READ_ERROR', 'SUPERSEDED_EVIDENCE', 'MERGE_POLICY_INVALID',
  'ID_DOCUMENT_EXPIRED', 'RELATED_COUNTERPARTY', 'DEAL_PRICE_MISMATCH', 'LOAN_EXCEEDS_DEAL',
  'LEGAL_REP_NOT_VERIFIED', 'FILING_NOT_LINKED',
]);

/** Danh sách DUY NHẤT các điểm cần xử lý trước khi quyết định; đã gộp trùng theo (chủ thể, trường). */
export const IssueSchema = z.object({
  severity: z.enum(['danger', 'warning', 'info']),
  code: IssueCodeSchema,
  subject_id: z.string().nullable(),
  subject_label: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
}).strict();

export const ProfileRelationSchema = z.object({
  /** `LOCATED_AT`: địa điểm kinh doanh `biz-n` trùng địa chỉ của tài sản `asset-n` (L360-G06, chỉ khi `full_text` chuẩn hóa trùng).
   * `FILED_BY`: chứng từ tài chính `from = evidence_id` của đơn vị `to = biz-n` (L360-B11); VERIFIED khi cùng mã số thuế. */
  type: z.enum(['OPERATES', 'EARNS_FROM', 'LOCATED_AT', 'FILED_BY']),
  from: z.string(),
  to: z.string(),
  verification: VerificationSchema,
}).strict();

export const ProfileGapCodeSchema = z.enum(['MERGE_POLICY_INVALID', 'DECLARED_INCOME_NOT_LINKED', 'INCOME_OWNER_NOT_MAPPED']);

export const Profile360Schema = z.object({
  profile_version: z.literal(PROFILE360_VERSION),
  application: ApplicationSchema,
  loan: LoanSchema,
  customers: z.array(CustomerSchema),
  income_streams: z.array(IncomeStreamSchema),
  business_units: z.array(BusinessUnitSchema),
  obligations: z.array(ObligationSchema),
  collateral: z.array(CollateralSchema),
  counterparties: z.array(CounterpartySchema),
  purchase_deals: z.array(PurchaseDealSchema),
  relations: z.array(ProfileRelationSchema),
  financial_basis: FinancialBasisSchema,
  conflicts: z.array(ConflictSchema),
  issues: z.array(IssueSchema),
  gaps: z.array(z.object({ code: ProfileGapCodeSchema, count: z.number().int().min(1) }).strict()),
  /** `as_of` = ngày nộp hồ sơ dùng xét hiệu lực giấy tờ (null khi không truyền). */
  meta: z.object({ lac_source_hash: z.string(), merge_policy_version: z.string().nullable(), as_of: z.string().nullable() }).strict(),
}).strict();

export type ProfileField = z.infer<typeof ProfileFieldSchema>;
export type DetailFact = z.infer<typeof DetailFactSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type BusinessUnit = z.infer<typeof BusinessUnitSchema>;
export type BusinessFlag = z.infer<typeof BusinessFlagSchema>;
export type IncomeKind = z.infer<typeof IncomeKindSchema>;
export type IncomeStream = z.infer<typeof IncomeStreamSchema>;
export type BasisValue = z.infer<typeof BasisValueSchema>;
export type Obligation = z.infer<typeof ObligationSchema>;
export type IdentityDocument = z.infer<typeof IdentityDocumentSchema>;
export type Counterparty = z.infer<typeof CounterpartySchema>;
export type PurchaseDeal = z.infer<typeof PurchaseDealSchema>;
export type Collateral = z.infer<typeof CollateralSchema>;
export type FinancialBasis = z.infer<typeof FinancialBasisSchema>;
export type Conflict = z.infer<typeof ConflictSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type IssueCode = z.infer<typeof IssueCodeSchema>;
export type ProfileRelation = z.infer<typeof ProfileRelationSchema>;
export type ProfileGapCode = z.infer<typeof ProfileGapCodeSchema>;
export type Profile360 = z.infer<typeof Profile360Schema>;
