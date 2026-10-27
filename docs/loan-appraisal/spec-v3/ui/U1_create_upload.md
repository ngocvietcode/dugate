# U1 — Khung trang, thiết lập hồ sơ và chạy

> **Nền v2 (D-32, 2026-10-16):** giao diện `/loan-dossier` **không làm**; giao diện là `/loan-appraisal-v2` theo V2-R10 ở [cross_cutting/v2_integration.md](../cross_cutting/v2_integration.md). Giữ file để tra cứu.

Giao diện `/loan-dossier` **giữ nguyên bố cục, bộ thành phần và cách chạy của `/loan-appraisal-v2`** (D-27). Nó chỉ là một client của W1/W2 (D-24, D-25), không lưu hồ sơ ở server.

File này mô tả phần dùng chung cho cả trang: khung, cột trái (thiết lập + nút chạy + tiến độ), banner trạng thái, mở lại bằng URL. Nội dung hai tab giai đoạn nằm ở U2, U3 (Giai đoạn 1) và U4 (Giai đoạn 2).

## 1. Bố cục (giống `app/loan-appraisal-v2/page.tsx`)

```text
┌ ← │ ▣ Thẩm định hồ sơ vay HKD · DUGATE Credit Intelligence · Phiên bản 3 │ Ứng dụng  ☾ ┐
├──────────────────────────────┬─────────────────────────────────────────────────────────┤
│ Thiết lập hồ sơ              │ [ErrorBanner / SoftTimeoutNotice / đã huỷ / Mở lại]      │
│  API key   [••••••••]        │ ┌ Tóm tắt hồ sơ ──────────────────────────────────────┐ │
│  Luồng vay [FULL ▼]          │ │ NGUYEN VAN A  [Cần rà soát] [3 điểm cần xử lý]       │ │
│  Ngày nộp  [14/10/2026]      │ │ Hộ kinh doanh có TSBĐ · Luồng FULL · OCR 1a2b · KT … │ │
│  Khách hàng [tự điền từ OCR] │ │ Chứng từ | Cần rà soát | Checklist | Lệch | OCR↔SL   │ │
│  ┌ Kéo thả hoặc chọn ─────┐  │ └──────────────────────────────────────────────────────┘ │
│  └────────────────────────┘  │ ( Giai đoạn 1. Tiếp nhận & rà soát OCR ) ( Giai đoạn 2. … ) │
│  3 tài liệu đầu vào  Xoá hết │  … nội dung tab (U2+U3 hoặc U4) …                         │
│  [▶ Bắt đầu thẩm định][Huỷ]  │                                                          │
├──────────────────────────────┤                                                          │
│ Luồng kiểm tra hồ sơ   [Đang]│                                                          │
│  ▬▬▬▬▬▬▭▭▭  45%              │                                                          │
│  Giai đoạn 1 · Tiếp nhận  Xem│                                                          │
│   ✓ Phân loại chứng từ       │                                                          │
│   ⟳ OCR & bóc tách           │                                                          │
│  Giai đoạn 2 · Kiểm tra   Xem│                                                          │
│   ○ Xác định vai trò …       │                                                          │
├──────────────────────────────┤                                                          │
│ Chi phí & token              │                                                          │
└──────────────────────────────┴─────────────────────────────────────────────────────────┘
```

Lưới `lg:grid-cols-[360px_minmax(0,1fr)]`, layout bọc `la2-root` và import `app/loan-appraisal-v2/v2.css` để dùng cùng biến màu.

## 2. Tái sử dụng và nâng cấp

Nguyên tắc (IMPLEMENT D-29): **dùng lại UI có sẵn trước**; chỗ nào thành phần v2 gắn cứng với `loan-appraisal` thì **nâng cấp chính thành phần đó** bằng prop tùy chọn, mặc định giữ đúng hành vi cũ; chỉ tạo thành phần mới khi dữ liệu đầu vào khác hẳn (`AppraisalResult` ↔ `OcrOutput`/`CheckOutput`).

