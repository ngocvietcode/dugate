# Loan Appraisal — Tách 2 giai đoạn: Tiếp nhận hồ sơ và Thẩm định tín dụng

Tài liệu task để triển khai việc tổ chức lại workflow Loan Appraisal thành hai giai đoạn nghiệp vụ, giữ nguyên API/contract hiện có.

- Phạm vi: `lib/pipelines/workflows/loan-appraisal*`, `app/loan-appraisal/*`
- Nguyên tắc: không đổi `stage_key`, không đổi endpoint, không thêm dependency, không sửa `worker.pam.js`
- Ràng buộc nghiệp vụ: mọi kết luận phải truy xuất được về evidence; thiếu căn cứ thì trả trạng thái cần xác minh, không kết luận

## Quy ước cốt lõi: gate không chặn xử lý

Cổng chuyển giai đoạn là **khuyến cáo, không phải chặn**. Hồ sơ thiếu chứng từ vẫn đi tiếp toàn bộ 8 stage.

- Giai đoạn 2 luôn chạy, kể cả khi readiness là `NEEDS_DOCUMENTS` hoặc `NEEDS_VERIFICATION`
- Thiếu chứng từ được phản ánh bằng **trạng thái và điều kiện**, không phải bằng việc dừng workflow
- Chứng từ có thể bổ sung ở giai đoạn sau; khi bổ sung, kết quả thẩm định được tính lại
- Chỉ dừng khi lỗi kỹ thuật thật sự: không phân loại được tài liệu nào, hoặc không bóc tách được dữ liệu nào (`NOT_PROCESSABLE`)

## Mapping giai đoạn

| Phase | Stage keys hiện có | Nội dung nghiệp vụ |
| --- | --- | --- |
| `DOSSIER_INTAKE` | `classify`, `extract_evidence`, `consolidate_dossier` | Phân loại chứng từ, OCR/bóc tách, kiểm tra chéo, kiểm tra đầy đủ |
| `CREDIT_APPRAISAL` | `calculate_financials`, `assess_5c`, `evaluate_policy_compliance`, `stress_and_score`, `synthesize_recommendation` | Phân tích tài chính, 5C, policy, stress/score, khuyến nghị và định tuyến |

---

## Đợt 1 — Workflow và contract ✅ HOÀN THÀNH

### T1.1 Bổ sung `phase_key` vào stage definitions
- [x] Thêm type `LoanPhaseKey = 'DOSSIER_INTAKE' | 'CREDIT_APPRAISAL'` trong `loan-appraisal/types.ts`
- [x] Thêm `phase: LoanPhaseKey` vào `StageDefinition` trong `loan-appraisal/state-machine.ts`
- [x] Gán phase cho đủ 8 stage theo bảng mapping
- [x] Giữ nguyên thứ tự và giá trị `stage_key`

**DoD:** đạt. Thêm cả `LOAN_PHASE_DEFINITIONS`, `stageIndexesOfPhase`, `phaseOfStage`.

### T1.2 Hàm tổng hợp trạng thái theo phase
- [x] Viết `derivePhaseStatus(phase, steps)` trả `PENDING | RUNNING | PARTIAL | COMPLETE | BLOCKED`
- [x] Ưu tiên trạng thái xấu nhất trong các stage thuộc phase
- [x] Không suy ra `COMPLETE` khi còn stage bắt buộc chưa chạy

**DoD:** đạt. Hàm thuần, dùng được cho cả workflow và client.

### T1.3 Artifact `DossierReadinessResult`
- [x] Định nghĩa interface trong `loan-appraisal/types.ts` với status, completeness, missing/review keys, unclassified files, extraction errors, conflicts, supplement requests, blocking reasons, `appraisal_conditional`
- [x] Thêm `dossier_readiness` vào `AppraisalResultV2`
- [x] Mirror optional `DossierReadiness` vào `app/loan-appraisal/types.ts`
- [x] Thêm `phase` vào `audit.stages`

**DoD:** đạt. Client mirror để optional nên artifact V1/V2 cũ vẫn parse được.

