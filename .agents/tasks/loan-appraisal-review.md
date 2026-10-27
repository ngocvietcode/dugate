# Review chức năng Loan Appraisal (thẩm định hồ sơ vay HKD)

Phạm vi: `lib/pipelines/workflows/loan-appraisal.ts`, module `lib/pipelines/workflows/loan-appraisal/*`, `prompts/loan-appraisal-prompts.ts`, UI `app/loan-appraisal/*`, các API `app/api/v1/operations/[id]/*`, engine dùng chung (`workflow-engine.ts`, `state-transition.ts`). Chỉ đọc, không sửa code.

## Tóm tắt

Kiến trúc đúng hướng: 3 stage AI chỉ trích xuất evidence, 5 stage sau là code thuần. Có rào an toàn cho LLM (guard prompt injection, evidence_id phải tồn tại, PASS phải dựa trên evidence ACCEPTED). AuthZ trên API operation cũng ổn. Vấn đề nằm ở 3 chỗ:

1. **Logic nghiệp vụ có lỗi khiến kết quả sai hoặc không bao giờ ra kết quả tốt.**
   - `parseMoney` đọc "1,5 tỷ" thành 1,5 đồng. Đã chạy thử để xác nhận. Prompt bóc tách lại yêu cầu model giữ nguyên định dạng số gốc, nên lỗi này dễ gặp trong thực tế.
   - Yếu tố 5C "Capital" bị hardcode `REVIEW`. Vì vậy `COMPLETE`, `PARTIAL`, `CONSIDER`, `CREDIT_REVIEW` không bao giờ xảy ra.
   - Với check set mặc định, DSCR/LTV/hạn mức trượt chỉ cho ra `PASS_WITH_CONDITIONS`, nên trạng thái `BLOCKED` cũng không bao giờ xảy ra.
2. **Mã lỗi sai.** Workflow ném `INPUT_INVALID:` nhưng bộ phân loại chỉ nhận `INVALID_INPUT`. Hồ sơ không đọc được bị báo `SYSTEM_ERROR, retryable=true` qua webhook. Đã chạy thử để xác nhận. IDP có thể gửi lại một hồ sơ hỏng mãi.
3. **Orchestration chưa bền.**
   - Cancel không dừng workflow. Sau đó `completeWorkflow`/`failWorkflow` ghi đè `CANCELLED` và vẫn gửi webhook, vẫn tính tiền.
   - Workflow không có deadline tổng.
   - Fan-out không có giới hạn đồng thời.
   - Khi stall và chạy lại, mọi sub-step của stage đang dở bị chạy lại, tốn chi phí AI hai lần.
   - Loan-appraisal **không có HITL**: không gọi `pauseWorkflow`. Bối cảnh trong brief nói có `WAITING_USER_INPUT`, nhưng code hiện tại không dùng.

Test: `npx jest tests/loan-appraisal tests/endpoints/encryption-params-registry.test.ts --ci` cho kết quả 11 suite / 118 test đều pass. Chưa có test nào cho `FiveCStrategy`, `RecommendationStrategy`, `aggregateRuleResults`, `deriveProcessingStatus`, `buildDossierChecks`, `buildIntakeTable`, `parseMoney` của loan-appraisal, hay cho orchestrator `runLoanAppraisal`.

## 1. Luồng end-to-end

```
UI /loan-appraisal (page.tsx, useLoanAppraisalPolling)
  POST /api/v1/docs/workflows  (process=loan-appraisal, product_code, flow, files[])
    → BullMQ pipeline queue → worker.ts → runWorkflow → runLoanAppraisal(ctx)

Stage 0 classify            AI fan-out (ext-classifier, 1 sub-op/file, trễ index*1.5s)  → ClassifiedDoc[]
Stage 1 extract_evidence    AI fan-out (ext-data-extractor, 1 sub-op/file)               → ExtractedDoc[]
Stage 2 consolidate_dossier AI 1 lần (ext-fact-verifier)                                 → AppraisalResult (customer_360, checklist, cross_check)
  [thuần, dựng lại mỗi lần chạy] IntakeEvidenceStrategy → EvidenceRegistry + intake
     master_data, grouping, master_data_by_dimension, cross_check_matrix, intake_table,
     dossier_checks (deterministic), DossierReadinessStrategy
Stage 3 calculate_financials HkdSecuredFinancialStrategy → FinancialMetrics (DSCR, LTV, CFADS…)   [checkpoint]
Stage 4 assess_5c            FiveCStrategy                                                   [luôn tính lại]
Stage 5 policy               rule engine + 1 lần gọi rule LLM (ext-fact-verifier)          [checkpoint]
Stage 6 stress_and_score     ScoreStrategy → luôn NOT_CONFIGURED/UNAVAILABLE                [checkpoint]
Stage 7 recommendation       RecommendationStrategy + deriveProcessingStatus                [luôn tính lại, không lưu artifact]
  → completeWorkflow(finalResult = AppraisalResultV2)
  → webhook extracted_data = buildLoanAppraisalIntegrationPayload (dugate.loan-appraisal.integration)
UI poll GET /api/v1/operations/{id}?view=compact mỗi 2s; mở lại bằng GET view đầy đủ
```