| Cách | Thành phần | Ghi chú |
|---|---|---|
| **Dùng nguyên** (import) | Kit `components/loan-appraisal-v2/ui/*` (`Card`, `Badge`, `Button`, `Tabs`/`panelProps`, `Dialog`, `Disclosure`, `EmptyState`, `ErrorBoundary`, `KeyValue`, `ProgressBar`, `DataTable`, `SourceFileChips` (trong `ui/EvidenceChips.tsx`; **không** dùng `EvidenceChips`/`EvidenceProvider` vì tra theo evidence của `loan-appraisal`), `toneClasses`); `setup/FileList`; `progress/ErrorBanner`, `progress/SoftTimeoutNotice`, `progress/UsageCard` | Không đổi |
| **Dùng nguyên** (thư viện) | `app/loan-appraisal-v2/lib/poller.ts` (`createPoller`), `lib/api.ts` (`ApiError`, `isAbortError`, `getOperation`, `cancelOperation`), `lib/operation-id.ts`, `lib/csv.ts` (`toCsv`, `withBom`), `lib/format.ts`, `lib/usage.ts` (`parseUsage`), `hooks/useFocusTrap.ts`; `v2.css` | Không đổi |
| **Nâng cấp** (prop tùy chọn, tương thích ngược) | `layout/PageShell` (T-U1-08), `setup/UploadDropzone` (T-U1-09), `progress/StageList` (T-U1-10), `setup/RunControls` (T-U1-11) | Mặc định = hành vi hiện tại; `/loan-appraisal-v2` không đổi gì trên màn hình |
| **Tạo mới** (cùng mẫu JSX/lớp CSS) | `DossierSetupPanel` (theo `CaseSetupPanel`: bỏ "Nhu cầu vay", thêm "Ngày nộp"), `DossierProgress` (ghép `ProgressBar` + `StageList` đã nâng cấp, theo `PipelineProgress`), `DossierSummaryCard` (theo `CaseSummary`) | `PipelineProgress`, `CaseSetupPanel`, `CaseSummary` nhận thẳng `RunState`/`AppraisalResult` của v2 nên không nâng cấp được mà không đổi kiểu |
| **Tạo mới** (logic) | `lib/loan-dossier/ui/run-reducer.ts`, `operation-mapper.ts`, `stages.ts`; hook `useDossierRun.ts`, `useDossierUrl.ts` | Cùng cấu trúc bản v2; v2 chỉ có 1 lần chạy, luồng này có 2 (W1, W2) |

Quy tắc khi sửa file dưới `app/loan-appraisal-v2/` hoặc `components/loan-appraisal-v2/` (U1-R15):

1. Chỉ **thêm** prop tùy chọn hoặc export mới; không đổi tên, không đổi kiểu, không xóa prop/export có sẵn.
2. Không truyền prop mới → JSX/chuỗi hiển thị giống hệt trước khi sửa.
3. `npx jest tests/loan-appraisal-v2` vẫn xanh; `npx tsc --noEmit -p tsconfig.json` không lỗi mới.
4. Không sửa `lib/pipelines/workflows/loan-appraisal*` hay `app/loan-appraisal/` (workflow cũ vẫn chạy song song — OQ-18).

## 3. Rule