### T1.4 Strategy dựng readiness
- [x] Thêm `DossierReadinessStrategy` (`hkd-secured-v2:dossier-readiness`)
- [x] Input: `classification`, `extraction`, `evaluation`, `intake`, `evidence`
- [x] Conflict lấy từ `cross_check`, gắn `evidence_ids` theo `evidence.by_file`
- [x] `supplement_requests` dùng label checklist thay vì key kỹ thuật
- [x] Pure, an toàn khi rebuild trên mỗi lần resume

**DoD:** đạt. Chỉ đọc lại artifact có sẵn, không bóc tách lại.

### T1.5 Cổng chuyển giai đoạn (không chặn)
- [x] Thêm `evaluateAppraisalReadiness(readiness)` trả khuyến cáo, không phải quyền chạy
- [x] Khi không đạt: `processing_status = REVIEW_REQUIRED`, recommendation tối thiểu `REFER`, route `REQUEST_DOCUMENTS`, reason `DOSSIER_SUPPLEMENT_REQUIRED`
- [x] Không dùng kết quả gate để bỏ qua stage 3-7 hoặc dừng workflow
- [x] Chứng từ còn thiếu xuất hiện trong `conditions_precedent`

**DoD:** đạt. Số stage chạy không phụ thuộc readiness.

### T1.6 Nối vào orchestrator
- [x] Dựng readiness sau stage 2, cùng chỗ với `IntakeEvidenceStrategy`
- [x] Truyền readiness vào `RecommendationStrategy` và `deriveProcessingStatus`
- [x] Thêm `dossier_readiness` vào `finalResult`, `content_preview` và summary
- [x] Bổ sung `phase` vào `audit.stages`
- [x] Không thêm nhánh `return`/`throw` nào dựa trên readiness

**DoD:** đạt.

### T1.7 Thẩm định có điều kiện khi hồ sơ chưa đầy đủ
- [x] Chỉ số thiếu dữ liệu giữ `INSUFFICIENT_DATA` kèm cảnh báo đầu vào còn thiếu
- [x] 5C đánh giá trên phần evidence đã có; phần thiếu trả `REVIEW`
- [x] Policy rule thiếu dữ liệu trả `INSUFFICIENT_DATA`, không `FAIL` và không `PASS`
- [x] `risk_notes` nêu rõ đây là kết quả tạm trên hồ sơ chưa đầy đủ

**DoD:** đạt.

### T1.8 Bổ sung chứng từ ở giai đoạn sau
- [x] Luồng bổ sung vẫn dùng `process=loan-appraisal` và `product_code` như cũ
- [x] Readiness, 5C và quyết định cuối được tính lại trên mỗi lần chạy/resume
- [x] `conditions_precedent` sinh từ readiness hiện tại nên mục đã hoàn tất tự biến mất
- [x] `audit.generated_at` ghi nhận thời điểm tạo kết quả

**DoD:** đạt.

---

## Đợt 2 — UI hai giai đoạn ✅ HOÀN THÀNH

### T2.1 Rail tiến trình hai giai đoạn
- [x] Trong `app/loan-appraisal/page.tsx`, gom 8 bước thành 2 nhóm có thể mở rộng (`PhaseRail`)
- [x] Nhãn: `Tiếp nhận & hoàn thiện hồ sơ`, `Thẩm định & khuyến nghị`
- [x] Hiển thị các bước con khi mở rộng
- [x] Tự động focus vào giai đoạn đang chạy hoặc đang có vấn đề

**DoD:** đạt. Có `aria-expanded`/`aria-controls`, `aria-current`, focus ring; layout 1 cột trên mobile.

### T2.2 Workspace giai đoạn 1
- [x] Tạo `DossierIntakeWorkspace` trong `app/loan-appraisal/components/`
- [x] Nội dung: việc cần hoàn tất, tài liệu cần xác nhận loại, lỗi bóc tách, mâu thuẫn chứng từ
- [x] Hiển thị rõ trạng thái readiness và danh sách cần bổ sung
- [x] Nêu rõ hồ sơ vẫn được thẩm định tiếp và có thể bổ sung sau
- [x] Dữ liệu gốc và căn cứ thu gọn trong accordion theo từng chứng từ/mâu thuẫn

**DoD:** đạt. Dữ liệu bóc tách hiển thị theo trường thay vì JSON thô.

