# U4 — Giai đoạn 2: Kết quả kiểm tra hồ sơ

> **Nền v2 (D-32, 2026-10-16):** giao diện `/loan-dossier` **không làm**; giao diện là `/loan-appraisal-v2` theo V2-R10 ở [cross_cutting/v2_integration.md](../cross_cutting/v2_integration.md). Giữ file để tra cứu.

Nội dung tab "Giai đoạn 2. Kiểm tra hồ sơ" (U1-R09). Giữ dáng `AppraisalWorkspace` của v2: banner trạng thái ở đầu, rồi một `Card` chứa `Tabs` các chế độ xem chi tiết, mỗi tab bọc `ErrorBoundary`. Dữ liệu là `CheckOutput` của W2 (chỉ đọc). Thiết kế màn kết quả là đề xuất của spec (BU chỉ có nút "Chạy AI Agent kiểm tra") — OQ-07.

Không có thao tác ghi: CO chọn giá trị chuẩn và xác nhận bảng OCR ↔ SL ở hệ thống gọi (S6-R12, R-R06).

## 1. Bố cục

```text
┌ [Kết quả cũ] Kết quả của lần chạy trước — bản sửa/form đã đổi ─ [Chạy lại kiểm tra] ┐  ← ProvisionalBanner
┌ [Tự động] Hồ sơ chạy kiểm tra tự động, RM chưa xác nhận thông tin … ──────────────────┐
┌ Tổng quan kiểm tra ───────────────────────────────────────────────────────────────────┐
│ [S3 Hoàn tất] [S4 Cần rà soát] [S5 Cần rà soát] [S6 Cần rà soát]                       │
│ Checklist 82% đủ · 3 lệch đối chiếu chéo · 5 dòng OCR ↔ SL cần xử lý     [Xuất CSV ▼]  │
└───────────────────────────────────────────────────────────────────────────────────────┘
┌ Người & tài sản │ Checklist │ Đối chiếu chéo │ OCR ↔ SL ─────────────────────────────┐
│ … nội dung tab …                                                                      │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Các tab

| Tab | Nguồn dữ liệu | Nội dung |
|---|---|---|
| **Người & tài sản** | S3 `role_registry`, `asset_registry`, `relationship_verifications` | Mỗi người: tên, vai trò, số định danh hiện tại, kết quả kiểm số (`id_number_check`); mỗi tài sản: loại, định danh, chủ sở hữu hiện tại, `context_status`; quan hệ chủ TSBĐ ↔ người vay. Dáng thẻ `CustomerProfile` của v2 |
| **Checklist** | S4 `items`, `summary_by_group`, `completeness_percent` | 5 nhóm của catalog; mỗi mục: tên, trạng thái, lý do, hành động đề nghị, nguồn tìm thấy. Dáng `IntakeTable` của v2 |
| **Đối chiếu chéo** | S5 `results`, `logic_findings` | Nhóm theo người/tài sản; mỗi dòng: trường, các giá trị và nguồn, trạng thái, mức độ. Dáng `CrossCheckMatrix` + `BusinessWarnings` của v2 |
| **OCR ↔ SL** | S6 `results`, `content_preview` | Bảng so SL với OCR kèm gợi ý giá trị chuẩn; chỉ đọc |

Stage `UNAVAILABLE`/`FAILED`/`INSUFFICIENT_DATA`/`NOT_EVALUATED` thay nội dung tab bằng `EmptyState` gồm `message` + `blocking_inputs[]` và liên kết về thẻ tương ứng ở Giai đoạn 1.

## 3. Rule

| ID | Rule |
|---|---|
| **U4-R01** | Chưa có W2: `EmptyState` "Chưa có kết quả kiểm tra" — "Rà soát OCR, xác nhận thông tin ở Giai đoạn 1 rồi bấm Chạy kiểm tra hồ sơ." W2 đang chạy: stage nào xong hiện ngay (S3 trước, S4/S5/S6 sau), tab chưa có dữ liệu hiện "Đang chạy" |
| **U4-R02** | Dải trạng thái 4 chip (S3…S6) dùng `Badge` của v2: `SUCCESS` "Hoàn tất", `PARTIAL_SUCCESS` "Cần rà soát", `INSUFFICIENT_DATA` "Thiếu dữ liệu", `UNAVAILABLE` "Không khả dụng", `FAILED` "Lỗi hệ thống", `NOT_EVALUATED` "Không áp dụng". Bấm chip → chuyển tab tương ứng |
| **U4-R03** | Số tóm tắt (ở "Tổng quan kiểm tra" và thẻ tóm tắt U1-R13) chỉ lấy từ `content_preview` của S4, S5, S6 (`completeness_percent`, `mismatch_count`, `requires_review_count`…). Không tính lại ở client |
| **U4-R04** | **Checklist**: giữ thứ tự nhóm I–V (`group_no`). Trạng thái: `PRESENT` "Đủ", `SUBSTITUTED` "Đủ (thay thế)", `MISSING` "Thiếu", `NEEDS_RESCAN` "Cần scan lại", `NEEDS_REVIEW` "Cần xem lại", `NOT_APPLICABLE` "Không áp dụng". Mặc định ẩn `NOT_APPLICABLE`; công tắc "Hiện mục không áp dụng". Lọc theo trạng thái. `SUBSTITUTED` ghi rõ chứng từ thay thế |
| **U4-R05** | Mục `PERSON`/`ASSET` nhóm theo người/tài sản (tên từ S3); mục `DOSSIER` ở đầu nhóm |
| **U4-R06** | Mục `MISSING` + `UPLOAD` hoặc `RESCAN` có nút "Tải bổ sung" → chuyển Giai đoạn 1 và cuộn lên vùng kéo thả ở cột trái (không tự xóa kết quả; thêm tệp mới kích hoạt U1-R05). `REVIEW_CONTEXT` → liên kết sang tab Người & tài sản |
| **U4-R07** | Mỗi mục có "Nguồn" (`found_in[]`): tên tệp và số trang dạng chữ (không mở ảnh trang, U2-R12). `condition_result = INPUT_NOT_PROVIDED` nêu rõ thiếu thông tin ở form xác nhận, liên kết tới mục tương ứng ở U3. Mục có `expired_evidence_ids` khác rỗng: dòng `PRESENT` hiện `note` (bản cũ hết hạn, đang dùng bản mới); dòng `MISSING`/`DOCUMENT_EXPIRED` hiện `message` (ngày cấp tối thiểu của bản cần bổ sung) và tên tệp bản hết hạn (S4-R23) |
| **U4-R08** | **Đối chiếu chéo**: mặc định chỉ `MISMATCH` và `UNDETERMINED`; công tắc "Hiện cả khớp". Sắp `severity` HIGH → REVIEW → INFO, sau đó theo người. Mỗi dòng mở rộng (`Disclosure`) xem `values[]` (giá trị, tệp, trang, `duplicate_status`) và `reason`. `canonical_source` chỉ hiện là "Nguồn tham chiếu", không dùng chữ "đúng/sai" |
| **U4-R09** | `logic_findings` hiển thị riêng khối "Kiểm tra logic" (dáng `BusinessWarnings`): chỉ `violated = true`; nhãn "Cần BA xác nhận" khi `needs_ba_confirmation = true` (OQ-05) |
| **U4-R10** | **OCR ↔ SL**: cột Người/Tài sản, Trường, SL, OCR (kèm nguồn), Trạng thái, **Gợi ý giá trị chuẩn** (`suggested_value` + nhãn "theo SL"/"theo OCR"; `null` → "CO cần chọn"). Bộ lọc "Tất cả" / "Khớp" / "Cần xử lý" (mặc định, S6-R15). Không có ô sửa, không có nút xác nhận |
| **U4-R11** | Dưới bảng OCR ↔ SL luôn có dòng chú thích: "Giá trị chuẩn do CO quyết định ở hệ thống nghiệp vụ. DUGate chỉ gợi ý." |
| **U4-R12** | **Xuất CSV** theo tab (Checklist, Đối chiếu chéo, OCR ↔ SL), dựng ở trình duyệt bằng `toCsv` + `withBom` của v2, giá trị PII che theo S-R07 (T-SEC-01). Tên tệp `loan-dossier-{8 ký tự operation W2}-{s4|s5|s6}.csv`. Không gọi API |
| **U4-R13** | Stage `FAILED`: hiện `status_code` + `message` + mã tham chiếu operation W2 (8 ký tự), kèm "Chạy lại kiểm tra". Không hiện stack trace hay lỗi thô |
| **U4-R14** | Thông tin hồ sơ: dòng phụ của "Tổng quan kiểm tra" ghi `flow`, `dossier_submitted_at`, `confirmation_mode` ("RM xác nhận" / "Tự động") và `edit_report` ("Áp {n} chỉnh sửa, bỏ qua {m}"); bấm vào số bỏ qua → danh sách (`evidence_id`, nhãn field, mã) |
| **U4-R15** | **Kết quả cũ**: sau W2, nếu tệp, bản vá hoặc form đổi (so dấu vân tay `CheckInput` lúc gửi), hiện banner `warning` "Kết quả của lần chạy trước — cần chạy lại kiểm tra" kèm nút "Chạy lại kiểm tra" (dáng `ProvisionalBanner`). Kết quả cũ vẫn xem được |
| **U4-R16** | **Bản tự động** (`confirmation_mode = AUTO`, `content_preview.independent = false`): banner `warning` đầu tab "Hồ sơ chạy kiểm tra tự động, RM chưa xác nhận thông tin. Thiếu đầu vào ngoài OCR (mã ngoại lệ, TSBĐ đang thế chấp nơi khác); bảng OCR ↔ SL không có giá trị đối chiếu độc lập." kèm nút "Điền form xác nhận" → chuyển Giai đoạn 1, cuộn tới thẻ xác nhận (U3-R18) |
| **U4-R17** | Ai mở được trang và đọc được operation (R-R03) xem được mọi tab, kể cả giá trị OCR/SL |

## 4. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| U4-AC01 | Given S3 xong, S4–S6 đang chạy / Then tab Người & tài sản có dữ liệu, các chip còn lại "Đang chạy" | R01 |
| U4-AC02 | Given S3 `FAILED` / Then S4–S6 hiện `UNAVAILABLE` kèm mã `DEPENDENCY_FAILED` và nút Chạy lại kiểm tra | R02, R13 |
| U4-AC03 | Given S5 `UNAVAILABLE` / `ROLE_REGISTRY_UNAVAILABLE` / Then tab Đối chiếu chéo chỉ có `EmptyState` thông báo | §2 |
| U4-AC04 | Given mục checklist `SUBSTITUTED` / Then nêu chứng từ thay thế | R04 |
| U4-AC05 | Given mục `NOT_APPLICABLE` / Then mặc định không hiện; bật công tắc thì hiện | R04 |
| U4-AC06 | Given mục `MISSING`, `UPLOAD` / When bấm "Tải bổ sung" / Then chuyển Giai đoạn 1, focus vùng kéo thả, kết quả chưa bị xóa | R06 |
| U4-AC07 | Given điều kiện `INPUT_NOT_PROVIDED` / Then mục nêu thiếu thông tin ở form xác nhận | R07 |
| U4-AC08 | Given 12 dòng S5, 3 lệch / Then mặc định hiện 3 dòng, công tắc hiện 12 | R08 |
| U4-AC09 | Given `needs_ba_confirmation` / Then có nhãn "Cần BA xác nhận" | R09 |
| U4-AC10 | Given dòng S6 `UNDETERMINED` / Then cột gợi ý ghi "CO cần chọn"; không có ô sửa hay nút xác nhận nào | R10, R11 |
| U4-AC11 | Given xuất CSV OCR ↔ SL / Then ô số định danh chỉ còn 4 số cuối, có BOM, không có request mạng | R12 |
| U4-AC12 | Given sửa 1 giá trị OCR sau khi W2 xong / Then banner "Kết quả của lần chạy trước" hiện | R15 |
| U4-AC13 | Given `confirmation_mode = AUTO` / Then banner tự động hiện; "Điền form xác nhận" chuyển tới thẻ xác nhận | R16 |
| U4-AC14 | Given `edit_report.skipped` có 2 mục / Then dòng phụ ghi "bỏ qua 2" và mở được danh sách mã | R14 |

## 5. Task

### T-U4-01 — View-model checklist
- Depends: T-CON-02, T-CAT-02
- Files: `lib/loan-dossier/ui/checklist-view.ts`, `tests/loan-dossier/ui-checklist-view.test.ts`
- Refs: U4-R04, U4-R05, U4-R06, U4-R07
- Làm: `buildChecklistView(s4Data, s3Data, opts:{showNotApplicable, statusFilter}): ChecklistGroupView[]` — nhóm theo `group_no`, mục `DOSSIER` trước, mục `PERSON`/`ASSET` gom theo tên; trạng thái → nhãn và `tone`; `action` (`UPLOAD`/`RESCAN`/`REVIEW_CONTEXT`/`NONE`) kèm đích điều hướng.
- DoD:
  - test: 5 nhóm đúng thứ tự I–V
  - test: `NOT_APPLICABLE` bị ẩn mặc định, hiện khi bật
  - test: `SUBSTITUTED` có `substitutedBy`
  - test: `INPUT_NOT_PROVIDED` → `needsInput` trỏ mục U3
  - test: `statusFilter=['MISSING']` chỉ còn mục `MISSING`
  - test: mục `PERSON` hiện đúng tên từ `role_registry`
- Verify: `npx jest tests/loan-dossier/ui-checklist-view.test.ts`

### T-U4-02 — View-model đối chiếu chéo
- Depends: T-CON-02
- Files: `lib/loan-dossier/ui/crosscheck-view.ts`, `tests/loan-dossier/ui-crosscheck-view.test.ts`
- Refs: U4-R08, U4-R09
- Làm: `buildCrossCheckView(s5Data, s3Data, opts:{showMatches}): {groups, logicViolations}` — nhóm theo người/tài sản; sắp `HIGH`>`REVIEW`>`INFO`; mặc định chỉ `MISMATCH`/`UNDETERMINED`.
- DoD:
  - test: 12 dòng, 3 lệch → mặc định 3, `showMatches` → 12
  - test: thứ tự severity ổn định
  - test: `logic_findings` chỉ lấy `violated = true`; giữ `needs_ba_confirmation`
  - test: `canonical_source` đi vào trường `reference`, không có trường `correct`
- Verify: `npx jest tests/loan-dossier/ui-crosscheck-view.test.ts`

### T-U4-03 — View-model bảng OCR ↔ SL
- Depends: T-CON-02
- Files: `lib/loan-dossier/ui/ocrsl-view.ts`, `tests/loan-dossier/ui-ocrsl-view.test.ts`
- Refs: U4-R10, U4-R11, U4-R16
- Làm: `buildOcrSlView(s6Data, {filter}): {rows, counts, autoMode}`; mỗi dòng có `suggestionLabel` ("theo SL" / "theo OCR" / "CO cần chọn").
- DoD:
  - test: bộ lọc "Cần xử lý" bỏ `MATCH` và `NOT_APPLICABLE`
  - test: `suggested_value = null` → "CO cần chọn"
  - test: `confirmation_mode = AUTO` → `autoMode = true`
  - test: kết quả không có khóa `actions`, `editable`
- Verify: `npx jest tests/loan-dossier/ui-ocrsl-view.test.ts`

### T-U4-04 — View-model tổng quan, người & tài sản
- Depends: T-CON-02, T-U1-02
- Files: `lib/loan-dossier/ui/overview-view.ts`, `tests/loan-dossier/ui-overview-view.test.ts`
- Refs: U4-R02, U4-R03, U4-R13, U4-R14, U4-R16
- Làm: `buildStageStrip(stages): Chip[]` (S3…S6, nhãn, `tone`, `target`); `buildSummary(previews)` chỉ đọc `content_preview`; `buildPeopleAssets(s3Data)`; `buildRunInfo(checkOutput)` (flow, ngày nộp, chế độ, `edit_report`).
- DoD:
  - test: 6 giá trị `StageStatus` đều có nhãn
  - test: stage chưa có kết quả → "Đang chạy" khi W2 đang chạy, "Chưa chạy" khi chưa
  - test: `buildSummary` lấy nguyên số từ `content_preview`
  - test: `FAILED` → có mã operation, **không** có chuỗi lỗi thô
  - test: số định danh chỉ hiện 4 số cuối trong tóm tắt
- Verify: `npx jest tests/loan-dossier/ui-overview-view.test.ts`

### T-U4-05 — Xuất CSV ở trình duyệt (hàm thuần)
- Depends: T-SEC-01, T-U4-01, T-U4-02, T-U4-03
- Files: `lib/loan-dossier/ui/export-csv.ts`, `tests/loan-dossier/ui-export-csv.test.ts`
- Refs: U4-R12, S-R07
- Làm: `checklistCsv(view)`, `crossCheckCsv(view)`, `ocrSlCsv(view)` dùng `toCsv`/`withBom` của v2 và `maskId`/`maskName`/`maskAddress`/`maskBirthDate`/`csvSafe`; `csvFileName(operationId, stage)`.
- DoD:
  - test: CSV checklist có cột `item_key, scope, status, reason_code, message`
  - test: CSV S5/S6 che giá trị PII theo S-R07; số tiền không che
  - test: ô `=cmd()` được thêm `'`
  - test: bắt đầu bằng BOM UTF-8
