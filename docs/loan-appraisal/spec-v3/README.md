# Loan Appraisal — Spec v3 (Sprint 1–2)

Bộ spec viết lại để **dev agent code trực tiếp** và **người review đọc nhanh**. Không tương thích ngược với v1/v2.

**Kiến trúc (từ 2026-10-16, IMPLEMENT D-32):** triển khai trong workflow v2 tám stage `process=loan-appraisal` (`lib/pipelines/workflows/loan-appraisal.ts`): stage 0 = S1, stage 1 = S2, stage 2 = S3 → S4 → S5, stage 3–7 giữ logic v2. Kiểu dữ liệu và danh mục loại chứng từ theo spec. Phần W1/W2, giao diện `/loan-dossier`, S6 **không áp dụng** — xem [cross_cutting/v2_integration.md](cross_cutting/v2_integration.md), file này thắng khi mâu thuẫn.

_Kiến trúc trước đó (D-25…D-27, không còn áp dụng):_ DUGate không lưu trạng thái hồ sơ. Hai workflow độc lập qua route có sẵn `POST /api/v1/docs/workflows`: **W1** `loan-dossier-ocr` (S1–S2) và **W2** `loan-dossier-check` (S3–S6, nhận `check_input.json`). Hệ thống gọi giữ hồ sơ, bản vá OCR, form xác nhận và quyết định của CO. Giao diện `/loan-dossier` là client mẫu, giữ bố cục và cách chạy của `/loan-appraisal-v2`.

## Đọc theo thứ tự

| # | File | Nội dung | Ai đọc |
|---|---|---|---|
| 1 | [01_overview.md](01_overview.md) | Bài toán, luồng W1 → W2, phạm vi, thuật ngữ | Tất cả |
| 2 | [02_conventions.md](02_conventions.md) | Quy ước tên, kiểu dữ liệu, trạng thái, task card | Dev, review |
| 3 | [03_catalogs/](03_catalogs/) | Danh mục máy đọc (JSON). **Nguồn duy nhất** của key/enum/checklist | Dev |
| 4 | [04_data_model.md](04_data_model.md) | Hợp đồng `OcrOutput`, `CheckInput`, `CheckOutput`, bản vá. Không có bảng DB | Dev, hệ thống gọi |
| 5 | [stages/](stages/) | 6 stage xử lý: S1 … S6 | Dev, BA |
| 6 | [ui/](ui/) | Giao diện `/loan-dossier`: U1 khung + chạy, U2–U3 Giai đoạn 1, U4 Giai đoạn 2 | Dev FE, BA |
| 7 | [cross_cutting/](cross_cutting/) | **Triển khai trên v2** ([v2_integration.md](cross_cutting/v2_integration.md)), workflow, API, phân quyền, bảo mật, test | Dev, security |
| 8 | [BACKLOG.md](BACKLOG.md) | Toàn bộ task, thứ tự, phụ thuộc | PM, dev |
| 9 | [open_questions.md](open_questions.md) | Điểm chưa chốt, ai quyết | PO, BU |

Nhật ký làm việc: [PLAN.md](PLAN.md), [IMPLEMENT.md](IMPLEMENT.md).

## Cách đọc một spec stage

Mỗi file `stages/S*.md` có cùng bố cục:

1. **Mục đích** (3 dòng).
2. **Input / Output** (bảng).
3. **Rule** — mỗi rule có ID `S3-R05`, một câu kiểm chứng được.
4. **Acceptance criteria** — viết dạng Given/When/Then, mỗi AC trỏ về rule.
5. **Task cards** — mỗi task ≤ 1 module + 1 file test.

## Cách agent dùng spec

1. Mở `BACKLOG.md`, chọn task có mọi `Depends` đã xong.
2. Đọc **chỉ** file spec và rule ID mà task trỏ tới (`Refs`).
3. Viết test trước (DoD liệt kê test cần có), rồi code.
4. Chạy lệnh `Verify` của task. Pass mới đánh dấu xong.

## Thay đổi lớn so với v2

| v2 | v3 | Lý do |
|---|---|---|
| Không có khóa nối các lần chạy; dùng `previous_operation_id` | W2 nhận đủ dữ liệu trong `check_input.json`, không đọc Operation khác | Fire-and-forget, không lưu trạng thái (D-25) |
| OCR → kiểm tra liền | Tách W1/W2; giữa hai lần là rà soát OCR + form xác nhận ở client | BU cần người xác nhận trước khi chạy kiểm tra |
| Stage 6 không có trong bộ v2 | Có `S6`, chỉ gợi ý giá trị chuẩn; CO quyết ở hệ thống gọi | Thiếu; DUGate không lưu quyết định |
| Key legacy, bảng ánh xạ cũ → mới | Bỏ hết | Không cần tương thích |
| 12 stage khai báo, 5 stage có spec | 6 stage, đủ spec | Chỉ mô tả cái làm ngay |
| 8 trạng thái stage | 7 | Bỏ `PENDING` khỏi kết quả (chỉ là trạng thái lập lịch) |
| SL nhập qua file XLSX | Form xác nhận (`FORM`) | Theo UI BU |
