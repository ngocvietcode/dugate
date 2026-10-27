# U3 — Giai đoạn 1: Xác nhận thông tin khách hàng và chạy kiểm tra

> **Nền v2 (D-32, 2026-10-16):** giao diện `/loan-dossier` **không làm**; giao diện là `/loan-appraisal-v2` theo V2-R10 ở [cross_cutting/v2_integration.md](../cross_cutting/v2_integration.md). Giữ file để tra cứu.

Thẻ cuối của tab Giai đoạn 1 (U2 §1), dáng `Card` của kit v2. RM rà soát và bổ sung thông tin nghiệp vụ **trước khi** gửi W2 (S3–S6). Form chỉ nằm trong bộ nhớ trang (D-25); không có lưu nháp ở server.

Dữ liệu RM nhập ở đây có hai vai trò:

1. **`sl_input`** cho S6: giá trị phía "SL" để so với OCR (xem S6 §2).
2. **`external_input`** cho S4: 3 giá trị mà OCR không cung cấp (`loan_amount`, `deviation_code`, `collateral_mortgaged_elsewhere`).

**Ngưỡng tự động (U3-R13…R16):** nếu Profile bật và hồ sơ đạt ngưỡng, RM có thể chạy kiểm tra **không cần điền form** (`confirmation_mode = AUTO`). Mặc định tắt.

## 1. Bố cục: 7 mục (rút gọn từ 9 mục của BU)

```text
┌ ✎ Xác nhận thông tin khách hàng   [Gợi ý từ OCR: 12 trường]  [Nhận tất cả] ┐
│ ⓘ Giá trị nhận từ gợi ý OCR không được dùng để đối chiếu OCR ↔ SL.         │
│ ▸ 1 Thông tin chung khách hàng                                              │
│ ▾ 2 Người vay            Họ và tên [NGUYEN VAN A] [Nhận] □ Không có trên CT │
│ ▸ 3 Đồng vay và người liên quan   ▸ 4 Hoạt động kinh doanh                 │
│ ▸ 5 Tài sản bảo đảm      ▸ 6 Phương án cấp tín dụng   ▸ 7 Cam kết của RM    │
│ ⚠ Còn 2 trường bắt buộc chưa điền  [Tới trường đầu tiên]                    │
│ ┌ Ngưỡng tự động: đạt (0.97 / 0.95) ─ [Chạy kiểm tra tự động, bỏ qua form] ┐│
└─────────────────────────────────────────────────────────────────────────────┘
```

Mỗi mục là một `Disclosure` của kit v2. Nút chạy chính vẫn ở cột trái ("Chạy kiểm tra hồ sơ", U1-R06).

| # | Mục U3 | Mục BU tương ứng | Dùng cho |
|--:|---|---|---|
| 1 | Thông tin chung khách hàng | 1 | Hiển thị, CIF, điện thoại |
| 2 | Người vay | 2 | S6 (vai `borrower`) |
| 3 | Đồng vay và người liên quan | 2, 3 | S6 (vai `co_borrower`) |
| 4 | Hoạt động kinh doanh | 6 | Chỉ ghi nhận, **không** so sánh (BRD 09/10/2026: không so nguồn thu) |
| 5 | Tài sản bảo đảm | 7 | S6 (vai `collateral_owner`, tài sản), S4 |
| 6 | Phương án cấp tín dụng | 8 | S6 (`loan_*`), S4 |
| 7 | Cam kết của RM | 9 | Điều kiện gửi |

**Bỏ khỏi U3** (có trong form BU): "lãnh đạo điều hành", "thành viên/cổ đông góp vốn", "nội bộ nhóm khách hàng" — thông tin pháp nhân (OQ-01).

**Thêm so với BU:** `deviation_code`, `collateral_mortgaged_elsewhere` (S4 cần, OQ-03), và số GCN, số thửa, số tờ bản đồ, biển số, số khung, số máy (S6 cần để so với OCR).

## 2. Cấu trúc `ConfirmationPayload`