- Verify: `npx jest tests/loan-dossier/ui-export-csv.test.ts`

### T-U4-06 — Các thẻ Giai đoạn 2
- Depends: T-U4-01, T-U4-02, T-U4-03, T-U4-04, T-U4-05, T-U1-07
- Files: `app/loan-dossier/components/check/CheckStage.tsx`, `.../CheckBanners.tsx`, `.../CheckOverviewCard.tsx`, `.../PeopleAssetsTab.tsx`, `.../ChecklistTab.tsx`, `.../CrossCheckTab.tsx`, `.../OcrSlTab.tsx`
- Refs: U4-R01…R17, U4-AC01…AC14
- Làm: Dựng theo §1, sao chép cấu trúc của `AppraisalWorkspace`, `ProvisionalBanner`, `IntakeTable`, `CrossCheckMatrix`, `BusinessWarnings`, `CustomerProfile` (v2); dùng `Tabs`, `DataTable`, `Disclosure`, `Badge`, `EmptyState`, `ErrorBoundary` của kit v2.
- DoD:
  - `npx tsc --noEmit` và `next lint --dir app/loan-dossier` không lỗi
  - đọc mã: không có ô sửa hay nút xác nhận trên bảng OCR ↔ SL
  - đọc mã: không dùng chữ "đúng/sai" cho `canonical_source`
  - đọc mã: không PII trong `title`/`aria-label`/`console.*`; xuất CSV không gọi `fetch`
- Verify: `npx tsc --noEmit -p tsconfig.json && npx next lint --dir app/loan-dossier`
