// lib/settings.ts
// Read/write AppSetting from DB. Used by AI wrapper and Settings API.

import { prisma } from './prisma';
import { encrypt, decrypt } from './crypto';

// ─── Prompt presets ────────────────────────────────────────────────────────────
// Two built-in presets: English (default) and Vietnamese.
// Users can freely edit the prompts after selecting a preset.

export const PROMPT_PRESETS = {
  en: {
    image: `You are describing an image from an internal SOP (Standard Operating Procedure) document. Purpose: to help AI agents guide employees through procedures without seeing the original image.

Describe in detail using this structure:

1. IMAGE TYPE: Screenshot of software, process diagram, real photo, or table/chart.

2. MAIN CONTENT:
   - If software screenshot: app name, current screen, data fields, sample values, highlighted buttons or arrows.
   - If process diagram: list each step in order with arrow directions.
   - If real photo: describe objects, positions, conditions.
   - If table/chart: list column headers and sample rows.

3. TEXT IN IMAGE: Transcribe ALL visible text exactly as shown, especially labels, titles, values, button names.

4. ACTION REQUIRED: If the image illustrates a specific action, describe exactly what to click/type/select and where.

Do not add personal opinions. Do not guess information not visible in the image.`,
    pdf: `Transform this document to Markdown. Preserve heading structure, tables, and lists.

For each image in the document, replace with a detailed description block:
> **[Image]:** [detailed description]

Include: image type, software name if screenshot, all visible text, and required actions if applicable.

Output clean Markdown with proper heading hierarchy (h1, h2, h3).`,
    docx: `Transform this Word document to Markdown. Preserve heading structure, tables, and lists.
Use GitHub Flavored Markdown for tables. 

For each image in the document, replace with a placeholder:
![Image placeholder]()

Output clean Markdown with proper heading hierarchy (h1, h2, h3).`,
  },
  vi: {
    image: `Bạn là trợ lý mô tả hình ảnh cho tài liệu SOP (quy trình nội bộ). Mô tả chi tiết hình ảnh này bằng tiếng Việt theo cấu trúc sau:

1. Một câu tóm tắt ngắn về nội dung tổng thể của hình.
2. Mô tả chi tiết các thành phần chính: tên màn hình/giao diện, các nút bấm, menu, bảng dữ liệu, trường nhập liệu.
3. Ghi rõ tất cả text/số liệu hiển thị trong hình (tên cột, giá trị, nhãn nút).
4. Mô tả trạng thái hiện tại và thao tác mà người dùng đang thực hiện hoặc cần thực hiện.

Nếu hình trắng hoặc không có nội dung rõ ràng, chỉ ghi: "[Hình không có nội dung]".`,
    pdf: `Transform tài liệu này sang Markdown tiếng Việt. Giữ nguyên cấu trúc heading, bảng, danh sách. Mô tả chi tiết mọi hình ảnh trong tài liệu, bao gồm text trong hình nếu có.`,
    docx: `Transform tài liệu Word này sang Markdown tiếng Việt. Giữ nguyên cấu trúc heading, bảng, danh sách. Ưu tiên sử dụng bảng GFM cho các bảng biểu. 
Đối với mỗi hình ảnh, hãy chèn placeholder: ![Image placeholder]()`,
  },
} as const;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const COMPARE_PROMPT_DEFAULT = `Bạn là chuyên gia phân tích văn bản pháp lý. Nhiệm vụ của bạn là so sánh hai phiên bản của cùng một văn bản quy định/pháp lý.

Văn bản được cấu trúc theo các điều, khoản (Điều 1, Điều 2, Khoản 1.1...).

**FILE 1 (phiên bản cũ/gốc):**
{file1}

**FILE 2 (phiên bản mới/sửa đổi):**
{file2}

**Yêu cầu:**
So sánh từng điều/khoản giữa hai file. Chỉ liệt kê những điều/khoản CÓ SỰ THAY ĐỔI (thêm mới, xóa bỏ, chỉnh sửa nội dung). Bỏ qua các điều/khoản giống nhau hoàn toàn.

**Định dạng output — trả về JSON array, mỗi phần tử có cấu trúc:**
{
  "clause": "Tên điều/khoản (vd: Điều 3, Khoản 2.1, Phần IV)",
  "file1Content": "Nội dung nguyên văn trong file 1 (để trống nếu điều/khoản này không có trong file 1)",
  "file2Content": "Nội dung nguyên văn trong file 2 (để trống nếu điều/khoản này không có trong file 2)",
  "note": "Mô tả ngắn gọn sự khác biệt: Thêm mới / Đã xóa / Sửa đổi [tóm tắt thay đổi]"
}

Chỉ trả về JSON array hợp lệ, không có markdown code fence hay giải thích thêm.`;

export const SETTING_DEFAULTS: Record<string, string> = {
  ai_provider: 'gemini',
  ai_api_key: '',
  ai_model: 'gemini-1.5-flash',
  ai_image_prompt:   PROMPT_PRESETS.en.image,
  ai_pdf_prompt:     PROMPT_PRESETS.en.pdf,
  ai_docx_prompt:    PROMPT_PRESETS.en.docx,
  ai_compare_prompt: COMPARE_PROMPT_DEFAULT,
  ai_generate_prompt: `Dựa trên nội dung tài liệu được cung cấp, hãy tạo ra tài liệu mới theo yêu cầu sau:\n\n{user_prompt}\n\nNội dung tài liệu gốc:\n{input_content}\n\nHãy tạo ra tài liệu mới với định dạng rõ ràng, cấu trúc logic, đầy đủ thông tin cần thiết.`,
  docx_conversion_mode: 'ai',
  docx_intermediate_format: 'html',  // 'md' | 'html' | 'pdf'
  openai_api_key: '',
  openai_base_url: 'https://api.openai.com/v1',
  api_secret_key: '',
  // S3-compatible storage
  s3_endpoint: '',
  s3_bucket: '',
  s3_access_key: '',
  s3_secret_key: '',
  s3_region: 'us-east-1',
  s3_cache_ttl_hours: '168', // 7 days
};

const ENCRYPTED_KEYS = new Set(['ai_api_key', 'openai_api_key', 'api_secret_key', 's3_access_key', 's3_secret_key']);

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return SETTING_DEFAULTS[key] ?? '';

  if (ENCRYPTED_KEYS.has(key) && row.value) {
    try {
      return decrypt(row.value);
    } catch {
      return '';
    }
  }
  return row.value;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.appSetting.findMany();
  const result: Record<string, string> = { ...SETTING_DEFAULTS };

  for (const row of rows) {
    if (ENCRYPTED_KEYS.has(row.key) && row.value) {
      try {
        result[row.key] = decrypt(row.value);
      } catch {
        result[row.key] = '';
      }
    } else {
      result[row.key] = row.value;
    }
  }
  return result;
}

// ─── Write ─────────────────────────────────────────────────────────────────────

export async function setSetting(key: string, value: string): Promise<void> {
  const stored = ENCRYPTED_KEYS.has(key) && value ? encrypt(value) : value;
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: stored },
    create: { key, value: stored },
  });
}

export async function setSettings(updates: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(updates).map(([key, value]) => setSetting(key, value))
  );
}
