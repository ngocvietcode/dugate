# Tasks 002: `credit-appraisal-assist`

> Chỉ bắt đầu `/implement` khi spec **Approved** (Q1–Q4 có trả lời; Phase A có thể bắt đầu sớm vì không phụ thuộc Q1–Q4 trừ Q1 cho T-A8).
> Mỗi task: một phiên agent, có lệnh kiểm chứng.

## Phase A — Khung Apps

- [ ] **T-A1 — Workspace `apps/` + Temporal dev**
  - File: `package.json` (workspaces), `apps/package.json`, `apps/tsconfig.json`, `apps/CLAUDE.md`, `docker-compose.yml` (+`temporal`, `temporal-ui`), `.env.example`
  - Kiểm chứng: `docker compose up -d temporal temporal-ui` → UI `:8233`; `npm -w apps run typecheck` xanh; `npm run build` của Core không đổi

- [ ] **T-A2 — Lint ranh giới tầng**
  - File: ESLint config cho `apps/**` (cấm import `@/lib/**`, `../lib/**`), cho `apps/**/workflow.ts` và `workflow-kit/**` (cấm I/O)
  - Phụ thuộc: T-A1
  - Kiểm chứng: file thử import `@/lib/db` trong `apps/` → lint fail

- [ ] **T-A3 — Contract (Zod)**
  - File: `apps/platform/contract/*.ts` + test
  - Kiểm chứng: `npm -w apps test -- contract` xanh; schema export JSON Schema cho tài liệu

- [ ] **T-A4 — DB schema `apps`**
  - File: `apps/platform/db/schema.ts` (`AppRun`, `ReviewTask`, `Finding`, `AppAuditEvent` hash-chain, `RuleSetVersion`), migration
  - Kiểm chứng: migration chạy trên DB dev; test append-only (UPDATE/DELETE `AppAuditEvent` bị từ chối)

- [ ] **T-A5 — `core-client` + activity `callCore`**
  - File: `apps/platform/core-client/index.ts`, `apps/platform/activities/core.ts` + test với mock-service
  - Kiểm chứng: gọi 2 lần cùng `runId:stepKey` → 1 Operation ở Core; lỗi 4xx → `ApplicationFailure` non-retryable

- [ ] **T-A6 — Activities projection / audit / webhook**
  - File: `apps/platform/activities/{projection,audit,webhook}.ts`, `security/hmac.ts` + test
  - Kiểm chứng: webhook có header chữ ký HMAC đúng; retry khi 5xx

- [ ] **T-A7 — workflow-kit: chờ soát + progress + maker-checker**
  - File: `apps/platform/workflow-kit/{review,progress}.ts`, `security/maker-checker.ts`, workflow test mẫu
  - Kiểm chứng: time-skipping test: decision từ maker bị từ chối; quá hạn → `REVIEW_TIMEOUT`

- [ ] **T-A8 — Server `/apps/v1/*` + worker**
  - File: `apps/server.ts`, `apps/worker.ts`, auth (OIDC token / client credentials)
  - Phụ thuộc: T-A3..T-A7 (Q1 cho deep-link)
  - Kiểm chứng: start → run hiện trên Temporal UI; `GET /runs/{id}` trả projection; cancel hoạt động

## Phase B — App

- [ ] **T-B1 — Schema context/output + doc-types + app.yaml**
  - File: `apps/credit-appraisal-assist/{schema,doc-types}.ts`, `app.yaml`, `README.md`
  - Kiểm chứng: context thiếu `applicant.taxCode` → 400 với đường dẫn lỗi (FR-3)

- [ ] **T-B2 — Normalize + decimal**
  - File: `normalize.ts` + test (đơn vị nghìn/triệu, số trong ngoặc, dấu phân cách VN)
  - Kiểm chứng: bảng ≥ 20 case xanh

- [ ] **T-B3 — Schema trích xuất & mapping BCTC**
  - File: `extraction/*.ts` (B01-DN, B01-DNN, B02, thuế, pháp lý, TSBĐ) + test mapping
  - Kiểm chứng: fixture JSON trích xuất → object chuẩn hóa đúng

- [ ] **T-B4 — Rules completeness + consistency (CON-1..CON-8)**
  - File: `rules/completeness.ts`, `rules/consistency/*.ts` + test
  - Phụ thuộc: T-B2, T-B3
  - Kiểm chứng: AC-2, AC-5 ở mức unit; CON-7 luôn trả `NEEDS_JUDGMENT`, không PASS/FAIL

- [ ] **T-B5 — Metrics FIN-1..FIN-8**
  - File: `metrics/*.ts` + test theo bảng tính đối chứng (fixture)
  - Kiểm chứng: AC-6 trên fixture giả lập

- [ ] **T-B6 — Policy RuleSet + đánh giá**
  - File: `rules/policy.ts`, seed RuleSet mẫu (DRAFT/APPROVED), maker-checker phê duyệt version
  - Kiểm chứng: AC-7

- [ ] **T-B7 — Workflow**
  - File: `workflow.ts`, `workflow.test.ts`, `histories/`
  - Phụ thuộc: T-A7, T-B1..T-B6
  - Kiểm chứng: workflow test toàn luồng với Core mock; replay test xanh; AC-4, AC-9 (mức test)

- [ ] **T-B8 — Memo + narrative guard**
  - File: `memo/{template.md,render.ts,narrative-guard.ts}` + test, xuất docx
  - Phụ thuộc: T-B5 (Q3 cho mẫu thật)
  - Kiểm chứng: AC-8; bảng số trong memo = metrics

- [ ] **T-B9 — Workbench soát**
  - File: theo P6
  - Phụ thuộc: T-A8, T-B7 (Q1)
  - Kiểm chứng: AC-3; sửa giá trị yêu cầu lý do; audit trước/sau

- [ ] **T-B10 — Mock-service SME + E2E**
  - File: `mock-service/` (response classify/extract cho fixture), `apps/test/e2e/credit-appraisal.e2e.test.ts`
  - Kiểm chứng: AC-1, AC-10, AC-11 end-to-end với mock

- [ ] **T-B11 — Eval golden set** (chờ Q5)
  - File: `apps/scripts/eval.ts`
  - Kiểm chứng: báo cáo độ chính xác theo trường; NFR-7
