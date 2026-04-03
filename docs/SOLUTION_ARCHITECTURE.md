# DUGate — Solution Architecture Document

> **Document ID**: SA-DUGATE-2026-001  
> **Version**: 1.0  
> **Classification**: INTERNAL — FOR APPROVAL  
> **Author**: Solution Architecture Team  
> **Date**: 2026-04-03  
> **Status**: DRAFT — Pending Approval

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Context & Problem Statement](#2-business-context--problem-statement)
3. [Solution Overview](#3-solution-overview)
4. [Architecture Principles](#4-architecture-principles)
5. [System Context (C4 Level 1)](#5-system-context-c4-level-1)
6. [Container Architecture (C4 Level 2)](#6-container-architecture-c4-level-2)
7. [Component Architecture (C4 Level 3)](#7-component-architecture-c4-level-3)
8. [Data Architecture](#8-data-architecture)
9. [Sequence Diagrams](#9-sequence-diagrams)
10. [Deployment Architecture — Docker & Kubernetes](#10-deployment-architecture--docker--kubernetes)
11. [Security Architecture](#11-security-architecture)
12. [Non-Functional Requirements (NFR)](#12-non-functional-requirements-nfr)
13. [Technology Stack Decision Matrix](#13-technology-stack-decision-matrix)
14. [Risk Assessment & Mitigation](#14-risk-assessment--mitigation)
15. [Approval Sign-off](#15-approval-sign-off)

---

## 1. Executive Summary

**DUGate** (Document Understanding API Gateway) là một giải pháp kiến trúc cổng trung gian API nội bộ, chuyên biệt xử lý các bài toán **Phân tích Tài liệu** (Document Understanding) cho môi trường doanh nghiệp — đặc biệt phù hợp với ngành Tài chính & Ngân hàng.

Thay vì mỗi nghiệp vụ tự tích hợp riêng lẻ đến hàng chục dịch vụ OCR/LLM bên ngoài, DUGate **quy chuẩn hóa** toàn bộ lớp truy cập thành **6 API Endpoint duy nhất**, vận hành trên kiến trúc **Pipeline Engine bất đồng bộ** với khả năng **định tuyến theo Profile**, đảm bảo:

- **Zero-coupling** giữa ứng dụng nghiệp vụ và AI backend
- **Multi-tenant isolation** qua API Key + Profile-based routing
- **Audit-grade traceability** với structured logging & cURL reconstruction
- **Enterprise-grade deployment** trên Docker & Kubernetes

---

## 2. Business Context & Problem Statement

### 2.1 Hiện trạng (AS-IS)

```mermaid
graph LR
    A1[App Nghiệp vụ A] -->|Direct call| S1[OCR Service]
    A1 -->|Direct call| S2[Gemini API]
    A2[App Nghiệp vụ B] -->|Direct call| S1
    A2 -->|Direct call| S3[OpenAI API]
    A3[App Nghiệp vụ C] -->|Direct call| S2
    A3 -->|Direct call| S4[Claude API]

    style A1 fill:#ff6b6b,stroke:#333
    style A2 fill:#ff6b6b,stroke:#333
    style A3 fill:#ff6b6b,stroke:#333
```

**Vấn đề nhận diện:**

| # | Vấn đề | Ảnh hưởng |
|---|--------|-----------|
| P1 | Mỗi app tự tích hợp AI → N×M integrations | Chi phí bảo trì tăng tuyến tính |
| P2 | Không kiểm soát prompt/model tập trung | Rủi ro prompt injection, output inconsistency |
| P3 | Không có audit trail trên API gọi AI | Vi phạm compliance nội bộ |
| P4 | Không có spending limit per-team | Chi phí AI vượt tầm kiểm soát |
| P5 | Key rotation phải cập nhật tất cả apps | Downtime trên diện rộng |

### 2.2 Mục tiêu (TO-BE)

```mermaid
graph LR
    A1[App Nghiệp vụ A] -->|x-api-key| GW[🏗️ DUGate Gateway]
    A2[App Nghiệp vụ B] -->|x-api-key| GW
    A3[App Nghiệp vụ C] -->|x-api-key| GW
    GW -->|Profile routing| S1[OCR Engine]
    GW -->|Profile routing| S2[Gemini]
    GW -->|Profile routing| S3[OpenAI]
    GW -->|Profile routing| S4[Claude]
    GW -->|Profile routing| S5[Internal AI]

    style GW fill:#51cf66,stroke:#333,stroke-width:3px
```

---

## 3. Solution Overview

### 3.1 Kiến trúc Logic — 6 Unified Endpoints

DUGate quy chuẩn hóa toàn bộ bài toán Document Understanding thành **6 hành động ngữ nghĩa** (semantic actions):

| # | Endpoint | Chức năng | Sub-cases |
|---|----------|-----------|-----------|
| 1 | `/api/v1/ingest` | Đọc, OCR, số hóa tài liệu | `parse`, `ocr`, `digitize`, `split` |
| 2 | `/api/v1/extract` | Trích xuất dữ liệu có cấu trúc | `invoice`, `contract`, `id-card`, `receipt`, `table`, `custom` |
| 3 | `/api/v1/analyze` | Đánh giá, phân loại, fact-check | `classify`, `sentiment`, `compliance`, `fact-check`, `quality`, `risk`, `summarize-eval` |
| 4 | `/api/v1/transform` | Chuyển đổi, dịch thuật, mã hóa PII | `convert`, `translate`, `rewrite`, `redact`, `template` |
| 5 | `/api/v1/generate` | Sinh nội dung mới (tóm tắt, QA) | `summary`, `qa`, `outline`, `report`, `email`, `minutes` |
| 6 | `/api/v1/compare` | So sánh ngữ nghĩa/text diff | `diff`, `semantic`, `version` |

### 3.2 Core Architecture Pattern

```
Client Request → Middleware (Auth) → Endpoint Runner (Routing) → Pipeline Submit → Pipeline Engine → External API Processor → AI Backend
       ↑                                                                                                                        ↓
       └──────────────────── Operation Polling / Webhook ←────── PostgreSQL (State Machine) ←──────────────────────────────────┘
```

---

## 4. Architecture Principles

| # | Nguyên tắc | Mô tả |
|---|-----------|------|
| AP-1 | **Gateway Abstraction** | Ứng dụng nghiệp vụ KHÔNG bao giờ gọi trực tiếp AI backend. DUGate là điểm truy cập duy nhất. |
| AP-2 | **Profile-Driven Isolation** | Mỗi API Key sở hữu một cấu hình Profile riêng biệt (model, prompt, connector routing) — thay đổi không ảnh hưởng key khác. |
| AP-3 | **Async-First** | Mọi pipeline mặc định bất đồng bộ (`202 Accepted`). Hỗ trợ `?sync=true` cho trường hợp đặc biệt. |
| AP-4 | **Zero Client Code Change** | Thay đổi AI backend, prompt, model chỉ cần admin thao tác trên Dashboard — 0 dòng code ứng dụng thay đổi. |
| AP-5 | **Auditable** | Mọi request → AI backend đều được ghi log cURL command, correlation ID, latency, token usage. |
| AP-6 | **Defence in Depth** | Tầng auth kép: NextAuth (Admin UI) + API Key HMAC (Public API). AES-256-GCM cho secrets. |

---

## 5. System Context (C4 Level 1)

```mermaid
C4Context
    title DUGate — System Context Diagram

    Person(admin, "Administrator", "Quản trị cấu hình Gateway, Profile, Connector")
    Person(dev, "Developer / App Client", "Tích hợp API qua x-api-key")

    System(dugate, "DUGate Gateway", "Document Understanding API Gateway — 6 Unified Endpoints")

    System_Ext(gemini, "Google Gemini API", "LLM & Vision")
    System_Ext(openai, "OpenAI API", "GPT-4o / o1")
    System_Ext(claude, "Anthropic Claude", "Claude Sonnet/Opus")
    System_Ext(internal_ai, "Internal AI Service", "On-premise models")

    System_Ext(postgres, "PostgreSQL", "Operational data store")

    Rel(admin, dugate, "Quản trị qua Admin UI", "HTTPS/NextAuth")
    Rel(dev, dugate, "Gửi tài liệu, nhận kết quả", "HTTPS/x-api-key")
    Rel(dugate, gemini, "Forward request", "HTTPS/API Key")
    Rel(dugate, openai, "Forward request", "HTTPS/Bearer")
    Rel(dugate, claude, "Forward request", "HTTPS/API Key")
    Rel(dugate, internal_ai, "Forward request", "HTTP/mTLS")
    Rel(dugate, postgres, "CRUD Operations", "TCP/5432")
```

---

## 6. Container Architecture (C4 Level 2)

```mermaid
C4Container
    title DUGate — Container Diagram

    Person(client, "API Client")
    Person(admin, "Administrator")

    Container_Boundary(gateway, "DUGate Gateway") {
        Container(nginx, "Nginx Reverse Proxy", "nginx:alpine", "TLS termination, rate limiting, 300MB upload")
        Container(nextjs, "Next.js Application", "Node.js 20 / Next.js 14", "API Routes + Admin UI + Pipeline Engine")
        ContainerDb(pg, "PostgreSQL", "postgres:16-alpine", "Operations, ApiKeys, Connections, Profiles")
        Container(mock, "Mock Service", "Express.js", "15 fake connectors cho testing")
        Container(volumes, "Persistent Volumes", "Docker Volumes", "uploads/, outputs/, pgdata/")
    }

    Rel(client, nginx, "POST /api/v1/*", "HTTPS")
    Rel(admin, nginx, "Admin Dashboard", "HTTPS")
    Rel(nginx, nextjs, "Proxy pass", "HTTP:2023")
    Rel(nextjs, pg, "Prisma ORM", "TCP:5432")
    Rel(nextjs, mock, "Forward files", "HTTP:3099")
    Rel(nextjs, volumes, "Read/Write files", "FS mount")
```

### 6.1 Container Responsibility Matrix

| Container | Responsibility | Port | Image |
|-----------|---------------|------|-------|
| **nginx** | TLS termination, rate-limit, upload size cap (300MB), X-Forwarded headers | 80/443 | `nginx:alpine` |
| **app (Next.js)** | API routing, auth middleware, pipeline engine, admin UI, webhook dispatcher | 2023 | Custom `node:20-slim` multi-stage |
| **db (PostgreSQL)** | Operation state machine, API Key store, connection registry | 5432 | `postgres:16-alpine` |
| **mock-service** | Simulates 15 AI connectors cho E2E testing (không triển khai production) | 3099 | Custom `node:20-alpine` |

---

## 7. Component Architecture (C4 Level 3)

```mermaid
graph TB
    subgraph "Next.js Application Container"
        subgraph "Middleware Layer"
            MW[middleware.ts<br/>Dual Auth Gate]
        end

        subgraph "API Route Layer"
            V1["/api/v1/{service}" Routes<br/>ingest, extract, analyze,<br/>transform, generate, compare]
            CHAT["/api/chat" Route<br/>Chat Assistant]
            ADMIN["/api/operations<br/>/api/settings<br/>/api/users" Admin Routes]
            INTERNAL["/api/internal/auth-key"<br/>Key validation]
            HEALTH["/api/health"<br/>Healthcheck]
        end

        subgraph "Core Engine"
            REG[SERVICE_REGISTRY<br/>6 Services × 30 Sub-cases<br/>15 Connector mappings]
            RUNNER[Endpoint Runner<br/>Discriminator routing,<br/>Profile merge, param guard]
            SUBMIT[Pipeline Submit<br/>Validation, file save,<br/>Operation create]
            ENGINE[Pipeline Engine<br/>Sequential step execution,<br/>retry, progress tracking]
            EXT_API[External API Processor<br/>multipart/form-data builder,<br/>cURL logging, dot-path parser]
        end

        subgraph "Shared Libraries"
            AUTH[Auth Module<br/>NextAuth + bcrypt]
            PRISMA[Prisma Client<br/>Type-safe ORM]
            CRYPTO[Crypto Module<br/>AES-256-GCM]
            LOGGER[Logger<br/>Structured JSON logs]
            UPLOAD[Upload Helper<br/>File I/O]
            PARSER[Parser Factory<br/>PDF/DOCX native parse]
        end

        subgraph "Admin UI (React)"
            HOME[Home Page — 6 Services Grid]
            DASH[Operations Dashboard]
            SETTINGS[Settings & Connections Manager]
            PROFILES[Profile Endpoint Config]
            APIKEYS[API Key Management]
        end
    end

    MW --> V1
    MW --> ADMIN
    V1 --> RUNNER
    RUNNER --> REG
    RUNNER --> SUBMIT
    SUBMIT --> ENGINE
    ENGINE --> EXT_API
    EXT_API --> PARSER
    RUNNER --> PRISMA
    ENGINE --> PRISMA
    ENGINE --> LOGGER
    EXT_API --> LOGGER
    AUTH --> PRISMA
    SUBMIT --> UPLOAD
    EXT_API --> CRYPTO
```

### 7.1 SERVICE_REGISTRY — Connector Mapping

```mermaid
graph LR
    subgraph "6 API Services"
        ING[ingest]
        EXT[extract]
        ANA[analyze]
        TRA[transform]
        GEN[generate]
        CMP[compare]
    end

    subgraph "15 External AI Connectors"
        C1[ext-doc-layout]
        C2[ext-vision-reader]
        C3[ext-pdf-tools]
        C4[ext-data-extractor]
        C5[ext-classifier]
        C6[ext-sentiment]
        C7[ext-compliance]
        C8[ext-fact-verifier]
        C9[ext-quality-eval]
        C10[ext-content-gen]
        C11[ext-translator]
        C12[ext-rewriter]
        C13[ext-redactor]
        C14[ext-qa-engine]
        C15[ext-comparator]
    end

    ING --> C1
    ING --> C2
    ING --> C3
    EXT --> C4
    ANA --> C5
    ANA --> C6
    ANA --> C7
    ANA --> C4
    ANA --> C8
    ANA --> C9
    ANA --> C10
    TRA --> C1
    TRA --> C11
    TRA --> C12
    TRA --> C13
    GEN --> C10
    GEN --> C14
    CMP --> C15
```

---

## 8. Data Architecture

### 8.1 Entity Relationship Diagram

```mermaid
erDiagram
    User {
        uuid id PK
        string username UK
        string password "bcrypt hashed"
        string role "ADMIN | USER"
    }

    ApiKey {
        uuid id PK
        string name
        string keyHash UK "SHA-256"
        string prefix "display only"
        string role "STANDARD | ADMIN"
        float spendingLimit
        float totalUsed
        string status "active | revoked"
    }

    Operation {
        uuid id PK
        uuid apiKeyId FK "nullable"
        string idempotencyKey UK "AIP-155"
        boolean done
        string state "RUNNING | SUCCEEDED | FAILED | CANCELLED"
        int progressPercent
        string endpointSlug "e.g. extract:invoice"
        text pipelineJson "JSON array of steps"
        text filesJson "uploaded file metadata"
        text outputContent
        text extractedData
        text stepsResultJson
        int totalInputTokens
        int totalOutputTokens
        float totalCostUsd
        string webhookUrl
    }

    ExternalApiConnection {
        uuid id PK
        string name
        string slug UK "e.g. ext-data-extractor"
        text endpointUrl
        string httpMethod "POST | PUT"
        string authType "API_KEY_HEADER | BEARER | NONE"
        string authKeyHeader
        text authSecret "Plaintext — server-side only"
        string promptFieldName
        string fileFieldName
        text defaultPrompt
        text staticFormFields "JSON"
        text extraHeaders "JSON"
        string responseContentPath "dot-path resolver"
        int timeoutSec
        string state "ENABLED | DISABLED"
    }

    ExternalApiOverride {
        uuid id PK
        uuid connectionId FK
        uuid apiKeyId FK
        text promptOverride "null = use default"
    }

    ProfileEndpoint {
        uuid id PK
        uuid apiKeyId FK
        string endpointSlug
        boolean enabled
        text defaultParams "JSON"
        text profileParams "JSON — admin-locked"
        text connectionsOverride "JSON array of slugs"
    }

    AppSetting {
        uuid id PK
        string key UK
        text value
    }

    ApiKey ||--o{ Operation : "generates"
    ApiKey ||--o{ ExternalApiOverride : "overrides"
    ApiKey ||--o{ ProfileEndpoint : "configures"
    ExternalApiConnection ||--o{ ExternalApiOverride : "overridden_by"
```

### 8.2 Data Flow Classification

| Dữ liệu | Sensitivity | Encryption | Retention |
|----------|------------|-----------|-----------|
| API Key (raw) | **CRITICAL** | SHA-256 hash, chỉ lưu hash | Permanent |
| Auth Secrets (AI API Keys) | **CRITICAL** | AES-256-GCM at-rest | Permanent |
| Uploaded Files | HIGH | At-rest (volume encryption) | 24h (auto-cleanup) |
| Operation Results | MEDIUM | TLS in-transit | 30 days |
| User Passwords | **CRITICAL** | bcrypt (cost=10) | Permanent |
| Structured Logs | MEDIUM | N/A | 90 days |

---

## 9. Sequence Diagrams

### 9.1 Luồng xử lý API Request (Async — Production Flow)

```mermaid
sequenceDiagram
    autonumber
    participant Client as 📱 Client App
    participant Nginx as 🔒 Nginx (TLS)
    participant MW as 🛡️ Middleware
    participant AuthSvc as 🔑 Auth Service
    participant Router as 🔀 Endpoint Runner
    participant Registry as 📋 Service Registry
    participant DB as 🗄️ PostgreSQL
    participant Submit as 📤 Pipeline Submit
    participant Disk as 💾 File Storage

    Client->>+Nginx: POST /api/v1/extract<br/>Headers: x-api-key, Content-Type: multipart<br/>Body: file + type=invoice
    Nginx->>+MW: Proxy pass (HTTP:2023)

    rect rgb(255, 240, 240)
        Note over MW,AuthSvc: Authentication Phase
        MW->>+AuthSvc: GET /api/internal/auth-key<br/>Headers: x-api-key
        AuthSvc->>DB: SELECT * FROM ApiKey WHERE keyHash = SHA256(key)
        DB-->>AuthSvc: ApiKey { id, role, status, spendingLimit }
        AuthSvc->>AuthSvc: Validate status=active, spending within limit
        AuthSvc-->>-MW: { valid: true, apiKeyId: "uuid" }
        MW->>MW: Inject header x-api-key-id = "uuid"
    end

    MW->>+Router: Forward request with x-api-key-id

    rect rgb(240, 255, 240)
        Note over Router,Registry: Routing & Param Resolution Phase
        Router->>Registry: Lookup SERVICE_REGISTRY["extract"]
        Registry-->>Router: ServiceDef { discriminator: "type", subCases }
        Router->>Router: Resolve subCase by type="invoice"
        Router->>Router: Block profileOnlyParams from client
        Router->>DB: SELECT * FROM ProfileEndpoint<br/>WHERE apiKeyId AND endpointSlug="extract:invoice"
        DB-->>Router: ProfileEndpoint { defaultParams, profileParams, connectionsOverride }
        Router->>Router: Merge params: default ← client ← profile (locked)
        Router->>Router: Resolve connections: override → registry default
    end

    rect rgb(240, 240, 255)
        Note over Router,Disk: Pipeline Submission Phase
        Router->>+Submit: submitPipelineJob({ pipeline, files, endpointSlug })
        Submit->>DB: Validate connectors: ExternalApiConnection.state = ENABLED
        Submit->>Submit: Check idempotencyKey (AIP-155)
        Submit->>Disk: Save uploaded files → /uploads/{operationId}/
        Submit->>DB: INSERT Operation { state: RUNNING, pipelineJson, filesJson }
        Submit->>Submit: Fire-and-forget: runPipeline(operationId)
        Submit-->>-Router: { ok: true, operation }
    end

    Router-->>MW: 202 Accepted<br/>Operation-Location: /api/v1/operations/{id}
    MW-->>Nginx: Response
    Nginx-->>-Client: 202 Accepted + operation_id
```

### 9.2 Pipeline Engine — Multi-Step Execution

```mermaid
sequenceDiagram
    autonumber
    participant Engine as ⚙️ Pipeline Engine
    participant DB as 🗄️ PostgreSQL
    participant Processor as 🔌 External API Processor
    participant Parser as 📄 Parser Factory
    participant AI as 🤖 AI Backend
    participant Webhook as 📡 Webhook

    Engine->>DB: Load Operation (pipelineJson, filesJson)

    loop For each step in pipeline[0..N]
        Engine->>DB: UPDATE progress: step {i}/{N}, progressPercent

        Engine->>DB: SELECT ExternalApiConnection WHERE slug = step.processor
        DB-->>Engine: Connection { url, auth, prompt, responseContentPath }

        opt Has per-client override
            Engine->>DB: SELECT ExternalApiOverride WHERE connectionId + apiKeyId
            DB-->>Engine: Override { promptOverride }
        end

        Engine->>+Processor: runExternalApiProcessor(ctx, connection, override)

        alt Single file → Native parser available (PDF/DOCX)
            Processor->>Parser: ParserFactory.getParserForFile(filename)
            Parser-->>Processor: Parser instance
            Processor->>Parser: parse(fileBuffer)
            Parser-->>Processor: { markdown, pageCount }
            Note over Processor: Skip external call → cost = $0
        else External API required
            Processor->>Processor: Resolve prompt: override → default<br/>Interpolate {{variables}}
            Processor->>Processor: Build FormData:<br/>• prompt field<br/>• static form fields<br/>• file attachments
            Processor->>Processor: Log cURL command (audit)
            Processor->>+AI: HTTP POST multipart/form-data<br/>Headers: x-api-key / Bearer
            AI-->>-Processor: JSON response
            Processor->>Processor: resolveDotPath(response, "data.response")
        end

        Processor-->>-Engine: ProcessorResult { content, tokens, cost }

        Engine->>Engine: Chain output → next step inputText
        Engine->>DB: UPDATE stepsResultJson (intermediate save)
    end

    Engine->>DB: UPDATE Operation SET state=SUCCEEDED,<br/>outputContent, totalCostUsd, usageBreakdown

    opt webhookUrl configured
        Engine->>+Webhook: POST webhookUrl<br/>{ operation_id, state: SUCCEEDED }
        Webhook-->>-Engine: 200 OK
        Engine->>DB: UPDATE webhookSentAt
    end
```

### 9.3 Operation Polling — Client-side

```mermaid
sequenceDiagram
    autonumber
    participant Client as 📱 Client
    participant GW as 🏗️ DUGate
    participant DB as 🗄️ PostgreSQL

    Client->>GW: POST /api/v1/extract (file + params)
    GW-->>Client: 202 Accepted<br/>{ operation_id: "abc-123",<br/>  state: "RUNNING",<br/>  Operation-Location: "/api/v1/operations/abc-123" }

    loop Poll every 2-5 seconds
        Client->>GW: GET /api/v1/operations/abc-123
        GW->>DB: SELECT * FROM Operation WHERE id = "abc-123"
        DB-->>GW: Operation { state, progressPercent, progressMessage }

        alt state = RUNNING
            GW-->>Client: 200 { state: "RUNNING", progress: 45%, message: "Step 1/2: ext-data-extractor..." }
        else state = SUCCEEDED
            GW-->>Client: 200 { state: "SUCCEEDED", done: true,<br/>  output_content: "{...}",<br/>  usage: { tokens: 1234, cost: 0.02 } }
        else state = FAILED
            GW-->>Client: 200 { state: "FAILED", done: true,<br/>  error: { code: "PIPELINE_ERROR", message: "..." } }
        end
    end
```

### 9.4 Per-Profile Connector Routing Override

```mermaid
sequenceDiagram
    autonumber
    participant Admin as 👤 Admin
    participant UI as 🖥️ Admin Dashboard
    participant DB as 🗄️ PostgreSQL
    participant Client as 📱 Client (Key A)
    participant GW as 🏗️ DUGate
    participant AI_OCR as 🤖 ext-ocr-premium
    participant AI_Default as 🤖 ext-data-extractor

    rect rgb(255, 250, 230)
        Note over Admin,DB: Admin configures Profile Override
        Admin->>UI: Set Key A → extract:invoice<br/>connectionsOverride = ["ext-ocr-premium"]
        UI->>DB: UPSERT ProfileEndpoint { apiKeyId: A,<br/>endpointSlug: "extract:invoice",<br/>connectionsOverride: '["ext-ocr-premium"]' }
    end

    rect rgb(230, 255, 230)
        Note over Client,AI_OCR: Client A → uses overridden connector
        Client->>GW: POST /api/v1/extract (type=invoice, x-api-key=A)
        GW->>DB: Load ProfileEndpoint for Key A + "extract:invoice"
        DB-->>GW: connectionsOverride = ["ext-ocr-premium"]
        GW->>AI_OCR: Forward → ext-ocr-premium (overridden)
        AI_OCR-->>GW: Result
        GW-->>Client: 202 Accepted
    end

    rect rgb(230, 240, 255)
        Note over Client,AI_Default: Client B (no override) → uses default
        Client->>GW: POST /api/v1/extract (type=invoice, x-api-key=B)
        GW->>DB: Load ProfileEndpoint for Key B → null
        GW->>AI_Default: Forward → ext-data-extractor (default from registry)
        AI_Default-->>GW: Result
        GW-->>Client: 202 Accepted
    end
```

### 9.5 Admin Authentication — NextAuth Session Flow

```mermaid
sequenceDiagram
    autonumber
    participant Browser as 🌐 Browser
    participant Nginx as 🔒 Nginx
    participant MW as 🛡️ Middleware
    participant NextAuth as 🔐 NextAuth
    participant DB as 🗄️ PostgreSQL

    Browser->>Nginx: GET /settings
    Nginx->>MW: Proxy pass
    MW->>MW: getToken(req) — check JWT cookie
    alt No valid JWT
        MW-->>Browser: 302 Redirect → /login
        Browser->>Nginx: POST /api/auth/callback/credentials<br/>{ username, password }
        Nginx->>NextAuth: Forward
        NextAuth->>DB: SELECT * FROM User WHERE username = ?
        DB-->>NextAuth: User { id, password_hash, role }
        NextAuth->>NextAuth: bcrypt.compare(input, hash)
        alt Password valid
            NextAuth-->>Browser: Set-Cookie: next-auth.session-token (JWT)<br/>302 Redirect → /settings
        else Password invalid
            NextAuth-->>Browser: Error: "Mật khẩu không chính xác"
        end
    else Valid JWT exists
        MW-->>Browser: 200 OK — render /settings page
    end
```

---

## 10. Deployment Architecture — Docker & Kubernetes

### 10.1 Docker Compose — Development / Staging

```mermaid
graph TB
    subgraph "Docker Compose Stack"
        subgraph "Network: dugate-net (bridge)"
            APP["📦 app (dugate)<br/>node:20-slim<br/>Port: 2023<br/>Multi-stage build<br/>depends_on: db (healthy)"]
            DB["🗄️ db<br/>postgres:16-alpine<br/>Port: 5432<br/>Volume: pgdata<br/>Healthcheck: pg_isready"]
            MOCK["🧪 mock-service<br/>node:20-alpine<br/>Port: 3099<br/>15 fake connectors"]
        end

        subgraph "Persistent Volumes"
            V1[("📁 pgdata")]
            V2[("📁 uploads")]
            V3[("📁 outputs")]
        end

        APP --> DB
        APP --> MOCK
        DB --> V1
        APP --> V2
        APP --> V3
    end

    CLIENT[Client] -->|:2023| APP
    ADMIN[Admin] -->|:2023| APP
```

**Docker Compose Configuration hiện tại:**

```yaml
services:
  app:
    build: .                    # Multi-stage Dockerfile
    ports: ["2023:2023"]
    environment:
      DATABASE_URL: postgresql://dugate:${DB_PASSWORD}@db:5432/dugate
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    volumes:
      - uploads:/app/uploads
      - outputs:/app/outputs
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: pg_isready -U dugate
      interval: 5s

  mock-service:               # DEV/TEST only — NOT in production
    build: ./mock-service
    ports: ["3099:3099"]
```

### 10.2 Multi-Stage Dockerfile Architecture

```mermaid
graph LR
    subgraph "Stage 1: deps"
        D1[node:20-slim<br/>npm install]
    end

    subgraph "Stage 2: builder"
        D2[COPY node_modules<br/>COPY source<br/>prisma generate<br/>next build]
    end

    subgraph "Stage 3: runner (Production)"
        D3[node:20-slim<br/>openssl only<br/>.next/standalone<br/>prisma client<br/>CMD: db push → seed → server.js]
    end

    D1 -->|node_modules| D2
    D2 -->|.next/standalone + prisma| D3

    style D3 fill:#51cf66,stroke:#333,stroke-width:2px
```

**Design Decision**: Multi-stage build giảm image size từ ~1.2GB → ~350MB bằng cách chỉ copy `.next/standalone` output và Prisma client vào runner stage. Runtime không cần devDependencies.

### 10.3 Kubernetes Deployment — Production

```mermaid
graph TB
    subgraph "Kubernetes Cluster"
        subgraph "Namespace: dugate-prod"
            ING[☁️ Ingress Controller<br/>nginx-ingress<br/>TLS: cert-manager<br/>client_max_body_size: 300M]

            subgraph "Deployment: dugate-app"
                POD1["Pod 1<br/>dugate:latest"]
                POD2["Pod 2<br/>dugate:latest"]
                POD3["Pod 3<br/>dugate:latest"]
            end

            SVC_APP[Service: dugate-app<br/>ClusterIP:2023]

            subgraph "StatefulSet: dugate-db"
                DB_POD["Pod: postgres:16-alpine<br/>PVC: 50Gi"]
            end

            SVC_DB[Service: dugate-db<br/>ClusterIP:5432]

            subgraph "Storage"
                PVC_DB[("PVC: dugate-pgdata<br/>50Gi, ReadWriteOnce")]
                PVC_UPLOAD[("PVC: dugate-uploads<br/>100Gi, ReadWriteMany")]
                PVC_OUTPUT[("PVC: dugate-outputs<br/>50Gi, ReadWriteMany")]
            end

            CM[ConfigMap: dugate-config<br/>NEXTAUTH_URL, LOG_LEVEL]
            SEC[Secret: dugate-secrets<br/>DB_PASSWORD, NEXTAUTH_SECRET,<br/>ENCRYPTION_KEY, AI_API_KEYS]

            HPA[HPA: dugate-app<br/>min: 2, max: 10<br/>CPU target: 70%]
        end
    end

    INTERNET[🌐 Internet] -->|HTTPS| ING
    ING -->|HTTP| SVC_APP
    SVC_APP --> POD1
    SVC_APP --> POD2
    SVC_APP --> POD3
    POD1 --> SVC_DB
    POD2 --> SVC_DB
    POD3 --> SVC_DB
    SVC_DB --> DB_POD
    DB_POD --> PVC_DB
    POD1 --> PVC_UPLOAD
    POD2 --> PVC_UPLOAD
    POD1 --> PVC_OUTPUT

    HPA -.->|Auto-scale| POD1
    CM -.->|env| POD1
    SEC -.->|env| POD1
```

### 10.4 Kubernetes Manifest Specifications

#### Deployment — dugate-app

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dugate-app
  namespace: dugate-prod
  labels:
    app: dugate
    component: gateway
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0    # Zero-downtime deployment
  selector:
    matchLabels:
      app: dugate
  template:
    metadata:
      labels:
        app: dugate
        component: gateway
    spec:
      containers:
        - name: dugate
          image: registry.internal/dugate:latest
          ports:
            - containerPort: 2023
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: dugate-secrets
                  key: DATABASE_URL
            - name: NEXTAUTH_SECRET
              valueFrom:
                secretKeyRef:
                  name: dugate-secrets
                  key: NEXTAUTH_SECRET
            - name: ENCRYPTION_KEY
              valueFrom:
                secretKeyRef:
                  name: dugate-secrets
                  key: ENCRYPTION_KEY
            - name: UPLOAD_DIR
              value: /app/uploads
            - name: OUTPUT_DIR
              value: /app/outputs
            - name: NODE_ENV
              value: production
            - name: LOG_FORMAT
              value: json
          volumeMounts:
            - name: uploads
              mountPath: /app/uploads
            - name: outputs
              mountPath: /app/outputs
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "2Gi"
          livenessProbe:
            httpGet:
              path: /api/health
              port: 2023
            initialDelaySeconds: 30
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/health
              port: 2023
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - name: uploads
          persistentVolumeClaim:
            claimName: dugate-uploads
        - name: outputs
          persistentVolumeClaim:
            claimName: dugate-outputs
```

#### StatefulSet — PostgreSQL

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: dugate-db
  namespace: dugate-prod
spec:
  serviceName: dugate-db
  replicas: 1
  selector:
    matchLabels:
      app: dugate-db
  template:
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_USER
              value: dugate
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: dugate-secrets
                  key: DB_PASSWORD
            - name: POSTGRES_DB
              value: dugate
          volumeMounts:
            - name: pgdata
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "500m"
              memory: "1Gi"
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "dugate"]
            periodSeconds: 15
  volumeClaimTemplates:
    - metadata:
        name: pgdata
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 50Gi
```

#### HorizontalPodAutoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: dugate-app-hpa
  namespace: dugate-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: dugate-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

#### Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dugate-ingress
  namespace: dugate-prod
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "300m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - dugate.internal.bank.vn
      secretName: dugate-tls
  rules:
    - host: dugate.internal.bank.vn
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: dugate-app
                port:
                  number: 2023
```

### 10.5 CI/CD Pipeline

```mermaid
graph LR
    subgraph "CI/CD Pipeline"
        A[Git Push<br/>main branch] --> B[GitHub Actions<br/>Trigger]
        B --> C[Build & Test<br/>npm ci, lint, jest]
        C --> D[Docker Build<br/>Multi-stage]
        D --> E[Push to Registry<br/>registry.internal]
        E --> F[kubectl rollout<br/>RollingUpdate]
        F --> G{Health Check<br/>Passed?}
        G -->|Yes| H[✅ Deploy Complete]
        G -->|No| I[🔄 Auto Rollback<br/>kubectl rollout undo]
    end
```

---

## 11. Security Architecture

### 11.1 Defense-in-Depth Layers

```mermaid
graph TB
    subgraph "Layer 1: Network"
        L1[TLS 1.3 — cert-manager<br/>HTTPS enforcement<br/>Network Policy isolation]
    end

    subgraph "Layer 2: Edge"
        L2[Nginx — Rate limiting<br/>Upload size cap: 300MB<br/>X-Forwarded headers<br/>CORS policy]
    end

    subgraph "Layer 3: Application Auth"
        L3[Dual Auth Gate:<br/>• Admin UI → NextAuth JWT (bcrypt)<br/>• Public API → x-api-key HMAC SHA-256<br/>• profileOnlyParams blocked from client]
    end

    subgraph "Layer 4: Data Protection"
        L4[AES-256-GCM for secrets at-rest<br/>bcrypt cost=10 for passwords<br/>API Key only stored as hash<br/>Secrets never in logs]
    end

    subgraph "Layer 5: Audit & Compliance"
        L5[Structured JSON logging<br/>cURL reconstruction per request<br/>Correlation ID end-to-end<br/>Token usage tracking per key]
    end

    L1 --> L2 --> L3 --> L4 --> L5
```

### 11.2 Authentication Matrix

| Endpoint Pattern | Auth Method | Token / Key | Session Type |
|-----------------|-------------|-------------|--------------|
| `/api/v1/*` | API Key Header | `x-api-key` → SHA-256 → DB lookup | Stateless |
| `/api/auth/*` | NextAuth Credentials | username + bcrypt password | JWT cookie |
| `/api/internal/*` | Internal only (middleware bypass) | N/A — only callable by middleware | N/A |
| `/api/health` | None (public) | N/A | N/A |
| `/*` (pages) | NextAuth JWT | Session cookie | JWT |

### 11.3 Secrets Management

| Secret | Storage | Rotation Strategy |
|--------|---------|-------------------|
| `DB_PASSWORD` | K8s Secret / `.env` | Quarterly, zero-downtime via pg_hba reload |
| `NEXTAUTH_SECRET` | K8s Secret | Requires re-login for all admin sessions |
| `ENCRYPTION_KEY` | K8s Secret | Requires re-encrypt all ExternalApiConnection.authSecret |
| AI API Keys | DB (AES-256-GCM encrypted) | Admin changes via Dashboard — no deployment needed |
| `x-api-key` (client) | Client-managed | Admin revokes + issues new key via Dashboard |

---

## 12. Non-Functional Requirements (NFR)

| NFR | Target | Implementation |
|-----|--------|---------------|
| **Availability** | 99.9% uptime | K8s replicas ≥ 2, RollingUpdate zero-downtime, PG healthcheck |
| **Latency (P95)** | < 500ms (gateway overhead) | Direct proxy, no message queue, async pipeline |
| **Throughput** | 100 req/s sustained | HPA auto-scale 2→10 pods, connection pooling via Prisma |
| **Max upload** | 300MB per file | Nginx `client_max_body_size`, K8s Ingress annotation |
| **Pipeline timeout** | 300s per connector step | Per-connector `timeoutSec` config, AbortController |
| **Data retention** | Files: 24h, Operations: 30d | Cleanup scheduler cron + `filesDeleted` flag |
| **Recovery (RPO/RTO)** | RPO: 1h, RTO: 15min | PG WAL archival, PVC snapshots, rollout undo |
| **Observability** | Full structured logging | JSON log format, correlation ID, cURL audit trail |
| **Scalability** | Horizontal only | Stateless app pods, shared PVC for uploads |

---

## 13. Technology Stack Decision Matrix

| Layer | Technology | Lý do chọn | Thay thế đã xem xét |
|-------|-----------|-----------|---------------------|
| **Runtime** | Node.js 20 LTS | Ecosystem Next.js, async I/O native, low-memory footprint | Deno (immature ecosystem) |
| **Framework** | Next.js 14 App Router | SSR admin UI + API routes cùng codebase, chuẩn Vercel | Express.js (không có SSR), NestJS (over-engineering) |
| **Database** | PostgreSQL 16 | ACID, JSONB native, Prisma first-class support, mature | MySQL (JSONB yếu), MongoDB (không ACID) |
| **ORM** | Prisma 5 | Type-safe schema, auto-migration, connection pooling | TypeORM (less type-safe), Drizzle (younger ecosystem) |
| **Auth** | NextAuth v4 + bcryptjs | Native Next.js integration, JWT stateless, credential provider | Passport.js (not Next-native), Clerk (SaaS dependency) |
| **Encryption** | AES-256-GCM (native crypto) | Zero-dependency, NIST approved, authenticated encryption | Vault (infrastructure overhead) |
| **Container** | Docker + multi-stage build | 350MB production image, reproducible builds | Podman (less tooling) |
| **Orchestration** | Kubernetes | HPA, rolling update, secret management, network policy | Docker Swarm (limited auto-scaling) |
| **Reverse Proxy** | Nginx | TLS termination, rate-limit, mature config | Traefik (auto-discovery overkill for single service) |
| **AI Integration** | HTTP multipart/form-data | Provider-agnostic, no SDK lock-in | SDK per-provider (tight coupling) |

---

## 14. Risk Assessment & Mitigation

| # | Risk | Probability | Impact | Mitigation |
|---|------|------------|--------|-----------|
| R1 | Single DB failure → full outage | Medium | **Critical** | PG StatefulSet + PVC snapshot + WAL archival. Roadmap: read-replica. |
| R2 | AI provider rate-limit / downtime | High | High | Multi-connector routing — admin can switch backend in seconds via Dashboard. Retry with fallback connector (roadmap). |
| R3 | File upload storage exhaustion | Medium | Medium | 24h auto-cleanup scheduler. Alert khi PVC usage > 80%. |
| R4 | Prompt injection from client | Medium | High | `profileOnlyParams` blocked at Endpoint Runner. Admin-locked `promptOverride` per-key. Client cannot modify system prompt. |
| R5 | Key leak from logs | Low | **Critical** | cURL logging masks auth headers. API keys stored as SHA-256 hash only. |
| R6 | Pipeline stuck (infinite execution) | Low | Medium | Per-connector `timeoutSec` + AbortController. Operation state = FAILED after timeout. |
| R7 | Horizontal scaling — file access conflict | Medium | Medium | ReadWriteMany PVC (NFS/EFS). Each operation has unique subdirectory. |

---

## 15. Approval Sign-off

| Vai trò | Họ tên | Ngày | Chữ ký |
|---------|--------|------|--------|
| **Solution Architect** | | | |
| **Technical Lead** | | | |
| **Security Officer** | | | |
| **Infrastructure Lead** | | | |
| **Project Manager** | | | |

---

> **Document Control**  
> - v1.0 (2026-04-03): Initial draft — full architecture with sequence diagrams, Docker & K8s deployment  
> - Next review: Pending approval feedback

---

*DUGate — Kiến trúc chuẩn hóa truy cập Document AI cho doanh nghiệp.*
