# dugate v5 — Kiến trúc Enterprise cho Ngân hàng

| Mục | Giá trị |
|---|---|
| Trạng thái | **DRAFT — chờ quyết định** (xem §10 Quyết định mở) |
| Phiên bản đích | 5.0.0 (hiện tại `package.json` = 4.12.0) |
| Quyết định nền tảng | [ADR-0001: Temporal làm orchestration engine](../adr/0001-temporal-orchestration.md) |
| Quy tắc bất biến | [docs/constitution.md](../constitution.md) |
| Feature đầu tiên | [specs/001-temporal-foundation](../../specs/001-temporal-foundation/spec.md) |

---

## 1. Mục tiêu

1. **Độ bền tác vụ (durability) cấp ngân hàng**: mọi hồ sơ (giải ngân, L/C, so sánh hợp đồng…) không bao giờ mất hoặc chạy lặp, kể cả khi worker/Redis/DB restart giữa chừng; quy trình chờ người duyệt nhiều ngày vẫn an toàn.
2. **Kiểm soát & tuân thủ**: maker-checker, audit trail bất biến, truy vết được *mô hình + prompt + dữ liệu nào* đã sinh ra mỗi kết quả AI.
3. **Bảo mật dữ liệu khách hàng**: mã hóa end-to-end trong orchestration, không để PII nằm cleartext trong log/queue/history, kiểm soát luồng dữ liệu ra LLM bên ngoài.
4. **Vận hành**: HA/DR, observability (trace/metric/log), SLO rõ ràng.
5. **Phát triển bằng AI Agent hiệu quả**: kiến trúc có ranh giới rõ, mỗi tính năng mới là một "công thức" lặp lại được, có guardrail tự động (lint, replay test, eval) để agent không phá vỡ hệ thống.

Ngoài phạm vi: thay đổi contract public API `/api/v1/*` (AIP-151 Operations giữ nguyên để client hiện tại không phải sửa).

---

## 2. Hiện trạng & khoảng trống (đã kiểm tra trong code)

| # | Hiện trạng | Bằng chứng | Rủi ro với ngân hàng |
|---|---|---|---|
| G1 | Workflow engine tự viết: sub-step chờ bằng `job.waitUntilFinished()` trong khi **giữ slot worker** của parent | `lib/pipelines/workflow-engine.ts` `enqueueSubStep()` | Worker crash giữa bước song song → mất kết quả in-flight, chạy lại từ checkpoint; dễ cạn slot, timeout giả (đã có code xử lý "pub/sub race") |
| G2 | Checkpoint thủ công qua `currentStep` + `stepsResultJson`; mỗi workflow tự viết logic `if (resumeFromStep <= n)` và tự restore biến | `workflows/disbursement.ts`, `lc-checker.ts`, `doc-compare.ts` | Mỗi workflow mới lặp lại boilerplate dễ sai; agent viết thêm workflow rất dễ quên restore state |
| G3 | HITL resume không kiểm tra quyền sở hữu operation, không maker-checker, dữ liệu người sửa ghi đè trực tiếp chỉ kèm cờ `is_human_edited` | `app/api/v1/operations/[id]/resume/route.ts` | Vi phạm nguyên tắc 4-eyes; không chứng minh được ai đã sửa gì |
| G4 | Không có audit log nghiệp vụ (chỉ có application log) | không có bảng audit trong `lib/db/schema.ts` | Không đáp ứng yêu cầu kiểm toán nội bộ / thanh tra |
| G5 | Webhook của workflow không retry, không ký HMAC | `workflow-engine.ts` `sendWebhook()` | Mất thông báo; bên nhận không xác thực được nguồn |
| G6 | JSON lưu dạng `text` (`pipelineJson`, `stepsResultJson`, `extractedData`…), tiền tệ `doublePrecision` | `lib/db/schema.ts` | Khó truy vấn/kiểm tra toàn vẹn; sai số làm tròn chi phí |
| G7 | Giá trị mặc định nguy hiểm: `SEED_ADMIN_KEY=sk-admin-default-secret-key`, `SEED_ADMIN_PASSWORD=123456`; `NODE_TLS_REJECT_UNAUTHORIZED=0` lúc build | `docker-compose.yml`, `Dockerfile` | Không qua được security review |
| G8 | Redis không persistence; secrets qua env (`ENCRYPTION_KEY`) | `docker-compose.yml` | Mất queue khi restart; không có key rotation/HSM |
| G9 | Test mỏng: 1 unit test + e2e cần môi trường đầy đủ | `tests/pipelines/external-api.test.ts` | Agent không có feedback loop nhanh để tự kiểm chứng |
| G10 | Tài liệu cho agent sai lệch: `CLAUDE.md` ghi Prisma 5 / v1.5.0 / route `/api/v1/{service}` trong khi code dùng **Drizzle** / v4.12.0 / route `/api/v1/docs/{service}`; `.claude/commands/*` tham chiếu `docs/constitution.md`, `docs/security-requirements.md`, `docs/architecture.md`, `specs/001-convert-engine` **không tồn tại** | `CLAUDE.md`, `.claude/commands/review.md` | Agent đọc sai ngữ cảnh → sinh code sai ngay từ đầu |

