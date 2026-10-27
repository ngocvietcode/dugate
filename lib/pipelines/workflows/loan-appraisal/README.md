# Loan Appraisal V2

> **Từ 2026-10-19 (spec-v3, D-32):** stage 0–2 chạy engine `lib/loan-dossier` — S1 phân loại (`dossier-stages.ts`),
> S2 bóc tách theo schema spec-v3, S3 → S4 → S5 bằng rule (`dossier-consolidate.ts`, không còn gọi AI tổng hợp).
> Output `3.0` (V2-R09): `documents` = S1 + S2, `customer_360` = S3, `checklist` = S4, `cross_check` = S5; payload tích hợp
> schema `2.0` (`integration-payload.ts`). Đầu vào tài chính đọc field có cấu trúc (`financial-inputs.ts`, V2-R06);
> registry evidence + provenance Customer 360 từ S3 (`evidence-v3.ts`). Đã gỡ: danh mục mẫu biểu `form-catalog.ts`/`forms.ts`,
> `grouping.ts`, `cross-check-matrix.ts`, `checklist-flow.ts`, `dossier-checks.ts`, `master-data-dimension.ts`, prompt
> classify/extract/evaluate và trang `/loan-appraisal` cũ (giao diện duy nhất là `/loan-appraisal-v2`). Nguồn chuẩn:
> `docs/loan-appraisal/spec-v3/cross_cutting/v2_integration.md`. Các mục bên dưới mô tả kiến trúc cũ ở stage 0–2 chỉ để tra cứu.

Workflow thẩm định hồ sơ vay có tài sản bảo đảm (HKD, SME...; sản phẩm cấu hình trong `loan_products.json`). Chạy qua
`process=loan-appraisal`. Kiến trúc: 5 stage. 2 stage AI (phân loại S1, bóc tách S2) lập evidence có nguồn từ chứng từ
gốc; sau đó 3 stage **tính bằng code** (deterministic; rule LLM ở stage 3 có rào chắn) suy ra chỉ số tài chính, kết
quả bộ rule (engine + LLM) và khuyến nghị — không có bước nào để LLM tự quyết định số liệu hay kết luận tín dụng.

Entry point: `lib/pipelines/workflows/loan-appraisal.ts` (`runLoanAppraisal`).
Logic thẩm định nằm trong thư mục này; logic hồ sơ spec-v3 (S1–S5, graph, claims, catalog) nằm ở `lib/loan-dossier/`.
Kiến trúc tổng thể, khoảng trống và lộ trình SME: [docs/loan-appraisal/ARCHITECTURE.md](../../../../docs/loan-appraisal/ARCHITECTURE.md).

## Nguyên tắc cốt lõi

- **Mọi kết luận phải truy được về evidence.** Không có số liệu hay đánh giá nào
  được tạo ra mà không dẫn chiếu `evidence_ids` về đúng chứng từ gốc.
- **Thiếu dữ liệu ≠ trượt điều kiện.** Khi không tính được một chỉ số, kết quả là
  `INSUFFICIENT_DATA`, không suy đoán thành PASS hay FAIL.
- **Hồ sơ chưa đầy đủ không chặn xử lý.** Giai đoạn 2 hiện không chạy các bước kiểm tra hồ sơ
  (xem "Các bước kiểm tra hồ sơ tạm tắt"); workflow luôn chạy hết 5 stage và không dừng nửa đường.
- **Config không tạo ra logic mới.** Rule engine cấu hình được ngưỡng, không cấu
  hình được phép so sánh; danh sách rule engine hợp lệ cố định trong code
  (`DETERMINISTIC_CHECK_IDS`).
- **Không công bố số liệu chưa được phê duyệt.** AML/PEP/sanctions trả
  `NOT_RUN` cho tới khi có provider — không bao giờ mặc định là "sạch". Stress
  test và scorecard/rating/PD đã bỏ khỏi workflow.
