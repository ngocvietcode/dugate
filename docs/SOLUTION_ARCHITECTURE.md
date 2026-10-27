# SkillHub — Solution Architecture Document

> **Product**: SkillHub — nền tảng Common AI Skills dùng chung cho toàn ngân hàng
> **Codename / Repo**: `dugate` — hiện thực nhóm **Document Skills**
> **Document ID**: SA-SkillHub-2026-004
> **Classification**: INTERNAL
> **Author**: Solution Architecture Team
> **Date**: 2026-07-01
> **Status**: DRAFT — phản ánh trạng thái codebase hiện tại

---

## Mục lục

1. [Tóm tắt & Định vị](#1-tóm-tắt--định-vị)
2. [Bối cảnh nghiệp vụ & Lý do thiết kế](#2-bối-cảnh-nghiệp-vụ--lý-do-thiết-kế)
3. [Tổng quan giải pháp](#3-tổng-quan-giải-pháp)
4. [Nguyên tắc kiến trúc](#4-nguyên-tắc-kiến-trúc)
5. [System Context (C4 Level 1)](#5-system-context-c4-level-1)
6. [Container Architecture (C4 Level 2)](#6-container-architecture-c4-level-2)
7. [Component Architecture (C4 Level 3)](#7-component-architecture-c4-level-3)
8. [Mô hình dữ liệu](#8-mô-hình-dữ-liệu)
9. [Kiến trúc Queue & Worker](#9-kiến-trúc-queue--worker)
10. [Mô hình External AI Connector](#10-mô-hình-external-ai-connector)
11. [Sequence Diagrams](#11-sequence-diagrams)
12. [Kiến trúc bảo mật](#12-kiến-trúc-bảo-mật)
13. [Storage, Chi phí & Rate limit](#13-storage-chi-phí--rate-limit)
14. [Kiến trúc triển khai](#14-kiến-trúc-triển-khai)
15. [Yêu cầu phi chức năng (NFR)](#15-yêu-cầu-phi-chức-năng-nfr)
16. [Ma trận lựa chọn công nghệ](#16-ma-trận-lựa-chọn-công-nghệ)
17. [Document Control](#17-document-control)

---

## 1. Tóm tắt & Định vị

**SkillHub** là nền tảng trung tâm **host các "common skill" AI dùng chung cho toàn ngân hàng**: mỗi năng lực AI tái sử dụng được đóng gói thành một *skill* có contract chuẩn, quản trị tập trung, và mọi đơn vị nghiệp vụ tiêu thụ qua một cổng duy nhất. Triết lý cốt lõi là **xây một lần, dùng nhiều nơi** — chi phí, bảo mật và tuân thủ được kiểm soát ở cấp nền tảng thay vì để từng ứng dụng tự lo.

Nhóm skill đầu tiên được hiện thực đầy đủ là **Document Skills** (codename repo `dugate`) — xử lý tài liệu bằng AI: trích xuất (extract), phân tích (analyze), biến đổi (transform), sinh nội dung (generate), so sánh (compare), cùng các **workflow nghiệp vụ nhiều bước** như đối chiếu giải ngân, kiểm tra bộ chứng từ LC, đối chiếu bảng lương. Các nhóm skill khác có thể bổ sung sau **trên cùng nền tảng control-plane này** mà không phải thiết kế lại hạ tầng.

Về mặt kỹ thuật, SkillHub chuẩn hoá toàn bộ lớp truy cập AI thành một tập **API skill có phiên bản** (canonical `v2`, tương thích ngược `v1`), vận hành trên kiến trúc **async worker (BullMQ)** với các đặc tính chính:

- **Zero-coupling** giữa ứng dụng nghiệp vụ và AI backend: đổi prompt, model hay connector chỉ cần thao tác Admin, không sửa code client.
- **Cách ly đa tenant** theo trục API Key → Profile (`ProfileEndpoint`) → connector, kèm override prompt/model tới từng bước.
- **Long-Running Operation (LRO)** theo phong cách Google AIP-151: API trả `202` kèm `Operation-Location`, client poll trạng thái.
- **Hai engine xử lý**: Pipeline Engine (chuỗi connector tuyến tính) và Workflow Engine (orchestration code-driven, hỗ trợ chạy song song và Human-in-the-Loop).
- **Chuẩn doanh nghiệp**: RBAC + OIDC SSO, mã hoá AES-256-GCM, chống SSRF, rate limit, cost tracking theo token, checkpoint/resume, cách ly tài nguyên theo worker group.

### 1.1 SkillHub như một Control Plane cho AI dùng chung

SkillHub là **control plane** cho năng lực AI dùng chung. Mỗi *skill* là một đơn vị năng lực có contract API ổn định; các skill cùng miền được gom thành *group*. Nền tảng cung cấp **một lần cho mọi group** các dịch vụ nền: định danh & phân quyền (API Key, RBAC, SSO), routing & override cấu hình (`ProfileEndpoint`, `ExternalApiConnection`), thực thi bất đồng bộ đáng tin cậy (BullMQ, checkpoint/resume, worker group), và governance (cost tracking, rate limit, audit log).

```mermaid
graph TB
    BU["Đơn vị nghiệp vụ / Ứng dụng"] -->|x-api-key| SH
    subgraph SH["🏦 SkillHub — Common AI Skills Platform"]
        subgraph PLAT["Nền tảng dùng chung (control plane)"]
            AUTH["Auth & RBAC<br/>API Key · OIDC SSO"]
            PROF["Profile & Routing<br/>ProfileEndpoint · Connector · Override"]
            EXEC["Async Execution<br/>BullMQ · checkpoint/resume · worker group"]
            GOV["Governance<br/>Cost · Rate limit · Audit"]
        end
        subgraph GROUPS["Skill Groups"]
            DOC["📄 Document Skills<br/>(codename dugate — ĐÃ hiện thực)"]
            CONV["💬 Conversational Skills<br/>(minh hoạ — tương lai)"]
            VIS["👁 Vision Skills<br/>(minh hoạ — tương lai)"]
            DATA["📊 Data / Analytics Skills<br/>(minh hoạ — tương lai)"]
        end
    end
    DOC --- PLAT
    CONV -.-> PLAT
    VIS -.-> PLAT
    DATA -.-> PLAT

    style DOC fill:#51cf66,stroke:#333,stroke-width:2px
    style CONV stroke-dasharray: 5 5
    style VIS stroke-dasharray: 5 5
    style DATA stroke-dasharray: 5 5
```

> **Phạm vi tài liệu này**: mô tả nền tảng SkillHub *thông qua* nhóm đầu tiên đã hiện thực — **Document Skills** (`dugate`). Các nhóm vẽ nét đứt chỉ là định hướng mở rộng, **chưa** tồn tại trong codebase.

Thêm một nhóm skill mới **không đòi hỏi thay đổi control plane** — chỉ cần khai báo cấu hình và đăng ký handler:

| Thành phần | Việc cần làm khi thêm nhóm skill mới |
|------------|--------------------------------------|
| `SERVICE_REGISTRY` (`lib/endpoints/registry.ts`) | Khai báo service/sub-case + ParamSchema + chuỗi connector của nhóm |
| `ExternalApiConnection` (DB) | Đăng ký backend AI của nhóm (multipart hoặc AIHub) — Admin tạo, không cần deploy |
| `ProfileEndpoint` (DB) | Cấp quyền + cấu hình per-tenant cho endpoint của nhóm |
| `WORKFLOW_REGISTRY` (`lib/pipelines/workflow-engine.ts`) | (Tuỳ chọn) đăng ký workflow code-driven cho nhóm |
| Worker / Queue / Auth / Cost / Storage | **Dùng lại nguyên trạng** |

### 1.2 Phân tầng Skill: Common (primitive) và Business (composite)

Bên trong một nhóm skill, năng lực được chia thành **hai tầng** với **ranh giới sở hữu khác nhau**, nhưng cùng đăng ký và cùng được gác cổng bởi **một control plane** duy nhất:

- **Common skills (primitive)** — các *động từ* xử lý tài liệu **không gắn nghiệp vụ** (domain-agnostic): Classify, Extract, Verify, Compare, Analyze, Generate. Do **đội Document Understanding (DU)** sở hữu và bảo trì, tái sử dụng cho mọi domain.
- **Business skills (composite)** — **ghép** các động từ trên thành một nghiệp vụ cụ thể; do **domain** sở hữu (ví dụ Tín dụng): *Thẩm định pháp lý* = Classify + Extract + Verify; *Phân tích tài chính* = Extract + Compare + Analyze; *Soạn tờ trình* = Generate (gắn nhãn A/B/C).

Cả hai tầng đăng ký qua control plane (registry · guardrail · audit · HITL console) trước khi **cắm vào quy trình nghiệp vụ có sẵn** — ví dụ Quy trình tín dụng 18 bước / 7 swimlane.

```mermaid
graph TB
    subgraph CP["Control plane — Registry · Guardrail · Audit · HITL console"]
        subgraph COMMON["Common skills — xử lý tài liệu (DU team · domain-agnostic)"]
            CLS["Classify<br/>Phân loại giấy tờ"]
            EXT["Extract<br/>Trích trường dữ liệu"]
            VER["Verify<br/>Kiểm tra tính xác thực"]
            CMP["Compare<br/>Đối chiếu chéo dữ liệu"]
            ANA["Analyze<br/>Phân tích rủi ro"]
            GEN["Generate<br/>Soạn thảo văn bản"]
        end
        subgraph BIZ["Business skills — Tín dụng (domain sở hữu · ghép primitive)"]
            B1["Thẩm định pháp lý<br/>Classify + Extract + Verify"]
            B2["Phân tích tài chính<br/>Extract + Compare + Analyze"]
            B3["Soạn tờ trình<br/>Generate · nhãn A/B/C"]
        end
    end
    COMMON -->|ghép thành| BIZ
    BIZ -->|áp dụng vào| PROC["Quy trình tín dụng<br/>18 bước · 7 swimlane"]

    style COMMON fill:#e6f7ec,stroke:#51cf66
    style BIZ fill:#eee9ff,stroke:#7c6bd6
    style PROC fill:#f2efe9,stroke:#999
```

Hai tầng khái niệm này ánh xạ trực tiếp vào hai engine trong codebase:

| Tầng | Chủ sở hữu | Hiện thực trong code |
|------|-----------|----------------------|
| **Common skills** (động từ, domain-agnostic) | Đội DU | Services trong `SERVICE_REGISTRY` (`extract`, `analyze`, `transform`, `generate`, `compare`) + connector, thực thi bởi **Pipeline Engine** (`engine.ts`) |
| **Business skills** (ghép động từ theo nghiệp vụ) | Domain (ví dụ Tín dụng) | Workflow code-driven trong `WORKFLOW_REGISTRY`, thực thi bởi **Workflow Engine** (`workflow-engine.ts`) |
| **Control plane** (gác cổng cả hai) | Nền tảng SkillHub | Auth/RBAC, `ProfileEndpoint`, guardrail (locked params), queue/worker, cost, audit, HITL — dùng chung |

> Ranh giới sở hữu là nguyên tắc quản trị then chốt (xem AP-11): đội DU **xây và bảo trì primitive dùng chung**; domain team **ghép** chúng thành business skill mà không cần sửa primitive. Nhờ vậy primitive giữ tính nhất quán, còn nghiệp vụ vẫn linh hoạt theo từng domain.

---

## 2. Bối cảnh nghiệp vụ & Lý do thiết kế

Nhu cầu xử lý tài liệu bằng AI (OCR, trích xuất, phân loại, đối soát, kiểm tra tuân thủ…) tăng nhanh trên nhiều đơn vị, đặc biệt trong Tài chính — Ngân hàng. Nếu mỗi ứng dụng tự tích hợp trực tiếp tới từng dịch vụ AI, chi phí và rủi ro tăng tuyến tính.

| # | Vấn đề | Ảnh hưởng | Cách nền tảng xử lý |
|---|--------|-----------|---------------------|
| P1 | Mỗi app tự tích hợp riêng → N×M integration | Bảo trì tốn kém | Một cổng duy nhất, provider-agnostic |
| P2 | Không kiểm soát prompt/model tập trung | Output thiếu nhất quán, rủi ro injection | Quản lý prompt/model tập trung, khoá tham số |
| P3 | Thiếu audit trail | Vi phạm compliance | Structured log + cURL reconstruction + lưu từng bước |
| P4 | Không có hạn mức chi tiêu theo đội | Token vượt kiểm soát | `ApiKey.spendingLimit` + `totalUsed`, chặn `402` |
| P5 | Thiếu cơ chế nối chuỗi xử lý | Không ghép được các bước | Pipeline Engine (chuỗi connector) + Workflow Engine (DAG code) |
| P6 | Thiếu bước con người duyệt | Không dừng được để phê duyệt | HITL: `WAITING_USER_INPUT` + resume từ checkpoint |
| P7 | Không cách ly tài nguyên theo tenant | Tenant lớn làm nghẽn tenant nhỏ | Worker group routing + backpressure |

### 2.1 Vì sao cần lớp Gateway — thay vì gọi thẳng AIHub / Agent toolkit?

Đây là câu hỏi hợp lý: *"Đã có AIHub (LLM endpoint) và Agent toolkit, sao không để mỗi ứng dụng gọi thẳng?"* Với một ứng dụng đơn lẻ, tương tác, lưu lượng thấp, một model, không ràng buộc compliance — gọi thẳng **là lựa chọn đúng**, thêm gateway chỉ là chi phí thừa. Nhưng ở quy mô ngân hàng với **nhiều consumer, quy trình bị kiểm soát, và yêu cầu chi phí/kiểm toán**, lớp gateway giải quyết một loạt vấn đề nằm ngoài phạm vi của bản thân AIHub hay Agent toolkit.

Mấu chốt là phân biệt hai tầng khác nhau:

- **AIHub / Agent toolkit = data plane** — năng lực suy luận: gọi model, xử lý multimodal, và (với agent) tự chọn công cụ/bước theo lối tự chủ, phi tất định.
- **SkillHub = control plane** — lớp quản trị *bao quanh* năng lực đó: ai được gọi gì, bằng prompt/model nào, tốn bao nhiêu, có kiểm toán/tạm dừng/khôi phục được không.

Gateway **không thay thế** AIHub; nó **bọc và quản trị** AIHub cùng các backend khác. Trên thực tế, AIHub chính là một trong các connector mà dugate gọi (nhánh AIHub, §10.2).

| Mối quan tâm | Gọi thẳng AIHub / Agent toolkit | Qua SkillHub |
|--------------|----------------------------------|--------------|
| **Coupling** | Client hardcode endpoint + model + prompt → bài toán N×M | Client gọi contract ổn định (`/api/v2/docs/extract?type=invoice`); model/prompt/connector resolve ở server → đổi backend = 0 dòng code client |
| **Quản trị prompt/model** | Client toàn quyền → nguy cơ injection, output thiếu nhất quán | Prompt/model khoá ở server (locked params, override 3 tầng); client không bypass được |
| **Đa tenant** | AIHub là endpoint model thô, không có khái niệm "profile theo đơn vị" | API Key → `ProfileEndpoint` riêng: prompt/model/connector/priority/rate-limit/worker-group tách biệt |
| **Kiểm soát chi phí** | Bị tính tiền nhưng không có ngân sách theo đội | Cost theo từng Operation + `spendingLimit` chặn `402`, `usageBreakdown` |
| **Độ bền & tin cậy** | Gọi đồng bộ → block, timeout với file lớn/nhiều bước; retry = chạy lại từ đầu (tính phí 2 lần) | Async LRO (202/poll), retry + backoff, **checkpoint/resume** (không gọi lại bước đã xong), backpressure, stalled recovery, DLQ |
| **Human-in-the-Loop** | Vòng lặp agent in-memory không dừng bền qua nhiều giờ/ngày và qua các lần restart | `WAITING_USER_INPUT` lưu ở DB, chờ vô thời hạn, resume đúng checkpoint |
| **Tất định & kiểm toán** | Agent tự chọn bước → phi tất định, khó tái lập/chứng nhận | Workflow là DAG code-driven, bước tường minh, có quality gate, structured log + cURL reconstruction |
| **Đa dạng backend** | Chỉ nói chuyện với endpoint kiểu AIHub | Chuẩn hoá cả multipart (OCR/extractor/CAIP/on-prem) lẫn AIHub JSON sau một contract |
| **Bảo mật** | Mỗi client tự giữ secret AI → phát tán credential | Secret mã hoá ở server, không lộ ra client; SSRF guard; RBAC/SSO |
| **Cross-cutting** | Mỗi client tự làm lại idempotency, webhook, rate-limit, storage, cleanup | Nền tảng cung cấp một lần cho mọi consumer |

**Về riêng "Agent toolkit"**: agent tối ưu cho bài toán tự chủ, khám phá, phi tất định — tự quyết định gọi tool nào, đi bước nào. Nghiệp vụ chứng từ ngân hàng cần điều ngược lại: pipeline **tất định, kiểm chứng được, kiểm toán được, khôi phục được, và có cổng phê duyệt của con người**, với guardrail chặt. Workflow Engine của dugate là orchestration code-driven (bước tường minh, test và chứng nhận được), *không* phải sự tự chủ của agent. Điều này không loại trừ agent: hoàn toàn có thể **nhúng một agent bên trong một connector step**, nhưng control plane (quản trị, chi phí, kiểm toán, HITL, độ bền) vẫn phải sống ở một lớp như SkillHub.

**Khi nào không cần gateway (trung thực về đánh đổi)**: ứng dụng đơn lẻ, lưu lượng thấp, một model cố định, không cần audit/ngân sách theo đội; hoặc giai đoạn prototype. Ở các bối cảnh đó, chi phí vận hành một control plane lớn hơn lợi ích. Gateway "hoàn vốn" khi số consumer tăng, quy trình bị quản lý chặt, và chi phí/kiểm toán trở thành ràng buộc bắt buộc.

---

## 3. Tổng quan giải pháp

### 3.1 Hai engine xử lý

**A. Pipeline Engine (`lib/pipelines/engine.ts`) — chuỗi connector tuyến tính.** Chạy tuần tự 1–5 `ExternalApiConnection`; output text của bước trước được nối làm `input_content` cho bước sau. Cấu hình hoàn toàn qua registry + Profile override. Đây là nơi thực thi các **common skill**.

```
Request → runEndpoint → submitPipelineJob → BullMQ (queue: pipeline)
                                                  ↓
                                        Worker: runPipeline()
                                        step[0] → step[1] → … → step[n]
                                        (checkpoint sau mỗi bước)
```

**B. Workflow Engine (`lib/pipelines/workflow-engine.ts`) — orchestration code-driven.** Logic viết bằng TypeScript trong `lib/pipelines/workflows/*`, hỗ trợ chạy song song nhiều file, HITL pause/resume, và fan-out sub-step qua queue riêng. Đây là nơi hiện thực các **business skill** (ghép primitive).

```
Request → /api/v2/docs/workflows → submitPipelineJob → BullMQ (queue: pipeline)
                                                             ↓
                                    Worker: runWorkflow() → WORKFLOW_REGISTRY[name]
                                       enqueueSubStep() → BullMQ (queue: workflow-steps)
                                       ── PAUSE (WAITING_USER_INPUT) ── Human review ──
                                       resume → completeWorkflow()
```

### 3.2 Các API skill (Document Skills group)

Bề mặt chuẩn là **v2** (`/api/v2/docs/{service}`); bề mặt **v1** (`/api/v1/docs/{service}`) vẫn phục vụ đầy đủ để tương thích ngược, bao gồm `ingest` đã deprecated. `API_VERSION` và `API_BASE` khai báo trong `lib/endpoints/registry.ts`.

| Service | Discriminator | Sub-cases tiêu biểu | Mô tả |
|---------|---------------|---------------------|-------|
| `extract` | `type` | disbursement, guarantee, approval, collateral, credit-report, query, payment-order, lc, business-license, account-form, civil-doc, vehicle-doc, insurance, invoice, contract, id-card, receipt, table, custom | Trích xuất dữ liệu có cấu trúc |
| `analyze` | `task` | classify, sentiment, compliance, fact-check, quality, risk, summarize-eval | Phân tích, phân loại, đối soát |
| `transform` | `action` | convert, translate, rewrite, redact, template, split | Biến đổi nội dung |
| `generate` | `task` | summary, outline, report, email, minutes, qa | Sinh nội dung |
| `compare` | `mode` | verify, diff, semantic, version | So sánh tài liệu |
| `workflows` | `process` | disbursement, lc-checker, payroll-verify, structure-compare, brd-analyze | Business skill code-driven |
| `ingest` *(deprecated)* | `mode` | parse, ocr, digitize, split | Đã gộp vào `extract` + `transform:split`; vẫn callable qua v1 |

**Endpoint hỗ trợ**: `GET /operations`, `GET /operations/{id}` (poll), `DELETE /operations/{id}` (soft delete), `.../resume`, `.../cancel`, `.../download`, `GET /services`, `GET /billing/balance`, `GET /billing/usage`.

### 3.3 Vòng đời Operation

Mọi công việc đều được biểu diễn bằng bản ghi `Operation`. Trạng thái lưu ở `Operation.state`; `done=true` khi kết thúc (SUCCEEDED hoặc FAILED). BullMQ retry (tối đa 3 lần) tận dụng `currentStep` + `stepsResultJson` để resume mà không gọi lại các bước đã thành công.

```mermaid
stateDiagram-v2
    [*] --> RUNNING: submitPipelineJob → enqueue
    RUNNING --> WAITING_USER_INPUT: pauseWorkflow() — HITL
    WAITING_USER_INPUT --> RUNNING: POST /operations/{id}/resume
    RUNNING --> SUCCEEDED: pipeline done / completeWorkflow()
    RUNNING --> FAILED: Error / Timeout / DLQ
    SUCCEEDED --> [*]
    FAILED --> [*]
```

---

## 4. Nguyên tắc kiến trúc

| # | Nguyên tắc | Mô tả |
|---|-----------|-------|
| AP-1 | **Gateway Abstraction** | Client không bao giờ gọi trực tiếp AI backend; dugate là điểm truy cập duy nhất. |
| AP-2 | **Locked-Param Guardrails** | Tham số `defaultLocked`/`isLocked` bị từ chối (`400`) nếu client cố ghi đè. |
| AP-3 | **Profile-Driven Isolation** | Mỗi API Key có `ProfileEndpoint` riêng (prompt/model/connector/priority), không ảnh hưởng key khác. |
| AP-4 | **Async-First (LRO)** | Mặc định bất đồng bộ qua BullMQ, trả `202`. Chế độ `?sync=true` chờ qua Redis pub/sub, không block event loop. |
| AP-5 | **Zero Client Code Change** | Đổi backend/prompt/model/connector chỉ cần Admin thao tác. |
| AP-6 | **Defence in Depth** | Auth kép (NextAuth cho UI, x-api-key cho API), RBAC, AES-256-GCM, SSRF guard. |
| AP-7 | **Checkpoint & Resume** | Worker lưu state sau mỗi bước; retry tiếp tục từ checkpoint, tránh gọi lại API tính phí. |
| AP-8 | **Human-in-the-Loop** | Workflow có thể tạm dừng để con người kiểm duyệt/chỉnh sửa rồi resume đúng checkpoint. |
| AP-9 | **Tenant Resource Isolation** | Worker group routing + backpressure bảo vệ chất lượng dịch vụ giữa các tenant. |
| AP-10 | **Fail-Open cho tính sẵn sàng** | Rate limiter degrade an toàn khi Redis lỗi (cho phép request thay vì chặn). |
| AP-11 | **Common vs Business Ownership** | Đội DU sở hữu và bảo trì *common skill* (primitive, domain-agnostic); domain team *ghép* chúng thành *business skill* mà không sửa primitive. |
| AP-12 | **Composition over Duplication** | Nghiệp vụ mới ưu tiên **ghép** primitive sẵn có (Workflow Engine) thay vì viết lại logic xử lý tài liệu. |

---

## 5. System Context (C4 Level 1)

```mermaid
C4Context
    title SkillHub — System Context (Document Skills group)

    Person(admin, "Administrator", "Quản trị Gateway/Profile/Connector, review HITL")
    Person(dev, "Developer / App Client", "Tích hợp API qua x-api-key")

    System(dugate, "SkillHub Gateway", "Common AI Skills Platform — Document Skills group")

    System_Ext(aihub, "AI Hub / LLM Providers", "Endpoint OpenAI-compatible & CAIP/Gemini")
    System_Ext(ext_ai, "External AI Connectors", "Dịch vụ OCR / extractor / comparator")
    System_Ext(idp, "OIDC Identity Provider", "SSO đăng nhập Admin UI")
    System_Ext(fileurl, "File URL Source / CSP", "Nguồn file qua URL + OAuth2 token")
    System_Ext(postgres, "PostgreSQL 16", "Operational store & unified config")
    System_Ext(redis, "Redis", "BullMQ queue + rate limit + sync pub/sub")
    System_Ext(s3, "S3-compatible Storage", "File backend tuỳ chọn (AWS/MinIO/R2)")

    Rel(admin, dugate, "Admin UI, review HITL", "HTTPS/NextAuth+OIDC")
    Rel(dev, dugate, "Gửi tài liệu, poll, resume", "HTTPS/x-api-key")
    Rel(dugate, aihub, "Chat completions (AIHub)", "HTTPS")
    Rel(dugate, ext_ai, "multipart/form-data", "HTTPS")
    Rel(dugate, idp, "OIDC auth code + PKCE", "HTTPS")
    Rel(dugate, fileurl, "Download file_urls", "HTTPS")
    Rel(dugate, postgres, "CRUD qua Drizzle", "TCP/5432")
    Rel(dugate, redis, "Enqueue/dequeue, rate limit", "TCP/6379")
    Rel(dugate, s3, "Put/Get objects", "HTTPS")
```

---

## 6. Container Architecture (C4 Level 2)

```mermaid
C4Container
    title SkillHub — Container Diagram (Document Skills group)

    Person(client, "API Client")
    Person(admin, "Administrator")

    Container_Boundary(stack, "dugate Stack") {
        Container(nextjs, "Next.js Application", "Node.js 20 / Next.js 14 (standalone)", "API routes + Admin UI + Operation polling")
        Container(worker, "BullMQ Worker", "Node.js 20 (worker.js)", "Pipeline + Workflow engine, 2 queue")
        Container(mock, "Mock Service", "Node.js Express", "Mô phỏng External AI (dev/staging), port 3099")
        ContainerDb(pg, "PostgreSQL 16", "postgres:16-alpine", "10 bảng cấu hình + Operation state")
        ContainerDb(redis, "Redis", "redis:8-alpine", "Queue, QueueEvents, rate-limit sorted set")
    }

    Rel(client, nextjs, "POST /api/v2/docs/*", "HTTPS")
    Rel(admin, nextjs, "Dashboard + Bull-Board + HITL", "HTTPS")
    Rel(nextjs, redis, "queue.add() + waitUntilFinished", "TCP:6379")
    Rel(worker, redis, "Consume jobs", "TCP:6379")
    Rel(nextjs, pg, "Drizzle (postgres-js pool)", "TCP:5432")
    Rel(worker, pg, "Read/Write Operation state", "TCP:5432")
    Rel(worker, mock, "HTTP (dev/staging)", "HTTP:3099")
```

| Container | Image | Vai trò |
|-----------|-------|---------|
| **app** | `dugate:latest` | Next.js API + Admin UI. Nhận request, resolve profile, tạo Operation, enqueue, trả `202`. Entrypoint chạy `drizzle-kit push` (nếu `MIGRATION=true`) + seed (nếu `SEED=true`) rồi `node server.js`. |
| **worker** | `dugate:latest` (`command: node worker.js`) | Consumer BullMQ; chạy `runPipeline` hoặc `runWorkflow`. Hai worker: pipeline (`WORKER_CONCURRENCY`) và workflow-steps (`SUBSTEP_WORKER_CONCURRENCY`). |
| **db** | `postgres:16-alpine` | Nguồn sự thật duy nhất. Healthcheck `pg_isready`. |
| **redis** | `redis:8-alpine` | Queue + QueueEvents + rate-limit. Healthcheck `redis-cli ping`. |
| **mock-service** | Custom Express | Mô phỏng External AI cho dev/staging, port 3099. |

App và worker dùng chung image, chỉ khác `command`, và mount chung volume `./uploads`, `./outputs`.

---

## 7. Component Architecture (C4 Level 3)

```mermaid
graph TB
    subgraph "Next.js Container (app)"
        MW["middleware.ts<br/>Strip spoofed headers<br/>NextAuth cho UI · pass-through /api/v*/"]
        subgraph "API Routes"
            V["/api/v2/docs/{skill}<br/>route → runEndpoint()"]
            WF["/api/v2/docs/workflows<br/>process dispatch"]
            OPS["/api/v1/operations/{id}<br/>GET poll · DELETE soft-delete"]
            INT["/api/internal/*<br/>apikeys · ext-connections<br/>profile-endpoints · worker-groups<br/>analytics · queue-monitor…"]
            BB["/api/bull-board<br/>Queue dashboard"]
        end
        subgraph "Endpoint layer (lib/endpoints)"
            REG["registry.ts<br/>SERVICE_REGISTRY + ParamSchema<br/>+ ENDPOINT_ALLOWED_EXTENSIONS"]
            RUN["runner.ts<br/>resolve key · rate-limit · sub-case<br/>· merge params · build pipeline"]
            PR["profile-resolver.ts<br/>loadProfileEndpoint · mergeParameters<br/>· parseConnectionSteps"]
        end
        SUB["pipelines/submit.ts<br/>validate · save files · create Operation<br/>· resolve queue · enqueue / sync-wait"]
    end

    subgraph "Worker Container"
        ENG["pipelines/engine.ts<br/>runPipeline() · checkpoint/resume<br/>· session chaining · webhook"]
        WENG["pipelines/workflow-engine.ts<br/>runWorkflow() · enqueueSubStep<br/>· pauseWorkflow · parseDeep · WORKFLOW_REGISTRY"]
        WFS["pipelines/workflows/*<br/>disbursement · lc-checker · payroll-verify<br/>· structure-compare · brd-analyze"]
        EXT["processors/external-api.ts<br/>Multipart branch + AIHub branch<br/>· prompt/model resolve · SSRF · usage/cost"]
    end

    subgraph "Shared libs"
        DB["db/index.ts + schema.ts<br/>Drizzle (postgres-js)"]
        Q["queue/*<br/>pipeline-queue · worker-group-router · redis"]
        STG["storage/*<br/>Local | S3 + MD5 dedup"]
        SEC["crypto · rate-limit · logger · csp-token"]
    end

    MW --> V --> RUN
    MW --> WF --> SUB
    MW --> OPS --> DB
    RUN --> REG
    RUN --> PR
    RUN --> SUB
    SUB --> Q
    Q -->|queue: pipeline| ENG
    Q -->|queue: pipeline| WENG
    WENG --> WFS
    WENG -->|queue: workflow-steps| EXT
    ENG --> EXT
    ENG --> DB
    WENG --> DB
    EXT --> STG
    SUB --> STG
    RUN --> SEC
```

### 7.1 Danh mục connector (ExternalApiConnection slug)

Connector là bản ghi cấu hình trong DB (`ExternalApiConnection`), được registry và workflow tham chiếu theo `slug`. Registry chỉ khai báo *thứ tự* connector cho mỗi sub-case; connector thực tế do Admin tạo/sửa.

| Slug | Vai trò | Dùng tại |
|------|---------|----------|
| `ext-data-extractor` | Bóc tách dữ liệu có cấu trúc | extract:*, analyze:fact-check, workflows |
| `ext-classifier` | Phân loại tài liệu | analyze:classify, workflows |
| `ext-doc-layout` | Parse layout / OCR | ingest, transform:convert, workflows |
| `ext-vision-reader` | Vision/OCR (form viết tay) | ingest:digitize |
| `ext-qa-engine` | Hỏi đáp trên tài liệu (RAG-like) | generate:qa |
| `ext-pdf-tools` | Cắt/ghép PDF | transform:split |
| `ext-sentiment` | Phân tích cảm xúc | analyze:sentiment |
| `ext-compliance` | Kiểm tra tuân thủ | analyze:compliance |
| `ext-fact-verifier` | Đối chiếu chéo sự thật | analyze:fact-check, workflows |
| `ext-quality-eval` | Chấm chất lượng / rủi ro | analyze:quality, analyze:risk |
| `ext-content-gen` | Sinh nội dung/báo cáo | generate:*, workflows |
| `ext-translator` | Dịch thuật | transform:translate |
| `ext-rewriter` | Viết lại | transform:rewrite |
| `ext-redactor` | Che PII / template | transform:redact, transform:template |
| `ext-comparator` | So sánh ngữ nghĩa/diff | compare:*, workflows |

---

## 8. Mô hình dữ liệu

Tầng dữ liệu dùng **Drizzle ORM** trên `postgres-js` (`lib/db/index.ts`; pool cache trên `globalThis`, `DB_POOL_MAX` mặc định 10 ở prod / 3 ở dev). Schema định nghĩa trong `lib/db/schema.ts` gồm **10 bảng**. Quan hệ là *logical* (cột khoá dạng text + index), không dùng foreign key ràng buộc ở DB — phù hợp với đặc thù cấu hình linh hoạt của gateway.

| Bảng | Mục đích | Trường chính |
|------|----------|--------------|
| **Operation** | Bản ghi LRO trung tâm | `state`, `done`, `progressPercent/Message`, `pipelineJson`, `currentStep`, `stepsResultJson`, `filesJson`, `outputContent/extractedData`, token/cost (`totalInputTokens`, `totalOutputTokens`, `totalCostUsd`, `usageBreakdown`), `webhookUrl`, `errorCode/Message`, `deletedAt`, `idempotencyKey` (unique) |
| **ApiKey** | Khoá client + profile gốc | `keyHash` (SHA-256, unique), `prefix`, `role`, `workerGroup`, `rateLimitPerMin`, `spendingLimit`, `totalUsed`, `status` |
| **ExternalApiConnection** | Cấu hình connector AI | `slug` (unique), `endpointUrl`, `authType/authKeyHeader/authSecret`, `promptFieldName`, `fileFieldName`, `fileUrlFieldName`, `defaultPrompt`, `staticFormFields`, `extraHeaders`, `responseContentPath`, `sessionIdResponsePath/FieldName`, `timeoutSec`, `state` |
| **ExternalApiOverride** | Override theo (connection, apiKey, endpoint, step) | `promptOverride`, `modelOverride`; unique `(connectionId, apiKeyId, endpointSlug, stepId)` |
| **ProfileEndpoint** | Cấu hình endpoint theo API key | `enabled`, `parameters` (JSON: gồm `_workflowPrompts`/`_workflowModels`, cờ khoá), `connectionsOverride`, `jobPriority`, `fileUrlAuthConfig` (mã hoá), `allowedFileExtensions`; unique `(apiKeyId, endpointSlug)` |
| **WorkerGroup** | Nhóm worker để cách ly tài nguyên | `name` (unique) |
| **AppSetting** | Key-value cấu hình hệ thống | `key` (unique), `value` — AI provider, model, secret mã hoá, cấu hình S3 |
| **FileCache** | Dedup file theo MD5 | `md5Hash` (unique), `s3Key`, `size`, `refCount`, `lastAccessedAt` |
| **User** | Người dùng Admin UI (xác thực qua SSO) | `username` (unique), `role`, `provider`, `providerSub` (unique), `email`, `displayName`. Cột `password` còn tồn tại nhưng **không còn được dùng** — mặc định `''` |
| **UserProfileAssignment** | Gán profile cho user (RBAC) | unique `(userId, apiKeyId)` |

```mermaid
erDiagram
    ApiKey ||--o{ ProfileEndpoint : "cấu hình endpoint"
    ApiKey ||--o{ Operation : "sở hữu"
    ApiKey ||--o{ ExternalApiOverride : "override"
    ApiKey }o--o| WorkerGroup : "route tới"
    ExternalApiConnection ||--o{ ExternalApiOverride : "bị override"
    ProfileEndpoint }o--o{ ExternalApiConnection : "connectionsOverride"
    User ||--o{ UserProfileAssignment : "được gán"
    ApiKey ||--o{ UserProfileAssignment : "profile"
    Operation ||--o{ FileCache : "tham chiếu (MD5)"
```

---

## 9. Kiến trúc Queue & Worker

### 9.1 Hai queue tách biệt

Định nghĩa trong `lib/queue/pipeline-queue.ts`:

- **`pipeline`** — job pipeline top-level và job workflow top-level.
- **`workflow-steps`** — sub-step do workflow fan-out.

Tách hai queue để tránh **deadlock**: một job workflow chiếm slot trên queue `pipeline` trong khi chờ các sub-step; nếu sub-step cũng nằm chung queue và mọi slot đã bị chiếm, hệ thống sẽ treo. Vì vậy sub-step đi queue riêng với pool worker riêng.

Cấu hình job mặc định: `attempts: 3`, backoff exponential 5s, và **retention dùng chung** từ `getQueueRetentionOptions()` (`lib/config.ts`) — xem §9.5.

### 9.5 Job retention & dọn tồn đọng Redis

**Một helper duy nhất**, `getQueueRetentionOptions()` trong `lib/config.ts`, áp qua `defaultJobOptions` tại **cả 3 nơi tạo queue** (`getPipelineQueue`, `getWorkflowStepsQueue`, `worker-group-router.DEFAULT_JOB_OPTIONS`):

| Option | Env | Ý nghĩa |
|---|---|---|
| `removeOnComplete` / `removeOnFail` | `QUEUE_JOB_EXPIRE_MS` (age) + `QUEUE_JOB_MAX_COUNT` (count) | **Cả hai điều kiện đều áp**: job bị xoá khi quá `age` **hoặc** khi vượt `count`. `count` là trần cứng — `age` một mình không chặn được đỉnh burst, vì hàng nghìn job hoàn thành trong vài phút đều còn "trẻ hơn ngưỡng" |
| `keepLogs` | `KEEP_JOB_LOGS` | Số **dòng** log tối đa mỗi job (list `bull:<queue>:<jobId>:logs`) |

> `keepLogs` là **JOB option**, không phải Worker option — `WorkerOptions` của BullMQ 5.x không có field này và `Job.log()` đọc `job.opts.keepLogs`. Đặt ở Worker sẽ bị bỏ qua im lặng.

**Giới hạn cốt lõi: job options bị đóng băng tại thời điểm `add`.** Nên cấu hình trên chỉ áp cho job **mới**. Thêm nữa, BullMQ chỉ trim một queue khi **có job kết thúc trên chính queue đó** → queue của worker group đã ngừng dùng sẽ không bao giờ tự trim. Vì vậy `lib/queue-cleanup.ts` là **thành phần vĩnh viễn**, không phải script one-off.

**Scheduler dọn tồn đọng** — đăng ký ở **`worker.ts` module scope** (KHÔNG ở `app/layout.tsx`: ở đó scheduler được gọi trong thân function `RootLayout` nên chỉ chạy khi có page được server-render, mà DUGate là API gateway — traffic đi `/api/*`, không qua RootLayout). Mỗi lượt gồm 3 pass:

1. **`queue.clean()`** — xoá job terminal (`completed` + `failed`) cũ hơn `QUEUE_JOB_EXPIRE_MS`, theo lô `QUEUE_CLEANUP_BATCH_SIZE` (300) với nghỉ `QUEUE_CLEANUP_BATCH_DELAY_MS` (1000ms) giữa các lô. Lô nhỏ là bắt buộc: `clean()` là **Lua script chạy atomic** nên block Redis single-thread, và gateway block theo.
2. **Retro-trim log** (`QUEUE_LOG_TRIM_ENABLED`) — với job **còn trong ngưỡng tuổi**, gọi `Job.clearLogs(KEEP_JOB_LOGS)` để `LTRIM` list `:logs` về 100 dòng cuối **mà KHÔNG xoá job**. Cần thiết vì `keepLogs` đóng băng lúc `add`: job đã nằm trong Redis từ trước có log không giới hạn, mà `clean()` chỉ giúp khi job đủ tuổi để xoá. Giữ 100 dòng cuối để Bull Board còn triage được — khác hẳn `UNLINK` xoá trắng. Bounded bởi `QUEUE_LOG_TRIM_MAX_JOBS`.
3. **Báo cáo** — log **số đo** theo queue/type (không bao giờ log mảng jobId mà `clean()` trả về: một lô 300 ID là ~11KB text).

**Enumerate queue = (DB `WorkerGroup`) ∪ (`SCAN 'bull:*:meta'`).** Nửa DB bắt queue đã cấu hình nhưng chưa có key; nửa SCAN bắt **queue mồ côi** — queue còn key trong Redis nhưng group đã bị xoá khỏi DB. Kết quả SCAN được lọc qua allowlist tên queue của hệ thống (Redis có thể dùng chung). Queue chỉ xuất hiện ở nửa SCAN được log riêng ở mức `warn`.

**Chặn nguồn sinh mồ côi:** `evictGroupFromCache()` giờ `obliterate({ force: false })` queue của group bị xoá, **chỉ sau khi** verify `waiting + active + delayed = 0`. Còn job chưa xử lý → KHÔNG obliterate, log cảnh báo kèm số lượng để Ops quyết (có thể là request khách hàng chưa chạy). Không bao giờ dùng `force: true`.

**Nhiều instance:** guard `scheduled` chỉ chống double-schedule trong một tiến trình. Mỗi lượt vì vậy bọc **Redis lock** `SET dugate:queue-cleanup:lock <token> NX PX`, gia hạn ở mỗi ranh giới queue và nhả bằng compare-and-delete. `clean()` vốn idempotent nên lock để tiết kiệm tài nguyên, không phải để bảo đảm tính đúng.

**Ràng buộc an toàn (không được nới):**

| Ràng buộc | Lý do |
|---|---|
| Chỉ `queue.clean()` / `obliterate()`. **Không** `FLUSHALL`, **không** `DEL bull:*` thủ công | Xoá lẻ key để lại entry mồ côi trong sorted set → `getJobCounts` sai lệch, worker có thể crash khi load job không còn tồn tại |
| **Không** tự động xoá job `waiting`/`active` | Có thể là việc thật chưa chạy → mất request khách hàng. Thay vào đó: nếu `waiting > 0` và **không giảm** giữa 2 lượt liên tiếp → log `ERROR` (dấu hiệu queue không có consumer — đây là **bug chức năng**, nghiêm trọng hơn vấn đề dung lượng) |
| `BGSAVE` + `QUEUE_CLEANUP_SCHEDULE_ENABLED=false` ở lần deploy đầu | Lần dọn đầu chạy trên tồn đọng nhiều tháng; xoá **không hồi lại được**. Ops chạy có kiểm soát trong cửa sổ thấp điểm, theo dõi `redis-cli --latency`, rồi mới bật `true` |
| Mỗi lượt cleanup phải `.catch()` tại call-site | Unhandled rejection trong callback `setInterval` có thể làm Node thoát → **worker chết, mọi job dừng** |

Thứ tự triển khai bắt buộc: giảm **kích thước** mỗi job (log hygiene §12.5) **trước** khi nới retention. Làm ngược lại sẽ khiến Redis phình thêm.

### 9.2 Worker process (`worker.ts`)

```mermaid
graph LR
    subgraph "worker.ts (node worker.js)"
        PW["pipelineWorker<br/>concurrency = WORKER_CONCURRENCY (5)"]
        SW["stepsWorker<br/>concurrency = SUBSTEP_WORKER_CONCURRENCY (2×)"]
        MEM["Memory monitor (10s)<br/>pause khi heap >90% · resume khi <76.5%"]
        SD["Graceful shutdown<br/>SIGTERM/SIGINT → close()"]
    end
    PW --> PJ["processJob() → runPipeline | runWorkflow"]
    SW --> PJ
```

- `processJob` chọn engine theo `job.data.type` (`workflow` → `runWorkflow`, còn lại → `runPipeline`).
- `stalledInterval: 30s`, `maxStalledCount: 2`; sau khi hết retry, ghi log DLQ có cấu trúc.
- Memory monitor tạm dừng cả hai worker khi heap vượt `WORKER_MEMORY_THRESHOLD` (0.90) và resume khi hồi về ~76.5% để nhường GC.

### 9.3 Worker group routing & Backpressure

`lib/queue/worker-group-router.ts`:

- `resolveTargetQueue(apiKeyId)` join `ApiKey.workerGroup` với `WorkerGroup`. Có group hợp lệ → route tới `pipeline.<group>` / `workflow-steps.<group>`; ngược lại → queue mặc định.
- `checkBackpressure(queue)` đếm `waiting + delayed`; vượt `MAX_QUEUE_DEPTH` (500) → submit trả `503` kèm `Retry-After`.
- Biến `WORKER_QUEUE` chọn group mà một worker instance sẽ consume (xem ví dụ `worker-group-a` được comment trong `docker-compose.yml`).

### 9.4 Checkpoint / Resume & Sync mode

- **Checkpoint**: `engine.ts` lưu `currentStep`, `stepsResultJson` và `pipeline_state_snapshot` (session token) sau mỗi bước. Khi BullMQ retry, pipeline resume từ `currentStep`, bỏ qua các bước đã thành công → **không gọi lại API tính phí**.
- **Sync mode** (`?sync=true`): `submit.ts` enqueue rồi `job.waitUntilFinished(queueEvents, SYNC_TIMEOUT_MS)` (mặc định 30s) qua Redis pub/sub — worker vẫn xử lý, Next.js không block event loop; sau đó reload Operation.

---

## 10. Mô hình External AI Connector

Lõi gọi AI là `runExternalApiProcessor()` (`lib/pipelines/processors/external-api.ts`) với **hai nhánh**.

### 10.1 Multipart branch (mặc định)

1. **Thử parser nội bộ trước**: nếu là một file XLSX/DOCX → `ParserFactory` parse thành Markdown (không tốn token, `modelUsed = internal:*`). PDF scan → fallback sang External API.
2. Dựng `multipart/form-data`: field prompt (`promptFieldName`) + static fields + files (`fileFieldName`) hoặc `input_content` + forward URL (`fileUrlFieldName`) + inject `session_id`.
3. Auth header theo `authType` (`API_KEY_HEADER` / `BEARER` / `NONE`) + `extraHeaders`.
4. **SSRF guard** `assertSafeUrl` → `fetchWithTimeout` (`timeoutSec`).
5. Trích content theo dot-path `responseContentPath`; capture `session_id`.
6. Đọc token usage đa định dạng: **CAIP** (`total_cost_summary`), **Gemini** (`usageMetadata`), **OpenAI** (`usage`). Cost lấy giá trị provider báo về nếu có, ngược lại tính bằng `calculateCostUsd`.

### 10.2 AIHub branch (OpenAI-compatible JSON)

Kích hoạt **chỉ khi** `extraHeaders` chứa marker `X-Connection-Mode: AIHUB` (`lib/endpoints/aihub-config.ts`, `isAiHubMode`). Khi đó:

- Dựng JSON chat-completion body từ template `defaultPrompt` + static fields (`model`, `system_prompt`, `user_prompt`, `max_tokens`, `temperature`).
- File đính kèm được inject dưới dạng **multimodal `image_url` base64**.
- Gửi `application/json`; trích content mặc định theo path `choices.0.message.content`; strip markdown code fence.

Connector không có marker luôn round-trip như multipart, bảo đảm tương thích ngược.

### 10.3 Override prompt & model — 3 tầng

Cả prompt và model đều theo cùng thứ tự ưu tiên (`lib/pipelines/processors/prompt-resolver.ts`):

```mermaid
graph LR
    subgraph "Prompt (resolvePrompt)"
        P1["code _prompt<br/>(workflow inject)"] --> P2["ExternalApiOverride.promptOverride<br/>(Profile UI)"] --> P3["connection.defaultPrompt"]
    end
    subgraph "Model (resolveModel)"
        M1["code/workflow _model"] --> M2["ExternalApiOverride.modelOverride<br/>/ _workflowModels"] --> M3["'model' trong staticFormFields"]
    end
```

Prompt hỗ trợ nội suy `{{variable}}`. Model override được `applyModelOverride` ghi vào field `model` của static fields (multipart) hoặc placeholder `{{model}}` (AIHub). Workflow nạp `_workflowPrompts` / `_workflowModels` từ `ProfileEndpoint.parameters` trong `createWorkflowContext`, đồng thời merge các param Profile (ví dụ credentials CSP) vào `pipelineVars` — Admin luôn thắng.

### 10.4 Session chaining

Connector có thể **capture** `session_id` từ response (`sessionIdResponsePath`) và **inject** vào request bước sau (`sessionIdFieldName`). Override mức endpoint (`captureSession`/`injectSession` trên từng step) ưu tiên hơn cấu hình mức connector. State chia sẻ qua `pipelineState` trong một lần chạy pipeline.

### 10.5 Business skill (workflow)

| Workflow | Mô tả |
|----------|-------|
| `disbursement` | Đối chiếu giải ngân: tách file → bóc tách song song → đối chiếu chéo → tờ trình |
| `lc-checker` | Kiểm tra bộ chứng từ LC theo UCP 600 / ISBP 821: OCR full-text → compliance (hybrid OCR + PDF gốc) → báo cáo |
| `payroll-verify` | Đối chiếu bảng lương PDF vs Excel: OCR → extract → compare rule-based → APPROVED / REVIEW_REQUIRED |
| `structure-compare` | So sánh theo cấu trúc ánh xạ: trích cấu trúc → ghép cặp mục → xác nhận → so sánh từng cặp |
| `brd-analyze` | Chấm điểm BRD theo scorecard (Business Value 0.6 / Technical Effort 0.3 / Reusability 0.1 + bonus) |

---

## 11. Sequence Diagrams

### 11.1 Pipeline async (LRO)

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant MW as middleware
    participant Runner as runner.ts
    participant Submit as submit.ts
    participant Redis as Redis (BullMQ)
    participant Worker as engine.ts
    participant AI as External AI
    participant DB as PostgreSQL

    Client->>MW: POST /api/v2/docs/extract (x-api-key, files)
    MW->>MW: strip header giả mạo, pass-through
    MW->>Runner: forward
    Runner->>DB: resolve ApiKey (SHA-256 keyHash)
    Runner->>Runner: rate-limit · sub-case · merge params · build pipeline
    Runner->>Submit: submitPipelineJob(...)
    Submit->>DB: validate connector · idempotency · spending limit
    Submit->>DB: INSERT Operation {state: RUNNING}
    Submit->>Redis: resolveTargetQueue + checkBackpressure → queue.add(priority)
    Submit-->>Client: 202 + Operation-Location

    Redis->>Worker: dequeue
    Worker->>DB: load Operation, resolve files (S3→temp / local / URL)
    loop mỗi step (resume từ currentStep)
        Worker->>DB: UPDATE currentStep, progress
        Worker->>AI: multipart | AIHub JSON (prompt + files)
        AI-->>Worker: response
        Worker->>Worker: parseDeep · usage/cost · capture session
        Worker->>DB: UPDATE stepsResultJson (checkpoint)
    end
    Worker->>DB: UPDATE state=SUCCEEDED, output, usage; ApiKey.totalUsed += cost
    opt webhook
        Worker->>Client: POST webhook (3 retries, SSRF-checked)
    end

    Client->>Runner: GET /api/v1/operations/{id}
    Runner->>DB: SELECT Operation
    Runner-->>Client: {done, state, result|error, usage}
```

### 11.2 Workflow HITL (pause/resume)

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant App
    participant Redis
    participant W as workflow-engine
    participant Steps as workflow-steps queue
    participant AI as External AI
    participant DB
    participant Human as Human Reviewer

    Client->>App: POST /api/v2/docs/workflows {process, files}
    App->>DB: INSERT Operation {RUNNING}
    App->>Redis: queue.add (type=workflow)
    App-->>Client: 202 + Operation-Location

    Redis->>W: dequeue → WORKFLOW_REGISTRY[name]
    W->>Steps: enqueueSubStep × N (classify/extract song song)
    Steps->>AI: multipart / AIHub
    AI-->>Steps: results
    Steps-->>W: sub-op done (hybrid: event + DB poll)
    W->>DB: pauseWorkflow → state=WAITING_USER_INPUT (checkpoint)

    Note over Human,DB: Human review / chỉnh sửa dữ liệu trong UI
    Human->>App: POST /operations/{id}/resume {edited data}
    App->>DB: UPDATE checkpoint, state=RUNNING
    App->>Redis: re-enqueue (resume)
    Redis->>W: dequeue
    W->>Steps: enqueueSubStep (crosscheck → report)
    Steps->>AI: ...
    AI-->>W: results
    W->>DB: completeWorkflow → state=SUCCEEDED (+ webhook, CSP OAuth2 token)
```

### 11.3 Auth & Param resolution

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant MW as middleware.ts
    participant Runner as runner.ts
    participant PR as profile-resolver
    participant DB

    Client->>MW: POST /api/v2/docs/* (x-api-key hoặc NextAuth cookie)
    MW->>MW: xoá x-api-key-id / x-user-* (chống spoof)
    MW->>MW: nếu có NextAuth token → set x-user-id/role
    MW->>Runner: pass-through
    Runner->>DB: SHA-256(x-api-key) → ApiKey
    Runner->>Runner: enforceRateLimit (per-profile hoặc IP)
    Runner->>PR: loadProfileEndpoint(apiKeyId, endpointSlug)
    alt key có nhưng không có ProfileEndpoint
        Runner-->>Client: 403 Endpoint Not Configured
    end
    Runner->>PR: mergeParameters (locked field → 400)
    PR-->>Runner: mergedVars
    Runner->>PR: parseConnectionSteps (override > default)
    Runner-->>Client: 202 / 200 (sync | idempotent)
```

---

## 12. Kiến trúc bảo mật

### 12.1 Ma trận xác thực (`middleware.ts` + `lib/auth.ts` + `lib/auth-guard.ts`)

| Pattern | Auth | Cơ chế |
|---------|------|--------|
| `/api/v1/*`, `/api/v2/*` | API Key (hoặc NextAuth session cho browser) | Middleware strip header giả mạo, pass-through; **runner** resolve `x-api-key` → SHA-256 → `ApiKey` |
| `/api/internal/*` | Bypass middleware (gọi nội bộ) — route tự bảo vệ bằng `requireAuth`/`requireAdmin` | NextAuth session + RBAC |
| `/api/auth/*` | NextAuth (**chỉ OIDC**) | OAuth2 + PKCE; trả `503` nếu thiếu cấu hình OIDC |
| `/api/health` | Public (bypass) | — |
| `/*` (pages) | NextAuth JWT | Cookie; `401` cho API, redirect `/login` cho page |

- **Chống spoofing**: middleware xoá `x-api-key-id`, `x-user-id`, `x-user-role` từ request bên ngoài; chỉ tự set lại từ NextAuth token đã verify.
- **SSO-only** (`lib/auth.ts`): không còn đăng nhập username/password. OIDC là provider duy nhất. **Không có công tắc bật/tắt** — provider được dựng khi có đủ `OIDC_ISSUER` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET`, vì một cờ có thể tắt phương thức đăng nhập duy nhất là thiết kế chỉ gây hại. Thiếu cấu hình thì `/login` hiện thông báo lỗi và `/api/auth/*` trả `503` kèm tên biến thiếu trong log.
- **Pre-provisioning, KHÔNG JIT**: identity SSO chưa được ADMIN tạo trước tại `/settings/users` thì bị **từ chối** đăng nhập (yêu cầu SEC/audit — directory của tổ chức không được tự động có quyền vào UI vận hành). Người dùng thấy `/login?error=AccessDenied`.
- **Account linking**: khớp theo `providerSub`, rồi `email`, rồi `username`. Cả hai nhánh email và username chỉ link khi `providerSub` còn null để tránh account takeover (cột `email` không unique).
- **Role lấy từ bảng `User`**, không lấy từ claim của IDP; callback `jwt` đọc lại role từ DB mỗi lần resolve session.
- **`callbackUrl`**: dùng mặc định của NextAuth (giới hạn theo origin của `NEXTAUTH_URL`) — không override `redirect` nữa.

### 12.2 RBAC (`lib/auth-guard.ts`)

Chỉ còn hai role. `USER` là tên cũ đã nghỉ, `seed.ts` tự migrate `USER → OPS` khi chạy.

| Role | Quyền |
|------|-------|
| **ADMIN** | Full access; `getAssignedProfileIds()` trả `null` (không lọc) |
| **OPS** | Chỉ thao tác trên profile được gán (`UserProfileAssignment`); `requireProfileAccess` kiểm tra assignment. Quyền chi tiết do ADMIN cấu hình qua `RolePermission` |

### 12.3 Bảo mật prompt & tham số

| Rủi ro | Biện pháp |
|--------|-----------|
| Client ghi đè tham số hệ thống | `defaultLocked`/`isLocked` → `mergeParameters` trả `400 Forbidden Field` |
| Client bypass prompt/model của profile | Override lưu ở server (`ExternalApiOverride` / `_workflowPrompts` / `_workflowModels`); client không truyền được |
| Rò rỉ prompt qua log | cURL log chỉ tái dựng metadata và hạ xuống `DEBUG`; prompt chỉ log **độ dài**; mọi dòng log đi qua lớp sanitize tập trung (§12.5) |

### 12.4 Secrets & Network

| Secret | Lưu trữ | Ghi chú |
|--------|---------|---------|
| `NEXTAUTH_SECRET` | ENV / K8s Secret | JWT signing |
| `ENCRYPTION_KEY` | ENV / K8s Secret | AES-256-GCM cho AppSetting + `fileUrlAuthConfig` |
| AI API key (`authSecret`) | DB (mã hoá) | Quản lý qua Admin UI, không cần deploy |
| `x-api-key` (client) | Client quản lý | Lưu DB dưới dạng SHA-256 `keyHash` |
| CSP OAuth2 | Profile params (mã hoá) | Tự fetch token cho webhook callback (`lib/csp-token.ts`) |

- **SSRF protection**: `assertSafeUrl` (`processors/http-client.ts`) áp dụng cho mọi URL external **và** webhook + file URL download.
- **An toàn upload**: giới hạn kích thước, từ chối file macro (`lib/upload.ts`), chống path traversal, `allowedFileExtensions` theo thứ tự Profile → registry → global default.

### 12.5 Log hygiene (`lib/log-sanitize.ts` + `lib/logger.ts`)

Mọi dòng log đi qua **một** điểm kiểm soát duy nhất là `Logger.write()`, không phải sửa từng call-site. Hai lớp **độc lập**:

| Lớp | Phạm vi | Chính sách |
|---|---|---|
| **SECRET** | api_key, authorization, bearer, token, secret, password, client_secret, `authSecret`, `vaultSecretPath`, `keyHash`, credential trong URL authority (`redis://user:pass@host`) | **LUÔN ẩn** — mọi level, mọi mode, mọi sink, kể cả `error`, `logger.raw()` và `job.log()`. Không có ngoại lệ |
| **CONTENT** | prompt, document text, response body, `jsonBody`, base64 data URL, curl body | Ẩn/cắt ở mode `redacted`; giữ nguyên ở mode `raw` |

**Mode CONTENT không do call-site quyết định, mà suy ra theo SINK:**

| Sink | Đi đâu | Có rotation | Mode |
|---|---|---|---|
| stdout | Docker / CloudWatch | Có (bên ngoài) | `logger.raw()` **>** `LOG_REDACT_MODE=raw` **>** level `ERROR` = full CONTENT **>** còn lại = `redacted` |
| `job.log()` | BullMQ list `bull:<queue>:<jobId>:logs` (Redis RAM) | **Không** — chỉ mất khi job bị xoá | **LUÔN `redacted`** + trần cứng cả dòng `LOG_JOBLOG_HARD_CAP` |

Tách theo sink là điểm quan trọng nhất. "Show full content ở level error" chỉ áp cho **stdout**. Nếu áp cả cho `job.log()` thì job failed — loại phát nhiều `logger.error()` nhất và được giữ lâu nhất theo `removeOnFail.age` — sẽ ghi full content vào Redis. Nội dung đầy đủ của job failed vẫn còn ở **hai** nơi khác: stdout, và Postgres (`Operation.extractedData` / `stepsResultJson` / `progressLogJson`). Bull Board là công cụ **triage**, không phải nguồn sự thật.

**Truncation áp cho cả `message`, không chỉ giá trị trong `meta`** — nguồn phình thực tế là template string (`logger.info(\`… ${result.content}\`)`), mà luật theo KEY không bắt được. Hai ngưỡng tách riêng: `meta` = `LOG_MAX_STRING_LEN` (500), `message` = `LOG_MAX_MESSAGE_LEN` (2000, nới hơn vì đây là văn bản chẩn đoán do người viết).

**Giữ nguyên định danh truy vết:** `correlationId`, `operationId`, `apiKeyId`, `jobId`/`jobName`, queue name, `errorCode` không bao giờ bị cắt hay redact — kể cả `apiKeyId`, dù tên khớp pattern SECRET. Key mô tả **số đo** của content (`contentLength`, `outputChars`, `bodyBytes`, `contentType`) cũng không bị coi là CONTENT: đó chính là các dòng log cần giữ.

**Hàm sanitize KHÔNG BAO GIỜ throw.** `Logger.write()` được gọi khắp nơi, kể cả **bên trong catch block**; nếu sanitize throw (vòng tham chiếu, getter throw, BigInt, Symbol, Proxy) thì nó che mất lỗi gốc và có thể sập worker. Mọi entry point của `lib/log-sanitize.ts` bọc `try/catch` và **fail về placeholder** (`<SANITIZE_ERROR>` / `<UNREADABLE>` / `<CIRCULAR>`), **không fail về giá trị gốc chưa lọc**. `Logger` bọc thêm một lớp nữa (defence in depth).

**Khi cần điều tra sâu:** `logger.raw().info(...)` cho một call-site, hoặc `LOG_REDACT_MODE=raw` tạm thời cho toàn cục. Cả hai chỉ mở CONTENT trên stdout — SECRET vẫn ẩn, `job.log()` vẫn bị cắt. `worker.ts` dùng chính `.raw()` cho system log (chỉ chứa metadata vận hành).

**Hai trần độc lập, cần cả hai:** `KEEP_JOB_LOGS` (BullMQ `keepLogs`) chặn **số dòng** mỗi job; `LOG_JOBLOG_HARD_CAP` chặn **độ dài** mỗi dòng. Một mình không cái nào chặn được `dòng × byte`.

**Ngoại lệ có kiểm soát: prompt/output của LLM trên Bull Board (`LOG_JOB_LLM_IO`).** Để tra lỗi ngay trên job, `Logger.jobLlmIo()` ghi **toàn văn prompt và output** của mỗi lời gọi connector (nhánh AIHub và multipart) vào `job.log()`, thành hai dòng `PROMPT →` và `OUTPUT ←`. Chỉ khi `LOG_JOB_LLM_IO=true` (**mặc định tắt**) và logger có job gắn kèm. Vì prompt chứa dữ liệu khách hàng và list `:logs` không xoay vòng nên chỉ bật ở môi trường test/điều tra. Vẫn che SECRET (api key, bearer, token, mật khẩu, credential trong URL) và **không bao giờ ghi base64 của file** (cả `data:...;base64,` lẫn chuỗi base64 thô ≥ 200 ký tự đều bị thay bằng độ dài; chỉ log `userMessage`/`content`, không log `jsonBody` nơi file được nhúng); dùng trần riêng `LOG_JOB_LLM_IO_CAP` (mặc định 60.000 ký tự/dòng) thay cho `LOG_JOBLOG_HARD_CAP`; không ghi ra stdout; log thường vẫn bị cắt như cũ. `KEEP_JOB_LOGS` vẫn chặn số dòng, nên nhớ mỗi lời gọi tốn 2 dòng.

Env: xem §14.4 và `.env.example`.

---

## 13. Storage, Chi phí & Rate limit

### 13.1 Storage (`lib/storage/*`)

- **Factory** trả `S3StorageBackend` khi có AppSetting `s3_bucket`, ngược lại `LocalStorageBackend` (singleton, reset khi settings đổi).
- **Dedup** (`dedup.ts`): upsert theo `md5Hash` với `onConflictDoUpdate` để tăng `refCount`; bản upload trùng bị xoá; xử lý an toàn race condition (`23505`).
- Worker resolve file theo backend: S3 → tải về temp (`os.tmpdir()/dugate/{opId}`, song song tối đa 5), local → dùng trực tiếp, remote URL → forward tới connector.
- **File URL download**: tham số `file_urls` (JSON array) với auth per-profile, SSRF guard, timeout (`FILE_URL_DOWNLOAD_TIMEOUT_MS` mặc định 120s); ở async mode việc tải được defer sang worker.
- **Cleanup** (`lib/cleanup-scheduler.ts`): chạy sau 10s khi khởi động rồi lặp mỗi 6h — xoá file và cache hết hạn.

### 13.2 Cost tracking (`lib/config.ts`)

- `MODEL_PRICING` (USD / 1M token) cho Gemini (gồm `gemini-3.5-flash`) và OpenAI; `calculateCostUsd` chuẩn hoá prefix `ext:` / `internal:`, trả 0 nếu model không có trong bảng.
- Cost cộng dồn vào `Operation` (`totalCostUsd`, `usageBreakdown`) và `ApiKey.totalUsed`; vượt `spendingLimit` → submit trả `402`.

### 13.3 Rate limit (`lib/rate-limit.ts`)

- Sliding-window bằng Redis sorted set; **fail-open** khi Redis lỗi.
- Chạy ở **runner** (Node runtime) thay vì middleware, vì middleware Next 14 chạy trên Edge còn ioredis cần Node.
- Thứ tự key: ApiKey đã resolve (per-profile `rateLimitPerMin`) > raw `x-api-key` hash > user > IP.
- Mặc định: `RATE_LIMIT_API_KEY` 100/phút, `RATE_LIMIT_IP` 30/phút.

---

## 14. Kiến trúc triển khai

### 14.1 Docker image (`Dockerfile`)

Multi-stage trên `node:20-slim` (pull qua proxy registry nội bộ):

1. **deps** — `npm install`.
2. **builder** — `next build` (standalone) + esbuild bundle `worker.ts` → `worker.js` và `lib/db/seed.ts` → `dist/seed.js`; `npm prune --production` (giữ `typescript` cho drizzle-kit runtime).
3. **runner** — copy standalone + `worker.js` + `drizzle.config.ts` + `lib/db/schema.ts`; expose `2023`; entrypoint `docker-entrypoint.sh`.

### 14.2 Entrypoint (`docker-entrypoint.sh`)

```
MIGRATION=true  → yes | npx drizzle-kit push --force   (đồng bộ schema, idempotent)
SEED=true       → node dist/seed.js  (fallback: npx tsx lib/db/seed.ts)
                → exec node server.js
```

### 14.3 Compose stack (`docker-compose.yml`)

```mermaid
graph TB
    CLIENT[Client] -->|:2023| APP
    ADMIN[Admin] -->|:2023| APP
    subgraph "dugate network"
        APP["app (Next.js)<br/>node server.js"]
        WORKER["worker<br/>node worker.js"]
        DB["db · postgres:16-alpine"]
        REDIS["redis · redis:8-alpine"]
        MOCK["mock-service · :3099"]
    end
    APP -->|5432| DB
    APP -->|6379| REDIS
    WORKER -->|5432| DB
    WORKER -->|6379| REDIS
    WORKER -.dev.-> MOCK
    DB --- V1[("pgdata volume")]
    APP --- V2[("./uploads")]
    APP --- V3[("./outputs")]
    WORKER --- V2
    WORKER --- V3
```

- app & worker phụ thuộc `db` + `redis` healthy; dùng chung image `dugate:latest`, worker override `command: node worker.js`.
- Có thể nhân bản worker theo group qua `WORKER_QUEUE` (ví dụ `worker-group-a` được comment sẵn trong compose).
- Deploy VPS thủ công: `deploy/deploy.sh` (`git pull` → `npm ci` → `drizzle-kit migrate` → `next build` → PM2).

### 14.4 Biến môi trường chính

| Nhóm | Biến |
|------|------|
| Core | `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`, `REDIS_URL` |
| Worker | `WORKER_CONCURRENCY` (5), `SUBSTEP_WORKER_CONCURRENCY` (2×), `WORKER_QUEUE`, `WORKER_MEMORY_THRESHOLD` (0.90), `MAX_QUEUE_DEPTH` (500), `SYNC_TIMEOUT_MS` (30000) |
| Storage/File | `UPLOAD_DIR`, `OUTPUT_DIR`, `MAX_TOTAL_UPLOAD_SIZE` (1GB), `FILE_URL_DOWNLOAD_TIMEOUT_MS` (120000) |
| Rate limit | `RATE_LIMIT_API_KEY` (100), `RATE_LIMIT_IP` (30) |
| Queue retention (§9.5) | `QUEUE_JOB_EXPIRE_MS` (604800000), `QUEUE_JOB_MAX_COUNT` (1000), `KEEP_JOB_LOGS` (100) |
| Queue cleanup (§9.5) | `QUEUE_CLEANUP_SCHEDULE_ENABLED` (true — **deploy đầu đặt `false`**), `QUEUE_CLEANUP_BATCH_SIZE` (300), `QUEUE_CLEANUP_BATCH_DELAY_MS` (1000), `QUEUE_LOG_TRIM_ENABLED` (true), `QUEUE_LOG_TRIM_MAX_JOBS` (2000) |
| Log hygiene (§12.5) | `LOG_LEVEL` (INFO), `LOG_FORMAT`, `LOG_REDACT_MODE` (redacted), `LOG_MAX_STRING_LEN` (500), `LOG_MAX_MESSAGE_LEN` (2000), `LOG_SANITIZE_MAX_DEPTH` (4), `LOG_RAW_HARD_CAP` (100000), `LOG_JOBLOG_HARD_CAP` (2000) |
| Ops | `MIGRATION`, `SEED`, `SEED_ADMIN_KEY` (API key máy-máy), `SEED_ADMIN_EMAILS` (ADMIN khởi tạo khi DB trắng), `MOCK_SERVICE_URL`, `DISABLE_HISTORY` |
| OIDC (**bắt buộc**, không có cờ bật/tắt) | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` |

---

## 15. Yêu cầu phi chức năng (NFR)

| NFR | Mục tiêu | Hiện thực |
|-----|----------|-----------|
| **Availability** | Zero-downtime deploy | app/worker stateless, nhiều replica; rate-limit fail-open |
| **Latency (gateway)** | Trả `202` tức thì | Không block; sync mode qua Redis pub/sub |
| **Throughput** | Scale ngang | Nhiều worker + `WORKER_CONCURRENCY`; cách ly theo worker group |
| **Backpressure** | Bảo vệ khi tải cao | `MAX_QUEUE_DEPTH` → `503 Retry-After` |
| **Kích thước file** | Cấu hình | 100MB/file (`MAX_FILE_SIZE_BYTES`), tổng 1GB (`MAX_TOTAL_UPLOAD_SIZE`) |
| **Sub-step timeout** | Không false-timeout | `connector.timeoutSec + 30s` overhead |
| **Độ tin cậy job** | Retry an toàn | `attempts:3` + backoff; checkpoint/resume tránh gọi lại API tính phí; giữ DLQ |
| **Stalled recovery** | Tự phát hiện | `stalledInterval 30s`, `maxStalledCount 2` |
| **Data retention** | Dọn định kỳ | Cleanup mỗi 6h (file + cache hết hạn); queue backlog scan mỗi 24h trong `worker.ts` (§9.5) |
| **Observability** | Truy vết đầy đủ | Structured JSON log (correlationId/operationId), Bull-Board, cURL reconstruction (DEBUG) |
| **Log/Redis bounded** | Log không phình theo kích thước input | Sanitize tập trung theo sink (§12.5): `LOG_MAX_MESSAGE_LEN`/`LOG_MAX_STRING_LEN` chặn độ dài, `KEEP_JOB_LOGS` chặn số dòng, `LOG_JOBLOG_HARD_CAP` chặn mỗi dòng vào Redis |
| **HITL SLA** | Chờ vô thời hạn | `WAITING_USER_INPUT` lưu bền ở DB |
| **Idempotency** | Không nhân bản job | `Operation.idempotencyKey` unique + xử lý race `23505` |

---

## 16. Ma trận lựa chọn công nghệ

| Lớp | Công nghệ | Lý do |
|-----|-----------|-------|
| Runtime | Node.js 20 LTS | Hệ sinh thái Next.js, async I/O |
| Framework | Next.js 14 (App Router) | API routes + Admin UI cùng codebase, standalone build |
| Database | PostgreSQL 16 | ACID, JSON, index |
| ORM | **Drizzle ORM** (`postgres-js`) | Type-safe thuần TS, không binary engine → bundle worker gọn; schema sync `drizzle-kit push` |
| Job Queue | BullMQ + Redis | Priority, retry, backoff, dashboard; QueueEvents cho sync mode |
| Auth | NextAuth v4 — **chỉ OIDC** | Native Next.js, JWT stateless, SSO là đường vào duy nhất; xác thực do IDP tổ chức đảm nhiệm, ứng dụng không lưu credential |
| Encryption | AES-256-GCM (native crypto) | Zero-dep cho secret tại rest |
| AI Integration | HTTP multipart + AIHub JSON (OpenAI-compatible) | Provider-agnostic, không khoá SDK |
| Storage | Local hoặc S3-compatible (AWS/MinIO/R2) + MD5 dedup | Linh hoạt hạ tầng |
| Container | Docker multi-stage | Image gọn; app/worker dùng chung image |
| Worker runtime | esbuild bundle (`worker.js`) | Không cần tsx ở runtime production |

---

## 17. Document Control

| Trường | Giá trị |
|--------|---------|
| **Product** | SkillHub — Common AI Skills Platform (toàn ngân hàng) |
| **Codename / Repo** | `dugate` — Document Skills group |
| **Document ID** | SA-SkillHub-2026-004 |
| **Classification** | INTERNAL |
| **Status** | DRAFT — phản ánh trạng thái codebase hiện tại |
| **Ngày cập nhật** | 2026-07-01 |

> Tài liệu mô tả **trạng thái hiện tại của codebase**, không lưu lịch sử thay đổi kiến trúc.

---

*SkillHub — Nền tảng common AI skill dùng chung cho toàn ngân hàng. Document Skills (`dugate`) là nhóm đầu tiên.*
