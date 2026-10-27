# Account Opening V1

Workflow tiếp nhận, phân loại và đánh giá bộ hồ sơ mở tài khoản, theo
**phân khúc khách hàng** (KHCN, HKD, SME, KHDN) và **sản phẩm tài khoản**. Chạy
qua `process=account-opening`. Cùng kiến trúc với `loan-appraisal`: 3 stage AI
trích xuất bằng chứng từ chứng từ gốc, sau đó 5 stage **thuần tính toán bằng
code** suy ra điều kiện mở tài khoản, rủi ro khách hàng (CDD), tuân thủ policy
và khuyến nghị. Xem `../loan-appraisal/README.md` để so sánh hai module.

Entry point: `lib/pipelines/workflows/account-opening.ts` (`runAccountOpening`).
Toàn bộ logic domain nằm trong thư mục này (`lib/pipelines/workflows/account-opening/`).

## Nguyên tắc cốt lõi

Giống `loan-appraisal` — mọi kết luận truy được về evidence, thiếu dữ liệu
không suy đoán, hồ sơ chưa đầy đủ không chặn xử lý, config không tạo logic
mới, không công bố kết quả sàng lọc chưa chạy thật, quyết định cuối không
thuộc workflow. Điểm khác biệt riêng của module này:

- **Mọi thứ đều có phạm vi theo phân khúc + sản phẩm.** Checklist, ngưỡng
  policy, và từng rule (`AccountCheckDefinition.segments`/`.products`) đều
  khai báo rõ áp dụng cho ai. KHCN không bao giờ bị chấm bằng rule chủ sở hữu
  hưởng lợi của SME.
- **`NOT_APPLICABLE` khác `INSUFFICIENT_DATA`.** Một chỉ tiêu không áp dụng
  cho phân khúc (ví dụ tuổi tổ chức với KHCN) phải trả `NOT_APPLICABLE`,
  không được lẫn với "thiếu dữ liệu" — hai trạng thái này dẫn tới hành động
  khác nhau ở downstream.

## DAG 8 stage

| # | `stage_key` | Loại | Việc làm | File chính |
|---|---|---|---|---|
| 0 | `classify` | AI (fan-out theo file) | Phân loại tài liệu theo checklist của phân khúc/sản phẩm | `prompts/account-opening-prompts.ts` |
| 1 | `extract_evidence` | AI (fan-out theo file) | Bóc tách trường dữ liệu, lập evidence có nguồn | `prompts/account-opening-prompts.ts` |
| 2 | `consolidate_profile` | AI (1 lần gọi) | Dựng Customer Profile, chấm checklist, đối chiếu chéo | `prompts/account-opening-prompts.ts` |
| 3 | `evaluate_eligibility` | Deterministic | Tuổi, hiệu lực giấy tờ, sở hữu, độ phủ CIF | `strategies.ts` (`EligibilityStrategy`) |
| 4 | `assess_cdd_risk` | Deterministic | 5 yếu tố rà soát khách hàng → risk rating | `strategies.ts` (`CddRiskStrategy`) |
| 5 | `evaluate_policy_compliance` | Rule engine + rule LLM | Chạy bộ rule cấu hình được theo phân khúc | `rules.ts`, `check-set.ts`, `prompt-checks.ts` |
| 6 | `screen_watchlists` | Governed boundary | Sàng lọc AML/PEP/sanctions/CIF trùng — NOT_RUN nếu chưa có provider | `strategies.ts` (`ScreeningStrategy`) |
| 7 | `synthesize_decision` | Decision strategy | Kết luận có giới hạn + định tuyến rà soát | `strategies.ts` (`DecisionStrategy`) |

Stage 3-7 được **dựng lại mỗi lần resume**, không đọc từ checkpoint cũ, để một
checkpoint trước khi đổi rào CDD/policy không thể mang theo kết luận
`ELIGIBLE_TO_OPEN` đã lỗi thời.

`ACCOUNT_STAGE_DEFINITIONS` (`state-machine.ts`) là nguồn sự thật duy nhất cho
thứ tự stage, `stage_key`, và phase.

## Hai phase nghiệp vụ

| Phase | Gồm stage | Ý nghĩa |
|---|---|---|
| `DOSSIER_INTAKE` | 0-2 | Tiếp nhận & hoàn thiện hồ sơ |
| `ONBOARDING_ASSESSMENT` | 3-7 | Đánh giá & kết luận mở tài khoản |

`derivePhaseStatus()` tổng hợp theo nguyên tắc xấu nhất thắng, cùng cơ chế với
`loan-appraisal`.

## File trong module