Checkpoint: `ctx.currentStep` là stage kế tiếp (`finishStage`, loan-appraisal.ts:118-122). `updateProgress` ghi lại toàn bộ `stepsResultJson` mỗi lần được gọi (workflow-engine.ts:429-443).

## 2. Findings

Ký hiệu: [RUN] là đã xác minh bằng chạy. [CODE] là suy ra từ đọc code.

### Critical

**C1. `parseMoney` bỏ qua hệ số "tỷ", đọc sai số tiền bằng chữ/định dạng VN.** [RUN]
- Vị trí: `loan-appraisal/evidence.ts:179`. Regex `\btỷ\b` không bao giờ khớp. Trong JS, `\b` chỉ hiểu ký tự ASCII, nên sau "ỷ" không có ranh giới từ.
- Kết quả chạy:
  - `"1,5 tỷ"` ra `1.5`; `"2 tỷ đồng"` ra `2`.
  - `"50,000 USD"` ra `50`. Hàm không nhận diện tiền tệ, và cách xử lý dấu phân cách cũng sai.
  - `"(1.000.000)"` ra `1000`.
  - `"-5.000.000"` ra `-5.000.000`, sau đó bị `findMoneyEvidence` (evidence.ts:229) loại vì âm.
- Tác động:
  - Số tiền đề nghị hoặc giá trị TSBĐ có thể nhỏ đi 10⁹ lần. LTV gần 0 nên rule `MAX_LTV`/`MAX_AMOUNT` báo PASS sai.
  - Cross-check matrix (`kind: 'money'`) báo lệch oan.
  - Prompt bóc tách yêu cầu "GIỮ NGUYÊN … định dạng số như trên chứng từ gốc" (loan-appraisal-prompts.ts:693), nên đầu vào dạng chuỗi rất phổ biến.
  - HKD lỗ (lợi nhuận âm) bị coi là thiếu dữ liệu chứ không phải DSCR âm/FAIL.
- Đề xuất:
  - Dùng lookaround Unicode (`(?<![\p{L}])tỷ(?![\p{L}])`, cờ `u`) hoặc so khớp sau khi bỏ dấu.
  - Nhận diện mã tiền tệ khác VND và trả null kèm cảnh báo.
  - Xử lý số âm dạng `(…)`.
  - Cho phép lợi nhuận âm cho CFADS.
  - Thêm property test, giống `tests/payroll-verify/money-parse.property.test.ts`.
  - Cân nhắc gộp với `lib/pipelines/workflows/payroll-money.ts`, vì hiện có hai `parseMoney` khác nhau.

### High

**H1. Lỗi input bị phân loại là SYSTEM_ERROR, retryable=true.** [RUN]
- Vị trí: `loan-appraisal.ts:189,255` ném `INPUT_INVALID: …`. `classifyWorkflowFailure` (workflow-engine.ts:561) chỉ nhận marker `INVALID_INPUT`.
- Chạy thử cho kết quả `SYSTEM_ERROR true`.
- Tác động: webhook báo IDP rằng có thể retry một hồ sơ không nhận dạng được hoặc không bóc tách được. IDP gửi lại vô ích và tốn chi phí AI mỗi lần. Operations UI cũng hiển thị "internal error".
- Đề xuất: đổi 2 chỗ throw sang `INVALID_INPUT:`, giống dòng 163. Thêm test vào `tests/pipelines/workflow-failure.test.ts` dùng đúng chuỗi lỗi của loan-appraisal.

