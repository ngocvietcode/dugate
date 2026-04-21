# dugate
<!-- v1.5 - 2026-04 -->

## Project Overview

| Key | Value |
|---|---|
| Name | dugate (Document Understanding Gateway) |
| Version | 1.5.0 |
| Purpose | API Gateway for document processing: ingest, extract, analyze, transform, generate, compare |
| Stack | Next.js 14, TypeScript 5, Prisma 5, PostgreSQL 16, Redis 7, BullMQ, Tailwind CSS 3 |
| AI SDKs | Google Gemini (`@google/generative-ai`), OpenAI (`openai`) |
| External tools | Pandoc (CLI), Ghostscript (CLI), sharp, mammoth, pdf-parse, xlsx |
| Ports | 2023 (dev), 2025 (prod), 3099 (mock service) |
| Worker | Standalone BullMQ process (`npx tsx worker.ts`), concurrency 5 (pipeline) / 10 (workflow) |

## Architecture

```
Client → /api/v1/{service} → Middleware (x-api-key | NextAuth | OIDC)
       → Runner (discriminate sub-case, load ProfileEndpoint overrides)
       → submitPipelineJob (save files / download file_urls, create Operation, enqueue BullMQ job)
       → Worker picks job → Pipeline engine (sequential steps) or Workflow engine (DAG)
       → Each step calls ExternalApiConnection (multipart/form-data)
       → Operation updated → Client polls GET /api/v1/operations/{id}
```

**Key patterns**: AIP-151 Long-Running Operations, idempotency keys, profile-driven overrides, pipeline chaining with session state, per-operation cost tracking, RBAC (ADMIN/USER/VIEWER), OIDC SSO.

## Directory Structure

```
app/                        # Next.js App Router
  api/v1/                   # Public API: ingest, extract, analyze, transform, generate, compare, workflows, operations, services, billing
  api/internal/             # Admin API: apikeys, auth-key, ext-connections, ext-overrides, profile-endpoints, dev-sync-endpoints, recover-stalled
  api/auth/                 # NextAuth (Credentials + OIDC providers)
  api/bull-board/           # BullMQ dashboard UI
  api/chat/                 # Public chat endpoint (homepage demo)
  api/health/               # Health check
  api/swagger/              # Swagger/OpenAPI docs
  api/settings/             # AppSetting CRUD + test
  api/users/                # User management CRUD
  api/operations/           # Internal operation polling (UI)
  login/                    # Login page
  ai-demo/                  # Interactive AI demo playground
    components/             # Demo-specific components (UploadZone, PipelineStepCard, ParallelFileGrid, etc.)
  (pages)/                  # Authenticated UI pages
    ingest/                 # Document ingestion
    extract/                # Data extraction
    analyze/                # Document analysis
    transform/              # Content transformation
    generate/               # Content generation
    compare/                # Document comparison
    history/                # Operation history
    operations/[id]/        # Operation detail
    profiles/               # API key profile management
    api-connections/        # External API connections
    api-docs/               # API documentation
    settings/               # Settings + user management
components/                 # Shared React components
  ChatConsultant.tsx        # AI chat interface
  ConversionHistory.tsx     # Operation history display
  HeaderNav.tsx             # Navigation header
  MarkdownEditor.tsx        # Markdown editor
  MarkdownPreview.tsx       # Markdown preview
  PageWrapper.tsx           # Page layout wrapper
  ServiceTestClient.tsx     # Service testing UI
  SessionProviderWrapper.tsx # NextAuth provider
  SettingsForm.tsx          # Settings form
  StatusBadge.tsx           # Status indicator badge
  ThemeProvider.tsx         # Dark/light theme
  ThemeToggle.tsx           # Theme switcher
lib/
  auth.ts                   # NextAuth config (CredentialsProvider + OIDC)
  config.ts                 # App configuration loader
  crypto.ts                 # AES-256-GCM encryption for API keys in DB
  errors.ts                 # Custom error definitions
  prisma.ts                 # Prisma singleton
  rbac.ts                   # Role-based access control (ADMIN/USER/VIEWER, canMutate())
  rate-limit.ts             # Rate limiting logic
  upload.ts                 # File upload validation (300MB max, macro rejection)
  upload-helper.ts          # Upload helper utilities
  file-url-downloader.ts    # Download files from URLs with auth config & SSRF protection
  logger.ts                 # Structured logging with correlation IDs
  settings.ts               # AppSetting read/write, prompt presets
  cleanup.ts                # Auto-delete uploaded files after 7 days
  cleanup-scheduler.ts      # Cleanup scheduler initialization
  zip.ts                    # Archive creation (archiver)
  endpoints/
    registry.ts             # SERVICE_REGISTRY: 6 services × N sub-cases with param schemas & connection chains
    presets.ts              # Extract field presets (invoice, contract, id-card, receipt, table, custom)
    runner.ts               # Universal endpoint dispatcher → resolves sub-case, merges params, submits job
    profile-resolver.ts     # Resolve ProfileEndpoint per API key
  pipelines/
    engine.ts               # Core pipeline executor (sequential steps, checkpoint/resume)
    submit.ts               # Job submission (idempotency, sync/async modes, file save)
    format.ts               # Operation response serialization
    validate.ts             # Pipeline validation
    processors/
      external-api.ts       # External API caller (multipart, prompt interpolation, session chaining)
      http-client.ts        # HTTP client with SSRF protection
      prompt-resolver.ts    # Template prompt resolver
      response-parser.ts    # Response JSON parsing
    workflow-engine.ts      # Code-driven DAG orchestration (parallel + sequential steps)
    workflows/              # Registered workflows (e.g. disbursement)
  queue/
    pipeline-queue.ts       # BullMQ queue singleton (3 attempts, exponential backoff)
    redis.ts                # Redis connection factory
  parsers/
    interface.ts            # Parser interface definition
    factory.ts              # Parser factory (dispatch by MIME type)
    word-parser.ts          # DOCX parser (mammoth)
    excel-parser.ts         # XLSX parser
prisma/
  schema.prisma             # 7 models
  migrations/               # Incremental migrations
worker.ts                   # Standalone BullMQ worker (pipeline + workflow queues, memory monitoring, stalled job detection)
middleware.ts               # Dual auth: NextAuth for UI, x-api-key for /api/v1/, rate limiting
mock-service/               # Fake external API for testing
scripts/                    # DB cleanup, migration, mock endpoint setup utilities
tests/                      # E2E & unit tests
types/                      # TypeScript type declarations
docs/                       # Architecture docs, integration guide, admin guide
docs-site/                  # Documentation site
```

