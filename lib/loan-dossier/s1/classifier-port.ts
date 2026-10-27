// Cổng gọi model phân loại (T-S1-06; S1-R03, R09, R10, R11). Engine chỉ phụ thuộc interface này;
// bản gọi thật (sub-step `ext-classifier` của workflow v2) nằm ở lib/pipelines/workflows/loan-appraisal/s1-adapter.ts.
import { z } from 'zod';

import { loadDocTypes } from '../catalog';
import { extractJsonText, JSON_ONLY_OUTPUT_RULE } from '../common/llm-json';
import type { RawClassification } from './postprocess';

/**
 * Đầu vào 1 lần gọi classifier. **Cố ý không có tên file / đường dẫn** (S1-R03): `file_ref` là khóa
 * nội bộ do adapter cấp (VD `file_id`), adapter tự tra ra nội dung.
 */
export interface ClassifyPagesInput {
  file_ref: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  /** Dải trang tuyệt đối của batch trong file (1-based, inclusive). */
  page_range: [number, number];
  page_count: number;
  prompt: string;
  /** Nội dung cả file; adapter tự cắt dải trang `page_range` khi file có nhiều batch. */
  content: Uint8Array;
}

export interface ClassifierPort {
  /** Trả phản hồi thô của model (chuỗi JSON hoặc object). Lỗi kết nối → ném lỗi bất kỳ. */
  classifyPages(input: ClassifyPagesInput): Promise<unknown>;
}

export class ClassifierParseError extends Error {
  readonly code = 'JSON_PARSE_ERROR';
  constructor(detail: string) {
    super(`JSON_PARSE_ERROR: ${detail}`);
    this.name = 'ClassifierParseError';
  }
}

const PageRange = z.tuple([z.number().int().min(1), z.number().int().min(1)]).refine(([a, b]) => a <= b);
const KeyFactResponse = z.object({
  subject: z.string(),
  key: z.string(),
  value: z.string().nullable(),
  page: z.number().int().nullable().optional().transform((v) => v ?? null),
});
const ResponseSchema = z.object({
  page_quality: z.enum(['OK', 'EMPTY', 'LOW_QUALITY']),
  matches: z.array(z.object({
    doc_type_key: z.string(),
    confidence: z.number().min(0).max(1),
    instances: z.array(z.object({
      page_range: PageRange,
      confidence: z.number().min(0).max(1),
      starts_new_document: z.boolean().optional(),
      // D-70: model cũ / phản hồi thiếu hai field này vẫn hợp lệ (mặc định rỗng).
      summary: z.string().optional().default(''),
      key_facts: z.array(KeyFactResponse).optional().default([]),
    })),
  })),
});

/** Parse phản hồi model; JSON hỏng hoặc thiếu field → `ClassifierParseError`. Thông báo lỗi chỉ nêu đường dẫn. */
export function parseClassifierResponse(raw: unknown): RawClassification {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(extractJsonText(raw));
    } catch {
      throw new ClassifierParseError('phản hồi không phải JSON');
    }
  }
  const parsed = ResponseSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ClassifierParseError(`${first.path.join('.') || '(gốc)'}: ${first.code}`);
  }
  return parsed.data as RawClassification;
}

/**
 * Lời nhắc phân loại cho 1 batch. Chỉ nhận dải trang và danh mục loại — không có tham số tên file,
 * nên tên file/thư mục không thể lọt vào (S1-R03).
 */
