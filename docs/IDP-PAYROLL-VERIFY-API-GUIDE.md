# API Hướng dẫn tích hợp: Đối chiếu Bảng lương (Payroll Verify)

> **Hệ thống:** SkillHub (DUGate)
> **Workflow:** `payroll-verify`
> **Phiên bản:** 1.0
> **Ngày cập nhật:** 22/04/2026

---

## 1. Tổng quan

Workflow nhận 2 file (1 PDF bảng lương scan + 1 Excel bảng lương gốc), tự động:
1. Download file từ CSP WorkDrive (dùng Bearer token tự lấy)
2. OCR PDF → trích xuất danh sách nhân viên
3. Parse Excel → trích xuất danh sách nhân viên
4. So sánh rule-based → trả kết quả APPROVED hoặc REVIEW_REQUIRED
5. Callback kết quả về IDP qua webhook URL

---

## 2. Gọi API

### Endpoint

```
POST /api/v1/docs/workflows
```

### Headers

| Header | Giá trị | Bắt buộc |
|--------|---------|----------|
| `x-api-key` | API key được cấp bởi SkillHub Admin | ✅ |
| `X-IBM-Client-Id` | Client ID của API Gateway (nếu qua gateway) | Tùy môi trường |

### Form Fields (multipart/form-data)

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `process` | string | ✅ | Luôn là `payroll-verify` |
| `file_urls` | JSON string | ✅ | Mảng 2 file URLs (1 PDF + 1 Excel) |
| `webhook_url` | string | Khuyến nghị | URL callback để nhận kết quả |

> **Lưu ý:** Không cần gửi CSP credentials. SkillHub Admin đã cấu hình sẵn trên server.

---

## 3. CURL mẫu (với dữ liệu thật đã test thành công)

```bash
curl --location --request POST \
  'https://api-int.dev.vpbank.com.vn/ops-rpa/uat/skill-hub/api/v1/docs/workflows' \
  --header 'x-api-key: dg_live_xxxxxxxxxxxxxxxx' \
  --header 'X-IBM-Client-Id: 32f056e41d302277666823b92d9a530f' \
  --form 'process=payroll-verify' \
  --form 'file_urls=[
    {
      "url": "https://api.aws.csp.vpbank.dev/files/v1/inttrial/91c4cde3-5812-4a86-8a44-7e1e5b29e4f5/content?alt=media&checkpoint=1.0",
      "filename": "payment_request_excel.xlsx",
      "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    {
      "url": "https://api.aws.csp.vpbank.dev/files/v1/inttrial/2d3efd3a-1ea6-4750-95dd-db5de225a3e5/content?alt=media&checkpoint=1.0",
      "filename": "payment_request_pdfs.pdf",
      "mime_type": "application/pdf"
    }
  ]' \
  --form 'webhook_url=https://api.aws.csp.vpbank.dev/hook/v1/cases/case-6kKqxPnIy/729df58a-28f1-11f1-bb8a-aa535c5dd91c_case-6kKqxPnIy_729df59c-28f1-11f1-bb8a-aa535c5dd91c'
```

### Chi tiết `file_urls`

Mỗi entry trong mảng gồm:

| Field | Mô tả |
|-------|-------|
| `url` | URL download file từ CSP WorkDrive |
| `filename` | Tên file (phải có đuôi `.pdf` hoặc `.xlsx`) |
| `mime_type` | `application/pdf` hoặc `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |

Hệ thống tự phân loại file nào là PDF, file nào là Excel dựa trên `filename` và `mime_type`.

---

## 4. Response ngay lập tức (HTTP 202 Accepted)

```json
{
  "name": "operations/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "done": false,
  "metadata": {
    "state": "RUNNING",
    "workflow": "payroll-verify",
    "progress_percent": 0,
    "progress_message": "Initializing workflow..."
  }
}
```

Lưu `operations/...` ID để poll tiến độ nếu cần.

---

## 5. Theo dõi tiến độ (tuỳ chọn)

```bash
curl --location \
  'https://api-int.dev.vpbank.com.vn/ops-rpa/uat/skill-hub/api/v1/operations/{OPERATION_ID}' \
  --header 'x-api-key: dg_live_xxxxxxxxxxxxxxxx' \
  --header 'X-IBM-Client-Id: 32f056e41d302277666823b92d9a530f'
