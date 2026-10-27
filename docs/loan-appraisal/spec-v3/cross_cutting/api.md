# API — gọi W1 và W2

> **Nền v2 (D-32, 2026-10-16):** phần W1/W2, `OcrOutput`/`CheckInput`, bản vá, ngưỡng tự động và giao diện `/loan-dossier` trong file này **không áp dụng**. Kiến trúc chuẩn: [cross_cutting/v2_integration.md](v2_integration.md).

Luồng này **không thêm route mới**. Hệ thống gọi (và giao diện của DUGate) dùng các route có sẵn của nền tảng. Hợp đồng dữ liệu: [04_data_model.md](../04_data_model.md).

## 1. Route dùng

| # | Method + đường dẫn | Dùng cho | Xác thực |
|--:|---|---|---|
| 1 | `POST /api/v1/docs/workflows` (`process=loan-dossier-ocr`) | Gửi W1 | `x-api-key` của Profile |
| 2 | `POST /api/v1/docs/workflows` (`process=loan-dossier-check`) | Gửi W2 | `x-api-key` của Profile |
| 3 | `GET /api/v1/operations/{id}` | Poll trạng thái, đọc `extracted_data` | `x-api-key` cùng Profile, hoặc phiên của người đã tạo Operation, hoặc ADMIN |
| 4 | `POST /api/v1/operations/{id}/cancel` | Hủy lần chạy | Như #3 |
| 5 | Webhook (`callback_url` của request hoặc Profile) | Nhận kết quả khi xong | Theo cấu hình callback của Profile |

Phản hồi 202 của #1, #2 có `name = "operations/{id}"` và header `Operation-Location`.

## 2. Quy ước

| ID | Rule |
|---|---|
| **A-R01** | W1: multipart gồm `process=loan-dossier-ocr`, `files[]` (1–100 file PDF/JPG/PNG), `flow`, tùy chọn `dossier_submitted_at`, `upload_hints` (JSON). Không gửi field nào khác ngoài các field nền tảng chung (`callback_url`, `apiKeyId`…) |
| **A-R02** | W2: multipart gồm `process=loan-dossier-check` và **đúng 1** file trong `files[]` tên kết thúc `.json`, nội dung `CheckInput`. Lý do gửi qua file: route bắt buộc có ≥ 1 file, và PII không được nằm trong tham số form (D-06) |
| **A-R03** | Kết quả nằm ở `result.extracted_data` khi `done = true` và `state = SUCCEEDED`. `extracted_data.contract` cho biết là `OcrOutput` hay `CheckOutput` |
| **A-R04** | Lỗi đầu vào bị bắt ở worker: workflow ném `Error` có thông điệp `INVALID_INPUT: <MÃ> — <đường dẫn>` (D-07). `classifyWorkflowFailure` (`lib/pipelines/workflow-engine.ts`) thấy chuỗi `INVALID_INPUT` → `error.code = INPUT_INVALID`, `retryable = false`. Thông điệp **lưu trên Operation** là `Workflow input could not be processed. — <thông điệp gốc đã che secret, cắt 500 ký tự>`, nên mã luồng nằm **giữa** `error.message`, không ở đầu. Client tìm mã bằng `/\b(INVALID_OCR_INPUT\|INVALID_CHECK_INPUT\|UNSUPPORTED_CONTRACT_VERSION\|STAGE_RUNNER_MISCONFIGURED\|OUTPUT_CONTRACT_VIOLATION)\b/` (A-R09). Lỗi không chứa `INVALID_INPUT` → `SYSTEM_ERROR` (hoặc `CONNECTOR_ERROR` nếu thông điệp có `timeout`/`Connection Error`) |
| **A-R05** | Kết quả nghiệp vụ xấu không làm `FAILED` (D-08). Client đọc `status` của từng stage |
| **A-R06** | Mã hóa phản hồi: dùng tham số `encryption_*` sẵn có của Profile (tự gắn cho mọi sub-case trong registry). Spec không thêm cơ chế riêng |
| **A-R07** | Kết quả chỉ đọc được trong thời gian giữ nội dung của Operation (`OPERATION_CONTENT_RETENTION_DAYS`, mặc định 7 ngày). Client phải tự lưu kết quả nếu cần lâu hơn |
| **A-R08** | Poll tuần tự mỗi 2 s (`createPoller` của `app/loan-appraisal-v2/lib/poller.ts`: vòng sau chỉ chạy khi vòng trước xong; 10 phút → cảnh báo, 60 phút → ngừng; 3 lỗi liên tiếp → dừng); dừng khi `done = true`. Webhook được ưu tiên cho hệ thống ngoài |
| **A-R09** | **Webhook `FAILED` không mang mã luồng.** `sendWebhook` chỉ gửi tiêu đề chung (`error`), `error_code`, `retryable` cho mọi workflow trừ `payroll-verify`. Hệ thống ngoài muốn biết mã luồng phải `GET /api/v1/operations/{id}` và đọc `error.message` (A-R04). Spec không sửa `workflow-engine.ts` để đổi điều này (OQ-25) |
| **A-R10** | **Hành vi sẵn có của route cần biết** (đã đọc `app/api/v1/docs/workflows/route.ts`, `lib/endpoints/profile-resolver.ts`, `lib/upload-helper.ts`): (1) không có file → 400 `Missing Files`; (2) gửi tham số đã khóa (`auto_check_*`) → 400 `Forbidden Field`; tham số không khai báo trong sub-case bị bỏ qua im lặng; (3) đuôi file không được phép → `saveUploadedFile` ném lỗi và route trả **500** `Failed to save uploaded file` (không phải 400), nên client phải lọc đuôi trước (U1-R04); (4) danh sách đuôi được phép = `allowedFileExtensions` của Profile, nếu trống thì **field `allowed_extensions` client gửi**, nếu trống nữa mới tới registry — client có thể nới danh sách, nên workflow phải tự kiểm lại đuôi/định dạng (S1-R01, T-RUN-04); (5) tên file bị `sanitizeFilename` (≤ 80 ký tự) trước khi vào `filesData`, nên `file_name` trong kết quả có thể khác tên gốc — client khớp tệp theo `file_id`, không theo tên; (6) mọi giá trị form tới workflow dưới dạng **chuỗi**, giá trị Profile giữ kiểu đã lưu |

