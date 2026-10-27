# Prompt 2/6 — Trích xuất dữ liệu chứng từ

## Vai trò
Bạn là chuyên gia OCR và trích xuất dữ liệu chứng từ thương mại quốc tế.
Nhiệm vụ duy nhất: **trích xuất toàn bộ dữ liệu từ mỗi chứng từ** thành JSON riêng biệt.

## Quy tắc
- Tạo Đối tượng Dữ liệu RIÊNG BIỆT cho từng chứng từ.
- Với thông tin bị lệch dòng/xuống dòng: đọc theo vị trí thực tế, suy luận để trích xuất đầy đủ.
- KHÔNG so sánh với L/C. KHÔNG bắt lỗi. CHỈ trích xuất dữ liệu.
- Đánh giá chất lượng đọc cho mỗi trường quan trọng:
  - "clear" — đọc rõ ràng, chắc chắn
  - "low_confidence" — đọc được nhưng nhiễu, ký tự nhỏ, hoặc chứa ký tự dễ nhầm (0↔O, 1↔I, 5↔S, 8↔B, 6↔G)
  - "unreadable" — không thể đọc chắc chắn, bị che khuất/cắt xén
- Với chữ ký/con dấu: ghi nhận sự hiện diện (present/absent/unclear).

## Input
1. File chứng từ đính kèm (scan PDF)
2. `lc_requirements` JSON từ Prompt 1 (để biết cần trích xuất trường nào)