```json
{
  "schema_version": "1",
  "customer": { "cif": null, "phone": "0900000000", "business_address": {"full_text": "…", "province": "…", "district": null, "ward": "…", "street": "…"},
                "premises_ownership": "OWNED", "has_signboard": true, "note": null },
  "persons": [
    { "block_ref": "sl-p1", "sl_role": "borrower",
      "fields": {
        "full_name":   { "value": "NGUYEN VAN A", "origin": "RM_INPUT" },
        "id_number":   { "value": "000000000000", "origin": "OCR_ACCEPTED" },
        "gender":      { "value": null, "origin": "RM_INPUT", "marked_not_on_document": true }
      },
      "contact": { "phone": "0900000000", "email": null } }
  ],
  "business": { "main_industry": "…", "employee_count": 3, "note": null },
  "assets": [
    { "block_ref": "sl-a1", "owner_block_ref": "sl-p1",
      "fields": { "asset_type": { "value": "REAL_ESTATE", "origin": "RM_INPUT" },
                  "certificate_number": { "value": "BS000000", "origin": "RM_INPUT" } } }
  ],
  "collateral_status": "FULL",
  "loan": { "fields": { "loan_amount": { "value": 500000000, "origin": "RM_INPUT" },
                        "loan_term_months": { "value": 60, "origin": "RM_INPUT" },
                        "loan_purpose_detail": { "value": "…", "origin": "RM_INPUT" } },
            "disbursement_method": "TRANSFER", "personal_guarantee": false },
  "external_input": { "has_deviation": false, "deviation_code": null, "collateral_mortgaged_elsewhere": false },
  "rm_commitment": true
}
```

- Khối `persons[].fields`, `assets[].fields`, `loan.fields` **đúng cấu trúc `sl_input` của S6** (key ∈ `sl_fields.json`, `origin` ∈ `FormValueSource`). `toSlInput` chỉ thêm `source: "FORM"`.
- `persons[].contact`, `customer`, `business`, `disbursement_method`, `personal_guarantee`, `collateral_status` **không** vào S6.
- `has_deviation` + `deviation_code` → `external_input.deviation_code`: `has_deviation = false` → `""`; `true` → mã khác rỗng; chưa chọn → `null`.

## 3. Rule

