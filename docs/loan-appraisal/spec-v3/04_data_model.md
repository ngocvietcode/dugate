# 04 — Hợp đồng dữ liệu (không lưu trạng thái)

> **Nền v2 (D-32, 2026-10-16):** phần W1/W2, `OcrOutput`/`CheckInput`, bản vá, ngưỡng tự động và giao diện `/loan-dossier` trong file này **không áp dụng**. Kiến trúc chuẩn: [cross_cutting/v2_integration.md](cross_cutting/v2_integration.md).

Luồng này **không lưu trạng thái hồ sơ** (fire-and-forget, IMPLEMENT D-25). DUGate cung cấp hai workflow độc lập; hệ thống gọi (hoặc giao diện của DUGate, xem `ui/`) tự giữ hồ sơ, bản vá OCR, form xác nhận và quyết định của CO.

| Workflow | `process` | Chạy | Đầu vào | Đầu ra (`extracted_data`) |
|---|---|---|---|---|
| **W1** | `loan-dossier-ocr` | S1 → S2 | File chứng từ + tham số (§3) | `OcrOutput` (§3) |
| **W2** | `loan-dossier-check` | S3 → {S4, S5, S6} | Một file `check_input.json` (§4) | `CheckOutput` (§4) |

Cả hai đi qua route có sẵn `POST /api/v1/docs/workflows` (xem [cross_cutting/api.md](cross_cutting/api.md)).

## 1. Dữ liệu nằm ở đâu

Không có bảng, cột hay migration mới. Dữ liệu chỉ nằm ở các chỗ do nền tảng sẵn có quản lý:

| Dữ liệu | Nơi lưu | Thời gian tồn tại |
|---|---|---|
| File chứng từ (W1), `check_input.json` (W2) | Storage qua `FileCache`, tham chiếu từ `Operation.filesJson` | Xóa sau `FILE_EXPIRY_HOURS` (mặc định 24 giờ, `lib/cleanup.ts`) |
| Tham số form (`flow`, `dossier_submitted_at`, `upload_hints`) | `Operation.pipelineJson` | Xóa nội dung theo `OPERATION_CONTENT_RETENTION_DAYS` (mặc định 7 ngày, `lib/operations/content-retention.ts`) |
| `OcrOutput`, `CheckOutput` | `Operation.extractedData` / kết quả workflow | Như trên |
| Bản vá OCR, form xác nhận, quyết định CO | **Hệ thống gọi** (giao diện DUGate: bộ nhớ trang) | Do hệ thống gọi quyết định |

## 2. Quy tắc

| ID | Rule |
|---|---|
| **D-01** | Không tạo bảng, cột, migration cho luồng này. Code dưới `lib/loan-dossier/` không import `@/lib/db`; chỉ file workflow dùng helper của `workflow-engine` (`updateProgress`, `completeWorkflow`, `failWorkflow`) |
| **D-02** | Mỗi request độc lập. Workflow **không** đọc kết quả của Operation khác (không có `previous_operation_id`). Mọi dữ liệu W2 cần nằm trong `check_input.json` |
| **D-03** | Evidence gốc không bị sửa. Bản vá (`field_edits[]`) do client gửi trong W2, được áp bằng **một** hàm duy nhất (T-EDIT-01) trong bộ nhớ của lần chạy; kết quả áp được báo lại ở `edit_report` |
| **D-04** | Mọi hợp đồng có `contract` và `contract_version`. Đổi phá vỡ tương thích → tăng `contract_version`. W2 từ chối `contract`/`contract_version` không nhận biết |
| **D-05** | Mọi object parse bằng zod `.strict()`; field lạ ở bất kỳ cấp nào → lỗi đầu vào |
| **D-06** | Tham số form (đi vào `pipelineJson`) **không chứa PII**: chỉ `flow`, `dossier_submitted_at`, `upload_hints`. PII chỉ đi qua file (chứng từ ở W1, `check_input.json` ở W2) |
| **D-07** | Lỗi đầu vào W2 phát hiện ở worker → workflow ném `Error("INVALID_INPUT: <MÃ> — <đường dẫn>")` với `<MÃ>` ∈ {`INVALID_CHECK_INPUT`, `UNSUPPORTED_CONTRACT_VERSION`}; chỉ liệt kê tối đa 20 `field_path`, **không** chứa giá trị. Lỗi đầu vào W1 → cùng dạng với `<MÃ>` = `INVALID_OCR_INPUT`, chỉ nêu tên tham số/chỉ số file và lý do. Nền tảng đặt Operation `FAILED`, `errorCode = INPUT_INVALID` và lưu `errorMessage = "Workflow input could not be processed. — " + thông điệp trên` (mã luồng nằm giữa chuỗi, xem `cross_cutting/api.md` A-R04, A-R09) |
| **D-08** | Kết quả nghiệp vụ xấu (thiếu giấy tờ, lệch dữ liệu, stage `PARTIAL_SUCCESS`…) không làm Operation `FAILED`: Operation `SUCCEEDED`, trạng thái nằm trong từng `StageResult` |

