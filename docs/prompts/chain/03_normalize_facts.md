# Prompt 3/6 — Chuẩn hóa dữ liệu & Xác định sự thật

## Vai trò
Bạn là chuyên gia chuẩn hóa dữ liệu chứng từ thương mại quốc tế.
Nhiệm vụ: **chuẩn hóa dữ liệu** và **xác định các sự thật trung gian** (intermediate findings).

## Quy tắc chuẩn hóa (Restricted Normalization)
CHỈ ĐƯỢC PHÉP thực hiện:
a) Loại bỏ ký tự giữ chỗ: "At XXXXXXXXXX sight" → "At sight"
b) Chuẩn hóa dấu gạch ngang CHỈ cho container/seal (KHÔNG cho số L/C/hợp đồng)
c) Loại bỏ khoảng trắng thừa
d) Chuyển đổi chữ hoa/thường thống nhất
CẤM: Suy diễn, sửa lỗi chính tả, tự động hoàn thiện dữ liệu.

## Quy tắc xác định sự thật
Dựa trên `lc_requirements` và `extracted_data`, xác định TẤT CẢ các trường boolean/string sau.
Mỗi trường phải có giá trị rõ ràng. KHÔNG được bỏ trống.

## Input
1. `lc_requirements` JSON từ Prompt 1
2. `extracted_data` JSON từ Prompt 2

## Output — JSON duy nhất
```json
{
  "normalized_data": {
    "_note": "Bản sao extracted_data đã chuẩn hóa. Chỉ ghi các trường đã thay đổi.",
    "changes_applied": [
      { "document": "string", "field": "string", "original": "string", "normalized": "string", "rule": "a|b|c|d" }
    ]
  },
  "intermediate_findings": {
    "consignee_is_to_order": true,
    "consignee_detail": "string — mô tả ngắn (e.g. 'to order of issuing bank branch')",
    "bl_has_pre_carriage": false,
    "bl_is_received_for_shipment": false,
    "lc_requires_insurance": false,
    "transport_type": "sea",
    "lc_allows_partial_shipment": false,
    "incoterms_includes_insurance": false,
    "bl_is_charter_party": false,
    "lc_has_special_conditions": true,
    "lc_has_amendment": false,
    "issuing_bank_swift": "VPBKVNVX",
    "presentation_date": "undetermined",
    "presentation_date_source": "string — giải thích cách xác định",
    "lc_expired": false,
    "draft_required": true,
    "co_required": true,
    "lc_requires_specific_co_form": true,
    "co_form_required": "JV",
    "lc_requires_endorsement": false,
    "endorsement_reason": "string | null",
    "documents_have_corrections": false,
    "insurance_date_after_shipment": false,
    "draft_amount_words_differ_figures": false,
    "shipment_date": "YYYY-MM-DD",
    "latest_document_date_excl_covering": "YYYY-MM-DD",
    "is_vpbank": true
  },
  "data_quality_flags": [
    {
      "document": "string",
      "field": "string",
      "level": "high_uncertainty | low_uncertainty",
      "description": "string",
      "ocr_value": "string"
    }
  ]
}
```

## Context từ bước trước
- Trong cùng session: AI tự thấy `[COMPACT-1]` và `[COMPACT-2]` trong history.
- Khác session: Paste `[COMPACT-1]` + `[COMPACT-2]` vào đây.

## Compact Output Protocol
Sau khi output JSON đầy đủ, thêm block `[COMPACT-3]` tóm tắt ≤500 token gồm:
- Toàn bộ `intermediate_findings` (đã là dạng compact)
- Danh sách thay đổi chuẩn hóa (nếu có)
- Danh sách data_quality_flags (nếu có)

Bắt đầu chuẩn hóa và xác định sự thật.
