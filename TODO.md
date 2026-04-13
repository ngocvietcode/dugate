# Dugate Codebase Review — Consolidated Report

**Date:** 2026-04-13
**Reviewers:** 5 parallel agents (Security, Performance, Code Quality, Architecture, Spec Compliance)

## Executive Summary

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Security | 2 | 7 | 10 | 2 |
| Performance | 1 | 4 | 10 | 3 |
| Code Quality | — | 5 | 9 | 7 |
| Architecture | — | 3 | 6 | 4 |
| Worker | — | 2 | 4 | 2 |
| Spec Compliance | — | 2 non-compliant | 1 partial | — |
| **Total** | **3** | **~20** | **~34** | **~18** |

---

## CRITICAL Issues (Fix Immediately)

### C1. Plaintext API Keys in Database
**Files:** `app/api/internal/apikeys/route.ts`, `app/api/internal/auth-key/route.ts`
API keys stored as plaintext in `keyHash` field. Database compromise = full key exposure. Also inconsistent — some keys hashed with SHA-256, some plaintext.

### C2. Default Admin Credentials `admin:123456`
**File:** `prisma/seed.ts`
Hardcoded default password logged to console. No forced password change on first login.

### C3. Hardcoded Fallback Secrets
**Files:** `lib/crypto.ts`, `middleware.ts`, `lib/auth.ts`
`'fallback-dev-secret-12345'` and `'default_local_insecure_secret_key_dugate'` used when env vars missing. Production deployments without env vars use publicly known keys.

---

## HIGH Issues

### Security
| # | Issue | File(s) |
|---|-------|---------|
| H1 | **SSRF** — admin-configured URLs hit internal network | `lib/pipelines/processors/external-api.ts` |
| H2 | **No CSRF protection** on mutation endpoints | Multiple API routes |
| H3 | **Fallback master secret key** auth bypass | `app/api/internal/auth-key/route.ts` |
| H4 | **File path traversal** — `file.name` not sanitized | `lib/upload-helper.ts` |
| H5 | **No rate limiting** on any endpoint | All `/api/v1/` routes |
| H6 | **Curl command exposes auth secrets** in test response | `app/api/internal/ext-connections/[id]/test/route.ts` |

### Performance
| # | Issue | File(s) |
|---|-------|---------|
| H7 | **Files loaded fully into memory** (up to 300MB) | `lib/upload-helper.ts`, `lib/pipelines/processors/external-api.ts` |
| H8 | **Multiple redundant Redis connections** (4+) | `lib/queue/pipeline-queue.ts`, `worker.ts` |
| H9 | **No external API rate limiting** — can hammer Gemini/OpenAI | `lib/pipelines/processors/external-api.ts` |
| H10 | **Unbounded step results in memory** — multi-step pipelines accumulate | `lib/pipelines/engine.ts` |

### Code Quality
| # | Issue | File(s) |
|---|-------|---------|
| H11 | **Unhandled JSON.parse** — crashes on corrupt DB data | `lib/pipelines/format.ts` |
| H12 | **Silent webhook failures** — `catch {}` with no logging | `lib/pipelines/engine.ts` |
| H13 | **Sensitive data in curl logs** — form values not masked | `lib/pipelines/processors/external-api.ts` |

### Architecture
| # | Issue | File(s) |
|---|-------|---------|
| H14 | **God files** — runner.ts (298 lines), external-api.ts (400+ lines) | `lib/endpoints/runner.ts`, `lib/pipelines/processors/external-api.ts` |
| H15 | **Duplicate operation endpoints** — internal vs v1 nearly identical | `app/api/operations/`, `app/api/v1/operations/` |

### Spec Compliance
| # | Issue | Area |
|---|-------|------|
| H16 | **Cost tracking always returns 0** — no calculation logic | `lib/pipelines/processors/external-api.ts` |
| H17 | **Billing endpoints are mock-only** — hardcoded responses | `app/api/v1/billing/` |

---

## MEDIUM Issues

| Area | Issues |
|------|--------|
| **Security** | MIME type spoofing, race condition in cleanup, symlink attacks, insufficient authorization, no timeout cap on external calls |
| **Performance** | N+1 in profile-endpoints, missing Prisma `select`, large response payloads not paginated, JSON parsed multiple times, no DB query timeout, no disk quota checks |
| **Code Quality** | Error details leaked to client, missing file validation in pipelines, no retry on file I/O, excessive `any` types, inconsistent error format, race condition in workflow timeout |
| **Architecture** | Workflow engine re-exports Prisma, inconsistent error formats (RFC 9457 vs simple), magic strings/numbers scattered, mixed Vietnamese/English comments |
| **Worker** | Self-deadlock risk with workflow sub-steps, slot blocking via sync wait, no health check, no DLQ, no backpressure, string-based routing, redundant Redis connections |

---

## Fix Plan

### Phase 1 — Security Hardening (Week 1-2)

- [ ] Hash API keys with SHA-256 before storage, migrate existing keys **(CRITICAL, 1 day)**
- [ ] Remove all hardcoded fallback secrets, throw on missing env vars **(CRITICAL, 0.5 day)**
- [ ] Force strong password on first admin setup, remove seed logging **(CRITICAL, 0.5 day)**
- [ ] Sanitize `file.name` with `path.basename()` in upload-helper **(HIGH, 0.5 day)**
- [ ] Add SSRF protection — block private IP ranges in external URLs **(HIGH, 1 day)**
- [ ] Add rate limiting (Redis-based, per API key + IP) **(HIGH, 1-2 days)**
- [ ] Mask auth secrets in curl/test responses **(HIGH, 0.5 day)**
- [ ] Remove fallback master secret key auth path **(HIGH, 0.5 day)**

