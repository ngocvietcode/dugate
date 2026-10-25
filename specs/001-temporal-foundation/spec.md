# Spec 001: Temporal foundation + pilot `doc-compare`

- **Trạng thái**: Draft (chờ quyết định mở ở ARCHITECTURE_V5 §10)
- **Liên quan**: [ADR-0001](../../docs/adr/0001-temporal-orchestration.md), [ARCHITECTURE_V5 Phase 1](../../docs/enterprise/ARCHITECTURE_V5.md#6-lộ-trình-chuyển-đổi-strangler--không-big-bang)

## 1. Bối cảnh & vấn đề
Workflow hiện chạy trên engine BullMQ tự viết (`lib/pipelines/workflow-engine.ts`), tự checkpoint qua `currentStep`/`stepsResultJson` và chờ sub-step bằng `job.waitUntilFinished()` trong khi giữ slot worker. Cần nền tảng Temporal và một workflow pilot để chứng minh tính tương đương trước khi chuyển các workflow có HITL.

`doc-compare` (`lib/pipelines/workflows/doc-compare.ts`) được chọn làm pilot vì: không có HITL, 4 bước (OCR song song 2 file → TOC → so sánh từng mục → báo cáo), dùng 3 connector `ext-doc-layout`, `ext-doc-compare`, `ext-content-gen`.

## 2. Mục tiêu / Ngoài phạm vi
- Mục tiêu: chạy Temporal trong môi trường dev; worker Temporal riêng; activity gọi connector tái sử dụng `lib/pipelines/processors/external-api.ts`; port `doc-compare` sau feature flag; test + replay test trong CI.
- Ngoài phạm vi: HITL/maker-checker, AuditEvent, Prompt Registry, gỡ BullMQ, tái cấu trúc monorepo, Helm/K8s.

## 3. Yêu cầu chức năng
| ID | Yêu cầu |
|---|---|
| FR-1 | `docker compose up` có thêm `temporal` (persistence PostgreSQL) và `temporal-ui`; không ảnh hưởng service hiện có |
| FR-2 | Process `worker-temporal` (`npm run temporal:worker`) đăng ký workflow `docCompare` và activities trên task queue `dugate-orchestrator` |
| FR-3 | Khi `ORCHESTRATOR_DOC_COMPARE=temporal`, `POST /api/v1/docs/workflows` cho `doc-compare` start Temporal workflow với `workflowId = op_<operationId>`; mặc định vẫn BullMQ |
| FR-4 | `GET /api/v1/operations/{id}` trả cùng shape như hiện tại (Operation projection được activity cập nhật progress/kết quả/lỗi/usage) |
| FR-5 | `POST /api/v1/operations/{id}/cancel` hủy Temporal workflow tương ứng |
| FR-6 | Prompt override `_workflowPrompts` của profile được resolve tại thời điểm start và truyền trong input workflow |

## 4. Yêu cầu phi chức năng & tuân thủ
| ID | Yêu cầu | Constitution |
|---|---|---|
| NFR-1 | Code workflow không import I/O; ESLint chặn | §10 |
| NFR-2 | Nội dung file không vào payload; truyền path/storage key + sha256 | §6 |
| NFR-3 | Payload Codec AES-256-GCM (khóa từ env ở dev, interface sẵn cho Vault) | §6 |
| NFR-4 | Mỗi activity có timeout = `connector.timeoutSec` + buffer; lỗi 4xx non-retryable | §12 |
| NFR-5 | Không log raw nội dung LLM ở mức INFO | §2 |

## 5. Thiết kế tóm tắt
- `lib/temporal/` (trước khi tách package): `client.ts`, `codec.ts`, `workflows/doc-compare.ts`, `activities/connector.ts`, `activities/projection.ts`, `worker.ts`.
- Activity `callConnector({ slug, variables, fileRefs, operationId, stepKey })` → bọc `runExternalApiProcessor`, trả `{ content, extractedData, usage }`.
- Activity `recordProgress` / `completeOperation` / `failOperation` cập nhật bảng `Operation` (giữ semantics của `completeWorkflow`/`failWorkflow`, kể cả cộng `ApiKey.totalUsed`).
- Prompt builder trong `workflows/prompts/doc-compare-prompts.ts` là hàm thuần → import được vào workflow.

## 6. Acceptance criteria
- [ ] AC-1: Với cùng 2 file mẫu + mock-service, kết quả `extractedData` của nhánh Temporal và BullMQ có cùng cấu trúc và cùng các trường chính.
- [ ] AC-2: Kill `worker-temporal` sau khi OCR xong, khởi động lại → workflow tiếp tục từ bước TOC; mock-service ghi nhận OCR chỉ được gọi 1 lần/file.
- [ ] AC-3: `npm test` chạy workflow test (TestWorkflowEnvironment, activity mock) và replay test từ `histories/doc-compare-*.json`, không cần Docker.
- [ ] AC-4: Cancel trong lúc chạy → Operation `state=CANCELLED`, không gọi thêm connector.
- [ ] AC-5: Đặt flag về `bullmq` → hành vi y như trước thay đổi (e2e `compare.e2e.test.ts` xanh).
- [ ] AC-6: Xem history trong DB Temporal không thấy cleartext nội dung prompt/response.

## 7. Câu hỏi mở
| # | Câu hỏi | Mức độ | Trả lời |
|---|---|---|---|
| 1 | Temporal self-host hay Temporal Cloud? (ảnh hưởng FR-1, mTLS) | Critical | Self-host on-prem (ARCHITECTURE_V5 D1) |
| 2 | Dùng chung Postgres với app (schema/DB riêng) hay instance riêng cho Temporal? | High | Đề xuất: DB riêng trên cùng instance ở dev, instance riêng ở prod |
| 3 | Operation projection: cập nhật qua activity (đề xuất) hay đọc trực tiếp từ Temporal Query khi poll? | High | |
| 4 | Storage S3 backend: activity tải file từ S3 về tmp như `engine.ts` hiện làm, hay connector nhận presigned URL? | Medium | |
| 5 | Ở Phase 1 có tách `apps/`/`packages/` không, hay để `lib/temporal/` rồi tách sau? | Medium | `lib/temporal/` + lint ranh giới; tách ở Phase 3 (D3) |
