// Schema zod dùng chung cho evidence (T-S2-02). Dịch `catalog/data/doc_schemas/_common.schema.json`;
// enum lấy từ catalog để không lệch spec. Mọi object `.strict()` (field lạ bị từ chối).
import { z } from 'zod';

import { docTypeByKey, enumValues } from '../catalog';

/** Enum từ `enums.json`; tự `.nullable()` khi tập giá trị có null. */
export function catalogEnum(name: string) {
  const values = enumValues(name);
  const nonNull = values.filter((v): v is string => v !== null);
  if (nonNull.length === 0) throw new Error(`Enum ${name} rỗng`);
  const base = z.enum(nonNull as [string, ...string[]]);
  return values.includes(null) ? base.nullable() : base;
}

/** Catalog enum không null (VD PartyRole) — dùng khi spec không cho phép null. */
export function catalogEnumStrict(name: string) {
  const nonNull = enumValues(name).filter((v): v is string => v !== null);
  return z.enum(nonNull as [string, ...string[]]);
}

function isRealDate(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return true; // YYYY-MM / YYYY: chỉ kiểm định dạng
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** ISO 8601 `YYYY-MM-DD` | `YYYY-MM` | `YYYY` (02_conventions). */
export const DateStringSchema = z.string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-\d{2})?)?$/, 'ngày phải là ISO YYYY-MM-DD, YYYY-MM hoặc YYYY')
  .refine(isRealDate, 'ngày không tồn tại');
export const NullableDateSchema = DateStringSchema.nullable();

/**
 * Chuẩn hóa ngày giờ model trả về khi chứng từ in giờ không kèm múi giờ (VD báo cáo CIC "10:20:30 05/03/2026"):
 * thiếu múi giờ → coi là giờ Việt Nam `+07:00`; nhận `T` hoặc dấu cách, `DD/MM/YYYY` có/không giờ (trước hoặc sau ngày);
 * chỉ có ngày → `T00:00:00+07:00`. Chuỗi không nhận ra giữ nguyên để schema báo lỗi.
 */
