# Triển khai trên workflow `loan-appraisal` (v2, 8 stage)

> **Nguồn chuẩn về kiến trúc từ 2026-10-16 (IMPLEMENT D-32).** Khi file này mâu thuẫn với phần mô tả W1/W2, `CheckInput`, giao diện `/loan-dossier` ở `01_overview.md`, `04_data_model.md`, `cross_cutting/{api,foundation,rbac,security}.md`, `ui/U1…U4`, thì file này thắng.

> **Trạng thái hiện tại (đối chiếu code 2026-10-27, D-97).** Workflow chạy **5 stage**, không phải 8: `0 classify` (S1 + `dossier_precheck`) · `1 extract_evidence` (S2) · `2 calculate_financials` · `3 evaluate_policy_compliance` · `4 synthesize_recommendation` (`LOAN_STAGE_DEFINITIONS`). S3 chạy bằng code giữa stage 1 và 2, không có stage riêng. Các bước kiểm tra hồ sơ ở giai đoạn 2 đang **tạm tắt** (code còn, workflow không gọi). Vì vậy các mục sau **không mô tả hành vi hiện tại**; chúng giữ nguyên để tra cứu và bật lại:
> - §2 hàng `consolidate_dossier` (stage 2) và số thứ tự "3–7": stage tài chính nay là 2, rule là 3, khuyến nghị là 4. Operation cũ có checkpoint `consolidate_dossier` vẫn resume được (chạy lại từ stage tài chính).
> - V2-R09 `checklist` = S4, `cross_check` = S5: hai khối nay rỗng, `status_code = DOSSIER_CHECKS_DISABLED`.
> - V2-R07 `HKD.INTAKE.REQUIRED_DOCUMENTS`: đã gỡ (`RETIRED_CHECK_IDS`); id rule nay là `LOAN.*` (D-96).
> - V2-R12 `master_dossier`, V2-R13 / V2-R15 / V2-R22 / V2-R23 `intake_assessment`, `intake_review`, `dossier_summary`: không chạy ở giai đoạn 2.
> - V2-R14 "Giao diện luôn gửi `true`": UI v2 gửi `stop_after_intake` tường minh, mặc định `false` (chạy hết), `true` khi người dùng chọn dừng sau giai đoạn 1.
> - V2-R21 đường resume: S2 → S3 → stage 2–4 (không có `intake_assessment`, S4, S5, `master_dossier`).
>
> Tổng quan kiến trúc hiện tại và lộ trình: [ARCHITECTURE.md](../../ARCHITECTURE.md).

Người dùng chốt: **kiến trúc** giữ workflow v2 tám stage (`process=loan-appraisal`, `lib/pipelines/workflows/loan-appraisal.ts`); **kiểu dữ liệu** theo spec (`02_conventions`, `doc_schemas/`: ngày ISO, tiền số nguyên, địa chỉ object, `parties[]`, `assets[]`); **danh mục loại chứng từ** theo spec (`doc_types.json`, 47 loại) và kéo theo checklist, ma trận đối chiếu của spec. Không giữ tương thích ngược với output v2 hiện tại.

## 1. Phần nào của spec áp dụng

| Phần | Áp dụng | Ghi chú |
|---|---|---|
| `02_conventions.md`, `03_catalogs/` (trừ `sl_fields.json`) | ✔ | Nguồn duy nhất của key, enum, checklist, ma trận |
| `stages/S1…S5` (rule, AC, task card) | ✔ | Logic viết thành hàm thuần ở `lib/loan-dossier/` như task card; workflow v2 gọi các hàm này (§2) |
| `stages/S6_compare_ocr_sl.md`, `sl_fields.json` | ✘ | v2 không nhận dữ liệu SL |
| W1/W2, `OcrOutput`, `CheckInput`/`CheckOutput`, `check_input.json`, ngưỡng tự động (`auto_check_*`) | ✘ | v2 là một workflow liền mạch |
| Bản vá OCR (`field_edits`, T-EDIT-01), form xác nhận RM (U3) | ✘ | Evidence vào S3 là output S2 nguyên trạng. Chỗ nào trong S3–S5 ghi "đã áp bản vá" thì đọc là "output S2" |
| `ui/U1…U4`, trang `/loan-dossier` | ✘ | Giao diện là `/loan-appraisal-v2` (V2-R10) |
| `cross_cutting/api.md`, `foundation.md` (T-RUN-*), `rbac.md` (T-NAV-01) | ✘ | Trừ T-CAT-01, T-CAT-02 (đồng bộ và nạp catalog) |
| `cross_cutting/security.md` | Một phần | Giữ T-SEC-01, T-SEC-05 và mọi rule không log PII; bỏ T-SEC-02/03/04 (gắn với W1/W2 và `/loan-dossier`) |
| `cross_cutting/test.md` | Một phần | Bỏ T-TEST-03 (smoke W1/W2); T-TEST-02 chỉ đòi AC của S1–S5 |

`BACKLOG.md` tự loại các task không áp dụng (`tools/build_backlog.py`, `V2_NA_*`) và liệt kê chúng ở cuối file.

## 2. Ánh xạ stage

| # v2 | `stage_key` | Làm theo | Ghi chú |
|---|---|---|---|
| 0 | `classify` | S1 | `extracted_data` của bước = `data` S1 (`files[]`, `matches[]`, `repeated_doc_types[]`) |
| 1 | `extract_evidence` | S2 | `data` S2 (`evidences[]` EvidenceEnvelope, `FULL` + `LIGHT`) |
| 2 | `consolidate_dossier` | S3 → S4 → S5 | Chạy tuần tự bằng rule; **bỏ** lần gọi AI tổng hợp hồ sơ. LLM chỉ còn ở điều kiện `LLM_SEMANTIC` (S4-R10) và so `SEMANTIC` (S5-R07). **Thuộc giai đoạn 2** (V2-R21): mặc định chạy khi resume, không chạy ở giai đoạn 1 |
| 3–7 | `calculate_financials` … `synthesize_recommendation` | v2 | Giữ logic v2, chỉ đổi nguồn dữ liệu (V2-R06, V2-R07) |

## 3. Rule

