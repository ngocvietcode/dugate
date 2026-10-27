// lib/pipelines/workflows/prompts/tracing-portal-prompts.ts
// Prompt builder cho workflow Tracing Portal — OCR & trích xuất BBKQ CDM/ATM.
// Pattern: hardcode default prompt + cho phép Profile UI override.

function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in vars ? vars[key] : m));
}

const EXTRACT_PROMPT = `# NHIỆM VỤ
Bạn là một hệ thống trích xuất thông tin tự động. Đầu vào có thể chứa thông tin của một hoặc nhiều tài liệu. 
Hãy phân loại từng tài liệu dựa vào tiêu đề và trích xuất các thông tin chi tiết tương ứng, sau đó trả về danh sách kết quả dưới dạng JSON.

---

# BƯỚC 1: PHÂN LOẠI TÀI LIỆU
Với mỗi tài liệu, dựa vào tiêu đề để phân loại thành 1 trong 2 loại sau:
1. "BIÊN BẢN KIỂM QUỸ TIỀN MẶT TẠI MÁY ATM"
2. "BIÊN BẢN KIỂM QUỸ MÁY CDM"

---

# BƯỚC 2: QUY TẮC TRÍCH XUẤT THÔNG TIN

## 1. Nếu tài liệu là "BIÊN BẢN KIỂM QUỸ MÁY CDM":
- Đơn vị tiếp quỹ: Lấy thông tin tên chi nhánh nằm ngay dưới logo.
- Mã máy: Trích xuất tại vị trí "Mã máy" / "TID" / "Số máy" (Khớp định dạng Regex: A[01]\\d{6}).
- ATM/CDM: Dựa vào ký tự thứ 2 (chỉ số index 1) của Mã máy:
  + Nếu là "0" -> "ATM"
  + Nếu là "1" -> "CDM"
- Ngày bắt đầu chu kỳ: Lấy chuỗi ngày [dd/mm/yyyy] sau từ "từ ngày" trong dòng Chu kỳ.
- Ngày kiểm quỹ: Lấy chuỗi ngày [dd/mm/yyyy] sau từ "Đến ngày" trong dòng Chu kỳ.
- Số tiền chênh lệch: Lấy giá trị ô ngay dưới dòng "Chênh lệch (Thừa/thiếu) quỹ máy CDM" (Đơn vị: VND).

## 2. Nếu tài liệu là "BIÊN BẢN KIỂM QUỸ TIỀN MẶT TẠI MÁY ATM":
- Đơn vị tiếp quỹ: Lấy giá trị tại mục "Tên ĐVTQ".
- Mã máy: Trích xuất tại vị trí "Mã máy" / "TID" / "Số máy" (Khớp định dạng Regex: A[01]\\d{6}).
- ATM/CDM: Dựa vào ký tự thứ 2 (chỉ số index 1) của Mã máy:
  + Nếu là "0" -> "ATM"
  + Nếu là "1" -> "CDM"
- Ngày bắt đầu chu kỳ: Lấy chuỗi ngày [dd/mm/yyyy] sau từ "từ ngày" trong dòng Chu kỳ.
- Ngày kiểm quỹ: Lấy chuỗi ngày [dd/mm/yyyy] sau từ "Đến ngày" trong dòng Chu kỳ.
- Số tiền chênh lệch: Lấy giá trị ô ngay dưới dòng "Chênh lệch giữa số tiền còn lại trong máy ATM" (Đơn vị: VND).

---

# CẤU TRÚC ĐẦU RA (JSON SCHEMA & SAMPLE)

YÊU CẦU BẮT BUỘC (CRITICAL): 
Chỉ trả về DUY NHẤT một chuỗi JSON thuần túy chứa mảng "danh_sach_tai_lieu". KHÔNG sử dụng block code markdown (không dùng \\\`\\\`\\\`json ... \\\`\\\`\\\`), KHÔNG kèm bất kỳ ký tự hay văn bản thừa nào trước hoặc sau cấu trúc JSON.

QUY TẮC FORMAT GIÁ TRỊ (BẮT BUỘC):
- Ngày tháng: Giữ NGUYÊN định dạng đọc được trên tài liệu (bao gồm dấu phân cách / hoặc -). Trả đúng như nhìn thấy, KHÔNG tự chuyển đổi format.
- Số tiền: Giữ NGUYÊN định dạng đọc được trên tài liệu (bao gồm dấu . hoặc , phân cách ngàn nếu có). Trả đúng như nhìn thấy, KHÔNG tự bỏ hoặc thêm dấu phân cách.

### Mẫu JSON đầu ra cho danh sách nhiều file:
{
  "tong_so_tai_lieu": 2,
  "danh_sach_tai_lieu": [
    {
      "loai_tai_lieu": "BIÊN BẢN KIỂM QUỸ MÁY CDM",
      "don_vi_tiep_quy": "Chi nhánh Hoàn Kiếm",
      "ma_may": "A1123456",
      "loai_may": "CDM",
      "ngay_bat_dau_chu_ky": "01/10/2026",
      "ngay_kiem_quy": "15/10/2026",
      "so_tien_chenh_lech": "0"
    },
    {
      "loai_tai_lieu": "BIÊN BẢN KIỂM QUỸ TIỀN MẶT TẠI MÁY ATM",
      "don_vi_tiep_quy": "Chi nhánh Bến Thành",
      "ma_may": "A0654321",
      "loai_may": "ATM",
      "ngay_bat_dau_chu_ky": "05/10/2026",
      "ngay_kiem_quy": "20/10/2026",
      "so_tien_chenh_lech": "500000"
    }
  ]
}`;

/**
 * Build prompt cho bước extract BBKQ.
 * Nếu Admin đã override trên Profile → dùng override.
 * Ngược lại → dùng prompt mặc định hardcode ở trên.
 */
export function buildExtractPrompt(promptOverride?: string): Record<string, unknown> {
  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, {}) };
  }
  return { _prompt: EXTRACT_PROMPT };
}