## Database Models (Prisma)

| Model | Purpose |
|---|---|
| **Operation** | Long-running operation (state, progressPercent, progressMessage, pipeline steps, files, output, token usage, cost, webhook, errorCode) |
| **ApiKey** | Client API keys (hashed, role: STANDARD/ADMIN, spending limit, totalUsed, status) |
| **ExternalApiConnection** | External AI service registry (URL, authType, authSecret, prompt, response path, session chaining, state) |
| **ExternalApiOverride** | Per-client prompt overrides scoped to (connection, apiKey, endpointSlug, stepId) |
| **ProfileEndpoint** | Per-client endpoint config (enabled, locked params, connection override, job priority, fileUrlAuthConfig, allowedFileExtensions) |
| **AppSetting** | Key-value store (AI provider, model, encrypted API keys, prompt templates, S3 backend config) |
| **User** | Auth users (username, bcrypt password, role: ADMIN/USER/VIEWER, OIDC: provider, providerSub, email, displayName) |
| **FileCache** | File deduplication tracking for S3 storage backend (md5Hash, s3Key, size, refCount) |

## API Services (6 core + workflows)

| Service | Sub-cases | Description |
|---|---|---|
| `/api/v1/ingest` | parse, ocr, digitize, split | Document ingestion & preprocessing |
| `/api/v1/extract` | invoice, contract, id-card, receipt, table, custom | Structured data extraction |
| `/api/v1/analyze` | classify, sentiment, compliance, fact-check, quality, risk, summarize-eval | Deep analysis |
| `/api/v1/transform` | convert, translate, rewrite, redact, template | Content transformation |
| `/api/v1/generate` | summary, qa, outline, report, email, minutes | Content generation |
| `/api/v1/compare` | diff, semantic, version | Document comparison |
| `/api/v1/workflows` | disbursement (example) | Code-driven multi-step workflows |

