# 01 — Tổng quan

> **Nền v2 (D-32, 2026-10-16):** phần W1/W2, `OcrOutput`/`CheckInput`, bản vá, ngưỡng tự động và giao diện `/loan-dossier` trong file này **không áp dụng**. Kiến trúc chuẩn: [cross_cutting/v2_integration.md](cross_cutting/v2_integration.md).

## 1. Bài toán

Cán bộ quan hệ khách hàng (RM) nhận hồ sơ vay Hộ kinh doanh có tài sản bảo đảm (TSBĐ), gồm nhiều file scan/ảnh. Cán bộ thẩm định (CO) phải đọc từng file, so với thông tin RM nhập trên Secure Loan (SL), kiểm tra đủ giấy tờ và phát hiện sai lệch.

Hệ thống tự động hóa các việc đó và **chỉ gợi ý, không quyết định**. Người luôn là bên xác nhận, ở hệ thống gọi.

## 2. Luồng đầu-cuối

DUGate **không lưu trạng thái hồ sơ** (fire-and-forget). Mỗi lần gọi là một Operation độc lập; hệ thống gọi (hoặc giao diện `/loan-dossier` của DUGate) giữ hồ sơ giữa hai lần gọi.

```text
 Hệ thống gọi / giao diện /loan-dossier                         DUGate
 ───────────────────────────────────────────────────────        ─────────────────────────────
 Chọn file + luồng ──── W1 loan-dossier-ocr ───────────────▶  S1 classify → S2 extract_evidence
                    ◀── OcrOutput (evidence, việc cần rà soát,     + review_issues, suggestions,
                        gợi ý form, auto_eval)                       auto_eval
 Rà soát OCR, sửa giá trị (giữ bản vá ở client)
 Điền form xác nhận (hoặc chạy tự động nếu đạt ngưỡng)
 ──── W2 loan-dossier-check (check_input.json) ────────────▶  áp bản vá → S3 map
                    ◀── CheckOutput (S3–S6, gợi ý giá trị chuẩn)   → {S4 check, S5 cross, S6 vs SL}
 CO chọn giá trị chuẩn, xác nhận (ở hệ thống gọi)
```

- W1 và W2 đi qua route có sẵn `POST /api/v1/docs/workflows`; kết quả đọc bằng `GET /api/v1/operations/{id}` hoặc webhook.
- Thêm file → gửi lại W1 với toàn bộ file. Sửa OCR / form → gửi lại W2. Xem [04_data_model §6](04_data_model.md).
- Giao diện `/loan-dossier` giữ bố cục và cách chạy của `/loan-appraisal-v2`: cột trái thiết lập + nút chạy + tiến độ; cột phải 2 tab giai đoạn (xem [ui/](ui/U1_create_upload.md)).

## 3. Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| 6 stage S1–S6, hai workflow W1/W2 | Thẩm định tài chính (CFADS, DSCR), 5C, policy, scorecard, khuyến nghị |
| Rà soát OCR, form xác nhận KH, ngưỡng tự động (ở client) | Lưu hồ sơ, nháp, lịch sử, quyết định CO ở DUGate |
| Giao diện `/loan-dossier` làm client mẫu | `compare_ocr_il` (chưa có nguồn) |
| Sản phẩm Hộ kinh doanh có TSBĐ | Khách hàng doanh nghiệp (chưa chốt — OQ-01); tích hợp API thật với SL / core banking |

## 4. Người dùng

| Vai trò | Làm gì |
|---|---|
| **RM** (Sales) | Gửi W1, rà soát OCR, điền form xác nhận, gửi W2 — ở hệ thống gọi hoặc `/loan-dossier` |
| **CO** | Xem kết quả kiểm tra, chọn giá trị chuẩn và xác nhận — ở hệ thống gọi |
| **ADMIN** | Bật hai endpoint cho Profile, đặt ngưỡng tự động trên trang Profile |

Phân quyền: [cross_cutting/rbac.md](cross_cutting/rbac.md).

## 5. Thuật ngữ

| Từ | Nghĩa |
|---|---|
| **W1 / W2** | Workflow `loan-dossier-ocr` (S1–S2) và `loan-dossier-check` (S3–S6) |
| **Evidence** | Dữ liệu OCR của 1 bản thể chứng từ (1 file × 1 loại × 1 bản thể); `evidence_id` tất định |
| **FieldEdit** | Bản vá do người sửa một giá trị OCR; client giữ và gửi kèm W2. Evidence gốc không đổi |
| **Anchor** | `loan_application` — chứng từ duy nhất quyết định vai trò của từng người |
| **Role** | `borrower`, `co_borrower`, `collateral_owner`, `other` |
| **SL** | Secure Loan — hệ thống RM nhập liệu; ở luồng này là form xác nhận |
| **Flow** | `FAST` / `FULL` / `SIMPLE` — quyết định bộ checklist |

## 6. Nguyên tắc thiết kế

1. **Rule-based trước, LLM sau.** LLM chỉ dùng nơi catalog ghi `LLM_SEMANTIC`, nhiệt độ 0, nhãn đóng.
2. **Kết quả nghiệp vụ xấu không làm stage `FAILED`.** Thiếu giấy tờ, lệch dữ liệu → `PARTIAL_SUCCESS`. `FAILED` chỉ cho lỗi hệ thống.
3. **Tất định.** Cùng input → cùng output.
4. **Không lưu trạng thái.** Không bảng, không route mới; mọi dữ liệu W2 cần nằm trong `check_input.json`.
5. **Không sửa dữ liệu gốc.** Người sửa → `FieldEdit`; kết quả = OCR + bản vá.
6. **PII không vào log, không vào tham số form.** Chỉ log id và mã lý do.
7. **Một nguồn sự thật.** Key, enum, checklist, ma trận đối chiếu nằm ở `03_catalogs/`; spec chỉ trỏ tới.
