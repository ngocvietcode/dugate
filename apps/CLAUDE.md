# apps/ — tầng Apps (Workflow-as-a-Service)

Đọc trước: `docs/constitution.md` (đặc biệt L1–L5, §6, §8, §10–§14), `docs/enterprise/LAYERED_ARCHITECTURE.md`, ADR-0001..0003, spec của App đang làm trong `specs/`.

## Bố cục
```
apps/
  src/platform/          # dùng chung mọi App
    contract/            # Zod: Workflow Service Contract (StartRunRequest, RunView, Finding, ReviewTask, RunEvent)
    core-client/         # gọi Core qua API công khai /api/v1/docs/* — KHÔNG import code Core
    activities/          # side effect: Core, projection, audit, webhook (chạy trong worker)
    workflow-kit/        # helper TẤT ĐỊNH dùng trong workflow (chờ soát, maker-checker, progress)
    db/                  # schema `apps` (migration SQL là nguồn sự thật) + Drizzle
    audit.ts, codec.ts, security/
  src/<app>/             # mỗi App một thư mục: app.yaml, schema.ts, workflow.ts, activities.ts, *.test.ts
  src/server.ts          # /apps/v1/* (Hono)
  src/worker.ts          # Temporal worker TypeScript
  credit-kit/            # thư viện miền tín dụng: lac/ (Python, worker riêng), config/, contracts/
```

## Luật
1. Không import code Core (`@/lib/*`, `../lib`). Lint chặn (`test/lint-boundaries.test.ts`).
2. File workflow (`workflow.ts`, `workflow-kit/`, `merge.ts`, `verify.ts`) chỉ chứa logic tất định: không I/O, không `fetch`, không `process`, chỉ import KIỂU từ activities. Mọi side effect là activity.
3. Activity phải idempotent: gọi Core với `Idempotency-Key = runId:stepKey`.
4. Mọi thay đổi workflow phải pass replay test (`histories/`); thay đổi không tương thích dùng `patched()`.
5. Không log giá trị trường của người; log mã run/task/F#/X#.
6. Dữ liệu nghiệp vụ chỉ nhận qua `context` của request (L6); App không gọi LOS/Core banking.
7. Kết quả là trạng thái hồ sơ + bằng chứng; KHÔNG có đề xuất cho vay/từ chối.
8. Test dùng PGlite (PostgreSQL trong tiến trình) và Temporal dev server; không cần Docker.

## Lệnh
```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run db:migrate            # APPS_DATABASE_URL
npm run server / npm run worker
```
Temporal dev server cho test: biến `TEMPORAL_CLI` trỏ tới binary `temporal` (xem README).