## 3. W1 — `loan-dossier-ocr`

**Đầu vào** (multipart, ngoài `process` và `files[]`):

| Field | Bắt buộc | Kiểu | Ghi chú |
|---|:---:|---|---|
| `flow` | ✔ | `Flow` | `FAST`/`FULL`/`SIMPLE`. Dùng để tính `auto_eval` và được chép vào đầu ra để client gửi lại ở W2 |
| `dossier_submitted_at` | | ngày ISO | Mặc định = ngày nhận request (giờ Việt Nam) |
| `upload_hints` | | JSON mảng | Cùng thứ tự với `files[]`; mỗi phần tử là `ChecklistGroup` hoặc `null` (S1-R03) |

Giới hạn: 1–100 file, mỗi file ≤ 50 MB. Vượt → `INVALID_OCR_INPUT` (D-07). Mọi field form tới workflow dưới dạng chuỗi (`upload_hints` là chuỗi JSON); workflow tự parse.

Tham số Profile (khóa, client gửi lên bị route trả 400 `Forbidden Field` — `rbac.md` R-R04): `auto_check_enabled` (mặc định `false`), `auto_check_min_confidence` (mặc định `0.95`, khoảng [0.80, 1.00]). `createWorkflowContext` chép giá trị Profile vào `ctx.pipelineVars` với kiểu đã lưu, nên workflow nhận cả `true`/`"true"` và `0.95`/`"0.95"`; giá trị khác coi như tắt.

**Đầu ra `OcrOutput`:**

```json
{
  "contract": "dugate.loan-dossier.ocr",
  "contract_version": "1",
  "flow": "FULL",
  "dossier_submitted_at": "2026-10-14",
  "stages": {
    "classify":         { "stage_key": "classify", "status": "SUCCESS", "...": "StageResult, 02_conventions §4" },
    "extract_evidence": { "stage_key": "extract_evidence", "status": "PARTIAL_SUCCESS", "...": "…" }
  },
  "review_issues": [ { "id": "ri-1", "kind": "LOW_CONFIDENCE", "severity": "REVIEW", "file_id": "file-abc123def456",
                       "evidence_id": "ev-0a1b2c3d4e5f", "field_path": "data.parties[0].date_of_birth", "message": "…" } ],
  "suggestions": { "persons": [], "assets": [], "loan": {}, "no_application": false },
  "auto_eval": { "enabled": false, "eligible": false, "threshold": 0.95, "observed_min_confidence": 0.88, "reasons": [] }
}
```

- `review_issues` = `buildReviewIssues` (T-U2-03) trên OCR gốc, chưa có bản vá.
- `suggestions` = `buildSuggestions` (T-U3-04) trên OCR gốc. Chứa giá trị OCR (PII).
- `auto_eval` = `evaluateAutoThreshold` (T-U3-09) trên OCR gốc với tham số Profile. Không chứa giá trị field. Client tính lại sau khi có bản vá (U2-R11); W2 tính lại lần cuối (U3-R14).

## 4. W2 — `loan-dossier-check`

**Đầu vào:** đúng 1 file `check_input.json` (`application/json`, ≤ 20 MB) chứa `CheckInput`:

```json
{
  "contract": "dugate.loan-dossier.check-input",
  "contract_version": "1",
  "flow": "FULL",
  "dossier_submitted_at": "2026-10-14",
  "confirmation_mode": "RM",
  "classify": { "files": [], "repeated_doc_types": [] },
  "evidences": [],
  "field_edits": [
    { "evidence_id": "ev-0a1b2c3d4e5f", "field_path": "data.parties[0].full_name",
      "original_value": "NGUYEN VAN B", "value": "NGUYEN VAN A", "reason": null, "edited_at": "2026-10-14T03:00:00Z" }
  ],
  "confirmation": { "schema_version": "1", "...": "ConfirmationPayload, ui/U3 §2" }
}
```

