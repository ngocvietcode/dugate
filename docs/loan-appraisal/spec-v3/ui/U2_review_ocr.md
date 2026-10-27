# U2 — Giai đoạn 1: Tiếp nhận & rà soát OCR

> **Nền v2 (D-32, 2026-10-16):** giao diện `/loan-dossier` **không làm**; giao diện là `/loan-appraisal-v2` theo V2-R10 ở [cross_cutting/v2_integration.md](../cross_cutting/v2_integration.md). Giữ file để tra cứu.

Nội dung tab "Giai đoạn 1. Tiếp nhận & rà soát OCR" (U1-R09). Giữ thứ tự và dáng các thẻ của `IntakeWorkspace` (`components/loan-appraisal-v2/intake/`), thay dữ liệu `AppraisalResult` bằng `OcrOutput` của W1. Phần cuối tab là form xác nhận (U3).

Khác v2: người dùng **sửa được giá trị OCR** ngay trong thẻ "Kết quả OCR & bóc tách". Bản vá chỉ nằm trong bộ nhớ trang và được gửi kèm W2 (`field_edits`, 04_data_model §5).

## 1. Bố cục (thứ tự thẻ)

```text
┌ [Cần rà soát]  Hồ sơ cần rà soát trước khi kiểm tra ───────────────────────┐  ← ReadinessCard
│ 2 mục chặn · 3 mục cần xem · Ngưỡng tự động: chưa đạt (độ tin cậy 0.88/0.95)│
│ [Xem kết quả kiểm tra →]   Giai đoạn kiểm tra luôn xem được sau khi chạy.   │
└────────────────────────────────────────────────────────────────────────────┘
┌ ▤ Tình trạng & phân loại chứng từ   3 file · 5 chứng từ · [1 file lỗi] ────┐  ← ChecklistCoverage
│ scan-01.pdf · 6 trang   CCCD (tr.1–2) 95% ✓ · Đơn vay (tr.3–6) 88% ⚠       │
│ scan-02.jpg             Không nhận diện được → Tải lại                      │
└────────────────────────────────────────────────────────────────────────────┘
┌ ☰ Việc cần hoàn tất   5 nội dung cần rà soát ──────────────────────────────┐  ← "Việc cần hoàn tất"
│ ① scan-02.jpg: file không đọc được → scan lại                [Tới tệp]     │
│ ② Đơn vay · Ngày sinh: độ tin cậy 62%                       [Tới trường]   │
└────────────────────────────────────────────────────────────────────────────┘
┌ ⛁ Kết quả OCR & bóc tách   3 file · 5 chứng từ   [Trường dữ liệu|JSON] ────┐  ← OcrResults
│ ┌ scan-01.pdf ───────────────┐ ┌ scan-03.pdf ───────────────┐              │
│ │ ▸ CCCD · 8 trường          │ │ ▸ GCN QSDĐ · 12 trường     │              │
│ │   Họ và tên  NGUYEN VAN A   tr.1  99%  ✎                    │              │
│ │   Ngày sinh  1990-08-15     tr.1  62%⚠ ✎  [Đã sửa] [Hoàn tác]│             │
│ └────────────────────────────┘ └────────────────────────────┘              │
└────────────────────────────────────────────────────────────────────────────┘
┌ Xác nhận thông tin khách hàng (U3) ───────────────────────────────────────┐
```

**Không hiển thị ảnh trang** (D-24); cột nguồn chỉ ghi số trang dạng chữ. Phần "Thiếu tài liệu" theo checklist **không** nằm ở tab này vì S4 chỉ chạy ở W2 (U4).

## 2. Rule