---

## 3. Kiến trúc đích

```
                ┌──────────────── Bank network / DMZ ───────────────┐
 Client/Core ──▶│ API Gateway (WAF, mTLS, rate limit)               │
 banking, LOS   └──────────────┬────────────────────────────────────┘
                               ▼
              ┌─────────────────────────────────┐
              │ apps/web  (Next.js)             │  UI + /api/v1/docs/* (AIP-151 giữ nguyên)
              │  - AuthN: OIDC (IdP ngân hàng)  │  start/signal/update/query workflow
              │  - AuthZ: RBAC + maker-checker  │  KHÔNG chạy xử lý nặng
              └──────┬───────────────┬──────────┘
                     │ gRPC (mTLS)   │ SQL
                     ▼               ▼
      ┌────────────────────────┐   ┌───────────────────────────────┐
      │ Temporal Cluster       │   │ PostgreSQL (app)              │
      │ (self-hosted, HA)      │   │  Operation (projection), Audit│
      │ persistence: Postgres  │   │  Connector, Prompt registry…  │
      │ namespace / môi trường │   └───────────────────────────────┘
      └──────┬─────────────────┘
             │ task queues
   ┌─────────┼──────────────────────────┬──────────────────────────┐
   ▼         ▼                          ▼                          ▼
 apps/worker              apps/worker                    apps/worker
 [orchestrator]           [ai-activities]                [doc-activities]
 workflows (deterministic) gọi ExternalApiConnection     parse/convert/OCR (CPU)
                           rate-limit theo connector      sharp, pandoc, gs
                                │
                                ▼
                 LLM / DU services (on-prem hoặc đã phê duyệt)
                 qua egress proxy + PII redaction

 Object storage (S3/MinIO on-prem, SSE-KMS)  ◀── file gốc & kết quả lớn (claim-check)
 Vault / HSM  ◀── khóa mã hóa payload, secrets connector
 OpenTelemetry → Tempo/Jaeger, Prometheus, Loki/ELK → SIEM ngân hàng
```

### 3.1 Vì sao Temporal (tóm tắt — chi tiết trong ADR-0001)

- **Durable execution**: code workflow viết như hàm async bình thường; Temporal lưu event history và replay → không cần `currentStep`, `stepsResultJson`, stalled-job recovery, DLQ thủ công.
- **HITL native**: `condition()` + Update/Signal; chờ duyệt nhiều ngày không tốn tài nguyên worker.
- **Retry/timeout khai báo** cho từng activity; phân biệt lỗi retryable / non-retryable.
- **Event history = audit trail kỹ thuật** của từng hồ sơ (ai signal gì, lúc nào, input/output của từng bước).
- **TypeScript SDK** khớp stack hiện tại; self-host được (MIT) → đáp ứng yêu cầu dữ liệu nằm trong hạ tầng ngân hàng.
- **Thân thiện với AI agent**: quy trình là *code* có test với time-skipping, không phải BPMN XML; có replay test phát hiện thay đổi phá vỡ workflow đang chạy.

### 3.2 Ánh xạ khái niệm hiện tại → v5

