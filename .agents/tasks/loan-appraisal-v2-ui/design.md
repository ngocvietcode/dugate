# Loan Appraisal UI v2: Requirements và Design

Worktree: `d:\Jobs\dugate\.worktrees\loan-appraisal-v2` (branch `feat/loan-appraisal-v2-ui`)
Nguồn đã đọc để lập tài liệu này: v1 UI và backend ở `d:\Jobs\dugate` (branch `feat/account-opening`, HEAD `bdf9593`), vì worktree hiện chưa có v1 (xem mục 0).

## 0. Phát hiện chặn (PHẢI xử lý trước khi code)

Worktree `feat/loan-appraisal-v2-ui` đang ở commit `b46dd21` (= `master`) và **không chứa** `app/loan-appraisal/*`, `components/profiles/LoanCheckSetPanel.tsx`, `lib/pipelines/workflows/loan-appraisal*` hay cancel guard. Toàn bộ v1 và backend loan-appraisal chỉ có trên `feat/account-opening` (400 commit trước `master`; `master` là tổ tiên trực tiếp, `git log HEAD..master` rỗng).

**Quyết định (chốt, không còn mở): nền của v2 là `feat/account-opening` tại commit `bdf9593`.** Lý do: đó là nơi duy nhất chứa v1 và backend mà yêu cầu bắt v2 phải dùng lại; không có nền khác thoả "giữ nguyên UI cũ" và "dùng cùng API". Đây là cách duy nhất để v1 tồn tại trong worktree, nên không còn phương án thay thế để hỏi lại; nếu `bdf9593` không còn là HEAD của `feat/account-opening` khi planner chạy, planner dùng đúng `bdf9593` (không dùng HEAD mới).

Bước 0 của planner (không phá huỷ):

```
git -C d:\Jobs\dugate\.worktrees\loan-appraisal-v2 merge --ff-only bdf9593
git -C d:\Jobs\dugate\.worktrees\loan-appraisal-v2 rev-parse HEAD     # PHẢI in ra bdf9593...
```

`--ff-only` hợp lệ vì branch v2 chưa có commit riêng. Không rebase, không force. Nếu fast-forward thất bại hoặc `rev-parse` khác `bdf9593` thì DỪNG và báo người dùng (blocking gate), không tự xử lý. Sau đó chạy `git -C <worktree> ls-files app/loan-appraisal` và phải thấy 13 file.

**V2_BASE = `bdf9593`.** Giá trị này được ghi lại làm đầu ra của bước 0 và là mốc DUY NHẤT cho mọi gate cô lập ở AC1, AC2 và 4.12 (`git diff --name-only bdf9593..HEAD`). Không dùng `master` hay `merge-base` làm mốc, vì sau ff-merge sẽ có khoảng 400 commit.

Làm rõ về "ZERO backend changes": khoảng 400 commit đưa vào bởi ff-merge là lịch sử CÓ SẴN của `feat/account-opening` (gồm backend loan-appraisal đã tồn tại), không phải thay đổi backend do v2 tạo ra. Phạm vi "không đổi backend" được đo bằng diff `bdf9593..HEAD`, và diff đó phải rỗng ngoài các đường dẫn ở 2.2.

## 1. Requirements

### 1.1 Summary
Xây dựng bản 2 của màn hình Loan Appraisal (thẩm định hồ sơ vay HKD) thành route riêng `/loan-appraisal-v2`, giao diện mới (hiện đại, sạch, truy cập được, responsive, theo theme của app), giữ nguyên 100% v1 và không đổi bất cứ gì ở backend. v2 dùng lại đúng các API, request/response contract và type của v1.

### 1.2 Functional requirements (đối chiếu với v1 đã catalog ở mục 3)
- FR1. Nhập thông tin phiên: API key, luồng vay (FULL/FAST/SIMPLE), tên khách và nhu cầu vay (hai nhãn chỉ để trình bày, không gửi lên backend, như v1).
- FR2. Upload nhiều file (kéo thả hoặc chọn), hiển thị tên, đuôi, dung lượng, xoá từng file, xoá tất cả. Định dạng: pdf, png, jpg, jpeg, webp, gif, doc, docx, xls, xlsx.
- FR3. Chạy thẩm định (`POST /api/v1/docs/workflows`), polling `GET /api/v1/operations/{id}?view=compact` mỗi 2s, hiển thị tiến độ % và thông điệp tiến độ mới nhất, 8 stage chia 2 giai đoạn.
- FR4. Mở lại kết quả theo `?op=<id>` (full view `GET /api/v1/operations/{id}`), kể cả khi cần nhập API key (401/403), 404, và operation còn đang chạy thì tiếp tục poll.
- FR5. Hiển thị kết quả giai đoạn 1 (tiếp nhận): checklist coverage, bảng intake, OCR theo party/field, master data theo chiều (party/asset/single) kèm provenance, ma trận đối chiếu (có dialog xem toàn bộ + xuất CSV), cảnh báo nghiệp vụ (`dossier_checks`), dossier readiness (thiếu chứng từ, cần xác minh, file không nhận dạng, lỗi trích xuất, conflict, supplement requests).
- FR6. Hiển thị kết quả giai đoạn 2 (thẩm định): decision cockpit, chỉ số tài chính (DSCR, LTV, CFADS, số tiền đề nghị...), 5C kèm evidence, policy/check set (rule DETERMINISTIC và PROMPT, expected/actual), stress test và scorecard (trạng thái NOT_CONFIGURED/UNAVAILABLE vẫn phải biểu diễn đúng), recommendation, covenants, conditions precedent, review route.
- FR7. Truy vết evidence: mọi nhận định hiển thị được chip/chi tiết chứng từ nguồn qua `evidence_ids`, và hiển thị rõ khi không liên kết được ("Chưa liên kết được chứng từ nguồn").
- FR8. Điều hướng 2 giai đoạn, không bao giờ tự nhảy giai đoạn khi kết quả về (hành vi v1). Giai đoạn 2 luôn xem được kể cả khi hồ sơ chưa đủ, kèm banner "Kết quả tạm" và danh sách supplement requests (`appraisal_conditional`).
- FR9. Trạng thái lỗi: submit lỗi, poll mất kết nối 3 lần liên tiếp, workflow FAILED (`error.message`, `failed_step`), operation id không hợp lệ.
- FR10. Tương thích kết quả V1 cũ (không có `output_version === '2.0'`): vẫn render, nhãn "Hoàn tất V1", tiến độ 38%, chỉ 3 stage đầu done (hành vi v1).
- FR11. **Cancel** (v1 chưa có UI, backend đã có): nút "Huỷ" khi đang chạy gọi `POST /api/v1/operations/{id}/cancel`, xử lý 200/409/401/403/404/500, và trạng thái CANCELLED hiển thị riêng (xem 5.4).
- FR12. **Cost/token** (v1 chưa hiển thị, backend đã trả): khi `done`, hiển thị `result.usage` (input/output tokens, pages, model, `cost_usd`, breakdown theo processor).
- FR13. Trang cấu hình `/loan-appraisal-v2/config`: shell mới, dùng lại `LoanCheckSetPanel` y nguyên, cùng endpoints `/api/internal/apikeys` và `/api/internal/profile-endpoints` (GET/POST), có dirty guard (`beforeunload`, confirm đổi Profile), toast thành công/lỗi.
- FR14. Điều hướng: v2 có link sang v1 (`/loan-appraisal`) và `/apps`; v1 giữ nguyên, không bắt buộc có link sang v2 (xem 2.3).