| ID | Rule |
|---|---|
| **V2-R01** | Tham số chạy: `product_code` (mặc định `hkd-loan`; quyết định chương trình checklist S4-R24, policy và phạm vi rule), `flow` (một luồng của chương trình; HKD `FULL`/`FAST`/`SIMPLE`), `dossier_submitted_at` (ngày ISO; mặc định ngày nhận request theo giờ Việt Nam), `loan_checklist_overrides` của Profile (S4-R25). Thiếu `flow` hợp lệ → S4 `FAILED`/`INVALID_FLOW` (S4-R01), các stage khác vẫn chạy; bộ rule dùng luồng mặc định (luồng đầu) của chương trình (`resolveLoanFlow`). Cảnh báo ghi đè sai nằm trong `config_snapshot.warnings` |
| **V2-R02** | Danh mục trong code nạp từ `03_catalogs` qua T-CAT-01/T-CAT-02. Bỏ hẳn `form_code`, `form-catalog.ts`, `forms.ts`, `scripts/gen-loan-form-catalog.js` và 17 mục checklist của v2. Catalog UAT (`uat-analysis/03-field-catalog.json`) chỉ còn là nguồn giá trị kỳ vọng để chấm UAT (V2-R11) |
| **V2-R03** | Trạng thái bước: `StageStatus` của spec → `WorkflowStepResult.status`: `SUCCESS` → `SUCCESS`; `PARTIAL_SUCCESS`, `INSUFFICIENT_DATA`, `NOT_EVALUATED` → `PARTIAL_SUCCESS`; `FAILED`, `UNAVAILABLE` → `FAILED`. Trạng thái và mã gốc của spec nằm trong `extracted_data.stage_status`, `extracted_data.status_code`; stage 2 ghi riêng cho S3, S4, S5. S3 `FAILED` → S4, S5 `UNAVAILABLE`/`DEPENDENCY_FAILED` (`02_conventions §3`), stage 3–7 vẫn chạy với dữ liệu có được |
| **V2-R04** | `EvidenceRegistry` (`evidence.ts`) dựng từ EvidenceEnvelope: mỗi lá của `data` là 1 `EvidenceRecord`, `evidence_id = "{evidence_id của envelope}#{field_path}"`, `field_path` tính từ `data` (VD `parties[0].full_name`), `doc_type_key` theo spec. `review_status = ACCEPTED` khi confidence của field cấp 1 ≥ 0.80, ngược lại `REVIEW`. Evidence `ERROR` và evidence trong `superseded_evidences` (S3-R27) không vào registry. Bản ghi trạng thái checklist dựng từ `items[]` của S4 |
| **V2-R05** | Customer 360, gom đối tượng, gom TSBĐ lấy từ S3 (`role_registry`, `customer_360`, `asset_registry`). Bỏ `grouping.ts` và cách đoán số định danh/tên theo tên field. `master-data.ts` truy nguồn theo `id_number_sources`, `mapped_evidences`, `sources` của S3. Master data gồm cả **tài sản** (D-42): mỗi `asset_registry[]` là 1 nhóm với loại, mục đích, định danh, địa chỉ, chủ sở hữu hiện tại (chỉ party có `ownership.is_current_owner` trên chứng từ của tài sản), giá trị định giá mới nhất (theo `legal_info.issue_date`); nguồn = evidence trong `sources[]` ghi cùng giá trị (định danh so theo `K(v)` S3-R14) |
| **V2-R06** | Đầu vào tài chính (`strategies.ts`), mọi số đã là số (không parse chuỗi): **số tiền vay** = `loan_application.data.loan_info.bank_proposed_amount` (Số tiền cho vay); null → chỉ số phụ thuộc `INSUFFICIENT_DATA`, **không** thay bằng `requested_amount`. **Kỳ hạn** = `loan_info.loan_term_months`. **Lãi suất** = `loan_info.interest_rate` (%/năm); null → DSCR `INSUFFICIENT_DATA`; không bao giờ đọc `interest_rate_code`. **Nợ hiện hữu** = `financial_info.existing_monthly_debt_payment`; `has_existing_debt = false` → 0; cả hai null → DSCR `INSUFFICIENT_DATA`. **Doanh thu, lợi nhuận HKD** = `income_statement.data.income_sources[]` có `income_type = household_business`, field `household_business.net_revenue_annual`, `net_profit_annual` (VND/năm); thu nhập tháng của từng nguồn ở `monthly_amount`. **Giá trị TSBĐ** = `asset_details[].valuation_value` (nối `asset_index`) của báo cáo/chứng thư định giá (`real_estate_valuation_report`, `external_valuation_certificate`, `movable_asset_valuation_report`) gắn tài sản `collateral` trong `asset_registry`, còn hạn, không bị thay thế (S3-R27); nhiều nguồn cho một tài sản → lấy bản có `legal_info.issue_date` mới nhất |
| **V2-R07** | Rule (`check-set.ts`, `rules.ts`, `prompt-checks.ts`): `input: evidence.<doc_type_key>` dùng khóa spec (`loan_application`, `land_use_certificate`…). `HKD.PRODUCT.MAX_AMOUNT` so `bank_proposed_amount`. `HKD.INTAKE.REQUIRED_DOCUMENTS` đọc S4 (`required = true` và `status ∉ {PRESENT, SUBSTITUTED}` → không đạt). Cấu hình `loan_check_set` đã lưu theo khóa cũ: runtime bỏ input lạ + `warnings` (khoan dung), API ghi từ chối (fail-closed) |
| **V2-R08** | Ghi đè prompt qua Profile (`_workflowPrompts.classify`, `.extract`, `.evaluate`) **bị bỏ qua** kèm `warnings` trong `config_snapshot`: output của S1/S2 có schema cố định, prompt cũ trả định dạng cũ; `evaluate` không còn bước AI tương ứng. `_workflowModels.*`, `_workflowReasoningEfforts.*` vẫn áp dụng |
| **V2-R09** | Output `AppraisalResultV2`: `output_version = "3.0"`; `documents` = S1 + S2, `customer_360` = S3, `checklist` = S4 (`items`, `summary_by_group`, `completeness_percent`), `cross_check` = S5 (`results`, `logic_findings`). Bỏ shape cũ (`ClassifiedDoc[]`, `ExtractedDoc[]`, `AppraisalResult` V1). `integration-payload.ts` xuất theo shape mới, không giữ field cũ |
| **V2-R10** | Giao diện `/loan-appraisal-v2` hiển thị: kết quả OCR theo evidence (lá của `parties[]`, `assets[]`, `fields`), checklist theo chương trình của sản phẩm (HKD 43 mục, D-52) theo nhóm của S4, **chỉ hiển thị mục áp dụng cho luồng đã chọn: bỏ mục `NOT_APPLICABLE` ("Không áp dụng") ở checklist và master view, tiêu đề ghi số mục đã ẩn (D-65); mục không bắt buộc nhưng có chứng từ vẫn hiện; payload và `completeness_percent` không đổi**, đối chiếu chéo theo `results[]` của S5, Customer 360 của S3. Không thêm sửa OCR hay form xác nhận |
| **V2-R11** | Chấm UAT: bảng ánh xạ `docs/loan-appraisal/uat-analysis/04-uat-to-spec-map.json` (key UAT → `doc_type_key`, `field_path`, cách chuẩn hóa giá trị kỳ vọng). Bốn chứng thư (SBA, CITICS, FARGO, VVFC) → `external_valuation_certificate` + `appraisal_company`; `cic_tsbd` không chấm. Giá trị kỳ vọng chuẩn hóa theo kiểu spec trước khi so |
| **V2-R12** | **Đã cài đặt (D-46).** Master data chuẩn hóa theo checklist (`master_dossier`, [master_dossier.md](master_dossier.md)) dựng cuối stage 2 từ S2…S5; khi làm xong, rule engine, Rule LLM và đầu vào tài chính đọc `master_dossier` thay cho từng bản OCR (thay phần nguồn dữ liệu của V2-R06, V2-R07), `master_data_provenance` của V2-R05 đã gỡ (D-66), thay bằng `master_dossier.persons` / `assets` |
| **V2-R13** | **Tiếp nhận theo 4 tiêu chí (D-47).** Output và payload có `intake_assessment` (`intake-assessment.ts`): (1) đủ chứng từ bắt buộc theo luồng (S4; chỉ xét có đủ LOẠI chứng từ cho từng người / tài sản (D-56): dòng bắt buộc `MISSING`, `NEEDS_RESCAN` hoặc `NEEDS_REVIEW` không tìm được chứng từ nào là chưa đạt, không giải trình được; chứng từ đã nộp nhưng quá hạn (`DOCUMENT_EXPIRED`) giải trình được, nếu chỉ còn loại này thì tiêu chí ra "Cần kiểm tra", dòng ghi "Hết hạn: ..." kèm ngày cấp và ngày cần bổ sung (D-55); dòng `NEEDS_REVIEW` mà đã có chứng từ tính là đã có chứng từ, vấn đề chuyển sang tiêu chí 2; file không đọc được đã nêu ở tiêu chí 1 thì tiêu chí 4 không nêu lại); (2) không sai lệch trọng yếu — dòng S5 `MISMATCH`/`UNDETERMINED` của họ tên, số định danh, ngày sinh, tình trạng hôn nhân (D-63), số tiền vay, chủ sở hữu TSBĐ (không gồm địa chỉ, D-49), số GCN/Số vào sổ/biển số/số khung, và bản trùng `CONFLICT` của các lá đó trong `master_dossier` → cần giải trình (D-61: không tính lá thuộc `signatories[]` — người ký là thông tin phụ; dòng `id_number` đã `MATCH`/`ID_LINKED_BY_DOCUMENT` vì QR / cam kết 2 CMND-CCCD / xác nhận CMND địa phương thể hiện đủ các số thì không phải điểm cần kiểm tra); (3) dữ liệu nhập trên LOS/Secure App — **chưa áp dụng**, sau này nhận kèm request; (4) sẵn sàng chuyển CBQL/CO khi (1) đạt, (2) đạt hoặc đã giải trình, file chưa nhận diện/không đọc được đã giải trình. Giải trình do hệ thống gọi gửi lại khi chạy lại: tham số `acknowledgements = [{ finding_code, reason }]` (tối đa 200 mục, lý do ≤ 500 ký tự); mã không khớp hoặc không cho giải trình nằm ở `ignored_acknowledgements`. Màn bước 1 chỉ hiện 4 thẻ; mỗi thẻ liệt kê **đủ** điểm chưa đạt (gom theo nhóm checklist), bên dưới là điểm đã đạt (`passed[]`: chứng từ bắt buộc đã có hoặc đã thay thế, trường trọng yếu đã khớp, số tài liệu nhận diện/đọc được) (D-50); các khối chi tiết gom vào một phần đóng sẵn |
| **V2-R14** | **Dừng sau giai đoạn 1 (D-51). [Sửa bởi V2-R21 (D-81): mặc định S3–S5 và `master_dossier` KHÔNG còn chạy ở giai đoạn 1; mô tả "chạy stage 0–2" dưới đây chỉ còn đúng khi `intake_run_consolidate = true`.]** Tham số `stop_after_intake = true`: chạy stage 0–2 (S1–S5, master_dossier, `intake_assessment`) rồi `pauseWorkflow` ở bước 3 — operation `WAITING_USER_INPUT`, `result.extracted_data` là kết quả tiếp nhận (`result_phase = "DOSSIER_INTAKE"`, không có `financial_metrics`, `five_c`, `policy_compliance`, `recommendation`). Không gọi Rule LLM hay dịch vụ nào của giai đoạn 2 (kể cả LLM so ngữ nghĩa của S5: cặp cần so ra `SEMANTIC_DEFERRED`, D-57). `POST /api/v1/operations/{id}/resume` (body `{}`) chạy tiếp stage 3–7 từ checkpoint, không chạy lại S1–S5, rồi hoàn tất như thường. **Mặc định `true` (D-53):** không truyền (hoặc rỗng) thì dừng sau giai đoạn 1 và gửi webhook PAUSED; hệ thống gọi phải gọi resume để chạy giai đoạn 2. Truyền rõ `false`/`"false"`/`"0"`/`"no"` để chạy hết 8 stage một lần. Giao diện `/loan-appraisal-v2` luôn gửi `true`; nút "Chuyển sang giai đoạn 2" gọi resume |
| **V2-R15** | **Kiểm tra nháp bằng LLM + tổng kết (D-59).** Bước tiếp nhận là bản nháp cho Sale, không có trách nhiệm giải trình. Quy tắc (`buildIntakeAssessment`) chạy trước ra dữ kiện (mỗi điểm có mã `ref` ổn định); LLM nhận dữ kiện (step key `intake_review`) và chấm 3 tiêu chí (đầy đủ, nhất quán, đủ chất lượng; tiêu chí 3 vẫn "chưa áp dụng") theo schema cố định `criteria[{ key, status PASS\|NEEDS_EXPLANATION\|FAIL, summary, findings[{ ref, message, group }] }]`. Rào chắn: LLM chỉ thêm điểm có căn cứ, điểm có `ref` giữ mã và quyền giải trình của quy tắc, KHÔNG được bỏ điểm thiếu / không đọc được chứng từ bắt buộc, báo PASS khi còn điểm chưa xử lý thì hạ xuống Cần kiểm tra / Chưa đạt; `ready_for_handover` tính lại từ trạng thái cuối và chỉ mang tính gợi ý. Sau đó LLM viết tổng kết (step key `dossier_summary`): `dossier_summary { overview, highlights[], next_actions[], source }`. Lỗi model, timeout hoặc sai định dạng → giữ kết quả quy tắc và tổng kết bằng quy tắc (`review.source = RULES`, `review.warning`); không làm đổ stage; lỗi huỷ operation vẫn ném lại. Kết quả LLM lưu ở `intake_llm` trong checkpoint bước 2 nên resume không gọi lại. Prompt cấu hình qua Profile `_workflowPrompts.intake_review` / `.dossier_summary` (placeholder bắt buộc thiếu thì tự nối vào cuối, luôn có đoạn chống prompt injection, dữ kiện bọc trong thẻ `<untrusted_*>`); model / reasoning riêng theo `_workflowModels` / `_workflowReasoningEfforts`, chưa cấu hình thì dùng của `evaluate`. Tham số `intake_llm_review` (mặc định true; false = chỉ quy tắc, không gọi LLM). Output có `intake_assessment.review { draft, source, warning, prompt_overridden }` và `intake_assessment.dossier_summary` |
| **V2-R16** | **Kiểm tra sơ bộ bằng LLM ngay sau S1 (D-73, D-74).** Trong stage 0, sau `runClassifyStage` và trước S2, workflow gọi 1 lời gọi LLM (step key `dossier_precheck`, processor `ext-fact-verifier`, model / reasoning mặc định của `evaluate`) trên `files[]` của S1 (`summary`, `key_facts` theo S1-R19…R23) và checklist đã resolve của chương trình + luồng. Kết quả là `classify.precheck` trong checkpoint bước 0 (`extracted_data` của stage `classify`) và `dossier_precheck` trong output giai đoạn 1; UI hiện ngay khi stage 0 xong. Đây là BẢN NHÁP cho Sale, không có trách nhiệm giải trình; Từ D-81 kết quả này là đầu vào của `intake_assessment` giai đoạn 1 (V2-R22) thay cho S3–S5 (V2-R21); điểm dừng của giai đoạn 1 xem V2-R21 (`currentStep = 1`, trước S2). Mọi so sánh nội dung giữa các chứng từ do LLM làm; code không so giá trị |
| **V2-R17** | **Đầu vào.** (a) Mỗi dòng checklist đã resolve (`programForProduct` + `resolveChecklist` với `flow` và `loan_checklist_overrides`) mức `REQUIRED`/`CONDITIONAL`: `item_key`, nhãn, nhóm, `scope`, vai trò áp dụng, loại tài sản, `accepted_doc_type_keys`, mục thay thế, mô tả điều kiện (`conditions[].description`) khi `CONDITIONAL`. (b) Mỗi instance của file `CLASSIFIED`: mã `doc_ref` (`D01`, `D02`… do code gán; code giữ ánh xạ `doc_ref → (file_id, instance_index)`), `doc_type_key`, nhãn loại, trang, `confidence`, `needs_manual_review`, `summary`, `key_facts`. (c) File chưa phân loại không đưa vào. KHÔNG gửi tên file, `file_id`, đường dẫn hay dữ liệu OCR của S2 (nối S1-R03); tên file chỉ được UI lấy lại theo `file_id`. Mọi dữ liệu bọc thẻ `untrusted_*` kèm `UNTRUSTED_DATA_GUARD`; `value` của `key_facts` là dữ liệu, không phải chỉ thị. Không có chương trình checklist cho `product_code` → bước trả `SKIPPED` kèm cảnh báo, không gọi LLM |
| **V2-R18** | **Đầu ra.** JSON `{ checklist[{ item_key, subject, status, evidence[{ file_id, instance_index }], note }], relations[{ topic, status, file_ids[], message }], overview, next_actions[] }`. `checklist[].status` ∈ `PROVIDED \| MISSING \| UNCERTAIN \| NOT_APPLICABLE`; `subject` là nhãn người / tài sản (null cho mục cấp hồ sơ); `relations[].status` ∈ `CONSISTENT \| INCONSISTENT \| UNCLEAR`. `relations` nêu quan hệ giữa các chứng từ (cùng người vay, người đồng vay, chủ tài sản bảo đảm, số tiền vay, định danh tài sản, hôn nhân…) dựa trên `summary` / `key_facts` |
| **V2-R19** | **Rào chắn HÌNH THỨC bằng code (không so giá trị).** (1) Mục không thuộc checklist đã resolve bị bỏ; trùng `(item_key, subject)` giữ dòng đầu. (2) `evidence` trỏ `(file_id, instance_index)` không tồn tại, hoặc instance có `doc_type_key` ngoài `accepted_doc_type_keys` của mục và của mục thay thế, bị gỡ. (3) `PROVIDED` còn 0 căn cứ hợp lệ → hạ `UNCERTAIN`, `adjusted = true`. (4) `NOT_APPLICABLE` cho mục `REQUIRED` → hạ `UNCERTAIN`. (5) Mục `REQUIRED` / `CONDITIONAL` mô hình không nêu → thêm dòng `UNCERTAIN`. (6) `relations[].file_ids` lọc theo file có thật; `INCONSISTENT` còn 0 file → `UNCLEAR`. (7) Số đếm theo trạng thái, theo nhóm và `overall` (`GAPS_FOUND` khi còn `REQUIRED` ở `MISSING`/`UNCERTAIN` hoặc `INCONSISTENT`; ngược lại `NO_GAPS_FOUND`) do CODE tính từ dòng đã chỉnh; `overall` không phải kết luận chính thức |
| **V2-R20** | **Lỗi, tắt, resume.** Tham số `dossier_precheck` mặc định bật; `false`/`"false"`/`"0"`/`"no"` tắt (`status = SKIPPED`). Lỗi model, timeout, phản hồi sai schema → `status = UNAVAILABLE` + `warning`, `checklist` rỗng, `overall = null`: KHÔNG bao giờ trả `NO_GAPS_FOUND` khi chưa đánh giá được; stage không đổ. Lỗi huỷ operation ném lại. Kết quả lưu ở checkpoint bước 0 nên resume không gọi lại; resume vào giai đoạn 2 (`currentStep ≥ 3`) không bao giờ gọi bước này. Prompt ghi đè `_workflowPrompts.dossier_precheck` (placeholder bắt buộc `{{checklist}}`, `{{files}}`, `{{output_schema}}`). Không log `summary`, `key_facts`, `note` hay `message` của kết quả |
| **V2-R21** | **Giai đoạn 1 chỉ gồm S1 + kiểm tra sơ bộ; dừng NGAY sau `dossier_precheck` (D-81, D-82, D-90).** Tham số `intake_run_consolidate` (mặc định `false`; `true`/`"true"`/`"1"`/`"yes"` bật). Khi `stop_after_intake` bật (mặc định) và `intake_run_consolidate = false`: giai đoạn 1 = S1 → `dossier_precheck` (V2-R16) → `pauseWorkflow` với `currentStep = 1`. Các bước con (connector) thấy trong log trước điểm dừng CHỈ gồm `ext-classifier` (mỗi file) và đúng 1 `ext-fact-verifier` (precheck). KHÔNG chạy S2 (OCR / bóc tách), S3, S4, S5, so ngữ nghĩa S5, `master_dossier`, hiệu chỉnh master, `intake_review`, `dossier_summary`. Code S2–S5 giữ nguyên, chỉ chưa được gọi. Output giai đoạn 1 (D-91): `documents.evidences = []`, `customer_360 = null`, `checklist` và `cross_check` có `status = NOT_RUN`, `status_code = DEFERRED_TO_PHASE_2`, `items`/`results` rỗng, `master_dossier = null`, KHÔNG có `intake_assessment` (dựng sau S2 ở giai đoạn 2, V2-R22); `dossier_precheck`, `dossier_readiness`, `intake`, `evidence` dựng từ precheck. Checkpoint bước 0 chỉ ghi marker `intake_phase1 = { version }`. `POST /resume` chạy tiếp từ `currentStep = 1`: S2 → `intake_assessment` bằng quy tắc + LLM `intake_review` + `dossier_summary` (V2-R22, V2-R23) → S3 → S5 (so ngữ nghĩa hoãn, `master_dossier`, hiệu chỉnh master) → stage 3–7. `intake_run_consolidate = true`: hành vi D-51…D-59 (S2–S5 ở giai đoạn 1, `intake_assessment` dựng từ S4/S5, dừng ở `currentStep = 3`). `stop_after_intake = false`: không tách giai đoạn nên chạy một lần như cũ. Operation đã dừng ở bước 3 trước D-81 (checkpoint stage 2 đã có) resume như trước |
| **V2-R22** | **`intake_assessment` dựng từ kết quả kiểm tra sơ bộ + chứng từ S2, ở giai đoạn 2 (D-83, D-91).** Hàm thuần `buildPrecheckIntakeAssessment`, cùng kiểu `IntakeAssessment` (4 tiêu chí). (1) `DOCUMENTS_COMPLETE`: dòng checklist `MISSING` là điểm không giải trình được; `UNCERTAIN` của mục `REQUIRED` là điểm cần kiểm tra, giải trình được; `PROVIDED` vào danh sách đã đạt; mã điểm `DOC_MISSING:<item_key>:<chủ thể>`, `DOC_UNCERTAIN:...`. (2) `CONSISTENT_ACROSS_DOCUMENTS`: quan hệ `INCONSISTENT` / `UNCLEAR` là điểm giải trình được, mã `REL:<chủ đề chuẩn hóa>`; `CONSISTENT` vào danh sách đã khớp. (3) `SYSTEM_DATA_ACCURATE` vẫn chưa áp dụng. (4) `READY_FOR_HANDOVER`: file chưa nhận diện (S1) và chứng từ S2 lỗi đọc (dựng sau S2 nên luôn thấy chứng từ lỗi đọc). Kết quả kiểm tra sơ bộ KHÔNG `COMPLETED` (`UNAVAILABLE`/`SKIPPED`) thì tiêu chí 1 và 2 `FAIL` với điểm không giải trình được `PRECHECK_UNAVAILABLE:*`, `ready_for_handover = false`: không bao giờ báo đạt khi chưa đánh giá. `dossier_readiness` giai đoạn 1 cùng nguồn; không `COMPLETED` thì `status = NEEDS_VERIFICATION` và `blocking_reasons` có `PRECHECK_UNAVAILABLE`. `dossier_readiness` ở giai đoạn 1 (chưa có S2) tính từ cùng nguồn nhưng `NOT_PROCESSABLE` chỉ xét theo số file đã phân loại; `intake_assessment` không xuất hiện ở giai đoạn 1 |
| **V2-R23** | **LLM `intake_review` + `dossier_summary` dùng kết quả kiểm tra sơ bộ, chạy ở giai đoạn 2 (D-81, D-90).** Chạy khi resume, ngay sau S2 và trước S3. Dữ kiện chấm (`buildCriteriaFacts`) lấy từ `intake_assessment` dựng lại theo V2-R22 nhưng đã có chứng từ S2 (tiêu chí 4); dữ kiện hồ sơ (`buildPrecheckFacts`) gồm sản phẩm, luồng, số file / chứng từ, khoản vay từ S2 và `precheck_overview`, `precheck_next_actions`, số đếm theo trạng thái; không có người / tài sản của S3. Rào chắn `mergeReview` giữ nguyên. Prompt mặc định không đổi (cấu hình qua Profile như V2-R15). Kết quả (`intake_assessment` đã gộp LLM) lưu ở `classify.intake_phase1` nên resume lần sau không dựng lại, không gọi lại; giai đoạn 2 giữ nguyên `intake_assessment` đó, không dựng lại từ S4/S5. `intake_llm_review = false`: chỉ dùng kết quả quy tắc |
| **V2-R24** | **Giao diện giai đoạn 1 (D-81, D-90).** `extract_evidence` và `consolidate_dossier` thuộc phase `CREDIT_APPRAISAL`; giai đoạn 1 chỉ có 1 stage (`classify`) kèm thẻ "Kiểm tra sơ bộ". Khi `checklist.status_code = DEFERRED_TO_PHASE_2`, giai đoạn 1 ẩn thẻ "Người & tài sản", "Checklist hồ sơ", "Đối chiếu chéo" và kết quả OCR, thay bằng ghi chú các nội dung này chạy ở giai đoạn 2. Nút chuyển giai đoạn 2 gọi resume; `RESUMED` đặt stage đầu tiên chưa xong (`extract_evidence`) sang đang chạy |

