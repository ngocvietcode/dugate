# Kiến trúc Loan Appraisal

> Tài liệu tham chiếu kiến trúc của workflow `loan-appraisal` (`process=loan-appraisal`).
> Cập nhật: 2026-10-27. Mô tả **theo code hiện tại** (§2–§7) và **kiến trúc đích** để mở rộng sang SME ở mức enterprise (§8–§10).
> Khi tài liệu này mâu thuẫn với code, code là nguồn đúng; sửa tài liệu này cùng PR thay đổi code.

## Mục lục
1. [Bối cảnh và phạm vi](#1-bối-cảnh-và-phạm-vi)
2. [Nguyên tắc kiến trúc](#2-nguyên-tắc-kiến-trúc)
3. [Tổng quan hệ thống](#3-tổng-quan-hệ-thống)
4. [Luồng xử lý (5 stage, 2 giai đoạn)](#4-luồng-xử-lý-5-stage-2-giai-đoạn)
5. [Mô hình dữ liệu](#5-mô-hình-dữ-liệu)
6. [Cấu hình, danh mục và quản trị](#6-cấu-hình-danh-mục-và-quản-trị)
7. [Độ tin cậy, an toàn AI, bảo mật](#7-độ-tin-cậy-an-toàn-ai-bảo-mật)
8. [Đánh giá hiện trạng: khoảng trống](#8-đánh-giá-hiện-trạng-khoảng-trống)
9. [Kiến trúc đích: lõi chung + Segment Pack](#9-kiến-trúc-đích-lõi-chung--segment-pack)
10. [Lộ trình](#10-lộ-trình)
11. [Bản đồ mã nguồn và tài liệu](#11-bản-đồ-mã-nguồn-và-tài-liệu)
12. [Nhật ký quyết định kiến trúc](#12-nhật-ký-quyết-định-kiến-trúc)

---

## 1. Bối cảnh và phạm vi

**Bài toán.** Cán bộ quan hệ khách hàng nhận bộ hồ sơ vay (nhiều file scan/ảnh). Cán bộ thẩm định phải đọc từng file, kiểm tra
đủ giấy tờ, đối chiếu thông tin giữa các chứng từ, tính khả năng trả nợ, áp policy sản phẩm và đề xuất. Hệ thống tự động hoá
phần đọc, đối chiếu và tính toán, và **chỉ gợi ý**. Quyết định cấp tín dụng thuộc hệ thống phê duyệt bên ngoài.

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Phân loại, bóc tách, gom người và tài sản, chỉ số tài chính, rule (engine + LLM), khuyến nghị có giới hạn | Phê duyệt khoản vay, giải ngân, lưu hồ sơ lâu dài |
| Sản phẩm cấu hình trong danh mục: `hkd-loan` (đang dùng), `sme` (khung) | AML / PEP / sanctions (trả `NOT_RUN` cho tới khi có provider) |
| Giao diện `/loan-appraisal-v2`, API `POST /api/v1/docs/workflows`, webhook | Scorecard / rating / PD (chưa có mô hình được phê duyệt) |

**Người dùng.** Sale/RM (gửi hồ sơ, xem giai đoạn 1); CO / thẩm định (xem giai đoạn 2); ADMIN / OPS (cấu hình sản phẩm,
policy, rule ở `/loan-appraisal-v2/config`); hệ thống ngoài (gọi API, nhận webhook).

---

## 2. Nguyên tắc kiến trúc

Các nguyên tắc này đã có trong code, và mọi thay đổi phải giữ chúng.

| # | Nguyên tắc | Cách code đảm bảo |
|---|---|---|
| P1 | **AI đọc, code quyết định.** LLM chỉ phân loại, bóc tách và đánh giá ngữ nghĩa có rào chắn; mọi số liệu và kết luận tín dụng do code tất định | Stage 2–4 thuần TypeScript; rule LLM qua rào ở `prompt-checks.ts` |
| P2 | **Mọi kết luận truy được về chứng từ.** Không có số liệu nào thiếu `evidence_ids` | `EvidenceRegistry`, `evidence_id = {envelope}#{field_path}` |
| P3 | **Thiếu dữ liệu ≠ trượt.** Không suy đoán thành PASS/FAIL | `INSUFFICIENT_DATA`, `NOT_APPLICABLE`, `NOT_RUN` là trạng thái riêng |
| P4 | **Không công bố điều chưa được kiểm chứng.** Kiểm tra chưa chạy không bao giờ mặc định "đạt" | AML `NOT_RUN`; precheck lỗi → `UNAVAILABLE`, không `NO_GAPS_FOUND` |
| P5 | **Đọc khoan dung, ghi fail-closed.** Cấu hình sai không làm hỏng lần chạy, nhưng không lưu được | `resolveLoanConfig` / `validateLoanProductConfig` |
| P6 | **Kết luận không lấy từ checkpoint cũ.** Stage tính toán dựng lại mỗi lần resume | Stage 2–4 và S3 luôn chạy lại |
| P7 | **Config không tạo logic.** Cấu hình được ngưỡng và prompt, không tạo được phép so sánh mới | `DETERMINISTIC_CHECK_IDS` cố định trong code |
| P8 | **Không log PII.** Log chỉ nêu id, mã, số đếm | S3-R26, S2-R19; `log-sanitize.ts` |

---

## 3. Tổng quan hệ thống

### 3.1 Thành phần

```
┌──────────────┐   POST /api/v1/docs/workflows    ┌──────────────────────┐
│ UI v2 /      │ ───────────────────────────────▶ │ Next.js API (Runner) │  auth (x-api-key | SSO), rate limit,
│ Hệ thống ngoài│ ◀── GET /api/v1/operations/{id} ─│ + ProfileEndpoint    │  merge tham số Profile, lưu file,
└──────────────┘     (poll 2s / webhook)          └──────────┬───────────┘  tạo Operation, enqueue
                                                             │ BullMQ (Redis)
                                                  ┌──────────▼───────────┐
                                                  │ Worker: workflow-    │  runLoanAppraisal(ctx)
                                                  │ engine (pipeline q.) │  checkpoint / cancel / pause / resume
                                                  └──────────┬───────────┘
                                         enqueueSubStep      │ (workflow-steps queue, tách để tránh deadlock)
                                                  ┌──────────▼───────────┐
                                                  │ Sub-step = Operation │──▶ ExternalApiConnection
                                                  │ con, 1 lời gọi AI    │    ext-classifier · ext-data-extractor ·
                                                  └──────────────────────┘    ext-fact-verifier
PostgreSQL (Drizzle): Operation, stepsResultJson, ApiKey/Profile, AppSetting · Storage: Local | S3 (MD5 dedup)
```

### 3.2 Tầng mã nguồn

| Tầng | Thư mục | Trách nhiệm |
|---|---|---|
| Giao diện | `app/loan-appraisal-v2/`, `components/loan-appraisal-v2/` | State machine thuần (`run-reducer.ts`), poller tuần tự, view-model thuần (`lib/*-view.ts`) |
| Điều phối workflow | `lib/pipelines/workflows/loan-appraisal.ts` | Thứ tự stage, checkpoint, pause/resume, ghép kết quả |
| Domain thẩm định | `lib/pipelines/workflows/loan-appraisal/` | Policy, rule, strategy tài chính/khuyến nghị, contract tích hợp, cấu hình sản phẩm |
| Domain hồ sơ (spec-v3) | `lib/loan-dossier/` | `s1`…`s5`, `graph`, `catalog`, `contracts`, `master`: hàm thuần theo port, test bằng bản giả |
| Hạ tầng | `lib/pipelines/workflow-engine.ts`, `lib/queue/`, `lib/storage/` | Sub-step, hàng đợi, timeout, lưu trữ |

**Quy ước port/adapter:** `lib/loan-dossier` không gọi I/O trực tiếp. `stage-adapters.ts` (`createDossierPorts`) nối port với
`enqueueSubStep`, đọc file và cắt dải trang PDF (`pdf-lib`).

---

## 4. Luồng xử lý (5 stage, 2 giai đoạn)

Nguồn sự thật về thứ tự stage: `LOAN_STAGE_DEFINITIONS` (`state-machine.ts`).

| # | `stage_key` | Phase | Loại | Gọi AI | Đầu ra (checkpoint) |
|---|---|---|---|---|---|
| 0 | `classify` (S1) | `DOSSIER_INTAKE` | AI, fan-out theo file/batch trang | `ext-classifier` | `files[]`, `matches[]`, `summary`/`key_facts`; sau đó `precheck`, marker `intake_phase1` |
| — | kiểm tra sơ bộ (không phải stage) | `DOSSIER_INTAKE` | AI 1 lời gọi + rào bằng code | `ext-fact-verifier` | `classify.precheck` |
| 1 | `extract_evidence` (S2) | `CREDIT_APPRAISAL` | AI, fan-out theo bản thể chứng từ | `ext-data-extractor` | `evidences[]` (EvidenceEnvelope FULL / LIGHT) |
| — | S3 gom người & tài sản + sổ Claim | `CREDIT_APPRAISAL` | Code thuần, không checkpoint | — | `customer_360`, `dossier_graph`, `claims` (trong kết quả cuối) |
| 2 | `calculate_financials` | `CREDIT_APPRAISAL` | Code thuần | — | `FinancialMetrics` |
| 3 | `evaluate_policy_compliance` | `CREDIT_APPRAISAL` | Rule engine + rule LLM (1 lời gọi gộp) | `ext-fact-verifier` | `PolicyComplianceResult` |
| 4 | `synthesize_recommendation` | `CREDIT_APPRAISAL` | Code thuần | — | khuyến nghị, tuyến rà soát (lưu trong kết quả cuối) |

### 4.1 Hai giai đoạn và điểm dừng

```
SUBMIT ──▶ S1 ──▶ precheck ──┬─ stop_after_intake (mặc định true) ──▶ WAITING_USER_INPUT (currentStep = 1)
                             │                                           │  POST /operations/{id}/resume
                             └─ false ─────────────────────────────────▶ S2 ──▶ S3 ──▶ tài chính ──▶ rule ──▶ khuyến nghị ──▶ SUCCEEDED
```

- **Giai đoạn 1** (`result_phase = DOSSIER_INTAKE`): chỉ có S1 + precheck. `checklist` / `cross_check` mang
  `DEFERRED_TO_PHASE_2`, `customer_360 = null`, không có OCR.
- **Giai đoạn 2:** S2 → S3 → stage 2–4. Kết quả `output_version = 3.0`.
- UI v2 gửi `stop_after_intake` tường minh: mặc định `false` (chạy hết), người dùng tick thì `true`.

### 4.2 Tham số chạy

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `product_code` | `default_product_code` của danh mục (`hkd-loan`) | Chọn sản phẩm → chương trình checklist, policy, phạm vi rule |
| `flow` (alias `loan_flow`, `flow_classification`) | luồng đầu của chương trình | `FULL` / `FAST` / `SIMPLE` (HKD), `FLOW_A` (SME) |
| `stop_after_intake` | `true` | Dừng sau giai đoạn 1 |
| `dossier_precheck` | bật | `false` → precheck `SKIPPED` |
| `dossier_submitted_at` | ngày nhận request (giờ VN) | Mốc hiệu lực chứng từ (bản hết hạn, bản bị thay thế) |
| `lac_mode` | `off` | Loan Application Context cho rule LLM: `off` / `shadow` (chỉ đo) / `on` (D-103) |
| `loan_product_config` (Profile) | — | Cấu hình theo sản phẩm (§6) |

### 4.3 Checkpoint, resume, huỷ, lỗi

- **Checkpoint theo `stage_key`** trong `stepsResultJson`. `currentStep` = stage **kế tiếp**: worker crash sau khi lưu không tạo
  artifact trùng.
- **Resume:** stage 0–1 dùng lại checkpoint; S3 và stage 2–4 luôn tính lại (P6). Operation cũ có `consolidate_dossier`
  (đánh số 8 stage) được quy về chạy lại từ stage tài chính.
- **Huỷ:** `assertNotCancelled` ở đầu mỗi stage và trước mỗi sub-step → `WorkflowCancelledError`.
- **Lỗi:** lỗi stage AI → `failWorkflow` (FAILED, `error.failed_step`). Lỗi của bước phụ (precheck, rule LLM, S3, graph,
  claims) **không** đổ workflow: hạ về `UNAVAILABLE` / `NOT_RUN` / `null` kèm cảnh báo.
- **Hoàn tất:** `completeWorkflow(..., dropSucceededStepArtifacts)` bỏ dữ liệu checkpoint trùng với kết quả cuối, xoá
  sub-operation chứa prompt (`purgeWorkflowSubSteps`), gửi webhook payload tích hợp.

### 4.4 Đầu ra

| Kênh | Nội dung | Contract |
|---|---|---|
| `GET /api/v1/operations/{id}` | `AppraisalResultV2` (`output_version 3.0`) + `metadata.pipeline_steps` | `types.ts` |
| `?view=compact` | Bản gọn cho UI poll | `compact-view.ts` |
| `?view=integration` / webhook | Payload tích hợp schema **5.1** (`case`, `decision`, `extractions[]`, `financials[]`, `checks[]`, `checks_summary`, `notes`) | `integration-contract.ts` (zod → TS + JSON Schema), xem [INTEGRATION-CONTRACT.md](INTEGRATION-CONTRACT.md) |

---

## 5. Mô hình dữ liệu

### 5.1 Chuỗi dữ liệu

```
File ─S1─▶ ClassifiedFile / DocMatch (doc_type_key, trang, confidence, summary, key_facts)
     ─S2─▶ EvidenceEnvelope { evidence_id, doc_type_key, extraction_level FULL|LIGHT, data, field_confidences, source_pages }
     ─────▶ EvidenceRecord   { evidence_id = "{envelope}#{field_path}", review_status ACCEPTED (conf ≥ 0.80) | REVIEW }
     ─S3─▶ role_registry / customer_360 (person-n) · asset_registry (asset-n) · relationship_verifications · superseded_evidences
     ─────▶ DossierGraph (graphology: node người/tài sản/chứng từ, cạnh OWNS/SPOUSE_OF/RELATIVE_OF/LEGAL_REP_OF/SUPERSEDED_BY/MENTIONED_IN)
     ─────▶ ClaimLedger      (mỗi lá OCR thuộc đúng 1 Claim; CORROBORATED/DECLARED/SINGLE_SOURCE/DISPUTED/PROBABLE_OCR_ERROR/SPELLING_VARIANT)
     ─────▶ FinancialMetrics (MetricResult: status, value, unit, formula, inputs, evidence_ids, warnings)
     ─────▶ RuleResult[]     (DETERMINISTIC | PROMPT, result, reason_code, evidence_ids)
     ─────▶ LoanRecommendation + ReviewResult
```

### 5.2 Danh mục (catalog) — dữ liệu, không phải code

`lib/loan-dossier/catalog/data/` (nguồn ở `docs/loan-appraisal/spec-v3/03_catalogs/`, đồng bộ bằng `npm run sync:loan-catalogs`):

| File | Nội dung |
|---|---|
| `loan_products.json` | Sản phẩm: `product_code`, `segment`, policy mặc định |
| `checklist_programs.json` | Chương trình checklist theo sản phẩm: luồng, mức yêu cầu |
| `checklist_catalog.json` | 46 mục checklist, nhóm, loại chứng từ chấp nhận, mục thay thế, hiệu lực |
| `doc_types.json` | 47 loại chứng từ, `extraction_level` (27 FULL, 20 LIGHT) |
| `doc_schemas/*.schema.json` | Schema S2 cho loại FULL |
| `light_extraction.json` | Field của loại LIGHT |
| `cross_check_matrix.json`, `reason_codes.json`, `enums.json` | Ma trận đối chiếu (S5), mã lý do, enum |

---

## 6. Cấu hình, danh mục và quản trị

| Lớp | Ở đâu | Ai đổi | Hiệu lực |
|---|---|---|---|
| Sản phẩm, loại chứng từ, schema, checklist | Danh mục JSON trong repo | Dev, qua PR | Khi deploy |
| Cấu hình theo sản phẩm (`loan_product_config`): `prompts`, `models`, `reasoning`, `policy` (ngưỡng), `checks` (bộ rule), `checklist`, `flows` (công tắc rule theo luồng) | Profile (`ProfileEndpoint.parameters`), trang `/loan-appraisal-v2/config` | Người có `endpoint:manage` (ADMIN; OPS mặc định có) | Ngay lần chạy kế tiếp |
| Kết nối AI (URL, model, timeout) | `ExternalApiConnection` | ADMIN | Ngay |

- **Đọc:** `resolveLoanConfig(raw, productCode, flow)`, khoan dung. **Ghi:** `validateLoanProductConfig`, fail-closed (gọi
  từ `app/api/internal/profile-endpoints/route.ts`).
- **Ngưỡng override** bị kẹp khoảng hợp lệ. Ngưỡng thực dùng ghi trong `config_snapshot.thresholds` + `threshold_source`.
- **Step AI** khai báo ở `step-catalog.ts`: nguồn duy nhất cho trang cấu hình và validate.

---

## 7. Độ tin cậy, an toàn AI, bảo mật

### 7.1 Rào an toàn của LLM

| Bước | Rào chắn (bằng code) |
|---|---|
| S1 | Trang ngoài batch kẹp về trong batch; `doc_type_key` phải thuộc danh mục; tên file không gửi model (S1-R03) |
| Precheck | Mục ngoài checklist bị bỏ; căn cứ trỏ file không tồn tại bị gỡ; `PROVIDED` không căn cứ → `UNCERTAIN`; số đếm do code tính |
| S2 | Output validate bằng zod theo schema; field sai bị đánh dấu `invalid_fields` |
| Rule LLM | `evidence_ids` phải tồn tại; `PASS` chỉ trên evidence `ACCEPTED`; confidence dưới ngưỡng → `REVIEW`; rule không được trả → `NOT_RUN`; ngân sách 18 000 ký tự; dữ liệu bọc `untrusted_*` + `UNTRUSTED_DATA_GUARD` |

### 7.2 Bảo mật và dữ liệu
- Tuân thủ [docs/SECURITY-RULES.md](../SECURITY-RULES.md) (bắt buộc đọc khi đổi route, secret, upload).
- PII (tên, số định danh, địa chỉ, số GCN) nằm trong kết quả Operation và prompt; **không** vào log hay `content_preview`.
- Sub-operation (prompt + output model) bị xoá khi workflow kết thúc. Nội dung Operation giữ theo `OPERATION_CONTENT_RETENTION_DAYS`.
- API key của UI chỉ giữ trong bộ nhớ trang (không vào URL hay storage).

### 7.3 Năng lực vận hành hiện có
Hàng đợi tách pipeline / workflow-steps (tránh deadlock); timeout sub-step theo `timeoutSec` của connector; worker tạm dừng
khi heap 90% và chạy lại khi về 75%; phát hiện job stalled (tối đa 2 lần retry trước DLQ); BullMQ retry 3 lần với backoff
mũ; ghi prompt/output vào log job ở Bull Board (D-95); chi phí và token theo từng operation.

---

## 8. Đánh giá hiện trạng: khoảng trống

### 8.1 Chặn mở rộng sang SME (P0)

| # | Khoảng trống | Bằng chứng |
|---|---|---|
| G1 | Chứng từ tài chính doanh nghiệp chỉ bóc tách LIGHT | `balance_sheet`, `financial_performance_report` chỉ có `period`; `vat_tax_return` chỉ `tax_period`; `enterprise_registration_license` chỉ số ĐK và địa chỉ; `board_meeting_minutes` không có field |
| G2 | Strategy tài chính gắn cứng HKD | **Một phần đã xử lý (D-100):** workflow chọn logic stage 2–4 qua segment pack theo `segment` của sản phẩm. Chỉ có pack `hkd-secured`; `sme` được ánh xạ tường minh vào pack đó (`config_snapshot.segment_pack.pack_id = hkd-secured`). Còn lại: viết SME pack (giai đoạn 4) |
| G3 | Policy SME là bản sao HKD (`0.1.0-draft`) | `loan_products.json`: cùng DSCR 1.25 / LTV 0.7 / 3 tỷ / 18 tháng |
| G4 | Policy chỉ có 4 tham số phẳng | Không có ngưỡng theo loại cấp tín dụng, loại TSBĐ, hạng khách hàng, giới hạn exposure |
| G5 | Mô hình "một khoản vay – một đơn" | Đầu vào từ một anchor `loan_application`; khuyến nghị `min(đề nghị, hạn mức, TSBĐ × LTV)`; không có facility hay exposure |
| G6 | Vai trò và quan hệ kiểu cá nhân | Không có cổ đông, tỉ lệ sở hữu, kế toán trưởng, công ty liên quan |
| G7 | Rule pack chỉ có 6 rule dùng chung | Thiếu rule tư cách pháp nhân, thẩm quyền phê duyệt (nghị quyết), ngành nghề, nhất quán BCTC–thuế |

### 8.2 Chặn mức enterprise (P1)

| # | Khoảng trống | Bằng chứng / rủi ro |
|---|---|---|
| E1 | ~~Không tái lập được kết quả AI~~ **Đã xử lý (D-97):** `config_snapshot.reproducibility` ghi phiên bản danh mục, nguồn + sha256 template prompt, model / reasoning ghi đè của 4 bước AI (`reproducibility.ts`) | Đã bổ sung (D-104): `schema_fingerprint` (sha256 mọi schema S2 + light_extraction), `app_version` |
| E2 | Đổi policy tín dụng không qua maker-checker | Ngưỡng và rule sửa trên trang cấu hình, hiệu lực ngay, không có người duyệt hay ngày hiệu lực |
| E3 | ~~Retry không idempotent ở cấp lời gọi AI~~ **Đã xử lý cho S1/S2 (D-102):** `enqueueSubStep(..., { reuseKey })` dùng lại sub-step đã SUCCEEDED của cùng operation cha (khoá `wfstep:<parent>:<sha256>` trên cột `idempotencyKey` có sẵn). Stage vẫn chạy lại, nhưng file / bản thể đã đọc xong không gọi model lần nữa | Precheck đã có checkpoint; rule LLM (stage 3) cố ý không dùng lại (P6) |
| E4 | Job cha giữ slot worker khi chờ sub-step | Thông lượng bị giới hạn bởi thời gian chờ LLM (pipeline concurrency 5). *Đính chính:* fan-out S1/S2 **đã có** giới hạn 4 lời gọi đồng thời mỗi operation (`MAX_PARALLEL_MODEL_CALLS`, `stage-adapters.ts`); `Promise.all` ở tầng domain chỉ xếp hàng. Còn mở: job cha không giữ slot khi chờ |
| E5 | ~~Code tắt nằm lẫn trong luồng chính~~ **Đã xử lý (D-97…D-99):** S4, S5, `dossier-consolidate`, dựng `master_dossier` không còn trong đồ thị import lúc chạy (test khóa); trang cấu hình chỉ còn bước AI thực sự chạy; đường resume operation cũ và đầu vào tài chính kiểu v2 cũ đã gỡ | — |
| E9 | ~~Đầu vào tài chính không lọc evidence `REVIEW`~~ **Đã xử lý (D-101, chọn "vẫn tính nhưng gắn cờ"):** đầu vào có độ tin cậy đọc < 0.80 (hoặc không có) mang `reviewIds`; chỉ số tính từ chúng có `needs_review` + `review_evidence_ids` + cảnh báo đầu danh sách (UI hiện) | Đã đóng (D-104): rule engine trả `REVIEW` / `INPUT_NEEDS_REVIEW` khi chỉ số `needs_review` lẽ ra PASS; payload tích hợp 5.2 có `financials[].review` |
| E6 | ~~Rule LLM nhận hai khối dữ liệu tách rời~~ **Đã cài đặt (D-103), mặc định tắt:** `lac_mode = on` dùng một khối LAC dẫn nguồn được (`F<n>`), có trạng thái tin cậy, quan hệ, mâu thuẫn, khoảng trống; thêm rào `EVIDENCE_DISPUTED` / `DECLARED_ONLY`. [Spec LAC](spec-v3/cross_cutting/loan_application_context.md) | Còn: T-LAC-07 (đo shadow / on trên bộ UAT) trước khi bật mặc định |
| E7 | Một điểm phụ thuộc: anchor `loan_application` | Không có đơn vay thì không gom được người nào và không có đầu vào khoản vay |
| E8 | Thiếu quan sát chất lượng nghiệp vụ | Không có chỉ số drift: tỉ lệ `REVIEW`, dẫn chiếu bị loại, độ chính xác trên bộ UAT |

---

## 9. Kiến trúc đích: lõi chung + Segment Pack

### 9.1 Ý tưởng

**Lõi** giữ 5 stage và mọi nguyên tắc ở §2, không biết phân khúc nào. Mọi khác biệt giữa HKD, SME (và sau này doanh nghiệp
lớn, cá nhân tiêu dùng…) gói trong một **Segment Pack**, được chọn theo `loan_products.json → products[].segment`.

```
                ┌─────────────────────── LÕI (segment-agnostic) ───────────────────────┐
 files ─▶ S1 classify ─▶ S2 extract ─▶ S3 entity resolution ─▶ LAC ─▶ Financial ─▶ Rules ─▶ Decision ─▶ Output / payload
                └────────▲────────────▲──────────────▲──────────────────▲──────────▲────────▲──────────┘
                         │            │              │                  │          │        │
       ┌─────────────────┴────────────┴──────────────┴──────────────────┴──────────┴────────┴─────┐
       │ Segment Pack (HKD | SME | …): doc catalog & schema · anchor & roles · financial strategy │
       │                              · policy pack · rule pack · decision strategy · UI hints    │
       └───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Hợp đồng của Segment Pack

```ts
interface SegmentPack {
  pack_id: string;                    // "hkd-secured", "sme-secured"
  pack_version: string;               // semver; ghi vào config_snapshot
  segment: 'HKD' | 'SME' | string;
  catalog: {
    doc_type_keys: string[];          // tập con của doc_types.json mà pack dùng
    anchor: AnchorSpec;               // loại chứng từ gốc quyết định vai trò + khoản vay (VD loan_application | credit_proposal)
    roles: RoleSpec[];                // vai trò hợp lệ (borrower, legal_representative, shareholder…)
  };
  financial: FinancialStrategy;       // inputs(evidences, s3, lac) → FinancialMetrics (cùng MetricResult)
  policy: PolicyPackRef;              // { policy_id, version } → tra kho policy có phê duyệt (§9.4)
  rules: RulePackRef;                 // bộ rule engine + LLM mặc định của phân khúc
  decision: DecisionStrategy;         // (financial, rules, facilities, exposure) → recommendation + review route
}

interface FinancialStrategy {
  strategy_id: string;                // "sme-secured:financial@1"
  requiredInputs(): InputSpec[];      // để UI / LAC biết cần chứng từ nào; thiếu → INSUFFICIENT_DATA có lý do
  execute(input: FinancialStrategyInput): FinancialMetrics;
}
```

**Ràng buộc:**
- **Contract chung:** output cùng hình dạng (`MetricResult`, `RuleResult`, `LoanRecommendation`), nên UI và payload tích
  hợp không phải biết phân khúc. Chỉ số riêng của phân khúc nằm trong `FinancialMetrics` dạng map có khóa đăng ký trước,
  kèm nhãn và đơn vị.
- **Registry kiểm tra khi khởi động:** sản phẩm trỏ tới pack không tồn tại, hoặc pack dùng `doc_type_key` không có schema
  FULL cho input bắt buộc → worker không khởi động (fail-closed), giống `validateProductsAgainstPrograms`.
- **Pack thuần:** không I/O, test bằng fixture như `lib/loan-dossier`.

### 9.3 Nội dung pack theo phân khúc

| Thành phần | HKD (đóng gói lại phần hiện có) | SME (cần xây) |
|---|---|---|
| Chứng từ + schema FULL | 27 schema hiện có | BCTC (CĐKT, KQKD, LCTT, nhiều kỳ), tờ khai VAT/TNDN, ĐKKD, điều lệ, nghị quyết HĐTV/ĐHĐCĐ, sổ cổ đông |
| Anchor | `loan_application` | Đơn vay doanh nghiệp / tờ trình (theo mẫu của ngân hàng) |
| Vai trò | borrower, co_borrower, collateral_owner, guarantor, spouse | borrower (pháp nhân), legal_representative, shareholder (+ tỉ lệ), chief_accountant, corporate_guarantor, related_company |
| Financial | Thu nhập HKD, lợi nhuận làm proxy CFADS, niên kim | Chuẩn hoá BCTC → EBITDA, CFADS, DSCR, ICR, D/E, current ratio, vòng quay, nhu cầu vốn lưu động; xu hướng nhiều kỳ |
| Policy | DSCR, LTV, hạn mức, kỳ hạn | Ngưỡng theo loại cấp tín dụng × loại TSBĐ × hạng khách hàng; giới hạn tổng exposure |
| Rule | 3 engine + 3 LLM | Tư cách pháp nhân, thẩm quyền vay/thế chấp, ngành nghề ↔ mục đích, BCTC ↔ thuế, BCTC kiểm toán hay tự lập |
| Decision | Một khoản vay | Nhiều facility, đề xuất theo từng facility, tính cả dư nợ hiện hữu (CIC) |

### 9.4 Năng lực lõi cần bổ sung

| Năng lực | Thiết kế |
|---|---|
| **Loan Application Context (LAC)** | Một view tất định, dẫn nguồn được cho mọi bước LLM; thêm chủ thể `loan`, `business`, pháp nhân và facility. Spec: [loan_application_context.md](spec-v3/cross_cutting/loan_application_context.md) |
| **Facility & exposure** | `facilities[]` (loại, số tiền, kỳ hạn, lãi suất, TSBĐ gắn) thay cho một khoản vay; `exposure` từ CIC (dư nợ, nhóm nợ, số TCTD) |
| **Tái lập kết quả** | `config_snapshot` thêm `pack_id@version`, `catalog_version`, `schema_versions`, `prompt_hash` theo step, `model`, `reasoning`. Kết quả phải dựng lại được từ snapshot + evidences |
| **Kho policy có phê duyệt** | Policy / rule pack là bản ghi bất biến có version: đề xuất → duyệt (Khối Rủi ro) → ngày hiệu lực. Profile chỉ **chọn** version đã duyệt và override trong biên cho phép. Audit ghi người đề xuất, người duyệt, diff |
| **Idempotency AI** | Checkpoint theo từng file/bản thể trong S1/S2; khoá `hash(stage, file_id, page_range, prompt_hash, model)` để dùng lại kết quả sub-step khi retry hoặc resume |
| **Thông lượng** | Giới hạn concurrency fan-out theo connector; job cha không giữ slot khi chờ (continuation / flow job của BullMQ) |
| **Quan sát chất lượng** | Metric theo phiên bản prompt/model: tỉ lệ `REVIEW`, dẫn chiếu bị loại, `INSUFFICIENT_DATA` theo chỉ số, độ chính xác trên bộ UAT chạy định kỳ (regression của prompt/model) |

---

## 10. Lộ trình

| Giai đoạn | Việc chính | Điều kiện xong |
|---|---|---|
| **0. Dọn nền** | Tách code tắt ra sau feature flag hoặc module `legacy/`; cập nhật spec-v3 theo 5 stage; snapshot tái lập (E1) | Docs khớp code; mỗi kết quả có `prompt_hash`, `model`, `catalog_version` |
| **1. Segment Pack cho HKD** ✅ D-100 | Định nghĩa interface §9.2; đóng gói phần HKD; registry + kiểm tra khi khởi động | Toàn bộ test hồi quy giữ nguyên; `config_snapshot.segment_pack.pack_id = hkd-secured`. Interface v1 chỉ gồm stage 2–4 (`calculateFinancials`, `evaluatePolicy`, `recommend`); danh mục chứng từ, anchor, vai trò vào pack khi xây SME pack |
| **2. Idempotency & thông lượng** 🟡 D-102 | ✅ khoá idempotency sub-step S1/S2 (thay cho checkpoint theo file: cùng hiệu quả, không đổi cấu trúc checkpoint); ✅ giới hạn fan-out (đã có sẵn); ⬜ job cha không chờ (E4) | Retry S2 chỉ gọi lại file lỗi (✅); tải 20 hồ sơ đồng thời không chặn hàng đợi (⬜ cần thiết kế lại hàng đợi) |
| **3. LAC** 🟡 D-103 | Theo spec LAC (`lac_mode` off → shadow → on): ✅ T-LAC-01…06; ⬜ T-LAC-07 | Tiêu chí bật trong T-LAC-07 đạt trên bộ UAT |
| **4. SME Pack** | Schema FULL cho chứng từ SME; strategy tài chính SME; policy pack thật; rule pack SME; facility & exposure | Bộ UAT SME (do nghiệp vụ cung cấp) đạt ngưỡng chính xác đã thống nhất |
| **5. Quản trị** | Kho policy có maker-checker; dashboard chất lượng (E2, E8) | Policy chỉ đổi được qua phê duyệt; có cảnh báo khi chất lượng giảm |

**Câu hỏi nghiệp vụ cần chốt trước giai đoạn 4:** phân khúc SME (micro / small / medium) và yêu cầu BCTC (kiểm toán hay tự
lập, mấy kỳ); phương pháp tính hạn mức vốn lưu động; bộ ngưỡng policy SME và chủ sở hữu; nguồn dư nợ hiện hữu (tích hợp
CIC/core hay đọc file); phạm vi scorecard.

---

## 11. Bản đồ mã nguồn và tài liệu

### 11.1 Mã nguồn chính

| File | Vai trò |
|---|---|
| `lib/pipelines/workflows/loan-appraisal.ts` | `runLoanAppraisal`: điều phối 5 stage, pause/resume, ghép kết quả |
| `lib/pipelines/workflows/loan-appraisal/state-machine.ts` | `LOAN_STAGE_DEFINITIONS`, phase, `deriveProcessingStatus` |
| `.../dossier-stages.ts`, `stage-adapters.ts` | Nối S1/S2 vào workflow (port → `enqueueSubStep`) |
| `.../dossier-precheck.ts`, `precheck-intake.ts` | Kiểm tra sơ bộ, output giai đoạn 1 |
| `.../financial-inputs.ts`, `strategies.ts` | Đầu vào tài chính, strategy tài chính/policy/khuyến nghị |
| `.../rules.ts`, `check-set.ts`, `prompt-checks.ts`, `rule-groups.ts` | Rule engine, bộ rule cấu hình được, rule LLM |
| `.../product-config.ts`, `product-policy.ts`, `step-catalog.ts` | Cấu hình theo sản phẩm, policy, step AI |
| `.../integration-contract.ts`, `integration-payload.ts`, `check-contract.ts` | Contract tích hợp 5.1 |
| `lib/loan-dossier/s1` … `s5`, `graph/`, `catalog/`, `contracts/` | Domain hồ sơ spec-v3 |
| `lib/pipelines/workflow-engine.ts` | Sub-step, checkpoint, cancel, pause, complete, fail |
| `app/loan-appraisal-v2/`, `components/loan-appraisal-v2/` | Giao diện |

### 11.2 Tài liệu và mức tin cậy

| Tài liệu | Dùng để | Lưu ý |
|---|---|---|
| **File này** | Tham chiếu kiến trúc | Cập nhật cùng PR đổi kiến trúc |
| [lib/pipelines/workflows/loan-appraisal/README.md](../../lib/pipelines/workflows/loan-appraisal/README.md) | Chi tiết domain thẩm định | Đã đối chiếu lại với code ở D-97 |
| [INTEGRATION-CONTRACT.md](INTEGRATION-CONTRACT.md) | Contract cho hệ thống ngoài | — |
| [ADD-NEW-PRODUCT-FLOW.md](ADD-NEW-PRODUCT-FLOW.md) | Thêm sản phẩm / luồng | Chỉ phủ danh mục và cấu hình; chưa có Segment Pack |
| [spec-v3/cross_cutting/v2_integration.md](spec-v3/cross_cutting/v2_integration.md) | Rule V2-R* | Thân bài mô tả 8 stage; **ghi chú trạng thái ở đầu file** (D-97) liệt kê các rule không còn đúng với code |
| [spec-v3/stages/S1…S5](spec-v3/stages/) | Rule và AC của từng stage | S4, S5 đang không được workflow gọi |
| [spec-v3/cross_cutting/master_dossier.md](spec-v3/cross_cutting/master_dossier.md) | Master dossier, hiệu chỉnh | Đang tắt cùng S4/S5 |
| [spec-v3/cross_cutting/loan_application_context.md](spec-v3/cross_cutting/loan_application_context.md) | LAC | Đề xuất, chưa duyệt |
| [spec-v3/IMPLEMENT.md](spec-v3/IMPLEMENT.md), [open_questions.md](spec-v3/open_questions.md) | Nhật ký quyết định D-*, câu hỏi mở OQ-* | Append-only |

---

## 12. Nhật ký quyết định kiến trúc

Quyết định chi tiết ở `spec-v3/IMPLEMENT.md` (D-*). Bảng dưới chỉ ghi các quyết định định hình kiến trúc.

| ID | Quyết định | Lý do | Trạng thái |
|---|---|---|---|
| D-32 | Giữ workflow v2, thay stage 0–2 bằng engine `lib/loan-dossier` (spec-v3) | Kiểu dữ liệu và danh mục theo spec; logic thuần, test được | Đang áp dụng |
| D-51 / D-53 | Tách 2 giai đoạn, `stop_after_intake` mặc định `true` | Sale xem tiếp nhận trước khi tốn chi phí OCR | Đang áp dụng |
| D-73 / D-81 / D-90 | Giai đoạn 1 = S1 + precheck LLM, dừng ngay sau precheck | Phản hồi sớm, rẻ | Đang áp dụng |
| D-96 | Danh mục sản phẩm cấu hình được, rule id `LOAN.*`, khung `sme` | Bước đầu đa sản phẩm | Đang áp dụng (SME chưa có giá trị nghiệp vụ) |
| D-97 | Ghi nhận: tạm tắt S4/S5, master_dossier, intake_review, readiness ở giai đoạn 2; DAG 5 stage. Thêm `config_snapshot.reproducibility` | Trạng thái chưa từng được ghi; tái lập kết quả (E1) | Đang áp dụng |
| D-98 | Tách hàm dùng chung (`prompt-render`, `dossier-facts`, `run-params`) để S4/S5/consolidate/master rời đồ thị import lúc chạy; không xóa code | Đường chạy chính không mang code đang tắt; giữ D-82 | Đang áp dụng (test khóa) |
| D-99 | Gỡ 4 bước AI không chạy khỏi danh mục cấu hình (`RETIRED_STEP_KEYS`, bỏ êm khi đọc/ghi); gỡ đường resume operation cũ và đầu vào tài chính kiểu v2 cũ | Người dùng xác nhận không còn operation đang dừng | Đang áp dụng |
| D-104 | E9 chốt: rule engine hạ PASS → REVIEW khi chỉ số cần soát; contract 5.2 `financials[].review`. E1 hoàn tất. Test baseline xanh | Người dùng chọn cả hai | Đang áp dụng |
| D-100 / ADR-01 | Lõi chung + Segment Pack (§9). v1: stage 2–4, registry phân khúc → pack, fail-closed khi worker khởi động, `config_snapshot.segment_pack` | Mở rộng SME mà không rẽ nhánh lõi | **Đang áp dụng** (chỉ pack HKD) |
| D-103 / ADR-02 | Loan Application Context làm nguồn duy nhất cho LLM giai đoạn 2 (`lac_mode`, mặc định `off`) | Dẫn nguồn được, có trạng thái tin cậy | **Đã cài đặt**, chờ T-LAC-07 để bật |
| ADR-03 | Kho policy bất biến có maker-checker; Profile chỉ chọn version | Kiểm soát nội bộ, kiểm toán | **Đề xuất** |
| D-102 / ADR-04 | Idempotency theo file/bản thể cho sub-step AI: `reuseKey` → `operations.idempotencyKey`, chỉ trong cùng operation cha, usage cộng đúng một lần | Retry rẻ, kết quả ổn định | **Đang áp dụng** (S1, S2) |
