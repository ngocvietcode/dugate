# Tích hợp Loan Dossier cho hệ thống ngoài

> **Nền v2 (D-32, 2026-10-16):** phần W1/W2, `OcrOutput`/`CheckInput`, bản vá, ngưỡng tự động và giao diện `/loan-dossier` trong file này **không áp dụng**. Kiến trúc chuẩn: [cross_cutting/v2_integration.md](cross_cutting/v2_integration.md).

Luồng không lưu trạng thái giữa hai lần gọi (D-25): hệ thống ngoài gọi **hai workflow độc lập** qua route sẵn có
`POST /api/v1/docs/workflows`. Mọi dữ liệu mẫu dưới đây là giả (`NGUYEN VAN A`, `000000000000`, `BS000000`).
Quy tắc nguồn: `cross_cutting/api.md` (A-R01…A-R08) và `04_data_model.md`.

## 1. Luồng gọi

1. **W1** `loan-dossier-ocr`: gửi các tệp hồ sơ → nhận `OcrOutput` (phân loại, trích xuất, việc cần rà soát, gợi ý điền form).
2. Hệ thống ngoài tự lưu `OcrOutput`, cho người dùng sửa OCR và xác nhận thông tin khách hàng. DUGate **không** giữ bản nháp.
3. **W2** `loan-dossier-check`: gửi **đúng 1 tệp** `check_input.json` (`CheckInput`) → nhận `CheckOutput` (S3–S6).

## 2. Gọi W1

```bash
curl -X POST "$DUGATE_URL/api/v1/docs/workflows" \
  -H "X-API-Key: $DUGATE_API_KEY" \
  -F "process=loan-dossier-ocr" \
  -F "flow=FULL" \
  -F "dossier_submitted_at=2026-10-14" \
  -F "files[]=@don-vay.pdf" \
  -F "files[]=@cccd.jpg"
```

Tham số form chỉ có `flow`, `dossier_submitted_at` (tùy chọn) và `upload_hints` (tùy chọn, JSON mảng cùng số phần tử với `files[]`).
Không bao giờ đưa dữ liệu cá nhân vào tham số form.

## 3. Gọi W2

```bash
curl -X POST "$DUGATE_URL/api/v1/docs/workflows" \
  -H "X-API-Key: $DUGATE_API_KEY" \
  -F "process=loan-dossier-check" \
  -F "files[]=@check_input.json;type=application/json"
```

## 4. Lấy kết quả

Poll `GET /api/v1/operations/{id}` mỗi 2 s (tuần tự, chờ phản hồi trước rồi mới gọi tiếp) đến khi `done = true`; hoặc dùng webhook.
Kết quả nằm ở `result.extracted_data`; `extracted_data.contract` cho biết đó là `OcrOutput` hay `CheckOutput`.
Kết quả chỉ đọc được trong thời gian giữ nội dung của Operation (mặc định 7 ngày): hãy tự lưu.

## 5. Ví dụ `OcrOutput` (đầu ra W1)