- **Quyết định cuối không thuộc workflow.** Kết quả chỉ là khuyến nghị hỗ trợ
  thẩm định, quyền quyết định thuộc `EXTERNAL_APPROVAL_SYSTEM` (hằng số trước
  đây ghi ở `audit`, nay không ghi vào kết quả nữa) — không phải hệ thống phê
  duyệt khoản vay.

## Các bước kiểm tra hồ sơ tạm tắt (giai đoạn 2)

Giai đoạn 2 hiện gồm: OCR (S2) → **gom người & tài sản (S3, thuần, không LLM, không stage riêng)** → chỉ số tài chính → bộ rule (rule engine + rule LLM) →
khuyến nghị. S3 chạy lại mỗi lần (kể cả resume) và được dùng ở ba nơi: `customer_360` của kết quả, giá trị TSBĐ / LTV, và khối người & tài sản trong
prompt rule LLM (dạng gọn dựng từ `DossierGraph`, xem `lib/loan-dossier/graph/render.ts`). Lỗi S3 không đổ workflow: `customer_360 = null`, LTV giữ
`NOT_APPLICABLE`, rule LLM không có khối người & tài sản. Các bước sau **không còn được workflow gọi** (code còn nguyên trong `lib/loan-dossier/s4..s5`,
`master-*`, `intake-*`, `dossier-consolidate.ts`, để bật lại):

| Tắt | Hệ quả trong kết quả |
|---|---|
| Checklist 46 mục (S4), đối chiếu chéo (S5) | `checklist` / `cross_check` là khối rỗng với `status_code = DOSSIER_CHECKS_DISABLED` (đủ khóa để consumer cũ không vỡ). Rule `LOAN.INTAKE.REQUIRED_DOCUMENTS` đã gỡ khỏi catalog (`RETIRED_CHECK_IDS`: cấu hình đã lưu còn id này bị bỏ êm) |
| Master dossier + hiệu chỉnh LLM, kiểm tra nháp + tổng kết LLM, readiness | Không có `master_dossier`, `intake_assessment`, `dossier_readiness`. Rule LLM đọc trực tiếp OCR |
| Khuyến nghị / `processing_status` | Chỉ dựa trên chỉ số tài chính + kết quả rule (không còn `REQUEST_DOCUMENTS`, `REQUIRED_DOCUMENTS_INCOMPLETE`) |

Giai đoạn 1 (phân loại + kiểm tra sơ bộ) giữ nguyên. Đường **resume** operation cũ (checkpoint `consolidate_dossier` theo đánh số 8 stage,
artifact không có `stage_key`, operation dừng sau S2–S5 ở giai đoạn 1) đã gỡ ở D-99 vì không còn operation nào đang dừng. Kết quả cũ đã
hoàn tất trong DB không đổi; UI và payload tích hợp vẫn đọc được cả hai dạng.

## DAG 5 stage

| # | `stage_key` | Loại | Việc làm | File chính |
|---|---|---|---|---|
| 0 | `classify` | AI (fan-out theo file / batch trang) | Phân loại tài liệu vào 47 loại chứng từ (`doc_types.json`); kiểm tra sơ bộ (`dossier_precheck`) chạy ngay sau, kết quả lưu ở checkpoint của stage này | `lib/loan-dossier/s1/`, `dossier-stages.ts`, `dossier-precheck.ts` |
| 1 | `extract_evidence` | AI (fan-out theo bản thể chứng từ) | Bóc tách theo schema spec-v3 (27 loại FULL, 20 loại LIGHT), lập evidence có nguồn | `lib/loan-dossier/s2/`, `dossier-stages.ts` |
| 2 | `calculate_financials` | Deterministic | Tính CFADS, DSCR, LTV, operating margin (từ OCR + `asset_registry` của S3 cho giá trị TSBĐ; S3 lỗi thì không đánh giá TSBĐ/LTV) | `strategies.ts` (`HkdSecuredFinancialStrategy`) |
| 3 | `evaluate_policy_compliance` | Rule engine + rule LLM | Chạy bộ rule cấu hình được theo sản phẩm; mỗi rule thuộc một nhóm (`group`, xem `rule-groups.ts`) | `rules.ts`, `check-set.ts`, `prompt-checks.ts`, `rule-groups.ts` |
| 4 | `synthesize_recommendation` | Decision strategy | Khuyến nghị có giới hạn + định tuyến rà soát; chạy sau cùng, chỉ dựa trên chỉ số tài chính và kết quả rule | `strategies.ts` (`RecommendationStrategy`) |