| ID | Rule |
|---|---|
| **U3-R01** | Thẻ hiện khi W1 `succeeded`. Lần đầu: form rỗng (`emptyPayload`) và **gợi ý** lấy từ `suggestions` của W1, tính lại trên evidence đã áp bản vá (T-U3-04). Gửi lại W1 → gợi ý cập nhật, giá trị RM đã nhập giữ nguyên |
| **U3-R02** | Mỗi ô thuộc `sl_fields.json` mang `origin`. Gõ tay → `RM_INPUT`. Bấm **Nhận**/**Nhận tất cả** → `OCR_ACCEPTED`. Sửa một giá trị đã nhận → `RM_INPUT`. Giá trị `OCR_ACCEPTED` bị S6 coi là `NOT_APPLICABLE`/`SL_VALUE_FROM_OCR`; dòng `ⓘ` đầu thẻ cảnh báo điều này |
| **U3-R03** | Gợi ý (chỉ để điền sẵn, **không** thay S3): chỉ đọc evidence `loan_application` `SUCCESS`; tách `data.parties[]` theo `party_role`: `BORROWER` → `persons` vai `borrower`; `CO_BORROWER` → `co_borrower`; `COLLATERAL_OWNER` → `collateral_owner` (gắn tài sản qua `data.assets[]`); thông tin vay từ `data.loan_info` (`bank_proposed_amount`, `loan_term_months`, `loan_purpose_detail`). Chưa nhận thì ô để trống, gợi ý hiện cạnh ô kèm nguồn (tên tệp, trang). Không có `loan_application` → không gợi ý, hiện thông báo |
| **U3-R04** | **"Không có trên chứng từ"** cho từng ô thuộc `sl_fields.json` (`marked_not_on_document = true`, giá trị `null`). Ô trống mà không đánh dấu → S6 ghi `SL_VALUE_MISSING` |
| **U3-R05** | Trường bắt buộc khi gửi `RM`: `customer.phone`; ≥ 1 người vai `borrower` có `full_name` và `id_number`; mỗi người vai khác có `full_name`; `loan.loan_amount` > 0; `collateral_status`; nếu `collateral_status ≠ NONE` thì ≥ 1 tài sản có `asset_type`; mọi tài sản có `owner_block_ref` trỏ đến một người trong `persons`; `external_input.has_deviation` đã chọn (và `deviation_code` khác rỗng nếu `true`); `external_input.collateral_mortgaged_elsewhere` đã chọn khi có tài sản; `rm_commitment = true` |
| **U3-R06** | Kiểm giá trị theo `value_type` của `sl_fields.json` bằng `validateEditValue` (T-U2-04): ngày, tiền (số nguyên VND ≥ 0), số định danh (CMND 9 / CCCD 12 số, giữ số 0 đầu), địa chỉ |
| **U3-R07** | Thêm/bớt khối: tối đa 5 người và 10 tài sản. Xóa người đang được tài sản tham chiếu → chặn và nêu tài sản. Người đầu tiên vai `borrower` không xóa được |
| **U3-R08** | **Không lưu nháp.** Form chỉ trong bộ nhớ; không `localStorage`/`sessionStorage`/server. Rời trang khi có form chưa gửi → `beforeunload` (U1-R12). Tải lại trang thì form mất (thông báo ở U1-R11) |
| **U3-R09** | **Chạy kiểm tra hồ sơ** (nút chính cột trái, U1-R06): kiểm U3-R05 ở client; lỗi → khung `warning` cuối thẻ "Còn {n} trường bắt buộc chưa điền" + "Tới trường đầu tiên", mở `Disclosure` chứa ô lỗi, **không** gửi. Hợp lệ → dựng `CheckInput` (`confirmation_mode = RM`, `classify`/`evidences` nguyên từ W1, `field_edits` từ kho bản vá, `confirmation` = form) và gửi W2. Có mục `BLOCK` ở "Việc cần hoàn tất" → hộp xác nhận liệt kê các mục đó trước khi gửi (không chặn cứng) |
| **U3-R10** | Gửi lại W2 sau khi sửa form hoặc bản vá: một W2 mới với toàn bộ dữ liệu hiện tại; kết quả cũ thay khi W2 mới xong (U4-R15) |
| **U3-R11** | Khi W1 hoặc W2 đang chạy: mọi ô chỉ đọc, nút Nhận khóa |
| **U3-R12** | PII không vào `console`, URL, `title`. Số định danh hiển thị đầy đủ trong ô nhập nhưng che bớt ở các chỗ tóm tắt (4 số cuối, `maskId`) |
| **U3-R13** | **Chạy tự động.** Tham số Profile `auto_check_enabled` (mặc định `false`) và `auto_check_min_confidence` (mặc định `0.95`, [0.80, 1.00]). Khi `auto_eval.enabled` và `auto_eval.eligible` (tính ở client trên evidence đã áp bản vá), thẻ hiện khung "Ngưỡng tự động: đạt ({observed} / {threshold})" và nút **Chạy kiểm tra tự động, bỏ qua form** → hộp xác nhận ("Kết quả sẽ thiếu mã ngoại lệ và tình trạng TSBĐ; bảng OCR ↔ SL không có giá trị đối chiếu độc lập") → gửi W2 với `confirmation_mode = AUTO`, `confirmation = null` |
| **U3-R14** | **Tiêu chí đạt ngưỡng** — thỏa **tất cả**, trên evidence đã áp bản vá: ① Profile bật; ② không có mục `BLOCK` (T-U2-03); ③ không có nhóm `CONFLICTING_DUPLICATES`; ④ có ≥ 1 evidence `loan_application` `SUCCESS`; ⑤ gợi ý (T-U3-04) có ≥ 1 người `borrower` với `full_name` và `id_number`; ⑥ `observed_min_confidence` ≥ ngưỡng, tính trên (a) `confidence` của mọi `match` `needs_extraction = true` ở S1 và (b) `field_confidences` cấp 1 của mọi giá trị đang được gợi ý; field đã sửa tính 1.0; so sánh `≥`. Kết quả `auto_eval = {enabled, eligible, threshold, observed_min_confidence, reasons[]}`, không chứa giá trị field. W1 tính trên OCR gốc; client tính lại sau mỗi lần sửa; **W2 tính lại lần cuối và là bên quyết định** (F-R09) |
| **U3-R15** | **Bản xác nhận tự động** (W2 dựng, T-U3-10): `persons`, `assets`, `loan.fields` lấy từ gợi ý, mọi ô `origin = OCR_ACCEPTED`; `customer`, `business`, `contact` để `null`; `external_input.has_deviation`, `deviation_code`, `collateral_mortgaged_elsewhere` = `null` (`loan_amount` lấy từ OCR); `rm_commitment = false`. Hệ quả có chủ ý: S4 điều kiện phụ thuộc hai đầu vào `null` ra `INPUT_NOT_PROVIDED`; S6 mọi dòng `NOT_APPLICABLE`/`SL_VALUE_FROM_OCR` (S6-R17) |
| **U3-R16** | Không đạt (Profile bật) → khung `warning` "Chưa đạt ngưỡng tự động" liệt kê `reasons[]` tiếng Việt (mã `AUTO_*`) cùng `observed_min_confidence` và ngưỡng; không có nút chạy tự động. W2 trả `AUTO_NOT_ALLOWED`/`AUTO_NOT_ELIGIBLE` → hiện khung này theo `auto_eval` của W2 và toast "Hồ sơ chưa đủ điều kiện chạy tự động", form giữ nguyên. Profile tắt → không hiện khung |
| **U3-R17** | Cấu hình ngưỡng ở trang Profile có sẵn (tham số endpoint `workflows:loan-dossier-ocr` và `workflows:loan-dossier-check`, `defaultLocked`), người có `endpoint:manage` sửa (R-R04). Hai endpoint phải đặt **cùng giá trị**; lệch nhau thì W2 dùng giá trị của chính nó. Không có màn cài đặt riêng |
| **U3-R18** | Sau một lần W2 `AUTO`, RM vẫn điền form và bấm "Chạy kiểm tra hồ sơ" để có bản `RM` (U4-R16) |

## 4. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| U3-AC01 | Given W1 có `loan_application` / When mở thẻ / Then các ô hiện gợi ý kèm nguồn nhưng chưa điền cho tới khi bấm Nhận | R01, R03 |
| U3-AC02 | Given nhận gợi ý rồi sửa chữ / Then `origin` đổi từ `OCR_ACCEPTED` sang `RM_INPUT` | R02 |
| U3-AC03 | Given đánh dấu "Không có trên chứng từ" ở `gender` / Then payload có `marked_not_on_document = true`, `value = null` | R04 |
| U3-AC04 | Given chưa chọn "Có ngoại lệ?" / When bấm "Chạy kiểm tra hồ sơ" / Then lỗi tại ô đó, không gửi W2 | R05, R09 |
| U3-AC05 | Given có ngoại lệ nhưng mã trống / Then lỗi | R05 |
| U3-AC06 | Given tài sản trỏ `owner_block_ref` của một người / When xóa người đó / Then bị chặn và nêu tài sản | R07 |
| U3-AC07 | Given gõ vào form / Then không có request nào và `localStorage`/`sessionStorage` không có gì | R08 |
| U3-AC08 | Given form hợp lệ / When gửi / Then đúng 1 W2 với `check_input.json` có `confirmation_mode = RM`, `field_edits` bằng kho bản vá | R09 |
| U3-AC09 | Given `has_deviation = false` / Then `external_input.deviation_code = ""` trong `CheckOutput` | §2 |
| U3-AC10 | Given còn mục `BLOCK` / When gửi form hợp lệ / Then có hộp xác nhận liệt kê mục chặn; chọn tiếp tục thì gửi | R09 |
| U3-AC11 | Given W2 đang chạy / Then mọi ô chỉ đọc | R11 |
| U3-AC12 | Given Profile tắt / Then không có khung ngưỡng và không có nút chạy tự động | R13, R16 |
| U3-AC13 | Given Profile bật, ngưỡng 0.95, mọi tiêu chí đạt / When bấm chạy tự động và xác nhận / Then W2 gửi `AUTO`, `confirmation = null`; `CheckOutput.confirmation_mode = AUTO` | R13, R14 |
| U3-AC14 | Given một giá trị gợi ý tin cậy 0.94, ngưỡng 0.95 / Then `reasons` có `AUTO_LOW_CONFIDENCE`; sửa field đó (tính 1.0) thì đạt | R14 |
| U3-AC15 | Given hồ sơ không có `loan_application` / Then `reasons` có `AUTO_NO_LOAN_APPLICATION` | R14 |
| U3-AC16 | Given có tệp không đọc được / Then `reasons` có `AUTO_BLOCKING_ISSUE` | R14 |
| U3-AC17 | Given client tính đạt nhưng W2 tính không đạt / Then `check_status = AUTO_NOT_ELIGIBLE`, khung "Chưa đạt" theo `auto_eval` của W2, form giữ nguyên | R14, R16 |
| U3-AC18 | Given bản `AUTO` / When `toSlInput` / Then mọi ô `origin = OCR_ACCEPTED`; `extractExternalInput` cho `deviation_code = null`, `collateral_mortgaged_elsewhere = null` | R15 |
| U3-AC19 | Given client gửi tham số `auto_check_enabled=true` trong form W1 / Then giá trị Profile vẫn được dùng (tham số đã khóa) | R17 |

## 5. Task

### T-U3-01 — Kiểu `ConfirmationPayload` (zod)
- Depends: T-CAT-02
- Files: `lib/loan-dossier/confirmation/schema.ts`, `tests/loan-dossier/confirmation-schema.test.ts`
- Refs: §2
- Làm: `ConfirmationPayloadSchema` (`.strict()`), `emptyPayload()`. Key trong `fields` bị giới hạn bởi `sl_fields.json` **và** `applicable_roles` của vai (VD `loan_amount` chỉ ở `loan.fields`, `license_plate` chỉ ở tài sản).
- DoD:
  - test: payload mẫu ở §2 parse qua
  - test: field lạ ở bất kỳ cấp nào bị từ chối
  - test: `fields.loan_amount` trong `persons[]` bị từ chối
  - test: `origin` ngoài `FormValueSource` bị từ chối
  - test: `marked_not_on_document = true` thì `value` phải là `null`
  - test: `emptyPayload()` parse qua
- Verify: `npx jest tests/loan-dossier/confirmation-schema.test.ts`

### T-U3-02 — Tách `ConfirmationPayload` thành `sl_input` và `external_input`
- Depends: T-U3-01, T-S6-01
- Files: `lib/loan-dossier/confirmation/derive.ts`, `tests/loan-dossier/confirmation-derive.test.ts`
- Refs: §2; S6 §2; S4 `external_input`
- Làm: `toSlInput(payload): SlInput` (thêm `source: "FORM"`, bỏ `contact`, `customer`, `business`…); `extractExternalInput(payload): {deviation_code: string|null, loan_amount: number|null, collateral_mortgaged_elsewhere: boolean|null}`.
- DoD:
  - test: `toSlInput` parse qua schema `sl_input` của T-S6-01; không có khóa `contact`
  - test: `has_deviation=false` → `deviation_code=""`; `true` + `"DV-1"` → `"DV-1"`; chưa chọn → `null`
  - test: `loan_amount` lấy từ `loan.fields.loan_amount.value`; `null` nếu đánh dấu không có
  - test: không có tài sản → `collateral_mortgaged_elsewhere = null`
  - test: kết quả `extractExternalInput` chỉ có 3 khóa
- Verify: `npx jest tests/loan-dossier/confirmation-derive.test.ts`

### T-U3-03 — Kiểm tra trước khi gửi
- Depends: T-U3-01, T-U2-04
- Files: `lib/loan-dossier/confirmation/validate.ts`, `tests/loan-dossier/confirmation-validate.test.ts`
- Refs: U3-R05, U3-R06, U3-R07
- Làm: `validateForSubmit(payload): {ok: true} | {ok: false, errors: {field_path, section, message}[]}`. `field_path` dạng `persons[0].fields.id_number.value`; `section` = số mục 1–7 để mở đúng `Disclosure`.
- DoD:
  - test: payload rỗng → đủ lỗi bắt buộc U3-R05, mỗi lỗi có `field_path` và `section`
  - test: CCCD 11 số lỗi; CMND 9 số hợp lệ
  - test: tài sản trỏ `owner_block_ref` không tồn tại → lỗi
  - test: 6 người → lỗi; 11 tài sản → lỗi
  - test: không có tài sản và `collateral_status = NONE` → không đòi `collateral_mortgaged_elsewhere`
  - test: `rm_commitment=false` → lỗi; payload hợp lệ → `ok: true`
- Verify: `npx jest tests/loan-dossier/confirmation-validate.test.ts`

### T-U3-04 — Gợi ý điền sẵn từ OCR
- Depends: T-U3-01, T-EDIT-01, T-CON-03
- Files: `lib/loan-dossier/confirmation/prefill.ts`, `tests/loan-dossier/confirmation-prefill.test.ts`
- Refs: U3-R03, U3-R02
- Làm: `buildSuggestions(evidences): Suggestions` (kiểu `SuggestionsSchema` của T-CON-03) — chỉ đọc evidence `loan_application` `SUCCESS`; trả `{persons: [{sl_role, fields: {key: {value, evidence_id, field_path, page, file_name}}}], assets, loan, no_application}`. `applySuggestion(payload, path, suggestion): payload` đặt `origin = OCR_ACCEPTED`. Dùng chung ở W1 và giao diện.
- DoD:
  - test: 1 đơn vay có BORROWER + COLLATERAL_OWNER + 1 tài sản → 2 người, 1 tài sản, loan
  - test: không có `loan_application` → rỗng, `no_application = true`
  - test: hai `loan_application` trùng → dùng evidence có `field_confidences.parties` cao hơn; hòa → `evidence_id` nhỏ hơn
  - test: evidence đã áp bản vá (đầu ra `applyEdits`) cho gợi ý đã sửa
  - test: `applySuggestion` đặt `OCR_ACCEPTED`; hàm không đổi payload đầu vào
- Verify: `npx jest tests/loan-dossier/confirmation-prefill.test.ts`

### T-U3-05 — Reducer trạng thái form
- Depends: T-U3-01, T-U3-03
- Files: `lib/loan-dossier/confirmation/form-state.ts`, `tests/loan-dossier/confirmation-form-state.test.ts`
- Refs: U3-R02, U3-R04, U3-R07
- Làm: `formReducer(state, action)` với `SET_FIELD`, `MARK_NOT_ON_DOCUMENT`, `ACCEPT_SUGGESTION`, `ACCEPT_ALL`, `ADD_PERSON`, `REMOVE_PERSON`, `ADD_ASSET`, `REMOVE_ASSET`, `MARK_SUBMITTED`. State có `dirty` (đã đổi từ lần gửi W2 cuối). `block_ref` sinh tăng dần `sl-p{n}`, `sl-a{n}`, không tái dùng số đã xóa.
- DoD:
  - test: `SET_FIELD` đổi `origin` thành `RM_INPUT`
  - test: `MARK_NOT_ON_DOCUMENT` đặt `value=null` và cờ; `SET_FIELD` sau đó bỏ cờ
  - test: xóa người đang được tài sản tham chiếu → state không đổi, kèm lỗi `PERSON_IN_USE`
  - test: không xóa được `borrower` đầu tiên
  - test: thêm–xóa–thêm → `block_ref` không trùng
  - test: `MARK_SUBMITTED` đặt `dirty=false`; `SET_FIELD` sau đó đặt lại `true`
- Verify: `npx jest tests/loan-dossier/confirmation-form-state.test.ts`

### T-U3-07 — Thẻ xác nhận (thành phần giao diện)
- Depends: T-U3-04, T-U3-05, T-U3-09, T-U2-06
- Files: `app/loan-dossier/components/confirm/ConfirmationCard.tsx`, `.../CustomerSection.tsx`, `.../PersonsSection.tsx`, `.../BusinessSection.tsx`, `.../AssetsSection.tsx`, `.../LoanSection.tsx`, `.../CommitmentSection.tsx`, `.../FieldWithSuggestion.tsx`, `.../AutoThresholdBox.tsx`
- Refs: U3-R01…R16, U3-AC01…AC16
- Làm: 7 mục theo §1, mỗi mục một `Disclosure` của kit v2. `FieldWithSuggestion`: ô nhập + nút Nhận + hộp "Không có trên chứng từ" + chú thích nguồn (tệp, trang). `AutoThresholdBox` theo U3-R13, U3-R16, dùng `Dialog` của v2 cho hộp xác nhận.
- DoD:
  - `npx tsc --noEmit` và `next lint --dir app/loan-dossier` không lỗi
  - đọc mã: không `localStorage`/`sessionStorage`, không `dangerouslySetInnerHTML`
  - đọc mã: khi W1/W2 đang chạy mọi `input/select/textarea` có `disabled`/`readOnly`
  - đọc mã: tóm tắt số định danh dùng `maskId`
- Verify: `npx tsc --noEmit -p tsconfig.json && npx next lint --dir app/loan-dossier`

### T-U3-08 — Dựng `CheckInput` và gửi W2 (hàm thuần)
- Depends: T-U3-03, T-U2-05, T-CON-04, T-API-02
- Files: `lib/loan-dossier/confirmation/submit-check.ts`, `tests/loan-dossier/confirmation-submit.test.ts`
- Refs: U3-R09, U3-R13, U3-AC04, U3-AC08, U3-AC10
- Làm: `prepareCheck({mode, ocrOutput, editStore, form, issues}): {ok: true, input: CheckInput, needsBlockConfirm: boolean} | {ok: false, errors}` — `RM`: chạy `validateForSubmit`, lỗi thì không dựng; `AUTO`: `confirmation = null`. `input` parse qua `CheckInputSchema` trước khi trả. Gửi bằng `submitCheck` (T-API-02).
- DoD:
  - test: payload thiếu → `ok: false`, không gọi `submitCheck` (fetch giả)
  - test: hợp lệ → `CheckInput` parse qua schema, `field_edits` bằng `toFieldEdits`
  - test: có mục `BLOCK` → `needsBlockConfirm = true`
  - test: `AUTO` → `confirmation = null`, không chạy `validateForSubmit`
  - test: `classify`/`evidences` là bản gốc của W1 (không phải bản đã áp bản vá)
- Verify: `npx jest tests/loan-dossier/confirmation-submit.test.ts`

### T-U3-09 — Đánh giá ngưỡng tự động (hàm thuần)
- Depends: T-U2-03, T-U3-04, T-CAT-02
- Files: `lib/loan-dossier/confirmation/auto-eval.ts`, `tests/loan-dossier/confirmation-auto-eval.test.ts`
- Refs: U3-R14, U3-R17
- Làm: `evaluateAutoThreshold({setting:{enabled, minConfidence}, classifyData, evidences}): AutoEval` (kiểu `AutoEvalSchema`). `evidences` đã áp bản vá. `AutoReason` ∈ `AUTO_BLOCKING_ISSUE`, `AUTO_DUPLICATE_CONFLICT`, `AUTO_NO_LOAN_APPLICATION`, `AUTO_NO_BORROWER_IDENTITY`, `AUTO_LOW_CONFIDENCE` (thứ tự cố định). Gọi lại `buildReviewIssues` và `buildSuggestions`; không viết lại logic đó. Dùng chung ở W1, W2 và giao diện.
- DoD:
  - test: `enabled = false` → `{enabled:false, eligible:false, reasons:[]}`
  - test: đạt mọi tiêu chí → `eligible = true`, `reasons = []`
  - test: đúng bằng ngưỡng → đạt; 0.9499 với ngưỡng 0.95 → `AUTO_LOW_CONFIDENCE`
  - test: field đã sửa tính 1.0
  - test: thiếu `loan_application` → `AUTO_NO_LOAN_APPLICATION`; không `borrower` có số định danh → `AUTO_NO_BORROWER_IDENTITY`
  - test: tệp `PASSWORD_PROTECTED` → `AUTO_BLOCKING_ISSUE`; `CONFLICTING_DUPLICATES` → `AUTO_DUPLICATE_CONFLICT`
  - test: nhiều lý do cùng lúc → đủ và đúng thứ tự
  - test: `JSON.stringify(result)` không chứa giá trị mẫu; `minConfidence` ngoài [0.80, 1.00] → ném lỗi
- Verify: `npx jest tests/loan-dossier/confirmation-auto-eval.test.ts`

### T-U3-10 — Dựng bản xác nhận tự động (hàm thuần)
- Depends: T-U3-01, T-U3-02, T-U3-04
- Files: `lib/loan-dossier/confirmation/auto-payload.ts`, `tests/loan-dossier/confirmation-auto-payload.test.ts`
- Refs: U3-R15, U3-AC18
- Làm: `toAutoPayload(suggestions): ConfirmationPayload` — áp mọi gợi ý bằng `applySuggestion` rồi đặt các khối còn lại theo U3-R15. Không đổi đầu vào.
- DoD:
  - test: kết quả parse qua `ConfirmationPayloadSchema`
  - test: mọi ô có giá trị đều `origin = OCR_ACCEPTED`
  - test: `rm_commitment = false`; `customer.phone = null`
  - test: `extractExternalInput` → `deviation_code = null`, `collateral_mortgaged_elsewhere = null`, `loan_amount` = giá trị OCR
  - test: hai lần gọi cùng đầu vào cho kết quả giống hệt (`block_ref` ổn định)
- Verify: `npx jest tests/loan-dossier/confirmation-auto-payload.test.ts`