| Hiện tại (BullMQ) | v5 (Temporal) |
|---|---|
| `Operation` row là nguồn sự thật về trạng thái | Workflow Execution là nguồn sự thật; `Operation` thành **projection** (cập nhật bởi activity `recordProgress`) để giữ API AIP-151 và UI lịch sử |
| `idempotencyKey` kiểm tra trong `submit.ts` | `workflowId = op_<idempotencyKey hoặc uuid>` + `WorkflowIdReusePolicy`/`WorkflowIdConflictPolicy` |
| `enqueueSubStep()` + `waitUntilFinished` | `proxyActivities<ConnectorActivities>()` — gọi connector là **activity**; nhóm bước lớn → child workflow |
| `Promise.all` sub-steps | `Promise.all` activities (Temporal đảm bảo durable từng activity) |
| `pauseWorkflow()` + `WAITING_USER_INPUT` + `/resume` | Update `submitReview` có validator (quyền, maker≠checker) + `await condition(() => review !== undefined, '72h')` |
| `currentStep` / restore biến thủ công | Xóa — biến cục bộ của workflow tự được khôi phục qua replay |
| `/cancel` | `handle.cancel()` → `CancellationScope`, activity dọn dẹp |
| `updateProgress()` | Query `progress` (đọc realtime) + activity cập nhật projection |
| Webhook trong engine | Activity `deliverWebhook` (retry, HMAC-SHA256, timeout) |
| Stalled job recovery, memory pause | Do Temporal + worker tuning (`maxConcurrentActivityTaskExecutions`) đảm nhiệm |
| Pipeline UI-configured (`engine.ts`) | Một workflow tổng quát `configurablePipeline` thông dịch `PipelineStep[]` — **snapshot cấu hình tại thời điểm start** (đảm bảo determinism & truy vết) |
| `jobPriority` HIGH/MEDIUM/LOW | Task queue riêng theo mức ưu tiên hoặc Priority của Temporal (tùy phiên bản server) |
| Cost tracking cộng dồn trong context | Activity trả `usage`; workflow cộng dồn; ghi vào projection + bảng `UsageLedger` (numeric) |

### 3.3 Ví dụ workflow v5 (định hướng, không phải code cuối)

```ts
// packages/workflows/src/disbursement/workflow.ts  — CHỈ code deterministic
import { proxyActivities, defineUpdate, defineQuery, setHandler, condition } from '@temporalio/workflow';
import type * as acts from '@dugate/activities';
import { DisbursementInput, ReviewDecision } from './schema';

const ai = proxyActivities<typeof acts.connectors>({
  taskQueue: 'ai-activities',
  startToCloseTimeout: '5m',
  retry: { maximumAttempts: 5, nonRetryableErrorTypes: ['ConnectorValidationError'] },
});
const sys = proxyActivities<typeof acts.system>({ startToCloseTimeout: '30s' });

export const submitReview = defineUpdate<void, [ReviewDecision]>('submitReview');
export const progressQuery = defineQuery<{ percent: number; message: string }>('progress');

export async function disbursement(input: DisbursementInput): Promise<DisbursementOutput> {
  let progress = { percent: 0, message: 'Bắt đầu' };
  let review: ReviewDecision | undefined;
  setHandler(progressQuery, () => progress);
  setHandler(submitReview, (d) => { review = d; }, {
    validator: (d) => assertChecker(d, input.makerUserId), // checker ≠ maker, đúng role
  });

  const classified = await Promise.all(input.files.map((f) => ai.classify({ fileRef: f, promptRef: input.prompts.classify })));
  const extracted  = await Promise.all(classified.flatMap(splitLogicalDocs).map((d) => ai.extract(d)));
  progress = { percent: 55, message: 'Chờ cán bộ thẩm định duyệt' };
  await sys.recordState({ operationId: input.operationId, state: 'WAITING_USER_INPUT', progress });

  if (!(await condition(() => review !== undefined, '72h'))) throw ApplicationFailure.nonRetryable('Review timeout', 'ReviewTimeout');
  // review!.edits được audit qua event history + bảng AuditEvent (activity)
  const cross  = await ai.crosscheck(applyEdits(extracted, review!.edits));
  const report = await ai.report(cross);
  return { report, cross };
}
```

---

## 4. Yêu cầu đặc thù ngân hàng