## 4. Task cards

### T-V2-01 — Stage 0 chạy S1
- Depends: T-S1-07
- Files: `lib/pipelines/workflows/loan-appraisal.ts`, `tests/loan-appraisal/v2-stage-classify.test.ts`
- Refs: V2-R01, V2-R03, S1-R01
- Làm: Thay prompt classify cũ bằng `runClassify` (T-S1-07); lưu `data` S1 vào `extracted_data` của bước 0; ánh xạ trạng thái theo V2-R03.
- DoD:
  - test: bước 0 lưu đúng `files`, `matches`, `repeated_doc_types` của S1 (port giả)
  - test: S1 `FAILED` → bước `FAILED`, mã gốc ở `extracted_data.status_code`
  - test: `matches[].doc_type_key` thuộc 47 khóa của `doc_types.json`
- Verify: `npx jest tests/loan-appraisal/v2-stage-classify.test.ts`

### T-V2-02 — Stage 1 chạy S2
- Depends: T-S2-09, T-V2-01
- Files: `lib/pipelines/workflows/loan-appraisal.ts`, `tests/loan-appraisal/v2-stage-extract.test.ts`
- Refs: V2-R03, S2-R01, S2-R20
- Làm: Thay prompt extract cũ bằng `runExtract` (T-S2-09) trên `matches` của bước 0; lưu `data` S2.
- DoD:
  - test: match `FULL` và `LIGHT` đều ra evidence, `extraction_level` đúng
  - test: 1 evidence `ERROR` → bước `PARTIAL_SUCCESS`
  - test: resume dùng lại checkpoint bước 0–1, không gọi lại model