| File | Vai trò |
|---|---|
| `types.ts` | Toàn bộ type output V1 (`AccountOpeningResultV1`), `EligibilityMetrics`, `CddAssessment`, v.v. |
| `state-machine.ts` | `ACCOUNT_STAGE_DEFINITIONS`, phase, `deriveProcessingStatus`, so sánh `RiskLevel` |
| `segment-policy.ts` | Ngưỡng policy theo **phân khúc + sản phẩm** (`AccountOpeningPolicy`) |
| `document-catalog.ts` | Danh mục chứng từ (checklist) cấu hình được theo phân khúc/sản phẩm |
| `check-set.ts` | Bộ rule cấu hình được, có phạm vi theo phân khúc + sản phẩm |
| `rules.ts` | Rule engine deterministic (`MinimumAgeRule`, `BeneficialOwnerDisclosureRule`, ...) |
| `prompt-checks.ts` | Rule LLM: build prompt gộp, parse kết quả có rào an toàn |
| `evidence.ts` | `EvidenceRegistry` — mọi giá trị bóc tách được, có `evidence_id` truy nguồn |
| `master-data.ts` | Provenance: mỗi trường Customer Profile lấy từ evidence nào + độ phủ CIF bắt buộc |
| `strategies.ts` | Strategy pattern cho 5 stage deterministic (eligibility, CDD, policy, screening, decision) |

## Phân khúc & sản phẩm

| Phân khúc | Sản phẩm | Đặc điểm ngưỡng |
|---|---|---|
| `KHCN` | `casa-khcn-standard` | Baseline `LOW`, không áp chủ sở hữu hưởng lợi |
| `KHCN` | `casa-khcn-nonresident` | Baseline `HIGH`, **luôn** yêu cầu EDD, hiệu lực giấy tờ ≥ 90 ngày |
| `HKD` | `casa-hkd-standard` | Baseline `MEDIUM` |
| `SME` | `casa-sme-standard` | Chủ sở hữu hưởng lợi từ 25%, cần phủ ≥ 75% |
| `KHDN` | `casa-khdn-standard` | Chủ sở hữu hưởng lợi từ 10% (cấu trúc nhiều tầng), cần phủ ≥ 90%, ≥ 2 người ký, **luôn** yêu cầu EDD |

Mã sản phẩm/phân khúc không hợp lệ, hoặc lệch nhau (ví dụ `segment=KHCN` với
`product_code=casa-sme-standard`), bị reject ở `resolveAccountProduct()` với
`INVALID_INPUT`.

### Ghi đè ngưỡng qua Profile (`account_policy`)

Ghi đè `minimumAgeYears`, `maximumAgeYears`, `minimumIdValidityDays`,
`beneficialOwnerThresholdPercent`, `minimumBeneficialOwnerCoveragePercent`,
`minimumAuthorizedSignatories` qua tham số Profile `account_policy`. Cùng cơ
chế khoan dung khi đọc / fail-closed khi ghi như `loan-appraisal`. Ngưỡng thực
dùng được ghi vào `config_snapshot.thresholds` kèm `threshold_source`.

## Danh mục chứng từ cấu hình được (`account_document_catalog`)

Khác `loan-appraisal`: module này cho phép cấu hình **checklist**, không chỉ
ngưỡng. Ranh giới an toàn cố ý rất hẹp (`document-catalog.ts`):

**Cấu hình được** — cho một document key **đã có sẵn** trong catalog gốc của
một sản phẩm: bật/tắt (`enabled`), bắt buộc/tùy chọn (`required`), nhãn hiển
thị (`label`), mô tả đưa vào prompt phân loại (`description`), nhóm hiển thị
trên Customer Profile (`group`).

**Không cấu hình được:**
- `presetKey` (schema OCR field) của một document key đã có.
- Tạo document key hoàn toàn mới.

Lý do: nhiều rule ở `strategies.ts` dò field theo **regex cố định** trên
`field_path` (`DOB_PATTERNS`, `EXPIRY_PATTERNS`, `CHARTER_CAPITAL_PATTERNS`,
`OWNERSHIP_PERCENT_PATTERNS`, ...) và theo **docTypes filter cố định**
(`identityDocument`, `authorizationKeys`, `ownershipKeys` trong
`EligibilityStrategy`/`CddRiskStrategy`). Đổi preset của một key đã biết, hoặc
thêm key lạ mà các rule này không biết tới, khiến chỉ tiêu liên quan **âm
thầm rơi về `INSUFFICIENT_DATA`** — không có exception, không có log lỗi. Đây
là loại lỗi im lặng module cố tránh, nên cấu hình bị chặn tường minh ngay ở
`validateDocumentCatalogValue()` (kể cả khi client gửi field `presetKey`, dù
UI không cho phép).

