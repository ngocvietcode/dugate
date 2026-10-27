// lib/brd/criteria.ts
// Bộ 32 tiêu chí đánh giá chất lượng BRD (Đầy đủ – Rõ ràng – Chi tiết).
// Mỗi câu hỏi có trọng số; tổng trọng số = 50 (điểm tối đa). Đạt ≥ 85%.
//
// Code dùng danh sách này để: (1) map kết quả AI theo stt, (2) tính điểm quy đổi
// = điểm(0–1) × trọng số, (3) tổng hợp theo nhóm + tổng + %.

export interface CriterionDef {
  stt: number;
  group: string;
  question: string;
  weight: number;
}

export const BRD_CRITERIA: CriterionDef[] = [
  // TỔNG QUAN
  { stt: 1, group: 'Tổng quan', weight: 1, question: 'Mô tả quy trình hiện tại đang vận hành như thế nào? Thủ công hay đã số hóa, tự động hóa bước nào?' },
  { stt: 2, group: 'Tổng quan', weight: 1, question: 'Nêu rõ các vấn đề và hạn chế chính của quy trình hiện tại?' },
  { stt: 3, group: 'Tổng quan', weight: 1, question: 'Có hệ thống nào đang hỗ trợ không? Hạn chế của hệ thống đó?' },

  // MỤC TIÊU & PHẠM VI
  { stt: 4, group: 'Mục tiêu & Phạm vi', weight: 1, question: 'Mục tiêu chính là gì? Nêu mục tiêu định lượng (nếu có)?' },
  { stt: 5, group: 'Mục tiêu & Phạm vi', weight: 1, question: 'Phạm vi nghiệp vụ nào bị tác động?' },
  { stt: 6, group: 'Mục tiêu & Phạm vi', weight: 1, question: 'Đối tượng sử dụng/đơn vị nào bị ảnh hưởng?' },

  // CÁC BÊN LIÊN QUAN
  { stt: 7, group: 'Các bên liên quan', weight: 1, question: 'Liệt kê các đơn vị/bên liên quan tham gia quy trình?' },
  { stt: 8, group: 'Các bên liên quan', weight: 1, question: 'Vai trò của từng đơn vị trong quy trình là gì?' },
  { stt: 9, group: 'Các bên liên quan', weight: 1, question: 'Có email xác nhận/đồng thuận từ các bên liên quan bị ảnh hưởng bởi yêu cầu thay đổi?' },

  // WORKFLOW As-Is
  { stt: 10, group: 'Workflow As-Is', weight: 1, question: 'Có mô tả chi tiết các bước xử lý hiện tại?' },
  { stt: 11, group: 'Workflow As-Is', weight: 1, question: 'Ai thực hiện mỗi bước? Trên hệ thống nào?' },
  { stt: 12, group: 'Workflow As-Is', weight: 1, question: 'Có sơ đồ minh hoạ quy trình hiện tại?' },

  // WORKFLOW To-Be
  { stt: 13, group: 'Workflow To-Be', weight: 2, question: 'Có mô tả quy trình sau cải tiến (đã lean/tối ưu, số hóa & tự động hóa end-to-end)?' },
  { stt: 14, group: 'Workflow To-Be', weight: 2, question: 'Có nêu rõ người thực hiện và công cụ tương ứng?' },
  { stt: 15, group: 'Workflow To-Be', weight: 2, question: 'Có thể hiện sự khác biệt và cải tiến so với As-Is?' },
  { stt: 16, group: 'Workflow To-Be', weight: 2, question: 'Có sơ đồ minh hoạ To-Be không?' },

  // YÊU CẦU CHỨC NĂNG
  { stt: 17, group: 'Yêu cầu chức năng', weight: 3, question: 'Đầy đủ, rõ ràng tên hệ thống cần phát triển/chỉnh sửa?' },
  { stt: 18, group: 'Yêu cầu chức năng', weight: 3, question: 'Đầy đủ, rõ ràng tên tính năng hoặc đường dẫn/menu cụ thể?' },
  { stt: 19, group: 'Yêu cầu chức năng', weight: 3, question: 'Có hình ảnh giao diện hoặc mô tả màn hình cần phát triển?' },
  { stt: 20, group: 'Yêu cầu chức năng', weight: 3, question: 'Thông tin đầu vào & đầu ra mong muốn là gì?' },
  { stt: 21, group: 'Yêu cầu chức năng', weight: 3, question: 'Mô tả logic xử lý hoặc quy trình hệ thống?' },
  { stt: 22, group: 'Yêu cầu chức năng', weight: 3, question: 'Yêu cầu báo cáo: tên báo cáo, nội dung, tần suất?' },

  // YÊU CẦU TÍCH HỢP
  { stt: 23, group: 'Yêu cầu tích hợp', weight: 1, question: 'Có hệ thống nào cần tích hợp không?' },
  { stt: 24, group: 'Yêu cầu tích hợp', weight: 1, question: 'Thông tin/dữ liệu nào cần trao đổi?' },
  { stt: 25, group: 'Yêu cầu tích hợp', weight: 1, question: 'Tần suất trao đổi thông tin giữa các hệ thống?' },

  // YÊU CẦU PHI CHỨC NĂNG
  { stt: 26, group: 'Yêu cầu phi chức năng', weight: 1, question: 'Yêu cầu về thời gian xử lý (SLA)?' },
  { stt: 27, group: 'Yêu cầu phi chức năng', weight: 1, question: 'Số lượng user dự kiến?' },
  { stt: 28, group: 'Yêu cầu phi chức năng', weight: 1, question: 'Yêu cầu bảo mật hoặc ổn định đặc biệt?' },

  // YÊU CẦU VỀ VAI TRÒ/QUYỀN HẠN
  { stt: 29, group: 'Vai trò / Quyền hạn', weight: 1, question: 'Có nhóm người dùng mới?' },
  { stt: 30, group: 'Vai trò / Quyền hạn', weight: 1, question: 'Mỗi nhóm được xem/làm gì?' },

  // ĐÁNH GIÁ LỢI ÍCH
  { stt: 31, group: 'Đánh giá lợi ích', weight: 2, question: 'Yêu cầu có lợi ích tài chính, tiết kiệm FTE hoặc rủi ro ngăn chặn?' },
  { stt: 32, group: 'Đánh giá lợi ích', weight: 2, question: 'Có số liệu định lượng kèm phương pháp tính/nguồn dữ liệu/giả định?' },
];

/** Điểm tối đa = tổng trọng số (đúng 50 theo thiết kế). */
export const MAX_SCORE = BRD_CRITERIA.reduce((s, c) => s + c.weight, 0);

/** Ngưỡng đạt (%). */
export const PASS_PERCENT = 85;

/** Các mức điểm hợp lệ cho mỗi câu hỏi. */
export const ALLOWED_SCORES = [0, 0.25, 0.5, 0.75, 1] as const;

/** Thứ tự nhóm để hiển thị. */
export const GROUP_ORDER: string[] = [
  'Tổng quan',
  'Mục tiêu & Phạm vi',
  'Các bên liên quan',
  'Workflow As-Is',
  'Workflow To-Be',
  'Yêu cầu chức năng',
  'Yêu cầu tích hợp',
  'Yêu cầu phi chức năng',
  'Vai trò / Quyền hạn',
  'Đánh giá lợi ích',
];
