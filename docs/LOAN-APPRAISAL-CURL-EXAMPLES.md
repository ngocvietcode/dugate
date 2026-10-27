# Loan Appraisal — cURL mẫu cho hệ thống bên ngoài

Workflow: `process=loan-appraisal` (endpoint slug `workflows:loan-appraisal`), gọi qua `POST /api/v1/docs/workflows` (hoặc `/api/v2/docs/workflows`, cùng handler).

Base URL mẫu: `http://localhost:2023` (dev). Đổi theo môi trường (`next start` chạy cổng 2025).

**Header dùng chung**
- `x-api-key` (bắt buộc): API key của Profile đã bật endpoint `workflows:loan-appraisal`. Thiếu: 401; sai hoặc thu hồi: 401; Profile bị khoá: 403; Profile chưa bật endpoint: 403.
- `x-correlation-id` (khuyến nghị): để tra log.
- Không tự đặt `Content-Type` cho request multipart; curl `-F` tự sinh boundary.

**Luồng tích hợp mặc định (từ D-53)**

`stop_after_intake` mặc định là `true`, nên một request không truyền tham số sẽ chạy như sau:

1. Submit hồ sơ, nhận `202` kèm operation id.
2. Hệ thống chạy giai đoạn 1 (phân loại, bóc tách, gom người/tài sản, checklist, đối chiếu chéo, kiểm tra tiếp nhận). Xong thì operation sang `WAITING_USER_INPUT`, webhook gửi `PAUSED`.
3. Đọc kết quả tiếp nhận bằng `GET /api/v1/operations/{id}`.
4. Gọi `POST /api/v1/operations/{id}/resume` để chạy giai đoạn 2.
5. Khi xong, webhook gửi `SUCCEEDED` kèm `extracted_data`. Hoặc poll `GET /api/v1/operations/{id}?view=integration`.

Muốn chạy hết 8 stage một lần, truyền `stop_after_intake=false` (mục 2).

---

## 1. Gửi hồ sơ, dừng sau giai đoạn 1 (mặc định)

```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-correlation-id: loan-intake-001" \
  -F "process=loan-appraisal" \
  -F "product_code=hkd-loan" \
  -F "flow=FAST" \
  -F "files[]=@./ho_so_phap_ly.pdf" \
  -F "files[]=@./de_nghi_vay_von.pdf" \
  -F "files[]=@./gcn_quyen_su_dung_dat.pdf" \
  -F "webhook_url=https://your-app.example.com/callbacks/loan-appraisal"
```

Response `202`:

```json
{
  "name": "operations/OPERATION_ID",
  "done": false,
  "metadata": {
    "state": "RUNNING",
    "workflow": "loan-appraisal",
    "progress_percent": 0,
    "progress_message": "Initializing workflow..."
  }
}
```

Header kèm theo: `X-Operation-ID: OPERATION_ID` và `Operation-Location: /api/v1/operations/OPERATION_ID`.

Tham số form:

| Field | Bắt buộc | Ý nghĩa |
|---|---|---|
| `process` | có | Luôn là `loan-appraisal`. |
| `files[]` | có, hoặc `file_urls` | Mỗi file một phần form. Có thể là PDF/ảnh gồm nhiều chứng từ; hệ thống tự phân loại và cắt theo trang. Alias `files` chỉ dùng khi không có `files[]`. |
| `product_code` | khuyến nghị | Hiện hỗ trợ `hkd-loan`. Mã khác bị từ chối. |
| `flow` | khuyến nghị | `FULL`, `FAST` hoặc `SIMPLE`. Không truyền hoặc giá trị lạ: dùng luồng mặc định và checklist báo `INVALID_FLOW`. |
| `stop_after_intake` | không | Mặc định `true`. Giá trị tắt: `false`, `"false"`, `"0"`, `"no"`. |
| `intake_llm_review` | không | Mặc định `true` (LLM chấm 3 tiêu chí và viết tổng kết). `false`: chỉ chấm bằng quy tắc, không gọi LLM. |
| `acknowledgements` | không | JSON giải trình khi chạy lại hồ sơ (mục 6). |
| `webhook_url` / `callback_url` | không | Nơi nhận callback. Nếu gửi cả hai thì phải giống nhau. Phải là URL an toàn và nằm trong `ALLOWED_WEBHOOK_ORIGINS` của server; không thì 400. |