Không cho cấu hình xoá hết chứng từ bắt buộc của một sản phẩm — bị reject cả ở
đường ghi (API) và có fallback về mặc định ở đường đọc (runtime).

## Bộ rule cấu hình được (`account_check_set`)

Cùng hai loại kiểm tra (rule engine / rule LLM) như `loan-appraisal`, nhưng
mỗi rule còn khai báo **phạm vi**:

```ts
{
  segments: CustomerSegmentKey[];  // rỗng = áp cho mọi phân khúc
  products: string[];              // rỗng = áp cho mọi sản phẩm của các phân khúc trên
}
```

Bộ kiểm tra của một lần chạy = catalog lọc theo `checkAppliesTo(definition,
segmentKey, productCode)`.

6 rule engine có cài đặt sẵn (`rules.ts`), phạm vi mặc định:

| `id` | Kiểm tra | Phân khúc mặc định |
|---|---|---|
| `AO.INTAKE.REQUIRED_DOCUMENTS` | Đủ chứng từ bắt buộc | Tất cả |
| `AO.IDENTITY.DOCUMENT_VALIDITY` | Giấy tờ định danh còn hiệu lực | Tất cả |
| `AO.ELIGIBILITY.MIN_AGE` | Đủ tuổi | Tất cả |
| `AO.OWNERSHIP.BENEFICIAL_OWNER_DISCLOSURE` | Đủ kê khai chủ sở hữu hưởng lợi | SME, KHDN |
| `AO.AUTHORIZATION.SIGNATORY_REGISTERED` | Đủ người ký đăng ký | SME, KHDN |
| `AO.RISK.DUE_DILIGENCE_LEVEL` | Mức rủi ro trong ngưỡng xử lý của sản phẩm | Tất cả |

Rule LLM mặc định: nhất quán định danh khách hàng
(`AO.CONSISTENCY.CUSTOMER_IDENTITY`), khớp người đại diện theo pháp luật với
GCN đăng ký doanh nghiệp (`AO.CONSISTENCY.LEGAL_REPRESENTATIVE`, tổ chức),
phạm vi ủy quyền còn hiệu lực (`AO.AUTHORIZATION.MANDATE_SCOPE`), mục đích mở
tài khoản tương xứng nghề nghiệp/ngành nghề (`AO.PURPOSE.PLAUSIBILITY`), biểu
mẫu đủ chữ ký/mẫu dấu (`AO.FORM.SIGNATURE_COMPLETENESS`), và dấu hiệu quốc
gia/địa bàn rủi ro cao — chỉ áp cho sản phẩm có yếu tố nước ngoài
(`AO.SANCTIONS.JURISDICTION_FLAG`, phạm vi theo **sản phẩm**:
`casa-khcn-nonresident`, `casa-khdn-standard`).

### Đọc khoan dung, ghi fail-closed

Cùng nguyên tắc với `loan-appraisal`: `parseCheckSet()` (runtime) khoan dung —
mục sai bị bỏ + warning, không làm hỏng run; `validateCheckSetValue()` (API,
gọi từ `app/api/internal/profile-endpoints/route.ts`) fail-closed — admin
không lưu được rule sai. `DETERMINISTIC_CHECK_IDS` là danh sách đóng; config
không tạo được rule engine mới.

An toàn của rule LLM (`prompt-checks.ts`) giống hệt `loan-appraisal`:
`evidence_ids` phải tồn tại thật, `PASS` cần evidence `ACCEPTED`, dưới ngưỡng
confidence thì hạ về `REVIEW`, không trả kết quả thì `NOT_RUN`.

## Rà soát khách hàng (CDD) — 5 yếu tố

`CddRiskStrategy` (stage 4) chấm 5 yếu tố, mỗi yếu tố có thể `NOT_RUN` (không
áp dụng cho phân khúc, không tính vào risk rating):

| Code | Tên | Nội dung |
|---|---|---|
| R1 | Identity | Định danh & xác thực khách hàng |
| R2 | Geography | Địa bàn, quốc tịch & cư trú |
| R3 | Structure | Cấu trúc sở hữu & chủ sở hữu hưởng lợi (chỉ tổ chức) |
| R4 | Purpose | Mục đích mở tài khoản & nguồn tiền |
| R5 | Authorization | Thẩm quyền đại diện & ủy quyền (chỉ tổ chức) |