- Verify: `npx jest tests/loan-appraisal/v2-stage-extract.test.ts`

### T-V2-03 — Stage 2 chạy S3 → S4 → S5
- Depends: T-S3-15, T-S4-10, T-S5-10, T-V2-02
- Files: `lib/pipelines/workflows/loan-appraisal.ts`, `tests/loan-appraisal/v2-stage-consolidate.test.ts`
- Refs: V2-R01, V2-R03
- Làm: Bỏ lần gọi AI tổng hợp; gọi `runMapDossier`, `runChecklist` (`flow`, `dossier_submitted_at` theo V2-R01), `runCrossCheck` tuần tự; lưu 3 kết quả riêng trong `extracted_data`.
- DoD:
  - test: không còn lời gọi `enqueueSubStep` cho prompt tổng hợp cũ
  - test: S3 `FAILED` → S4, S5 `UNAVAILABLE`/`DEPENDENCY_FAILED`; bước 3–7 vẫn chạy
  - test: `flow` thiếu → S4 `FAILED`/`INVALID_FLOW`, S3 và S5 vẫn có kết quả
- Verify: `npx jest tests/loan-appraisal/v2-stage-consolidate.test.ts`

### T-V2-04 — EvidenceRegistry từ EvidenceEnvelope
- Depends: T-S2-02, T-S3-16
- Files: `lib/pipelines/workflows/loan-appraisal/evidence.ts`, `tests/loan-appraisal/v2-evidence-registry.test.ts`
- Refs: V2-R04
- Làm: `buildEvidenceRegistry(envelopes, superseded, checklistItems)` theo V2-R04.
- DoD:
  - test: `evidence_id` dạng `ev-…#parties[0].full_name`, ổn định giữa hai lần chạy
  - test: confidence 0.80 → `ACCEPTED`, 0.79 → `REVIEW`
  - test: evidence `ERROR` và bản bị thay thế không có bản ghi
  - test: bản ghi trạng thái checklist trỏ `found_in` của S4