**H2. 5C "Capital" luôn REVIEW, nên nhiều trạng thái đầu ra không bao giờ xảy ra.** [CODE]
- Vị trí: `strategies.ts:479`. `factor('C3', 'Capital', 'REVIEW', …)` luôn kèm weakness `OWNER_CAPITAL_EVIDENCE_REQUIRED`. `factor()` chỉ hạ trạng thái, không bao giờ nâng.
- Hệ quả:
  - `fiveC.overall_status` không bao giờ là `PASS`.
  - `deriveProcessingStatus` (state-machine.ts:114-122) không bao giờ ra `COMPLETE` hay `PARTIAL`.
  - `RecommendationStrategy` (strategies.ts:591) không bao giờ ra `CONSIDER`.
  - `review.route` (strategies.ts:604) không bao giờ là `CREDIT_REVIEW`.
  - Stage 4 luôn ở trạng thái `PARTIAL_SUCCESS`.
- Tác động: mọi hồ sơ, kể cả hồ sơ hoàn hảo, đều thành `REFER`/`RISK_REVIEW`. Nhánh code và UI cho các trạng thái tốt là dead code. README mô tả `COMPLETE` như một kết quả có thể xảy ra.
- Đề xuất: nếu thiết kế cố ý bắt Capital luôn phải có người soát, hãy ghi rõ điều đó và bỏ các trạng thái không tới được. Nếu không, hãy định nghĩa tiêu chí Capital từ `capital_need.own_capital / total_capital_need` (đã có trong preset businessPlan).

**H3. Check set mặc định không bao giờ BLOCK; field `action: 'block'` không có tác dụng.** [CODE]
- Vị trí: `check-set.ts:96-131`. DSCR/LTV/MAX_AMOUNT có `severity: 'BLOCKER'` nhưng `exception_allowed: true`.
- Thứ tự xét trong `aggregateRuleResults` (rules.ts:154-158):
  - Lệnh return `FAIL` chỉ áp dụng khi `!exception_allowed`.
  - FAIL có exception cho ra `PASS_WITH_CONDITIONS`.
- `action` được parse (check-set.ts:362) nhưng không được rule engine hay aggregate dùng tới. UI cấu hình vẫn cho chọn "Hành động: block".
- Tác động: DSCR 0,3 hoặc LTV 150% được gắn nhãn policy "PASS_WITH_CONDITIONS". `processing_status = BLOCKED` không xảy ra với cấu hình mặc định. Admin tưởng "block" có hiệu lực.
- Đề xuất:
  - Đưa `action` vào aggregate (`block` + FAIL cho ra FAIL, trừ khi đã có exception được phê duyệt), hoặc bỏ field này khỏi UI/schema.
  - Đổi nhãn kết quả FAIL có thể ngoại lệ thành `FAIL_EXCEPTION_REQUIRED` thay vì "PASS_…".

**H4. Cancel không dừng workflow, và trạng thái CANCELLED bị ghi đè.** [CODE]
- Vị trí:
  - `app/api/v1/operations/[id]/cancel/route.ts:58-61` chỉ đổi state.
  - `runLoanAppraisal` không kiểm tra cancel giữa các stage.
  - `completeWorkflow`/`failWorkflow` (workflow-engine.ts:462-466, 583-586) gọi `transitionOperationState` không có `onlyIf`. Guard chỉ chạy khi có `onlyIf` (state-transition.ts:299-306).
  - `updateProgress` cũng ghi đè không điều kiện.
- Tác động: sau khi cancel, workflow vẫn gọi AI (fan-out + rule LLM), rồi ghi `SUCCEEDED`, gửi webhook SUCCEEDED và cộng `apiKeys.totalUsed`.
- Đề xuất:
  - Thêm `onlyIf: { done: false }` vào complete/fail.
  - Thêm hàm `assertNotCancelled(ctx)` đọc state ở `beginStage` và trước mỗi `enqueueSubStep`.
  - Xoá các sub-job còn đang waiting.