| ID | Rule |
|---|---|
| **U1-R01** | Bố cục, lưới, thẻ, nhãn trạng thái, toast và hộp xác nhận giống `/loan-appraisal-v2` (§1, §2). Không thêm thư viện giao diện, không thêm stepper 4 bước |
| **U1-R02** | **Thiết lập hồ sơ**: API key (`type="password"`, `autoComplete="off"`), Luồng vay (`FLOW_OPTIONS` của v2, mặc định `FULL` như hiện có, chú thích "Mỗi luồng áp một bộ checklist khác nhau."), Ngày nộp hồ sơ (mặc định hôm nay, gửi `dossier_submitted_at`), Khách hàng (chỉ để trình bày; tự điền và khóa bằng tên người vay từ OCR như `customerLocked` của v2; **không** gửi lên server — D-06). Bỏ ô "Nhu cầu vay" vì số tiền vay nay nhập thật ở form xác nhận (U3) |
| **U1-R03** | Luồng vay và ngày nộp bị khóa khi đang chạy và sau khi có kết quả W1 (giống `flowLocked`). Muốn đổi → "Chạy lại OCR" (U1-R06) |
| **U1-R04** | **Kéo thả**: `UploadDropzone` đã nâng cấp (T-U1-09) với `extensions = ['pdf','jpg','jpeg','png']` và chữ phụ "PDF hoặc ảnh (JPG, PNG) · chọn nhiều tệp". Tệp khác bị bỏ và thông báo như hiện có ("Bỏ qua {n} tệp không đúng định dạng."). Lọc ở client là bắt buộc vì route trả 500 khi gặp đuôi không được phép (api.md A-R10). Tệp > 50 MB hoặc vượt 100 tệp bị bỏ, thông báo nêu số tệp. Tệp trùng nội dung (`file_id` tính ở trình duyệt, S1-R02) bị bỏ, thông báo "Đã có trong hồ sơ". W1 vẫn kiểm lại |
| **U1-R05** | Danh sách tệp dùng `FileList` của v2. Thêm/xóa tệp sau khi đã chạy → xóa kết quả W1, W2 trên màn và gỡ `operation_id` khỏi URL (giống `resetForInputChange`); **giữ** bản vá và form trong bộ nhớ (khớp lại theo `evidence_id`, S2-R14) |
| **U1-R06** | **Nút chạy**: `RunControls` đã nâng cấp (T-U1-11), một nút chính + nút Huỷ như hiện có. Nhãn nút chính theo trạng thái: chưa có W1 → "Bắt đầu thẩm định" (gửi W1); W1 đang chạy → "Đang thẩm định" + "Huỷ"; W1 xong → "Chạy kiểm tra hồ sơ" (gửi W2, điều kiện ở U3-R09) kèm nút phụ "Chạy lại OCR"; W2 đang chạy → "Đang kiểm tra" + "Huỷ"; W2 xong → "Chạy lại kiểm tra" kèm "Chạy lại OCR". Mọi lần chạy lại có hộp xác nhận như hộp "Chạy lại thẩm định?" của v2 |
| **U1-R07** | Huỷ: hộp xác nhận "Huỷ phiên …?" rồi `POST /api/v1/operations/{id}/cancel`; 3 vòng poll dự phòng như `CANCEL_POLL_BUDGET` của v2. Toast giống `useLoanAppraisalRun` |
| **U1-R08** | **Luồng kiểm tra hồ sơ** (`DossierProgress`): thanh tiến độ + thông điệp `progress_message` + `StageList` (đã nâng cấp, T-U1-10) theo 2 giai đoạn (§4), mỗi giai đoạn có nút "Xem" chuyển tab. Giai đoạn 1 lấy trạng thái từ W1, Giai đoạn 2 từ W2. Stage hiện xong ngay khi workflow ghi kết quả stage đó: lúc đang chạy đọc `metadata.pipeline_steps[].extracted_data` (một `StageResult`, trạng thái thật ở `extracted_data.status`, **không** ở `status` của bước); khi `SUCCEEDED` đọc `result.extracted_data.stages` vì `view=compact` đã bỏ `extracted_data` khỏi từng bước (F-R10) |
| **U1-R09** | **Tab giai đoạn**: `Tabs` dạng pill, "Giai đoạn 1. Tiếp nhận & rà soát OCR" và "Giai đoạn 2. Kiểm tra hồ sơ". Người dùng tự chuyển; **không bao giờ tự nhảy** khi kết quả về (giữ quy tắc v2). Giai đoạn 1 có badge "Cần rà soát" khi còn mục `BLOCK`/`REVIEW` (U2-R09); Giai đoạn 2 có badge "Kết quả cũ" khi U4-R15 |
| **U1-R10** | **Poll**: dùng `createPoller` của v2 (tuần tự 2 s, sau 10 phút hiện `SoftTimeoutNotice`, sau 60 phút ngừng và cho "Mở lại kết quả", dừng sau 3 lỗi liên tiếp). Đọc `GET /api/v1/operations/{id}?view=compact` |
| **U1-R11** | **Mở lại bằng URL**: chỉ ghi mã operation vào URL — `?op=` cho W1, `?check=` cho W2 — bằng `history.replaceState`. Vào trang có tham số → tự mở lại một lần bằng phiên đăng nhập; bị 401/403 → `ErrorBanner` "Nhập đúng API key…" + nút "Mở lại kết quả". Sau khi mở lại, hiện thông báo "Bản sửa OCR và form xác nhận không được lưu; tệp cần chọn lại nếu muốn chạy lại OCR" |
| **U1-R12** | Không lưu tệp, form, bản vá, API key hay kết quả ở `localStorage`/`sessionStorage`/IndexedDB; API key chỉ ở ref của hook và header `X-API-Key`. Có bản vá hoặc form chưa gửi W2 → `beforeunload` cảnh báo |
| **U1-R13** | **Thẻ tóm tắt** (`DossierSummaryCard`, cùng dáng `CaseSummary`): tên người vay (từ `suggestions` của W1, che không cần — hiển thị đầy đủ như v2), badge trạng thái, dòng phụ "Hộ kinh doanh có TSBĐ · Luồng {flow} · OCR {8 ký tự} · KT {8 ký tự}", và 5 ô `KeyValue`: "Chứng từ nhận diện", "Cần rà soát", "Độ đầy đủ checklist", "Lệch đối chiếu chéo", "Lệch OCR ↔ SL". Ô chưa có dữ liệu hiện "—". Số lấy từ `content_preview` (U4-R03) |
| **U1-R14** | Lỗi: `ErrorBanner` của v2 với mã luồng tìm trong `error.message` bằng biểu thức của api.md A-R04 (chuỗi lưu có dạng `Workflow input could not be processed. — INVALID_INPUT: <MÃ> — …`; `error.code` chỉ là `INPUT_INVALID`/`SYSTEM_ERROR`/`CONNECTOR_ERROR`), dịch sang tiếng Việt (`INVALID_OCR_INPUT` → "Đầu vào OCR không hợp lệ", `INVALID_CHECK_INPUT` → "Dữ liệu gửi kiểm tra không hợp lệ", `UNSUPPORTED_CONTRACT_VERSION` → "Phiên bản dữ liệu không được hỗ trợ", `STAGE_RUNNER_MISCONFIGURED` → "Cấu hình máy chủ chưa đúng"); không tìm thấy mã → nhãn theo `error.code` ("Đầu vào không xử lý được" / "Lỗi hệ thống" / "Dịch vụ phụ thuộc không phản hồi"). Không hiện chuỗi lỗi thô. Đã huỷ → khung "Phiên … đã được huỷ" như v2 |
| **U1-R15** | Sửa file dưới `app/loan-appraisal-v2/` hoặc `components/loan-appraisal-v2/` chỉ theo 4 quy tắc ở §2: thêm prop/export tùy chọn, mặc định giữ nguyên hiển thị, `tests/loan-appraisal-v2` xanh, không đụng workflow `loan-appraisal` |