### 1.3 Non-functional requirements
- NFR1 Accessibility: điều hướng bằng bàn phím cho mọi điều khiển; ARIA đúng vai trò (tablist/tab/tabpanel với phím mũi tên, Home, End; dialog modal có focus trap, Esc, trả focus; progressbar; `aria-live` cho tiến độ; `role="alert"` cho lỗi); tương phản chữ >= 4.5:1 (chữ thường), >= 3:1 (thành phần UI lớn); không dùng màu là tín hiệu duy nhất (luôn kèm icon + nhãn chữ); tôn trọng `prefers-reduced-motion`.
- NFR2 Responsive: dùng được từ 360px đến 1920px. Dưới `lg` là một cột, bảng cuộn ngang trong container có `tabIndex=0`.
- NFR3 Theme: theo `next-themes` (light, dark, system, vpb, vpb-dark), xem 4.3.
- NFR4 Bảo mật: không ghi API key vào URL, localStorage, sessionStorage hay log; chỉ giữ trong state React của trang và gửi qua header `X-API-Key`. Chỉ `op` id (regex `^[A-Za-z0-9-]{8,64}$`) được ghi vào URL. Không dùng `dangerouslySetInnerHTML`; giá trị từ kết quả AI render dạng text.
- NFR5 Hiệu năng: danh sách dài (evidence, rule, matrix field) render theo yêu cầu (collapsed `details`/virtual không cần, nhưng không render toàn bộ evidence chi tiết khi chưa mở). Hook poll không để request chồng nhau.
- NFR6 Ngôn ngữ: UI tiếng Việt (như v1). Xem 4.6 về i18n.

### 1.4 Acceptance criteria
1. `/loan-appraisal-v2` render sau đăng nhập; `/loan-appraisal` và `/loan-appraisal/config` không đổi (`git diff bdf9593..HEAD -- app/loan-appraisal` rỗng; v2 không chạm v1).
2. `git diff --name-only bdf9593..HEAD` chỉ chứa đường dẫn thuộc danh sách cho phép ở mục 2.2; `git diff bdf9593..HEAD -- app/api lib components/profiles components/HeaderNav.tsx components/PageWrapper.tsx middleware.ts package.json package-lock.json tailwind.config.ts` rỗng; không đường dẫn nào khớp danh sách cấm ở mục 2.1.
3. Chọn >= 1 file + nhập API key mới bật nút chạy; nút bị khoá khi đang xử lý. Request submit có đúng các field `process=loan-appraisal`, `product_code=hkd-loan`, `flow`, `files[]`, header `X-API-Key`.
4. Đang chạy: progress bar có `role="progressbar"` với `aria-valuenow`; 8 stage chuyển pending, running, done theo `pipeline_steps`; thông điệp tiến độ nằm trong vùng `aria-live="polite"`.
5. 3 lần poll lỗi liên tiếp thì dừng poll và hiện lỗi mất kết nối; 1 hoặc 2 lần lỗi không dừng.
6. Poll vượt 10 phút không báo lỗi cứng: hiện cảnh báo mềm "Workflow chạy lâu hơn dự kiến" và **tiếp tục poll** (xử lý M10 của review). Sau 60 phút poll dừng và vào trạng thái `stalled` (không phải FAILED, không style lỗi) với nút "Mở lại kết quả" (xem 4.5).
7. `state=FAILED` hiện lỗi `error.message` và đánh dấu đúng stage `failed_step`. `state=CANCELLED` hiện trạng thái "Đã huỷ", không hiện số liệu giả (không 38%, không đánh dấu stage done).
8. Tải lại trang với `?op=<id>` mở lại kết quả; 401/403 hiện hướng dẫn nhập API key và nút "Mở lại kết quả"; 404 hiện thông báo không tìm thấy; id sai định dạng bị từ chối trước khi gọi API.
9. Kết quả V2 đầy đủ hiển thị đủ các panel ở FR5, FR6; kết quả V1 cũ không gây lỗi runtime.
10. Mọi field optional của `AppraisalResult` vắng mặt đều không làm crash (có test với fixture rỗng và fixture V1).
11. Nút Huỷ gọi đúng endpoint cancel, hiện toast, 409 hiện "Hồ sơ đã hoàn tất, không thể huỷ".
12. Hiển thị usage từ `opData.result.usage`: SUCCEEDED hiện đủ (kể cả pages/model); FAILED chỉ hiện token/cost/breakdown (ẩn pages và model); CANCELLED hoặc `opData.result` vắng thì ẩn card; không hiện 0 giả. Có test `parseUsage` cho từng trạng thái.
16. Cancel không nhận được `CANCELLED` sau 3 vòng poll thì phase quay về `running`, hiện `toast.warning` và poll tiếp (có test reducer).
17. Bấm "Chạy lại" khi phase là `succeeded|failed|cancelled` thì hiện Dialog xác nhận; xác nhận mới tạo operation mới.
13. Dialog ma trận đối chiếu: focus vào nút đóng khi mở, Esc đóng, focus quay lại nút mở, CSV có BOM UTF-8.
14. Tab/phase dùng được hoàn toàn bằng bàn phím (mũi tên, Home, End).
15. `npx tsc --noEmit` sạch; `npm run lint` không lỗi mới ở file v2; `npx jest tests/loan-appraisal-v2 --ci` pass; `npm run build` (hoặc ít nhất `tsc` nếu build cần DB) không lỗi do v2.

### 1.5 Out of scope
- Mọi thay đổi backend, API, DB, workflow, prompt, test backend (xem 2.1).
- Sửa các hành vi backend đã biết trong review (parseMoney, Capital=REVIEW, H1 INPUT_INVALID...). UI chỉ **biểu diễn trung thực** kết quả hiện có.
- i18n đa ngôn ngữ (xem 4.6), HITL/pause (backend không dùng), export PDF, so sánh nhiều hồ sơ, lưu API key.
- Xoá hay di chuyển v1, redirect `/loan-appraisal` sang v2.

### 1.6 Assumptions
- A1. Nền code là `feat/account-opening` (mục 0).
- A2. Repo không có framework i18n (`next-intl`/`react-i18next` không tồn tại; v1 hard-code tiếng Việt). "i18n pattern của v1" thực chất là chuỗi hard-code. v2 gom chuỗi vào một file `copy.ts` để sau này dễ chuyển.
- A3. Một sản phẩm duy nhất `hkd-loan` (như v1 `PRODUCT`).
- A4. `view=compact` + `done` + `SUCCEEDED` bỏ `extracted_data` khỏi `pipeline_steps` nhưng giữ `result.extracted_data` (đã xác nhận trong `lib/pipelines/format.ts`). Khi mở lại bằng full view thì `pipeline_steps[].extracted_data` có đủ classification và extraction.
- A5. Trang cấu hình v2 cần quyền `endpoint:manage` như v1; server vẫn là nơi kiểm quyền.

## 2. Ràng buộc và phạm vi file