**H4 — Trạng thái sửa (đã implement, chưa commit).**
- Files đổi: `lib/operations/state-transition.ts` (thêm `onlyIf.stateNotIn`, check sau row lock `FOR UPDATE` nên atomic), `lib/pipelines/workflow-engine.ts` (`completeWorkflow`/`failWorkflow` truyền `onlyIf: { stateNotIn: ['CANCELLED'] }`, nếu kết quả là CANCELLED thì log + return, không webhook, không cộng `totalUsed`, không throw; `updateProgress` thêm điều kiện `state <> 'CANCELLED'`; thêm `WorkflowCancelledError`, `isOperationCancelled`, `assertNotCancelled`; `failWorkflow` bỏ qua sentinel; `runWorkflow` bỏ qua op đã CANCELLED trước khi chạy), `lib/pipelines/workflows/loan-appraisal.ts` (`assertNotCancelled` ở `beginStage`, wrapper `enqueueChecked` trước mỗi sub-step, catch cục bộ stage 0/1/5 rethrow sentinel), `app/api/v1/operations/[id]/cancel/route.ts` (`onlyIf: { done: false }`; nếu kết quả không phải CANCELLED thì trả 409 `already-done` có sẵn; response thành công giữ nguyên).
- `enqueueSubStep` dùng chung KHÔNG đổi, nên các workflow khác chỉ khác ở chỗ op CANCELLED không còn bị ghi đè / không webhook / không `totalUsed`. Webhook contract không đổi.
- Test mới: `tests/pipelines/workflow-cancel-guard.test.ts` (6 case), `tests/pipelines/loan-appraisal-cancel.test.ts` (3 case), 2 case `stateNotIn` trong `tests/operations-request-tracking/state-transition.test.ts`.
- RED trước khi sửa: workflow-cancel-guard 4 fail/2 pass (complete ghi đè CANCELLED→SUCCEEDED, fail ghi đè →FAILED, sentinel chưa có, updateProgress không có điều kiện; 2 case control RUNNING pass); state-transition 1 fail (stateNotIn bị bỏ qua, CANCELLED→SUCCEEDED); loan-appraisal-cancel 3 fail (`WorkflowCancelledError is not a constructor`, nghĩa là fail ở mức import, chưa chứng minh hành vi trên code cũ).
- GREEN sau khi sửa: 3 file trên pass (6 + 3 + state-transition pass).
- `npx jest tests/pipelines tests/loan-appraisal tests/operations-request-tracking tests/financial-report tests/payment-account-management tests/tracing-portal tests/crypto --ci --roots tests`: 98 suites pass, 9 suites fail (12 test), 989 pass. 9 suite fail là `pipelines/parse-field-confidence`, `payment-account-management/extract-schemas`, `financial-report/registry-params`, `operations-request-tracking/{rollout,rollout-smoke,business-query,business-query-dashboard,api-contract,business-operations-routes}`. Không file nào import/nhắc workflow-engine, cancel hay state-transition (grep xác nhận), lỗi là đếm schema/registry, dashboard variant, v.v.; tôi KHÔNG chạy lại trên code cũ nên đây là nhận định, chưa được chứng minh là lỗi có sẵn. Dùng `--roots tests` để không quét `.worktrees/`.
- Suites dùng workflow-engine (payment-account-management/update-verify, tracing-portal, financial-report, workflow-fail-persistence, workflow-metadata-persistence, state-writer-routing, crypto/payload-encrypt): pass.
- `npx tsc --noEmit`: sạch (0 lỗi) sau khi sửa lỗi TS trong test mới. Không chạy eslint.
- Chưa làm: xoá sub-job BullMQ đang waiting (job id ngẫu nhiên, nằm ở nhiều queue theo worker group, job đang chạy không huỷ được); huỷ AI call đang chạy dở; chi phí phát sinh trước khi cancel không được ghi/tính (`totalUsed` không cộng, giống `failWorkflow`); `pauseWorkflow`/`updateWorkflowProgressDetails` vẫn có thể ghi lên op CANCELLED; chưa có test riêng cho cancel route (plan step 5). M7: không đổi.

**H5. Bảng intake (US2) và checklist dùng hai bộ "chứng từ thay thế" mâu thuẫn nhau.** [CODE]
- Checklist/readiness dùng `CHECKLIST_SUBSTITUTES = { valuation: ['valuation_report'] }` (loan-appraisal-prompts.ts:495).
- Intake table dùng `SUBSTITUTES` riêng (checklist-flow.ts:35-42):
  - `valuation` được thỏa bởi cả `asset_quote` (báo giá).
  - `collateral_cert` được thỏa bởi `land_cert_purchase`, trong khi mô tả của chứng từ này ghi rõ "KHÔNG phải TSBĐ" (prompts:309-315).
  - `business_license` được thỏa bởi `business_activity` (ảnh hiện trường).