- Verify: `npx jest tests/loan-appraisal/v2-evidence-registry.test.ts`

### T-V2-05 — Customer 360 và truy nguồn từ S3
- Depends: T-S3-15, T-V2-04
- Files: `lib/pipelines/workflows/loan-appraisal/master-data.ts`, `lib/pipelines/workflows/loan-appraisal/master-data-dimension.ts`, `tests/loan-appraisal/v2-master-data.test.ts`
- Refs: V2-R05
- Làm: Dựng Customer 360 và provenance từ output S3; xóa `grouping.ts`.
- DoD:
  - test: người vay, đồng vay, nhiều chủ TSBĐ lấy đúng từ `role_registry`
  - test: `VERIFIED`/`NEEDS_REVIEW`/`UNVERIFIED` theo `review_status` của evidence nguồn
  - test: không còn import `grouping.ts`
- Verify: `npx jest tests/loan-appraisal/v2-master-data.test.ts`

### T-V2-06 — Đầu vào tài chính theo spec
- Depends: T-V2-04, T-DOC-10, T-DOC-16, T-DOC-22, T-DOC-25
- Files: `lib/pipelines/workflows/loan-appraisal/strategies.ts`, `tests/loan-appraisal/v2-financial-inputs.test.ts`
- Refs: V2-R06
- Làm: Đọc số tiền vay, kỳ hạn, lãi suất, nợ hiện hữu, doanh thu/lợi nhuận năm, giá trị TSBĐ theo V2-R06; bỏ parse chuỗi tiền/lãi suất.
- DoD:
  - test: `bank_proposed_amount` null, `requested_amount` có → DSCR, LTV `INSUFFICIENT_DATA`
  - test: `interest_rate = null`, `interest_rate_code = "LC10"` → DSCR `INSUFFICIENT_DATA`
  - test: `has_existing_debt = false` → nợ hiện hữu 0; cả hai null → `INSUFFICIENT_DATA`
  - test: chỉ đọc `net_revenue_annual`/`net_profit_annual`; nguồn `income_type ≠ household_business` không được dùng
  - test: định giá bị thay thế (S3-R27) không dùng cho LTV