## 4. Danh sách stage

| Giai đoạn | `stage_key` | Nhãn | Chú thích |
|---|---|---|---|
| 1 · Tiếp nhận & rà soát OCR | `classify` | Phân loại chứng từ | Nhận dạng loại hồ sơ |
| | `extract_evidence` | OCR & bóc tách | Trích xuất dữ liệu có nguồn |
| 2 · Kiểm tra hồ sơ | `map_dossier_roles` | Xác định vai trò | Người vay, đồng vay, chủ TSBĐ |
| | `check_checklist` | Kiểm tra checklist | Đủ / thiếu chứng từ |
| | `cross_check_documents` | Đối chiếu chéo | So dữ liệu giữa chứng từ |
| | `compare_ocr_sl` | Đối chiếu OCR ↔ SL | So với thông tin xác nhận |

Trạng thái hiển thị (`pending`/`running`/`done`/`error` như v2): `FAILED`, `UNAVAILABLE` → `error`; `SUCCESS`, `PARTIAL_SUCCESS`, `INSUFFICIENT_DATA`, `NOT_EVALUATED` → `done`, kèm chữ `status` của stage ở cột phải ("Hoàn tất", "Cần rà soát", "Thiếu dữ liệu", "Không áp dụng").

## 5. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| U1-AC01 | Given chưa nhập API key hoặc chưa có tệp / Then nút "Bắt đầu thẩm định" bị khóa và hiện "Nhập API key và tải ít nhất một tài liệu để bắt đầu." | R02, R06 |
| U1-AC02 | Given mở trang lần đầu / Then luồng vay là `FULL`, bố cục 2 cột như `/loan-appraisal-v2` | R01, R02 |
| U1-AC03 | Given chọn tệp `.docx` cùng một PDF / Then PDF được thêm, thông báo "Bỏ qua 1 tệp không đúng định dạng." | R04 |
| U1-AC04 | Given chọn cùng PDF hai lần / Then danh sách có 1 tệp và thông báo "Đã có trong hồ sơ" | R04 |
| U1-AC05 | Given W1 xong / Then nút chính đổi thành "Chạy kiểm tra hồ sơ" và có nút "Chạy lại OCR" | R06 |
| U1-AC06 | Given W2 đang chạy / When bấm Huỷ / Then có hộp xác nhận; xác nhận thì gọi cancel đúng operation W2 | R06, R07 |
| U1-AC07 | Given W2 xong ở tab Giai đoạn 1 / Then tab không tự đổi sang Giai đoạn 2 | R09 |
| U1-AC08 | Given đã gửi W1 rồi W2 / Then URL có `?op=…&check=…` và không chứa API key | R11, R12 |
| U1-AC09 | Given tải lại trang có `?op=` / Then kết quả Giai đoạn 1 hiện lại và có thông báo bản sửa không được lưu | R11 |
| U1-AC10 | Given thêm 1 tệp sau khi W2 xong / Then kết quả W1, W2 bị xóa khỏi màn, bản vá vẫn còn | R05 |
| U1-AC11 | Given W1 lỗi `INVALID_OCR_INPUT` / Then `ErrorBanner` hiện "Đầu vào OCR không hợp lệ", không hiện chuỗi lỗi thô | R14 |
| U1-AC12 | Given đã nâng cấp `PageShell`, `UploadDropzone`, `StageList`, `RunControls` / When mở `/loan-appraisal-v2` / Then tiêu đề, chữ phụ kéo thả, 8 stage và nhãn nút giống trước khi sửa; `npx jest tests/loan-appraisal-v2` xanh | R15 |