### 4.1 Bảo mật & dữ liệu
- **mTLS** giữa web ↔ Temporal ↔ worker; Temporal namespace riêng cho từng môi trường (dev/uat/prod), có thể theo đơn vị nghiệp vụ.
- **Payload Codec** (AES-256-GCM, khóa từ Vault/HSM, có `keyId` để rotate) → event history trong DB Temporal không chứa PII dạng rõ. Temporal UI xem payload qua **Codec Server** có xác thực.
- **Claim-check**: file và kết quả lớn nằm ở object storage; workflow chỉ truyền `fileRef` (key + sha256). Không đưa nội dung tài liệu vào history (giới hạn ~2MB/payload).
- **Phân loại dữ liệu & kiểm soát egress**: connector có thuộc tính `dataClassification` và `allowedDataLevels`; activity từ chối gửi dữ liệu mật tới connector không được phép; tùy chọn PII redaction (CCCD, số tài khoản, SĐT) trước khi gửi LLM ngoài.
- **Secrets**: Vault (hoặc KMS ngân hàng) thay `ENCRYPTION_KEY` env; secrets connector (`authSecret`) mã hóa bằng envelope encryption.
- **Log**: không log raw response LLM ở mức INFO (hiện `disbursement.ts` log toàn bộ `result.content`); masking PII trong logger.
- Loại bỏ mọi giá trị mặc định yếu (G7); container non-root, image ký số, SBOM, quét lỗ hổng trong CI.
- Đối chiếu khung pháp lý (cần bộ phận Pháp chế/ATTT xác nhận): Thông tư 09/2020/TT-NHNN (an toàn hệ thống thông tin ngân hàng), Nghị định 13/2023/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân (dữ liệu cá nhân), chính sách thuê ngoài/điện toán đám mây nội bộ.

### 4.2 Kiểm soát nghiệp vụ
- **Maker-checker** ở 2 tầng:
  1. *Vận hành hồ sơ*: người duyệt HITL phải khác người tạo; role theo bước (vd. `CREDIT_OFFICER` sửa, `CREDIT_APPROVER` duyệt).
  2. *Cấu hình*: thay đổi connector, prompt, profile endpoint đi qua trạng thái `PENDING_APPROVAL` → có người thứ hai duyệt mới có hiệu lực.
- **Audit trail bất biến**: bảng `AuditEvent` append-only (chặn UPDATE/DELETE bằng quyền DB + trigger), mỗi bản ghi có `prevHash`/`hash` (hash chain) — ai, làm gì, đối tượng, trước/sau, IP, correlationId. Xuất định kỳ sang SIEM/WORM storage.
- **Retention**: chính sách lưu theo loại hồ sơ (cấu hình được); Temporal retention ngắn (vd. 30 ngày) + **export history** sang archival storage cho lưu trữ dài hạn.

### 4.3 Quản trị AI (Model Risk Management)
- **Prompt Registry có version**: prompt là bản ghi `PromptVersion` (immutable, có trạng thái DRAFT → APPROVED); workflow nhận `promptRef = {id, version}` lúc start. Thay thế 3 tầng override hiện tại bằng resolution chạy *một lần* ở API layer, kết quả snapshot vào input workflow.
- **Truy vết quyết định**: mỗi lời gọi AI lưu `connector`, `model`, `promptVersion`, `inputSha256`, `outputSha256`, token, chi phí, latency → giải trình được với kiểm toán.
- **Ngưỡng tin cậy → HITL**: kết quả extract/classify dưới ngưỡng (hoặc crosscheck có sai lệch) bắt buộc đi qua review, không tự động pass.
- **Bộ đánh giá (golden set)**: mỗi workflow có tập hồ sơ mẫu đã ẩn danh + kết quả kỳ vọng; chạy eval khi đổi prompt/model; kết quả eval là điều kiện để duyệt `PromptVersion`.

### 4.4 Vận hành
- **HA**: Temporal services ≥ 2 replica mỗi loại, Postgres HA (Patroni hoặc tương đương của ngân hàng); workers scale ngang theo task queue backlog.
- **DR**: RPO/RTO cần chốt (§10). Phương án: replicate Postgres sang site DR + Temporal multi-cluster replication (nếu yêu cầu RTO thấp).
- **Observability**: `@temporalio/interceptors-opentelemetry` → trace xuyên suốt API → workflow → activity → connector; metrics SDK/Server vào Prometheus; dashboard + alert (backlog task queue, activity failure rate, workflow chờ review quá SLA).
- **Triển khai**: Kubernetes/OpenShift + Helm; migration DB bằng `drizzle-kit` chạy như job riêng (không `db push` khi khởi động ở prod).

---

## 5. Thiết kế để phát triển bằng AI Agent

Nguyên tắc: **agent làm tốt khi bối cảnh đúng, phạm vi hẹp, và có máy kiểm tra thay cho người**.

### 5.1 Cấu trúc repo (đích)