Stage 0-1 là AI, checkpoint là `data` của S1 / S2 theo spec-v3 (V2-R09: không còn shape V1 `ClassifiedDoc[]` /
`ExtractedDoc[]`). Giữa stage 1 và 2, S3 (gom người & tài sản), `DossierGraph` và sổ Claim chạy bằng code, không có
checkpoint. Stage 2-4 thuần tính toán (trừ rule LLM ở stage 3), được **dựng lại mỗi lần resume** (không đọc từ
checkpoint) để một checkpoint cũ không thể mang theo kết luận đã lỗi thời khi logic/policy thay đổi.

`LOAN_STAGE_DEFINITIONS` (`state-machine.ts`) là nguồn sự thật duy nhất cho thứ
tự stage, `stage_key`, và mỗi stage thuộc phase nào.

## Loại chứng từ và schema

Từ spec-v3 (V2-R02) phân loại và bóc tách làm việc theo **loại chứng từ** (`doc_type_key`, 47 loại trong
`lib/loan-dossier/catalog/data/doc_types.json`); danh mục mẫu biểu `form_code` / `form-catalog.ts` / `forms.ts` đã gỡ.

- 27 loại `extraction_level = FULL` có schema riêng (`catalog/data/doc_schemas/`, zod ở `lib/loan-dossier/s2/schemas/`):
  ngày ISO, tiền là số nguyên, địa chỉ là object, `parties[]`, `assets[]` (`02_conventions`).
- 20 loại `LIGHT` chỉ có `{parties, legal_info, fields}` với vài field khai trong `light_extraction.json`.
- Trên giấy đề nghị vay, ô "Lãi suất" ghi **mã biểu** (LC10…) → `loan_info.interest_rate_code`, không dùng để tính;
  `loan_info.interest_rate` là %/năm in trên giấy. DSCR chỉ tính khi có `interest_rate` (V2-R06).

## Hai phase nghiệp vụ

Stage được nhóm vào 2 phase hiển thị trên UI, không đổi `stage_key` hay thứ tự:

| Phase | Gồm stage | Ý nghĩa |
|---|---|---|
| `DOSSIER_INTAKE` | 0 | Phân loại & kiểm tra sơ bộ (`dossier_precheck` AI); mặc định dừng chờ người dùng (`stop_after_intake`) |
| `CREDIT_APPRAISAL` | 1-4 | Bóc tách OCR (S2), gom người & tài sản (S3, không phải stage), tài chính, bộ rule, khuyến nghị |

`derivePhaseStatus()` tổng hợp trạng thái theo nguyên tắc **xấu nhất thắng**:
một stage `FAILED` → phase `BLOCKED`; thiếu stage bắt buộc → `RUNNING`; không
suy ra `COMPLETE` khi còn stage bắt buộc chưa chạy.

## File trong module

