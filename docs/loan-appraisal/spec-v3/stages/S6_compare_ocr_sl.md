# S6 — `compare_ocr_sl`: Đối chiếu OCR với dữ liệu Secure Loan

> **Nền v2 (D-32, 2026-10-16):** file này **không áp dụng** (S6 cần dữ liệu SL, v2 không có). Giữ để tra cứu. Xem [cross_cutting/v2_integration.md](../cross_cutting/v2_integration.md).

## 1. Mục đích

RM nhập thông tin khách hàng, khoản vay, TSBĐ lên SL (ở luồng này: form xác nhận U3). Chứng từ scan được S2 trích xuất. S6 so từng trường giữa hai nguồn, trả bảng khớp/lệch kèm **gợi ý giá trị chuẩn** cho từng dòng.

CO chọn giá trị chuẩn và xác nhận bảng ở **hệ thống gọi**, không ở DUGate (R-R06). DUGate không nhận, không lưu quyết định của CO.

Không so **nguồn thu** (doanh thu, thu nhập, lợi nhuận, chi phí) — BRD 09/10/2026. Không sửa dữ liệu trên SL.

## 2. Input / Output

**`sl_input`** — W2 dựng từ `CheckInput.confirmation` bằng `toSlInput` (T-U3-02); với `confirmation_mode = AUTO` dựng từ bản tự động (U3-R15). `SlInputSource = API` để dành cho tích hợp SL sau này (chưa dùng):

```json
{
  "source": "FORM",
  "persons": [
    {
      "block_ref": "sl-p1",
      "sl_role": "borrower",
      "fields": {
        "full_name":   { "value": "NGUYEN VAN A", "origin": "SL_IMPORT" },
        "id_number":   { "value": "000000000000", "origin": "RM_INPUT" },
        "gender":      { "value": null, "origin": "RM_INPUT", "marked_not_on_document": true }
      }
    }
  ],
  "assets": [
    { "block_ref": "sl-a1", "fields": { "certificate_number": { "value": "BS000000", "origin": "SL_IMPORT" } } }
  ],
  "loan": { "fields": { "loan_amount": { "value": 500000000, "origin": "SL_IMPORT" } } }
}
```

- `origin` ∈ `FormValueSource` (`SL_IMPORT`, `RM_INPUT`, `OCR_ACCEPTED`).
- `sl_role` ∈ `borrower`, `co_borrower`, `collateral_owner`.
- Field không thuộc `sl_fields.json` → dòng `UNDETERMINED` / `FIELD_MAPPING_NOT_FOUND`.

| Input khác | Nguồn |
|---|---|
| `evidences[]` (đã áp bản vá, T-EDIT-01), `role_registry[]`, `asset_registry[]`, `superseded_evidences[]` | `CheckInput.evidences`, S3 |
| `confirmation_mode` | `CheckInput.confirmation_mode` |
| `03_catalogs/sl_fields.json` (21 field) | Catalog |

**Output `data`:** `confirmation_mode`, `results[]`.

**`data.results[]`:**

| Field | Mô tả |
|---|---|
| `row_key` | `{person_id \| asset_id \| "loan"}:{field_key}` — ổn định giữa các lần chạy (S6-R13) |
| `subject_type` | `PERSON`/`ASSET`/`LOAN` |
| `person_id`, `asset_id`, `role`, `block_ref` | |
| `field_key`, `field_label`, `field_group`, `comparison_method` | Từ `sl_fields.json` |
| `sl_value`, `ocr_value` | Chuỗi hiển thị, chỉ đọc |
| `sl_origin` | `FormValueSource` |
| `ocr_sources[]` | `evidence_id`, `doc_type_key`, `file_name`, `field_path`, `page`, `value` |
| `match_status` | `SlCompareStatus` |
| `reason_code`, `severity`, `requires_review`, `reason` | |
| `suggested_value` | Gợi ý giá trị chuẩn (S6-R11) hoặc `null` |
| `suggested_source` | `SuggestedValueSource` (`SL`/`OCR`) hoặc `null` |

`content_preview`: `total_rows`, `match_count`, `mismatch_count`, `ocr_value_missing_count`, `sl_value_missing_count`, `undetermined_count`, `not_applicable_count` (**không** tính vào mẫu số), `requires_review_count`, `independent` (`false` khi `confirmation_mode = AUTO`, S6-R17).

## 3. Rule

### 3.1 Phạm vi và ghép đối tượng