| Field | Quy tắc |
|---|---|
| `classify` | Nguyên `data` của S1 trong `OcrOutput` |
| `evidences` | Nguyên `data.evidences` của S2 trong `OcrOutput`, **không sửa** (sửa đi qua `field_edits`) |
| `field_edits` | Bản vá của người dùng (§5). Có thể rỗng |
| `confirmation_mode` | `ConfirmationMode`: `RM` → `confirmation` bắt buộc; `AUTO` → `confirmation` phải là `null`, DUGate tự đánh giá ngưỡng và dựng bản xác nhận (U3-R13…R15) |
| `confirmation` | `ConfirmationPayload` (U3 §2) hoặc `null` |

**Đầu ra `CheckOutput`:**

```json
{
  "contract": "dugate.loan-dossier.check",
  "contract_version": "1",
  "check_status": "COMPLETED",
  "flow": "FULL",
  "dossier_submitted_at": "2026-10-14",
  "confirmation_mode": "RM",
  "auto_eval": null,
  "edit_report": {
    "applied": [ { "evidence_id": "ev-0a1b2c3d4e5f", "field_path": "data.parties[0].full_name" } ],
    "skipped": [ { "evidence_id": "ev-0a1b2c3d4e5f", "field_path": "data.parties[9].full_name", "code": "ORPHAN_EDIT" } ]
  },
  "external_input": { "loan_amount": 500000000, "deviation_code": "", "collateral_mortgaged_elsewhere": false },
  "stages": {
    "map_dossier_roles":     { "...": "StageResult" },
    "check_checklist":       { "...": "StageResult" },
    "cross_check_documents": { "...": "StageResult" },
    "compare_ocr_sl":        { "...": "StageResult" }
  }
}
```

- `check_status` ∈ `CheckRunStatus`: `COMPLETED` (đã chạy S3–S6); `AUTO_NOT_ALLOWED` (`AUTO` nhưng Profile tắt); `AUTO_NOT_ELIGIBLE` (`AUTO` nhưng không đạt ngưỡng). Hai giá trị sau có `stages = null` và `auto_eval` khác null.
- `edit_report` và `external_input` không chứa PII ngoài số tiền vay.

## 5. Bản vá (`FieldEdit`)

Bản vá do client tạo và giữ. DUGate chỉ nhận nó trong `CheckInput`.

| Field | Ghi chú |
|---|---|
| `evidence_id`, `field_path` | Lá nguyên thủy trong `data` của evidence (VD `data.parties[0].full_name`) |
| `original_value` | Giá trị OCR lúc người dùng sửa. Dùng để phát hiện bản vá đã cũ |
| `value` | Giá trị mới (chuỗi, số, boolean hoặc `null`) |
| `reason` | Chuỗi hoặc `null` |
| `edited_at` | Thời điểm sửa (ISO 8601) |

**Giá trị hiệu lực của một field:**

```text
effective(field) =
    bản vá có edited_at mới nhất cho (evidence_id, field_path), nếu áp được
    ngược lại: giá trị OCR trong evidences[]
```

Mã bỏ qua (`edit_report.skipped[].code`):

| Mã | Khi nào |
|---|---|
| `ORPHAN_EDIT` | `evidence_id` không có trong `evidences[]` hoặc `field_path` không tồn tại |
| `FIELD_NOT_EDITABLE` | `field_path` trỏ tới object/mảng |
| `EDIT_ON_ERROR_EVIDENCE` | Evidence `ERROR` |
| `EDIT_BASE_CHANGED` | Giá trị OCR hiện tại ≠ `original_value` (đã chuẩn hóa) |
| `INVALID_VALUE` | `value` sai kiểu theo schema loại chứng từ (cùng bộ kiểm của T-U2-04) |

Field cấp 1 có bản vá áp được → `field_confidences.<field> = 1.0`, `field_sources.<field_path> = "HUMAN_EDIT"`.

## 6. Khi nào gọi lại

| Sự kiện ở client | Gọi lại |
|---|---|
| Thêm / bớt file | W1 với **toàn bộ** file của hồ sơ (không tái sử dụng kết quả cũ — OQ-12). `evidence_id` tất định (S2-R14) nên bản vá cũ vẫn dùng được nếu chứng từ không đổi |
| Sửa / hoàn tác giá trị OCR | Không gọi gì; bản vá đi kèm lần W2 sau |
| Lưu xác nhận / sửa form | W2 |
| "Chạy lại kiểm tra" | W2 với cùng `CheckInput` |

## 7. Task