- Verify: `npx jest tests/loan-appraisal/v2-financial-inputs.test.ts`

### T-V2-07 — Rule và cấu hình rule theo khóa spec
- Depends: T-V2-04, T-S4-10
- Files: `lib/pipelines/workflows/loan-appraisal/check-set.ts`, `lib/pipelines/workflows/loan-appraisal/rules.ts`, `lib/pipelines/workflows/loan-appraisal/prompt-checks.ts`, `tests/loan-appraisal/v2-rules.test.ts`
- Refs: V2-R07, V2-R08
- Làm: Đổi khóa loại chứng từ trong catalog rule mặc định; `MAX_AMOUNT`, `REQUIRED_DOCUMENTS` theo V2-R07; bỏ qua ghi đè prompt classify/extract/evaluate theo V2-R08.
- DoD:
  - test: `parseCheckSet` gặp `evidence.loan_request` → bỏ + warning; `validateCheckSetValue` → lỗi
  - test: `REQUIRED_DOCUMENTS` không đạt khi S4 có dòng bắt buộc `MISSING`
  - test: Profile có `_workflowPrompts.extract` → không dùng, có warning trong `config_snapshot`
- Verify: `npx jest tests/loan-appraisal/v2-rules.test.ts`

### T-V2-08 — Output và payload tích hợp theo shape mới
- Depends: T-V2-03, T-V2-05
- Files: `lib/pipelines/workflows/loan-appraisal/types.ts`, `lib/pipelines/workflows/loan-appraisal/integration-payload.ts`, `tests/loan-appraisal/v2-output.test.ts`
- Refs: V2-R09
- Làm: `AppraisalResultV2` theo V2-R09; payload tích hợp đọc shape mới; xóa type `ClassifiedDoc`, `ExtractedDoc` cũ.
- DoD:
  - test: `output_version = "3.0"`; `checklist.items` theo chương trình và `flow` (HKD 43 mục, D-52)
  - test: payload không còn field `form_code`, `detected_form_name` kiểu cũ
  - test: không giá trị PII nào bị log khi dựng payload (spy `console`)
- Verify: `npx jest tests/loan-appraisal/v2-output.test.ts`