Các tham số `loan_checklist_overrides`, `loan_check_set`, `loan_policy` do admin khoá trong Profile, client không gửi được.

---

## 2. Gửi hồ sơ và chạy hết 8 stage một lần

```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-correlation-id: loan-full-001" \
  -F "process=loan-appraisal" \
  -F "product_code=hkd-loan" \
  -F "flow=FULL" \
  -F "stop_after_intake=false" \
  -F "files[]=@./ho_so_phap_ly.pdf" \
  -F "files[]=@./de_nghi_vay_von.pdf" \
  -F "webhook_url=https://your-app.example.com/callbacks/loan-appraisal"
```

Webhook `SUCCEEDED` đến khi chạy xong cả giai đoạn 2. Không có `PAUSED`.

---

## 3. Gửi hồ sơ bằng URL thay vì upload file

`file_urls` là chuỗi JSON, tối đa 20 mục. Mỗi mục cần `url`; `filename`, `mime_type`, `file_id`, `total_chunks` là tuỳ chọn.

```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -F "process=loan-appraisal" \
  -F "product_code=hkd-loan" \
  -F "flow=SIMPLE" \
  -F 'file_urls=[{"url":"https://files.example.com/dossier/ho_so_phap_ly.pdf","filename":"ho_so_phap_ly.pdf","mime_type":"application/pdf","file_id":"DOC-001"},{"url":"https://files.example.com/dossier/de_nghi_vay.pdf","filename":"de_nghi_vay.pdf","file_id":"DOC-002"}]' \
  -F "webhook_url=https://your-app.example.com/callbacks/loan-appraisal"
```

Thông tin xác thực để tải URL (nếu cần) cấu hình ở Profile → Integration Auth. Có thể truyền `file_url_auth` (JSON) cho một request, nhưng Profile ưu tiên hơn.

---

## 4. Poll trạng thái và đọc kết quả tiếp nhận

```bash
curl http://localhost:2023/api/v1/operations/OPERATION_ID \
  -H "x-api-key: YOUR_API_KEY"
```

Chỉ đọc được operation do chính Profile (API key) đó tạo; key khác nhận 403.

Khi đang chạy: `done=false`, `metadata.state="RUNNING"`, kèm `progress_percent` và `progress_message`.

Khi dừng sau giai đoạn 1 (`stop_after_intake=true`): `done=false`, `metadata.state="WAITING_USER_INPUT"`, và `result.extracted_data` là kết quả tiếp nhận, trong đó:

```jsonc
{
  "done": false,
  "metadata": { "state": "WAITING_USER_INPUT" },
  "result": {
    "extracted_data": {
      "result_phase": "DOSSIER_INTAKE",
      "intake_assessment": {
        "criteria": [
          { "findings": [ { "code": "..." } ] }
        ]
      }
    }
  }
}
```

Mã `intake_assessment.criteria[].findings[].code` dùng cho `acknowledgements` ở mục 6. Cấu trúc đầy đủ của `intake_assessment` xem spec `docs/loan-appraisal/spec-v3/stages/v2_integration.md`.

**Lưu ý:** webhook `PAUSED` chỉ có `operation_id`, `state`, `done=false`, không kèm dữ liệu. Muốn đọc kết quả tiếp nhận, phải gọi `GET` như trên.

---

## 5. Chuyển sang giai đoạn 2 (resume)

Chỉ gọi được khi operation ở `WAITING_USER_INPUT`; trạng thái khác trả 400.

