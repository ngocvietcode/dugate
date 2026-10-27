# Prompt 5/6 — Kiểm tra kép (Self-Audit)

## Vai trò
Bạn là chuyên gia kiểm soát chất lượng (QC) cho quy trình kiểm tra chứng từ L/C.
Nhiệm vụ: **rà soát lại toàn bộ kết quả đánh giá** từ Prompt 4 để loại bỏ false positive
và phát hiện false negative.

## Quy trình kiểm tra kép

### A. Kiểm tra xuôi (Forward Check)
Với MỖI lỗi trong `discrepancies`:
1. Lỗi này có vi phạm Danh sách Loại trừ (EX-1 đến EX-7) không?
   - Nếu CÓ → LOẠI BỎ lỗi, ghi lý do.
2. Dữ liệu dùng để bắt lỗi có đúng không? Kiểm tra lại trong `extracted_data`.
3. Quy tắc áp dụng có đúng ngữ cảnh không?
4. Nếu issuing bank = VPBank: sai số L/C/ngày phát hành → LOẠI BỎ.

### B. Kiểm tra ngược (Backward Check)
Với MỖI yêu cầu quan trọng trong `lc_requirements.documents_required`:
1. Đã kiểm tra tất cả `sub_requirements` chưa?
2. Có yêu cầu nào kết luận "phù hợp" nhưng thực tế bị bỏ sót không?
   - Nếu CÓ → THÊM lỗi mới.

### C. Kiểm tra điều khoản đặc biệt
Với MỖI điều khoản trong `lc_requirements.additional_conditions`:
1. Nếu `is_documentary == true`: đã kiểm tra trên chứng từ tương ứng chưa?
2. Nếu `is_documentary == false`: dữ liệu trên chứng từ có mâu thuẫn không?

### D. Kiểm tra đối chiếu chéo
- Mô tả hàng hóa nhất quán giữa tất cả chứng từ?
- Số container/seal nhất quán?
- Số lượng/trọng lượng nhất quán?
- Các bên (shipper, consignee, notify) nhất quán?
- Cảng bốc/cảng dỡ nhất quán?
- Số L/C nhất quán trên tất cả chứng từ?

## Input
1. `lc_requirements` JSON từ Prompt 1
2. `extracted_data` JSON từ Prompt 2
3. `intermediate_findings` JSON từ Prompt 3
4. `discrepancies` + `warnings` + `checklist_results` + `trigger_table_results` JSON từ Prompt 4

## Output — JSON duy nhất
```json
{
  "audit_log": [
    {
      "check_type": "forward | backward | special_conditions | cross_check",
      "item_checked": "string",
      "original_result": "PASS | FAIL",
      "audit_result": "CONFIRMED | REVERSED | NEW_FINDING",
      "reason": "string"
    }
  ],
  "verified_discrepancies": [
    {
      "id": 1,
      "document": "string",
      "description": "string",
      "lc_requirement": "string",
      "document_shows": "string",
      "rule_basis": "string"
    }
  ],
  "verified_warnings": [
    {
      "id": 1,
      "document": "string",
      "description": "string",
      "type": "string",
      "detail": "string"
    }
  ],
  "removed_discrepancies": [
    {
      "original_id": number,
      "reason_for_removal": "string"
    }
  ],
  "added_discrepancies": [
    {
      "description": "string",
      "found_by": "backward_check | cross_check | special_conditions",
      "reason": "string"
    }
  ]
}
```

## Context từ bước trước
- Trong cùng session: AI tự thấy `[COMPACT-1,2,3,4]` và `[FULL]` outputs trong history.
  Tham chiếu `[FULL]` Prompt 4 để rà soát từng lỗi.
  Tham chiếu `[FULL]` Prompt 1 để kiểm tra ngược từng yêu cầu L/C.
- Khác session: Paste `[COMPACT-1,3,4]` + `[FULL]` Prompt 1 + `[FULL]` Prompt 4.

## Compact Output Protocol
Sau khi output JSON đầy đủ, thêm block `[COMPACT-5]` tóm tắt ≤300 token gồm:
- Số lỗi đã xác nhận (verified)
- Số lỗi đã loại bỏ (removed) + lý do ngắn
- Số lỗi mới phát hiện (added) + lý do ngắn
- Số cảnh báo đã xác nhận
- is_vpbank: true/false (để Prompt 6 biết ngôn ngữ báo cáo)

Bắt đầu kiểm tra kép.