export function normalizeDateTime(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const s = value.trim().replace(/\s+/g, ' ');
  const pad = (n: string) => n.padStart(2, '0');
  const build = (y: string, mo: string, d: string, h = '00', mi = '00', se = '00', frac = '', tz = '+07:00') =>
    `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(se)}${frac}${tz}`;
  const TZ = '(Z|[+-]\\d{2}:?\\d{2})?';
  let m = s.match(new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:[T ](\\d{1,2}):(\\d{2})(?::(\\d{2})(\\.\\d+)?)?)?\\s?${TZ}$`));
  if (m) {
    const tz = m[8] ? (m[8] === 'Z' ? 'Z' : m[8].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : '+07:00';
    return build(m[1], m[2], m[3], m[4], m[5], m[6], m[7] ?? '', tz);
  }
  const DMY = '(\\d{1,2})/(\\d{1,2})/(\\d{4})';
  const HMS = '(\\d{1,2}):(\\d{2})(?::(\\d{2}))?';
  m = s.match(new RegExp(`^${DMY}(?: ${HMS})?$`));
  if (m) return build(m[3], m[2], m[1], m[4], m[5], m[6]);
  m = s.match(new RegExp(`^${HMS} ${DMY}$`));
  if (m) return build(m[6], m[5], m[4], m[1], m[2], m[3]);
  return value;
}

/** `format: date-time` (RFC 3339, có múi giờ hoặc Z); đầu vào thiếu múi giờ được chuẩn hóa trước (normalizeDateTime). */
export const DateTimeStringSchema = z.preprocess(normalizeDateTime, z.string().datetime({ offset: true }));

export const MoneyVNDSchema = z.number().int('tiền phải là số nguyên VND').nonnegative('tiền không âm');
export const NullableMoneySchema = MoneyVNDSchema.nullable();
export const PercentSchema = z.number().min(0).max(100);
export const ConfidenceSchema = z.number().min(0).max(1);
export const PageRangeSchema = z.tuple([z.number().int().min(1), z.number().int().min(1)])
  .refine(([a, b]) => a <= b, 'page_range phải là [start, end] với start ≤ end');
export const IdNumberSchema = z.string().regex(/^\d{9}$|^\d{12}$|^[A-Z0-9]{6,15}$/, 'số định danh không hợp lệ');
export const NullableStringSchema = z.string().nullable();

export const AddressSchema = z.object({
  full_text: z.string().nullable(),
  street: z.string().nullable(),
  ward: z.string().nullable(),
  district: z.string().nullable(),
  province: z.string().nullable(),
}).strict();
export type Address = z.infer<typeof AddressSchema>;

export const SignatorySchema = z.object({
  full_name: z.string().nullable(),
  position: z.string().nullable(),
  organization: z.string().nullable(),
  sign_date: NullableDateSchema,
  has_seal: z.boolean().nullable(),
}).strict();

export const LegalInfoSchema = z.object({
  document_title: z.string().nullable(),
  form_template_number: z.string().nullable(),
  document_number: z.string().nullable(),
  issuing_authority: z.string().nullable(),
  issue_date: NullableDateSchema,
  issue_place: z.string().nullable(),
  valid_until: NullableDateSchema,
  signatories: z.array(SignatorySchema),
}).strict();
export type LegalInfo = z.infer<typeof LegalInfoSchema>;

export const PartyOwnershipSchema = z.object({
  asset_index: z.number().int().min(0),
  ownership_source: catalogEnumStrict('OwnershipSource'),
  ownership_change_date: NullableDateSchema,
  is_current_owner: z.boolean(),
}).strict();

export const DocumentPartySchema = z.object({
  party_index: z.number().int().min(0),
  party_role: catalogEnumStrict('PartyRole'),
  party_role_raw: z.string().nullable(),
  party_type: catalogEnumStrict('PartyType'),
  full_name: z.string().nullable(),
  id_number: IdNumberSchema.nullable(),
  id_type: catalogEnum('IdType'),
  id_issue_date: NullableDateSchema,
  id_issue_place: z.string().nullable(),
  previous_id_numbers: z.array(IdNumberSchema),
  date_of_birth: NullableDateSchema,
  gender: catalogEnum('Gender'),
  nationality: z.string().nullable(),
  permanent_address: AddressSchema.nullable(),
  current_address: AddressSchema.nullable(),
  phone_number: z.string().nullable(),
  tax_id: z.string().nullable(),
  representative_name: z.string().nullable(),
  representative_position: z.string().nullable(),
  ownership: PartyOwnershipSchema.nullable(),
}).strict();
export type DocumentParty = z.infer<typeof DocumentPartySchema>;

export const AssetIdentifiersSchema = z.object({
  certificate_number: z.string().nullable(),
  certificate_book_number: z.string().nullable(),
  land_parcel_number: z.string().nullable(),
  map_sheet_number: z.string().nullable(),
  apartment_number: z.string().nullable(),
  building_name: z.string().nullable(),
  project_name: z.string().nullable(),
  license_plate: z.string().nullable(),
  chassis_number: z.string().nullable(),
  engine_number: z.string().nullable(),
  registration_number: z.string().nullable(),
}).strict();
export type AssetIdentifiers = z.infer<typeof AssetIdentifiersSchema>;

export const AssetDescriptorSchema = z.object({
  asset_index: z.number().int().min(0),
  asset_type: catalogEnumStrict('AssetType'),
  identifiers: AssetIdentifiersSchema,
  address: AddressSchema.nullable(),
  description: z.string().nullable(),
  usage_context_hint: catalogEnumStrict('UsageContext').nullable(),
}).strict();
export type AssetDescriptor = z.infer<typeof AssetDescriptorSchema>;

// ── EvidenceEnvelope (S2 §2) ────────────────────────────────────────────────
export const EvidenceIdSchema = z.string().regex(/^ev-[0-9a-f]{12}$/, 'evidence_id phải là ev-{12 hex}');
export const FileIdSchema = z.string().regex(/^file-[0-9a-f]{12}$/, 'file_id phải là file-{12 hex}');
export const DocTypeKeySchema = z.string().refine((k) => docTypeByKey(k) !== undefined, 'doc_type_key không có trong doc_types.json');
const ReasonCodeLikeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

export const EvidenceEnvelopeSchema = z.object({
  evidence_id: EvidenceIdSchema,
  extraction_level: z.enum(['FULL', 'LIGHT']),
  file_id: FileIdSchema,
  file_name: z.string(),
  doc_type_key: DocTypeKeySchema,
  doc_type_label: z.string(),
  instance_index: z.number().int().min(1),
  page_range: PageRangeSchema,
  status: catalogEnumStrict('EvidenceStatus'),
  reason_code: ReasonCodeLikeSchema.nullable(),
  message: z.string().nullable(),
  detected_form_name: z.string().nullable(),
  form_variant: z.string().nullable(),
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Theo schema của loại (T-DOC-* / bóc tách nhẹ T-S2-10); ở đây chỉ kiểm là object. */
  data: z.record(z.string(), z.unknown()).nullable(),
  field_confidences: z.record(z.string(), ConfidenceSchema),
  /** `{field cấp 1: [trang…]}` — dạng mảng theo `_common.schema.json#/$defs/SourcePages`. */
  source_pages: z.record(z.string(), z.array(z.number().int().min(1))),
  duplicate_group_id: z.string().regex(/^dup-\d+$/).nullable(),
  duplicate_status: catalogEnum('DuplicateStatus'),
  differing_fields: z.array(z.string()),
}).strict().superRefine((e, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  const docType = docTypeByKey(e.doc_type_key);
  if (docType && docType.extraction_level !== e.extraction_level) issue('extraction_level', `phải là ${docType.extraction_level}`);
  if (e.page_range[0] > e.page_range[1]) issue('page_range', 'start > end');
  if (e.status === 'ERROR') {
    if (e.data !== null) issue('data', 'ERROR → data = null');
    if (!e.reason_code) issue('reason_code', 'ERROR → bắt buộc reason_code');
    if (Object.keys(e.field_confidences).length > 0) issue('field_confidences', 'ERROR → {}');
  } else if (e.data === null) {
    issue('data', 'SUCCESS → data là object');
  }
  if ((e.duplicate_group_id === null) !== (e.duplicate_status === null)) {
    issue('duplicate_status', 'duplicate_group_id và duplicate_status cùng null hoặc cùng có giá trị');
  }
});
export type EvidenceEnvelope = z.infer<typeof EvidenceEnvelopeSchema>;