```
apps/
  web/                    # Next.js: UI + /api/v1 (chỉ start/signal/query workflow, đọc projection)
  worker/                 # entrypoint các worker (orchestrator / ai-activities / doc-activities)
packages/
  contracts/              # Zod schema + types: input/output workflow, API DTO, sự kiện audit
  workflows/              # CHỈ code deterministic. Lint cấm import db, fs, fetch, Date.now...
    src/<workflow>/
      workflow.ts         # orchestration
      schema.ts           # Zod input/output (re-export từ contracts)
      prompts.ts          # prompt builder thuần (pure function)
      workflow.test.ts    # TestWorkflowEnvironment (time-skipping), activity mock
      histories/*.json    # history mẫu cho replay test
      README.md           # mục đích, DAG, các điểm HITL, SLA
  activities/             # side effects: connectors, storage, audit, webhook, projection
  connectors/             # HTTP client, SSRF guard, auth, response parser (từ lib/pipelines/processors)
  db/                     # Drizzle schema + migrations
  security/               # crypto, payload codec, PII masking, RBAC/maker-checker policy
docs/
  constitution.md         # luật bất biến — agent đọc trước mọi task
  adr/                    # quyết định kiến trúc
  enterprise/             # tài liệu này
specs/NNN-<feature>/      # spec.md → plan.md → tasks.md (khớp /clarify, /implement)
```

Có thể đi từ cấu trúc hiện tại sang dần dần (§6, Phase 0–3); ranh giới module được áp dụng bằng lint ngay cả trước khi tách package.

### 5.2 "Công thức" thêm workflow mới (lặp lại được)
1. `specs/NNN-<tên>/spec.md` theo template → chạy `/clarify` → người chốt câu hỏi.
2. `npm run new:workflow <tên>` (scaffold) sinh đủ: `workflow.ts`, `schema.ts`, `prompts.ts`, `workflow.test.ts`, `README.md`, đăng ký vào registry.
3. Agent chỉ điền logic trong các file đã sinh; `/implement` từng task trong `tasks.md`.
4. CI gate bắt buộc xanh: typecheck, lint (determinism + ranh giới module), unit, workflow test, **replay test**, eval golden set (nếu đổi prompt).

### 5.3 Guardrail tự động (máy kiểm tra thay người)
| Guardrail | Bắt lỗi gì |
|---|---|
| Temporal workflow bundler + ESLint `no-restricted-imports` trong `packages/workflows` | Code non-deterministic (I/O, `Math.random`, thư viện node) lọt vào workflow |
| `Worker.runReplayHistories()` trên `histories/*.json` | Thay đổi phá workflow đang chạy dở (đặc biệt hồ sơ đang chờ duyệt nhiều ngày) → buộc dùng `patched()` / worker versioning |
| Zod contract test | Đổi shape input/output làm vỡ API/client |
| Golden-set eval | Đổi prompt/model làm giảm chất lượng trích xuất |
| `/security-audit` + quét SAST/secret trong CI | Lộ secret, bỏ qua kiểm tra quyền |
| Lệnh test nhanh không cần hạ tầng (`npm test` < 1 phút, Temporal test env in-process) | Cho agent vòng phản hồi nhanh để tự sửa |

### 5.4 Tài liệu cho agent
- `CLAUDE.md` ngắn, **đúng sự thật** (sửa G10), trỏ tới constitution/ADR/spec thay vì chép lại.
- `CLAUDE.md` con trong từng package (`packages/workflows/CLAUDE.md`: luật determinism; `packages/activities/CLAUDE.md`: idempotency, heartbeat).
- Sửa `.claude/commands/review.md`, `security-audit.md` để tham chiếu file có thật; thêm lệnh `/new-workflow`.
- Mỗi quyết định kiến trúc mới → ADR; agent không tự đổi điều đã có ADR.

---

## 6. Lộ trình chuyển đổi (strangler — không big-bang)

Chuyển từng workflow sau feature flag `ORCHESTRATOR_<slug>=bullmq|temporal`; API `/api/v1` không đổi.