| ID | Rule |
|---|---|
| **S6-R01** | Chỉ so field trong `sl_fields.json` (21 field, 4 nhóm: `identity`, `residence`, `loan_plan`, `collateral`). Field nguồn thu → không sinh dòng nào; nếu SL gửi field đó, ghi 1 phần tử `NOT_APPLICABLE` / `INCOME_FIELD_EXCLUDED` và loại khỏi mọi bộ đếm |
| **S6-R02** | Bảng áp dụng theo vai trò lấy từ `applicable_roles` của từng field (VD `current_address` chỉ `borrower`/`co_borrower`; `loan_*` chỉ `borrower`; `asset_*` chỉ `collateral_owner`). Field không áp dụng cho `sl_role` của block → bỏ qua, không sinh dòng |
| **S6-R03** | Ghép block người SL ↔ `person_id`: (1) `id_number` SL khớp `current`/`historical`/`declared` của đúng 1 người; (2) nếu không, tên SL ↔ `full_name` theo `nameLevel` `EXACT`/`REORDERED` của đúng 1 người cùng vai trò; (3) ghép được ≥ 2 → toàn bộ field của block `UNDETERMINED` / `AMBIGUOUS_PERSON_MATCH`; (4) không ghép được → `OCR_VALUE_MISSING` / `PERSON_NOT_MAPPED`. Tên khớp mà `id_number` khác → vẫn ghép theo tên, `id_number` được so bình thường (ra `MISMATCH`) |
| **S6-R04** | Ghép block TSBĐ ↔ `asset_id` bằng khóa tài sản của S3 (`canLink` với descriptor dựng từ field SL). 0 khớp → `OCR_VALUE_MISSING` / `ASSET_NOT_MAPPED`; ≥ 2 → `UNDETERMINED` / `AMBIGUOUS_ASSET_MATCH`. Chủ TSBĐ của block không được dùng để ghép |

### 3.2 Giá trị và trạng thái

| ID | Rule |
|---|---|
| **S6-R05** | Giá trị OCR của một field = duyệt `ocr_sources` trong `sl_fields.json` theo thứ tự, **chỉ lấy evidence thuộc đúng `person_id`/`asset_id`** (qua `mapped_evidences`/`sources`) và `party_roles` khớp, bỏ evidence trong `superseded_evidences` của S3 (S3-R27). Lấy giá trị khác null đầu tiên. Dùng nguồn từ thứ 2 trở đi → `reason_code = SECONDARY_SOURCE_USED` (vẫn `MATCH`/`MISMATCH` bình thường). Các nguồn khác null mâu thuẫn nhau sau chuẩn hóa → `UNDETERMINED` / `MULTIPLE_SOURCES_CONFLICT`, giữ mọi nguồn trong `ocr_sources` |
| **S6-R06** | Chuẩn hóa/so sánh dùng lại bộ so của S5 theo `comparison_method`: `EXACT` (T-S5-03), `ADDRESS_REFERENCE` (T-S5-04), `METRIC` (T-S5-05, `loan_amount` so với `bank_proposed_amount`), `SEMANTIC` (T-S5-06). Không viết bộ so riêng |
| **S6-R07** | Trạng thái, xét theo thứ tự, dừng ở dòng đầu khớp: ① `origin = OCR_ACCEPTED` → `NOT_APPLICABLE`/`SL_VALUE_FROM_OCR`; ② `marked_not_on_document = true` → `NOT_APPLICABLE`/`MARKED_NOT_ON_DOCUMENT`; ③ SL là giá trị giữ chỗ (`N/A`, `NA`, `-`, `Nhập thông tin`, không phân biệt hoa thường) → `UNDETERMINED`/`PLACEHOLDER_VALUE`; ④ SL null/rỗng, OCR có → `SL_VALUE_MISSING`; ⑤ OCR null, SL có → `OCR_VALUE_MISSING`/`OCR_VALUE_MISSING`; ⑥ cả hai null → **không sinh dòng**; ⑦ `MULTIPLE_SOURCES_CONFLICT` (S6-R05); ⑧ không tách được tỉnh/xã từ OCR → `UNDETERMINED`/`FIELD_SPLIT_FAILED`; ⑨ so theo S6-R06 → `MATCH` (`EXACT_MATCH`/`SEMANTIC_MATCH`) hoặc `MISMATCH` (`VALUE_CONFLICT`) |
| **S6-R08** | `severity`/`requires_review`: `MATCH`, `NOT_APPLICABLE` → `INFO`, `false`. `id_number` `MISMATCH` → `HIGH`, `true`. Mọi trạng thái còn lại → `REVIEW`, `true` |
| **S6-R09** | `NOT_APPLICABLE` loại khỏi tổng số dòng tính khớp/lệch và khỏi `requires_review_count`, nhưng vẫn có trong `results[]` |
| **S6-R10** | Số định danh: OCR có số 9 `HISTORICAL` còn SL ghi số 12 `CURRENT` (hoặc ngược lại) và hai số cùng thuộc một người → `UNDETERMINED`/`HISTORICAL_ID_NUMBER`. Không tự `MATCH` |