### T-V2-09 — Giao diện `/loan-appraisal-v2` theo shape mới
- Depends: T-V2-08
- Files: `app/loan-appraisal-v2/lib/ocr-documents.ts`, `components/loan-appraisal-v2/intake/*`, `app/loan-appraisal/product.ts`, `tests/loan-appraisal-v2/ocr-documents.test.ts`
- Refs: V2-R10
- Làm: Hiển thị theo V2-R10; danh sách checklist ở frontend đọc catalog spec, không khai báo cứng.
- DoD:
  - test: lá `parties[0].full_name`, `assets[0].identifiers.license_plate`, `fields.business_line` có nhãn và giá trị
  - test: địa chỉ object hiện `full_text`
  - test: tiền số nguyên hiển thị định dạng VND
  - test: `npx jest tests/loan-appraisal-v2` xanh
- Verify: `npx jest tests/loan-appraisal-v2`

### T-V2-10 — Bảng ánh xạ và bộ chấm UAT
- Depends: T-CAT-02, T-S2-10
- Files: `docs/loan-appraisal/uat-analysis/04-uat-to-spec-map.json`, `scripts/score-loan-uat.js`, `tests/loan-appraisal/v2-uat-map.test.ts`
- Refs: V2-R11
- Làm: Ánh xạ mọi key của catalog UAT sang (`doc_type_key`, `field_path`, cách chuẩn hóa); script so output một lần chạy với giá trị kỳ vọng, in tỉ lệ đúng theo loại và theo field.
- DoD:
  - test: mọi key UAT (trừ `cic_tsbd`) có ánh xạ; mọi `doc_type_key` đích có trong `doc_types.json`
  - test: `field_path` đích tồn tại trong schema loại (`FULL`) hoặc `light_extraction.json` (`LIGHT`)
  - test: ngày `05/03/2026` kỳ vọng so khớp `2026-03-05`; tiền `120.000.000` so khớp `120000000`
- Verify: `npx jest tests/loan-appraisal/v2-uat-map.test.ts`

### T-V2-11 — Gỡ phần cũ
- Depends: T-V2-03, T-V2-05, T-V2-07, T-V2-08
- Files: `lib/pipelines/workflows/loan-appraisal/{form-catalog,forms,grouping,cross-check-matrix,checklist-flow,dossier-checks}.ts`, `scripts/gen-loan-form-catalog.js`, `tests/loan-appraisal/v2-no-legacy.test.ts`
- Refs: V2-R02, V2-R05
- Làm: Xóa các module được thay bởi S3–S5 và danh mục mẫu biểu UAT; cập nhật `README.md` của module.
- DoD:
  - test: quét `lib/pipelines/workflows/loan-appraisal*` không còn `form_code`, `LOAN_FORMS`, `catalogFormat`
  - test: `npx tsc --noEmit -p tsconfig.json` không lỗi (chạy trong test bằng tiến trình con)
- Verify: `npx jest tests/loan-appraisal/v2-no-legacy.test.ts`

### T-V2-12 — Mô-đun kiểm tra sơ bộ `dossier-precheck`
- Depends: T-S1-08, T-V2-01
- Files: `lib/pipelines/workflows/loan-appraisal/dossier-precheck.ts`, `tests/loan-appraisal-v2/dossier-precheck.test.ts`
- Refs: V2-R17, V2-R18, V2-R19, V2-R20
- Làm: hàm thuần dựng đầu vào (checklist đã resolve + `files[]` S1), prompt mặc định + `renderPrompt` có `UNTRUSTED_DATA_GUARD`, schema zod phản hồi, rào chắn hình thức và tổng hợp số đếm / `overall`, `runDossierPrecheck(input, ask, overrides, isPassThroughError)` trả `PrecheckResult` (`COMPLETED` / `UNAVAILABLE` / `SKIPPED`).
- DoD:
  - test: prompt có checklist và `summary`/`key_facts`, KHÔNG có tên file; có `UNTRUSTED_DATA_GUARD`
  - test: mục lạ bị bỏ; `PROVIDED` với căn cứ sai loại chứng từ hoặc file không tồn tại → `UNCERTAIN`, `adjusted`
  - test: `REQUIRED` bị bỏ sót → thêm dòng `UNCERTAIN`; `NOT_APPLICABLE` cho `REQUIRED` → `UNCERTAIN`
  - test: `INCONSISTENT` không còn file → `UNCLEAR`
  - test: LLM lỗi / sai schema → `UNAVAILABLE`, `overall = null`, không `NO_GAPS_FOUND`
  - test: lỗi huỷ được ném lại; không có chương trình → `SKIPPED`, `ask` không được gọi
  - test: không `console.*` nào chứa `value` của `key_facts`
- Verify: `npx jest tests/loan-appraisal-v2/dossier-precheck.test.ts`

### T-V2-13 — Nối bước kiểm tra sơ bộ vào stage 0
- Depends: T-V2-12, T-V2-14
- Files: `lib/pipelines/workflows/loan-appraisal.ts`, `lib/pipelines/workflows/loan-appraisal/dossier-stages.ts`, `lib/pipelines/workflows/loan-appraisal/types.ts`, `tests/loan-appraisal-v2/dossier-precheck-workflow.test.ts`
- Refs: V2-R14, V2-R16, V2-R20
- Làm: sau `runClassifyStage` chạy `runDossierPrecheck`, ghi `precheck` vào checkpoint bước 0 rồi `updateProgress` để UI thấy; đưa `dossier_precheck` vào output giai đoạn 1 và output cuối; tham số `dossier_precheck`; resume không gọi lại.
- DoD:
  - test: giai đoạn 1 gọi LLM `dossier_precheck` đúng 1 lần trước S2, checkpoint bước 0 có `precheck`, output có `dossier_precheck`
  - test: resume (`currentStep = 3`) không gọi lại; `currentStep ≥ 1` mà thiếu `precheck` (và `≤ 2`) thì chạy bù
  - test: `dossier_precheck = false` → không gọi LLM, `status = SKIPPED`
  - test: LLM lỗi → workflow vẫn tới `pauseWorkflow`, `status = UNAVAILABLE`
  - test: toàn bộ test hiện có của `stop-after-intake.test.ts` vẫn pass
- Verify: `npx jest tests/loan-appraisal-v2/dossier-precheck-workflow.test.ts tests/loan-appraisal-v2/stop-after-intake.test.ts`