| File | Vai trò |
|---|---|
| `types.ts` | Toàn bộ type của output V2 (`AppraisalResultV2`), `MetricResult`, `RuleResult`, v.v. |
| `dossier-stages.ts`, `stage-adapters.ts` | Nối S1 / S2 (`lib/loan-dossier`) vào workflow: port → `enqueueSubStep`, cắt dải trang PDF |
| `dossier-precheck.ts`, `precheck-intake.ts` | Kiểm tra sơ bộ bằng LLM sau S1 và output giai đoạn 1 |
| `dossier-map.ts`, `evidence-v3.ts`, `financial-inputs.ts` | S3 cho stage sau, registry evidence spec-v3, đầu vào tài chính (V2-R06) |
| `product-config.ts`, `step-catalog.ts` | Cấu hình theo sản phẩm (`loan_product_config`), danh mục bước AI |
| `reproducibility.ts` | Bản ghi tái lập `config_snapshot.reproducibility` (danh mục, sha256 template prompt, model / reasoning ghi đè) |
| `integration-contract.ts`, `integration-payload.ts`, `check-contract.ts` | Contract tích hợp 5.x |
| `state-machine.ts` | `LOAN_STAGE_DEFINITIONS`, phase, `deriveProcessingStatus`, readiness gate |
| `product-policy.ts` | Ngưỡng policy theo sản phẩm (`LoanProductPolicy`), resolve override từ Profile |
| `check-set.ts` | Bộ rule cấu hình được: đọc khoan dung (runtime) + ghi fail-closed (API) |
| `rules.ts` | Rule engine deterministic (`MinimumDscrRule`, `MaximumLtvRule`, ...) |
| `prompt-checks.ts` | Rule LLM: build prompt gộp, parse kết quả có rào an toàn |
| `evidence.ts` | Kiểu và tiện ích của `EvidenceRegistry` (registry spec-v3 dựng ở `evidence-v3.ts`) |
| `segment-packs/` | Segment pack theo phân khúc (D-100): `types.ts` (interface stage 2–4), `hkd-secured.ts`, `registry.ts` (phân khúc → pack, `validateSegmentPackRegistry` chạy khi worker khởi động). Workflow gọi stage 2–4 qua pack, không gọi strategy trực tiếp |
| `strategies.ts` | Strategy pattern cho các stage deterministic (financial, policy, recommendation); pack `hkd-secured` dùng các strategy này |
| `prompt-render.ts`, `dossier-facts.ts`, `run-params.ts` | Hàm dùng chung tách khỏi các module đang tắt (D-98): `renderPrompt`, `buildDossierFacts`, `consolidateParams` / `vnToday` |
| `intake-review.ts`, `intake-assessment.ts`, `master-dossier.ts`, `master-correction.ts`, `dossier-consolidate.ts` | Logic của các bước **đang tắt** (xem "Các bước kiểm tra hồ sơ tạm tắt"). Đường chạy chính không import S4, S5, `dossier-consolidate`, `master-dossier` lúc chạy (khóa bằng `tests/loan-appraisal/phase2-isolation.test.ts`). Bật lại một bước thì phải khai lại bước AI của nó trong `step-catalog.ts` và bỏ khỏi `RETIRED_STEP_KEYS` |

## Sản phẩm & ngưỡng policy

Sản phẩm vay **cấu hình được** trong `lib/loan-dossier/catalog/data/loan_products.json`
(nguồn: `docs/loan-appraisal/spec-v3/03_catalogs/`, đồng bộ bằng `npm run sync:loan-catalogs`).
Hiện có `hkd-loan` (Hộ kinh doanh) và `sme` (khung, luồng `FLOW_A`). Mỗi sản phẩm khai báo định danh,
tên và policy mặc định:

```json
{
  "product_code": "hkd-loan",
  "policy": { "minimum_dscr": 1.25, "maximum_ltv": 0.7, "maximum_amount_vnd": 3000000000,
              "default_tenor_months": 18, "scorecard_id": null }
}
```

`getLoanProduct()` và `resolveLoanProductPolicy()` đọc từ catalog này; mã không có trong catalog bị reject với
`INVALID_INPUT: Unsupported loan product_code`. Các rule check dùng chung mọi sản phẩm (id `LOAN.*`) và đọc ngưỡng
theo sản phẩm từ policy. **Thêm sản phẩm/luồng mới: xem `docs/loan-appraisal/ADD-NEW-PRODUCT-FLOW.md`.**

### Ghi đè ngưỡng theo sản phẩm (`policy` trong `loan_product_config`)

Admin có thể ghi đè `minimumDscr`, `maximumLtv`, `maximumAmountVnd`,
`defaultTenorMonths` theo từng sản phẩm. Ngưỡng override được
kẹp khoảng hợp lệ (`parsePolicyOverrides`, khoan dung — sai thì bỏ + warning,
không làm hỏng run). Ngưỡng **thực dùng** của mỗi lần chạy được ghi lại trong
`config_snapshot.thresholds` kèm `threshold_source: 'DEFAULT' | 'PROFILE'`, để
kết quả luôn tái lập được kể cả sau khi Profile đổi cấu hình.