### 3.3 Gợi ý giá trị chuẩn và trách nhiệm của hệ thống gọi

| ID | Rule |
|---|---|
| **S6-R11** | `suggested_value`/`suggested_source`: `MATCH` → `sl_value` (`SL`); `MISMATCH` → `ocr_value` (`OCR`); `SL_VALUE_MISSING` → `ocr_value` (`OCR`); `OCR_VALUE_MISSING` → `sl_value` (`SL`); `UNDETERMINED` → `null`/`null` (CO phải chọn); `NOT_APPLICABLE` → `sl_value` (`SL`) nếu có, không có thì `null`/`null`. Gợi ý **không** phải quyết định |
| **S6-R12** | DUGate không có thao tác ghi nào trên bảng này: không nhận `co_confirmed_value`, không lưu quyết định, không "đóng băng" bộ dữ liệu chuẩn. Hệ thống gọi lưu quyết định của CO theo `row_key` |
| **S6-R13** | `row_key` và thứ tự `results[]` tất định: cùng `CheckInput` → cùng kết quả. Thứ tự: người theo `person_id`, tài sản theo `asset_id`, `loan` cuối; trong mỗi đối tượng theo thứ tự field của `sl_fields.json` |
| **S6-R14** | **Không ghi ngược sang SL** |
| **S6-R15** | Bộ lọc ở giao diện: "Tất cả", "Khớp" (`MATCH`), "Cần xử lý" (mọi trạng thái khác `MATCH`/`NOT_APPLICABLE`, mặc định) |
| **S6-R16** | `sl_value`, `ocr_value`, `suggested_value` là PII: không log plaintext |
| **S6-R17** | **Bản xác nhận tự động** (`confirmation_mode = AUTO`, U3-R13): mọi giá trị SL đều `OCR_ACCEPTED` nên S6-R07① cho mọi dòng `NOT_APPLICABLE`/`SL_VALUE_FROM_OCR`; `content_preview.independent = false`. Bảng này **không phải** đối chiếu độc lập; hệ thống gọi không được dùng nó làm căn cứ xác nhận cho tới khi có lần W2 với `RM` |

## 4. Trạng thái stage

| # | Điều kiện | `status` | `status_code` |
|--:|---|---|---|
| 1 | Dependency `FAILED` | `UNAVAILABLE` | `DEPENDENCY_FAILED` |
| 2 | Lỗi kỹ thuật | `FAILED` | `ENGINE_CRASH`/`ENGINE_TIMEOUT`/`OUT_OF_MEMORY`/`JSON_PARSE_ERROR` |
| 3 | `sl_input` là `null` | `NOT_EVALUATED` | `SL_INPUT_NOT_PROVIDED` |
| 4 | `sl_input` rỗng hoặc không ghép được block nào | `INSUFFICIENT_DATA` | `SL_DATA_EMPTY` |
| 5 | Role registry không dùng được (S3 `INSUFFICIENT_DATA`/`UNAVAILABLE`) | `UNAVAILABLE` | `ROLE_REGISTRY_UNAVAILABLE` |
| 6 | Có block chưa ghép (`PERSON_NOT_MAPPED`, `ASSET_NOT_MAPPED`) hoặc dòng `UNDETERMINED`/`*_MISSING` | `PARTIAL_SUCCESS` | `PARTIAL_FIELD_MATCH` |
| 7 | Còn lại (kể cả có `MISMATCH`) | `SUCCESS` | `COMPLETED` |

