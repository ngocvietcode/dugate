// Cổng gọi model trích xuất (T-S2-08; S2-R04, R06, R09). Engine chỉ phụ thuộc interface này; bản gọi thật
// (sub-step `ext-data-extractor` của workflow v2) nằm ở lib/pipelines/workflows/loan-appraisal/stage-adapters.ts.
import { extractJsonText, JSON_ONLY_OUTPUT_RULE } from '../common/llm-json';
import { z } from 'zod';

import { docTypeByKey } from '../catalog';
import { COMMON_JSON_SCHEMA, DOC_JSON_SCHEMAS, ENUMS_JSON_SCHEMA } from '../catalog/doc-schema-json';
import { describeZodError, successResult, type EvidenceResult } from './evidence-result';
import { lightJsonSchema, lightPromptSpec, validateLight } from './light';
import { LOAN_APPLICATION_SECTIONS } from './page-guard';
import { parseWithSalvage } from './salvage';
import { getDocSchema } from './schema-registry';

/** Đầu vào 1 lần gọi extractor cho 1 bản thể. Không có tên file (như S1-R03). */
export interface ExtractPagesInput {
  file_ref: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  doc_type_key: string;
  extraction_level: 'FULL' | 'LIGHT';
  /** Trang của bản thể trong file (1-based, inclusive). */
  page_range: [number, number];
  page_count: number;
  prompt: string;
  content: Uint8Array;
}

export interface ExtractorPort {
  /** Phản hồi thô (chuỗi JSON hoặc object). Lỗi kết nối → ném lỗi bất kỳ. */
  extract(input: ExtractPagesInput): Promise<unknown>;
}

const PageList = z.union([z.number().int().min(1), z.array(z.number().int().min(1))]);
const Confidence = z.union([z.number().min(0).max(1), z.array(z.number().min(0).max(1))]);

/** Metadata phụ (confidence, trang nguồn): mục sai kiểu bị bỏ, không làm hỏng cả phản hồi (S2-R21). */
function lenientRecord<T extends z.ZodTypeAny>(value: T) {
  return z.preprocess(
    (v) => (typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([, x]) => value.safeParse(x).success))
      : undefined),
    z.record(z.string(), value).optional(),
  );
}
const nullableText = z.preprocess((v) => (typeof v === 'string' ? v : null), z.string().nullable());

const ResponseSchema = z.object({
  form_found: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
  detected_form_name: nullableText.optional(),
  form_variant: nullableText.optional(),
  data: z.unknown(),
  field_confidences: lenientRecord(Confidence),
  source_pages: lenientRecord(PageList.nullable()),
  section_pages: lenientRecord(z.number().int().min(1).nullable()),
});

export interface ExtractorResponse {
  form_found: boolean;
  detected_form_name: string | null;
  form_variant: string | null;
  data: unknown;
  field_confidences: Record<string, number>;
  source_pages: Record<string, number[]>;
  section_pages: Record<string, number | null>;
}

export class ExtractorParseError extends Error {
  readonly code = 'UNREADABLE_CONTENT';
  constructor(detail: string) {
    super(`UNREADABLE_CONTENT: ${detail}`);
    this.name = 'ExtractorParseError';
  }
}

/** Parse phản hồi; confidence mảng → min (S2 §2); trang đơn → mảng. Lỗi chỉ nêu đường dẫn, không nêu giá trị. */
export function parseExtractorResponse(raw: unknown): ExtractorResponse {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(extractJsonText(raw));
    } catch {
      throw new ExtractorParseError('phản hồi không phải JSON');
    }
  }
  const parsed = ResponseSchema.safeParse(value);
  if (!parsed.success) throw new ExtractorParseError(describeZodError(parsed.error));
  const r = parsed.data;
  const field_confidences = Object.fromEntries(Object.entries(r.field_confidences ?? {})
    .map(([k, v]) => [k, Array.isArray(v) ? (v.length ? Math.min(...v) : 0) : v]));
  const source_pages = Object.fromEntries(Object.entries(r.source_pages ?? {})
    .filter(([, v]) => v !== null)
    .map(([k, v]) => [k, [...new Set(Array.isArray(v) ? v : [v as number])].sort((a, b) => a - b)]));
  return {
    form_found: r.form_found,
    detected_form_name: r.detected_form_name ?? null,
    form_variant: r.form_variant ?? null,
    data: r.data,
    field_confidences,
    source_pages,
    section_pages: r.section_pages ?? {},
  };
}