| ID | Rule |
|---|---|
| **U2-R01** | Chưa có kết quả W1: `EmptyState` "Chưa có kết quả tiếp nhận" — "Tải hồ sơ và bắt đầu để xem kết quả tiếp nhận." như v2. W1 đang chạy: các thẻ hiện dữ liệu stage đã xong (S1 trước S2); mọi nút sửa bị khóa |
| **U2-R02** | **Tình trạng & phân loại chứng từ** (dáng `ChecklistCoverage`): mỗi tệp một nhóm, mỗi `matches[]` một dòng gồm nhãn loại (`doc_type_label` từ catalog), khoảng trang, `confidence`, cờ `needs_manual_review`, `hint_mismatch`, `instances_count`. Tệp có `status ≠ CLASSIFIED` hiện `message` và `next_action` tiếng Việt của S1. Badge tiêu đề: "{n} file lỗi" (`warning`) hoặc "Đã nhận diện đủ" (`success`) |
| **U2-R03** | **Kết quả OCR & bóc tách** (dáng `OcrResults`): lưới 2 cột theo tệp, mỗi chứng từ một `Disclosure` "{nhãn loại} · {n} trường", giữ nút chuyển "Trường dữ liệu" / "JSON". Chế độ trường: liệt kê các **lá nguyên thủy** của `data` (đường dẫn dạng `parties[0].full_name`) với Giá trị (hiệu lực), Nguồn/trang (`source_pages` của field cấp 1), Độ tin cậy (`field_confidences` của field cấp 1). Chế độ JSON: `data` **đã áp bản vá** |
| **U2-R04** | Sửa giá trị: bấm ✎ trên một lá → ô nhập tại chỗ → **Lưu** thêm 1 `FieldEdit` vào bộ nhớ (`original_value` = giá trị OCR, `edited_at` = giờ hiện tại). Không gọi API. Không sửa object/mảng. Dòng đã sửa có badge "Đã sửa", độ tin cậy "100% (người sửa)" |
| **U2-R05** | Kiểm giá trị trước khi lưu bằng cùng bộ chuẩn hóa của S2 (T-S2-03) theo kiểu field. Sai → báo lỗi ngay ô, không lưu. W2 kiểm lại (`INVALID_VALUE`, T-EDIT-01) |
| **U2-R06** | Giá trị trống: xóa nội dung = `null` (không phải `""`). Cho phép với field không bắt buộc của schema loại; field bắt buộc → "Không được để trống" |
| **U2-R07** | **Hoàn tác** trên dòng đã sửa: bỏ bản vá khỏi bộ nhớ; chú giải hiện giá trị OCR gốc và lý do sửa nếu có. Mỗi lần sửa/hoàn tác sau khi đã có kết quả W2 → Giai đoạn 2 gắn "Kết quả cũ" (U4-R15) |
| **U2-R08** | Mức tin cậy: ≥ 0.90 "tốt", 0.80–<0.90 "cần xem", < 0.80 "thấp". Màu `toneClasses` của v2 **kèm biểu tượng/chữ** (không chỉ màu) |
| **U2-R09** | **Việc cần hoàn tất** (dáng thẻ cùng tên của v2, danh sách đánh số trên nền `warning`): `review_issues` của W1, tính lại trên evidence đã áp bản vá ở client (T-U2-03), sắp `BLOCK` → `REVIEW` → `INFO`. Gồm: tệp `UNKNOWN`/`UNSUPPORTED_FILE`/`PASSWORD_PROTECTED`/`CORRUPTED_FILE`; evidence `ERROR`; field cấp 1 tin cậy < 0.80 (trừ đã sửa); nhóm trùng `CONFLICTING_DUPLICATES`/`DUPLICATE_CANDIDATE`; `hint_mismatch`; `repeated_doc_types`. Mỗi mục có nút "Tới tệp"/"Tới trường" mở `Disclosure` và cuộn tới dòng. Không còn mục → khung `success` "Không còn nội dung cần rà soát." |
| **U2-R10** | Tệp `UNKNOWN`/lỗi và evidence `ERROR` còn hiện thêm ở hai thẻ "Tài liệu cần xác nhận loại" và "Chứng từ chưa đọc được dữ liệu" như v2 |
| **U2-R11** | **Thẻ trạng thái tiếp nhận** (dáng `ReadinessCard`): badge + tiêu đề theo `review_issues` ("Có mục chặn cần xử lý" / "Hồ sơ cần rà soát trước khi kiểm tra" / "Đã sẵn sàng chạy kiểm tra"), số mục `BLOCK`/`REVIEW`; khi Profile bật ngưỡng tự động (`auto_eval.enabled`) hiện thêm dòng "Ngưỡng tự động: đạt / chưa đạt (độ tin cậy {observed}/{threshold})" — `auto_eval` tính lại ở client sau mỗi lần sửa (T-U3-09). Nút "Xem kết quả kiểm tra →" chuyển sang Giai đoạn 2 |
| **U2-R12** | **Không có xem ảnh trang.** Không gọi, không nhúng ảnh hay PDF của hồ sơ; không có `<img>`/`<iframe>`/`<embed>`/`<object>` trỏ tới file hồ sơ. Cột nguồn chỉ hiện số trang dạng chữ (VD `tr.1–2`); field không có `source_pages` hiện "—" |
| **U2-R13** | Gửi lại W1 (thêm/bớt tệp hoặc "Chạy lại OCR"): bản vá được khớp lại theo (`evidence_id`, `field_path`). Bản vá có `evidence_id` không còn, hoặc giá trị OCR mới khác `original_value` → hiện khung `warning` "Có {n} chỉnh sửa không còn áp dụng" kèm danh sách (tên loại chứng từ + nhãn field, không giá trị) và nút "Bỏ các chỉnh sửa này" |
| **U2-R14** | Giá trị OCR không vào `title`, `aria-label`, URL hay `console` (thuộc tính `title` của v2 chỉ dùng cho tên tệp) |