## Bộ rule cấu hình được (`checks` trong `loan_product_config`)

Hai loại kiểm tra, khác nhau về mức độ tin cậy:

| Loại | Phép so sánh | Cấu hình được | Không cấu hình được |
|---|---|---|---|
| **Rule engine** (`DETERMINISTIC`) | Nằm trong code TypeScript, tái lập 100% | Tham số ngưỡng (`params`), severity, action, exception | Phép so sánh; **không tạo rule engine mới** — id phải nằm trong `DETERMINISTIC_CHECK_IDS` |
| **Rule LLM** (`PROMPT`) | Model phán đoán trên nội dung chứng từ | Toàn bộ prompt + ngưỡng confidence | Mặc định chỉ `warn`; muốn `block` phải khai severity `BLOCKER` tường minh |

3 rule engine có cài đặt sẵn (`rules.ts`). `LOAN.INTAKE.REQUIRED_DOCUMENTS` đã gỡ cùng checklist S4
(`RETIRED_CHECK_IDS`; cấu hình đã lưu còn id này bị bỏ êm):

| `id` | Kiểm tra |
|---|---|
| `LOAN.CAPACITY.MIN_DSCR` | DSCR ≥ ngưỡng tối thiểu |
| `LOAN.COLLATERAL.MAX_LTV` | LTV ≤ ngưỡng tối đa |
| `LOAN.PRODUCT.MAX_AMOUNT` | Số tiền đề nghị ≤ hạn mức sản phẩm |

3 rule LLM mặc định: đối chiếu định danh chủ hộ giữa chứng từ
(`LOAN.CONSISTENCY.BORROWER_IDENTITY`), khớp chủ sở hữu tài sản bảo đảm
(`LOAN.COLLATERAL.OWNER_MATCH`), và mục đích vay tương xứng quy mô kinh doanh
(`LOAN.PURPOSE.COHERENCE`).

### Phạm vi theo luồng + sản phẩm

Giống account-opening (phạm vi theo phân khúc + sản phẩm), mỗi check trong
`LOAN_CHECK_CATALOG` khai `flows` (`FULL`/`FAST`/`SIMPLE`) và `products` (mã
sản phẩm vay, rỗng = mọi sản phẩm). Runtime gọi
`parseCheckSet(raw, flow, productCode)` với luồng từ `resolveLoanFlow` và bỏ
các check không áp dụng (không chấm, không `NOT_RUN`). Catalog mặc định áp mọi
check cho cả 3 luồng, nên cấu hình cũ không có `flows`/`products` giữ nguyên
hành vi.

- `flows` thiếu ⇒ phạm vi của catalog; `flows: []` bị API từ chối (muốn bỏ
  check thì `enabled: false`).
- `products` phải là mã có policy trong `product-policy.ts`; mã lạ bị từ chối.
- Không còn check nào trong phạm vi ⇒ fallback bộ mặc định của luồng + cảnh
  báo (fail-safe: hồ sơ không bao giờ chạy mà không có kiểm tra).
- `config_snapshot.check_set.flow` ghi lại luồng bộ kiểm tra đã lọc theo.

### Đọc khoan dung, ghi fail-closed

Hai đường xử lý cấu hình khác nhau về mức độ nghiêm khắc, cố ý:

- **Runtime đọc (`parseCheckSet`)**: khoan dung. Giá trị sai bị bỏ và ghi
  `warnings`, fallback về mặc định — cấu hình lỗi không được phép làm hỏng một
  lần chạy thẩm định.
- **API ghi (`validateCheckSetValue`, gọi từ `app/api/internal/profile-endpoints/route.ts`)**:
  fail-closed. Trả lỗi rõ ràng ngay khi lưu — admin không được phép lưu một
  rule sai rồi tin rằng nó đang áp dụng.

