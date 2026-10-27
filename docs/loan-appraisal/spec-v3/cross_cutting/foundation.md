# Foundation — Catalog, bản vá, workflow W1/W2

> **Nền v2 (D-32, 2026-10-16):** chỉ áp dụng phần được liệt kê ở [cross_cutting/v2_integration.md](v2_integration.md) §1; phần gắn với W1/W2 không làm.

Các task nền mà S1–S6 và UI đều dựa vào. Hợp đồng dữ liệu: [04_data_model.md](../04_data_model.md).

## 1. Quy tắc

| ID | Rule |
|---|---|
| **F-R01** | Code không import trực tiếp từ `docs/`. Catalog được copy vào `lib/loan-dossier/catalog/data/` bằng script (T-CAT-01), có test chứng minh hai bản giống nhau |
| **F-R02** | Không lưu trạng thái (D-01, D-02). `lib/loan-dossier/**` là hàm thuần hoặc port; chỉ hai file workflow trong `lib/pipelines/workflows/` chạm vào `WorkflowContext` |
| **F-R03** | Mọi stage được gọi qua port `StageRunner` (T-RUN-06). Workflow không import thẳng `lib/loan-dossier/s1…s6`. Nhờ vậy UI và workflow làm được trước engine, với bản giả lập |
| **F-R04** | Bản giả lập (`FakeStageRunner`) chỉ bật khi `LOAN_DOSSIER_STAGE_RUNNER=fake` **và** `NODE_ENV !== 'production'`. Ở production, biến này làm workflow `FAILED` với `errorCode = STAGE_RUNNER_MISCONFIGURED` |
| **F-R05** | Đọc file trong workflow theo mẫu của `statement-analyze.ts`/`brd-analyze.ts`: `(await getStorageBackend()).download(file.path)` rồi gom stream thành `Buffer`; `file.path` lấy từ `ctx.filesData` (đã chuẩn hóa `\` → `/`). Repo **không** có helper dùng chung — mỗi workflow tự khai `readFileBuffer`; luồng này đặt nó ở adapter `lib/pipelines/workflows/loan-dossier-shared.ts`. Không tự ghép đường dẫn storage. Gửi file cho model như `loan-appraisal`: `enqueueSubStep(ctx, processor, vars, JSON.stringify([file]), …)` với `file` là phần tử của `ctx.filesData` |
| **F-R06** | Bản vá chỉ áp ở **một** hàm `applyEdits` (T-EDIT-01). S3–S6, `buildSuggestions`, `evaluateAutoThreshold` nhận evidence đã áp, không tự đọc `field_edits` |
| **F-R07** | Lập lịch: W1 chạy `[[S1],[S2]]`; W2 chạy `[[S3],[S4,S5,S6]]`. S4, S5, S6 chạy song song (`02_conventions §3`) |
| **F-R08** | Workflow cập nhật tiến độ bằng `updateProgress` sau mỗi stage, thông điệp chỉ gồm tên stage và số đếm, không có PII |
| **F-R09** | W2 với `confirmation_mode = AUTO` **luôn** đánh giá lại ngưỡng trên evidence đã áp bản vá, với tham số Profile của chính W2. Kết quả client tính trước đó chỉ để hiển thị (U3-R14) |
| **F-R10** | Mỗi stage xong được ghi ngay vào `ctx.stepsResult` với `stage_key` và `extracted_data` = `StageResult` của stage đó (cùng cách `saveStep` của `loan-appraisal`), rồi gọi `updateProgress` để lưu checkpoint. `WorkflowStepResult.status` chỉ nhận `SUCCESS`/`PARTIAL_SUCCESS`/`FAILED`/`WAITING_REVIEW`, nên ánh xạ: `SUCCESS` → `SUCCESS`; `FAILED` → `FAILED`; mọi trạng thái khác → `PARTIAL_SUCCESS`. Trạng thái thật là `extracted_data.status`. Khi poll `view=compact`: lúc đang chạy, `metadata.pipeline_steps[]` có cả `extracted_data`; khi `SUCCEEDED`, nền tảng bỏ `extracted_data` khỏi từng bước (`lib/pipelines/format.ts`), nên giao diện lấy kết quả cuối từ `result.extracted_data.stages` (U1-R08). `extracted_data` cuối của Operation là `OcrOutput`/`CheckOutput` |

## 2. Task

### T-CAT-01 — Script đồng bộ catalog vào code
- Depends: —
- Files: `scripts/sync-loan-catalogs.mjs`, `lib/loan-dossier/catalog/data/` (sinh ra), `tests/loan-dossier/catalog-sync.test.ts`
- Refs: F-R01
- Làm: Script copy `docs/loan-appraisal/spec-v3/03_catalogs/*.json` và `doc_schemas/` vào `lib/loan-dossier/catalog/data/`. Thêm `"sync:loan-catalogs"` vào `package.json`.
- DoD:
  - test: mọi file trong `03_catalogs/` có bản trùng nội dung (so SHA-256) trong `data/`
  - test: không có file thừa trong `data/`
  - chạy script hai lần liên tiếp cho cùng kết quả (idempotent)
- Verify: `npm run sync:loan-catalogs && npx jest tests/loan-dossier/catalog-sync.test.ts`

### T-CAT-02 — Bộ nạp catalog dùng chung
- Depends: T-CAT-01
- Files: `lib/loan-dossier/catalog/index.ts`, `tests/loan-dossier/catalog-index.test.ts`
- Refs: F-R01
- Làm: `loadDocTypes()`, `loadEnums()`, `loadReasonCodes()`, `loadSlFields()`; `isReasonCode(code, scope?)`; `docTypeByKey(key)`. Parse bằng zod, cache theo process.
- DoD:
  - test: 47 loại chứng từ, trong đó 27 `needs_extraction = true` và 20 `false`
  - test: `isReasonCode('DOCUMENT_NOT_FOUND', 'CHK')` true; mã lạ false
  - test: `loadEnums().SlCompareStatus` có đủ 6 giá trị; `loadEnums().CheckRunStatus` có 3 giá trị
  - test: file hỏng (mock) → ném lỗi nêu tên file
- Verify: `npx jest tests/loan-dossier/catalog-index.test.ts`

### T-EDIT-01 — Áp bản vá lên evidence (hàm thuần)
- Depends: T-S2-02, T-U2-04
- Files: `lib/loan-dossier/edits/apply.ts`, `tests/loan-dossier/edits-apply.test.ts`
- Refs: D-03, F-R06
- Làm: `FieldEditSchema` (zod, 04_data_model §5); `applyEdits(evidences, edits): {evidences, report: {applied, skipped}}`. Theo (`evidence_id`, `field_path`) lấy bản có `edited_at` mới nhất (hòa → bản đứng sau trong mảng); kiểm theo bảng mã bỏ qua §5; áp được thì đặt `field_confidences` của field cấp 1 = `1.0` và `field_sources[field_path] = "HUMAN_EDIT"`. Không đổi object đầu vào.
- DoD:
  - test: không có bản vá → kết quả bằng đầu vào (sâu) nhưng là bản sao, `report` rỗng
  - test: hai bản vá cùng field → bản `edited_at` mới nhất thắng
  - test: `data.parties[1].full_name` áp đúng phần tử
  - test: mỗi mã của §5 (`ORPHAN_EDIT`, `FIELD_NOT_EDITABLE`, `EDIT_ON_ERROR_EVIDENCE`, `EDIT_BASE_CHANGED`, `INVALID_VALUE`) có 1 test
  - test: `original_value` khác hoa thường/khoảng trắng nhưng giống sau chuẩn hóa → vẫn áp
  - test: `report` chỉ chứa `evidence_id`, `field_path`, `code` (không giá trị)
- Verify: `npx jest tests/loan-dossier/edits-apply.test.ts`

### T-RUN-02 — Lập lịch stage
- Depends: —
- Files: `lib/loan-dossier/run/scheduler.ts`, `tests/loan-dossier/run-scheduler.test.ts`
- Refs: F-R07, 02_conventions §3
- Làm: `planRun(workflow: 'OCR'|'CHECK'): StageKey[][]` và `settleDependency(stage, depResults): 'RUN'|'UNAVAILABLE'`. Hàm thuần.
- DoD:
  - test: `OCR` → `[[classify],[extract_evidence]]`
  - test: `CHECK` → `[[map_dossier_roles],[check_checklist, cross_check_documents, compare_ocr_sl]]`
  - test: dependency `FAILED` → `UNAVAILABLE`/`DEPENDENCY_FAILED`
  - test: dependency `PARTIAL_SUCCESS`/`INSUFFICIENT_DATA` → `RUN`
  - test: S5 không phụ thuộc S4 (S4 `FAILED` vẫn `RUN` S5)
- Verify: `npx jest tests/loan-dossier/run-scheduler.test.ts`

### T-RUN-06 — Port `StageRunner` và bản giả lập
- Depends: T-CON-02
- Files: `lib/loan-dossier/run/stage-runner.ts`, `tests/loan-dossier/run-stage-runner.test.ts`
- Refs: F-R03, F-R04
- Làm: `interface StageRunner { classify(files, hints); extract(classifyData, files); mapRoles(input); checkChecklist(input); crossCheck(input); compareOcrSl(input) }`, mỗi hàm trả `StageResult` hợp lệ theo T-CON-01/02. `FakeStageRunner` trả dữ liệu giả tất định khai báo ngay trong module (không import từ `tests/`), suy ra từ số file và `file_id`. `resolveStageRunner(env)` theo F-R04.
- DoD:
  - test: mọi kết quả của `FakeStageRunner` parse qua schema hợp đồng
  - test: cùng đầu vào → cùng đầu ra (tất định)
  - test: `NODE_ENV=production` + `fake` → ném `StageRunnerError` mã `STAGE_RUNNER_MISCONFIGURED`
  - test: không đặt biến → trả bản thật (T-RUN-07); khi bản thật chưa có thì ném `STAGE_RUNNER_NOT_IMPLEMENTED`
- Verify: `npx jest tests/loan-dossier/run-stage-runner.test.ts`

### T-RUN-05 — Đăng ký hai workflow trong endpoint registry
- Depends: T-CAT-02
- Files: `lib/endpoints/registry.ts`, `tests/loan-dossier/run-registry.test.ts`
- Refs: R-R02, R-R04, D-06
- Làm: Thêm 2 sub-case vào `SERVICE_REGISTRY.workflows.subCases`: `loan-dossier-ocr` (tham số `flow`, `dossier_submitted_at`, `upload_hints`; `auto_check_enabled`, `auto_check_min_confidence` có `defaultLocked: true`, hiện trên trang Profile — **không** `hidden`) và `loan-dossier-check` (chỉ `auto_check_*`). `connections: []`, `isWorkflow: true`. Thêm vào `ENDPOINT_ALLOWED_EXTENSIONS`: W1 `.pdf,.jpg,.jpeg,.png`; W2 `.json`. Không sửa sub-case có sẵn.
- DoD:
  - test: hai slug có trong `getAllEndpointSlugs()`
  - test: `auto_check_*` của cả hai sub-case là `defaultLocked`, không `hidden`
  - test: `resolveAllowedExtensions('workflows:loan-dossier-check') === '.json'`
  - test: sub-case `loan-appraisal` không đổi (so khóa và mô tả)
- Verify: `npx jest tests/loan-dossier/run-registry.test.ts`

### T-RUN-03 — Workflow W1 `loan-dossier-ocr`
- Depends: T-RUN-02, T-RUN-05, T-RUN-06, T-CON-03, T-U2-03, T-U3-04, T-U3-09
- Files: `lib/pipelines/workflows/loan-dossier-ocr.ts`, `tests/loan-dossier/run-workflow-ocr.test.ts`
- Refs: 04_data_model §3, D-06, D-07, D-08, F-R05, F-R08, F-R10
- Làm: `runLoanDossierOcr(ctx)`: kiểm đầu vào (§3; sai → `failWorkflow` với `INVALID_OCR_INPUT`); bỏ file trùng `file_id` (S1-R13); chạy S1 rồi S2 qua `StageRunner`; dựng `review_issues`, `suggestions`, `auto_eval` (tham số Profile từ `ctx.pipelineVars`; giá trị ngoài [0.80, 1.00] → coi như tắt và ghi log mã `AUTO_CONFIG_INVALID`); `completeWorkflow` với `OcrOutput`. Đăng ký `'loan-dossier-ocr'` trong `WORKFLOW_REGISTRY`.
- DoD (ctx giả, `FakeStageRunner`):
  - test: 2 file → `OcrOutput` parse qua `OcrOutputSchema`, có `classify` và `extract_evidence`; `ctx.stepsResult` có 2 mục với `stage_key` đúng (F-R10)
  - test: thiếu `flow` hoặc `upload_hints` lệch số file → `failWorkflow` nhận lỗi có thông điệp bắt đầu `INVALID_INPUT: INVALID_OCR_INPUT`, không chứa tên file
  - test: stage trả `INSUFFICIENT_DATA` → bước trong `ctx.stepsResult` có `status = PARTIAL_SUCCESS`, `extracted_data.status = INSUFFICIENT_DATA` (F-R10)
  - test: S1 `FAILED` → S2 `UNAVAILABLE`/`DEPENDENCY_FAILED` (chỉ `FAILED` chặn, `settleDependency`), Operation vẫn `SUCCEEDED` (D-08)
  - test: tham số `auto_check_enabled = true`, `0.5` → `auto_eval.enabled = false`
  - test: thông điệp `updateProgress` không chứa giá trị OCR
  - test: `'loan-dossier-ocr'` có trong `WORKFLOW_REGISTRY`; `'loan-appraisal'` vẫn còn
- Verify: `npx jest tests/loan-dossier/run-workflow-ocr.test.ts`

### T-RUN-04 — Workflow W2 `loan-dossier-check`
- Depends: T-RUN-02, T-RUN-05, T-RUN-06, T-CON-04, T-EDIT-01, T-U3-02, T-U3-09, T-U3-10
- Files: `lib/pipelines/workflows/loan-dossier-check.ts`, `tests/loan-dossier/run-workflow-check.test.ts`
- Refs: 04_data_model §4, D-02, D-03, D-07, F-R05, F-R06, F-R07, F-R09, F-R10, A-R10
- Làm: `runLoanDossierCheck(ctx)`: đúng 1 file `.json` ≤ 20 MB (tự kiểm, không tin danh sách đuôi của route — A-R10) → parse `CheckInputSchema` (lỗi → `INVALID_CHECK_INPUT` / `UNSUPPORTED_CONTRACT_VERSION`, chỉ liệt kê `field_path`); `applyEdits`; nếu `AUTO`: tắt → `AUTO_NOT_ALLOWED`, không đạt → `AUTO_NOT_ELIGIBLE`, đạt → `toAutoPayload`; `toSlInput`, `extractExternalInput`; chạy S3 rồi S4/S5/S6 song song qua `StageRunner`; `completeWorkflow` với `CheckOutput`. Đăng ký `'loan-dossier-check'`.
- DoD (ctx giả, `FakeStageRunner`):
  - test: `RM` hợp lệ → `check_status = COMPLETED`, 4 stage, `edit_report` đúng
  - test: S3 ném lỗi → S3 `FAILED`, S4–S6 `UNAVAILABLE`, Operation vẫn `SUCCEEDED`
  - test: S5 lỗi không làm S4, S6 dừng
  - test: `AUTO` khi Profile tắt → `AUTO_NOT_ALLOWED`, `stages = null`, `StageRunner` không được gọi
  - test: `AUTO` không đạt → `AUTO_NOT_ELIGIBLE` kèm `reasons`; đạt → `COMPLETED`, `confirmation_mode = AUTO`
  - test: 0 file, 2 file, file `.pdf` → `INVALID_CHECK_INPUT`
  - test: `errorMessage` khi đầu vào sai không chứa giá trị mẫu (`NGUYEN VAN A`)
- Verify: `npx jest tests/loan-dossier/run-workflow-check.test.ts`

### T-RUN-07 — Cắm engine thật vào `StageRunner`
- Depends: T-RUN-06, T-S1-07, T-S2-09, T-S3-15, T-S4-10, T-S5-10, T-S6-09
- Files: `lib/loan-dossier/run/real-stage-runner.ts`, `tests/loan-dossier/run-real-stage-runner.test.ts`
- Refs: F-R03
- Làm: `RealStageRunner` nối mỗi hàm của port với `runClassify`, `runExtract`, `runMapDossier`, `runChecklist`, `runCrossCheck`, `runCompareOcrSl`, truyền các port model/LLM. `resolveStageRunner` trả bản này khi không bật giả lập.
- DoD (port model giả):
  - test: mỗi hàm gọi đúng engine và trả kết quả parse qua hợp đồng
  - test: engine ném lỗi → `StageResult` `FAILED` với `ENGINE_CRASH`, không ném ra ngoài
  - test: `resolveStageRunner({})` không còn ném `STAGE_RUNNER_NOT_IMPLEMENTED`
- Verify: `npx jest tests/loan-dossier/run-real-stage-runner.test.ts`