## 6. Task

### T-U1-01 — Danh sách tệp và chặn trùng (hàm thuần)
- Depends: T-S1-01
- Files: `lib/loan-dossier/ui/file-list.ts`, `tests/loan-dossier/ui-file-list.test.ts`
- Refs: U1-R04, U1-R05
- Làm: `acceptFiles(candidates: {name, size, fileId}[], existing): {accepted, skipped: {format, tooLarge, tooMany, duplicate}}`; `browserFileId(bytes, subtle)` dùng SHA-256 của Web Crypto, cùng định dạng `file-{12 hex}` với `computeFileId` (T-S1-01); `announcement(skipped)` dựng câu thông báo tiếng Việt.
- DoD:
  - test: `.docx`, `.zip` vào `format`; `.PDF` viết hoa được nhận
  - test: 50 MB đúng được nhận, 50 MB + 1 byte vào `tooLarge`; tệp thứ 101 vào `tooMany`
  - test: cùng `fileId` lần hai vào `duplicate`
  - test: `browserFileId` bằng `computeFileId` trên cùng buffer (dùng `globalThis.crypto.subtle` của Node)
  - test: `announcement` đúng chuỗi U1-AC03
- Verify: `npx jest tests/loan-dossier/ui-file-list.test.ts`

### T-U1-02 — Danh sách stage và trạng thái hiển thị (hàm thuần)
- Depends: T-CON-01
- Files: `lib/loan-dossier/ui/stages.ts`, `tests/loan-dossier/ui-stages.test.ts`
- Refs: U1-R08, §4
- Làm: `DOSSIER_STAGES`, `DOSSIER_PHASES` theo §4 (cùng kiểu `StageDef` của v2); `displayStatus(stageResult | null, running)`; `phaseStatusOf(stages, phase)`; `stageStatusLabel(status)`.
- DoD:
  - test: 6 stage, 2 giai đoạn, đúng thứ tự §4
  - test: mỗi giá trị `StageStatus` ra đúng `pending/running/done/error` và nhãn
  - test: `phaseStatusOf` giống quy tắc v2 (có lỗi → `error`; có chạy → `running`; đủ → `done`; một phần → `partial`)
- Verify: `npx jest tests/loan-dossier/ui-stages.test.ts`