Mọi thay đổi được tóm tắt cho audit qua `summarizeCheckSetChange`/
`summarizePolicyChange` (chỉ ghi id + field đã đổi, không ghi nội dung prompt).

### An toàn của rule LLM (`prompt-checks.ts`)

- Mọi kết luận phải kèm `evidence_ids` **tồn tại thật** trong registry — id lạ bị loại.
- `PASS` chỉ hợp lệ khi evidence dẫn chiếu ở trạng thái `ACCEPTED`.
- `confidence` dưới ngưỡng ⇒ hạ xuống `REVIEW`, không bao giờ tự suy ra `FAIL`.
- Rule được khai báo nhưng model không trả kết quả ⇒ `NOT_RUN`, không được coi
  là đạt.

### Ngân sách prompt của rule LLM (`selectPromptEvidence`)

Toàn bộ rule LLM chạy trong một lần gọi. Evidence đưa vào prompt được lọc để
giữ chi phí/độ trễ ổn định với hồ sơ lớn:

1. Chỉ loại chứng từ mà rule khai trong `input` (`evidence.<doc_type>`) và chỉ
   nhóm Customer 360 khai trong `master_data.<group>`. Có rule không khai nguồn
   nào ⇒ nhận toàn bộ (vẫn trong ngân sách).
2. Bỏ metadata mẫu biểu `legal_info.*`; field lặp trong mảng chỉ giữ
   `MAX_ARRAY_ITEMS_PER_FIELD` phần tử đầu (`instances[i]` không bị cắt).
3. Ngân sách `EVIDENCE_CHAR_BUDGET` ký tự, chia xoay vòng giữa các chứng từ.
4. Mỗi chứng từ (file + loại) có mã ngắn `D<n>` và dữ liệu dạng **JSON lồng
   nhau** (không lặp đường dẫn đầy đủ trên từng dòng). Field chưa chấp nhận
   được liệt kê ở dòng `REVIEW:` của chứng từ.

Model dẫn nguồn bằng `"D<n>:<đường dẫn field>"`. `resolveEvidenceRefs` đổi về
`evidence_id` thật trước khi áp rào an toàn (tồn tại, `ACCEPTED`, ngưỡng), nên
`RuleResult.evidence_ids` và UI không đổi:

- khớp đúng field đã hiển thị ⇒ evidence_id của field đó; `a.b.2.c` ≡ `a.b[2].c`;
- đường dẫn nhóm (`D2:owners[0]`) ⇒ tối đa 6 field đã hiển thị bên trong;
- mã/field không hiển thị cho model ⇒ bị loại; `ev-…` gốc vẫn được nhận
  (template override kiểu cũ).

`selectPromptEvidence` thuần và tất định nên bước parse dựng lại đúng bảng mã.
Thống kê lọc được ghi vào `content_preview.prompt_evidence` của stage 5.
**Khi thêm rule LLM tuỳ chỉnh, khai báo đủ `input`**; thiếu loại chứng từ thì
rule chỉ thấy dữ liệu của loại đã khai.

## Evidence & provenance

`evidence-v3.ts` (`buildEvidenceRegistryV3`, V2-R04) xây `EvidenceRegistry` từ EvidenceEnvelope của S2: mỗi lá của
`data` là một `EvidenceRecord`, `evidence_id = "{envelope}#{field_path}"`, `review_status = ACCEPTED` khi độ tin cậy
đọc của field cấp 1 ≥ 0.80 (`ACCEPT_CONFIDENCE`), ngược lại `REVIEW`. Evidence `ERROR` và bản bị thay thế (S3-R27)
không vào registry. Kết quả LƯU chỉ giữ `records` của trường bóc tách (`toStoredEvidence`).

Truy nguồn của người & tài sản: `customer_360` / `asset_registry` của S3 mang `mapped_evidences` / `sources`;
`DossierGraph` (cạnh `MENTIONED_IN`) và sổ Claim (`lib/loan-dossier/graph/claims.ts`, mỗi lá OCR thuộc đúng một Claim,
có trạng thái `CORROBORATED` / `DISPUTED` / …) dựng từ đó. `master-data.ts` (provenance cũ, D-42) đã gỡ ở D-66.