```json
{
  "contract": "dugate.loan-dossier.ocr",
  "contract_version": "1",
  "flow": "FULL",
  "dossier_submitted_at": "2026-10-14",
  "stages": {
    "classify": {
      "stage_key": "classify",
      "status": "SUCCESS",
      "status_code": "COMPLETED",
      "message": "Đã phân loại xong.",
      "started_at": "2026-10-14T03:00:00.000Z",
      "finished_at": "2026-10-14T03:00:05.000Z",
      "content_preview": { "file_count": 1, "classified_count": 1, "unknown_count": 0, "blocked_count": 0, "match_count": 1 },
      "data": {
        "files": [
          {
            "file_id": "file-0a1b2c3d4e5f",
            "file_name": "don-vay.pdf",
            "status": "CLASSIFIED",
            "reason_code": null,
            "next_action": null,
            "message": null,
            "page_count": 2,
            "matches": [
              {
                "doc_type_key": "loan_application",
                "confidence": 0.93,
                "needs_manual_review": false,
                "needs_extraction": true,
                "instances_count": 1,
                "hint_mismatch": false,
                "instances": [{ "instance_index": 1, "page_range": [1, 2], "confidence": 0.93 }]
              }
            ]
          }
        ],
        "repeated_doc_types": []
      },
      "blocking_inputs": []
    },
    "extract_evidence": {
      "stage_key": "extract_evidence",
      "status": "SUCCESS",
      "status_code": "COMPLETED",
      "message": "Đã trích xuất xong.",
      "started_at": "2026-10-14T03:00:05.000Z",
      "finished_at": "2026-10-14T03:00:20.000Z",
      "content_preview": { "evidence_count": 1, "success_count": 1, "error_count": 0, "duplicate_group_count": 0 },
      "data": {
        "evidences": [
          {
            "evidence_id": "ev-0a1b2c3d4e5f",
            "file_id": "file-0a1b2c3d4e5f",
            "file_name": "don-vay.pdf",
            "doc_type_key": "loan_application",
            "doc_type_label": "Giấy đề nghị vay vốn",
            "instance_index": 1,
            "page_range": [1, 2],
            "status": "SUCCESS",
            "reason_code": null,
            "message": null,
            "detected_form_name": null,
            "form_variant": null,
            "schema_version": "3.0.0",
            "data": {
              "legal_info": null,
              "parties": [
                {
                  "party_index": 0,
                  "party_role": "BORROWER",
                  "party_role_raw": null,
                  "party_type": "INDIVIDUAL",
                  "full_name": "NGUYEN VAN A",
                  "id_number": "000000000000",
                  "id_type": "CCCD",
                  "id_issue_date": "2021-01-01",
                  "id_issue_place": null,
                  "previous_id_numbers": [],
                  "date_of_birth": "1990-08-15",
                  "gender": "MALE",
                  "nationality": null,
                  "permanent_address": null,
                  "current_address": null,
                  "phone_number": null,
                  "tax_id": null,
                  "representative_name": null,
                  "representative_position": null,
                  "ownership": null
                }
              ],
              "assets": [],
              "loan_info": { "requested_amount": 500000000, "bank_proposed_amount": 500000000, "loan_term_months": 60, "loan_purpose_detail": "Bo sung von kinh doanh" }
            },
            "field_confidences": { "parties": 0.97, "loan_info": 0.96 },
            "source_pages": { "parties": 1, "loan_info": 2 },
            "duplicate_group_id": null,
            "duplicate_status": null,
            "differing_fields": []
          }
        ]
      },
      "blocking_inputs": []
    }
  },
  "review_issues": [],
  "suggestions": {
    "persons": [
      {
        "sl_role": "borrower",
        "fields": {
          "full_name": { "value": "NGUYEN VAN A", "evidence_id": "ev-0a1b2c3d4e5f", "field_path": "data.parties[0].full_name", "page": 1, "file_name": "don-vay.pdf", "confidence": 0.97 }
        }
      }
    ],
    "assets": [],
    "loan": {},
    "no_application": false
  },
  "auto_eval": { "enabled": false, "eligible": false, "threshold": 0.95, "observed_min_confidence": null, "reasons": [] }
}
```

## 6. Ví dụ `CheckInput` (nội dung `check_input.json`, đầu vào W2)

`classify` và `evidences` lấy từ `OcrOutput.stages.*.data`; `field_edits` là các chỗ người dùng đã sửa OCR; `confirmation` là form xác nhận
(`confirmation_mode = "RM"`) hoặc `null` khi `confirmation_mode = "AUTO"`. Hệ thống ngoài chịu trách nhiệm về tính toàn vẹn của `evidences`
(DUGate không ký số, D-26).

```json
{
  "contract": "dugate.loan-dossier.check-input",
  "contract_version": "1",
  "flow": "FULL",
  "dossier_submitted_at": "2026-10-14",
  "confirmation_mode": "RM",
  "classify": {
    "files": [
      {
        "file_id": "file-0a1b2c3d4e5f",
        "file_name": "don-vay.pdf",
        "status": "CLASSIFIED",
        "reason_code": null,
        "next_action": null,
        "message": null,
        "page_count": 2,
        "matches": [
          {
            "doc_type_key": "loan_application",
            "confidence": 0.93,
            "needs_manual_review": false,
            "needs_extraction": true,
            "instances_count": 1,
            "hint_mismatch": false,
            "instances": [{ "instance_index": 1, "page_range": [1, 2], "confidence": 0.93 }]
          }
        ]
      }
    ],
    "repeated_doc_types": []
  },
  "evidences": [],
  "field_edits": [],
  "confirmation": {
    "schema_version": "1",
    "customer": {
      "cif": null,
      "phone": "0900000000",
      "business_address": null,
      "premises_ownership": "OWNED",
      "has_signboard": true,
      "note": null
    },
    "persons": [
      {
        "block_ref": "sl-p1",
        "sl_role": "borrower",
        "fields": {
          "full_name": { "value": "NGUYEN VAN A", "origin": "RM_INPUT" },
          "id_number": { "value": "000000000000", "origin": "OCR_ACCEPTED" }
        },
        "contact": { "phone": "0900000000", "email": null }
      }
    ],
    "business": null,
    "assets": [],
    "collateral_status": "NONE",
    "loan": {
      "fields": {
        "loan_amount": { "value": 500000000, "origin": "RM_INPUT" },
        "loan_term_months": { "value": 60, "origin": "RM_INPUT" }
      },
      "disbursement_method": "TRANSFER",
      "personal_guarantee": false
    },
    "external_input": { "has_deviation": false, "deviation_code": null, "collateral_mortgaged_elsewhere": null },
    "rm_commitment": true
  }
}
```

