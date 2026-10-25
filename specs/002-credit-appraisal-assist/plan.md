# Plan 002: `credit-appraisal-assist`

## Cách tiếp cận

### Hai phase
- **Phase A — Khung Apps** (dùng chung cho mọi App, thay spec 001): Temporal dev, cấu trúc `apps/`, Workflow Service Contract, `core-client`, activity `callCore`, projection `AppRun`, audit, review task, webhook.
- **Phase B — App** `credit-appraisal-assist`: schema, rule, metric, workflow, memo, workbench.

### Quyết định kỹ thuật
| # | Quyết định | Lý do |
|---|---|---|
| P1 | `apps/` là package Node riêng trong repo (npm workspace), entry `apps/server.ts` (Hono — đã có trong dependencies) + `apps/worker.ts` (Temporal) | L1; không đụng build Next.js của Core |
| P2 | Apps có DB schema riêng `apps` trên cùng PostgreSQL (dev), Drizzle; không dùng bảng của Core | §7 LAYERED; constitution L2 |
| P3 | Rule & metric là **hàm thuần** `(input) => Finding[] / Metric`, khai báo id + version, test bằng bảng case | Agent thêm rule an toàn; nghiệp vụ đọc test |
| P4 | Decimal: `decimal.js` (hoặc bigint theo đồng) — chốt ở T-B2 | Constitution §9 |
| P5 | Gọi Core v1: submit async + poll có heartbeat; idempotency key `runId:stepKey` | LAYERED §6.3 |
| P6 | Workbench v1: trang Next.js tối giản trong `apps/web` hoặc route của Hono render SSR — chốt ở T-A8; deep-link có token ngắn hạn | Q1 |
| P7 | Memo: template Handlebars-style render bảng số; phần diễn giải gọi `generate:report` với file markdown dữ liệu đã soát đính kèm | `generate:report` không có tham số (registry) |
| P8 | Workflow chỉ chứa điều phối; mọi rule/metric chạy trong activity `evaluate` (thuần nhưng import thư viện decimal) hoặc trực tiếp trong workflow nếu bundle được — ưu tiên **trong workflow** vì thuần & deterministic, giúp replay | Ít activity, history gọn |

## Cấu trúc file

```
apps/
  package.json  tsconfig.json  CLAUDE.md          # luật tầng Apps cho agent
  server.ts                                       # /apps/v1/* (Hono)
  worker.ts                                       # Temporal worker
  platform/                                       # Phase A — dùng chung
    contract/      run.ts finding.ts evidence.ts events.ts   (Zod)
    core-client/   index.ts                       # gọi /api/v1/docs/*, idempotency, poll
    activities/    core.ts projection.ts audit.ts webhook.ts review.ts
    workflow-kit/  review.ts progress.ts          # helper deterministic: chờ soát, query progress
    db/            schema.ts migrations/
    security/      hmac.ts auth.ts maker-checker.ts
  credit-appraisal-assist/                        # Phase B
    app.yaml  README.md
    schema.ts                 # context, output
    doc-types.ts              # Phụ lục A
    extraction/   fin-bs.ts fin-is.ts tax.ts legal.ts collateral.ts ... (schema + mapping B01-DN/B01-DNN)
    normalize.ts
    rules/        completeness.ts consistency/*.ts policy.ts   (+ *.test.ts)
    metrics/      liquidity.ts leverage.ts profitability.ts activity.ts wc-need.ts dscr.ts ltv.ts (+ tests)
    memo/         template.md render.ts narrative-guard.ts
    workflow.ts   workflow.test.ts   histories/
  test/fixtures/credit-appraisal/                 # hồ sơ giả lập (không dữ liệu thật)
docker-compose.yml                                # + temporal, temporal-ui
mock-service/                                     # + response giả cho classify/extract SME
```

## Kiểm thử
- **Unit**: mỗi rule/metric/normalize với bảng case (gồm biên: số âm, đơn vị triệu, kỳ thiếu).
- **Workflow test**: `TestWorkflowEnvironment.createTimeSkipping()`, activity Core mock → kiểm tra thứ tự bước, chờ soát, timeout soát 10 ngày, maker≠checker.
- **Replay test**: history ghi từ workflow test lưu `histories/`, chạy trong `npm test`.
- **Contract test**: Zod schema của run/finding với fixture; `core-client` với mock-service.
- **Golden set** (khi có Q5): script `apps:eval credit-appraisal-assist` so trường trích xuất + metric với bảng đối chứng.

## Rollout & rollback
- Chỉ bật cho caller có ApiKey/profile được cấp; App độc lập với Core — tắt App không ảnh hưởng `/api/v1/docs/*`.
- Migration DB schema `apps` tách biệt; rollback = tắt server/worker Apps.