## Ranh giới đã quản trị (governed boundaries)

Workflow **cố ý** không tự sinh dữ liệu cho:

- **External compliance checks** (`policy_compliance.external_checks`):
  AML/PEP/SANCTIONS/ADVERSE_MEDIA đều trả `NOT_RUN` +
  `PROVIDER_NOT_CONFIGURED` vì chưa nối provider thật.

Điều này được nhắc lại trong `system_notes` của kết quả cuối để không ai đọc thiếu.

## Output: `AppraisalResultV2`

Kế thừa `AppraisalResult` (V1) nên consumer cũ vẫn đọc được `documents`,
`customer_360`, `checklist`, `cross_check`. Field V2 bổ sung: `output_version`,
`processing_status`, `config_snapshot`, `master_data`,
`dossier_readiness`, `evidence`, `financial_metrics`, `policy_compliance`,
`recommendation`, `review`. (`five_c`, `stress_test`, `credit_score` chỉ có ở
kết quả cũ — đã bỏ 5C và stress/score. `intake`, `audit`, `evidence.by_file`,
`evidence.by_document_type`, bản ghi evidence `CHECKLIST_STATUS` và
`classification_confidence` cũng chỉ có ở kết quả cũ: là bản sao hoặc hằng số
không ai đọc, đã thôi ghi; type đánh dấu `@deprecated`/optional để đọc được kết quả đã lưu.)

### JSON tích hợp (`view=integration` / webhook) — schema 5.1

Payload riêng cho hệ thống ngoài. **Contract nằm ở `integration-contract.ts`** (zod: kiểu TypeScript, kiểm tra runtime
và JSON Schema công bố đều sinh từ đó); `integration-payload.ts` chỉ chiếu `AppraisalResultV2` sang contract;
`check-contract.ts` ép rule engine / LLM / Agent về cùng MỘT `CheckResult`. Đặc tả, quy tắc phiên bản và cách thêm rule /
phân khúc mới: `docs/loan-appraisal/INTEGRATION-CONTRACT.md`.

Chỉ kết quả cuối: không tiến trình, không giai đoạn 1, không evidence. Giai đoạn 2 hiện gồm `case`, `decision`, `extractions[]` (kết quả OCR theo
chứng từ), `financials[]`, `checks[]` (rule engine + rule LLM cùng một hình dạng), `checks_summary`, `notes`. Các khối `parties`, `assets`, `documents`,
`findings` (từ các bước kiểm tra hồ sơ đang tắt) là **tuỳ chọn** và vắng mặt; kết quả cũ có dữ liệu vẫn dựng đủ. `?include=narrative,labels` thêm phần tuỳ chọn.

5.1 là thay đổi MINOR so với 5.0 (thêm `extractions`, hạ các khối kiểm tra hồ sơ thành tuỳ chọn). Không tương thích ngược với 4.0 và 3.1.

`processing_status` (`deriveProcessingStatus` trong `state-machine.ts`) theo
thứ tự ưu tiên: policy `FAIL` → `BLOCKED`; (chỉ khi có `readiness`) hồ sơ chưa sẵn sàng → `REVIEW_REQUIRED`;
policy cần soát → `REVIEW_REQUIRED`; có rule `NOT_RUN`/`INSUFFICIENT_DATA` →
`PARTIAL`; còn lại → `COMPLETE`.

## Cấu hình theo sản phẩm — tổng hợp

Toàn bộ cấu hình workflow nằm trong **một** tham số Profile `loan_product_config`
(`product-config.ts`), gom theo mã sản phẩm. Profile chỉ là nơi lưu; runtime lấy
phần của sản phẩm đang chạy (`resolveLoanConfig`). Các khoá cũ `loan_check_set`,
`loan_policy`, `loan_checklist_overrides`, `_workflowPrompts`, `_workflowModels`,
`_workflowReasoningEfforts` **không còn được đọc** và bị API ghi loại bỏ.