const ID_DOC_TYPES = new Set(['id_card', 'vneid', 'qr_code_info', 'local_cmnd_confirmation']);
const CERT_DOC_TYPES = new Set(['land_use_certificate', 'apartment_ownership_certificate', 'land_use_cert_to_buy']);

/**
 * Field định danh bắt buộc mà đang null (S2-R09) — đường dẫn, không giá trị.
 * Giấy tờ tùy thân: `id_number` của HOLDER; GCN: `certificate_number` của tài sản; đăng ký xe: số khung hoặc biển số.
 */
export function requiredIdentityGaps(docTypeKey: string, data: Record<string, unknown>): string[] {
  const parties = (data.parties as Array<{ party_role: string; id_number: string | null }> | undefined) ?? [];
  const assets = (data.assets as Array<{ identifiers: Record<string, string | null> }> | undefined) ?? [];
  const gaps: string[] = [];
  if (ID_DOC_TYPES.has(docTypeKey)) {
    parties.forEach((p, i) => { if (p.party_role === 'HOLDER' && p.id_number === null) gaps.push(`parties.${i}.id_number`); });
  }
  if (CERT_DOC_TYPES.has(docTypeKey)) {
    assets.forEach((a, i) => { if (!a.identifiers.certificate_number) gaps.push(`assets.${i}.identifiers.certificate_number`); });
  }
  if (docTypeKey === 'vehicle_registration') {
    assets.forEach((a, i) => {
      if (!a.identifiers.chassis_number && !a.identifiers.license_plate) gaps.push(`assets.${i}.identifiers.chassis_number`);
    });
  }
  return gaps;
}

/**
 * Kiểm phản hồi model cho 1 bản thể (FULL hoặc LIGHT). Không thấy mẫu → `ERROR`/`FORM_NOT_FOUND`;
 * phản hồi hỏng / data không cứu được → `ERROR`/`UNREADABLE_CONTENT`; field sai định dạng → bỏ giá trị field đó,
 * `SUCCESS` + `FIELD_FORMAT_INVALID` (S2-R21); field định danh null → `SUCCESS` + `REQUIRED_FIELD_UNREADABLE`.
 */
export function validateExtraction(docTypeKey: string, raw: unknown): EvidenceResult {
  let response: ExtractorResponse;
  try {
    // parseExtractorResponse idempotent: nhận cả phản hồi thô lẫn ExtractorResponse đã parse.
    response = parseExtractorResponse(raw);
  } catch (err) {
    return { status: 'ERROR', reason_code: 'UNREADABLE_CONTENT', message: (err as Error).message, data: null };
  }
  if (!response.form_found) {
    return { status: 'ERROR', reason_code: 'FORM_NOT_FOUND', message: 'Không thấy mẫu biểu trong các trang của bản thể.', data: null };
  }
  const docType = docTypeByKey(docTypeKey);
  if (docType?.extraction_level === 'LIGHT') return validateLight(docTypeKey, response.data);
  const parsed = parseWithSalvage(getDocSchema(docTypeKey), response.data);
  if (!parsed.success) {
    return { status: 'ERROR', reason_code: 'UNREADABLE_CONTENT', message: describeZodError(parsed.error), data: null };
  }
  const data = parsed.data as Record<string, unknown>;
  return successResult(data, requiredIdentityGaps(docTypeKey, data), parsed.invalid_fields);
}