Kết quả tổng hợp: `risk_rating` (`LOW`/`MEDIUM`/`HIGH`/`UNDETERMINED`, xấu
nhất thắng giữa baseline phân khúc và các yếu tố) và `due_diligence_level`
(`SDD`/`CDD`/`EDD`). `EDD` bắt buộc khi sản phẩm luôn yêu cầu
(`requiresEnhancedDueDiligence`), khi risk rating vượt
`maximumRiskWithoutEdd`, hoặc khi risk rating là `UNDETERMINED`. `SDD` chỉ áp
dụng khi phân khúc baseline `LOW` và mọi yếu tố đều `PASS`.

## Evidence & provenance

Giống cơ chế `loan-appraisal` (`evidence.ts`, `master-data.ts`): mỗi giá trị
bóc tách là một `EvidenceRecord` có `evidence_id`, `ACCEPTED` khi độ tin cậy
phân loại ≥ 0.75. `buildProfileProvenance()` đối chiếu Customer Profile với
evidence, trả `VERIFIED`/`NEEDS_REVIEW`/`UNVERIFIED`/`MISSING` cho từng trường
CIF bắt buộc của phân khúc (`mandatoryProfileFields` trong
`segment-policy.ts`), và tính `mandatory_coverage_percent` — hiển thị trên UI
để biết hồ sơ đủ vết truy nguồn tới đâu, **không** dùng để gate stage nào.

## Ranh giới đã quản trị (governed boundaries)

`ScreeningStrategy` (stage 6) trả `status: 'NOT_CONFIGURED'` và mọi hạng mục
sàng lọc (`AML`/`PEP`/`SANCTIONS`/`ADVERSE_MEDIA`/`CIF_DUPLICATE`/`BLACKLIST`)
trả `NOT_RUN` + `PROVIDER_NOT_CONFIGURED` — không có provider thật nào được
nối, tuyệt đối không sinh kết quả "sạch" giả. Vì vậy `review.route` **không
bao giờ** là `STRAIGHT_THROUGH` khi sàng lọc chưa hoàn tất.

## Output: `AccountOpeningResultV1`

Kế thừa `AccountOpeningResult` (base) nên field cơ bản (`documents`,
`customer_profile`, `checklist`, `cross_check`) luôn có sẵn dù workflow mới
tới stage 2. Field V1 bổ sung: `output_version`, `processing_status`,
`config_snapshot`, `profile_provenance`, `intake`, `dossier_readiness`,
`evidence`, `eligibility_metrics`, `cdd_assessment`, `policy_compliance`,
`screening`, `recommendation`, `review`, `audit`.

`processing_status` (`deriveProcessingStatus` trong `state-machine.ts`) theo
thứ tự: policy `FAIL` → `BLOCKED`; hồ sơ chưa sẵn sàng → `REVIEW_REQUIRED`;
CDD/policy cần soát → `REVIEW_REQUIRED`; có rule `NOT_RUN`/`INSUFFICIENT_DATA`
→ `PARTIAL`; còn lại → `COMPLETE`.

`recommendation.recommendation` ∈ `ELIGIBLE_TO_OPEN | REFER |
INSUFFICIENT_DATA`. `audit.final_authority = 'EXTERNAL_ONBOARDING_SYSTEM'` —
quyết định mở tài khoản thuộc hệ thống onboarding, không phải workflow này.

## Cấu hình qua Profile — tổng hợp

| Tham số Profile | Mục đích | Đọc (runtime) | Ghi (API) |
|---|---|---|---|
| `account_check_set` | Bộ rule engine + rule LLM, có phạm vi | `parseCheckSet` (khoan dung) | `validateCheckSetValue` (fail-closed) |
| `account_policy` | Ngưỡng tuổi/hiệu lực GT/sở hữu/số người ký | `parsePolicyOverrides` (khoan dung) | `validatePolicyValue` (fail-closed) |
| `account_document_catalog` | Bật/tắt/đổi nhãn document key có sẵn theo sản phẩm | `resolveDocumentRequirements` (khoan dung) | `validateDocumentCatalogValue` (fail-closed) |
| `_workflowPrompts.classify/extract/evaluate` | Override prompt 3 stage AI | — | qua `ProfileEndpoint.parameters` chuẩn |
| `_workflowModels.*`, `_workflowReasoningEfforts.*` | Override model/reasoning từng step | — | qua `ProfileEndpoint.parameters` chuẩn |

Cấu hình rule/policy/danh mục chứng từ dùng chung một UI:
`components/profiles/AccountCheckSetPanel.tsx` trên trang **Profiles** — có ô
"xem trước theo phân khúc/sản phẩm" để biết một sản phẩm cụ thể sẽ chạy đúng
những rule và checklist nào trước khi lưu.

## Ghi chú tương thích

Cùng quy tắc với `loan-appraisal`: thay đổi state machine chỉ bổ sung field
optional, không sửa/xoá field mà consumer cũ đang phụ thuộc.