## 3. Mã lỗi

Mã luồng nằm trong `error.message` của `GET /api/v1/operations/{id}` (A-R04); `error.code` do nền tảng đặt. Webhook không có mã luồng (A-R09).

| Mã luồng (trong `error.message`) | `error.code` | Nơi phát | Ý nghĩa |
|---|---|---|---|
| `INVALID_OCR_INPUT` | `INPUT_INVALID` | W1 | Thiếu `flow`, `upload_hints` lệch số file, quá 100 file, file > 50 MB |
| `INVALID_CHECK_INPUT` | `INPUT_INVALID` | W2 | Số file khác 1, không phải JSON, `CheckInput` sai schema, form RM chưa hợp lệ |
| `UNSUPPORTED_CONTRACT_VERSION` | `INPUT_INVALID` | W2 | `contract_version` không nhận biết |
| `STAGE_RUNNER_MISCONFIGURED` | `SYSTEM_ERROR` | W1, W2 | Bật giả lập ở production (F-R04) |
| `OUTPUT_CONTRACT_VIOLATION` | `SYSTEM_ERROR` | W1, W2 | Đầu ra vi phạm hợp đồng (lỗi của DUGate) |

## 4. Task

### T-API-01 — Tài liệu tích hợp cho hệ thống ngoài
- Depends: T-CON-03, T-CON-04
- Files: `docs/loan-appraisal/spec-v3/INTEGRATION.md`, `tests/loan-dossier/api-integration-doc.test.ts`
- Refs: A-R01, A-R02, A-R03, A-R04, A-R09, A-R10
- Làm: Viết hướng dẫn gọi W1 → (client sửa, xác nhận) → W2 với ví dụ `curl` và ví dụ `OcrOutput`/`CheckInput`/`CheckOutput` đầy đủ (dữ liệu giả). Test đọc các khối ```json``` trong file và parse qua schema hợp đồng tương ứng.
- DoD:
  - test: mọi khối `json` có `contract` parse qua schema tương ứng
  - test: không khối nào chứa chuỗi giống API key (`dg_…`)
  - tài liệu có mục mã lỗi khớp §3, nói rõ mã luồng nằm giữa `error.message` và webhook `FAILED` không có mã luồng
- Verify: `npx jest tests/loan-dossier/api-integration-doc.test.ts`

### T-API-02 — Client gọi W1/W2 cho giao diện (hàm thuần)
- Depends: T-CON-03, T-CON-04
- Files: `lib/loan-dossier/ui/workflow-client.ts`, `tests/loan-dossier/ui-workflow-client.test.ts`
- Refs: A-R01, A-R02, A-R03, A-R04, A-R08
- Làm: `submitOcr({files, flow, submittedAt, uploadHints, apiKey, signal})`, `submitCheck(checkInput, {apiKey, signal})` (đóng gói `CheckInput` thành `File` tên `check_input.json`). Đọc và huỷ dùng nguyên `getOperation`/`cancelOperation` của `app/loan-appraisal-v2/lib/api.ts` (`view=compact` khi poll). Lỗi ném `ApiError` của v2 (cùng `kind`). Theo đúng mẫu `submitWorkflow` của v2, viết trong file mới (không cần sửa `api.ts`: `submitWorkflow` gắn cứng `process=loan-appraisal`).
- DoD (fetch giả):
  - test: `submitCheck` gửi đúng 1 file `check_input.json`, `type = application/json`
  - test: API key đi ở header `X-API-Key`, không ở URL hay body
  - test: `submitOcr` gửi `process=loan-dossier-ocr`, `files[]`, `flow`, `upload_hints` (JSON, cùng số phần tử với `files[]`)
  - test: 401/403 → `ApiError` `kind = 'forbidden'`; trả `operation_id` từ `name` như v2
  - test: không truy cập `localStorage`/`sessionStorage`
- Verify: `npx jest tests/loan-dossier/ui-workflow-client.test.ts`
