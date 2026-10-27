# SkillHub — Capability Map (Document Skills)

> Bản đồ ánh xạ business use-case → tổ hợp primitive skill của SkillHub (nhóm Document Skills).
> Chỉ liệt kê các use-case map được bằng primitive/connector hiện có. Các năng lực real-time,
> agentic, RPA, voice/video, dev-tooling nằm ngoài phạm vi Document group (roadmap các group khác).

Ký hiệu: `→` tuần tự · `+` song song/gộp

Pattern:
- **IVR** = Ingest–Verify–Report — `extract:* → compare:verify → generate:report`
- **IJP** = Ingest–Judge–Produce — `extract:* → analyze:* → generate:*`
- **IVJR** = Ingest–Verify–Judge–Report — `extract:* → compare:verify → analyze:* → generate:report`

Phân biệt **Verify** vs **Judge**:
- **Verify** (`compare:verify`): đối chiếu tài liệu với một nguồn sự thật bên ngoài (`reference_data`). Câu hỏi: "có KHỚP không?". Tất định, có ground truth.
- **Judge** (`analyze:*`): đánh giá nội tại theo `criteria` hoặc phán đoán mô hình, không cần nguồn ngoài. Câu hỏi: "có ĐẠT chuẩn/mức nào không?".

## Primitive palette (Document group)

| Service | Sub-case dùng được |
|---|---|
| `extract` | invoice, contract, id-card, custom, disbursement, guarantee, approval, collateral, credit-report, payment-order, lc, business-license, account-form, civil-doc, vehicle-doc, insurance |
| `analyze` | classify, compliance, quality, risk |
| `transform` | convert, translate, rewrite, redact, template, split |
| `generate` | summary, report, email, minutes |
| `compare` | verify, diff, semantic, version |

> Ánh xạ IDP OCR bots → subcase `extract` + schema hợp nhất (consolidated): xem [`EXTRACT_SUBCASE_MAPPING.md`](./EXTRACT_SUBCASE_MAPPING.md).

## Đã có Business Workflow

| Use-case | Workflow | Tổ hợp primitive | Pattern |
|---|---|---|---|
| Smart Loan Disbursement | `workflows:disbursement` | `extract:disbursement + extract:collateral + extract:approval` → `compare:verify` → `generate:report` | IVR |
| Letter of Credit Checking | `workflows:lc-checker` | `extract:lc` → `analyze:compliance` (UCP600/ISBP821) → `generate:report` | IJP |
| Letter of Guarantee Review | (một phần `lc-checker`) | `extract:guarantee` → `analyze:compliance` → `generate:report` | IJP |
| National Structural Review Form | `workflows:structure-compare` | `extract:custom` (structure) → `compare:semantic` | IVR |
| Payroll Reconciliation | `workflows:payroll-verify` | `extract:custom` → `compare:verify` (rule-based) | IVR |
| User-Story / BRD Scoring | `workflows:brd-analyze` | `extract:custom` → scorecard → `generate:report` | IJP |

## Build được ngay từ Primitive (chưa cần code workflow)

| Use-case | Tổ hợp primitive | Pattern |
|---|---|---|
| Documentation Analysis | `extract:custom` → `analyze:quality + analyze:risk` → `generate:summary`/`report` | IJP |
| Documentation Organization | `analyze:classify` → `transform:convert` | IJP |
| Compliance Q&A / Policies Q&A | `generate:qa` | IJP |
| AML Due Diligence (hồ sơ) | `extract:business-license + extract:id-card + extract:civil-doc` → `compare:verify` (reference = sanction list) → `analyze:risk` → `generate:report` | IVJR |
| Accounting Risk Monitoring (chứng từ) | `extract:invoice`/`extract:custom` → `analyze:risk` → `generate:report` | IJP |
| Consumer Protection Review | `extract:custom` → `analyze:compliance` (criteria) → `generate:report` | IJP |
| Intelligent Form Filling | `extract:account-form`/`extract:custom` → `transform:template` | IJP |
| Official / R&D Document Writing | `extract:custom` → `generate:report` → `transform:rewrite` (style/tone) | IJP |
| Complaint Response (CS / Consumer Protection Agent) | `extract:custom` → `analyze:compliance` → `generate:email` | IJP |
| Meeting Minutes / Summary | `generate:minutes` (transcript) → `generate:summary` | IJP |
| Audit (document-based) | `extract:*` → `compare:verify` → `analyze:compliance` → `generate:report` | IVJR |
| Adjustments Assistant (đối soát số) | `extract:custom` → `compare:verify` → `generate:report` | IVR |