### T-V2-14 — Hiển thị kiểm tra sơ bộ ở giai đoạn 1
- Depends: T-V2-12
- Files: `app/loan-appraisal/types.ts`, `app/loan-appraisal-v2/lib/run-reducer.ts`, `components/loan-appraisal-v2/intake/PrecheckPanel.tsx`, `components/loan-appraisal-v2/intake/IntakeWorkspace.tsx`, `tests/loan-appraisal-v2/precheck-ui.test.ts`
- Refs: V2-R16, V2-R20
- Làm: kiểu `DossierPrecheck`; reducer lấy `precheck` từ checkpoint bước 0 khi REVEAL `classify` (hiện ngay khi đang chạy S2–S5); thẻ "Kiểm tra sơ bộ" (nhãn nháp, checklist theo nhóm, quan hệ, việc cần làm, `UNAVAILABLE` / `SKIPPED` nói rõ là chưa đánh giá); tên file lấy từ `files[]` theo `file_id`.
- DoD:
  - test: REVEAL `classify` có `precheck` → state có `precheck`; không có → null
  - test: `UNAVAILABLE` hiển thị cảnh báo, không hiển thị "không có thiếu sót"
  - test: kết quả cuối (`result.dossier_precheck`) ưu tiên hơn state giữa chừng
- Verify: `npx jest tests/loan-appraisal-v2/precheck-ui.test.ts`

### T-V2-15 — Dựng `intake_assessment` từ kết quả kiểm tra sơ bộ
- Depends: T-V2-12
- Files: `lib/pipelines/workflows/loan-appraisal/precheck-intake.ts`, `tests/loan-appraisal-v2/precheck-intake.test.ts`
- Refs: V2-R22, V2-R23
- Làm: hàm thuần `buildPrecheckIntakeAssessment(precheck, classify, evidences, acknowledgements)`, `buildPrecheckFacts(...)` (dữ kiện hồ sơ cho LLM), `buildPrecheckReadiness(...)` và `emptyDeferredStages(...)`; cùng kiểu `IntakeAssessment` / `DossierReadinessResult` để `applyIntakeLlm` và UI dùng lại.
- DoD:
  - test: `MISSING` → điểm không giải trình được, tiêu chí 1 `FAIL`; `UNCERTAIN` → giải trình được, `NEEDS_EXPLANATION`; có giải trình → `ACCEPTED`
  - test: quan hệ `INCONSISTENT` / `UNCLEAR` → điểm tiêu chí 2; `CONSISTENT` vào danh sách đã khớp
  - test: precheck `UNAVAILABLE` / `SKIPPED` → tiêu chí 1 và 2 `FAIL`, `ready_for_handover = false`, readiness `NEEDS_VERIFICATION`
  - test: file chưa nhận diện và chứng từ S2 lỗi đọc vẫn vào tiêu chí 4
  - test: dữ kiện LLM không chứa tên file, `file_id`, số giấy tờ
- Verify: `npx jest tests/loan-appraisal-v2/precheck-intake.test.ts`

### T-V2-16 — Giai đoạn 1 dừng ngay sau kiểm tra sơ bộ; S2–S5 và LLM review sang giai đoạn 2
- Depends: T-V2-15, T-V2-13
- Files: `lib/pipelines/workflows/loan-appraisal.ts`, `lib/pipelines/workflows/loan-appraisal/dossier-stages.ts`, `lib/endpoints/registry.ts`, `tests/loan-appraisal-v2/phase1-lean.test.ts`, `tests/loan-appraisal-v2/stop-after-intake.test.ts`
- Refs: V2-R14, V2-R21, V2-R22, V2-R23
- Làm: tham số `intake_run_consolidate`; điểm dừng ngay sau `dossier_precheck` (`currentStep = 1`, trước S2) với `intake_assessment` dựng bằng quy tắc từ precheck; resume chạy S2 → LLM `intake_review` + `dossier_summary` → S3–S5 → stage 3–7; giai đoạn 2 dùng lại `intake_assessment` đã chốt; test cũ của đường S2–S5 ở giai đoạn 1 chuyển sang `intake_run_consolidate = true`.
- DoD:
  - test: trước `pauseWorkflow` mặc định, danh sách lời gọi connector chỉ có precheck (1 lần `ext-fact-verifier`); KHÔNG có OCR S2, `intake_review`, `dossier_summary`, so ngữ nghĩa; `pauseWorkflow` nhận `currentStep = 1`
  - test: không có checkpoint stage 1 và stage 2; output có `documents.evidences = []`, `customer_360 = null`, `checklist.status_code = DEFERRED_TO_PHASE_2`, `master_dossier = null`, `intake_assessment` (RULES) và `dossier_precheck`
  - test: resume (`currentStep = 1`) chạy S2 đúng 1 lần rồi `intake_review` + `dossier_summary` đúng 1 lần mỗi loại với dữ kiện từ precheck, rồi S3–S5 đúng 1 lần; không gọi lại precheck; ra `customer_360`, `checklist`, `cross_check`, `master_dossier`; `intake_assessment` cuối có `review.source = LLM`
  - test: resume lần hai sau khi đã có checkpoint không chạy lại S2, S3–S5, review, summary
  - test: `intake_run_consolidate = true` → hành vi cũ (checkpoint stage 2 có ở giai đoạn 1, dừng `currentStep = 3`); `stop_after_intake = false` → chạy một lần
  - test: operation cũ (checkpoint stage 2 đã có, `currentStep = 3`) resume không chạy lại S3–S5
  - test: toàn bộ test hiện có của `stop-after-intake.test.ts` vẫn pass khi truyền `intake_run_consolidate = true`
- Verify: `npx jest tests/loan-appraisal-v2/phase1-lean.test.ts tests/loan-appraisal-v2/stop-after-intake.test.ts`

### T-V2-17 — Giao diện giai đoạn 1 tinh gọn
- Depends: T-V2-16
- Files: `app/loan-appraisal-v2/lib/stages.ts`, `app/loan-appraisal-v2/lib/run-reducer.ts`, `app/loan-appraisal-v2/lib/selectors.ts`, `components/loan-appraisal-v2/intake/IntakeWorkspace.tsx`, `tests/loan-appraisal-v2/phase1-lean-ui.test.ts`
- Refs: V2-R24
- Làm: `extract_evidence` và `consolidate_dossier` sang phase 2, `INTAKE_STAGE_COUNT = 1`; `isDeferredToPhase2(result)`; ẩn 3 thẻ + OCR và hiện ghi chú khi giai đoạn 1 chưa có S2–S5.
- DoD:
  - test: `PAUSED` đánh dấu đúng 1 stage xong, `RESUMED` đặt `extract_evidence` đang chạy
  - test: operation cũ dừng sau S3–S5 vẫn tính 3 stage xong, `RESUMED` chạy stage 4
  - test: `isDeferredToPhase2` đúng với output giai đoạn 1 mới, sai với kết quả cuối và kết quả cũ
  - test: giai đoạn 1 chỉ có `classify`; `extract_evidence` và `consolidate_dossier` thuộc `CREDIT_APPRAISAL`
- Verify: `npx jest tests/loan-appraisal-v2/phase1-lean-ui.test.ts tests/loan-appraisal-v2/run-reducer.test.ts`