```

Response khi đang xử lý:

```json
{
  "name": "operations/a1b2c3d4-...",
  "done": false,
  "metadata": {
    "state": "RUNNING",
    "progress_percent": 45,
    "progress_message": "Bước 1: Xử lý song song PDF + Excel..."
  }
}
```

---

## 6. Kết quả cuối cùng

Kết quả được trả về qua **2 kênh** (cùng format):

### 6a. Webhook callback (tự động)

SkillHub tự POST kết quả về `webhook_url` khi xong:

```
POST {webhook_url}
Authorization: Bearer {auto-fetched-csp-token}
Content-Type: application/json
```

### 6b. Poll GET (thủ công)

Nằm trong `result.extracted_data` khi `done: true`.

### Response format

```json
{
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "skill_code": "payroll-batch-validation",
  "status": "SUCCESS",
  "result": {
    "document_processed": 2,
    "excel_rows": 16,
    "validation_status": "COMPLETED",
    "final_decision": "APPROVED",

    "pdf_extraction": {
      "thong_tin_chung": {
        "thong_tin_ben_de_nghi_chi_luong": {
          "ten_don_vi_de_nghi": "NGUYỄN THỊ HỒNG NHUNG",
          "ma_kh_cif": "1906733",
          "dia_chi_don_vi_de_nghi": "phường Hải Tân, TP Hải Dương",
          "so_dien_thoai": "0967025063"
        },
        "phuong_thuc_chi_luong": {
          "so_tai_khoan_trich_no": "257968162",
          "ngan_hang_chi_ho": "VPBANK",
          "loai_tien": "VND"
        },
        "thong_tin_chi_luong": {
          "tong_so_tien_bang_so": "148.483.000",
          "tong_so_tien_bang_chu": "Một trăm bốn mươi tám triệu...",
          "ngay_lenh_chi": "10/03/2025",
          "noi_dung_thanh_toan": "chuyển tiền tháng 02/2025"
        },
        "thong_ke_tong_quan": {
          "tong_so_nhan_vien": 16,
          "so_nhan_vien_vpbank": 16,
          "so_nhan_vien_ngan_hang_khac": 0
        }
      },
      "danh_sach_trong_vpbank": [
        {
          "stt": 1,
          "ho_ten": "NGUYEN THI HONG NHUNG",
          "so_tai_khoan": "257968162",
          "so_tien": "11.786.000",
          "ngan_hang_thu_huong": "VPBANK",
          "loai_tai_khoan": "vpbank"
        }
      ],
      "danh_sach_ngoai_vpbank": []
    },

    "excel_extraction": {
      "thong_tin_chung": { "..." : "..." },
      "danh_sach_trong_vpbank": [ "..." ],
      "danh_sach_ngoai_vpbank": []
    },

    "comparison_result": {
      "summary": {
        "overall_status": "pass",
        "header_status": "pass",
        "detail_status": "pass",
        "total_source_a_rows": 16,
        "matched_rows": 16,
        "mismatched_rows": 0,
        "missing_in_source_b": 0,
        "extra_in_source_b": 0
      },
      "header_compare": [
        {
          "field_code": "ten_don_vi",
          "compare_mode": "vietnamese_name_normalized",
          "source_a_value": "NGUYỄN THỊ HỒNG NHUNG",
          "source_b_value": "NGUYEN THI HONG NHUNG",
          "normalized_source_a_value": "NGUYEN THI HONG NHUNG",
          "normalized_source_b_value": "NGUYEN THI HONG NHUNG",
          "result": "pass",
          "reason": ""
        },
        {
          "field_code": "tong_tien_bang_so",
          "compare_mode": "number_normalized",
          "source_a_value": "148.483.000",
          "source_b_value": "148,483,000",
          "normalized_source_a_value": "148483000",
          "normalized_source_b_value": "148483000",
          "result": "pass",
          "reason": ""
        }
      ],
      "detail_results": [
        {
          "section_code": "trong_vpbank",
          "detail_status": "pass",
          "detail_compare": [
            {
              "match_key": "257968162",
              "found_in_source_b": true,
              "row_result": "pass",
              "field_results": [
                { "field_code": "ho_ten", "result": "pass" },
                { "field_code": "so_tien", "result": "pass" }
              ]
            }
          ],
          "missing_rows": [],
          "extra_rows": [],
          "summary": {
            "total_source_a_rows": 16,
            "matched_rows": 16,
            "mismatched_rows": 0,
            "missing_in_source_b": 0,
            "extra_in_source_b": 0
          }
        },
        {
          "section_code": "ngoai_vpbank",
          "detail_status": "pass",
          "detail_compare": [],
          "missing_rows": [],
          "extra_rows": [],
          "summary": {
            "total_source_a_rows": 0,
            "matched_rows": 0,
            "mismatched_rows": 0,
            "missing_in_source_b": 0,
            "extra_in_source_b": 0
          }
        }
      ]
    }
  }
}
```

---

## 7. Giá trị `final_decision`

| Giá trị | Ý nghĩa | Hành động IDP |
|---------|---------|---------------|
| `APPROVED` | PDF khớp Excel — tất cả header + detail đều pass | Tự động phê duyệt |
| `REVIEW_REQUIRED` | Có sai lệch giữa PDF và Excel | Chuyển sang kiểm tra thủ công |

---

## 8. Các trường so sánh header

| field_code | Mô tả | Chế độ so sánh |
|------------|-------|----------------|
| `ten_don_vi` | Tên đơn vị đề nghị | Bỏ dấu tiếng Việt, uppercase |
| `ma_kh_cif` | Mã khách hàng CIF | So khớp chính xác |
| `so_dien_thoai` | Số điện thoại | So khớp chính xác |
| `so_tai_khoan_nguon` | Số TK trích nợ | So khớp chính xác |
| `tong_tien_bang_so` | Tổng tiền bằng số | Bỏ dấu chấm/phẩy phân cách |
| `ngay_lenh_chi` | Ngày lệnh chi | So khớp chính xác |
| `noi_dung_thanh_toan` | Nội dung thanh toán | Bỏ dấu, uppercase |
| `tong_so_nhan_vien` | Tổng số nhân viên | Bỏ dấu phân cách |

---

## 9. Các trường so sánh detail (từng nhân viên)

Nhân viên được match bằng `so_tai_khoan`, sau đó so sánh:

| field_code | Mô tả | Chế độ so sánh |
|------------|-------|----------------|
| `ho_ten` | Họ tên nhân viên | Bỏ dấu tiếng Việt, uppercase |
| `so_tien` | Số tiền | Bỏ dấu chấm/phẩy phân cách |
| `ngan_hang` | Ngân hàng thụ hưởng | Bỏ dấu, uppercase |
| `loai_tai_khoan` | Loại TK (vpbank/ngan_hang_khac) | Bỏ dấu, uppercase |

---

## 10. Xử lý lỗi

### Lỗi request (HTTP 4xx)

```json
{
  "type": "https://dugate.vn/errors/missing-files",
  "title": "Missing Files",
  "status": 400,
  "detail": "Workflow requires at least 1 document (upload or file_urls)."
}
```

| HTTP | Nguyên nhân |
|------|-------------|
| 400 | Thiếu `process`, `file_urls` sai format, thiếu file |
| 401 | API key không hợp lệ (hoặc API Gateway chặn) |
| 404 | `process` không tồn tại |

### Lỗi xử lý (webhook callback)

```json
{
  "operation_id": "a1b2c3d4-...",
  "state": "FAILED",
  "done": true,
  "error": "PDF_OCR_ALL_FAILED: Tất cả 3 trang OCR đều thất bại..."
}
```

| Error code | Nguyên nhân |
|------------|-------------|
| `INVALID_INPUT` | Không đúng 1 PDF + 1 Excel |
| `PDF_EMPTY` | PDF không có trang nào |
| `PDF_SPLIT_FAILED` | Không đọc được PDF |
| `PDF_OCR_ALL_FAILED` | Tất cả trang OCR đều lỗi |
| `EXCEL_PARSE_FAILED` | Không nhận dạng được cấu trúc bảng Excel |
| `COMPARE_ERROR` | Lỗi engine so sánh |
| `FILE_URL_DOWNLOAD_FAILED` | Không download được file từ CSP |

---

## 11. Lưu ý quan trọng

1. **File URLs phải accessible** — SkillHub server cần network tới `api.aws.csp.vpbank.dev`
2. **Webhook callback có retry** — Nếu callback fail, SkillHub retry tối đa 3 lần (1s, 2s delay)
3. **Xử lý bất đồng bộ** — API trả 202 ngay, kết quả qua webhook hoặc poll
4. **Thời gian xử lý** — Tùy số trang PDF, thường 30s-120s
5. **Format tương thích N8n** — Response format giữ nguyên cấu trúc `pdf_extraction`, `excel_extraction`, `comparison_result` như hệ thống cũ


---

## 12. Batch 3 callback and Profile integration compatibility

### Callback field name

For every new integration, send **`callback_url`** as the recommended multipart field. `webhook_url` remains a permanently supported legacy alias; existing callers do not need to change immediately.

| Request shape | Result |
|---|---|
| Only `callback_url` | Accepted; preferred form |
| Only `webhook_url` | Accepted; legacy-compatible form |
| Both fields, same URL | Accepted |
| Both fields, different URLs | HTTP 400; caller must remove the ambiguity |

Any earlier `webhook_url` example in this guide remains valid. New callers should substitute `callback_url` in those examples. Callback delivery occurs only when the request or Profile resolves a destination; there is no caller-visible enable/disable toggle.

### Profile UI configuration (Admin-owned)

IDP should normally provide only `process`, `file_urls` and a callback destination. An Admin configures reusable integration credentials in **Profile → Tích hợp**:

- file URL auth: bearer, header, query, CSP OAuth2 or OAuth2 client credentials;
- gateway headers with configurable names (for example legacy `X-IBM-Client-Id` or an APIC-specific name); headers are applied to token, file-download and callback requests;
- callback URL, callback auth, `WITH_RESULT` payload mode, and optional URL lock;
- endpoint/sub-case overrides for file auth, callback URL/payload and default chunks.

Saved secret values are masked and must not be copied back into an IDP request. The effective endpoint integration field falls back exact endpoint → service endpoint → Profile when the more-specific field is unset. Profile Payroll `csp_*` parameters remain a compatible legacy source for the live Payroll flow.

### `file_urls` validation and security

When present, `file_id` must be a string and `total_chunks` must be an integer of at least 1. Credentialed file downloads require the configured file origin to be allowed by deployment policy; a request outside `ALLOWED_FILE_AUTH_ORIGINS` is blocked before credentials are attached. Do not put Vault paths, tokens or gateway-header values in application logs or support tickets.