- Bộ bắt buộc cũng khác nhau: `HKD_DOCS` có 11 mục bắt buộc, `CORE_SLOTS` có 4 mục cộng định danh/TSBĐ.
- Tác động: cùng một hồ sơ, UI bảng intake báo "đủ" còn checklist/readiness báo "thiếu". Nguy hiểm hơn là GCN QSDĐ mua theo phương án được tính là TSBĐ.
- Đề xuất: dùng một nguồn sự thật duy nhất cho "bắt buộc" và "thay thế". Bỏ `land_cert_purchase` và `asset_quote` khỏi danh sách thay thế của các mục TSBĐ.

### Medium

**M1. Ngưỡng có hai nguồn, nên kết quả tự mâu thuẫn và snapshot không tái lập được.** [CODE]
- Rule dùng `definition.params?.minimum ?? policy.minimumDscr` (rules.ts:139-145). Trong khi đó `FiveCStrategy`, `RecommendationStrategy` (dscrPass, covenant, cap LTV) và `snapshotPolicy().thresholds` (product-policy.ts:77) chỉ dùng `policy.*`.
- Tác động: nếu admin đặt `params.minimum = 1.5` trong check set mà `loan_policy` vẫn là 1.25, thì rule báo FAIL, nhưng 5C báo DSCR_PASS và recommendation vẫn gợi ý số tiền với covenant "DSCR ≥ 1.25". `config_snapshot` ghi 1.25 nên audit sai. Snapshot cũng không lưu `params` hay prompt của từng check.
- Đề xuất: resolve ngưỡng hiệu lực một lần (params > loan_policy > default), truyền cho mọi strategy và ghi vào snapshot.

**M2. Parse kỳ hạn và lãi suất sai ở các chuỗi thường gặp.** [RUN]
- `parseTenorMonths("36 tháng (3 năm)")` ra 432; `"5 năm 6 tháng"` ra 60.
- `parseRatePercent("0.5")` ra 50; `"12 tháng đầu 8%/năm"` ra 12.
- Vị trí: strategies.ts:233-250.
- Tác động: nghĩa vụ nợ năm (niên kim) và DSCR sai khi hồ sơ không có `annual_debt_service`.
- Đề xuất: ưu tiên số đứng cạnh đơn vị ("tháng"/"năm", "%"). Trả null khi có nhiều số mơ hồ. Bổ sung test.

**M3. Recommendation thiếu nhất quán.** [CODE]
- Vị trí: strategies.ts:565-593.
  - `suggested_amount_vnd` vẫn được tính khi `collateral === null`, tức không có trần LTV, dù sản phẩm là vay có TSBĐ.
  - Khuyến nghị lúc đó là `INSUFFICIENT_DATA`, nhưng vẫn kèm số tiền gợi ý.
  - `suggested_tenor_months` luôn là `defaultTenorMonths` (18), không theo kỳ hạn KH đề nghị, dù DSCR được tính theo kỳ hạn đề nghị.
  - Không có giá trị `DECLINE`, nên policy BLOCKED vẫn ra `REFER`.
- Đề xuất: chỉ gợi ý số tiền khi LTV tính được. Dùng kỳ hạn đã dùng để tính DSCR. Ghi rõ lý do khi bị BLOCKED.

**M4. Kiểm tra hồ sơ (dossier-checks) cho cảnh báo sai.** [CODE]
- `EXPIRY_PATH` khớp `document_validity` (dossier-checks.ts:47). Field này có trong `legal_info` của hầu hết preset, và thường chứa câu kiểu "có hiệu lực từ ngày 01/01/2020". Hàm sẽ parse ngày đó và báo "Giấy tờ hết hiệu lực".
- `CONFIRM_DATE_PATH` khớp `marriage_registration_date` (dòng 48). Preset civil-doc có cả `marital_status`, nên Giấy chứng nhận kết hôn đăng ký quá 6 tháng bị báo "Xác nhận tình trạng hôn nhân hết hiệu lực". Giấy kết hôn không có hạn.
- `toDate` (dòng 41) chấp nhận 31/02 (Date.UTC tự chuyển sang tháng 3). Năm 2 chữ số không được hỗ trợ.
- Đề xuất: chỉ dùng các trường hết hạn tường minh (`expiry_date`, `valid_until`, `confirmation_expiry_date`). Tách logic 6 tháng cho riêng doc_type "xác nhận tình trạng hôn nhân". Validate ngày bằng round-trip.

