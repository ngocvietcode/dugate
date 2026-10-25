# Tasks 001: Temporal foundation + pilot `doc-compare`

> Bản nháp. Chỉ bắt đầu `/implement` sau khi spec chuyển trạng thái **Approved** và có `plan.md`.

- [ ] **T1 — Temporal trong docker-compose (dev)**
  - File: `docker-compose.yml` (thêm `temporal`, `temporal-ui`), `.env.example`
  - Kiểm chứng: `docker compose up -d temporal temporal-ui` → UI ở `localhost:8233`, `temporal operator namespace list` có `default`

- [ ] **T2 — Dependencies & client**
  - File: `package.json` (`@temporalio/client`, `worker`, `workflow`, `activity`, `testing`), `lib/temporal/client.ts`
  - Kiểm chứng: `npx tsc --noEmit` xanh

- [ ] **T3 — Payload codec**
  - File: `lib/temporal/codec.ts`, `tests/temporal/codec.test.ts`
  - Kiểm chứng: test encode→decode round-trip; payload đã mã hóa không chứa chuỗi gốc

- [ ] **T4 — Activities connector + projection**
  - File: `lib/temporal/activities/connector.ts`, `lib/temporal/activities/projection.ts`, test với mock DB/HTTP
  - Phụ thuộc: T2
  - Kiểm chứng: `npm test -- temporal/activities` xanh; lỗi HTTP 4xx ném `ApplicationFailure` non-retryable

- [ ] **T5 — Workflow `docCompare`**
  - File: `lib/temporal/workflows/doc-compare.ts`, `tests/temporal/doc-compare.workflow.test.ts`
  - Phụ thuộc: T4
  - Kiểm chứng: workflow test với activity mock tái tạo đúng 4 bước & thứ tự gọi

- [ ] **T6 — Worker process + lint determinism**
  - File: `lib/temporal/worker.ts`, script `temporal:worker`, rule ESLint `no-restricted-imports` cho `lib/temporal/workflows/**`
  - Phụ thuộc: T5
  - Kiểm chứng: worker khởi động, đăng ký task queue `dugate-orchestrator`; import `@/lib/db` trong workflow làm lint fail

- [ ] **T7 — Feature flag ở API + cancel**
  - File: `lib/endpoints/runner.ts` hoặc `lib/pipelines/submit.ts`, `app/api/v1/operations/[id]/cancel/route.ts`
  - Phụ thuộc: T6
  - Kiểm chứng: AC-4, AC-5

- [ ] **T8 — Replay test + tiêu chí durability**
  - File: `lib/temporal/workflows/histories/doc-compare-*.json`, `tests/temporal/replay.test.ts`
  - Phụ thuộc: T7
  - Kiểm chứng: AC-2, AC-3, AC-6