const COMMON_RULES = [
  'Chỉ đọc nội dung CHÍNH chứng từ này trong các trang được gửi; không đối chiếu, không sửa theo chứng từ khác, không suy đoán.',
  'Field không có / không đọc được → null. Không bịa giá trị.',
  'Chuẩn hóa: ngày ISO YYYY-MM-DD (chỉ tháng/năm → YYYY-MM hoặc YYYY, không tự thêm ngày); ngày giờ (VD thời điểm tra cứu CIC) → YYYY-MM-DDTHH:mm:ss+07:00 (giờ in trên giấy là giờ Việt Nam); tiền là số nguyên VND; số định danh chỉ chữ số, giữ số 0 đầu; gộp khoảng trắng thừa. Giữ NGUYÊN chính tả tên riêng và địa danh; không đổi địa danh cũ sang mới.',
  'Địa chỉ là object {full_text, street, ward, district, province}; full_text giữ nguyên văn như in.',
  'Mọi người/tổ chức là một phần tử parties[] với party_role chuẩn, nhãn gốc ở party_role_raw. Số CMND cũ in trên CCCD → previous_id_numbers[] của chính party đó, không tạo party mới. Ô ghi nhiều người ("A và B") giữ nguyên 1 party.',
  'Mọi tài sản là assets[] với identifiers chuẩn. usage_context_hint chỉ gán khi chính chứng từ nêu (giấy đề nghị vay mục TSBĐ → collateral; bảng kê thu nhập mục tài sản cho thuê → rental_income); còn lại null.',
  'Không kết luận còn/hết hiệu lực, nhưng BẮT BUỘC trích legal_info.issue_date (ngày cấp/ký) và legal_info.valid_until khi chứng từ in ngày hết hạn cụ thể.',
  'Các trang của cùng bản thể (mặt trước + mặt sau, các trang liên tiếp) cho ra MỘT data.',
  'Danh sách ô chọn (☐ / ☒ / ☑ / ✓ / ô có dấu X hoặc gạch chéo): CHỈ lấy ô ĐÃ ĐÁNH DẤU; ô trống không phải lựa chọn. Không chọn giùm một ô mặc định khi không thấy ô nào được đánh dấu → null. Nhiều ô nằm cạnh nhau trên một dòng: đối chiếu dấu với đúng nhãn đứng ngay bên cạnh ô, không lệch sang nhãn kế bên.',
];

const CURRENT_OWNER_RULE = 'Chủ sở hữu: chủ ở trang bìa → party OWNER với ownership.ownership_source = COVER_PAGE; mỗi người nhận chuyển nhượng ở trang biến động → party OWNER với ownership_source = CHANGE_RECORD và ownership_change_date. is_current_owner sẽ được hệ thống tính lại.';

const LOAN_APPLICATION_RULES = [
  'Trích CẢ HAI số tiền, độc lập: loan_info.requested_amount = số tiền khách hàng đề nghị vay; loan_info.bank_proposed_amount = dòng "Vốn vay tại VPBank" ở "PHẦN DÀNH CHO NGÂN HÀNG", Mục 3. Kèm requested_amount_page, bank_proposed_amount_page. Không suy số này từ số kia; hai số khác nhau là bình thường.',
  'Ô "Lãi suất" ghi mã biểu (VD "LC10") → loan_info.interest_rate_code; loan_info.interest_rate chỉ là %/năm in trên giấy, KHÔNG suy từ mã biểu.',
  'financial_info.has_existing_debt và existing_monthly_debt_payment đọc từ mục nghĩa vụ nợ hiện hữu.',
  'Tình trạng hôn nhân (party_details[].marital_status / marital_status_raw) là một dòng ô chọn "☐ Độc thân ☐ Đã kết hôn ☐ Ly thân ☐ Ly hôn ☐ Góa": CHỈ lấy ô đã đánh dấu. marital_status_raw = nhãn của ô đã đánh dấu (VD "Ly hôn"); marital_status: Độc thân → SINGLE, Đã kết hôn → MARRIED, Ly hôn → DIVORCED, Góa → WIDOWED; Ly thân hoặc không thấy ô nào đánh dấu → null. KHÔNG mặc định "Đã kết hôn" chỉ vì giấy có thông tin vợ / chồng hoặc người liên quan; chỉ dựa vào ô được đánh dấu.',
  `section_pages: trang (tuyệt đối) chứa TIÊU ĐỀ mục của từng khóa ${LOAN_APPLICATION_SECTIONS.join(', ')} (bank_section = "PHẦN DÀNH CHO NGÂN HÀNG"); không thấy → null.`,
];

