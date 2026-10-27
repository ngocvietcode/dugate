// lib/pipelines/workflows/prompts/brd-analyze-prompts.ts
// Prompt builder cho workflow BRD Analyzer — 2 phần trong 1 lần gọi:
//   Phần 1: Prioritization Scorecard (BV/TE/Reuse/Bonus, thang 1–5).
//   Phần 2: Đánh giá chi tiết BRD theo 32 tiêu chí (Đầy đủ – Rõ ràng – Chi tiết).
//
// File BRD được ĐÍNH KÈM (không nhồi nội dung vào prompt).
// Rule engine (code) tự tính Final Score (Phần 1) và tổng /50, % (Phần 2).

import { SCORECARD_CONFIG, type CriterionKey } from '@/lib/brd/scorecard.config';

function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in vars ? vars[key] : m));
}

/** Rubric Phần 1 (Prioritization Scorecard) render từ config. */
function scorecardRubric(): string {
  const keys: CriterionKey[] = ['businessValue', 'technicalEffort', 'reusability', 'bonus'];
  return keys
    .map((k) => {
      const c = SCORECARD_CONFIG.criteria[k];
      const levels = c.rubric.map((r) => `      - ${r.score} (${r.label}): ${r.description}`).join('\n');
      const weightInfo = k === 'bonus' ? 'cộng thẳng' : `weight ${c.weight}`;
      return `    ${c.label} [${weightInfo}] — ${c.description}\n${levels}`;
    })
    .join('\n\n');
}