## 3. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| U2-AC01 | Given W1 đang chạy, S1 đã xong / Then thẻ phân loại có dữ liệu, thẻ OCR là `EmptyState`, nút ✎ bị khóa | R01 |
| U2-AC02 | Given tệp `.pdf` có mật khẩu / Then có trong "Việc cần hoàn tất" với `next_action` và trong "Tài liệu cần xác nhận loại" | R02, R09, R10 |
| U2-AC03 | Given sửa ngày sinh thành `31/02/1990` / Then báo lỗi tại ô, bản vá không được thêm | R05 |
| U2-AC04 | Given sửa tên / Then dòng hiện "Đã sửa", tin cậy 100% (người sửa), có nút Hoàn tác, không có request mạng nào | R04, R07 |
| U2-AC05 | Given hoàn tác / Then giá trị về OCR gốc và bản vá biến mất khỏi bộ nhớ | R07 |
| U2-AC06 | Given field tin cậy 0.62 chưa sửa / Then có trong "Việc cần hoàn tất"; sửa xong thì biến mất | R08, R09 |
| U2-AC07 | Given chạy lại OCR sau khi thêm 1 tệp / Then bản vá của chứng từ không đổi vẫn áp; bản vá mồ côi được liệt kê | R13 |
| U2-AC08 | Given chế độ JSON / Then `data` hiện giá trị đã sửa | R03 |
| U2-AC09 | Given evidence có `source_pages` / Then cột nguồn hiện số trang dạng chữ và không có request nào tới file hồ sơ | R12 |
| U2-AC10 | Given Profile bật ngưỡng, độ tin cậy nhỏ nhất 0.88, ngưỡng 0.95 / Then thẻ trạng thái ghi "chưa đạt (0.88/0.95)"; sửa field đó xong thì cập nhật | R11 |
| U2-AC11 | Given không còn mục nào / Then "Việc cần hoàn tất" hiện "Không còn nội dung cần rà soát." | R09 |

## 4. Task

### T-U2-01 — View-model phân loại chứng từ
- Depends: T-CAT-02, T-CON-01
- Files: `lib/loan-dossier/ui/inventory.ts`, `tests/loan-dossier/ui-inventory.test.ts`
- Refs: U2-R02, U2-R10
- Làm: `buildInventory(classifyData, docTypes): {files: InventoryFile[], errorFileCount}` — mỗi tệp: tên, số trang, trạng thái, thông điệp, `next_action`, các dòng loại chứng từ (nhãn, `page_range`, độ tin cậy, `tone`, cờ).
- DoD:
  - test: tệp 2 loại → 2 dòng; nhãn lấy từ catalog
  - test: tệp `PASSWORD_PROTECTED` → có `message` và `next_action`, không có dòng loại
  - test: `needs_manual_review` → `tone = 'warning'`
  - test: thứ tự tệp giữ theo `files[]` của S1
- Verify: `npx jest tests/loan-dossier/ui-inventory.test.ts`

### T-U2-02 — Làm phẳng evidence thành dòng bảng
- Depends: T-S2-02
- Files: `lib/loan-dossier/ui/flatten-evidence.ts`, `tests/loan-dossier/ui-flatten-evidence.test.ts`
- Refs: U2-R03, U2-R04, U2-R06, U2-R08
- Làm: `flattenEvidence(evidence, appliedEdits): EvidenceRow[]` với `EvidenceRow = {path, label, value, confidence, tone, sourcePage, edited, editable, required}`. Nhãn: `title` trong JSON Schema của loại nếu có, ngược lại phần cuối của đường dẫn. `tone` theo U2-R08.
- DoD:
  - test: `data.parties[1].full_name` thành `parties[1].full_name`, độ tin cậy lấy theo `parties`
  - test: object và mảng không thành dòng (chỉ lá)
  - test: lá `null` vẫn là dòng, `editable = true`
  - test: dòng đã sửa → `edited = true`, `confidence = 1`, `tone = 'success'`
  - test: field cấp 1 không có `field_confidences` → 0 và `tone = 'danger'`
  - test: evidence `ERROR` → không có dòng nào
  - test: biên tone: 0.90 → success, 0.8999 → warning, 0.80 → warning, 0.7999 → danger
- Verify: `npx jest tests/loan-dossier/ui-flatten-evidence.test.ts`