```
loan_product_config = { version, products: { <product_code>: {
  prompts:   { <step>: "..." },        // chỉ các bước có prompt (xem step-catalog.ts)
  models:    { <step>: "model" },      // mọi bước AI, gồm classify / extract / evaluate
  reasoning: { <step>: "low" },        // minimal | low | medium | high
  policy:    { minimum_dscr, maximum_ltv, maximum_amount_vnd, default_tenor_months },
  checks:    { program, version, checks: [...] },   // bộ rule; flows/products của rule bị bỏ qua
  checklist: { <item_key>: { <FLOW>: REQUIRED | CONDITIONAL | NOT_REQUIRED | null } },
  flows:     { <FLOW>: { checks: { <rule_id>: false } } }   // công tắc rule theo luồng
} } }
```

- **Phạm vi rule** không còn là tag `flows`/`products` trên từng rule: rule thuộc về
  sản phẩm đang chọn, còn bật/tắt theo luồng là công tắc `flows[<FLOW>].checks`.
- **Step AI** khai báo ở `step-catalog.ts` (nguồn duy nhất cho trang cấu hình và validate): chỉ các bước workflow
  thực sự gọi — `classify`, `extract`, `evaluate` (chỉ chọn model/reasoning; `evaluate` là mặc định của `policy_checks`
  và `dossier_precheck` khi chưa chọn riêng), `policy_checks`, `dossier_precheck`. Bước đã gỡ (D-99: `dossier_summary`,
  `master_correction`, `income_source_classify`, `loan_purpose_classify`) nằm ở `RETIRED_STEP_KEYS`: cấu hình đã lưu
  còn khoá này bị bỏ êm ở cả đường đọc và đường ghi.
- **Đọc**: `resolveLoanConfig` khoan dung (bỏ mục sai + warning, không throw).
  **Ghi**: `validateLoanProductConfig` fail-closed, gọi từ `app/api/internal/profile-endpoints/route.ts`.
- **Chuyển cấu hình cũ**: `migrateLegacyForProduct` (nút "Chuyển sang sản phẩm" ở trang cấu hình).

Trang cấu hình **`/loan-appraisal-v2/config`** (chọn Profile lưu → sản phẩm → luồng);
trang **Profiles** chỉ còn thẻ liên kết sang đó.

## Ghi chú tương thích

Thay đổi ở `WorkflowStepResult`/state machine luôn phải giữ tương thích ngược:
V2 chỉ bổ sung field optional (`stage_key`, `artifact_version`, `status`) —
không sửa hay xoá field mà workflow cũ đang phụ thuộc.

## Dữ liệu được lưu (rà soát quá trình xử lý)

Mỗi operation lưu hai khối: `extractedData` (kết quả cuối) và `stepsResultJson` (checkpoint từng stage, để resume giữa chừng).

- **Khi đang chạy / tạm dừng:** checkpoint đầy đủ (workflow đọc lại bằng `getStep` khi chạy tiếp giai đoạn 2).
- **Khi SUCCEEDED:** `completeWorkflow(..., dropSucceededStepArtifacts)` bỏ `extracted_data` của mọi bước vì chúng là bản sao của kết quả cuối
  (đo: 88% trùng từng byte; `consolidate_dossier` một mình 42 KB). Giữ `status`, `stage_key`, `processor`, `content_preview` và
  `sub_operation_id` (để xoá sub-step). Bước bị bỏ ghi `artifact_in: "result.extracted_data"`. Một operation đã SUCCEEDED không resume
  được nên không ai đọc lại checkpoint; trang quản trị, `view=compact` và `view=integration` vốn đã không dùng chúng.
- **`updateProgress`** chỉ ghi lại `stepsResultJson` khi artifact đổi. Trước đây mỗi lần cập nhật tiến độ ghi lại toàn bộ (10 lần x ~60 KB).
- **Sub-operation** (mỗi lần gọi LLM) mang prompt + output model và được xoá ngay khi workflow kết thúc (`purgeWorkflowSubSteps`).
- **Response mặc định** của loan-appraisal chỉ trả `metadata.pipeline_steps` (không còn `result.pipeline_steps` trùng).