```bash
curl -X POST http://localhost:2023/api/v1/operations/OPERATION_ID/resume \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response `200`:

```json
{ "success": true, "message": "Resumed successfully" }
```

Body phải là JSON hợp lệ (dùng `{}`). Giai đoạn 2 chạy tiếp từ checkpoint, không chạy lại phân loại và bóc tách. Khi xong, webhook `SUCCEEDED` được gửi.

---

## 6. Chạy lại hồ sơ kèm giải trình (`acknowledgements`)

Dùng sau khi Sale giải trình các điểm "Cần kiểm tra" của lần chạy trước. Thiếu chứng từ bắt buộc thì không giải trình được. Tối đa 200 mục, mỗi `reason` tối đa 500 ký tự.

```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -F "process=loan-appraisal" \
  -F "product_code=hkd-loan" \
  -F "flow=FAST" \
  -F "files[]=@./ho_so_phap_ly.pdf" \
  -F "files[]=@./de_nghi_vay_von.pdf" \
  -F 'acknowledgements=[{"finding_code":"FINDING_CODE_FROM_PREVIOUS_RUN","reason":"Đã đối chiếu bản gốc, hai số CMND/CCCD cùng một người."}]' \
  -F "webhook_url=https://your-app.example.com/callbacks/loan-appraisal"
```

---

## 7. Lấy kết quả cuối cho hệ thống ngoài (`view=integration`)

Chỉ dùng khi `done=true` và `state=SUCCEEDED`.

```bash
curl "http://localhost:2023/api/v1/operations/OPERATION_ID?view=integration" \
  -H "x-api-key: YOUR_API_KEY"
```

`result.extracted_data` có schema `dugate.loan-appraisal.integration` (`schema_version` `5.2`): chỉ kết quả cuối, gồm `case`, `decision`, `extractions` (kết quả OCR theo chứng từ), `financials`, `checks`. Các khối `parties`, `assets`, `documents`, `findings` là tuỳ chọn và vắng khi giai đoạn 2 đang tạm tắt các bước kiểm tra hồ sơ. Không có tiến trình xử lý và không có evidence. Thêm `&include=narrative` để có văn bản diễn giải (`assessment`, chỉ khi có), `&include=labels` để có nhãn hiển thị (`labels`). Đặc tả đầy đủ: `docs/loan-appraisal/INTEGRATION-CONTRACT.md`. Webhook `SUCCEEDED` gửi cùng cấu trúc trong `extracted_data`. Kết quả đầy đủ (kèm evidence, tiến trình) vẫn ở `GET /operations/{id}` không có `view`.

`view=integration` với workflow khác `loan-appraisal` trả 400. Khi Profile bật mã hoá response, đường dẫn `encryption_fields` cụ thể không tồn tại trong cấu trúc này bị từ chối (422); dùng `**.<field>` hoặc mode `full`.

Tải file kết quả:

```bash
curl -L "http://localhost:2023/api/v1/operations/OPERATION_ID/download?view=integration" \
  -H "x-api-key: YOUR_API_KEY" \
  -o loan-appraisal-result.json
```

Trả 409 nếu operation chưa `SUCCEEDED`.

---

## 8. Huỷ operation

```bash
curl -X POST http://localhost:2023/api/v1/operations/OPERATION_ID/cancel \
  -H "x-api-key: YOUR_API_KEY"
```

---

## 9. Webhook nhận về

Hệ thống gọi `POST` tới `webhook_url` với JSON:

```jsonc
// Dừng sau giai đoạn 1 (không kèm dữ liệu, hãy GET operation)
{ "operation_id": "OPERATION_ID", "state": "PAUSED", "done": false }

// Hoàn tất
{ "operation_id": "OPERATION_ID", "state": "SUCCEEDED", "done": true, "extracted_data": { /* dugate.loan-appraisal.integration */ } }

// Lỗi
{ "operation_id": "OPERATION_ID", "state": "FAILED", "done": true, "error": "...", "error_code": "...", "retryable": true }
```

Nên đối chiếu `operation_id` với danh sách đã gửi và xử lý callback theo kiểu idempotent.

---

## 10. Mã lỗi hay gặp khi submit

| HTTP | Nguyên nhân |
|---|---|
| 400 | Thiếu `process`; không có file hoặc `file_urls`; `file_urls`/`file_url_auth` sai JSON; `webhook_url` không hợp lệ hoặc không nằm trong allowlist; multipart sai. |
| 401 | Thiếu hoặc sai `x-api-key`. |
| 403 | Key bị khoá; Profile chưa bật hoặc đã tắt `workflows:loan-appraisal`. |
| 404 | `process` không tồn tại. |
| 429 | Vượt giới hạn request mỗi phút của key. |
| 500 | Cấu hình Profile sai hoặc lỗi hệ thống; kèm mã tham chiếu bằng `x-correlation-id`. |