/** Lời nhắc bóc tách cho 1 bản thể. Không có tham số tên file. */
export function buildExtractPrompt(docTypeKey: string, pageRange: [number, number]): string {
  const docType = docTypeByKey(docTypeKey);
  if (!docType) throw new Error(`doc_type_key lạ: ${docTypeKey}`);
  const [from, to] = pageRange;
  const lines = [
    `Bạn bóc tách chứng từ "${docType.doc_type_label}" (doc_type_key = ${docTypeKey}) trong hồ sơ vay.`,
    `Bản chứng từ nằm ở trang ${from}–${to} của tài liệu; mọi số trang trả về là số tuyệt đối trong tài liệu.`,
    ...(docType.recognition_hint ? [`Dấu hiệu nhận biết mẫu này: ${docType.recognition_hint}`] : []),
    'Nếu các trang này KHÔNG chứa mẫu biểu đó → form_found = false, data = null; không trích theo mẫu khác.',
    '',
    'Quy tắc:',
    ...COMMON_RULES.map((r, i) => `${i + 1}. ${r}`),
  ];
  if (['land_use_certificate', 'apartment_ownership_certificate', 'land_use_cert_to_buy', 'vehicle_registration'].includes(docTypeKey)) {
    lines.push(`${COMMON_RULES.length + 1}. ${CURRENT_OWNER_RULE}`);
  }
  if (docTypeKey === 'loan_application') lines.push('', 'Riêng giấy đề nghị vay vốn:', ...LOAN_APPLICATION_RULES.map((r) => `- ${r}`));
  lines.push('');
  // LIGHT cũng gửi JSON Schema đầy đủ: thiếu nó model không biết tên field / giá trị enum của DocumentParty, LegalInfo.
  const jsonSchema = docType.extraction_level === 'LIGHT' ? lightJsonSchema(docTypeKey) : DOC_JSON_SCHEMAS[docTypeKey];
  if (docType.extraction_level === 'LIGHT') lines.push('Bóc tách nhẹ — data theo đặc tả:', lightPromptSpec(docTypeKey), '');
  lines.push(
    'data phải đúng JSON Schema sau (không thêm field ngoài schema; mọi field trong "required" phải có, giá trị có thể null):',
    JSON.stringify(jsonSchema),
    'Định nghĩa dùng chung được tham chiếu ($ref _common.schema.json / _enums.schema.json):',
    JSON.stringify(COMMON_JSON_SCHEMA),
    JSON.stringify(ENUMS_JSON_SCHEMA),
  );
  lines.push(
    '',
    'field_confidences: {field cấp 1 của data: 0..1}; field null → 0. source_pages: {field cấp 1 khác null: [trang…]}.',
    JSON_ONLY_OUTPUT_RULE,
    'Schema:',
    '{"form_found":true,"detected_form_name":"tên mẫu in trên giấy hoặc null","form_variant":null,"data":{…},"field_confidences":{},"source_pages":{}'
      + (docTypeKey === 'loan_application' ? ',"section_pages":{}' : '') + '}',
  );
  return lines.join('\n');
}