### 2.1 NO-GO LIST (planner và coder phải kế thừa nguyên văn)
KHÔNG được thêm, sửa, xoá hay đổi tên bất cứ thứ gì dưới:
- `lib/pipelines/**` (workflow, strategies, prompts, format, engine)
- `app/api/**` (kể cả không thêm route mới)
- DB/schema: `lib/db/**`, `drizzle/**`, `prisma/**`, migration
- server actions và mọi code chạy server-side ngoài page/layout của v2
- test backend: `tests/**` hiện có (chỉ được **thêm** file mới trong `tests/loan-appraisal-v2/`)
- `middleware.ts`, `package.json`, `package-lock.json`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`, `components/HeaderNav.tsx`, `components/PageWrapper.tsx`, `components/profiles/**` (dùng nguyên trạng, không sửa)
- toàn bộ `app/loan-appraisal/**` (v1). Ngoại lệ duy nhất: thêm một link tĩnh tới `/loan-appraisal-v2` vào header của `app/loan-appraisal/page.tsx` nếu và chỉ nếu người dùng yêu cầu. **Quyết định thiết kế: không chạm v1** (diff v1 = rỗng) để đảm bảo "giữ nguyên UI cũ"; v2 truy cập bằng URL trực tiếp và link ngược về v1.
- Không thêm dependency mới. Không cần: `lucide-react`, `sonner`, `next-themes`, `tailwindcss` đã có.

### 2.2 Danh sách file được phép
```
app/loan-appraisal-v2/**                      (route, layout, css, hooks, lib, config page)
components/loan-appraisal-v2/**               (component thuần UI)
tests/loan-appraisal-v2/**                    (test mới)
```
Không có file thứ tư nào. Nếu coder thấy cần sửa file ngoài danh sách thì dừng và báo.

### 2.3 Vì sao route anh em, không lồng
`HeaderNav` và `PageWrapper` dùng `pathname.startsWith('/loan-appraisal')` để ẩn thanh điều hướng chung và bỏ container 1200px. `/loan-appraisal-v2` cũng khớp `startsWith`, nên v2 nhận đúng hành vi full-width mà không cần sửa hai file chung. Đừng đổi route thành `/loan-appraisal/v2`: nó nằm trong thư mục v1 và vi phạm no-go. Middleware yêu cầu NextAuth cho mọi route UI, v2 thừa hưởng điều đó, không thêm gì.

## 3. Catalog chức năng v1 (cơ sở để v2 không thiếu)

Nguồn: `app/loan-appraisal/{page.tsx, types.ts, product.ts, hooks/useLoanAppraisalPolling.ts, components/*, config/page.tsx}`.

| # | Nhóm | v1 hiện có | Nơi trong v2 |
|---|------|-----------|--------------|
| 1 | Input | API key (password, trong state), tên KH, nhu cầu vay (chỉ trình bày), `flow` FULL/FAST/SIMPLE (khoá khi đã có `result.flow` hoặc đang chạy) | `CaseSetupPanel` |
| 2 | Upload | Dropzone (role=button, Enter/Space, drag-drop), `multiple`, accept list, list file (icon đuôi, size), xoá từng file/tất cả, khoá khi đang chạy, đổi file thì `resetRun` + gỡ `?op` | `UploadDropzone`, `FileList` |
| 3 | Run | `canRun = realFiles>0 && !isProcessing && apiKey`; nút đổi nhãn: Bắt đầu / Đang thẩm định / Chạy lại | `RunControls` |
| 4 | Cancel | **Không có UI** (backend có `POST .../cancel`) | `RunControls` (mới) |
| 5 | Polling | 2s, `view=compact`, chặn request chồng (`pollInFlight`) và phản hồi muộn (`pollSession`), 3 lỗi liên tiếp thì dừng, timeout cứng 10 phút, log tiến độ tối đa 80 dòng, chỉ hiện dòng cuối | `useLoanAppraisalRun` |
| 6 | Reveal | `onStepReveal` theo `stage_key` (fallback chỉ số `LEGACY_STAGE_KEYS`), bỏ step `processor==='webhook'`; classify gives `ClassifiedDoc[]`, extract_evidence gives `ExtractedDoc[]`, consolidate/synthesize gives `AppraisalResult` | reducer (4.4) |
| 7 | Reopen | `?op=` mở lại, full view, 401/403/404 có thông báo riêng, regex id, `unlinkOperation` khi đổi file | `useLoanAppraisalRun.attach` |
| 8 | Pipeline UI | 2 phase × 8 stage, `PhaseRail` (mở rộng tự động phase đang chạy/lỗi), `aria-current=step`, `aria-label` theo trạng thái, progress bar 0..100, `completedStages/8` | `PipelineProgress` |
| 9 | Trạng thái tổng | Sẵn sàng / Đang xử lý / Có lỗi / Hoàn tất V1 / Hoàn tất / Cần review | `RunStatusBadge` |
| 10 | Lỗi | banner `role=alert` (submit, workflow FAILED, mất kết nối, timeout, id sai, 401/403/404) | `ErrorBanner` |
| 11 | Case header | `CaseHead`: tên KH (từ `customer_360.identity.full_name`), readiness, số điểm cần xử lý (`collectExceptions`), meta DSCR/LTV/số tiền/độ đầy đủ/chứng từ bắt buộc, workflow_version | `CaseSummary` |
| 12 | Phase 1 | `DossierIntakeWorkspace`: `BusinessWarningsPanel`, `DossierSummary`, `ChecklistCoverage` (template `PRODUCT.checklist` dựng khung ngay khi mở trang), `IntakeTablePanel` (lọc theo trạng thái, `<table>` có caption), `MasterDataPanel`+`MasterDataDimensionPanel`, `CrossCheckMatrixPanel` (+ `FullMatrixDialog`, CSV), `OcrResultPanel` (view theo party segment, fallback từ `extraction`) | `components/loan-appraisal-v2/intake/*` |
| 13 | Phase 2 | `DecisionCockpit`, `MetricCard`, `FiveCCard/Detail`, `FindingList`, `EvidenceReference`, `PolicyControls` (`CheckSetSummary`, `PolicyRuleCard`, `CheckKindBadge`), `StressScorePanel`, `RecommendationRoutingPanel`, `ConditionList`, `LegacySummary`, `CustomerProfile` (Customer360 theo 5 nhóm), `AssessmentView` (cross_check, risk_notes, system_notes) | `components/loan-appraisal-v2/appraisal/*` |
| 14 | Rail/Bar | `DecisionRail` (completeness ring, ngoại lệ, `ProcessingTrail`), `DecisionBar` | `DecisionPanel` + `StickySummaryBar` |
| 15 | Evidence | `EvidenceLookupProvider` (context map id→record), `SourceDocumentChips`, `sourceDocumentsOf`, nêu rõ `unresolved` | `EvidenceContext`, `SourceChips` |
| 16 | A11y có sẵn | tablist với phím mũi tên/Home/End, `aria-pressed`, `aria-expanded/controls`, `details/summary`, dialog `aria-modal` + Esc + focus nút đóng, progressbar, `aria-live`, `role=alert`, `role=status`, `sr-only` caption | giữ và nâng cấp (mục 4.7) |
| 17 | Config | `/loan-appraisal/config` | `/loan-appraisal-v2/config` |
| 18 | Cost/token | **Không hiển thị** (backend trả `result.usage`) | `UsageCard` (mới) |
| 19 | Toast | v1 chính không dùng; config page dùng `sonner` | v2 dùng `sonner` cho cancel, copy, lưu config |
| 20 | i18n | Không có framework, chuỗi hard-code tiếng Việt | `copy.ts` (A2) |

Hành vi cần giữ nguyên (đã kiểm chứng ở code v1):
- Chỉ ghi `op` vào URL bằng `history.replaceState`, không bao giờ ghi API key.
- `activePhase = phaseOverride ?? 'DOSSIER_INTAKE'` (không tự chuyển phase).
- Tên khách ưu tiên `result.customer_360.identity.full_name`, nếu có thì khoá input.
- Khi `done` mà không phải `output_version==='2.0'`: progress 38%, chỉ 3 stage đầu done.
- Nút giai đoạn 2 không bao giờ bị disable.

Điểm lệch / quirk backend mà UI phải biểu diễn trung thực (từ `loan-appraisal-review.md`):
- Capital (C3) luôn `REVIEW`, nên 5C `overall_status` hầu như không bao giờ `PASS`, recommendation hầu như luôn `REFER`/`RISK_REVIEW`. UI không được "làm đẹp" thành trạng thái tốt. Vẫn hỗ trợ render đủ mọi giá trị enum vì backend có thể đổi.
- `BLOCKED` hiếm khi xảy ra và FAIL có `exception_allowed` ra `PASS_WITH_CONDITIONS`: hiển thị `result` của từng rule (`FAIL`) tách biệt với nhãn tổng hợp, để cán bộ thấy rule thực tế.
- `stress_test.status` luôn `NOT_CONFIGURED`, `credit_score.status` `UNAVAILABLE`: render trạng thái trống có chủ đích ("Chưa cấu hình"), không render bảng rỗng như lỗi.
- Cancel: sau khi cancel, state `CANCELLED` với `done=true`, **không có `result`** và `error` rỗng. Backend (bản đã fix H4) không ghi đè CANCELLED nữa; nhưng v2 vẫn phải xử lý an toàn khi poll thấy CANCELLED sau đó thấy state khác (không thể xảy ra với bản fix, bỏ qua).
- Poll hết 10 phút ≠ workflow lỗi (M10): v2 chuyển thành cảnh báo mềm.
- Có thể có operation `done` với `result.extracted_data` null (cancelled, hoặc output hỏng): hiển thị trạng thái rỗng có giải thích.
- `ClassifiedDoc.status==='error'` thuộc "không nhận dạng được" ở backend (L2): UI hiển thị nguyên `reason` nếu có, không tự suy diễn.
- `LTV` hiển thị không thống nhất giữa rule (%) và 5C (ratio 0.70) (L5): v2 chuẩn hoá hiển thị bằng `formatMetric` theo `unit` (`RATIO` hiện `0,70×`, `PERCENT` hiện `70%`), và hiện text gốc của rule trong chi tiết.

## 4. Design

### 4.1 Tổng quan
v2 là client-side app (`'use client'`) mới, tách thành: một page điều phối mỏng; một hook trạng thái chạy (reducer thuần + I/O tách rời); các component trình bày thuần theo props; một lớp `lib/` thuần (selector, formatter, chuẩn hoá) để unit test không cần DOM. Dữ liệu vào là cùng contract với v1. Mọi diễn giải kết quả (ngoại lệ, tiến độ, tổng hợp trạng thái) nằm trong `lib/` thuần.

Tech stack (khoá khi duyệt): Next.js 14.2.35 App Router, React 18, TypeScript 5, Tailwind CSS 3.4, `lucide-react` 1.x, `sonner` 2.x, `next-themes` 0.4.x, jest 30 + ts-jest (môi trường `node`, chỉ `*.test.ts`). Không thêm thư viện (không `clsx`, không Radix, không testing-library, không framer-motion). Focus trap viết tay (~30 dòng) trong hook `useFocusTrap`.

### 4.2 Cấu trúc file
```
app/loan-appraisal-v2/
  layout.tsx            metadata (title), import './v2.css', bao <div className="la2-root">
  v2.css                biến màu trạng thái theo theme, reduced-motion, focus ring
  page.tsx              'use client' điều phối: setup + run + workspace
  config/page.tsx       trang cấu hình (shell mới + LoanCheckSetPanel)
  copy.ts               toàn bộ chuỗi tiếng Việt, nhãn enum
  hooks/
    useLoanAppraisalRun.ts      reducer + submit/attach/cancel/poll (I/O)
    useFocusTrap.ts
    useOperationUrl.ts          đọc/ghi ?op=, validate id
  lib/
    api.ts              fetch thuần (submitWorkflow, getOperation, cancelOperation) nhận AbortSignal
    run-reducer.ts      reducer + action types (thuần)
    stages.ts           STAGES (8), PHASES (2), phaseStatusOf, stageKeyOf
    operation-mapper.ts applyOperation: opData -> RunAction[] (thuần)
    selectors.ts        collectExceptions, customerNameFrom, readinessMeta, ...
    format.ts           formatBytes, formatCurrencyVnd, formatMetric, formatUsd, formatDuration
    csv.ts              toCsv (RFC4180, BOM)
    tone.ts             Tone = 'success'|'warning'|'danger'|'info'|'neutral' + map enum->tone
components/loan-appraisal-v2/
  layout/   AppHeader.tsx  PageShell.tsx
  setup/    CaseSetupPanel.tsx  UploadDropzone.tsx  FileList.tsx  RunControls.tsx
  progress/ PipelineProgress.tsx  StageList.tsx  RunStatusBadge.tsx  ErrorBanner.tsx  SoftTimeoutNotice.tsx  UsageCard.tsx
  summary/  CaseSummary.tsx  DecisionPanel.tsx  StickySummaryBar.tsx
  intake/   IntakeWorkspace.tsx  ReadinessCard.tsx  ChecklistCoverage.tsx  IntakeTable.tsx
            MasterDataPanel.tsx  CrossCheckMatrix.tsx  CrossCheckDialog.tsx  OcrResults.tsx  BusinessWarnings.tsx
  appraisal/ AppraisalWorkspace.tsx  ProvisionalBanner.tsx  DecisionCockpit.tsx  MetricGrid.tsx
            FiveCPanel.tsx  PolicyPanel.tsx  StressScorePanel.tsx  RecommendationPanel.tsx  CustomerProfile.tsx  FindingsPanel.tsx
  ui/       Card.tsx  Badge.tsx  Tabs.tsx  Dialog.tsx  Disclosure.tsx  Button.tsx  ProgressBar.tsx
            EmptyState.tsx  KeyValue.tsx  DataTable.tsx  EvidenceChips.tsx  EvidenceContext.tsx
```
Mỗi file một trách nhiệm, mục tiêu < 300 dòng (v1 có file 1138 dòng, điều cần tránh).

### 4.3 Visual và theme
- Layout: header mỏng (logo, tên màn hình, trạng thái, link v1/config/apps, `ThemeToggle` dùng lại `components/ThemeToggle.tsx` nguyên trạng). Thân trang 2 vùng ở `lg+`: cột trái cố định rộng 360px (setup + upload + pipeline), vùng phải là workspace với tabs phase. Dưới `lg`: một cột, thứ tự setup, pipeline, workspace; `StickySummaryBar` cố định dưới đáy chỉ hiện khi có kết quả.
- Bỏ blob gradient/lưới nền và hero marketing của v1. Thay bằng bề mặt phẳng, bo góc 12px, viền 1px, khoảng trắng rộng, số liệu quan trọng dùng `tabular-nums`.
- **Màu**: dùng token ngữ nghĩa có sẵn của app (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`, `text-primary`, `bg-primary`, `text-destructive`) để tự theo 5 theme. Cần lưu ý: `tailwind.config.ts` **không** đặt `darkMode`, nên `dark:` của Tailwind bám `prefers-color-scheme`, KHÔNG bám class `.dark`/`.vpb-dark` của next-themes. Vì vậy **cấm dùng `dark:` trong v2**. Màu trạng thái (success/warning/danger/info) không có token, nên `v2.css` định nghĩa biến scoped:
```css
.la2-root { --la2-success: 4 120 87; --la2-warning: 180 83 9; --la2-danger: 190 18 60; --la2-info: 29 78 216; }
.dark .la2-root, .vpb-dark .la2-root { --la2-success: 52 211 153; --la2-warning: 251 191 36; --la2-danger: 251 113 133; --la2-info: 96 165 250; }
```
  (selector đúng vì `next-themes attribute="class"` gắn class lên `<html>`; `.la2-root` là phần tử con.) Tailwind dùng qua `text-[rgb(var(--la2-success))]` và nền `bg-[rgb(var(--la2-success)/0.12)]`. `Tone` map duy nhất qua `tone.ts` + `Badge`, không rải class màu trong component. Giá trị trên dự kiến đạt >= 4.5:1 trên nền card sáng/tối tương ứng, chưa đo. **Coder phải đo** bằng công cụ contrast ở 5 theme và chỉnh giá trị nếu không đạt (không xác minh được trong bước thiết kế).
- Font: kế thừa (`font-sans`). Không tải font ngoài (môi trường air-gapped).
- Focus ring: `focus-visible:ring-2 ring-primary ring-offset-2 ring-offset-background` trên mọi phần tử tương tác (định nghĩa trong `Button`/`Tabs`/`Disclosure`).
- Animation: chỉ transition màu và độ rộng progress, tắt bằng `@media (prefers-reduced-motion: reduce)` trong `v2.css` (`.la2-root * { animation-duration:.001ms!important; transition-duration:.001ms!important }`).

### 4.4 Quản lý trạng thái chạy
Chọn: một `useReducer` với reducer thuần (`run-reducer.ts`) thay cho 12 `useState` rời rạc của v1. Lý do: v1 để nhiều cờ độc lập (`isProcessing`, `pipelineComplete`, `pipelineError`) dễ rơi vào tổ hợp vô nghĩa; một trạng thái hữu hạn dễ test.

```ts
type RunPhase = 'idle' | 'submitting' | 'running' | 'cancelling' | 'stalled' | 'succeeded' | 'failed' | 'cancelled';
interface RunState {
  phase: RunPhase;
  operationId: string | null;
  stages: Record<LoanStageKey, StepStatus>;
  progressPercent: number;
  progressMessage: string;           // dòng cuối
  progressLog: string[];             // tối đa 80, dùng cho tooltip/"xem log"
  classification: ClassifiedDoc[] | null;
  extraction: ExtractedDoc[] | null;
  result: AppraisalResult | null;
  usage: OperationUsage | null;      // parseUsage(opData.result.usage), KHÔNG lấy từ AppraisalResult
  error: { message: string; stage: LoanStageKey | null; kind: RunErrorKind } | null;
  softTimeout: boolean;
  cancelPollsLeft: number;           // đếm ngược 3 vòng sau cancel 200
  needsApiKey: boolean;              // reopen gặp 401/403
}
// api.ts
type ApiErrorKind = 'forbidden' | 'not-found' | 'already-done' | 'http' | 'network' | 'invalid-json';
// run-reducer.ts (không có 'cancel': lỗi cancel chỉ là toast, phase quay về running)
type RunErrorKind = 'submit' | 'workflow' | 'network' | 'invalid-op' | 'not-found' | 'forbidden';
```
Ánh xạ `ApiErrorKind -> RunErrorKind` (viết trong `operation-mapper.ts` dạng hàm `toRunErrorKind(kind, context)`):
- `forbidden -> forbidden`; `not-found -> not-found`; `network -> network`; `invalid-json -> network` (poll) hoặc `submit` (khi submit); `http -> submit` (khi submit) hoặc `network` (khi poll); `already-done` chỉ phát sinh ở cancel, không bao giờ vào `RunState.error` (xử lý bằng toast).
- `workflow` và `invalid-op` không đến từ `ApiError`: `workflow` do `state=FAILED`, `invalid-op` do regex id.
- Thời gian dừng poll 60 phút không phải lỗi: dùng phase `stalled`, `error=null`.

Chuyển trạng thái (bảng đầy đủ, mọi chuyển khác bị reducer bỏ qua):
- `idle -> submitting -> running -> (succeeded | failed | cancelled | stalled)`.
- `running -> cancelling` (bấm Huỷ đã xác nhận).
- `cancelling -> cancelled` (poll thấy CANCELLED) hoặc `cancelling -> succeeded|failed` (poll thấy kết thúc khác, ví dụ cancel 409).
- `cancelling -> running` khi cancel trả lỗi (409/401/403/404/5xx/mạng), hoặc khi đã poll hết `cancelPollsLeft` (3 vòng) mà chưa có trạng thái kết thúc; kèm `toast.warning('Chưa nhận được trạng thái huỷ, đang tiếp tục theo dõi')`, poll tiếp bình thường.
- `running -> stalled` sau 60 phút; `stalled -> running` khi `attach` (nút "Mở lại kết quả") thành công và operation còn chạy; `stalled -> succeeded|failed|cancelled` nếu attach thấy đã kết thúc.
- `succeeded|failed|cancelled|stalled -> idle` bằng `reset`. `reset` đưa về `idle` và xoá hết (kể cả khi đổi file). `operation-mapper.ts` nhận `opData` và `revealed: Set<string>` rồi trả danh sách action: dễ test bằng fixture JSON.

Quy tắc ánh xạ (bám v1, bổ sung):
- `rawSteps = metadata.pipeline_steps ?? result.pipeline_steps ?? []`, bỏ `processor==='webhook'`, `stageKey = step.stage_key ?? LEGACY_STAGE_KEYS[step.step ?? idx] ?? 'stage-N'`; reveal mỗi key đúng một lần. `step.status==='FAILED'` thì stage `error`, ngược lại `done`; stage kế tiếp đang `pending` thì thành `running`. Stage có `status==='WAITING_REVIEW'` coi là `done` (backend không phát, giữ phòng thủ) và hiện nhãn "Chờ rà soát".
- `state==='FAILED'`: action `FAILED` với stage = `LEGACY_STAGE_KEYS[error.failed_step ?? current_step]`; đồng thời lấy `result.usage` nếu có.
- `state==='CANCELLED'` (kiểm trước `done`): action `CANCELLED`, không áp `result`, không đặt 38%.
- `done===true` còn lại: `SUCCEEDED` với `result.extracted_data ?? metadata.extracted_data`; nếu `output_version==='2.0'` thì 100% và 8 stage done, ngược lại (kết quả V1) 38% và `index<3 || done` mới done. Nếu extracted_data null/không phải object: `SUCCEEDED` nhưng `result=null` và hiện `EmptyState` giải thích.
- Còn lại là đang chạy: `pct = max(5, progress_percent ?? 0)`, stage hiện tại = `LEGACY_STAGE_KEYS[current_step]` (đánh dấu `running` nếu đang `pending`), thông điệp = dòng cuối của log (log chỉ thêm khi thông điệp đổi).

### 4.5 I/O: API và polling (không thay đổi contract)
`lib/api.ts` (chỉ gọi endpoint có sẵn):

| Hàm | Gọi | Gửi | Nhận / lỗi |
|---|---|---|---|
| `submitWorkflow(files, apiKey, productCode, flow, signal)` | `POST /api/v1/docs/workflows` | `FormData`: `process=loan-appraisal`, `product_code`, `flow`, `files[]`; header `X-API-Key` | JSON có `name: 'operations/<id>'` hoặc `id`. `!ok` thì ném `ApiError(detail ?? message ?? 'API Error <status>')`; thiếu id thì `ApiError('No operation ID returned')` |
| `getOperation(id, {apiKey, compact, signal})` | `GET /api/v1/operations/{id}[?view=compact]` | header `X-API-Key` nếu có | 401/403 thì `ApiError(kind='forbidden')`; 404 thì `kind='not-found'`; `!ok` khác thì `detail ?? error ?? 'HTTP <status>'` |
| `cancelOperation(id, apiKey, signal)` | `POST /api/v1/operations/{id}/cancel` | header `X-API-Key` nếu có | 200 thì ok; 409 thì `kind='already-done'`; 401/403/404 như trên; 500 thì ném lỗi với `detail` |

Điểm khác v1: nhận `AbortSignal` để huỷ request khi unmount/đổi phiên (thay cho cờ `pollSession`); parse JSON an toàn (`response.json().catch(() => ({}))`); body 5xx không phải JSON không làm hook crash.

`useLoanAppraisalRun` (I/O):
- Poll bằng `setTimeout` đệ quy (không `setInterval`), mỗi vòng chỉ lên lịch sau khi vòng trước xong, nên không có request chồng. 2000ms mặc định. Mỗi phiên có `AbortController`; `stop()` abort và tăng `sessionId`; phản hồi của phiên cũ bị bỏ.
- Lỗi poll: đếm liên tiếp, reset về 0 khi thành công; 3 lần thì dừng, `FAILED(kind='network')` với thông điệp có `detail`. 401/403/404 trong lúc poll coi là fatal ngay (không đợi 3 lần), vì lặp lại không giúp ích.
- Soft timeout: sau 10 phút `softTimeout=true` (một lần), **không dừng poll**. Thông điệp: "Workflow đang chạy lâu hơn dự kiến. Hồ sơ lớn có thể mất thời gian; bạn có thể tiếp tục chờ hoặc kiểm tra ở trang Operations." Sau 60 phút dừng poll (giới hạn an toàn cho tab bị bỏ quên) và chuyển phase `stalled`, KHÔNG phải FAILED, `error=null`, không style lỗi. UI hiện khối `role="status"`: "Đã ngừng tự động theo dõi sau 60 phút. Mở lại kết quả để tiếp tục." cùng nút "Mở lại kết quả" gọi `attach(operationId)`. Poller trả sự kiện `onStalled`, reducer action `STALLED`.
- (Tuỳ chọn, không thuộc acceptance criteria) Tab ẩn: khi `document.visibilityState==='hidden'`, giãn chu kỳ lên 10s; khi hiện lại thì poll ngay.
- `attach(opId, apiKey?)`: validate regex id (sai thì `FAILED(kind='invalid-op')`, không gọi API), full view, rồi áp `applyOperation`; nếu vẫn chạy thì vào vòng poll compact. 401/403 đặt `needsApiKey=true` (UI hiện ô nhập key + "Mở lại kết quả"); 404 thì `not-found`.
- `cancel()`: chỉ khi `phase==='running'`, đặt `cancelling`, gọi cancel. 200 thì `toast.success('Đã gửi yêu cầu huỷ')`, đặt `cancelPollsLeft=3` và poll tối đa 3 vòng để nhận `CANCELLED` từ server (nguồn sự thật). Nếu hết 3 vòng mà chưa có trạng thái kết thúc thì reducer chuyển `cancelling -> running`, `toast.warning('Chưa nhận được trạng thái huỷ, đang tiếp tục theo dõi')`, poll tiếp bình thường (không kẹt ở `cancelling`). 409 thì `toast.info('Hồ sơ đã hoàn tất, không thể huỷ')` và quay lại `running` (poll sẽ nhận SUCCEEDED). Lỗi khác thì `toast.error(message)`, quay lại `running`. Có test reducer/poller cho nhánh hết 3 vòng. Nút Huỷ yêu cầu xác nhận (Dialog) vì hành động không hoàn tác được.
- Lưu ý trung thực: cancel chỉ đổi state; theo review H4 (bản fix đã nêu "chưa làm": không huỷ sub-job đang chờ, không huỷ AI call đang chạy dở, chi phí đã phát sinh không được tính). UI nói rõ trong dialog: "Hệ thống sẽ ngừng ghi nhận kết quả; các bước AI đang chạy dở có thể chưa dừng ngay."
- Unmount: abort tất cả, không setState sau unmount.
- API key: giữ trong `useRef`/state của page, truyền vào hook theo từng lời gọi, không persist.

URL: `useOperationUrl` bọc `history.replaceState` (chỉ `op`), `OPERATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/`. Đọc `?op` đúng một lần ở mount (SSR-safe, trong `useEffect`).

### 4.6 Types và tiện ích dùng lại (không nhân bản)
| Cần | Import từ | Cách |
|---|---|---|
| `AppraisalResult`, `ClassifiedDoc`, `ExtractedDoc`, `EvidenceRecord`, `IntakeTable`, `CrossCheck*`, `MasterData*`, `FiveCFactor`, `PolicyRuleResult`, `MetricResult`, `DossierReadiness`, `LoanFlow`, `LoanStageKey`, `LoanPhaseKey`, `StepStatus`, `BackendWorkflowStep`, `UploadedFile`... | `@/app/loan-appraisal/types` | `import type` (xoá hết khi biên dịch, không kéo code v1 vào bundle) |
| `PRODUCT` (code `hkd-loan`, checklist template), `CUSTOMER360_GROUPS`, `ChecklistTemplateItem`, `Customer360Group` | `@/app/loan-appraisal/product` | import giá trị. Là dữ liệu tĩnh thuần, không có React. v2 bỏ emoji trong `CUSTOMER360_GROUPS.icon`, thay bằng icon `lucide-react` map theo `key` ở `copy.ts` |
| `LoanCheckSetPanel`, `LOAN_FLOW_OPTIONS`, `LOAN_PRODUCT_OPTIONS` | `@/components/profiles/LoanCheckSetPanel` | dùng nguyên trạng ở trang config |
| `LoanFlow` (config page) | `@/app/loan-appraisal/types` | thay cho import type từ `lib/pipelines/...` để client không phụ thuộc kiểu backend |
| `ThemeToggle` | `@/components/ThemeToggle` | dùng nguyên trạng |
| `toast` | `sonner` | `<Toaster>` đã gắn sẵn ở `app/layout.tsx` (không thêm Toaster thứ hai) |

Quy ước phụ thuộc: v2 phụ thuộc v1 qua `types.ts` và `product.ts`. Đây là hai file hợp đồng ổn định (type-only và dữ liệu). Ngược lại v2 **không import component, hook hay `primitives.tsx` của v1** (chúng gắn style slate/cyan cứng và trộn JSX/logic). Các hàm thuần nhỏ của `primitives.tsx` (`safeArray`, `humanizeKey`, `renderValue`, `formatCurrency`, `formatProbability`, `filesForKey`, `readinessMeta`, `checklistTone`, `sourceDocumentsOf`) được viết lại trong `lib/` của v2 **kèm unit test** (đây là ngoại lệ có chủ đích của "không nhân bản": lý do là tránh phụ thuộc vào file component có style của v1, vốn có thể bị xoá khi v1 nghỉ hưu). Mọi nơi khác không được nhân bản type.

i18n: không có framework nên `copy.ts` là `export const COPY = { ... } as const` và các map enum (`RECOMMENDATION_LABEL`, `ROUTE_LABEL`, `BUSINESS_REASON_LABELS`, `PROCESSING_STATUS_META`...). Component không chứa chuỗi tiếng Việt trực tiếp trừ nội dung rất cục bộ. Giữ nguyên các nhãn nghiệp vụ của v1 (vd `BUSINESS_REASON_LABELS`) để không đổi thuật ngữ.

### 4.7 Component chính và accessibility
- `Tabs` (ARIA tabs pattern): `role=tablist/tab/tabpanel`, roving `tabIndex`, mũi tên/Home/End, `aria-selected`, `aria-controls`, kích hoạt thủ công khi Enter/Space nếu panel nặng (mặc định kích hoạt khi focus, như v1). Dùng cho phase (2 tab) và tab con của Phase 2 (Hồ sơ KH / Policy và 5C / Rủi ro và khuyến nghị).
- `Dialog`: `role=dialog`, `aria-modal`, `aria-labelledby`, `useFocusTrap`, Esc đóng, click nền đóng, trả focus về phần tử mở, khoá cuộn nền (`overflow-hidden` trên `body` khi mở, gỡ khi đóng/unmount). Dùng cho ma trận đối chiếu và xác nhận huỷ.
- `Disclosure`: bọc `<details>/<summary>` native (đã bàn phím hoá sẵn), thêm focus ring và chevron.
- `DataTable`: `<table>` có `<caption class="sr-only">`, `<th scope="col">`, container cuộn ngang `tabIndex=0` + `role="region"` + `aria-label`.
- Tiến độ: `ProgressBar` `role=progressbar` + `aria-valuenow/min/max` + `aria-label`; thông điệp tiến độ trong `aria-live="polite"` (chỉ cập nhật khi nội dung đổi, tránh đọc lặp mỗi 2s). Thay đổi `phase` quan trọng (succeeded/failed/cancelled) thông báo qua một vùng `role="status"` ẩn riêng.
- Lỗi: `role="alert"`. Cảnh báo tạm (provisional) và soft-timeout: `role="status"`.
- Trạng thái luôn có 3 lớp: màu + icon + chữ. Icon trang trí `aria-hidden`.
- Dropzone: `<button type="button">` thật (không phải div role=button) kèm `<input type="file" class="sr-only">`; Enter/Space mở picker; vùng thả có chỉ báo `isDragging`; khi khoá hiển thị `aria-disabled`. Thông báo cho trình đọc màn hình khi thêm/xoá file ("Đã thêm 3 tệp") qua vùng live.
- Skip link "Bỏ qua tới nội dung" đầu trang. Mỗi vùng chính là landmark (`header`, `main`, `aside` có `aria-label`).
- Mục tiêu chạm >= 40×40px cho nút icon trên thiết bị cảm ứng.

Edge case giao diện:
- Tên file dài: `truncate` + `title`. Số lượng file lớn (>50): danh sách cuộn trong khung cao tối đa, hiển thị tổng.
- Trùng tên file: v1 cho phép (key theo `id` UUID); v2 vẫn key theo `id`, đồng thời hiện cảnh báo nhẹ "Có tệp trùng tên" vì backend khoá theo `file_name` (review M8) và có thể gộp nhầm. Không chặn.
- Kết quả rất lớn (hàng trăm evidence/field): panel chi tiết chỉ mount khi `Disclosure` mở (render có điều kiện), bảng hiển thị 50 dòng đầu + nút "Hiện thêm".
- Giá trị `unknown` bất kỳ: `renderValue` ép về chuỗi an toàn (object thì JSON rút gọn, tối đa 500 ký tự + "…").
- `result` thiếu mọi field V2 (kết quả V1): mỗi panel V2 tự kiểm `undefined` và hiện `EmptyState`, nhóm V1 dùng `LegacySummary`.
- Chạy lại: khi `phase` là `succeeded|failed|cancelled` và người dùng bấm "Chạy lại", hiện `Dialog` dùng chung với nội dung "Chạy lại sẽ tạo operation mới; kết quả hiện tại vẫn mở lại được bằng ?op=<id>" (id hiện tại được in ra), nút "Chạy lại" / "Giữ kết quả". Chỉ khi xác nhận mới `reset` rồi submit mới; `?op` đổi sang operation mới. Khi `phase` là `idle` (hoặc `failed` do submit chưa có operation) không hỏi.

### 4.8 UsageCard (FR12)
Nguồn duy nhất: `opData.result.usage`, tức trường `usage` của envelope operation trả về từ API (đã xác minh ở `lib/pipelines/format.ts`). Tuyệt đối không đọc từ `RunState.result` (đó là `AppraisalResult` lấy từ `opData.result.extracted_data`, không chứa usage). Quy tắc theo trạng thái:
- SUCCEEDED: có `usage` đầy đủ gồm `pages_processed`, `model_used`.
- FAILED: `usage` chỉ có khi operation có `stepsResultJson`, và không có `pages_processed`/`model_used`; card ẩn hai dòng pages và model.
- CANCELLED: không có `result`, card ẩn.
- `opData.result` vắng hoặc `usage` không phải object: card ẩn.
Có unit test `parseUsage` cho từng trạng thái (SUCCEEDED, FAILED, CANCELLED, vắng). Kiểu:
```ts
interface OperationUsage {
  input_tokens: number | null; output_tokens: number | null;
  pages_processed?: number | null; model_used?: string | null;
  cost_usd: number | null;
  breakdown: Array<{ processor: string; model: string; input_tokens: number | null;
    output_tokens: number | null; cost_usd: number | null; cost_source?: string }>;
}
```
(định nghĩa trong `app/loan-appraisal-v2/lib/usage.ts`; khớp `formatOperationResponse` và `usageBreakdown` ở `lib/pipelines/engine.ts`). `result` trong opData là `unknown` ở runtime nên `parseUsage(raw: unknown): OperationUsage | null` kiểm kiểu từng field, giá trị không phải số hữu hạn thì thành `null`, thiếu hẳn thì trả `null` (ẩn card). Hiển thị: tổng token vào/ra (định dạng `vi-VN`), trang, model, `cost_usd` dạng `$0.0123` (4 chữ số thập phân; `null` thì "Chưa tính giá"), và bảng breakdown gộp theo `processor` trong `Disclosure`. Không suy ra VND. Tiền chỉ để tham khảo, nhãn "Chi phí ước tính".

### 4.9 Trang cấu hình v2
`app/loan-appraisal-v2/config/page.tsx`: giữ logic của v1 (`latestRequest` chống race, `loadedFor` chống lưu nhầm profile, `dirty` + `beforeunload` + `confirm` khi đổi Profile, `?client=` khởi tạo, `canManageEndpoints` suy từ `value === null` đã bị redact). Khác ở shell/visual và dùng cùng `PageShell`. `LoanCheckSetPanel` render nguyên trạng, chấp nhận nó giữ style riêng của nó (ngoài phạm vi sửa). Endpoint: `GET /api/internal/apikeys`, `GET|POST /api/internal/profile-endpoints` với `ENDPOINT_SLUG='workflows:loan-appraisal'`; payload POST `{ apiKeyId, endpointSlug, parameters: Object.keys(p).length ? p : null }`. Phần logic dùng chung (hook `useLoanConfig`) viết trong `hooks/`, không import từ v1.

### 4.10 Xử lý lỗi (cụ thể)

| Thao tác | Điều kiện lỗi | Loại | Người dùng thấy | Log |
|---|---|---|---|---|
| Chọn file | Đuôi ngoài accept (qua kéo thả) | Phục hồi | File bị bỏ qua, thông báo `role=status`: "Bỏ qua N tệp không hỗ trợ: tên..." | không |
| Chọn file | 0 file hợp lệ | Phục hồi | Không đổi trạng thái | không |
| Submit | thiếu API key hoặc file | Không gọi API | Nút disabled + gợi ý chữ dưới nút | không |
| Submit | `!ok` (400/401/403/5xx) | Phục hồi | `ErrorBanner(kind=submit)` với `detail`; stage 1 đánh `error`; có nút "Thử lại" | `console.error` cấp lỗi, không log API key |
| Submit | Mạng đứt (`TypeError`) | Phục hồi | Banner "Không kết nối được máy chủ" | `console.error` |
| Submit | Không có operation id | Fatal cho lần chạy | Banner "Máy chủ không trả mã operation" | `console.error` |
| Poll | 1-2 lỗi liên tiếp | Phục hồi, im lặng | Không đổi UI (tuỳ chọn chấm cảnh báo "đang thử kết nối lại") | `console.warn` |
| Poll | 3 lỗi liên tiếp | Fatal cho phiên poll | Banner `network`, nút "Mở lại kết quả" (`attach`) | `console.error` |
| Poll | 60 phút vẫn chạy | Không phải lỗi | Phase `stalled`: khối `role=status` + nút "Mở lại kết quả" | `console.warn` |
| Cancel | 200 nhưng 3 vòng poll không thấy CANCELLED | Phục hồi | `toast.warning`, phase về `running`, poll tiếp | `console.warn` |
| Chạy lại | phase `succeeded/failed/cancelled` | Xác nhận | Dialog xác nhận (4.7) | không |
| Poll/attach | 401/403 | Fatal, có thể phục hồi bằng nhập key | `needsApiKey`, hướng dẫn nhập API key đã dùng khi gửi | không |
| Poll/attach | 404 | Fatal | "Không tìm thấy operation hoặc đã bị xoá" | không |
| Poll | `state=FAILED` | Kết thúc | Banner `workflow` với `error.message`, stage lỗi, vẫn hiển thị artifact đã reveal | không |
| Poll | `state=CANCELLED` | Kết thúc | Thẻ "Đã huỷ" (không phải lỗi), nút "Chạy lại" | không |
| Poll | JSON hỏng / body không phải object | Tính như lỗi poll | như trên | `console.warn` |
| Mapper | `extracted_data` sai kiểu | Phục hồi | Stage đánh done, panel hiện `EmptyState` | `console.warn` |
| Cancel | 409 | Phục hồi | toast info, tiếp tục poll | không |
| Cancel | 401/403/404 | Phục hồi | toast lỗi quyền | không |
| Cancel | 5xx/mạng | Phục hồi | toast lỗi, nút huỷ dùng lại được | `console.error` |
| Config load | `!ok` / không thấy endpoint | Phục hồi | Banner lỗi + nút tải lại | `console.error` |
| Config save | `!ok` (validate fail-closed phía server) | Phục hồi | `toast.error(data.error)`, giữ `dirty` | `console.error` |
| CSV export | Lỗi tạo Blob | Phục hồi | toast lỗi | `console.error` |
| Render | Ném lỗi trong subtree | Phục hồi một phần | `error.tsx` của route + `ErrorBoundary` quanh từng workspace phase: hiển thị "Không hiển thị được phần này" kèm nút thử lại, các phần khác vẫn dùng được | `console.error` |

`app/loan-appraisal-v2/error.tsx` (client error boundary chuẩn của Next) bắt lỗi toàn route. Cấm log nội dung hồ sơ hoặc tên file (PII, review L7); log chỉ chứa mã/ kiểu lỗi.

### 4.11 Validation đầu vào

| Input | Bắt buộc | Kiểu / giới hạn | Khi sai |
|---|---|---|---|
| API key | Có (để chạy) | chuỗi không rỗng sau `trim()`, ẩn (`type=password`, `autoComplete="off"`), tối đa 256 ký tự | Nút chạy disabled |
| Files | >= 1 | Đuôi trong accept list (kiểm tra cả khi kéo thả vì `accept` chỉ áp cho picker); không giới hạn dung lượng phía client (backend quyết định), hiển thị tổng dung lượng | Bỏ qua file sai, báo số lượng |
| `flow` | Có, mặc định `FULL` | `'FULL' | 'FAST' | 'SIMPLE'` | Giá trị khác thì ép về `FULL` |
| Tên KH, nhu cầu vay | Không | chuỗi, tối đa 120 ký tự; chỉ trình bày, **không gửi** | cắt ở 120 |
| `?op` | Không | regex `^[A-Za-z0-9-]{8,64}$` | từ chối, không gọi API, không ghi lại URL |
| Config: profile, params | theo v1 | server validate | hiển thị `data.error` |

Invariant và nơi thực thi:
- "Không có API key trong URL/storage": thực thi ở `useOperationUrl` (chỉ nhận opId) và lint thủ công trong review; test kiểm tra hàm ghi URL chỉ ghi `op`.
- "Một stage chỉ reveal một lần": `operation-mapper` (thuần), vì cần test không phụ thuộc React.
- "Không bao giờ có hai request poll đồng thời, phản hồi phiên cũ bị bỏ": hook I/O (`sessionId` + `AbortController` + setTimeout đệ quy).
- "Trạng thái run hợp lệ": reducer (`run-reducer`), chuyển trạng thái bất hợp lệ bị bỏ qua (trả state cũ).
- "Quyền xem/huỷ operation": **server** (đã kiểm ownership); UI chỉ hiển thị thông báo, không tự quyết quyền.

### 4.12 Testability và kế hoạch kiểm thử
Jest hiện chạy `testEnvironment: 'node'`, chỉ nhận `tests/**/*.test.ts`, không có testing-library. Vì vậy logic được tách khỏi component và test bằng unit thuần; component chỉ được kiểm bằng `tsc` + render thủ công.
- Unit (jest, `tests/loan-appraisal-v2/*.test.ts`):
  - `run-reducer`: toàn bộ chuyển trạng thái, reset, chuyển bất hợp lệ.
  - `operation-mapper`: fixture cho đang chạy, SUCCEEDED v2, SUCCEEDED v1, FAILED (có/không `failed_step`), CANCELLED, `extracted_data` null, step `webhook` bị bỏ, reveal một lần, `stage_key` thiếu (fallback theo chỉ số).
  - `selectors` (`collectExceptions`, `customerNameFrom`, `phaseStatusOf`), `format` (`formatBytes`, `formatMetric` theo `unit`, `formatUsd`), `csv` (escape dấu nháy/xuống dòng, có BOM), `parseUsage`, `isValidOperationId`.
  - `api.ts` với `fetch` giả (`jest.fn`): đúng URL, method, header, FormData field; ánh xạ 401/403/404/409/5xx; body không phải JSON.
  - Polling controller: tách một `createPoller({ fetchOp, intervalMs, onResult, now, setTimeoutFn })` thuần không phụ thuộc React để test bằng fake timers: 3 lỗi dừng, 2 lỗi không dừng, không chồng request, soft timeout không dừng, phản hồi phiên cũ bị bỏ, abort. Hook chỉ nối poller vào reducer.
- Kiểm thủ công (không tự động hoá được trong cấu hình hiện tại): tab bằng bàn phím, focus trap dialog, đọc màn hình, đo contrast ở 5 theme, responsive 360/768/1280, chạy một hồ sơ thật qua worker + Redis + Postgres. Phần này phải ghi rõ **chưa được xác minh** nếu môi trường không có worker/DB.
- Gợi ý không bắt buộc: nếu sau này muốn test component, thêm `@testing-library/react` + `jest-environment-jsdom`, nhưng việc đó sửa `package.json`/`jest.config.js` nằm ngoài phạm vi bản này (no-go).

Ràng buộc test: mọi module `lib/` và `hooks`-logic được unit test phải là `.ts` thuần, KHÔNG import React hoặc file `.tsx` (jest chạy `node`, `testMatch` chỉ `*.test.ts`; `tsconfig.jest.json` chưa được xác minh về `paths`/`jsx`, coder kiểm tra alias `@/` khi chạy test đầu tiên và nếu không resolve được thì dùng import tương đối trong `lib/`, không sửa config).

Xác minh bắt buộc cho coder trước khi báo xong: `npx tsc --noEmit`, `npm run lint` (nếu cấu hình), `npx jest tests/loan-appraisal-v2 --ci`, `git diff --name-only bdf9593..HEAD` khớp 2.2, `git diff bdf9593..HEAD -- app/loan-appraisal app/api lib components/profiles` rỗng.

### 4.13 Thứ tự thực hiện gợi ý cho planner
0. Bước 0 ở mục 0 (đưa nền `feat/account-opening` vào branch).
1. `lib/` thuần + test (types dùng lại, stages, mapper, reducer, format, csv, usage, api).
2. Poller + hook + `useOperationUrl`.
3. `ui/` primitives (Card, Badge, Tabs, Dialog, Disclosure, DataTable, EvidenceContext).
4. Setup + progress + summary.
5. Intake workspace, rồi Appraisal workspace.
6. Config page.
7. Rà soát a11y, theme, responsive; chạy toàn bộ xác minh.

## 5. Quyết định then chốt (tóm tắt)
- Route anh em `/loan-appraisal-v2`, không đụng v1, không sửa HeaderNav/PageWrapper (startsWith đã đủ).
- Reducer + poller thuần thay cho nhiều `useState` + `setInterval`; soft-timeout thay cho timeout cứng 10 phút; CANCELLED là trạng thái riêng.
- Dùng token theme sẵn có + biến CSS scoped cho màu trạng thái; cấm `dark:` vì repo không cấu hình `darkMode: 'class'`.
- Reuse chỉ type (`app/loan-appraisal/types`) và dữ liệu (`product.ts`) của v1; không import component/hook của v1; không thêm dependency.
- Thêm cancel và cost/token (cùng endpoint, không đổi backend) vì yêu cầu nêu rõ run/cancel và cost/token, dù v1 chưa có UI.

## 6. Rủi ro còn lại
- Nền code đã chốt ở mục 0 (`bdf9593`, V2_BASE); bước 0 là blocking gate nếu ff ra kết quả khác.
- Nghỉ hưu v1: v2 phụ thuộc `app/loan-appraisal/types.ts` và `product.ts`. Nếu v1 bị xoá sau này, phải sao chép hai file này vào v2 trong cùng một commit và đổi import.
- Mục tuỳ chọn (không thuộc acceptance criteria, planner có thể bỏ): throttle poll khi tab ẩn, cảnh báo trùng tên file, skip link, `ErrorBoundary` theo phase (`error.tsx` cấp route vẫn bắt buộc).
- Giá trị màu trong 4.3 chưa đo contrast thật; coder phải đo ở 5 theme.
- `LoanCheckSetPanel` giữ style cũ nên trang config v2 sẽ lệch visual trong vùng panel (chấp nhận do no-go với `components/profiles/**`).
- Không xác minh được end-to-end (worker/Redis/Postgres) trong bước thiết kế; mọi khẳng định về contract dựa trên đọc `lib/pipelines/format.ts`, `app/api/v1/operations/[id]/*`, `useLoanAppraisalPolling.ts` ở `feat/account-opening`.
- `usage.breakdown` có thể đổi hình dạng giữa version backend; `parseUsage` phòng thủ, thiếu thì ẩn.

## 7. Phản hồi review thiết kế (design-review.json)

| # | Mức | Xử lý |
|---|-----|-------|
| 1 | HIGH | Đã sửa: V2_BASE=`bdf9593`, ghi ở mục 0 và dùng trong AC1, AC2, 4.12 |
| 2 | HIGH | Đã sửa: nền chốt là `bdf9593`, bước 0 là blocking gate, làm rõ commit ff-merge không phải thay đổi backend của v2; xoá rủi ro mâu thuẫn |
| 3 | MEDIUM | Đã sửa: `cancelling -> running` sau 3 vòng + toast.warning (4.4, 4.5, AC16) |
| 4 | MEDIUM | Đã sửa: phase `stalled` + nút "Mở lại kết quả", không FAILED (4.4, 4.5, AC6) |
| 5 | MEDIUM | Đã sửa: Dialog xác nhận khi phase là succeeded/failed/cancelled (4.7, AC17) |
| 6 | MEDIUM | Đã sửa: `ApiErrorKind` riêng, ánh xạ sang `RunErrorKind`, bỏ `'cancel'` (4.4) |
| 7 | MEDIUM | Đã sửa: nguồn `opData.result.usage`, quy tắc theo trạng thái, test theo trạng thái (4.8, AC12) |
| 8 | NIT | Đã sửa: bỏ "kích thước" ở 4.10 |
| 9 | NIT | Đã sửa: "dự kiến đạt, chưa đo" (4.3) |
| 10 | NIT | Đã sửa: quy tắc sao chép types.ts/product.ts (mục 6) |
| 11 | NIT | Đã sửa: đánh dấu tuỳ chọn, không thuộc AC (4.5, mục 6) |
| 12 | NIT | Đã sửa: module lib được test là `.ts` thuần, không import React/.tsx (4.12) |
