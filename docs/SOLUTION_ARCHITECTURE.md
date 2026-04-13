# AISkillHub — Solution Architecture Document

> **Document ID**: SA-AISkillHub-2026-002
> **Version**: 2.1
> **Classification**: INTERNAL — FOR APPROVAL
> **Author**: Solution Architecture Team
> **Date**: 2026-04-13
> **Status**: APPROVED

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Context & Problem Statement](#2-business-context--problem-statement)
3. [Solution Overview](#3-solution-overview)
4. [Architecture Principles](#4-architecture-principles)
5. [System Context (C4 Level 1)](#5-system-context-c4-level-1)
6. [Container Architecture (C4 Level 2)](#6-container-architecture-c4-level-2)
7. [Component Architecture (C4 Level 3)](#7-component-architecture-c4-level-3)
8. [Sequence Diagrams](#8-sequence-diagrams)
9. [Deployment Architecture — Docker & Kubernetes](#9-deployment-architecture--docker--kubernetes)
10. [Security Architecture](#10-security-architecture)
11. [Non-Functional Requirements (NFR)](#11-non-functional-requirements-nfr)
12. [Technology Stack Decision Matrix](#12-technology-stack-decision-matrix)
13. [Approval Sign-off](#13-approval-sign-off)

---

## 1. Executive Summary

**AISkillHub** (Document Understanding API Gateway) là giải pháp kiến trúc cổng trung gian API nội bộ, chuyên xử lý các bài toán **Phân tích Tài liệu** (Document Understanding) cho môi trường doanh nghiệp — đặc biệt phù hợp với ngành Tài chính & Ngân hàng.

Thay vì mỗi nghiệp vụ tự tích hợp riêng lẻ đến hàng chục dịch vụ AI, AISkillHub **quy chuẩn hóa** toàn bộ lớp truy cập thành **6 API Endpoint + Workflow API**, vận hành trên kiến trúc **BullMQ Async Worker** với khả năng **Human-in-the-Loop (HITL)** và **Code-Driven Workflow Orchestration**, đảm bảo:

- **Zero-coupling** giữa ứng dụng nghiệp vụ và AI backend
- **Multi-tenant isolation** qua API Key + Profile-based routing + 3-tier Prompt Override
- **Human-in-the-Loop**: Tạm dừng pipeline để con người duyệt, chỉnh sửa, rồi resume
- **Audit-grade traceability** với structured logging & cURL reconstruction
- **Enterprise-grade deployment** trên Docker & Kubernetes với BullMQ job dashboard

### Thay đổi chính từ v2.0 → v2.1

| # | Thay đổi | Mô tả |
|---|---------|-------|
| 1 | **BullMQ Worker** | Tách Worker thành container độc lập; pipeline jobs chạy qua Redis queue thay vì fire-and-forget trong Next.js process |
| 2 | **Workflow Engine** | Bổ sung `workflow-engine.ts` — lớp orchestration code-driven song song với Standard Pipeline Engine |
| 3 | **HITL Pause/Resume** | Workflow có thể tạm dừng (`WAITING_USER_INPUT`), nhận dữ liệu chỉnh sửa từ con người, rồi tiếp tục từ đúng checkpoint |
| 4 | **3-tier Prompt System** | Code Prompt > Profile Override (UI) > DB Connector Default — được resolve qua `_workflowPrompts` param |
| 5 | **Mock Service Container** | Container `mock-service` phục vụ dev/staging mô phỏng External AI connectors |
| 6 | **parseDeep Utility** | Shared utility xử lý nested JSON từ AI response, export từ `workflow-engine.ts` |

---

## 2. Business Context & Problem Statement

Trong bối cảnh chuyển đổi số, nhu cầu xử lý tài liệu bằng AI (OCR, trích xuất, phân loại, đối soát, v.v.) ngày càng tăng nhanh trên nhiều đơn vị nghiệp vụ. Các mô hình LLM được cung cấp tập trung qua **LLMs Hub** nội bộ. Tuy nhiên, cần **quy hoạch lại** thành một lớp cổng trung gian chuẩn hóa:

| # | Vấn đề | Ảnh hưởng |
|---|--------|-----------|
| P1 | Mỗi app tự tích hợp riêng lẻ → N×M integrations | Chi phí bảo trì tăng tuyến tính |
| P2 | Không kiểm soát prompt/model tập trung | Rủi ro prompt injection, output inconsistency |
| P3 | Không có audit trail trên API gọi AI | Vi phạm compliance nội bộ |
| P4 | Không có spending limit per-team | Token usage vượt tầm kiểm soát |
| P5 | Thiếu cơ chế pipeline chain | Không thể ghép nối OCR → Extract → Validate |
| P6 | Thiếu cơ chế Human Review | Không thể dừng workflow để con người phê duyệt trước khi tiếp tục |

```mermaid
graph LR
    A1[App Nghiệp vụ A] -->|x-api-key| GW[🏗️ AISkillHub Gateway]
    A2[App Nghiệp vụ B] -->|x-api-key| GW
    A3[App Nghiệp vụ C] -->|x-api-key| GW
    GW -->|Profile routing| HUB[🔗 LLMs Hub]
    GW -->|Profile routing| OCR[OCR Engine]
    GW -->|Profile routing| INT[Internal AI Service]
    HUB --> M1[Gemini]
    HUB --> M2[GPT]
    HUB --> M3[Claude]

    style GW fill:#51cf66,stroke:#333,stroke-width:3px
    style HUB fill:#4dabf7,stroke:#333,stroke-width:2px
```

---

## 3. Solution Overview

### 3.1 Hai loại Pipeline

AISkillHub hỗ trợ **2 loại pipeline** với mục đích khác nhau:

#### A. Standard Pipeline Engine (Data Flow — Cấu hình UI)
Chuỗi connector tuần tự được cấu hình qua Admin UI. Phù hợp cho nghiệp vụ đơn luồng, không cần logic phức tạp.

```
Request → Endpoint Runner → Submit → BullMQ Queue
                                           ↓
                                 Worker: engine.ts
                                    Step 1 → Step 2 → Step N
                                    (chained input_content)
```

#### B. Workflow Engine (Process Orchestration — Code-Driven)
Orchestration logic được viết bằng TypeScript, hỗ trợ song song, HITL, checkpoint. Phù hợp cho nghiệp vụ phức tạp như giải ngân, thẩm định tài sản.

```
Request → /api/v1/workflows → Submit → BullMQ Queue
                                            ↓
                                 Worker: workflow-engine.ts
                                    WORKFLOW_REGISTRY[process]
                                    Step 1 (parallel classify)
                                    Step 2 (parallel extract)
                                    ──→ PAUSE (HITL) ←── Human reviews
                                    Step 3 (crosscheck)
                                    Step 4 (report generation)
                                    ──→ SUCCEEDED
```

### 3.2 Các Endpoint

| # | Endpoint | Kiểu Pipeline | Chức năng |
|---|----------|--------------|-----------|
| 1 | `POST /api/v1/ingest` | Standard | OCR, số hóa, split tài liệu |
| 2 | `POST /api/v1/extract` | Standard | Trích xuất dữ liệu có cấu trúc |
| 3 | `POST /api/v1/analyze` | Standard | Phân loại, fact-check, sentiment |
| 4 | `POST /api/v1/transform` | Standard | Dịch thuật, rewrite, redact PII |
| 5 | `POST /api/v1/generate` | Standard | Tóm tắt, QA, soạn email |
| 6 | `POST /api/v1/compare` | Standard | So sánh ngữ nghĩa / text diff |
| 7 | `POST /api/v1/workflows` | Workflow | Code-driven multi-step flows (HITL) |

### 3.3 Vòng đời Operation (State Machine)

```mermaid
stateDiagram-v2
    [*] --> RUNNING: Submit Job to BullMQ
    RUNNING --> WAITING_USER_INPUT: pauseWorkflow() — HITL
    WAITING_USER_INPUT --> RUNNING: POST /operations/{id}/resume
    RUNNING --> SUCCEEDED: completeWorkflow()
    RUNNING --> FAILED: Error / Timeout
    SUCCEEDED --> [*]
    FAILED --> [*]
```

---

## 4. Architecture Principles

| # | Nguyên tắc | Mô tả |
|---|-----------|------|
| AP-1 | **Gateway Abstraction** | Ứng dụng KHÔNG bao giờ gọi trực tiếp AI backend. AISkillHub là điểm duy nhất. |
| AP-2 | **Unified Parameter Guardrails** | Tham số hệ thống bị khóa (locked params) từ chối khi Client cố ghi đè. |
| AP-3 | **Profile-Driven Isolation** | Mỗi API Key có cấu hình prompt/connector riêng, không ảnh hưởng key khác. |
| AP-4 | **Async-First** | Mọi pipeline bất đồng bộ qua BullMQ. API trả 202 ngay lập tức. |
| AP-5 | **Zero Client Code Change** | Thay đổi AI backend, prompt, connector chỉ cần Admin thao tác — 0 dòng code client. |
| AP-6 | **Defence in Depth** | Tầng auth kép: NextAuth (Admin UI) + API Key (Public API). AES-256-GCM cho secrets. |
| AP-7 | **Checkpoint & Resume** | Worker lưu state sau mỗi step. BullMQ retry sẽ tiếp tục từ đúng bước đã fail. |
| AP-8 | **Human-in-the-Loop** | Workflow có thể pause để con người inspect, chỉnh sửa JSON, rồi resume đúng checkpoint. |

---

## 5. System Context (C4 Level 1)

```mermaid
C4Context
    title AISkillHub — System Context Diagram (v2.1)

    Person(admin, "Administrator", "Quản trị Gateway, Profile, Connector, HITL Review")
    Person(dev, "Developer / App Client", "Tích hợp API qua x-api-key")

    System(AISkillHub, "AISkillHub Gateway", "Document Understanding API Gateway — 6 Endpoints + Workflow API + BullMQ Worker")

    System_Ext(llmhub, "LLMs Hub", "Cổng trung gian LLM nội bộ — proxy đến Gemini, GPT, Claude")
    System_Ext(ocr_engine, "OCR Engine", "Dịch vụ nhận dạng ký tự quang học")
    System_Ext(internal_ai, "Internal AI Service", "Mô hình AI on-premise")
    System_Ext(postgres, "PostgreSQL", "Operational data store & Unified Config")
    System_Ext(redis, "Redis", "BullMQ Job Queue & Worker coordination")

    Rel(admin, AISkillHub, "Quản trị qua Admin UI, review HITL", "HTTPS/NextAuth")
    Rel(dev, AISkillHub, "Gửi tài liệu, nhận kết quả, resume HITL", "HTTPS/x-api-key")
    Rel(AISkillHub, llmhub, "Forward request", "HTTPS/API Key")
    Rel(AISkillHub, ocr_engine, "Forward request", "HTTPS/API Key")
    Rel(AISkillHub, internal_ai, "Forward request", "HTTP/mTLS")
    Rel(AISkillHub, postgres, "CRUD Operations, Operation State", "TCP/5432")
    Rel(AISkillHub, redis, "BullMQ job enqueue/dequeue", "TCP/6379")
```

---

## 6. Container Architecture (C4 Level 2)

```mermaid
C4Container
    title AISkillHub — Container Diagram (v2.1)

    Person(client, "API Client")
    Person(admin, "Administrator")

    Container_Boundary(gateway, "AISkillHub Stack") {
        Container(nginx, "Nginx Reverse Proxy", "nginx:alpine", "TLS termination, rate limiting, 300MB upload cap")
        Container(nextjs, "Next.js Application", "Node.js 20 / Next.js 14", "API Routes + Admin UI + Operation management")
        Container(worker, "BullMQ Worker", "Node.js 20 / tsx", "Async job consumer — runs pipeline engine & workflow engine")
        Container(mock, "Mock Service", "Node.js Express", "Simulates External AI connectors — dev/staging only")
        ContainerDb(pg, "PostgreSQL 16", "postgres:16-alpine", "Operations, ApiKeys, Connections, Profiles, Overrides")
        ContainerDb(redis, "Redis 7", "redis:7-alpine", "BullMQ job queue, worker signals")
        Container(volumes, "Persistent Volumes", "Docker Volumes", "uploads/, outputs/, pgdata/")
    }

    Rel(client, nginx, "POST /api/v1/*", "HTTPS")
    Rel(admin, nginx, "Admin Dashboard + HITL Review", "HTTPS")
    Rel(nginx, nextjs, "Proxy pass", "HTTP:2023")
    Rel(nextjs, redis, "BullMQ enqueue job", "TCP:6379")
    Rel(worker, redis, "BullMQ consume job", "TCP:6379")
    Rel(worker, pg, "Read/Write Operation state", "TCP:5432")
    Rel(worker, mock, "HTTP call (dev/staging)", "HTTP:3099")
    Rel(nextjs, pg, "Prisma ORM", "TCP:5432")
    Rel(nextjs, volumes, "Read/Write files", "FS mount")
    Rel(worker, volumes, "Read uploaded files", "FS mount")
```

### 6.1 Vai trò từng container

| Container | Image | Vai trò |
|-----------|-------|---------|
| **app** | `vietbn/AISkillHub:4.0.0` | Next.js API + Admin UI. Nhận request, tạo Operation, enqueue BullMQ job, trả 202. |
| **worker** | `vietbn/AISkillHub:4.0.0` (CMD override) | Consumer BullMQ. Chạy `engine.ts` (Standard) hoặc `workflow-engine.ts` (Workflow). |
| **db** | `postgres:16-alpine` | Lưu trữ toàn bộ state. Nguồn sự thật duy nhất. |
| **redis** | `redis:7-alpine` | Job queue cho BullMQ. Worker subscribe qua `BLPOP`. |
| **mock-service** | Custom Express | Mô phỏng External AI API (dev/staging). Port 3099. |

---

## 7. Component Architecture (C4 Level 3)

```mermaid
graph TB
    subgraph "Next.js Container (app)"
        subgraph "Middleware Layer"
            MW["middleware.ts\nDual Auth Gate\nAPI Key / NextAuth JWT"]
        end

        subgraph "API Route Layer"
            V1["/api/v1/{service}\ningest, extract, analyze,\ntransform, generate, compare"]
            WF["/api/v1/workflows\nCode-driven Workflow trigger"]
            OPS["/api/v1/operations/{id}\nStatus poll + Resume HITL"]
            CHAT["/api/chat\nAdmin Chat Assistant"]
            ADMIN["/api/settings\n/api/users\n/api/internal/auth-key"]
        end

        subgraph "Core Routing"
            REG["SERVICE_REGISTRY\n6 Services × 30+ Sub-cases\nUnified ParamSchema Metadata"]
            RUNNER["Endpoint Runner\nDiscriminator routing\nParam Guard & Merge"]
            SUBMIT["Pipeline Submit\nValidation, file save\nOperation create → BullMQ enqueue"]
        end

        subgraph "Admin UI (React)"
            HOME["Home — 6 Services Grid"]
            DASH["Operations Dashboard\n(BullMQ-linked progress)"]
            PROFILES["Profile Manager\nWorkflow Prompt Panel"]
            AIDEMO["/ai-demo\nWorkflow HITL Demo UI"]
        end
    end

    subgraph "Worker Container"
        subgraph "Standard Pipeline Engine"
            ENGINE["engine.ts\nSequential step runner\nCheckpoint/Resume\nSession chaining"]
            EXTAPI["External API Processor\nmultipart/form-data builder\ncURL logging\nprompt interpolation"]
        end

        subgraph "Workflow Engine"
            WFENGINE["workflow-engine.ts\nenqueueSubStep()\npauseWorkflow()\ncompleteWorkflow()\nparseDeep()"]
            WREG["WORKFLOW_REGISTRY\ndisbursement → runDisbursement\nappraisal → runAppraisal\n..."]
            WFLOWS["workflows/\ndisbursement.ts\nprompts/disbursement-prompts.ts"]
        end
    end

    subgraph "Shared Libraries"
        PRISMA["Prisma Client\nType-safe ORM"]
        LOGGER["Logger\nStructured JSON\nBullMQ job binding"]
        CRYPTO["Crypto Module\nAES-256-GCM"]
        BULLMQ["BullMQ Client\nQueue: pipeline-jobs\nJob priority (LOW/MEDIUM/HIGH)"]
    end

    MW --> V1
    MW --> WF
    MW --> OPS
    MW --> CHAT
    V1 --> RUNNER
    WF --> SUBMIT
    RUNNER --> REG
    RUNNER --> SUBMIT
    SUBMIT --> BULLMQ
    BULLMQ -->|"Job consumed"| ENGINE
    BULLMQ -->|"Job consumed"| WFENGINE
    WFENGINE --> WREG
    WREG --> WFLOWS
    WFENGINE --> EXTAPI
    ENGINE --> EXTAPI
    EXTAPI --> LOGGER
    ENGINE --> PRISMA
    WFENGINE --> PRISMA
```

### 7.1 Prompt Override — 3 Tầng ưu tiên

```mermaid
graph TD
    A["buildXxxPrompt(data, promptOverride?)"] --> B{promptOverride?}
    B -- "YES" --> C["Tầng 2: Profile Override\nInterpolate {{variables}}"]
    B -- "NO" --> D{_prompt in variables?}
    D -- "YES" --> E["Tầng 1: Code Prompt\n(hardcoded trong *-prompts.ts)"]
    D -- "NO" --> F["Tầng 3: DB Connector defaultPrompt\n(enqueueSubStep sẽ dùng connection.defaultPrompt)"]

    G["workflow-engine.ts\ncreateWorkflowContext()"] --> H["Load _workflowPrompts\nfrom ProfileEndpoint.parameters"]
    H --> I["ctx.promptOverrides = {\n  classify: '...'\n  report: '...'\n}"]
    I -->|"Truyền vào"| A
```

### 7.2 Connectors

| Slug | Vai trò | Dùng tại |
|------|---------|---------|
| `ext-classifier` | Phân loại tài liệu & xác định logical docs | Workflow Step 1, analyze |
| `ext-data-extractor` | Bóc tách dữ liệu có cấu trúc | Workflow Step 2, extract |
| `ext-fact-verifier` | Đối chiếu chéo, compliance check | Workflow Step 3, analyze |
| `ext-content-gen` | Soạn nội dung, báo cáo, tờ trình | Workflow Step 4, generate |
| `ext-doc-layout` | Phân tích layout, OCR | ingest |
| `ext-vision-reader` | Vision/OCR thông minh | ingest |
| `ext-translator` | Dịch thuật | transform |
| `ext-rewriter` | Rewrite, paraphrase | transform |
| `ext-redactor` | Che giấu PII | transform |
| `ext-comparator` | So sánh ngữ nghĩa | compare |
| `sys-assistant` | Admin Chat Assistant | /api/chat |

---

## 8. Sequence Diagrams

### 8.1 BullMQ Standard Pipeline Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as 📱 Client App
    participant App as 🏗️ Next.js App
    participant Redis as 🔴 Redis (BullMQ)
    participant Worker as ⚙️ Worker (engine.ts)
    participant AI as 🤖 External AI / Mock
    participant DB as 🗄️ PostgreSQL

    Client->>+App: POST /api/v1/extract (files + params)
    App->>App: Auth (x-api-key)
    App->>App: Routing, Param merge, Profile load
    App->>DB: INSERT Operation { state: RUNNING }
    App->>Redis: BullMQ.add('pipeline-jobs', { operationId })
    App-->>-Client: 202 Accepted { operation_id }

    Redis->>+Worker: Job dequeued
    Worker->>DB: Load Operation + pipeline steps
    loop For each step[i]
        Worker->>DB: UPDATE currentStep=i, progressPercent
        Worker->>DB: Load ExternalApiConnection (slug)
        Worker->>AI: POST multipart/form-data (prompt + files)
        AI-->>Worker: JSON response
        Worker->>Worker: parseDeep(response)
        Worker->>DB: UPDATE stepsResultJson (checkpoint)
    end
    Worker->>DB: UPDATE state=SUCCEEDED, outputContent
    Worker-->>-Redis: Job complete

    Client->>App: GET /api/v1/operations/{id}
    App->>DB: SELECT Operation
    App-->>Client: { state: SUCCEEDED, outputContent, usage }
```

### 8.2 Workflow HITL Flow (Code-Driven)

```mermaid
sequenceDiagram
    autonumber
    participant Client as 📱 Client
    participant App as 🏗️ Next.js App
    participant Redis as 🔴 Redis
    participant Worker as ⚙️ Worker (workflow-engine.ts)
    participant AI as 🤖 External AI
    participant DB as 🗄️ PostgreSQL
    participant Human as 👤 Human Reviewer

    Client->>+App: POST /api/v1/workflows\n{ process: "disbursement", files }
    App->>DB: INSERT Operation { state: RUNNING }
    App->>Redis: BullMQ.add({ operationId, process: "disbursement" })
    App-->>-Client: 202 Accepted { operation_id }

    Redis->>+Worker: Job dequeued
    Worker->>Worker: WORKFLOW_REGISTRY["disbursement"] → runDisbursement(ctx)

    rect rgb(240, 255, 240)
        Note over Worker, AI: Step 1 - Parallel Classify
        Worker->>AI: enqueueSubStep (ext-classifier) × N files
        AI-->>Worker: classifyData per file
    end

    rect rgb(240, 240, 255)
        Note over Worker, AI: Step 2 - Parallel Extract (OCR)
        Worker->>AI: enqueueSubStep (ext-data-extractor) × N files
        AI-->>Worker: extractedData per file
        Worker->>DB: stepsResult checkpoint saved
    end

    Worker->>DB: UPDATE state=WAITING_USER_INPUT\ncurrentStep=2, message="Vui lòng kiểm duyệt..."
    Worker->>Worker: pauseWorkflow() → return
    Worker-->>-Redis: Job complete

    Note over Human, DB: Human reviews / edits extracted data in UI

    Human->>+App: POST /api/v1/operations/{id}/resume\n{ step: 1, extracted_data: { ...edited... } }
    App->>DB: UPDATE stepsResultJson[step=1].extracted_data\nUPDATE state=RUNNING
    App->>Redis: BullMQ.add({ operationId, resumeFromStep: 2 })
    App-->>-Human: 200 { status: "resumed" }

    Redis->>+Worker: Job dequeued (resume)
    Worker->>DB: Load stepsResult from checkpoint
    rect rgb(255, 250, 230)
        Note over Worker, AI: Step 3 - Crosscheck
        Worker->>AI: enqueueSubStep (ext-fact-verifier)
        AI-->>Worker: { verdict, score, checks }
    end
    rect rgb(255, 240, 240)
        Note over Worker, AI: Step 4 - Generate Report
        Worker->>AI: enqueueSubStep (ext-content-gen)
        AI-->>Worker: Tờ trình thẩm định (Markdown)
    end
    Worker->>DB: UPDATE state=SUCCEEDED, outputContent
    Worker-->>-Redis: Job complete
```

### 8.3 API Request Routing & Param Resolution

```mermaid
sequenceDiagram
    autonumber
    participant Client as 📱 Client
    participant MW as 🛡️ Middleware
    participant Runner as 🔀 Endpoint Runner
    participant DB as 🗄️ PostgreSQL

    Client->>+MW: POST /api/v1/extract\nx-api-key: sk-xxx\nbody: { type: "invoice", files }
    MW->>DB: GET /api/internal/auth-key (SHA256 lookup)
    DB-->>MW: ApiKey { id, role, spendingLimit }
    MW->>MW: Validate status=active, spending ok
    MW->>+Runner: Forward + x-api-key-id header

    Runner->>Runner: Lookup SERVICE_REGISTRY["extract"]
    Runner->>Runner: Resolve subCase by type="invoice"
    Runner->>Runner: Block defaultLocked params from client payload
    Runner->>DB: SELECT ProfileEndpoint WHERE apiKeyId + "extract:invoice"
    DB-->>Runner: { parameters, connectionsOverride, _workflowPrompts }
    Runner->>Runner: Merge: Profile params override Client params
    Runner->>Runner: Resolve connections: override > registry default
    Runner-->>-MW: Merged pipeline config
    MW-->>-Client: 202 + operation_id
```

### 8.4 Per-Profile Prompt Override (Workflow)

```mermaid
sequenceDiagram
    autonumber
    participant Admin as 👤 Admin
    participant UI as 🖥️ Profiles Page
    participant DB as 🗄️ PostgreSQL
    participant Worker as ⚙️ Worker

    Admin->>UI: Mở Workflow Prompt Panel\n→ Override "Bước 4: Tờ trình"
    Admin->>UI: Nhập prompt tùy chỉnh\ndùng {{classify_summary}} {{checks_summary}}
    UI->>DB: UPSERT ProfileEndpoint.parameters\n{ _workflowPrompts: { report: "Custom prompt..." } }

    Note over Worker: Khi Client gọi /api/v1/workflows

    Worker->>DB: Load ProfileEndpoint.parameters._workflowPrompts
    DB-->>Worker: { report: "Custom prompt..." }
    Worker->>Worker: ctx.promptOverrides = { report: "Custom prompt..." }
    Worker->>Worker: buildReportPrompt(data, ctx.promptOverrides.report)
    Note over Worker: 3-tier: Code → Profile Override (ACTIVE) → DB Default
```

---

## 9. Deployment Architecture — Docker & Kubernetes

### 9.1 Docker Compose Stack (Dev/Staging)

```mermaid
graph TB
    subgraph "Docker Compose Stack (AISkillHub)"
        subgraph "Network: AISkillHub-net"
            APP["📦 app (Next.js)\nvietbn/AISkillHub:4.0.0\nPort: 2023\nCmd: node server.js"]
            WORKER["⚙️ worker (BullMQ)\nvietbn/AISkillHub:4.0.0\nCmd: npx tsx worker.ts\nConcurrency: 5"]
            DB["🗄️ db\npostgres:16-alpine\nPort: 5432"]
            REDIS["🔴 redis\nredis:7-alpine\nPort: 6379"]
            MOCK["🤖 mock-service\nCustom Express\nPort: 3099"]
        end

        subgraph "Persistent Volumes"
            V1[("pgdata")]
            V2[("uploads")]
            V3[("outputs")]
        end

        APP -->|TCP:5432| DB
        APP -->|TCP:6379| REDIS
        WORKER -->|TCP:5432| DB
        WORKER -->|TCP:6379| REDIS
        WORKER -->|HTTP:3099 dev| MOCK
        DB --> V1
        APP --> V2
        APP --> V3
        WORKER --> V2
    end

    CLIENT[Client] -->|:2023| APP
    ADMIN[Admin UI] -->|:2023| APP
```

### 9.2 Service Configuration

| Service | Image | Port | Restart | Depends on |
|---------|-------|------|---------|------------|
| **app** | `vietbn/AISkillHub:4.0.0` | 2023 | unless-stopped | db (healthy), redis (healthy) |
| **worker** | `vietbn/AISkillHub:4.0.0` (CMD override) | — | unless-stopped | db (healthy), redis (healthy) |
| **db** | `postgres:16-alpine` | 5432 | unless-stopped | — |
| **redis** | `redis:7-alpine` | 6379 | unless-stopped | — |
| **mock-service** | Custom Express | 3099 | unless-stopped | — (independent) |

### 9.3 Worker Configuration

| ENV | Mặc định | Ý nghĩa |
|-----|---------|---------|
| `REDIS_URL` | `redis://redis:6379` | Kết nối BullMQ |
| `DATABASE_URL` | `postgresql://...` | Prisma connection |
| `WORKER_CONCURRENCY` | `5` | Số job chạy song song |
| `ENCRYPTION_KEY` | Required | Giải mã AI API keys từ DB |

### 9.4 Kubernetes — Production Topology

```mermaid
graph TB
    subgraph "Kubernetes Cluster — Namespace: AISkillHub-prod"
        ING["☁️ Ingress Controller\nTLS + cert-manager\n300M upload limit"]

        subgraph "Deployment: AISkillHub-app (2-10 replicas)"
            POD1["App Pod 1\nNext.js :2023"]
            POD2["App Pod 2\nNext.js :2023"]
        end

        subgraph "Deployment: AISkillHub-worker (1-5 replicas)"
            WPOD1["Worker Pod 1\ntsx worker.ts"]
            WPOD2["Worker Pod 2\ntsx worker.ts"]
        end

        SVC_APP["Service: AISkillHub-app\nClusterIP:2023"]
        SVC_WORKER["(No Service needed\n— pulls from Redis)"]

        subgraph "StatefulSet: AISkillHub-db"
            DB_POD["postgres:16\nPVC: 50Gi"]
        end

        subgraph "Deployment: redis"
            REDIS_POD["redis:7\nPVC: 5Gi"]
        end

        HPA_APP["HPA App\nmin 2 → max 10\nCPU 70%"]
        HPA_WORKER["HPA Worker\nmin 1 → max 5\nBullMQ queue depth"]
    end

    INTERNET --> ING
    ING --> SVC_APP
    SVC_APP --> POD1
    SVC_APP --> POD2
    WPOD1 -->|BullMQ consume| REDIS_POD
    WPOD2 -->|BullMQ consume| REDIS_POD
    POD1 -->|enqueue| REDIS_POD
    POD1 --> DB_POD
    WPOD1 --> DB_POD
    HPA_APP -.->|autoscale| POD1
    HPA_WORKER -.->|autoscale| WPOD1
```

**Điểm mới trong Kubernetes v2.1:**

| Khía cạnh | Cấu hình |
|-----------|---------|
| **Worker scaling** | HPA riêng dựa trên BullMQ queue depth (KEDA metric adapter) |
| **Worker replicas** | Stateless — nhiều worker cùng consume queue, BullMQ đảm bảo at-most-once |
| **App replicas** | Stateless — shared volumes (uploads/outputs) qua PVC ReadWriteMany |
| **Redis** | PVC 5Gi — append-only persistence cho durability |

---

## 10. Security Architecture

### 10.1 Authentication Matrix

| Endpoint Pattern | Auth Method | Token / Key | Session Type |
|-----------------|-------------|-------------|--------------|
| `/api/v1/*` | API Key Header | `x-api-key` → SHA-256 → DB lookup | Stateless |
| `/api/v1/operations/{id}/resume` | API Key Header | Same x-api-key | Stateless |
| `/api/chat` | NextAuth JWT | Cookie | JWT cookie |
| `/api/auth/*` | NextAuth Credentials | username + bcrypt | JWT cookie |
| `/api/internal/*` | Internal only (middleware bypass) | N/A | N/A |
| `/api/health` | None (public) | N/A | N/A |
| `/*` (pages) | NextAuth JWT | Session cookie | JWT |

### 10.2 Prompt Security

| Rủi ro | Biện pháp |
|--------|----------|
| Prompt injection từ Client | `defaultLocked: true` params bị strip trước khi merge |
| Client bypass profile prompt | `isLocked: true` trên `_workflowPrompts` → Client không override được |
| Prompt leak qua log | cURL log chỉ ghi lại metadata, không ghi full prompt content |

### 10.3 Secrets Management

| Secret | Storage | Rotation |
|--------|---------|---------|
| `DB_PASSWORD` | K8s Secret / `.env` | Quarterly |
| `NEXTAUTH_SECRET` | K8s Secret | Requires re-login |
| `ENCRYPTION_KEY` | K8s Secret | Requires re-encrypt DB |
| AI API Keys | DB (AES-256-GCM) | Admin dashboard — no deploy |
| `x-api-key` (client) | Client-managed | Admin revoke + issue |

---

## 11. Non-Functional Requirements (NFR)

| NFR | Target | Implementation |
|-----|--------|---------------|
| **Availability** | 99.9% uptime | K8s replicas ≥ 2, RollingUpdate zero-downtime |
| **Latency (P95)** | < 500ms gateway overhead | Async 202, no blocking in Next.js |
| **Throughput** | 100 req/s sustained | HPA app + worker scaling, BullMQ concurrency |
| **Max upload** | 300MB per file | Nginx `client_max_body_size` |
| **Sub-step timeout** | 120s per sub-step | SUB_STEP_TIMEOUT in workflow-engine, AbortController |
| **Pipeline timeout** | 300s per connector step (Standard) | Per-connector `timeoutSec` |
| **Data retention** | Files: 24h, Operations: 30d | Cleanup scheduler cron |
| **Recovery (RPO/RTO)** | RPO: 1h, RTO: 15min | PG WAL, PVC snapshots, rollout undo |
| **Observability** | Full structured logging | JSON logs, correlationId, BullMQ Dashboard |
| **HITL SLA** | System waits indefinitely | `WAITING_USER_INPUT` persisted in DB |
| **Job at-most-once** | No duplicate execution | BullMQ job ID idempotency |

---

## 12. Technology Stack Decision Matrix

| Layer | Technology | Lý do chọn | Thay thế đã xem xét |
|-------|-----------|-----------|---------------------|
| **Runtime** | Node.js 20 LTS | Ecosystem Next.js, async I/O native | Deno (immature) |
| **Framework** | Next.js 14 App Router | SSR admin UI + API routes cùng codebase | Express.js (no SSR) |
| **Database** | PostgreSQL 16 | ACID, JSONB, Prisma support | MySQL (JSONB yếu) |
| **ORM** | Prisma 5 | Type-safe, auto-migration | TypeORM (less type-safe) |
| **Job Queue** | BullMQ + Redis 7 | Priority queue, retry, dashboard, at-most-once | Sidekiq (Ruby), Celery (Python) |
| **Auth** | NextAuth v4 + bcryptjs | Native Next.js, JWT stateless | Passport.js |
| **Encryption** | AES-256-GCM (native crypto) | Zero-dep, NIST approved | Vault (infra overhead) |
| **Container** | Docker multi-stage | 350MB image | Podman |
| **Orchestration** | Kubernetes | HPA, rolling update, secrets | Docker Swarm (limited scale) |
| **Reverse Proxy** | Nginx | TLS, rate-limit | Traefik |
| **Worker** | tsx (TypeScript executor) | No compile step, hot-reload dev | ts-node, compiled JS |
| **AI Integration** | HTTP multipart/form-data via LLMs Hub | Provider-agnostic, no SDK lock-in | Per-provider SDK |

---

## 13. Approval Sign-off

| Vai trò | Họ tên | Ngày | Chữ ký |
|---------|--------|------|--------|
| **Solution Architect** | | | |
| **Technical Lead** | | | |
| **Security Officer** | | | |
| **Infrastructure Lead** | | | |
| **Project Manager** | | | |

---

> **Document Control**
> - v2.1 (2026-04-13): Cập nhật kiến trúc BullMQ Worker container, Workflow Engine code-driven, HITL pause/resume, 3-tier Prompt Override system, Mock Service, parseDeep utility. Docker image `vietbn/AISkillHub:4.0.0`.
> - v2.0 (2026-04-04): Unified Parameters, ParamSchema Metadata, Chat Assistant integration.
> - v1.0 (2026-04-03): Initial draft — 6 API endpoints, Docker & K8s deployment.
> - Next review: Q2-2026

---

*AISkillHub — Kiến trúc chuẩn hóa truy cập Document AI cho doanh nghiệp.*