### T-U1-03 — Reducer phiên chạy (hàm thuần)
- Depends: T-U1-02, T-CON-03, T-CON-04
- Files: `lib/loan-dossier/ui/run-reducer.ts`, `tests/loan-dossier/ui-run-reducer.test.ts`
- Refs: U1-R05, U1-R06, U1-R07, U1-R10
- Làm: Cùng cấu trúc `runReducer` của v2 nhưng có hai lần chạy: `state = {ocr: WorkflowRun<OcrOutput>, check: WorkflowRun<CheckOutput>}`, mỗi `WorkflowRun` có `phase` (`idle|submitting|running|cancelling|stalled|succeeded|failed|cancelled`), `operationId`, `stages`, `progressPercent`, `progressMessage`, `output`, `usage`, `error`, `softTimeout`, `cancelPollsLeft`, `needsApiKey`. Action như v2 kèm trường `run: 'ocr'|'check'`, thêm `INPUT_CHANGED` (xóa cả hai kết quả). `primaryAction(state)` trả nhãn và hành động của nút chính theo U1-R06.
- DoD:
  - test: chuỗi `SUBMIT_START → SUBMITTED → REVEAL → SUCCEEDED` cho `ocr` giống test v2
  - test: không bắt đầu `check` khi `ocr` chưa `succeeded`
  - test: `INPUT_CHANGED` đưa cả hai về `idle`
  - test: `primaryAction` ra đúng 5 nhãn của U1-R06
  - test: `CANCEL_REQUESTED` hết 3 vòng poll mà chưa huỷ → quay lại `running`
- Verify: `npx jest tests/loan-dossier/ui-run-reducer.test.ts`

### T-U1-04 — Ánh xạ operation sang action (hàm thuần)
- Depends: T-U1-03
- Files: `lib/loan-dossier/ui/operation-mapper.ts`, `tests/loan-dossier/ui-operation-mapper.test.ts`
- Refs: U1-R08, U1-R14, F-R10
- Làm: Cùng cách `applyOperation` của v2: đọc `metadata.pipeline_steps`, mỗi `stage_key` reveal một lần với `extracted_data` (`StageResult`, trạng thái lấy ở `extracted_data.status`); `done` → parse `result.extracted_data` bằng schema hợp đồng (sai → lỗi `invalid-contract`) và reveal các stage còn thiếu từ `result.extracted_data.stages` (bước đã bị bỏ `extracted_data` ở `view=compact`, F-R10); `FAILED` → action lỗi với nhãn `errorLabel(error.code, error.message)` (U1-R14).
- DoD:
  - test: fixture W1 đang chạy có 1 stage xong → 1 `REVEAL` + `PROGRESS`
  - test: gọi lần hai với cùng `revealed` không reveal lại
  - test: bước có `status = PARTIAL_SUCCESS`, `extracted_data.status = INSUFFICIENT_DATA` → hiển thị "Thiếu dữ liệu"
  - test: fixture `SUCCEEDED` dạng compact (bước không có `extracted_data`) → đủ 2 stage lấy từ `result.extracted_data.stages`
  - test: `FAILED`, `error.message = "Workflow input could not be processed. — INVALID_INPUT: INVALID_OCR_INPUT — flow"` → "Đầu vào OCR không hợp lệ", không chứa `error.message` gốc
  - test: `FAILED` không có mã luồng, `error.code = SYSTEM_ERROR` → "Lỗi hệ thống"
  - test: `extracted_data` sai hợp đồng → `invalid-contract`
- Verify: `npx jest tests/loan-dossier/ui-operation-mapper.test.ts`

### T-U1-05 — Tham số URL
- Depends: —
- Files: `lib/loan-dossier/ui/url-state.ts`, `tests/loan-dossier/ui-url-state.test.ts`
- Refs: U1-R11, U1-R12
- Làm: `parseDossierUrl(search): {op?, check?}`; `buildDossierSearch(current, {op, check})`. Dùng `isValidOperationId` của v2.
- DoD:
  - test: khứ hồi `op` + `check`; giữ tham số khác có sẵn
  - test: mã không hợp lệ bị bỏ
  - test: truyền thêm khóa `apiKey` → không xuất hiện trong kết quả
- Verify: `npx jest tests/loan-dossier/ui-url-state.test.ts`