**M5. Rủi ro đơn vị năm/tháng trong doanh thu/lợi nhuận.** [CODE]
- Hint của businessPlan nói: nếu chỉ có số theo tháng thì "ghi đúng giá trị tháng và nêu rõ trong tên field" (prompts:164). Nhưng schema chỉ có `annual_*`, và strategy (strategies.ts:273-274) nhận mọi field khớp `/annual_revenue|net_profit/`.
- CFADS lấy thẳng lợi nhuận từ phương án vay do KH tự lập (strategies.ts:335).
- Tác động: DSCR có thể sai 12 lần, hoặc dựa trên số tự khai.
- Đề xuất: thêm field `period` hoặc `monthly_*` riêng vào schema. Ưu tiên nguồn `income_statement`/BCTC hơn `business_plan`, và đánh dấu nguồn tự khai.

**M6. Kết quả cross-check matrix không ảnh hưởng readiness hay recommendation.** [CODE]
- `crossCheckMatrix` (loan-appraisal.ts:327) chỉ được xuất ra. `DossierReadinessStrategy` chỉ đọc `mergedCrossCheck` (LLM + dossier-checks, dòng 339-349), mà dossier-checks đều là `warning`.
- Tác động: lệch số CCCD hoặc số GCN phát hiện bằng code không đổi `processing_status`.
- Đề xuất: đưa các `MISMATCH` ở field định danh/TSBĐ vào `blocking_reasons`.

**M7. Fan-out không giới hạn đồng thời, không có deadline workflow, retry/stall tốn chi phí.** [CODE]
- `Promise.all` + `setTimeout(index*1500)` (loan-appraisal.ts:168-170, 229) không giới hạn số sub-op cùng lúc. File thứ 40 phải chờ 58,5s mới được enqueue.
- `enqueueSubStep` không được truyền `maxWaitMs`, nên mỗi sub-step có thể chờ tới timeout connector + 30s (workflow-engine.ts:259-266), và cả workflow không có trần thời gian.
- Khi worker crash, BullMQ re-run job (`maxStalledCount: 2`, worker.ts:118-119) và `currentStep` vẫn là stage đang chạy. Toàn bộ sub-step của stage bị tạo lại. Sub-op cũ vẫn chạy và tốn tiền, không ai đọc kết quả.
- `runWorkflow` và loan-appraisal cùng catch mọi lỗi (loan-appraisal.ts:591; workflow-engine.ts:1093-1097), nên `attempts: 3` không còn tác dụng với lỗi tạm thời (connector 5xx ở stage 2).
- Đề xuất:
  - Dùng semaphore p-limit theo `SUBSTEP_WORKER_CONCURRENCY`.
  - Đặt deadline workflow và truyền `maxWaitMs`.
  - Dùng sub-op id idempotent theo `(operationId, stage, file)` và tái dùng kết quả sub-op đã `done` khi resume.
  - Phân biệt lỗi retryable để BullMQ được retry.

**M8. Trùng tên file làm hỏng việc ghép file và evidence.** [CODE]
- `fileByName = new Map(filesData.map(f => [f.name, f]))` (loan-appraisal.ts:207). Mọi chỉ mục evidence (`by_file`, `found_in`, `confidenceByFileAndType`) đều khoá theo `file_name`.
- Tác động: 2 file cùng tên (ví dụ "scan.pdf" từ 2 nguồn) thì một file bị bóc tách hai lần, file kia bị mất. Evidence bị trộn.
- Đề xuất: dùng `file_id` hoặc chỉ số làm khoá, hoặc đổi tên trùng khi nhận file.

**M9. Stage 2 không có fallback, và LLM trả sai format không được báo.** [CODE]
- Lỗi sub-step ở stage 2 làm fail cả workflow, trong khi stage 0/1/5 có xử lý lỗi từng phần.
- Khi LLM trả JSON hỏng, `normalizeEvaluation` lặng lẽ tạo `customer_360 = {}` và checklist suy từ classification (prompts:930+), không gắn cờ hay warning.
- `customer_360` được ép kiểu thẳng, không validate schema. `cross_check[].documents` không được lọc theo `knownFiles` như `found_in`.
- Không có validate schema thật (zod). Mọi parser đều phòng thủ thủ công. Hiện vẫn đủ an toàn, nhưng khó bảo trì.
- Đề xuất: thêm `evaluation_parse_status` vào artifact. Nếu parse thất bại thì retry một lần, sau đó hạ readiness. Lọc `documents`.