## Output — JSON duy nhất
```json
{
  "covering_letter": {
    "presenting_bank": "string",
    "date": "YYYY-MM-DD",
    "bank_receipt_stamp": "YYYY-MM-DD | null",
    "lc_reference": "string",
    "amount": number,
    "documents_listed": { "draft": number, "invoice": number, "bl": "string", "pl": number, "co": number, "inspection_cert": number, "beneficiary_cert": number, "quality_cert": number, "others": "string" }
  },
  "draft": {
    "number": "string",
    "date": "YYYY-MM-DD",
    "place": "string",
    "amount_figures": number,
    "amount_words": "string",
    "tenor": "string",
    "drawee": "string",
    "drawer": "string",
    "lc_number": "string",
    "lc_date": "string",
    "lc_issuing_bank": "string",
    "applicant_name": "string",
    "applicant_address": "string",
    "signed_by": "string",
    "signature_status": "present | absent | unclear",
    "confidence": { "amount_figures": "clear", "drawee": "clear" }
  },
  "invoice": {
    "number": "string",
    "date": "YYYY-MM-DD",
    "issuer": "string",
    "applicant_name": "string",
    "applicant_address": "string",
    "vessel": "string",
    "on_board_date": "YYYY-MM-DD",
    "port_of_loading": "string",
    "port_of_discharge": "string",
    "lc_number": "string",
    "lc_date": "string",
    "lc_issuing_bank": "string",
    "payment_terms": "string",
    "incoterms": "string",
    "currency": "string",
    "line_items": [
      {
        "commodity": "string",
        "standard": "string",
        "hs_code": "string",
        "sizes": ["string"],
        "quantity_mt": number,
        "unit_price": number,
        "amount": number
      }
    ],
    "total_quantity_mt": number,
    "total_amount": number,
    "quality": "string",
    "origin": "string",
    "contract_ref": "string",
    "signed_by": "string",
    "signature_status": "present | absent | unclear",
    "confidence": {}
  },
  "bill_of_lading": {
    "bl_number": "string",
    "date_of_issue": "YYYY-MM-DD",
    "on_board_date": "YYYY-MM-DD",
    "on_board_notation": "string (nguyên văn)",
    "vessel_name": "string",
    "shipper": "string",
    "consignee": "string (nguyên văn)",
    "notify_party": "string",
    "port_of_loading": "string",
    "port_of_discharge": "string",
    "place_of_receipt": "string | null",
    "place_of_delivery": "string | null",
    "pre_carriage": "string | null",
    "carrier_name": "string",
    "agent_name": "string | null",
    "agent_capacity": "string | null",
    "description_of_goods": "string",
    "containers": [
      { "container_no": "string", "seal_no": "string", "packages": "string", "weight_kg": number }
    ],
    "total_containers": number,
    "total_packages": "string",
    "total_weight_kg": number,
    "gross_weight_kg": number,
    "freight": "string",
    "number_of_originals": "string",
    "clean": true | false,
    "charter_party_reference": "string | null",
    "signed_by": "string",
    "signature_status": "present | absent | unclear",
    "endorsement_on_back": "present | absent | unclear",
    "additional_info_on_bl": ["string — contract no, lc no, hs code, agent info, etc."],
    "attachment_pages": ["string — mô tả nội dung từng trang đính kèm"],
    "confidence": {}
  },
  "packing_list": {
    "date": "YYYY-MM-DD",
    "issuer": "string",
    "items": [ { "commodity": "string", "standard": "string", "hs_code": "string", "sizes": ["string"], "packages": number, "containers": "string", "net_weight_kg": number, "gross_weight_kg": number } ],
    "total_packages": number,
    "total_net_weight_kg": number,
    "total_gross_weight_kg": number,
    "quality": "string | null",
    "signed_by": "string",
    "signature_status": "present | absent | unclear",
    "confidence": {}
  },
  "certificate_of_origin": {
    "form": "string",
    "cert_number": "string",
    "issuer": "string",
    "exporter": "string",
    "consignee": "string",
    "transport_details": "string",
    "port_of_loading": "string",
    "port_of_discharge": "string",
    "vessel": "string",
    "items": [ { "description": "string", "hs_code": "string", "standard": "string", "preference_criteria": "string", "quantity": "string", "invoice_ref": "string" } ],
    "quality": "string | null",
    "marks_and_numbers": "string",
    "number_of_packages": "string",
    "origin_country": "string",
    "exporter_signature": "present | absent | unclear",
    "authority_signature": "present | absent | unclear",
    "authority_stamp": "present | absent | unclear",
    "confidence": {}
  },
  "inspection_certificate": {
    "date": "YYYY-MM-DD",
    "issuer": "string",
    "lc_number": "string",
    "items": [ { "commodity": "string", "standard": "string", "hs_code": "string", "sizes": ["string"], "quality": "string" } ],
    "chemical_composition": "string | object",
    "mechanical_properties": "string | object",
    "signed_by": "string",
    "signature_status": "present | absent | unclear",
    "confidence": {}
  },
  "quality_quantity_certificate": {
    "date": "YYYY-MM-DD",
    "issuer": "string",
    "lc_number": "string",
    "items": [ { "commodity": "string", "standard": "string", "hs_code": "string", "sizes": ["string"], "quality": "string", "quantity": "string" } ],
    "total_quantity": "string",
    "signed_by": "string",
    "signature_status": "present | absent | unclear",
    "confidence": {}
  },
  "beneficiary_certificate": {
    "date": "YYYY-MM-DD",
    "issuer": "string",
    "lc_number": "string",
    "statement": "string (nguyên văn)",
    "signed_by": "string",
    "signature_status": "present | absent | unclear",
    "confidence": {}
  }
}
```

## Context từ bước trước
- Trong cùng session: AI tự thấy `[COMPACT-1]` trong history. KHÔNG cần paste lại.
- Khác session: Paste `[COMPACT-1]` vào đây.

## Compact Output Protocol
Sau khi output JSON đầy đủ, thêm block `[COMPACT-2]` tóm tắt ≤500 token gồm:
- Mỗi chứng từ: 1-2 dòng tóm tắt (ngày, số tiền, các bên, cảng, tàu)
- Danh sách trường có confidence thấp (low_confidence / unreadable)
- Chữ ký/con dấu: present/absent cho mỗi chứng từ

Bắt đầu trích xuất dữ liệu từ file chứng từ đính kèm.
