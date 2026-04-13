# dugate
<!-- v1.5 - 2026-04 -->

## Project Overview

| Key | Value |
|---|---|
| Name | dugate (Document Understanding Gateway) |
| Version | 1.5.0 |
| Purpose | API Gateway for document processing: ingest, extract, analyze, transform, generate, compare |
| Stack | Next.js 14, TypeScript 5, Prisma 5, PostgreSQL 16, Redis 7, BullMQ, Tailwind CSS 3 |
| AI SDKs | Google Gemini, OpenAI |
| External tools | Pandoc (CLI), Ghostscript (CLI), sharp, mammoth |
| Ports | 2023 (dev/prod Next.js), 3099 (mock service) |
| Worker | Standalone BullMQ process (`npx tsx worker.ts`), concurrency 5 |

## Architecture

```
Client → /api/v1/{service} → Middleware (x-api-key | NextAuth)
       → Runner (discriminate sub-case, load ProfileEndpoint overrides)
       → submitPipelineJob (save files, create Operation, enqueue BullMQ job)
       → Worker picks job → Pipeline engine (sequential steps) or Workflow engine (DAG)
       → Each step calls ExternalApiConnection (multipart/form-data)
       → Operation updated → Client polls GET /api/v1/operations/{id}
```

**Key patterns**: AIP-151 Long-Running Operations, idempotency keys, profile-driven overrides, pipeline chaining with session state, per-operation cost tracking.

## Directory Structure

```
app/                    # Next.js App Router (pages + API routes)
  api/v1/               # Public API: ingest, extract, analyze, transform, generate, compare, workflows, operations, services, billing
  api/internal/         # Admin API: apikeys, ext-connections, ext-overrides, profile-endpoints
  api/auth/             # NextAuth
  api/bull-board/       # BullMQ dashboard UI
  (pages)/              # UI: login, settings, profiles, history, api-connections, api-docs, etc.
components/             # React components (HeaderNav, SettingsForm, ServiceTestClient, ChatConsultant, etc.)
lib/
  auth.ts               # NextAuth config (CredentialsProvider, bcrypt, JWT)
  crypto.ts             # AES-256-GCM encryption for API keys in DB
  upload.ts             # File upload validation (100MB max, PDF/DOCX/XLSX/images)
  logger.ts             # Structured logging with correlation IDs
  settings.ts           # AppSetting read/write, prompt presets
  cleanup.ts            # Auto-delete uploaded files after 7 days
  endpoints/
    registry.ts         # SERVICE_REGISTRY: 6 services × N sub-cases with param schemas & connection chains
    presets.ts           # Extract field presets (invoice, contract, id-card, receipt, etc.)
    runner.ts            # Universal endpoint dispatcher → resolves sub-case, merges params, submits job
  pipelines/
    engine.ts           # Core pipeline executor (sequential steps, checkpoint/resume)
    submit.ts           # Job submission (idempotency, sync/async modes, file save)
    format.ts           # Operation response serialization
    processors/
      external-api.ts   # External API caller (multipart, prompt interpolation, session chaining)
    workflow-engine.ts   # Code-driven DAG orchestration (parallel + sequential steps)
    workflows/          # Registered workflows (e.g. disbursement)
  queue/
    pipeline-queue.ts   # BullMQ queue singleton (3 attempts, exponential backoff)
  parsers/              # Built-in parsers: XLSX (mammoth), DOCX (mammoth)
prisma/
  schema.prisma         # 7 models: Operation, ApiKey, ExternalApiConnection, ExternalApiOverride, ProfileEndpoint, AppSetting, User
  migrations/           # Incremental migrations
worker.ts               # Standalone BullMQ worker (routes to pipeline-engine or workflow-engine)
middleware.ts           # Auth: NextAuth for UI, x-api-key for /api/v1/
mock-service/           # Fake external API for testing
scripts/                # DB cleanup, migration, mock endpoint setup utilities
docs/                   # Architecture docs, integration guide, admin guide
```

## Database Models (Prisma)

| Model | Purpose |
|---|---|
| **Operation** | Long-running operation (state, pipeline steps, files, output, token usage, cost, webhook) |
| **ApiKey** | Client API keys (hashed, role, spending limit, status) |
| **ExternalApiConnection** | External AI service registry (URL, auth, prompt, response path, session chaining) |
| **ExternalApiOverride** | Per-client prompt overrides scoped to (connection, apiKey, endpointSlug, stepId) |
| **ProfileEndpoint** | Per-client endpoint config (enabled, locked params, connection override, job priority) |
| **AppSetting** | Key-value store (AI provider, model, encrypted API keys, prompt templates) |
| **User** | Auth users (username, bcrypt password, role: ADMIN/USER) |

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

**Supporting endpoints**: `GET /api/v1/operations/{id}` (poll status), `GET /api/v1/services` (list available), `GET /api/v1/billing/balance|usage`.

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
| `WORKER_CONCURRENCY` | BullMQ worker slots (default: 5) |
| `SYNC_TIMEOUT_MS` | Sync mode timeout (default: 30000) |
| `MIGRATION` | Auto-run prisma db push + seed on startup (true/false) |
| `MOCK_SERVICE_URL` | Mock service URL for testing (default: http://localhost:3099) |

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