**M10. UI.** [CODE]
- Poll cứng 10 phút (useLoanAppraisalPolling.ts:105). Hồ sơ lớn thường vượt mức này (fan-out + timeout 330s/sub-step). Khi đó UI báo lỗi dù workflow vẫn chạy.
- Operation `CANCELLED` (`done=true`) đi vào `onComplete`. Không có result nên page.tsx:186 đánh dấu 3 stage đầu "done" và đặt tiến độ 38%, không có thông báo "đã huỷ".
- Đề xuất: đổi timeout thành cảnh báo mềm và tiếp tục poll. Xử lý riêng `state === 'CANCELLED'`.

**M11. `flow` (FULL/FAST/SIMPLE) gần như không có tác dụng.** [CODE]
- `resolveLoanFlow` (checklist-flow.ts:81) chỉ dùng để lọc check set. Catalog mặc định áp cả 3 luồng, và `buildIntakeTable` dùng chung một `CORE_SLOTS` cho mọi luồng (checklist-flow.ts:60).
- UI và mô tả registry nói luồng "quyết định bộ checklist áp dụng".
- Đề xuất: cài checklist riêng theo luồng, hoặc sửa mô tả.

**M12. `collateral_owner_consent` luôn bắt buộc.** [CODE]
- Vị trí: prompts:258.
- Tác động: hồ sơ mà người vay là chủ sở hữu duy nhất vẫn bị `REQUIRED_DOCUMENTS_MISSING` và `NEEDS_DOCUMENTS`. Điều này góp phần làm gần như mọi hồ sơ ở trạng thái "tạm".
- Đề xuất: chỉ bắt buộc mục này khi grouping phát hiện đồng sở hữu hoặc chủ TSBĐ khác người vay.

### Low

- **L1. README lệch với code.**
  - README nói stage 3-7 "dựng lại mỗi lần resume". Thực tế stage 3, 5, 6 đọc từ checkpoint (loan-appraisal.ts:355-356, 396-397, 463-464). Chỉ stage 4 và 7 được tính lại.
  - README nói `review_status` dựa trên confidence phân loại. Code ưu tiên confidence trích xuất (evidence.ts:83-91).
  - README nói ghi chú hệ thống nằm trong `risk_notes`. Code đã chuyển sang `system_notes`.
- **L2.** `classification.status === 'error'` (lỗi hệ thống khi classify) có `matches: []`, nên rơi vào nhánh `UNRECOGNIZED` (checklist-flow.ts:122). Nhánh `NEEDS_REVIEW` cho lỗi (dòng 130) không bao giờ chạy tới. File timeout bị hiển thị là "không nhận dạng được".
- **L3.** Cross-check matrix:
  - `loan_tenor` so sánh kiểu text ("18 tháng" khác "18").
  - `sides[].documents` dùng `doc_type_label` thay vì tên file, nên 2 file cùng loại gộp làm một.
  - Matrix dùng cả evidence ở trạng thái REVIEW để kết luận MATCH.
- **L4.** `resolveEvidenceRefs` nhận mọi `ev-…` hợp lệ, kể cả field không hiển thị cho model (prompt-checks.ts, nhánh `validIds.has(ref)`). Điều này nới rào "model không thể đã đọc nó".
- **L5.** Thông báo LTV không thống nhất: rule hiển thị % (rules.ts), 5C hiển thị ratio `0.70`, UI hiển thị `0.70×`.
- **L6.** `updateProgress` ghi lại toàn bộ `stepsResultJson` (classification + extraction + legacyResult…) khoảng 16 lần/run, và đọc `progressLogJson` trước khi ghi. Tải DB lớn với hồ sơ nhiều trang.
- **L7.** PII trong log: `logger.error('Classify failed for ${file.name}')` (loan-appraisal.ts:183, 242). Tên file thường chứa họ tên hoặc số CCCD. Cancel route trả `detail: msg` của exception khi lỗi 500 (cancel/route.ts:68).
- **L8.** Kiểu dữ liệu bị nhân bản giữa `lib/.../loan-appraisal/types.ts` và `app/loan-appraisal/types.ts`, chưa có kiểm tra khớp lúc compile. UI có code render stress scenario, nhưng backend luôn trả `NOT_CONFIGURED`.
- **L9.** File lớn: `AppraisalWorkspace.tsx` khoảng 1.080 dòng, `loan-appraisal-prompts.ts` 950 dòng (gộp config sản phẩm, prompt, parser). `strategies.ts` gộp 7 strategy.