### T-U1-06 — Hook chạy và mở lại
- Depends: T-U1-03, T-U1-04, T-U1-05, T-API-02
- Files: `app/loan-dossier/hooks/useDossierRun.ts`, `app/loan-dossier/hooks/useDossierUrl.ts`
- Refs: U1-R06, U1-R07, U1-R10, U1-R11, U1-R12
- Làm: Bản của `useLoanAppraisalRun`/`useOperationUrl` cho hai workflow: `submitOcr`, `submitCheck`, `attach(run, id, apiKey?)`, `cancel(run)`, `inputChanged()`. API key giữ trong ref; poll bằng `createPoller`; toast theo chuyển pha như v2.
- DoD:
  - `npx tsc --noEmit` không lỗi mới
  - đọc mã: không `localStorage`/`sessionStorage`/`indexedDB`; API key không vào URL, state hay log
  - đọc mã: một poller tại một thời điểm cho mỗi workflow; `stop` khi unmount
- Verify: `npx tsc --noEmit -p tsconfig.json && npx next lint --dir app/loan-dossier`

### T-U1-07 — Khung trang và cột trái
- Depends: T-U1-01, T-U1-06, T-U1-08, T-U1-09, T-U1-10, T-U1-11, T-NAV-01
- Files: `app/loan-dossier/page.tsx`, `app/loan-dossier/layout.tsx`, `app/loan-dossier/error.tsx`, `app/loan-dossier/components/DossierSetupPanel.tsx`, `app/loan-dossier/components/DossierProgress.tsx`, `app/loan-dossier/components/DossierSummaryCard.tsx`
- Refs: U1-R01…R15, U1-AC01…AC11
- Làm: Dựng theo §1–§2. Dùng `PageShell`, `UploadDropzone`, `StageList`, `RunControls` đã nâng cấp (truyền prop mới); import kit, `FileList`, `ErrorBanner`, `SoftTimeoutNotice`, `UsageCard` nguyên bản. `DossierSetupPanel`, `DossierProgress`, `DossierSummaryCard` sao chép cấu trúc JSX của `CaseSetupPanel`, `PipelineProgress`, `CaseSummary`. Tab giai đoạn render `IntakeStage` (U2/U3) và `CheckStage` (U4).
- DoD:
  - `npx tsc --noEmit` và `next lint --dir app/loan-dossier` không lỗi
  - đọc mã: không có bản sao của `PageShell`, `UploadDropzone`, `StageList`, `RunControls` dưới `app/loan-dossier/`
  - đọc mã: `beforeunload` chỉ đăng ký khi có bản vá/form chưa gửi
  - đọc mã: không `dangerouslySetInnerHTML`
- Verify: `npx tsc --noEmit -p tsconfig.json && npx next lint --dir app/loan-dossier`

### T-U1-08 — Nâng cấp `PageShell` (tiêu đề và liên kết)
- Depends: —
- Files: `components/loan-appraisal-v2/layout/PageShell.tsx`
- Refs: U1-R01, U1-R15
- Làm: Thêm prop tùy chọn cho `PageShell`/`AppHeader`: `title?`, `subtitle?`, `backHref?`, `links?: {href, label}[]`, `showConfigLink?`. Không truyền → dùng `COPY.appName`, `COPY.appSub · COPY.version`, liên kết "Cấu hình", "Giao diện cũ (v1)", "Ứng dụng" như hiện tại. Trang `/loan-dossier` truyền tiêu đề "Thẩm định hồ sơ vay HKD", "Phiên bản 3", không có liên kết "Cấu hình".
- DoD:
  - đọc mã: prop `current` và `children` giữ nguyên; mọi prop mới tùy chọn
  - `app/loan-appraisal-v2/page.tsx` và `config/page.tsx` không phải sửa
  - `npx jest tests/loan-appraisal-v2` xanh
- Verify: `npx tsc --noEmit -p tsconfig.json && npx jest tests/loan-appraisal-v2`

### T-U1-09 — Nâng cấp `UploadDropzone` (đuôi file và chữ phụ)
- Depends: —
- Files: `components/loan-appraisal-v2/setup/UploadDropzone.tsx`
- Refs: U1-R04, U1-R15
- Làm: Thêm prop tùy chọn `extensions?: readonly string[]` (không dấu chấm, chữ thường) và `hint?: string`. Không truyền → `ACCEPTED_EXTENSIONS`, `ACCEPT_ATTRIBUTE` của `copy.ts` và chữ "PDF, ảnh, Word hoặc Excel · chọn nhiều tệp" như hiện tại. Có `extensions` → cả bộ lọc lẫn thuộc tính `accept` của `<input>` theo danh sách đó.
- DoD:
  - đọc mã: chữ "Kéo thả hoặc chọn bộ hồ sơ" và câu thông báo "Bỏ qua {n} tệp không đúng định dạng." giữ nguyên
  - đọc mã: so đuôi không phân biệt hoa thường (`.PDF` được nhận)
  - `npx jest tests/loan-appraisal-v2` xanh