### T-U2-03 — Danh sách "Việc cần hoàn tất"
- Depends: T-U2-01, T-U2-02, T-CON-03
- Files: `lib/loan-dossier/ui/review-issues.ts`, `tests/loan-dossier/ui-review-issues.test.ts`
- Refs: U2-R09, U2-R11
- Làm: `buildReviewIssues(classifyData, evidences): ReviewIssue[]` (kiểu `ReviewIssueSchema` của T-CON-03) với `{id, kind, severity, file_id, evidence_id?, field_path?, message}`; `hasBlocking(issues)`; `readinessHeadline(issues)`. Dùng chung ở W1 (server, trên OCR gốc) và giao diện (trên evidence đã áp bản vá).
- DoD:
  - test: tệp không đọc được và evidence `ERROR` → `BLOCK`
  - test: tin cậy < 0.80 → `REVIEW`; đã sửa (tin cậy 1.0 sau `applyEdits`) → không có
  - test: `CONFLICTING_DUPLICATES` → `REVIEW`; `hint_mismatch` → `INFO`
  - test: thứ tự `BLOCK` trước `REVIEW` trước `INFO`, ổn định; `id` tất định
  - test: `readinessHeadline` ra 3 tiêu đề của U2-R11
  - test: thông điệp không chứa giá trị OCR (chỉ tên tệp, loại, nhãn field)
- Verify: `npx jest tests/loan-dossier/ui-review-issues.test.ts`

### T-U2-04 — Kiểm giá trị sửa
- Depends: T-S2-03
- Files: `lib/loan-dossier/ui/edit-validate.ts`, `tests/loan-dossier/ui-edit-validate.test.ts`
- Refs: U2-R05, U2-R06
- Làm: `validateEditValue(valueType, raw, {required}): {ok: true, value: string|number|boolean|null} | {ok: false, message}`. Dùng lại hàm chuẩn hóa của T-S2-03. `valueType` suy ra từ schema loại (hoặc `sl_fields.json` cho field có trong đó). Dùng chung ở giao diện và T-EDIT-01.
- DoD:
  - test: ngày `31/02/1990` lỗi; `15/08/1990` → `1990-08-15`
  - test: tiền `1.000.000` → `1000000`; `-5` lỗi
  - test: CCCD 11 số lỗi; 12 số giữ số 0 đầu
  - test: chuỗi rỗng + `required` → lỗi; không `required` → `null`
- Verify: `npx jest tests/loan-dossier/ui-edit-validate.test.ts`

### T-U2-05 — Kho bản vá phía giao diện (hàm thuần)
- Depends: T-EDIT-01
- Files: `lib/loan-dossier/ui/edit-store.ts`, `tests/loan-dossier/ui-edit-store.test.ts`
- Refs: U2-R04, U2-R07, U2-R13
- Làm: reducer `editStoreReducer(state, action)` với `ADD {evidence_id, field_path, original_value, value, reason, edited_at}`, `REVERT {evidence_id, field_path}`, `DROP_ORPHANS`; `effectiveView(evidences, state)` gọi `applyEdits` (T-EDIT-01) và trả `{evidences, report}`; `orphans(report)` lấy các mục `ORPHAN_EDIT`/`EDIT_BASE_CHANGED`; `toFieldEdits(state)` cho `CheckInput`.
- DoD:
  - test: `ADD` hai lần cùng field → chỉ giữ bản sau
  - test: `REVERT` xóa đúng một bản vá
  - test: evidence mới thiếu `evidence_id` cũ → mục đó trong `orphans`; `DROP_ORPHANS` xóa nó
  - test: `toFieldEdits` parse qua `FieldEditSchema`
  - test: reducer không đổi state đầu vào
- Verify: `npx jest tests/loan-dossier/ui-edit-store.test.ts`

### T-U2-06 — Các thẻ Giai đoạn 1
- Depends: T-U2-03, T-U2-04, T-U2-05, T-U1-07
- Files: `app/loan-dossier/components/intake/IntakeStage.tsx`, `.../IntakeReadinessCard.tsx`, `.../DocumentInventoryCard.tsx`, `.../ReviewTodoCard.tsx`, `.../OcrReviewCard.tsx`, `.../EditableField.tsx`
- Refs: U2-R01…R14, U2-AC01…AC11
- Làm: Dựng theo §1, sao chép cấu trúc JSX của `IntakeWorkspace`, `ReadinessCard`, `ChecklistCoverage`, `OcrResults` (v2); dùng kit v2 (`Card`, `Disclosure`, `Badge`, `EmptyState`, `TONE_BOX`). `IntakeStage` đặt `ConfirmationCard` (U3) ở cuối. Không thêm thư viện.
- DoD:
  - `npx tsc --noEmit` và `next lint --dir app/loan-dossier` không lỗi
  - đọc mã: nút ✎/Hoàn tác khóa khi W1 hoặc W2 đang chạy
  - đọc mã: không giá trị OCR nào đi vào `title`, `aria-label`, `console.*`
  - đọc mã: không có `<img>`, `<iframe>`, `<embed>`, `<object>`; không `fetch` khi sửa/hoàn tác
- Verify: `npx tsc --noEmit -p tsconfig.json && npx next lint --dir app/loan-dossier`