**Supporting endpoints**:
- `GET /api/v1/operations` — List operations
- `GET /api/v1/operations/{id}` — Poll operation status
- `POST /api/v1/operations/{id}/cancel` — Cancel operation
- `GET /api/v1/operations/{id}/download` — Download output file
- `POST /api/v1/operations/{id}/resume` — Resume stalled operation
- `GET /api/v1/services` — List available services
- `GET /api/v1/billing/balance` — API key spending balance
- `GET /api/v1/billing/usage` — Billing usage summary

## Features

- **OIDC Single Sign-On**: Enterprise SSO via configurable OIDC provider (issuer, client ID/secret)
- **RBAC**: Three roles — ADMIN (full access), USER (standard), VIEWER (read-only, no mutations)
- **File URL Downloads**: Accept `file_urls` param (JSON array of `{url, filename?, mime_type?}`) with per-profile auth config, SSRF protection, 120s timeout
- **Pipeline Engine**: Sequential step execution with checkpoint/resume capability
- **Workflow Engine**: DAG-based orchestration for complex multi-step workflows
- **Session Chaining**: Multi-step external API calls preserving session state
- **Cost Tracking**: Per-operation input/output token counting and USD cost calculation
- **Idempotency**: Built-in via idempotency keys on job submission
- **Webhook Callbacks**: Notify clients on operation completion
- **Rate Limiting**: Middleware-level per-API-key rate limiting
- **Storage Engine**: Configurable Local or S3-compatible backend (AWS, MinIO, R2) with MD5 deduplication
- **File Cleanup**: Auto-delete uploaded files after 7 days
- **Memory Monitoring**: Worker pauses at 90% heap usage, resumes at 75%
- **Stalled Job Recovery**: Auto-detection (30s interval) with max 2 retries before DLQ
- **Security**: AES-256-GCM encryption, path traversal protection, SSRF protection, macro file rejection, API key hashing

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | JWT secret (>= 32 chars) |
| `NEXTAUTH_URL` | Callback URL (http://localhost:2023) |
| `GEMINI_API_KEY` | Google Gemini API key (optional, can set via /settings UI) |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `ENCRYPTION_KEY` | AES-256 key for AppSetting encryption (32 chars) |
| `REDIS_URL` | Redis connection (default: redis://localhost:6379) |
| `UPLOAD_DIR` | Upload directory (default: ./uploads) |
| `OUTPUT_DIR` | Output directory (default: ./outputs) |
| `WORKER_CONCURRENCY` | BullMQ pipeline worker slots (default: 5) |
| `SYNC_TIMEOUT_MS` | Sync mode timeout (default: 30000) |
| `MIGRATION` | Auto-run prisma db push + seed on startup (true/false) |
| `MOCK_SERVICE_URL` | Mock service URL for testing (default: http://localhost:3099) |
| `FILE_URL_DOWNLOAD_TIMEOUT_MS` | File URL download timeout (default: 120000) |
| `NEXT_PUBLIC_OIDC_ENABLED` | Enable OIDC authentication (true/false) |
| `OIDC_ISSUER` | OIDC provider issuer URL |
| `OIDC_CLIENT_ID` | OIDC client ID |
| `OIDC_CLIENT_SECRET` | OIDC client secret |

## Deploy

```bash
# Docker (recommended)
docker compose up -d

# Manual VPS deploy
bash deploy/deploy.sh
```

## First Run

Open `https://your-domain.com/setup` to create the first admin account.

## Development

```bash
npm run dev          # Next.js on port 2023
npm run worker:dev   # BullMQ worker
npm run test         # Jest tests
npm run test:e2e     # E2E tests
# Requires: PostgreSQL + Redis running
```

## Documentation

| File | Content |
|---|---|
| [docs/DU_INTEGRATION_GUIDE.md](docs/DU_INTEGRATION_GUIDE.md) | Developer & admin integration guide |
| [docs/SOLUTION_ARCHITECTURE.md](docs/SOLUTION_ARCHITECTURE.md) | High-level architecture |
| [docs/ARCHITECTURE_REVIEW_API.md](docs/ARCHITECTURE_REVIEW_API.md) | API design review |
| [docs/admin-multi-connector-guide.md](docs/admin-multi-connector-guide.md) | Admin override & routing guide |
| [docs/GEMINI_PROMPTS.md](docs/GEMINI_PROMPTS.md) | Prompt engineering notes |

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