### T2.3 Workspace giai đoạn 2
- [x] Tạo `CreditAppraisalWorkspace` bọc các panel hiện có
- [x] Tab con: `Hồ sơ khách hàng`, `Policy & đánh giá 5C`, `Rủi ro & khuyến nghị`
- [x] Khi chưa qua gate: vẫn hiển thị đầy đủ kết quả thẩm định, kèm banner `Kết quả tạm trên hồ sơ chưa đầy đủ`
- [x] Banner liệt kê nội dung cần bổ sung và có nút về giai đoạn 1
- [x] Giữ toàn bộ drill-down evidence đã có

**DoD:** đạt. Tab `Chứng từ & dữ liệu gốc` chuyển hẳn về giai đoạn 1 để không trùng lặp.

### T2.4 Điều hướng giữa hai giai đoạn
- [x] `AppraisalWorkspace` chọn workspace theo phase đang xem (`PhaseSwitch`)
- [x] Cho phép chuyển qua lại thủ công ở mọi trạng thái readiness
- [x] Mặc định: chưa đạt gate thì mở giai đoạn 1, đạt rồi thì mở giai đoạn 2
- [x] Không disable tab giai đoạn 2 khi hồ sơ còn thiếu chứng từ
- [x] Evidence Registry dùng chung cho cả hai giai đoạn

**DoD:** đạt. `phaseOverride` giữ lựa chọn của người dùng qua các lần polling.

---

## Đợt 3 — Compatibility và validation

### T3.1 Suy luận phase cho artifact cũ
- [ ] Artifact không có `phase_key` thì suy từ `stage_key`, fallback theo numeric step
- [ ] Kết quả V1 (không có `output_version`) vẫn render legacy
- [ ] Kết quả V2 thiếu `dossier_readiness` thì UI fail-safe về trạng thái cần xác minh

**DoD:** Operation cũ vẫn poll, resume và render bình thường.

### T3.2 Rà API và payload
- [ ] Không đổi `/api/v1/docs/workflows`, `/api/v1/operations/{id}`
- [ ] Không đổi `process=loan-appraisal`, `product_code`, `files[]`, `X-API-Key`
- [ ] Không đổi `output_version` và enum wire đang dùng; field mới phải optional

**DoD:** `git diff` không có thay đổi contract bắt buộc nào.

### T3.3 Validation
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `git diff --check`
- [ ] `git diff -- package.json package-lock.json` rỗng
- [ ] `git diff -- worker.pam.js` rỗng

**DoD:** Toàn bộ pass; build render đủ số trang như trước.

---

## Tiêu chí hoàn thành tổng thể

- [ ] UI thể hiện rõ hồ sơ đang ở giai đoạn tiếp nhận hay thẩm định
- [ ] OCR, bóc tách và kiểm tra chéo nằm hoàn toàn trong giai đoạn 1
- [ ] 5C, policy, stress/score, khuyến nghị, routing nằm trong giai đoạn 2
- [ ] Hồ sơ thiếu chứng từ vẫn chạy hết pipeline và vẫn xem được kết quả thẩm định tạm
- [ ] Kết quả trên hồ sơ chưa đầy đủ luôn ở trạng thái cần bổ sung, không ra `CONSIDER`/`COMPLETE`
- [ ] Bổ sung chứng từ muộn thì kết quả được tính lại đúng
- [ ] Mọi nhận định vẫn truy xuất được về evidence
- [ ] Operation cũ và mới đều hoạt động
- [ ] Typecheck và production build pass

## Rủi ro cần lưu ý

- Đổi nhãn UI không được làm thay đổi logic resume theo `stage_key`
- Gate là khuyến cáo; nếu triển khai sai thành điều kiện chạy sẽ làm mất kết quả thẩm định tạm
- Thiếu dữ liệu không được biến thành `FAIL`; phải giữ `INSUFFICIENT_DATA`/`REVIEW` để tránh kết luận tín dụng sai
- Kết quả tạm cần nhãn rõ ràng, tránh người dùng hiểu là kết luận cuối
- Tránh nhân đôi nguồn sự thật: readiness chỉ tổng hợp lại `intake`/`cross_check`/`evidence`, không tự bóc tách lại
