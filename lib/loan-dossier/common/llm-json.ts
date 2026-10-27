// Bóc JSON khỏi phản hồi của LLM. Model đôi khi bọc JSON trong khối mã (```json … ```), quên dấu đóng ```,
// hoặc thêm lời dẫn / lời kết quanh JSON. Hàm thuần, không phụ thuộc engine nên dùng được ở S1, S2 và workflow.
//
// Thứ tự thử (dừng ở lần đầu cho ra JSON hợp lệ):
//   1. Cả chuỗi (sau khi bỏ khối mã bao toàn bộ).
//   2. Nội dung khối mã đầu tiên, kể cả khi thiếu dấu đóng.
//   3. Đối tượng `{…}` đầu tiên cân bằng ngoặc (có xét chuỗi và ký tự thoát), rồi mảng `[…]` đầu tiên.
// Phản hồi bị cắt cụt (hết token giữa chừng) thì ngoặc không cân bằng nên KHÔNG đọc được: trả nguyên chuỗi để nơi gọi báo lỗi.

/**
 * Quy tắc định dạng đặt CUỐI prompt (nơi model chú ý nhất). Gắn ở chỗ lắp prompt chứ không chỉ trong template,
 * vì template cho admin ghi đè và bản ghi đè có thể bỏ mất câu dặn. Đây là lớp phòng ngừa; lớp chặn là `extractJsonText`.
 */
export const JSON_ONLY_OUTPUT_RULE = 'ĐỊNH DẠNG TRẢ LỜI: chỉ một đối tượng JSON thuần. Ký tự đầu tiên của phản hồi là { và ký tự cuối cùng là }. '
  + 'KHÔNG dùng khối mã markdown (không viết ```json hay ```), không lời dẫn, không lời kết, không chú thích ngoài JSON.';

const FENCE_OPEN = /^\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n?/;
const FENCE_CLOSE = /\r?\n?[ \t]*```\s*$/;
const FENCE_BLOCK = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)(?:\r?\n?[ \t]*```|$)/;

const parses = (s: string): boolean => {
  try { JSON.parse(s); return true; } catch { return false; }
};

/** Đoạn cân bằng ngoặc bắt đầu tại `start` (ký tự `{` hoặc `[`); null nếu không cân bằng (cụt). */
function balancedFrom(text: string, start: number): string | null {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Thử từng vị trí mở ngoặc `open` cho tới khi gặp đoạn cân bằng và hợp lệ JSON. */
function firstBalanced(text: string, open: '{' | '['): string | null {
  for (let i = text.indexOf(open); i >= 0; i = text.indexOf(open, i + 1)) {
    const candidate = balancedFrom(text, i);
    if (candidate !== null && parses(candidate)) return candidate;
  }
  return null;
}

/**
 * Văn bản JSON trong phản hồi; không tìm được thì trả nguyên `raw` (để JSON.parse / zod phía sau báo lỗi như cũ).
 * Không bao giờ throw.
 */
export function extractJsonText(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text || parses(text)) return text || raw;

  // Khối mã bao toàn bộ (kể cả thiếu dấu đóng): bỏ dòng mở, bỏ dấu đóng nếu có.
  if (FENCE_OPEN.test(text)) {
    const inner = text.replace(FENCE_OPEN, '').replace(FENCE_CLOSE, '').trim();
    if (parses(inner)) return inner;
  }
  // Lời dẫn trước khối mã.
  const block = FENCE_BLOCK.exec(text);
  if (block?.[1]) {
    const inner = block[1].trim();
    if (parses(inner)) return inner;
    const inBlock = firstBalanced(inner, '{') ?? firstBalanced(inner, '[');
    if (inBlock) return inBlock;
  }
  return firstBalanced(text, '{') ?? firstBalanced(text, '[') ?? raw;
}

/**
 * Cùng quy ước với `parseDeep`: chuỗi → JSON text đã bóc (để `parseDeep`/`JSON.parse` xử lý tiếp), giá trị khác giữ nguyên.
 * Dùng trước `parseDeep` cho output của LLM.
 */
export function cleanLlmJson(raw: unknown): unknown {
  return typeof raw === 'string' ? extractJsonText(raw) : raw;
}

/** Parse phản hồi LLM thành giá trị JSON; null nếu không đọc được. */
export function parseLlmJson(raw: unknown): unknown {
  const cleaned = cleanLlmJson(raw);
  if (typeof cleaned !== 'string') return cleaned ?? null;
  try { return JSON.parse(cleaned) as unknown; } catch { return null; }
}
