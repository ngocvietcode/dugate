---
description: Phương pháp luận và quy trình bắt buộc khi phát triển tính năng (Breakthrough Method of Agile AI-driven Development)
---

# Quy trình chuẩn BMAD (Breakthrough Method of Agile AI-driven Development)

AI (Agent) phải luôn tuân thủ nghiêm ngặt quy trình **BMAD** mỗi khi USER yêu cầu thiết kế hệ thống, phân tích yêu cầu hoặc xây dựng chức năng mới. Việc này đảm bảo tính bền vững, chuẩn hóa cấu trúc và có thể mở rộng dễ dàng. 

Quy trình bao gồm 5 bước cốt lõi:

## 🧭 Bước 1: Khám phá & Làm rõ (Discovery & Define)
- **Hành động:** Khi nhận yêu cầu mới, **khoan bắt tay vào code ngay lập tức**. Đọc hiểu các luồng logic của ứng dụng.
- **Tiêu chuẩn:**
  1. Phân tích ngữ cảnh (Context): "Tính năng này phục vụ giải quyết bài toán gì?".
  2. Bổ sung các Requirements bị khuyết (Edge cases, Error handling).
  3. Giao tiếp với USER về bất kỳ sự không thống nhất nào (VD: "Theo em thấy API X chưa hỗ trợ tham số Y...").

## 📂 Bước 2: Thiết kế & Lập kế hoạch (Architecture & Plan)
- **Hành động:** Luôn xây dựng **Implementation Plan** dưới dạng Artifact. Phác thảo chi tiết trước khi execution.
- **Tiêu chuẩn:**
  1. Chia nhỏ kiến trúc thành các tầng: [UI Component] - [API Route] - [Database Model] - [State/Store].
  2. Xác định rõ **những tệp tin mới (New files)** và **những tệp tin bị chỉnh sửa (Modified files)**.
  3. Bất cứ thay đổi Design nào cũng phải tôn trọng hệ thống Semantic Tokens sẵn có (VD: `primary`, `destructive`, `background`, `card` thay vì hardcode HEX/RGB).

## 🔨 Bước 3: Triển khai linh hoạt (Agile Execution)
- **Hành động:** Bắt tay vào viết code theo từng cụm hoặc tính năng nhỏ. Triển khai lặp vòng (Iterative execution).
- **Tiêu chuẩn:**
  1. Sử dụng Document/Task Tracker (`task.md`) để theo dõi những hạng mục đã làm `[x]`, đang làm `[/]` và chưa làm `[ ]`.
  2. Không để lại "Debt Technical" — Refactor khi nhận thấy hàm qúa phức tạp hoặc UI components viết chồng lấp lên nhau.
  3. Xử lý triệt để Loading Skeleton (UX), State management & lỗi biên trước khi đóng API/Component đó.

## 🕵️ Bước 4: Tự động Xác thực (Review & Checklist)
- **Hành động:** Liên tục chạy lệnh để test sự toàn vẹn của Repo trước khi handoff (bàn giao) lại cho USER.
- **Tiêu chuẩn:**
  1. Phải chạy lệnh như `npm run build` hoặc sử dụng Browser Agent/Snapshot để rà soát thay vì chỉ check bằng mắt (static/blind test).
  2. Đảm bảo API Keys và Config môi trường được giữ an toàn (Che khuất, Không hardcode thẳng vào Next.js page).
  3. Chạy theo **DOR** (Definition of Ready) và **DOD** (Definition of Done) tiêu chuẩn. Cập nhật `walkthrough.md` tổng kết tiến độ.

## 🤝 Bước 5: Bàn giao (Handoff)
- Trình bày rõ ràng lại những file đã làm.
- Cung cấp Hướng dẫn kiểm thử (Testing steps) chi tiết nhất để USER chỉ việc copy lệnh để check kết quả hoặc gửi báo cáo trực tiếp cho Stakeholder/Client.

---

> **⚠ CHÚ Ý:** Đọc file luồng này trước mỗi lệnh /slash-command hoặc tạo một module mới! Nó kết hợp với các lệnh turbo của agent để hoạt động ở mức tự trị cao (autonomous behavior).