const EVAL_PROMPT = `Bạn là Chuyên gia Business Analyst (BA) ngân hàng. Đọc tài liệu BRD ĐÍNH KÈM và thực hiện ĐỒNG THỜI HAI phần đánh giá. KHÔNG suy diễn ngoài nội dung BRD; nếu thông tin chỉ có trong hình ảnh mà không có mô tả text → coi như CHƯA CÓ.

══════════════════════════════════════════
PHẦN 1 — PRIORITIZATION SCORECARD (chấm 1–5 mỗi tiêu chí)
══════════════════════════════════════════
${scorecardRubric()}

Quy ước Phần 1: chấm điểm nguyên 1–5 cho từng tiêu chí dựa trên bằng chứng trong BRD; thiếu/mơ hồ → điểm thấp hơn, nêu rõ lý do. "Technical Effort": điểm CAO = khả thi cao / nỗ lực thấp. KHÔNG cần tính Final Score (hệ thống tự tính theo trọng số 0.6/0.3/0.1 + Bonus).

══════════════════════════════════════════
PHẦN 2 — ĐÁNH GIÁ CHI TIẾT BRD (32 tiêu chí; mỗi tiêu chí chấm 0 / 0.25 / 0.5 / 0.75 / 1)
══════════════════════════════════════════
NGUYÊN TẮC:
- Chỉ đánh giá dựa trên nội dung CÓ trong BRD; bắt buộc nêu cơ sở (đề mục/trang).
- Chỉ liệt kê đầu mục, không mô tả → tối đa 0.25. Mô tả chung chung, không logic/số liệu/quy trình → tối đa 0.5. Nội dung sao chép/mẫu, không gắn bối cảnh → trừ điểm.
THANG ĐIỂM: 0 = không có thông tin; 0.25 = đạt ≤1/3 checklist; 0.5 = đạt ~1/2; 0.75 = đạt hầu hết nhưng thiếu chi tiết; 1 = đạt toàn bộ, rõ ràng, nhất quán.

DANH SÁCH 32 TIÊU CHÍ (kèm trọng số & checklist tóm tắt):
[Tổng quan]
1 (w1) Mô tả quy trình hiện tại (thủ công/đã số hóa/tự động bước nào)? ✓ chi tiết từng bước; phân biệt thủ công/tự động; công cụ; vai trò người thực hiện.
2 (w1) Vấn đề & hạn chế chính của quy trình hiện tại? ✓ liệt kê đủ; nguyên nhân gốc; định lượng tác động (thời gian/chi phí/rủi ro).
3 (w1) Có hệ thống nào đang hỗ trợ? Hạn chế? ✓ liệt kê hệ thống; chức năng chính; hạn chế kỹ thuật & nghiệp vụ.
[Mục tiêu & Phạm vi]
4 (w1) Mục tiêu chính & mục tiêu định lượng? ✓ tổng quát rõ; định lượng; SMART; không mâu thuẫn lợi ích.
5 (w1) Phạm vi nghiệp vụ bị tác động? ✓ quy trình ảnh hưởng; mức độ; ranh giới trong/ngoài.
6 (w1) Đối tượng/đơn vị bị ảnh hưởng? ✓ liệt kê; số lượng; mức độ ảnh hưởng.
[Các bên liên quan]
7 (w1) Liệt kê đơn vị/bên liên quan? ✓ đủ nội bộ & ngoài; phân loại; mối quan hệ.
8 (w1) Vai trò từng đơn vị? ✓ vai trò & trách nhiệm; quyền quyết định; input/output mỗi đơn vị.
9 (w1) Có email xác nhận/đồng thuận từ các bên bị ảnh hưởng? ✓ có email; đồng thuận phạm vi/mục tiêu; cam kết hỗ trợ.
[Workflow As-Is]
10 (w1) Mô tả chi tiết các bước xử lý hiện tại? ✓ đủ từng bước; input/xử lý/output; điều kiện & quyết định.
11 (w1) Ai thực hiện mỗi bước? Trên hệ thống nào? ✓ người/vai trò; hệ thống/công cụ; cách tương tác.
12 (w1) Có sơ đồ minh hoạ quy trình hiện tại? ✓ flowchart; đủ bước/quyết định/luồng; dễ hiểu, đúng chuẩn.
[Workflow To-Be]
13 (w2) Mô tả quy trình sau cải tiến? ✓ chi tiết từng bước; điều kiện; đã lean/tối ưu, số hóa & tự động hóa end-to-end, không còn thủ công/dư thừa/trùng lắp/waiting time.
14 (w2) Nêu rõ người thực hiện & công cụ tương ứng? ✓ người/vai trò; hệ thống/công cụ; cách tương tác mới.
15 (w2) Thể hiện khác biệt & cải tiến so với As-Is? ✓ thay đổi chính; lợi ích mỗi thay đổi; định lượng cải thiện.
16 (w2) Có sơ đồ minh hoạ To-Be? ✓ flowchart mới; đủ bước/quyết định/luồng; dễ hiểu.
[Yêu cầu chức năng]
17 (w3) Tên hệ thống cần phát triển/chỉnh sửa rõ ràng? ✓ tên đầy đủ; tổng quan mục đích/đối tượng; mới hay nâng cấp.
18 (w3) Tên tính năng/đường dẫn/menu cụ thể? ✓ liệt kê đủ tính năng; cấu trúc menu/đường dẫn; phân nhóm module/luồng.
19 (w3) Hình ảnh giao diện/mô tả màn hình? ✓ mô tả (kèm text) màn hình chính; thành phần (trường/nút/bảng); tương tác & chuyển tiếp. (Hình không kèm text → chưa có.)
20 (w3) Thông tin đầu vào & đầu ra mong muốn? ✓ đủ trường input; định dạng/ràng buộc/validation; output & cách hiển thị.
21 (w3) Logic xử lý/quy trình hệ thống? ✓ bước xử lý logic; quy tắc nghiệp vụ & điều kiện; xử lý ngoại lệ/lỗi.
22 (w3) Yêu cầu báo cáo (tên/nội dung/tần suất)? ✓ nội dung/cấu trúc/định dạng; điều kiện lọc/tần suất/đối tượng; template/mockup mô tả text.
[Yêu cầu tích hợp]
23 (w1) Có hệ thống cần tích hợp? ✓ liệt kê; mục đích; phiên bản/môi trường.
24 (w1) Dữ liệu nào cần trao đổi? ✓ loại dữ liệu; cấu trúc/định dạng; chiều trao đổi.
25 (w1) Tần suất trao đổi? ✓ tần suất (real-time/batch/lịch); thời điểm; cơ chế đồng bộ.
[Yêu cầu phi chức năng]
26 (w1) SLA thời gian xử lý? ✓ thời gian phản hồi/xử lý tối đa; uptime.
27 (w1) Số lượng user dự kiến? ✓ user đồng thời; phân loại; dự báo tăng trưởng.
28 (w1) Yêu cầu bảo mật/ổn định đặc biệt? ✓ bảo mật đặc thù; ổn định/chịu lỗi; tiêu chuẩn tuân thủ.
[Vai trò / Quyền hạn]
29 (w1) Có nhóm người dùng mới? ✓ liệt kê nhóm; đặc điểm/nhu cầu; rõ nhóm mới.
30 (w1) Mỗi nhóm được xem/làm gì? ✓ quyền hạn từng nhóm; tính năng truy cập; hạn chế; ma trận phân quyền.
[Đánh giá lợi ích]
31 (w2) Lợi ích tài chính/tiết kiệm FTE/ngăn rủi ro? ✓ lợi ích tài chính; tiết kiệm FTE; rủi ro ngăn chặn.
32 (w2) Số liệu định lượng kèm phương pháp tính/nguồn/giả định? ✓ số liệu; phương pháp tính; nguồn & giả định.

══════════════════════════════════════════
ĐẦU RA — CHỈ trả về DUY NHẤT một JSON hợp lệ (KHÔNG markdown fence, KHÔNG văn bản ngoài JSON):
{
  "scorecard": {
    "businessValue": { "score": 1, "rationale": "..." },
    "technicalEffort": { "score": 1, "rationale": "..." },
    "reusability": { "score": 1, "rationale": "..." },
    "bonus": { "score": 1, "rationale": "..." }
  },
  "questions": [
    { "stt": 1, "status": "✓|?|✗", "score": 0, "basis": "đề mục/trang trong BRD", "recommendation": "nội dung cần hoàn thiện (ngôn ngữ nghiệp vụ)" }
    // ĐỦ 32 phần tử, stt 1→32, đúng thứ tự
  ],
  "overallAssessment": "đánh giá tổng thể chất lượng BRD",
  "recommendations": "đề xuất cụ thể, ưu tiên, để hoàn thiện BRD"
}

QUY ƯỚC ĐẦU RA:
- Phần 1 (scorecard): score nguyên ∈ {1,2,3,4,5}.
- Phần 2 (questions): "✓" → score=1; "✗" → score=0; "?" → score ∈ {0.25,0.5,0.75}. score CHỈ nhận {0,0.25,0.5,0.75,1}.
- "basis": nêu đề mục/trang; nếu không có nội dung ghi "Không có thông tin".
- KHÔNG tự tính Final Score / tổng điểm / tỷ lệ % — hệ thống tự tính.
- Toàn bộ bằng tiếng Việt.`;

/** Prompt đánh giá BRD 2 phần (hỗ trợ override toàn bộ từ Profile). */
export function buildAnalyzePrompt(promptOverride?: string): Record<string, unknown> {
  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, {}) };
  }
  return { _prompt: EVAL_PROMPT };
}