export function buildClassifyPrompt(pageRange: [number, number], pageCount: number): string {
  const catalog = loadDocTypes()
    .map((d) => {
      const desc = d.recognition_hint ?? d.note;
      const facts = d.summary_fields?.length ? ` | key_facts: ${d.summary_fields.join(', ')}` : '';
      return `- ${d.doc_type_key}: ${d.doc_type_label}${desc ? ` — ${desc}` : ''}${facts}`;
    })
    .join('\n');
  const [from, to] = pageRange;
  const batchNote = from === 1 && to === pageCount
    ? `Tài liệu có ${pageCount} trang.`
    : `Đây là trang ${from}–${to} của tài liệu ${pageCount} trang; trang đầu tiên được gửi là trang ${from}. Đánh số trang theo số tuyệt đối trong tài liệu.`;
  return [
    'Bạn phân loại chứng từ trong hồ sơ vay. Chỉ dựa vào NỘI DUNG trang, không dựa vào tên file.',
    batchNote,
    'Trang có thể bị xoay 90/180/270 độ hoặc ảnh chụp nghiêng: tự xoay đúng chiều trước khi đọc; không trả rỗng chỉ vì sai chiều.',
    '',
    'Danh mục loại chứng từ (doc_type_key: tên):',
    catalog,
    '',
    'Quy tắc:',
    '1. Chỉ gán loại khi trang THỰC SỰ là mẫu biểu đó. Chứng từ khác chỉ nhắc tới thông tin của loại khác (VD chứng thư định giá ghi số CCCD) thì KHÔNG gán loại đó.',
    '2. Mỗi doc_type_key xuất hiện tối đa 1 lần trong matches; nhiều bản cùng loại → nhiều phần tử instances.',
    '3. Một instance = một bản chứng từ: mặt trước + mặt sau của cùng thẻ, hoặc các trang liên tiếp của cùng văn bản. page_range [trang đầu, trang cuối] phải liên tiếp. Nhiều chứng từ chụp chung 1 trang được phép trùng page_range.',
    '4. starts_new_document = true khi trang đầu của instance là trang đầu của một văn bản mới; false khi nó là phần tiếp theo của văn bản bắt đầu ở trang trước.',
    '5. confidence 0..1 cho từng instance và cho match.',
    '6. page_quality: EMPTY nếu không có nội dung đọc được; LOW_QUALITY nếu quá mờ để nhận diện; còn lại OK.',
    '7. Mỗi instance có "summary": 1–3 câu tiếng Việt nêu loại chứng từ, chủ thể và mục đích. Thông tin có in trên chứng từ nhưng KHÔNG nằm trong danh mục key_facts của loại đó (ngày sinh, địa chỉ, hạn hiệu lực, số hợp đồng, tên đơn vị lập…) ghi NGUYÊN VĂN vào summary khi có.',
    '8. Mỗi instance có "key_facts": chỉ dùng đúng các key liệt kê sau "key_facts:" của loại đó trong danh mục; loại không có "key_facts:" thì key_facts = []. Mỗi phần tử {"subject","key","value","page"}.',
    '9. "subject" là nhãn đối tượng trên chứng từ để phân biệt nhiều người / tài sản: "borrower", "co_borrower"… CHỈ khi chính văn bản nêu rõ vai trò; nếu không dùng "person-1", "person-2", "asset-1"… theo thứ tự xuất hiện. "page" là số trang tuyệt đối, hoặc null.',
    '10. "value" chép NGUYÊN VĂN đúng như in trên chứng từ: không chuẩn hóa, không sửa lỗi chính tả hay lỗi đọc, không thêm hoặc bỏ dấu, không đổi định dạng số hay ngày, không viết lại số. Không có trên chứng từ → null; có nhưng không đọc được → "[không rõ]". Không suy đoán, không điền theo trang khác. Chỉ ghi dữ kiện của chính chứng từ đó, không ghi thông tin của loại khác chỉ được nhắc tới.',
    '11. Không đối chiếu, không nhận xét đúng / sai, không kết luận đủ / thiếu giữa các chứng từ.',
    '12. Văn bản định giá / thẩm định giá: chọn loại theo ĐƠN VỊ LẬP văn bản (tên, logo, phần ký), không theo chữ "định giá" trong tiêu đề. Báo cáo của Thịnh Điền → chọn tiếp theo LOẠI TÀI SẢN ghi ở tiêu đề / dòng "Áp dụng đối với": "BÁO CÁO TƯ VẤN VỀ GIÁ TÀI SẢN BẢO ĐẢM" (Bất động sản) → real_estate_valuation_report; "BÁO CÁO TƯ VẤN GIÁ HIỆN TRẠNG TÀI SẢN ĐẢM BẢO" (PTVT/PTTC/MMTB/DCSX) → movable_asset_valuation_report; chứng thư của công ty thẩm định giá khác → external_valuation_certificate. Không xác định được đơn vị lập → confidence dưới 0.8.',
    '',
    JSON_ONLY_OUTPUT_RULE,
    'Schema:',
    '{"page_quality":"OK|EMPTY|LOW_QUALITY","matches":[{"doc_type_key":"...","confidence":0.0,"instances":[{"page_range":[1,2],"confidence":0.0,"starts_new_document":true,"summary":"...","key_facts":[{"subject":"borrower","key":"full_name","value":"...","page":1}]}]}]}',
  ].join('\n');
}