## 5. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| S6-AC01 | Given SL và OCR trùng tên / Then `MATCH`/`EXACT_MATCH`, `suggested_value = sl_value`, `suggested_source = SL` | R07, R11 |
| S6-AC02 | Given SL ghi sai số CCCD / Then `MISMATCH`/`HIGH`, `suggested_value = ocr_value` | R07, R08, R11 |
| S6-AC03 | Given SL trống, OCR có địa chỉ / Then `SL_VALUE_MISSING`, `suggested_value = ocr_value` | R07, R11 |
| S6-AC04 | Given CCCD mờ (OCR null), SL có / Then `OCR_VALUE_MISSING`, `suggested_value = sl_value` | R07, R11 |
| S6-AC05 | Given SL `N/A` / Then `UNDETERMINED`/`PLACEHOLDER_VALUE`, `suggested_value = null` | R07, R11 |
| S6-AC06 | Given SL đánh dấu không có trên chứng từ / Then `NOT_APPLICABLE`, không vào mẫu số | R07, R09 |
| S6-AC07 | Given giá trị SL lấy từ gợi ý OCR (`OCR_ACCEPTED`) / Then `NOT_APPLICABLE`/`SL_VALUE_FROM_OCR` | R07 |
| S6-AC08 | Given block SL tên khớp nhưng số CCCD khác / Then ghép theo tên, `id_number` `MISMATCH` | R03 |
| S6-AC09 | Given block SL không có trong OCR / Then mọi field `OCR_VALUE_MISSING`/`PERSON_NOT_MAPPED` | R03 |
| S6-AC10 | Given SL gửi field doanh thu / Then `INCOME_FIELD_EXCLUDED`, không dòng nào, không vào bộ đếm | R01 |
| S6-AC11 | Given 2 nguồn OCR mâu thuẫn / Then `UNDETERMINED`/`MULTIPLE_SOURCES_CONFLICT`, giữ cả hai nguồn | R05 |
| S6-AC12 | Given nguồn OCR thứ 2 được dùng / Then `reason_code = SECONDARY_SOURCE_USED` | R05 |
| S6-AC13 | Given cùng `CheckInput` chạy 2 lần / Then `results[]` (gồm `row_key` và thứ tự) giống hệt | R13 |
| S6-AC14 | Given `confirmation_mode = AUTO` / Then mọi dòng `NOT_APPLICABLE`/`SL_VALUE_FROM_OCR`, `independent = false`, S6 `SUCCESS`/`COMPLETED` | R17, R07 |
| S6-AC15 | Given bất kỳ kết quả nào / Then `results[]` không có khóa `co_confirmed_value`, `decision_state` | R12 |

## 6. Task cards

### T-S6-01 — Schema `sl_input` và chuẩn hóa
- Depends: T-CAT-02, T-S2-03
- Files: `lib/loan-dossier/s6/sl-input.ts`, `tests/loan-dossier/s6-sl-input.test.ts`
- Refs: §2, S6-R01, S6-R02, S6-R07③
- Làm: zod schema `SlInput`; `isPlaceholder(v)`; `applicableFields(slRole)` từ `sl_fields.json`; `splitIncomeFields(raw)` tách field nguồn thu.
- DoD:
  - test: payload mẫu §2 qua; thiếu `block_ref` bị từ chối
  - test: `isPlaceholder` đúng cho `N/A`, `n/a`, `-`, `Nhập thông tin`; sai cho `NGUYEN`
  - test: `current_address` không áp dụng cho `collateral_owner`
  - test: field `doanh_thu` rơi vào danh sách loại trừ
- Verify: `npx jest tests/loan-dossier/s6-sl-input.test.ts`

### T-S6-02 — Ghép block người SL ↔ `person_id`
- Depends: T-S3-04, T-COM-01, T-COM-02
- Files: `lib/loan-dossier/s6/match-person.ts`, `tests/loan-dossier/s6-match-person.test.ts`
- Refs: S6-R03
- Làm: `matchPersonBlock(block, registry): {person_id}|{reason:'PERSON_NOT_MAPPED'|'AMBIGUOUS_PERSON_MATCH'}`.
- DoD:
  - test: S6-AC08, AC09
  - test: khớp qua số lịch sử/khai báo
  - test: tên khớp 2 người cùng vai trò → `AMBIGUOUS_PERSON_MATCH`
  - test: tên khác chính tả (`SPELLING_DIFFERENCE`) → không ghép
  - test: ưu tiên số hơn tên khi hai tín hiệu mâu thuẫn
- Verify: `npx jest tests/loan-dossier/s6-match-person.test.ts`

### T-S6-03 — Ghép block TSBĐ ↔ `asset_id`
- Depends: T-S3-07, T-S3-09
- Files: `lib/loan-dossier/s6/match-asset.ts`, `tests/loan-dossier/s6-match-asset.test.ts`
- Refs: S6-R04
- Làm: `matchAssetBlock(block, assetRegistry)`.
- DoD:
  - test: khớp theo thửa+tờ; theo số GCN; theo biển số; theo số khung
  - test: 0 khớp → `ASSET_NOT_MAPPED`; ≥ 2 → `AMBIGUOUS_ASSET_MATCH`
  - test: chủ sở hữu trên block không ảnh hưởng ghép