| Phase | Nội dung | Tiêu chí hoàn thành |
|---|---|---|
| **0. Nền tảng cho agent & vệ sinh** | Sửa CLAUDE.md/commands; constitution; ADR; template spec; CI (typecheck, lint, unit); bỏ default yếu (G7) | CI xanh trên main; agent chạy `/clarify` `/implement` được với file có thật |
| **1. Temporal foundation** ([spec 001](../../specs/001-temporal-foundation/spec.md)) | Temporal trong docker-compose dev (+UI); `apps/worker` skeleton; payload codec; OTel; activity connector dùng lại `processors/external-api.ts`; port **doc-compare** (đơn giản nhất, không HITL) sau flag | doc-compare chạy trên Temporal, kết quả tương đương BullMQ trên bộ mẫu; kill worker giữa chừng không mất/lặp bước; replay test trong CI |
| **2. HITL & kiểm soát** | Port **disbursement**, **lc-checker** với Update + maker-checker; bảng `AuditEvent` hash-chain; webhook HMAC; Prompt Registry có version | Không còn `currentStep`/`stepsResultJson` trong workflow mới; mọi chỉnh sửa người dùng có audit; review bởi chính maker bị từ chối |
| **3. Pipeline tổng quát & gỡ BullMQ** | `configurablePipeline` workflow cho 6 service; gỡ BullMQ/bull-board/recover-stalled; JSON → `jsonb`, tiền → `numeric` | Tất cả endpoint chạy Temporal; Redis chỉ còn cho rate-limit (hoặc gỡ) |
| **4. Hardening production** | Helm/K8s, HA/DR, Vault/HSM, SIEM, load test, pentest, runbook | Đạt NFR §7; qua security review của ngân hàng |

---

## 7. NFR đề xuất (cần chốt)

| Hạng mục | Đề xuất ban đầu |
|---|---|
| Availability API | 99.9% giờ làm việc |
| Durability hồ sơ | 0 mất / 0 chạy lặp side effect (activity idempotent) |
| Chờ HITL | tới 30 ngày, có nhắc SLA & escalation |
| Throughput | cần số liệu: hồ sơ/ngày, file/hồ sơ, trang/file |
| RPO / RTO | cần chốt (vd. RPO ≤ 5 phút, RTO ≤ 1 giờ) |
| Truy vết | 100% lời gọi AI có model + prompt version + hash input/output |

---

## 8. Phương án đã cân nhắc

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| Giữ BullMQ, vá dần (Flows, checkpoint tốt hơn) | Ít thay đổi | Vẫn tự gánh durability, HITL, versioning; mỗi workflow lặp boilerplate | Không đạt mục tiêu 1, 5 |
| **Temporal (self-host)** | Durable execution, HITL, retry, history, TS SDK, MIT | Thêm cluster cần vận hành; dev phải học luật determinism | **Chọn** |
| Camunda 8 (BPMN) | Business user vẽ quy trình; phổ biến trong ngân hàng | Hệ sinh thái Java; BPMN XML khó cho agent; điều kiện license self-managed cho production cần kiểm tra | Cân nhắc nếu ngân hàng bắt buộc BPMN |
| Restate / Inngest / Trigger.dev | Nhẹ, DX tốt | Ít tiền lệ on-prem ngân hàng; hệ sinh thái nhỏ hơn | Không chọn |
| AWS Step Functions / Azure Durable Functions | Managed | Phụ thuộc cloud công cộng — thường không phù hợp dữ liệu khách hàng ngân hàng VN | Không chọn |

---

## 9. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Đội chưa quen luật determinism | Lint + bundler + replay test chặn trong CI; `packages/workflows/CLAUDE.md`; review checklist |
| Vận hành Temporal cluster | Bắt đầu cấu hình tối thiểu (Postgres persistence); runbook; cân nhắc hỗ trợ thương mại |
| Hai engine song song trong giai đoạn chuyển | Feature flag theo workflow; projection `Operation` chung cho UI; mốc gỡ BullMQ ở Phase 3 |
| Workflow HITL dài ngày khi deploy code mới | Worker versioning / `patched()`; replay test bắt buộc |

---

## 10. Quyết định

**Đã chốt (2026-10-25):**
- D1. Temporal **self-host on-prem** (Kubernetes/OpenShift của ngân hàng, persistence PostgreSQL). Không dùng Temporal Cloud.
- D2. Chính sách LLM ngoài **chưa xác định** → thiết kế hỗ trợ cả hai: connector có `dataClassification`, policy egress + PII redaction cấu hình được; chốt khi có ý kiến ATTT.
- D3. Tái cấu trúc monorepo **sau khi Temporal ổn định** (Phase 3). Phase 1–2 đặt code ở `lib/temporal/` + lint ranh giới module.

**Còn mở (cần chốt trước Phase 1):**
3. **CSDL**: giữ PostgreSQL hay chuẩn ngân hàng là Oracle? (Temporal hỗ trợ PostgreSQL/MySQL/Cassandra, không hỗ trợ Oracle.)
5. **Số liệu NFR**: khối lượng hồ sơ, RPO/RTO, thời gian lưu trữ.
6. **Phiên bản Next.js**: giữ 14 trong giai đoạn chuyển đổi (đề xuất) hay nâng cấp song song?