### Phase 2 — Worker Architecture (Week 2-3)

#### Critical Worker Issues

**W1. Self-Deadlock — workflows consume their own worker slots (HIGH)**
Single `pipeline` queue handles both parent workflows and sub-steps. Workflow holds 1 slot, enqueues N parallel sub-steps via `Promise.all()`. With concurrency=5 and N>4 files, sub-steps 5+ wait forever for a free slot — **deadlock**.
- Files: `worker.ts`, `lib/pipelines/workflow-engine.ts:90-92`, `lib/pipelines/workflows/disbursement.ts:58-71`
- Fix: Use separate queue for sub-steps, or BullMQ flow/parent-child, or cap parallel sub-steps to `concurrency - 1`

**W2. Slot Blocking — sync wait inside worker wastes concurrency (HIGH)**
`enqueueSubStep()` calls `job.waitUntilFinished(queueEvents, 120_000)` inside a running worker job. Parent holds its slot while doing zero CPU work. Sequential steps (crosscheck + report) can lock 1 slot for 4+ minutes.
- File: `lib/pipelines/workflow-engine.ts:94-97`
- Fix: Continuation pattern — parent completes after enqueuing, last sub-step resumes parent workflow

#### Other Worker Issues

- [ ] **Fix self-deadlock** — separate queue or BullMQ flows for workflow sub-steps **(HIGH, 2-3 days)**
- [ ] **Fix slot blocking** — continuation pattern for workflow sub-steps **(HIGH, 3-5 days)**
- [ ] Add worker health check in docker-compose **(MEDIUM, 0.5 day)**
- [ ] Add dead letter queue + alerting on final failure **(MEDIUM, 1 day)**
- [ ] Add backpressure — check queue depth before enqueuing, return 503 when full **(MEDIUM, 1 day)**
- [ ] Horizontal scaling strategy — `deploy.replicas` + separate worker pools per job type **(MEDIUM, 1 day)**
- [ ] Use explicit `type` field in PipelineJobData instead of string matching `job.name.includes('workflows:')` **(LOW, 0.5 day)**
- [ ] Consolidate redundant Redis connections (4+ per worker) into shared factory **(LOW, 0.5 day)**

### Phase 3 — Performance & Stability (Week 3-4)

- [ ] Stream large files instead of buffering (fs.createReadStream) **(HIGH, 1 day)**
- [ ] Add external API rate limiter (bottleneck/token bucket) **(HIGH, 1 day)**
- [ ] Truncate step results in memory, store full output to disk **(HIGH, 1 day)**
- [ ] Add `select` clauses to Prisma queries **(MEDIUM, 0.5 day)**
- [ ] Exclude `pipeline_steps` from list endpoint **(MEDIUM, 0.5 day)**
- [ ] Cache JSON.parse results in formatOperationResponse **(MEDIUM, 0.5 day)**
- [ ] Add DB query timeout via connection string **(MEDIUM, 0.5 day)**
- [ ] Worker memory monitoring + graceful drain at 90% **(MEDIUM, 0.5 day)**

### Phase 4 — Code Quality (Week 4-5)

- [ ] Wrap all JSON.parse calls in try-catch **(HIGH, 0.5 day)**
- [ ] Fix silent webhook catch blocks — add proper logging **(HIGH, 0.5 day)**
- [ ] Standardize error response format (RFC 9457 everywhere) **(MEDIUM, 1 day)**
- [ ] Add input validation on filter params, JSON fields **(MEDIUM, 0.5 day)**
- [ ] Replace `any` types in format.ts with Prisma types **(MEDIUM, 0.5 day)**
- [ ] Redact sensitive form fields in curl logging **(MEDIUM, 0.5 day)**
- [ ] Remove deprecated pdf-parser.ts **(LOW, 0.5 hour)**
- [ ] Replace console.log with structured logger **(LOW, 0.5 day)**

### Phase 5 — Architecture Refactoring (Week 5-6)

- [ ] Split runner.ts -> pipeline-builder.ts + profile-resolver.ts **(HIGH, 1 day)**
- [ ] Split external-api.ts -> prompt-resolver + http-client + response-parser **(HIGH, 1-2 days)**
- [ ] Consolidate duplicate operation endpoints **(MEDIUM, 0.5 day)**
- [ ] Centralize config into lib/config.ts (magic numbers, timeouts) **(MEDIUM, 0.5 day)**
- [ ] Create WORKFLOW_REGISTRY for auto-discovery **(MEDIUM, 1 day)**
- [ ] Standardize comments to English **(LOW, 0.5 day)**

### Phase 6 — Spec Compliance (Week 6-7)

- [ ] Implement cost calculation based on token count + model pricing **(HIGH, 2 days)**
- [ ] Replace mock billing endpoints with real DB queries **(HIGH, 1 day)**
- [ ] Enforce ApiKey.spendingLimit (return 402 when exceeded) **(HIGH, 0.5 day)**
- [ ] Add webhook retry with exponential backoff **(MEDIUM, 1 day)**
- [ ] Create OpenAPI spec in specs/ directory **(MEDIUM, 2 days)**

---

**Total estimated effort: ~6-7 weeks** for one developer. Priority: Phase 1 (Security) → Phase 2 (Worker deadlock) → Phase 3 (Performance) → rest.