## 3. Đánh giá theo câu hỏi

- **Bảo mật / authZ:** GET/download/cancel/resume `operations/[id]` đều kiểm tra quyền sở hữu: apiKey phải trùng, user không phải ADMIN thì phải là `createdByUserId`. `loan_check_set`/`loan_policy` có `defaultLocked`, và `mergeParameters` (profile-resolver.ts:73-80) từ chối khi client gửi các key này. Ghi cấu hình qua `profile-endpoints` được validate fail-closed. Chưa lần theo mọi route submit khác ngoài `/api/v1/docs/workflows`.
- **Prompt injection:** đạt mức tốt.
  - Có `UNTRUSTED_DATA_GUARD` ở mọi prompt.
  - Có `sanitizeFileName` và `untrustedBlock` (gỡ thẻ trùng tên).
  - `ensurePlaceholders` chặn override làm mất dữ liệu.
  - Tên file từ LLM được lọc theo `knownFiles`.
  - Rule LLM bị giới hạn bằng evidence id thật.
  - Rủi ro còn lại: nội dung tài liệu ở stage 0/1 đi thẳng vào model dưới dạng file đính kèm (không thể bọc thẻ), chỉ có guard bằng lời.
- **Chi phí token:**
  - Extract gộp 1 lần đọc/file.
  - Evaluate giới hạn 60k ký tự.
  - Rule LLM giới hạn 18k ký tự, gộp 1 lần gọi.
  - Rủi ro lớn nhất là chạy lại do stall hoặc cancel (M7, H4), và IDP retry do mã lỗi sai (H1).
- **State machine:** `derivePhaseStatus` đúng. `deriveProcessingStatus` có các trạng thái không tới được (H2, H3).
- **HITL:** loan-appraisal không pause. Route resume chỉ dành cho `WAITING_USER_INPUT`, nên không áp dụng được. "Resume" thực tế chỉ xảy ra qua BullMQ stall re-run.

## 4. Đã xác minh / chưa xác minh

- **Đã chạy:**
  - Jest cho `tests/loan-appraisal` + encryption-params: 118/118 pass.
  - Probe tsx (file tạm trong %TEMP%, đã xoá) cho `parseMoney`, `parseTenorMonths`, `parseRatePercent`, `classifyWorkflowFailure`. Kết quả như đã trích ở C1, M2, H1.
- **Chỉ đọc code:** H2-H5, M1, M3-M12, các mục Low; hành vi cancel/ghi đè; stall re-run. Chưa chạy end-to-end với worker, Redis và Postgres.
- **Chưa đọc kỹ:** `grouping.ts`, `master-data*.ts`, phần cuối `integration-payload.ts`, `CrossCheckMatrixPanel`/`DossierIntakeWorkspace`. Chưa kiểm tra accessibility thủ công. Thanh tiến độ có `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.

## 5. Top 5 việc nên làm trước

1. **Sửa `parseMoney`** (C1): nhận đúng "tỷ" Unicode, nhận diện tiền tệ, xử lý số âm. Thêm property test. Sửa luôn `parseTenorMonths`/`parseRatePercent` (M2).
2. **Đổi `INPUT_INVALID:` thành `INVALID_INPUT:`** ở loan-appraisal.ts:189,255 (H1). Thêm test hợp đồng webhook.
3. **Chốt ngữ nghĩa quyết định** (H2, H3, M1):
   - Bỏ hardcode Capital=REVIEW hoặc ghi rõ đó là thiết kế.
   - Cho `action: block` có hiệu lực.
   - Dùng một nguồn ngưỡng và ghi đúng vào `config_snapshot`.
   - Thêm unit test cho `FiveCStrategy`, `RecommendationStrategy`, `aggregateRuleResults`, `deriveProcessingStatus`.
4. **Cancel/terminal guard** (H4): `onlyIf: { done: false }` cho complete/fail/progress, kiểm tra cancel ở mỗi stage và trước mỗi sub-step.
5. **Hợp nhất checklist/substitute** (H5, M12, M11): một nguồn "bắt buộc + thay thế" cho checklist, readiness và intake table. Bỏ `land_cert_purchase`/`asset_quote` khỏi danh sách thay thế của TSBĐ. Chỉ bắt buộc văn bản đồng ý thế chấp khi có đồng sở hữu.