- Verify: `npx jest tests/loan-dossier/s6-match-asset.test.ts`

### T-S6-04 — Lấy giá trị OCR của một field
- Depends: T-S2-02, T-S3-15
- Files: `lib/loan-dossier/s6/ocr-value.ts`, `tests/loan-dossier/s6-ocr-value.test.ts`
- Refs: S6-R05
- Làm: `resolveOcrValue(field, subject, s3, evidences): {value, sources[], reason}`.
- DoD:
  - test: S6-AC11, AC12
  - test: chỉ lấy evidence của đúng `person_id` (người khác có cùng loại chứng từ bị bỏ qua)
  - test: `party_roles` không khớp → bỏ
  - test: nguồn 1 null, nguồn 2 có → dùng nguồn 2 + `SECONDARY_SOURCE_USED`
  - test: evidence trong `superseded_evidences` không làm nguồn OCR (S3-R27)
  - test: evidence đã áp bản vá (đầu ra của `applyEdits`) cho giá trị đã sửa
- Verify: `npx jest tests/loan-dossier/s6-ocr-value.test.ts`

### T-S6-05 — Quyết định trạng thái một dòng
- Depends: T-S6-01, T-S6-04, T-S5-03, T-S5-04, T-S5-05, T-S5-06
- Files: `lib/loan-dossier/s6/row-status.ts`, `tests/loan-dossier/s6-row-status.test.ts`
- Refs: S6-R06, S6-R07, S6-R08, S6-R10
- Làm: `decideRow(field, sl, ocr, ports): {match_status, reason_code, severity, requires_review, reason}` theo thứ tự ①–⑨.
- DoD:
  - test: S6-AC01…AC07 (phần trạng thái; mỗi AC một test)
  - test: thứ tự ưu tiên giữa ① và ②, ③ và ④
  - test: cả hai null → trả `null` (không sinh dòng)
  - test: `id_number` `MISMATCH` → `HIGH`; `full_name` `MISMATCH` → `REVIEW`
  - test: số 9 lịch sử vs số 12 hiện tại cùng người → `HISTORICAL_ID_NUMBER`
  - test: `loan_amount` so với `bank_proposed_amount`
- Verify: `npx jest tests/loan-dossier/s6-row-status.test.ts`

### T-S6-06 — Gợi ý giá trị chuẩn
- Depends: T-S6-05
- Files: `lib/loan-dossier/s6/suggest.ts`, `tests/loan-dossier/s6-suggest.test.ts`
- Refs: S6-R11, S6-R12
- Làm: `suggestValue(row): {suggested_value, suggested_source}` theo bảng S6-R11. Hàm thuần.
- DoD:
  - test: mỗi trạng thái của `SlCompareStatus` đúng gợi ý theo S6-R11 (6 test)
  - test: `NOT_APPLICABLE` không có `sl_value` → `null`/`null`
  - test: kết quả chỉ có 2 khóa `suggested_value`, `suggested_source`
- Verify: `npx jest tests/loan-dossier/s6-suggest.test.ts`

### T-S6-08 — Trạng thái stage + `content_preview`
- Depends: T-S6-05
- Files: `lib/loan-dossier/s6/status.ts`, `tests/loan-dossier/s6-status.test.ts`
- Refs: §4, S6-R09, S6-R17
- Làm: `stageStatus(...)`, `contentPreview(rows, confirmationMode)`.
- DoD: mỗi dòng bảng §4 một test; `NOT_APPLICABLE` không vào `requires_review_count`; tổng các bộ đếm khớp `total_rows`; `AUTO` → `independent = false`, `RM` → `true`.
- Verify: `npx jest tests/loan-dossier/s6-status.test.ts`

### T-S6-09 — Lắp ráp stage S6
- Depends: T-S6-02, T-S6-03, T-S6-06, T-S6-08
- Files: `lib/loan-dossier/s6/run.ts`, `tests/loan-dossier/s6-run.test.ts`
- Refs: S6-R01, S6-R11, S6-R12, S6-R13, S6-R17
- Làm: `runCompareOcrSl(input, ports): StageResult` — duyệt block SL, ghép, sinh dòng theo thứ tự S6-R13, gắn gợi ý (T-S6-06).
- DoD:
  - test: S6-AC10, AC13, AC14, AC15
  - test: fixture đủ 3 loại block → snapshot ổn định
  - test: không PII trong `console`
- Verify: `npx jest tests/loan-dossier/s6-run.test.ts`