### T-CON-01 — Hợp đồng `StageResult` và `data` của S1, S2
- Depends: T-CAT-02, T-S2-02
- Files: `lib/loan-dossier/contracts/stage-result.ts`, `tests/loan-dossier/contract-stage-result.test.ts`
- Refs: D-04, D-05
- Làm: zod `StageResultSchema(dataSchema)` theo `02_conventions §4` (`status` ∈ `StageStatus`, `status_code` ∈ `reason_codes.json` scope `STAGE`); `ClassifyDataSchema` (S1 §2); `ExtractDataSchema` (`evidences: EvidenceEnvelope[]` của T-S2-02). Xuất type TypeScript tương ứng.
- DoD:
  - test: ví dụ output ở S1 §2 parse qua `ClassifyDataSchema`
  - test: `status_code` không có trong `reason_codes.json` bị từ chối
  - test: `status = PENDING` bị từ chối
  - test: field lạ ở `StageResult` và trong `files[]` bị từ chối
  - test: `blocking_inputs[].type` ngoài `DOCUMENT`/`EXTERNAL_DATA`/`INTEGRATION` bị từ chối
- Verify: `npx jest tests/loan-dossier/contract-stage-result.test.ts`

### T-CON-02 — Hợp đồng `data` của S3–S6
- Depends: T-CON-01
- Files: `lib/loan-dossier/contracts/check-stages.ts`, `tests/loan-dossier/contract-check-stages.test.ts`
- Refs: D-04, D-05, S6-R11
- Làm: zod cho `data` của S3 (`role_registry`, `asset_registry`, `relationship_verifications`, `customer_360`, `unmapped_evidences`, `superseded_evidences`), S4 (`items`, `summary_by_group`, `condition_evaluations`…), S5 (`results`, `logic_findings`), S6 (`confirmation_mode`, `results[]` với `suggested_value`, `suggested_source`). Lấy đúng tên field ở mục Output của từng file stage.
- DoD:
  - test: mỗi stage có 1 fixture tối thiểu parse qua
  - test: S6 `results[]` có `co_confirmed_value` hoặc `decision_state` bị từ chối (không còn trong hợp đồng)
  - test: `match_status` ngoài `SlCompareStatus` bị từ chối
  - test: `suggested_source` ngoài `SuggestedValueSource` (trừ `null`) bị từ chối
- Verify: `npx jest tests/loan-dossier/contract-check-stages.test.ts`

### T-CON-03 — Hợp đồng `OcrOutput` (W1)
- Depends: T-CON-01, T-CAT-02
- Files: `lib/loan-dossier/contracts/ocr-output.ts`, `tests/loan-dossier/contract-ocr-output.test.ts`
- Refs: §3, D-04, U3-R14
- Làm: zod `OcrOutputSchema`, kèm `ReviewIssueSchema`, `SuggestionsSchema`, `AutoEvalSchema` (dùng chung cho T-U2-03, T-U3-04, T-U3-09). `contract = "dugate.loan-dossier.ocr"`, `contract_version = "1"`.
- DoD:
  - test: ví dụ §3 parse qua
  - test: `contract_version = "2"` bị từ chối
  - test: `auto_eval.reasons` ngoài `AutoConfirmReason` bị từ chối
  - test: `auto_eval.threshold` ngoài [0.80, 1.00] bị từ chối
  - test: `review_issues[].severity` ngoài `BLOCK`/`REVIEW`/`INFO` bị từ chối
- Verify: `npx jest tests/loan-dossier/contract-ocr-output.test.ts`

### T-CON-04 — Hợp đồng `CheckInput` và `CheckOutput` (W2)
- Depends: T-CON-02, T-CON-03, T-U3-01, T-EDIT-01
- Files: `lib/loan-dossier/contracts/check.ts`, `tests/loan-dossier/contract-check.test.ts`
- Refs: §4, §5, D-04, D-05
- Làm: zod `CheckInputSchema` (dùng `ClassifyDataSchema`, `EvidenceEnvelope[]`, `FieldEditSchema` của T-EDIT-01, `ConfirmationPayloadSchema` của T-U3-01) với ràng buộc chéo `confirmation_mode`/`confirmation`; `CheckOutputSchema` với `check_status` ∈ `CheckRunStatus`.
- DoD:
  - test: ví dụ §4 (đầu vào và đầu ra) parse qua
  - test: `RM` mà `confirmation = null` → lỗi tại `confirmation`
  - test: `AUTO` mà `confirmation` khác null → lỗi
  - test: `check_status = COMPLETED` mà `stages = null` → lỗi; `AUTO_NOT_ELIGIBLE` mà `stages` khác null → lỗi
  - test: lỗi parse trả `field_path` dạng `evidences[3].data.parties[0]`, không chứa giá trị
  - test: field lạ ở gốc bị từ chối
- Verify: `npx jest tests/loan-dossier/contract-check.test.ts`