## 7. Ví dụ `CheckOutput` khi chạy tự động bị từ chối (đầu ra W2)

Khi `confirmation_mode = "AUTO"` mà Profile tắt chế độ tự động, W2 trả `AUTO_NOT_ALLOWED` và `stages = null`
(Operation vẫn `SUCCEEDED`, vì đây là kết quả nghiệp vụ, không phải lỗi). Khi chạy xong, `check_status = "COMPLETED"` và `stages` có đủ
`map_dossier_roles`, `check_checklist`, `cross_check_documents`, `compare_ocr_sl`, mỗi stage có `status`, `status_code`, `content_preview`, `data`.

```json
{
  "contract": "dugate.loan-dossier.check",
  "contract_version": "1",
  "check_status": "AUTO_NOT_ALLOWED",
  "flow": "FULL",
  "dossier_submitted_at": "2026-10-14",
  "confirmation_mode": "AUTO",
  "auto_eval": { "enabled": false, "eligible": false, "threshold": 0.95, "observed_min_confidence": null, "reasons": [] },
  "edit_report": { "applied": [], "skipped": [] },
  "external_input": null,
  "stages": null
}
```

## 8. Mã lỗi

Lỗi đầu vào được phát hiện ở worker làm Operation `FAILED` với `error.code = INPUT_INVALID`, `retryable = false`. `error.message` của
`GET /api/v1/operations/{id}` có dạng `Workflow input could not be processed. — INVALID_INPUT: <MÃ> — <đường dẫn>`: **mã riêng của luồng
nằm giữa chuỗi**, tìm bằng biểu thức `\b(INVALID_OCR_INPUT|INVALID_CHECK_INPUT|UNSUPPORTED_CONTRACT_VERSION|STAGE_RUNNER_MISCONFIGURED|OUTPUT_CONTRACT_VIOLATION)\b`.
Thông điệp không chứa giá trị dữ liệu. **Webhook `FAILED` không có mã luồng** (chỉ `error` chung, `error_code`, `retryable`): muốn biết mã thì gọi
`GET /api/v1/operations/{id}`. Kết quả nghiệp vụ xấu (thiếu giấy tờ, lệch dữ liệu…) **không** làm `FAILED`: đọc `status` của từng stage.

Lỗi ở route (trước khi có Operation): thiếu file → 400 `Missing Files`; gửi `auto_check_*` → 400 `Forbidden Field`; đuôi file không được phép
→ 500 `Failed to save uploaded file` (lọc đuôi trước khi gửi); endpoint chưa bật → 403 `Endpoint Not Configured`.

| Mã luồng (trong `error.message`) | `error.code` | Nơi phát | Ý nghĩa |
|---|---|---|---|
| `INVALID_OCR_INPUT` | `INPUT_INVALID` | W1 | Thiếu `flow`, `upload_hints` lệch số file, quá 100 file, file > 50 MB |
| `INVALID_CHECK_INPUT` | `INPUT_INVALID` | W2 | Số file khác 1, không phải JSON, `CheckInput` sai schema, form RM chưa hợp lệ |
| `UNSUPPORTED_CONTRACT_VERSION` | `INPUT_INVALID` | W2 | `contract_version` không nhận biết |
| `STAGE_RUNNER_MISCONFIGURED` | `SYSTEM_ERROR` | W1, W2 | Bật giả lập ở production (F-R04) |
| `OUTPUT_CONTRACT_VIOLATION` | `SYSTEM_ERROR` | W1, W2 | Đầu ra vi phạm hợp đồng (lỗi của DUGate) |