- Verify: `npx tsc --noEmit -p tsconfig.json && npx jest tests/loan-appraisal-v2`

### T-U1-10 — Nâng cấp `StageList` (danh sách stage truyền vào)
- Depends: —
- Files: `components/loan-appraisal-v2/progress/StageList.tsx`
- Refs: U1-R08, U1-R15
- Làm: Thêm prop tùy chọn `stageDefs?: ReadonlyArray<{id, label, caption, phase}>`, `phaseDefs?: ReadonlyArray<{key, order, label}>`, `statusMap?: Record<string, StepStatus>`, `statusNote?: (stageId) => string | undefined` (chữ phụ "Cần rà soát", "Thiếu dữ liệu"… của §4). Không truyền → `STAGES`, `PHASES`, `stages` của v2 như hiện tại. Kiểu `phase` mở rộng thành `string` ở prop mới; `onSelectPhase` của v2 giữ kiểu `LoanPhaseKey`.
- DoD:
  - đọc mã: v2 gọi `<StageList stages onSelectPhase />` không đổi
  - đọc mã: `aria-current="step"` và `aria-label` của từng dòng giữ nguyên cho cả hai cách dùng
  - `npx jest tests/loan-appraisal-v2` xanh
- Verify: `npx tsc --noEmit -p tsconfig.json && npx jest tests/loan-appraisal-v2`

### T-U1-11 — Nâng cấp `RunControls` (nhãn và nút phụ)
- Depends: —
- Files: `components/loan-appraisal-v2/setup/RunControls.tsx`
- Refs: U1-R06, U1-R07, U1-R15
- Làm: Thêm prop tùy chọn `primaryLabel?`, `busyLabel?`, `rerunDialog?: {title, description, confirm}`, `cancelDialog?: {title, description}`, `secondary?: {label, onClick, confirm?: {title, description}}`, `confirmPrimary?: boolean` (ép hỏi lại trước khi chạy). Không truyền → nhãn "Bắt đầu thẩm định"/"Đang thẩm định"/"Chạy lại", hộp "Chạy lại thẩm định?", "Huỷ phiên thẩm định?" như hiện tại. Trang `/loan-dossier` tính nhãn bằng `primaryAction` (T-U1-03).
- DoD:
  - đọc mã: không truyền prop mới thì JSX giống bản trước
  - đọc mã: nút phụ dùng `Button` của kit, bị khóa khi đang chạy
  - `npx jest tests/loan-appraisal-v2` xanh
- Verify: `npx tsc --noEmit -p tsconfig.json && npx jest tests/loan-appraisal-v2`

### T-U1-12 — Kiểm tương thích ngược của các thành phần v2 đã nâng cấp
- Depends: T-U1-08, T-U1-09, T-U1-10, T-U1-11
- Files: `tests/loan-dossier/ui-v2-compat.test.ts`
- Refs: U1-R15, U1-AC12
- Làm: Test đọc mã nguồn (fs) của 4 file đã nâng cấp và của `app/loan-appraisal-v2/page.tsx`, `config/page.tsx`. Không render (môi trường `node`, test.md §1).
- DoD:
  - test `U1-AC12`: 4 file vẫn chứa chuỗi mặc định cũ ("Kéo thả hoặc chọn bộ hồ sơ", "PDF, ảnh, Word hoặc Excel · chọn nhiều tệp", "Bắt đầu thẩm định", "Chạy lại thẩm định?", "Huỷ phiên thẩm định?", "Giao diện cũ (v1)")
  - test: `app/loan-appraisal-v2/**` không truyền prop mới nào (`extensions=`, `stageDefs=`, `primaryLabel=`, `secondary=`, `links=`)
  - test: không file nào trong 4 file import từ `@/lib/loan-dossier`
- Verify: `npx jest tests/loan-dossier/ui-v2-compat.test.ts tests/loan-appraisal-v2`
