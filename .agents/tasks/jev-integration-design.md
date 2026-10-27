# Đề xuất thiết kế tích hợp Jev (System One, on-prem) vào DUGate

Phạm vi: khảo sát chỉ đọc trên `d:\Jobs\dugate`. Không sửa code. Số dòng lấy từ `git grep -n` tại thời điểm khảo sát.

## Tóm tắt

> **Hợp đồng wire đã xác minh** (orchestrator đã gọi thử trực tiếp; bước khảo sát này không gọi endpoint):
> - **Gateway:** LiteLLM tại `https://aihub.aws.aif.vpbank.dev`, OpenAI-compatible. Auth là `Authorization: Bearer <JEV_API_KEY>`. Key chỉ được tham chiếu qua Vault hoặc biến môi trường, không bao giờ ghi vào repo hay tài liệu.
> - **Model id** (lấy từ `GET /v1/models`): `dbr-openjev-qwen35-4b`. Không phải `openjev-qwen35-4b`. Backend là Databricks System One (OpenJev, Qwen 3.5 4B).
> - **Request:** `POST /v1/chat/completions` với body `{model, messages:[{role:"user", content: JSON.stringify({state, questions})}]}`. Không cần `response_format`, `logprobs` hay system prompt. Nếu user content không phải JSON, LiteLLM từ chối.
> - **Câu hỏi:** `{type, instructions, criteria}`. Chi tiết ở mục b.2. Đặt sai tên field (`options`/`levels`/`question`) sẽ nhận 400 `INTERNAL_ERROR`.
> - **Response:** `choices[0].message.content` là một **chuỗi JSON** `{qid: {type, ...}}`. Có `usage.prompt_tokens`; `completion_tokens = 0`.
> - **Thử với tiếng Việt cho kết quả tốt:** refund choice 0.9997, urgency score 1.98, frustration noul 0.93. Lần gọi đầu từ máy dev mất khoảng 2.8s (tính cả TLS).
> - **Hệ quả cho thiết kế:** dùng lại connection kiểu AIHUB có sẵn (baseURL + model). `JevClient` là adapter mỏng: zod validate câu hỏi → serialize → `fetchJsonWithTimeout` → parse chuỗi JSON → zod validate answer → map lỗi. Không thêm SDK.
>
> Các mục bên dưới đã được sửa theo hợp đồng này.

- **Jev vừa khít với một chỗ đã có sẵn trong code: các "rule LLM" (check kind `PROMPT`) của loan-appraisal và account-opening.**
  - Hiện nay các check này nhờ LLM tự khai `status` + `confidence` dưới dạng JSON tự do, rồi code áp ngưỡng (`threshold` 0.8–0.85).
  - Jev trả đúng loại dữ liệu đó (`choice` PASS/FAIL/INSUFFICIENT_DATA kèm xác suất), nhanh hơn, rẻ hơn và không cần parse JSON.
  - Vì vậy POC đầu tiên nên là: **stage 5 của loan-appraisal, chạy Jev song song ở chế độ shadow**.
- **Không cần đổi DB cho POC.**
  - Cấu hình kết nối Jev nằm ở một dòng `ExternalApiConnection` (slug `ext-jev`). Nhờ vậy dùng lại được UI admin, Vault (`vaultSecretPath`), `timeoutSec` và SSRF guard.
  - Connection đặt `X-Connection-Mode: AIHUB` (`isAiHubMode`, `lib/endpoints/json-body-helper.ts:29`), `authType = BEARER`, `model = dbr-openjev-qwen35-4b`, và thêm static field `jev_contract` để `JevClient` biết cách serialize. Nhờ vậy nút "Test connection" của admin (`app/api/internal/ext-connections/[id]/test/route.ts:68`, đã hỗ trợ AIHUB) dùng được ngay.
- **Gọi Jev trực tiếp trong process (in-process) bên trong workflow, không qua `enqueueSubStep`.**
  - `enqueueSubStep` tạo child Operation, đẩy job lên BullMQ, chờ event và poll DB mỗi 3s.
  - Với một lời gọi cỡ 0.5–3s (lần đầu đo được khoảng 2.8s từ máy dev), chi phí hàng đợi và poll (bước 3s) tương đương hoặc lớn hơn chính lời gọi.
  - Muốn dùng Jev như một step trong pipeline endpoint thì đi đường AIHub có sẵn, chỉ lấy text (giai đoạn 2, xem Q1).
- **Hợp đồng đã xác minh** (xem khung ở trên). Wire format vẫn được đặt trong adapter `chat-json-v1` sau interface `JevClient`, vì LiteLLM/Databricks có thể đổi phiên bản. Code nghiệp vụ không biết wire format.
- **Có một xung đột thiết kế phải chốt trước.** Rào an toàn hiện tại của rule LLM bắt buộc model trả `evidence_ids` (`PROMPT_CHECK_EVIDENCE_MISSING`, xem `parsePromptCheckResults`, `prompt-checks.ts:455`). Jev không sinh text nên không trả được evidence_ids.
  - Đề xuất: code chọn sẵn tập evidence cho từng check rồi đưa vào `state`. Khi đó evidence_ids là tập đã đưa vào, xác định được từ trước, không do model khai.
  - Đây là thay đổi ngữ nghĩa kiểm soát. BA/QLRR cần duyệt.

## (a) Hiện trạng kiến trúc

### Q1. Connector AI được mô hình hoá và gọi thế nào

- **DUGate không gọi SDK của provider.** Mọi lời gọi AI là HTTP tới một `ExternalApiConnection` (`lib/db/schema.ts`, bảng `ExternalApiConnection`). Các trường chính:
  - `endpointUrl`, `httpMethod`
  - `authType`: `API_KEY_HEADER` | `BEARER` | `NONE`; `authKeyHeader`; `authSecret`; `vaultSecretPath`
  - `promptFieldName`, `fileFieldName`, `defaultPrompt`, `staticFormFields` (JSON `[{key,value}]`, chứa `model`, `reasoning_effort`…), `extraHeaders`
  - `responseContentPath`, `timeoutSec` (mặc định 300), `state` (ENABLED/DISABLED)
  - CLAUDE.md có nhắc `@google/generative-ai` và `openai`, nhưng đường gọi trong pipeline không dùng các SDK này.
- **Điểm gọi duy nhất** là `runExternalApiProcessor(ctx, connection, override)` (`lib/pipelines/processors/external-api.ts:86`). Hàm có 2 nhánh:
  - Multipart/form-data (mặc định).
  - AIHub JSON chat-completions, bật bằng `"X-Connection-Mode": "AIHUB"` trong `extraHeaders` (`external-api.ts:103`, `runAiHubBranch`).
  - Cả hai nhánh đều đi qua: `resolveConnectionSecret` (`lib/secrets/resolve.ts`: đọc Vault nếu có `vaultSecretPath`, ngược lại đọc `authSecret`), `assertSafeUrl` và `fetchWithTimeout` / `fetchJsonWithTimeout` (`http-client.ts`, bên trong là `ssrfSafeFetch`), `extractTokenUsage` (CAIP / Gemini / OpenAI) và `estimateCost` (`lib/pricing.ts:106`, bảng giá lấy từ AppSetting `model_pricing_json`).
- **Các nơi gọi:**
  - `runPipeline` (`lib/pipelines/engine.ts:467`): pipeline tuyến tính, mỗi step là một slug connector.
  - `runConnectorPrompt` (`lib/pipelines/run-connector-prompt.ts:65`): gọi đồng bộ, không qua queue, dựng `ProcessorContext` tối thiểu. Đây là mẫu tốt để gọi Jev in-process.
  - Workflow gọi gián tiếp qua `enqueueSubStep` → child Operation → `runPipeline`.
- **Override theo profile:**
  - Pipeline endpoint: `ExternalApiOverride` (khoá `connectionId, apiKeyId, endpointSlug, stepId`) chứa `promptOverride`, `modelOverride`, `reasoningEffortOverride`. Được nạp trước trong `runPipeline`. `resolvePrompt` / `resolveModel` (`prompt-resolver.ts`) ưu tiên theo thứ tự: biến code `_prompt` / `_model` → override → mặc định của connector.
  - Chuỗi connector của endpoint: `ProfileEndpoint.connectionsOverride` được parse bởi `parseConnectionSteps` (`lib/endpoints/profile-resolver.ts:143`).
  - Workflow: `ProfileEndpoint.parameters` được merge vào `ctx.pipelineVars`, cộng thêm `_workflowPrompts` / `_workflowModels` / `_workflowReasoningEfforts` theo tên step. Việc này làm trong `createWorkflowContext` (`workflow-engine.ts`). Admin luôn thắng request.
- **Mock:**
  - `mock-service/routes/connectors.js` có `POST /ext/:slug`, map slug sang `responses/<slug>.js`, hỗ trợ `?scenario=success|error|timeout|empty` và `?delay=`.
  - `lib/db/seed.ts:8` trỏ các connector seed về `MOCK_SERVICE_URL`. Ví dụ AIHub ở `seed.ts:83`.
- **Không có code "OpenAI connector/provider" theo kiểu SDK.** `git grep` không thấy `from 'openai'`, `new OpenAI(` hay `@google/generative-ai` trong `lib/`, `app/`, `worker.ts`. CLAUDE.md đã cũ ở điểm này. "Provider OpenAI" thực chất là **nhánh AIHub** (`runAiHubBranch`):
  - Body JSON dựng từ template `defaultPrompt` bằng `buildJsonBody` (thay chuỗi `{{placeholder}}`).
  - Biến lấy từ `staticFormFields` (`model`, `system_prompt`, `user_prompt`, `max_tokens`, `temperature`, `reasoning_effort`). Ví dụ seed `ext-data-extractor` (`lib/db/seed.ts` quanh dòng 83).
  - Gửi `application/json` qua `fetchJsonWithTimeout`. Đọc `responseContentPath` (mặc định `choices.0.message.content`), sau đó `stripMarkdownCodeFence`.
  - Override model theo profile qua `applyModelOverride`.
- **Dùng lại được những gì cho Jev** (endpoint là OpenAI-compatible nên hầu hết dùng lại được):
  - Lưu cấu hình: một dòng `ExternalApiConnection` kiểu AIHUB với `endpointUrl = https://aihub.aws.aif.vpbank.dev/v1/chat/completions`, `authType = BEARER`, `vaultSecretPath` trỏ tới key, và `staticFormFields.model = dbr-openjev-qwen35-4b`. Không cần schema mới.
  - Về lý thuyết `runAiHubBranch` gọi được Jev và trả `choices.0.message.content` (chuỗi JSON answers), nếu template là `{"model":"{{model}}","messages":[{"role":"user","content":"{{user_prompt}}"}]}` và code truyền `_prompt = JSON.stringify({state, questions})`.
  - **Vì sao vẫn không dùng `runAiHubBranch` cho Jev:**
    1. `buildJsonBody` escape giá trị bằng `JSON.stringify(v).slice(1,-1)`. Cách này đúng, nhưng chuỗi JSON lồng trong template rất khó kiểm thử và dễ vỡ khi admin sửa template.
    2. Nếu connection có static `reasoning_effort` thì `setJsonBodyField` luôn chèn nó vào body. LiteLLM/Databricks có thể từ chối, nên **không cấu hình** `reasoning_effort` cho `ext-jev`.
    3. `injectMultimodalFiles` sẽ biến content thành mảng parts nếu có file. Khi đó LiteLLM từ chối vì content không còn là JSON. Jev không được nhận file.
    4. `ProcessorResult` không mang được answer có kiểu. Đằng nào cũng phải parse và validate lại.
  - **Quyết định:**
    - `JevClient` tự dựng body bằng `JSON.stringify` (không dùng template) và gọi thẳng `fetchJsonWithTimeout`.
    - Dùng lại cấu hình connection (`endpointUrl`, `authType`/`authKeyHeader`, `resolveConnectionSecret`, `timeoutSec`, `model` + `applyModelOverride`), `assertSafeUrl`, và `extractTokenUsage` (`external-api.ts:364`, đã export, đọc được `usage.prompt_tokens` kiểu OpenAI) + `estimateCost`.
    - Không thêm SDK `openai`. SDK này không đi qua `ssrfSafeFetch` (SECURITY-RULES #11) và không cần thiết.

### Q2. Pipeline engine, workflow engine, HITL

- **Pipeline** (`runPipeline`):
  - Chạy tuần tự `PipelineStep[]` (`processor`, `variables`, `stepId`, `captureSession`/`injectSession`).
  - Output của step trước thành `input_content` của step sau.
  - Checkpoint theo `Operation.currentStep` + `stepsResultJson`. Usage được gom vào `usageBreakdown`. Có cộng `ApiKey.totalUsed` và gửi webhook.
- **Workflow:**
  - `WORKFLOW_REGISTRY` (`workflow-engine.ts:1097`) map tên sang hàm `(ctx: WorkflowContext) => Promise<void>`. Đây là code thuần, không có "DAG định nghĩa bằng dữ liệu".
  - `runWorkflow` lấy tên workflow từ job name (`workflows:<name>`).
  - Các primitive: `enqueueSubStep`, `updateProgress`, `pauseWorkflow`, `completeWorkflow`, `failWorkflow`, `assertNotCancelled`, `WorkflowCancelledError`, `classifyWorkflowFailure`.
- **Queue** (`lib/queue/pipeline-queue.ts`, `worker.ts`):
  - `pipeline` cho job cha.
  - `workflow-steps` cho sub-step, có pool riêng để tránh deadlock, concurrency `SUBSTEP_WORKER_CONCURRENCY`.
  - Định tuyến theo worker group: `resolveTargetQueue`.
- **Cái giá của `enqueueSubStep`** (`workflow-engine.ts:180`), mỗi lần gọi gồm:
  - `insertOperation`
  - `queue.add`
  - một query lấy `timeoutSec`
  - `waitUntilFinished` chạy đua với poll DB mỗi 3s
  - đọc lại child, parse JSON, cộng dồn usage
  - Với Jev, chi phí này lớn hơn chính lời gọi. Đây là lý do chọn gọi in-process.
- **HITL:**
  - `pauseWorkflow(ctx, message, currentStep)` chuyển trạng thái sang `WAITING_USER_INPUT`, lưu `stepsResultJson` + usage, và gửi webhook `PAUSED`.
  - Nơi dùng: `disbursement.ts:207` (luôn pause sau OCR) và `structure-compare.ts:659`.
  - Resume qua `POST /api/v1/operations/[id]/resume` (`app/api/v1/operations/[id]/resume/route.ts`):
    - Chỉ nhận state `WAITING_USER_INPUT`.
    - Có thể ghi đè `stepsResult[step].extracted_data` từ body `{step, extracted_data}` và đặt `is_human_edited = true`.
    - Sau đó chuyển về `RUNNING` và `queue.add` lại (`route.ts:90`). Workflow chạy lại từ `ctx.currentStep`.
  - **Loan-appraisal không gọi `pauseWorkflow`** (xác nhận trong `.agents/tasks/loan-appraisal-review.md`, mục 3).
- **Điểm cắm "decision step":**
  - Một helper thuần trong `lib/jev/decision.ts`, được gọi bên trong hàm workflow, giữa hai stage.
  - Kết quả là `DecisionOutcome` (`AUTO_ACCEPT` / `AUTO_REJECT` / `NEEDS_REVIEW`). Workflow tự quyết định: ghi `RuleResult`, đổi route review, hoặc gọi `pauseWorkflow`.
  - Không nên biến nó thành một "loại step" trong engine, vì engine không có DSL step. Thêm DSL là đổi kiến trúc không cần thiết.

### Q3. Đăng ký và dispatch endpoint

- `SERVICE_REGISTRY` (`lib/endpoints/registry.ts:180`) gồm: service → `subCases` (discriminator `type` / `process`…) → `parameters: ParamSchema` (`defaultLocked`, `hidden`, `showWhen`) + `connections: string[]` hoặc `isWorkflow: true`.
- **`runEndpoint`** (`lib/endpoints/runner.ts:112`) xử lý theo thứ tự:
  1. Resolve API key và rate limit.
  2. Đọc `formData`.
  3. Đọc discriminator (`runner.ts:195`) → chọn `subCase` (rơi về `_default` nếu không có).
  4. `loadProfileEndpoint` → `mergeParameters`.
  5. Inject preset extract (`buildGuardedExtractFields`, `runner.ts:290`).
  6. `parseConnectionSteps` → `submitPipelineJob`.
- Workflow đi qua route riêng `app/api/v1/docs/workflows/route.ts` (field `process`), không qua `runEndpoint`.
- **Có thể thêm pre-routing hook không?** Về kỹ thuật thì được, chèn ngay trước bước 3 khi discriminator rỗng. Nhưng có 3 hạn chế:
  1. Lúc đó chỉ có file thô (PDF/ảnh), chưa có text. Jev nhận `state` là text/JSON, nên phải OCR trước, mà OCR lại là chính pipeline.
  2. Hook chạy trên request path đồng bộ, làm tăng độ trễ và thêm một điểm lỗi cho mọi request.
  3. Nó làm đổi hợp đồng: endpoint tự chọn sub-case thay vì client chọn.
- Kết luận: chỉ làm routing bằng Jev **bên trong workflow, sau bước classify/OCR**, không làm ở runner.

### Q4. Cấu hình và bảo mật

- **SSRF:**
  - `resolveSafeUrl` / `assertSafeUrl` / `ssrfSafeFetch` (`http-client.ts`) chặn host private, trừ khi host nằm trong `ALLOWED_PRIVATE_HOSTS`.
  - `ALLOWED_PRIVATE_HOSTS` là danh sách so khớp **chính xác** theo hostname/IP. Code chỉ làm `allowedPrivateHosts.includes(hostname)`, không hỗ trợ CIDR hay wildcard.
  - `.env.example` ghi đúng điều này. Nhưng `docs/DEPLOYMENT-CONFIG.md:248` lại ví dụ `ALLOWED_PRIVATE_HOSTS=10.0.0.0/8,172.16.0.0/12`. Dạng CIDR này **không có tác dụng**, nên doc bị lệch so với code.
  - Jev on-prem phải được thêm đúng hostname (hoặc IP) vào biến này ở **cả app lẫn worker** (`docker-compose.yml`, `docker-compose.run.yml` đều có biến này).
  - **Với host `aihub.aws.aif.vpbank.dev`:**
    - `resolveSafeUrl` phân giải DNS và chặn nếu **bất kỳ** địa chỉ trả về nào là private.
    - Một host hub nội bộ rất có thể phân giải ra 10.x/172.16.x. Khi đó phải có `ALLOWED_PRIVATE_HOSTS=aihub.aws.aif.vpbank.dev` (viết thường, so khớp chính xác; `*.vpbank.dev` không có tác dụng), nếu không mọi lời gọi sẽ lỗi `SSRF protection: hostname ... resolves to a private or reserved address`.
    - Nếu host phân giải ra IP public thì không cần allowlist.
    - Chưa kiểm được DNS thực tế từ máy này.
    - Trong repo không có tham chiếu nào tới `aif.vpbank.dev`. Không biết các connector AIHub đang chạy production có dùng chung host này không, vì cấu hình nằm trong DB, không nằm trong repo. Nếu dùng chung thì host này đã có trong allowlist của môi trường đó.
  - TLS: nếu hub dùng CA nội bộ thì thêm CA qua `NODE_EXTRA_CA_CERTS` (mẫu ở `docker-compose.yml:25`, SECURITY-RULES #6). Không được tắt verify.
  - `ssrfSafeFetch` có pin DNS. Lời gọi có credential phải kèm timeout (SECURITY-RULES #11). `fetchJsonWithTimeout` đã dùng `AbortController`.
- **Secret:**
  - `resolveConnectionSecret` đọc Vault (dual-read).
  - **Cách lưu API key của connection:**
    - `POST /api/internal/ext-connections` lưu `authSecret: usingVault ? '' : authSecret.trim()` (`app/api/internal/ext-connections/route.ts:165`). Nghĩa là khi không dùng Vault, key nằm **plaintext** trong cột `ExternalApiConnection.authSecret`. Không thấy gọi `lib/crypto` ở route này.
    - GET trả về giá trị đã mask (`'••••••••'`, dòng 77), nên không lộ ra UI.
    - Khi chạy, `resolveConnectionSecret` ưu tiên `vaultSecretPath` (provider ở `lib/secrets/vault-provider.ts`).
    - Điều này trái SECURITY-RULES #5. Với key của AI hub, **bắt buộc dùng `vaultSecretPath`** (ví dụ `aihub/dugate-jev#api_key`) và để `authSecret` rỗng.
    - Auth của hub đã xác minh là `Authorization: Bearer`, tương ứng `authType = 'BEARER'` (có sẵn trong `runAiHubBranch` và `HttpJevClient`). Môi trường dev có thể nạp key từ biến `JEV_API_KEY` qua dev secret provider (`lib/secrets/dev-provider.ts`, chưa đọc chi tiết). Không ghi key vào seed, test hay doc (SECURITY-RULES #10).
- **Log:**
  - `logCurlCommand` mask header không an toàn và redact body JSON (`redactJsonBody`).
  - Có `lib/log-sanitize.ts` (`sanitizeForLog`, `redactSecretsInText`).
  - `state` gửi Jev chứa PII (tên, CCCD, số tiền). Không được log `state`, chỉ log độ dài/hash.
- **Audit:** `lib/audit/write.ts` (`writeAudit`) dùng cho thay đổi cấu hình. Việc gọi AI được truy vết qua child Operation (`correlationId`) và `stepsResultJson`. Gọi Jev in-process sẽ không có child Operation, nên phải ghi trace vào stepsResult (xem phần b.6).
- **Usage/chi phí:**
  - `ProcessorResult` có `inputTokens`, `outputTokens`, `costUsd`, `costSource` (`provider` | `estimate` | `unpriced` | `none`).
  - `summarizeOperationUsage` (`lib/operations/operational-metadata.ts:35`) đặt `costMissing` khi `costUsd === null` và nguồn không phải `unpriced`.
  - `WorkflowContext.usageBreakdown` là mảng `{processor, model, input_tokens, output_tokens, cost_usd, cost_source}`. Jev in-process cộng thẳng vào đây.

### Q5. Test

- Jest + ts-jest (`jest.config.js`, `testMatch: **/tests/**/*.test.ts`, setup `tests/setup.ts`). Chạy bằng `npx jest <dir> --ci --roots tests`. `--roots tests` để không quét `.worktrees/`.
- Mẫu mock connector:
  - `tests/pipelines/external-api.test.ts` dựng **HTTP server loopback thật** và đặt `ALLOWED_PRIVATE_HOSTS=localhost`. Mock `global.fetch` không dùng được vì code đi qua `ssrfSafeFetch` với `node:http`.
  - Test workflow mock `@/lib/pipelines/workflow-engine` (`tests/pipelines/loan-appraisal-cancel.test.ts:9`).
- Có sẵn test cho `parsePromptCheckResults`: `tests/loan-appraisal/prompt-checks.test.ts` và `prompt-hardening.test.ts`. Đây là chỗ đặt test cho mapping Jev.
- Kiểm tra kiểu: `npx tsc --noEmit`.

## (b) Thiết kế đề xuất

### b.1 Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Cấu hình Jev là một `ExternalApiConnection` kiểu AIHUB: slug `ext-jev`, `endpointUrl = https://aihub.aws.aif.vpbank.dev/v1/chat/completions`, `authType = BEARER`, `vaultSecretPath` cho key (dev: biến `JEV_API_KEY` qua dev secret provider), `staticFormFields = [{model: dbr-openjev-qwen35-4b}, {jev_contract: chat-json-v1}]`, không có `reasoning_effort`/`temperature` | Dùng lại UI admin, nút Test (đã hỗ trợ AIHUB), Vault, SSRF, `timeoutSec`, model override theo profile, export/import (`lib/connectors/transfer/*`). Không cần migration, không thêm SDK |
| D2 | Workflow gọi Jev in-process qua `JevClient`, không qua `enqueueSubStep` | Chi phí queue và poll (insert op, BullMQ, poll 3s) tương đương lời gọi 0.5–3s. Workflow đã tự lưu trace vào `stepsResult` |
| D3 | Wire format nằm trong adapter (`lib/jev/contract/*`), chọn theo `staticFormFields.jev_contract` (mặc định `chat-json-v1`, đúng với hợp đồng đã xác minh). `JevClient` tự dựng body bằng `JSON.stringify` và gọi `fetchJsonWithTimeout`, không đi qua template của `runAiHubBranch` | Kiểm soát chính xác user content (bắt buộc phải là JSON), không để multimodal/`reasoning_effort` lọt vào, validate bằng zod (đã có `zod@3.25.76` trong `package.json`, đang được dùng ở `lib/profiles/release/schema.ts`) |
| D4 | Rollout có 3 chế độ, cấu hình bằng param profile `decision_engine` = `LLM` (mặc định) \| `SHADOW` \| `JEV`, `defaultLocked` | Ngân hàng cần số liệu đối chiếu trước khi để Jev quyết định. Mặc định `LLM` nên hành vi hiện tại không đổi |
| D5 | Ngưỡng và quyết định HITL nằm trong code (`decision.ts`), Jev chỉ trả xác suất | Jev yếu về số học và so sánh. Nghiệp vụ cần tái lập được và audit được |

### b.2 Interface `JevClient` (TypeScript)

```ts
// lib/jev/types.ts
// Khớp schema câu hỏi của Databricks System One (đã xác minh qua LiteLLM).
import { z } from 'zod';

export const NoulQuestion = z.object({
  type: z.literal('noul'),
  instructions: z.string().min(1),
  criteria: z.object({ true: z.string(), false: z.string() }).partial().optional(),
}).strict();

export const ChoiceQuestion = z.object({
  type: z.literal('choice'),
  instructions: z.string().min(1),
  // 1–255 option; mô tả có thể null. BẮT BUỘC.
  criteria: z.record(z.string().min(1), z.string().nullable())
    .refine((c) => { const n = Object.keys(c).length; return n >= 1 && n <= 255; }, 'choice cần 1–255 option'),
}).strict();

export const ScoreQuestion = z.object({
  type: z.literal('score'),
  instructions: z.string().min(1),
  criteria: z.array(z.string().min(1)).min(1).max(10),   // level 0..n-1. BẮT BUỘC.
}).strict();

export const JevQuestion = z.discriminatedUnion('type', [NoulQuestion, ChoiceQuestion, ScoreQuestion]);
export type JevQuestion = z.infer<typeof JevQuestion>;

export interface JevRequest {
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, JevQuestion>;   // qid → câu hỏi; độc lập, chạy song song
}

// Answer theo đúng shape server trả (content là chuỗi JSON phải parse).
export const NoulAnswer = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });
export const ChoiceAnswer = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
export const ScoreAnswer = z.object({
  type: z.literal('score'),
  score: z.number(),                                   // điểm có trọng số, vd 1.98
  confidence: z.number().min(0).max(1),
  legend: z.record(z.string(), z.string()).optional(), // "0" → nhãn level
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
export const JevAnswer = z.discriminatedUnion('type', [NoulAnswer, ChoiceAnswer, ScoreAnswer]);
export type JevAnswer = z.infer<typeof JevAnswer>;

export interface JevResponse {
  answers: Record<string, JevAnswer>;
  model: string | null;            // `model` trong response (vd dbr-openjev-qwen35-4b)
  latencyMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null };
}

// Builder giống SDK công khai, nhưng xuất đúng field của hợp đồng on-prem.
export const noul = (instructions: string, criteria?: { true?: string; false?: string }): JevQuestion =>
  ({ type: 'noul', instructions, ...(criteria ? { criteria } : {}) });
export const choice = (instructions: string, criteria: Record<string, string | null>): JevQuestion =>
  ({ type: 'choice', instructions, criteria });
export const score = (instructions: string, levels: string[]): JevQuestion =>
  ({ type: 'score', instructions, criteria: levels });

// lib/jev/client.ts
export interface JevClient {
  evaluate(req: JevRequest, opts?: { signal?: AbortSignal; correlationId?: string }): Promise<JevResponse>;
}

/** Nạp connection theo slug (giống runConnectorPrompt), kiểm tra state ENABLED + isAiHubMode + có staticFormFields.jev_contract. */
export async function getJevClient(slug = 'ext-jev', logger?: Logger): Promise<JevClient>;

// lib/jev/contract/index.ts — adapter wire format (chat-completions)
export interface JevContractAdapter {
  id: 'chat-json-v1' | string;
  /** Validate questions bằng zod (throw JEV_INVALID_QUESTION trước khi gọi mạng), trả body chat-completions. */
  buildBody(req: JevRequest, model: string): Record<string, unknown>;
  /** Validate chặt; thiếu/sai answer ⇒ throw JevContractError (code JEV_CONTRACT_ERROR). */
  parseResponse(raw: unknown, req: JevRequest): Omit<JevResponse, 'latencyMs' | 'usage'>;
}
```

**Adapter `chat-json-v1` (theo hợp đồng đã xác minh):**

Request (chỉ có hai field `model` và `messages`; không có system prompt, `response_format`, `logprobs`, `temperature` hay `reasoning_effort`):

```json
{
  "model": "dbr-openjev-qwen35-4b",
  "messages": [
    {
      "role": "user",
      "content": "{\"state\":{...evidence đã lọc...},\"questions\":{\"verdict\":{\"type\":\"choice\",\"instructions\":\"...\",\"criteria\":{\"PASS\":\"...\",\"FAIL\":\"...\",\"INSUFFICIENT_DATA\":\"...\"}}}}"
    }
  ]
}
```

- `content` phải bằng đúng `JSON.stringify({ state, questions })`. LiteLLM từ chối content không phải JSON (xem mục 3 của "vì sao không dùng `runAiHubBranch`").
- Ví dụ `choices[0].message.content`. Đây là **chuỗi**, phải `JSON.parse`, có thể kèm code fence:

```json
{
  "verdict": { "type": "choice", "choice": "PASS", "confidence": 0.93, "probabilities": { "PASS": 0.93, "FAIL": 0.04, "INSUFFICIENT_DATA": 0.03 } },
  "urgency": { "type": "score", "score": 1.98, "confidence": 0.71, "legend": { "0": "thấp", "1": "vừa", "2": "cao" }, "probabilities": { "0": 0.05, "1": 0.12, "2": 0.83 } },
  "frustrated": { "type": "noul", "noul": 0.93 }
}
```

- **Các bước của `parseResponse`:**
  1. Đọc `choices[0].message.content`. Nếu là string thì `stripMarkdownCodeFence` rồi `JSON.parse`. Lỗi parse → `JEV_CONTRACT_ERROR`.
  2. Với mỗi qid trong request: phải có answer, `JevAnswer.safeParse` phải đạt, và `type` phải trùng type của câu hỏi.
  3. Kiểm tra ngữ nghĩa:
     - choice: `choice ∈ keys(criteria)`, `probabilities` phủ đúng tập option.
     - score: `0 ≤ score ≤ levels-1`, các key `probabilities` nằm trong `0..levels-1`.
     - Tổng xác suất bằng 1 ±0.02, sau đó renormalize.
  4. Answer thừa (qid lạ) thì bỏ qua và ghi warn.
  5. Một câu hỏi lỗi **không** làm hỏng cả request. Câu đó nhận `JEV_NOT_RETURNED`/`JEV_INVALID_ANSWER` → REVIEW (trong `decision.ts`).
- Usage: `extractTokenUsage(raw)` đọc `usage.prompt_tokens`. `completion_tokens = 0` là giá trị hợp lệ (0 khác null), nên `outputTokensMissing` không bị bật. `model` lấy từ `raw.model`.
- `confidence` dùng cho ngưỡng:
  - choice/score: dùng `confidence` server trả.
  - noul: dùng `max(p, 1−p)`, và quyết định yes nếu `p ≥ t`, no nếu `p ≤ 1−t`, còn lại REVIEW.

**`HttpJevClient` (thực thi `JevClient`):**
- Nạp connection như `runConnectorPrompt`, kiểm tra `state === 'ENABLED'`.
- Model: `applyModelOverride(staticFields, override)` → `model`.
- Secret: `resolveConnectionSecret(connection)` (Vault). Header `Authorization: Bearer …` khi `authType = BEARER`.
- Không bao giờ log key hay body. `logCurlCommand` đã mask header và redact JSON body, nhưng vẫn nên gọi ở mức debug.
- Gửi: `fetchJsonWithTimeout(await assertSafeUrl(endpointUrl), 'POST', headers, JSON.stringify(body), timeoutSec*1000)`. Đặt `timeoutSec` = 10, vì lần gọi đầu đo được khoảng 2.8s và còn cold start/TLS.
- Map lỗi:
  - `ExternalApiHttpError` 400 → `JEV_BAD_REQUEST` (sai schema câu hỏi; server trả `INTERNAL_ERROR` nên dựa vào status, không dựa vào message).
  - 401/403 → `JEV_AUTH`.
  - 429 → `JEV_RATE_LIMITED`, retryable, backoff 1 lần.
  - 5xx/timeout/DNS/SSRF → `JEV_UNAVAILABLE`.
  - Thông điệp throw giữ tiền tố `Connection Error to ext-jev:` như `wrapConnectorError`, để `classifyWorkflowFailure` vẫn phân loại được thành `CONNECTOR_ERROR` nếu lỗi lan ra ngoài.
  - Trong decision step, mọi lỗi đều thành REVIEW, không làm fail workflow.
- Không thêm dependency `@typesafe-ai/sdk` hay `openai`. Hub là OpenAI-compatible nên chỉ cần `fetchJsonWithTimeout` có sẵn. Hai SDK kia không đi qua `ssrfSafeFetch` (SECURITY-RULES #11).
- Model lấy từ `staticFormFields.model` và cho phép override theo profile/step qua `ctx.modelOverrides.policy_checks_jev`, dùng `applyModelOverride`. Nhờ vậy đổi sang phiên bản `dbr-openjev-*` mới không cần sửa code.
- **Preset `jev_questions`:** LiteLLM báo có model dùng "preset jev_questions", tức câu hỏi được cấu hình sẵn phía server và client chỉ gửi state. Thiết kế giữ câu hỏi ở phía DUGate (có version trong check set, audit được), nên không dùng preset. Câu hỏi mở: preset được version thế nào nếu sau này muốn dùng.

### b.3 Decision step (schema + logic)

```ts
// lib/jev/decision.ts
export interface QuestionPolicy {
  /** choice: xác suất tối thiểu của option thắng; noul: ngưỡng cho cả hai phía (P≥t ⇒ yes, P≤1−t ⇒ no). */
  minConfidence: number;
  /** Map đáp án → kết luận nghiệp vụ. */
  outcomeMap?: Record<string, 'ACCEPT' | 'REJECT' | 'REVIEW'>;
  onLowConfidence: 'REVIEW' | 'HITL' | 'FALLBACK_LLM';
}

export interface DecisionSpec {
  id: string;            // vd 'loan.policy_checks'
  version: string;       // ghi vào artifact để tái lập
  connectionSlug?: string;
  questions: Record<string, JevQuestion>;
  policies: Record<string, QuestionPolicy>;
}

export interface QuestionDecision {
  question: string;
  answer: JevAnswer | null;          // null khi lỗi gọi
  outcome: 'ACCEPT' | 'REJECT' | 'REVIEW';
  reason_code: 'JEV_CONFIDENT' | 'JEV_BELOW_THRESHOLD' | 'JEV_ERROR' | 'JEV_NOT_RETURNED';
  escalate: 'NONE' | 'HITL' | 'FALLBACK_LLM';
}

export interface DecisionOutcome {
  spec_id: string; spec_version: string; model: string | null; latency_ms: number;
  decisions: Record<string, QuestionDecision>;
  needs_hitl: boolean;               // có ít nhất một escalate=HITL
}

export async function runDecision(
  client: JevClient, spec: DecisionSpec, state: JevRequest['state'], logger: Logger,
): Promise<DecisionOutcome>;          // không throw khi Jev lỗi: trả outcome REVIEW/JEV_ERROR (giống promptChecksNotRun)
export function evaluatePolicies(spec: DecisionSpec, answers: Record<string, JevAnswer>): DecisionOutcome['decisions']; // thuần, test được
```

- Logic phụ thuộc giữa các câu hỏi (câu hỏi B chỉ hỏi khi A = yes) phải nằm trong code, gọi `runDecision` nhiều lần. Jev chạy các câu hỏi trong cùng một request độc lập với nhau.
- Workflow nhận `needs_hitl = true`, lưu artifact vào `ctx.stepsResult`, rồi `return pauseWorkflow(ctx, msg, nextStep)`.
  - Người duyệt sửa `extracted_data` qua route resume có sẵn.
  - Workflow resume đọc lại artifact đã `is_human_edited`.
  - Không cần API mới.

### b.4 Cấu hình theo profile

- Thêm param vào sub-case `workflows.loan-appraisal` (`registry.ts:953`):
  - `decision_engine`: `{ type: 'string', options: ['LLM','SHADOW','JEV'], default: 'LLM', defaultLocked: true }`
  - `jev_connection`: `{ type: 'string', default: 'ext-jev', defaultLocked: true, hidden: true }`
  - Cả hai tự vào `ctx.pipelineVars` qua `createWorkflowContext`.
- Mở rộng `LoanCheckDefinition` (`check-set.ts`) thêm các trường không bắt buộc:
  - `engine?: 'LLM' | 'JEV'`: cho phép chọn theo từng check, ưu tiên hơn `decision_engine`.
  - `jev_criteria?: Record<string, string | null>`: mô tả các option của `choice` (map vào `criteria`), mặc định PASS/FAIL/INSUFFICIENT_DATA.
  - Parse/validate trong `parseLoanCheckSet` / validator (`check-set.ts:331`, `:539`), theo đúng mẫu fail-closed đang có.
  - Dùng lại `threshold`, giữ nguyên ngữ nghĩa ("dưới ngưỡng ⇒ REVIEW").

### b.5 DB / migration

- POC: **không có migration.**
  - Connection Jev là một dòng `ExternalApiConnection` (seed + mock).
  - Kết quả Jev nằm trong `stepsResultJson` (artifact stage 5).
- Giai đoạn sau, nếu cần báo cáo calibration theo thời gian: thêm bảng `DecisionLog` (`operationId, specId, specVersion, question, answerJson, outcome, humanOutcome, createdAt`) để đo độ chính xác so với quyết định của người. Lúc đó mới cần migration `drizzle/00xx_add_decision_log.sql`.

### b.6 Env và observability

- Env: không có biến mới bắt buộc. Cần thêm hostname Jev vào `ALLOWED_PRIVATE_HOSTS` cho cả app và worker. Có thể thêm `JEV_DEFAULT_TIMEOUT_MS` nhưng chưa cần, vì đã có `timeoutSec` của connection.
- Log (`Logger`, prefix `[JEV]`):
  - Ghi: slug, spec id/version, số câu hỏi, `stateChars`, `latencyMs`, phân phối outcome.
  - **Không ghi `state` và text câu hỏi** (có thể chứa PII từ prompt tuỳ biến).
- Usage: đẩy `{ processor: 'jev:<slug>', model: response.model ?? 'jev', input_tokens, output_tokens, cost_usd, cost_source }` vào `ctx.usageBreakdown`. Cộng `ctx.totalCost`.
  - Nếu Jev không báo token/cost thì để `cost_usd: null`, `cost_source: 'none'`. Lưu ý: cách này bật cờ `costMissing` của operation.
  - Muốn tránh thì cần quyết định nghiệp vụ: Jev nội bộ tính $0 (`costUsd: 0`, `'none'`, như nhánh internal parser ở `external-api.ts`) hay tính theo đơn giá mỗi lời gọi. Đây là câu hỏi mở.
- Trace: `stepsResult[5].content_preview.jev` lưu `{mode, model, latency_ms, agreement: {same, differ, jev_review}}`. `extracted_data.jev_shadow` lưu từng `QuestionDecision`.

## (c) Use case xếp hạng

| Hạng | Use case | Điểm cắm | Vì sao |
|---|---|---|---|
| 1 | **Rule LLM của loan-appraisal** (BORROWER_IDENTITY, COLLATERAL.OWNER_MATCH, PURPOSE.COHERENCE) → Jev `choice` PASS/FAIL/INSUFFICIENT_DATA | `loan-appraisal.ts:412-436` (stage 5), `prompt-checks.ts` (`buildPromptCheckVars:394`, `parsePromptCheckResults:455`), `check-set.ts` | Đã có sẵn ngưỡng confidence, chế độ chỉ cảnh báo (`action: 'warn'`) và fallback `NOT_RUN`. Thay "confidence do LLM tự khai" bằng xác suất có cấu trúc. Rủi ro thấp vì check mặc định chỉ ở mức REVIEW |
| 2 | **Rule LLM của account-opening** | `account-opening.ts:400`, `account-opening/prompt-checks.ts:27/53/120` | Cùng một mẫu, dùng lại được adapter và `decision.ts`. Làm ngay sau POC |
| 3 | **HITL theo độ tin cậy**: chỉ pause khi Jev không chắc | `disbursement.ts:207` (đang luôn pause); `review.route` / `deriveProcessingStatus` của loan-appraisal | Giảm số lần người phải duyệt. **Đổi hành vi người dùng thấy** (không còn pause 100%), nên cần PO duyệt và chạy shadow trước |
| 4 | **Guardrail sau extract**: Jev `noul` "dữ liệu bóc tách có đúng loại chứng từ không / có bị bịa không", và `choice` doc type trên text OCR | Connection `ext-jev` đi đường AIHub làm step cuối của pipeline `extract:*` (qua `connectionsOverride`); hoặc stage 0/1 của workflow | Bổ sung cho cổng `document_type_mismatch` (`buildGuardedExtractFields`). Cần text OCR làm `state`, vì Jev không đọc PDF/ảnh (chưa xác minh với bản on-prem) |
| 5 | **Chấm điểm định tính** `score` (vd. mức độ rủi ro ngành 0..4) cho stage 6 | `ScoreStrategy` (`strategies.ts:532`, đang `NOT_CONFIGURED`) | Cần quản trị mô hình (model governance) và phê duyệt scorecard. Chỉ làm sau khi đã đo calibration |
| — | Pre-routing ở `runEndpoint` / chọn model | `runner.ts:195` | Không khuyến nghị (xem Q3): chưa có text, chạy trên request path, đổi hợp đồng |

## (d) POC khuyến nghị: Jev shadow cho rule LLM của loan-appraisal

Mục tiêu:
- Với `decision_engine=SHADOW`, stage 5 vẫn ra kết luận từ LLM như hiện tại. Đồng thời mỗi PROMPT check được hỏi Jev, kết quả lưu vào artifact cùng thống kê độ khớp.
- Với `JEV`, kết quả Jev thay cho LLM và đi qua cùng các rào an toàn.
- Mặc định `LLM` thì không đổi gì.

Mapping cho một check (một request Jev cho mỗi check, các request chạy song song bằng `Promise.all`; thường chỉ có 3 check):
- `state` = `untrustedBlock` của evidence đã lọc theo doc type của chính check đó (`selectPromptEvidence(evidence, promptDataScope([check]).docTypes)`), cộng `compactMasterData` theo `masterGroups` của check.
- `questions.verdict` = `choice(check.prompt, check.jev_criteria ?? { PASS: 'Đạt…', FAIL: 'Không đạt…', INSUFFICIENT_DATA: 'Không đủ chứng từ…' })`. Kết quả wire: `{type:'choice', instructions, criteria}`.
- `check.prompt` (≤ 8.000 ký tự, `MAX_PROMPT_LENGTH`) đi vào `instructions`. Câu chỉ dẫn đang viết cho LLM ("Trả evidence_ids…") phải được rút gọn thành câu hỏi thuần, vì Jev không trả evidence. Nên có `jev_instructions` riêng trong check.
- `confidence` = xác suất của option thắng. `threshold` = `check.threshold`.
- `evidence_ids` = các evidence_id có trong `state`, xác định từ trước. Nhờ vậy vẫn áp được rào "PASS phải dựa trên evidence ACCEPTED" (`PROMPT_CHECK_EVIDENCE_NOT_ACCEPTED`). Rào `PROMPT_CHECK_EVIDENCE_MISSING` được hiểu lại là "tập evidence đưa vào rỗng".
- `message` sinh bằng template, ví dụ "Jev: PASS 0.91 (ngưỡng 0.85)", vì Jev không có `reason`.

Các bước (mỗi bước build được):

1. **Types + adapter + client.**
   - Files: `lib/jev/types.ts`, `lib/jev/contract/index.ts`, `lib/jev/contract/chat-json-v1.ts` (zod validate câu hỏi, `content = JSON.stringify({state, questions})`, parse chuỗi content, zod validate answer, kiểm tra ngữ nghĩa), `lib/jev/client.ts` (`HttpJevClient`: nạp connection AIHUB, `resolveConnectionSecret`, `applyModelOverride`, `assertSafeUrl` + `fetchJsonWithTimeout`, `extractTokenUsage`).
   - Verify bổ sung: test riêng cho adapter với các case: content có code fence, content không phải JSON, answer sai `type`, `choice` ngoài criteria, score ngoài khoảng, xác suất tổng khác 1, thiếu qid, câu hỏi dùng field cũ `options`/`levels` bị chặn trước khi gọi, 400 → `JEV_BAD_REQUEST`, 401 → `JEV_AUTH`, 429 → `JEV_RATE_LIMITED`, `completion_tokens: 0` không bật `outputTokensMissing`.
   - Verify: `tests/jev/client.test.ts` dùng loopback server (theo mẫu `tests/pipelines/external-api.test.ts`) với các case: request đúng shape, auth header, 4xx/5xx bọc thành `Connection Error to ext-jev`, response thiếu answer → `JEV_CONTRACT_ERROR`, host không nằm trong allowlist thì bị chặn. Chạy `npx jest tests/jev --ci --roots tests`.
2. **Decision core.**
   - File: `lib/jev/decision.ts` (`runDecision`, `evaluatePolicies` thuần).
   - Verify: `tests/jev/decision.test.ts` với các case: noul hai phía, choice dưới/trên ngưỡng, map outcome, Jev lỗi → REVIEW/`JEV_ERROR`, không throw.
3. **Mapping loan-appraisal.**
   - File: `lib/pipelines/workflows/loan-appraisal/jev-checks.ts` (`buildJevCheckRequest(check, input)`, `jevAnswerToRuleResult(check, answer, evidenceIds, acceptedIds)`). Tách `selectPromptEvidence` theo từng check nếu cần, nhưng không đổi output của đường LLM.
   - Verify: `tests/loan-appraisal/jev-checks.test.ts`, đồng thời `tests/loan-appraisal/prompt-checks.test.ts` và `prompt-hardening.test.ts` vẫn pass.
4. **Config.**
   - `check-set.ts`: thêm trường không bắt buộc `engine`, `jev_criteria`, `jev_instructions`, kèm validate.
   - `registry.ts`: thêm `decision_engine`, `jev_connection` cho `loan-appraisal`.
   - Verify: `npx jest tests/loan-appraisal/check-set-scope.test.ts tests/endpoints/encryption-params-registry.test.ts --ci --roots tests`. Lưu ý: `tests/financial-report/registry-params.test.ts` có đếm số param, nên chạy lại để chắc không vỡ.
5. **Nối vào stage 5.**
   - File: `loan-appraisal.ts`.
   - Đọc `ctx.pipelineVars.decision_engine`. `SHADOW` chạy LLM và Jev song song (`Promise.allSettled`) rồi ghi `extracted_data.jev_shadow` + `content_preview.jev`. `JEV` thay `promptResults`.
   - Gọi `assertNotCancelled` trước khi gọi Jev. Cộng usage vào `ctx.usageBreakdown`.
   - Verify: test mới `tests/loan-appraisal/stage5-jev.test.ts` mock `@/lib/jev/client` (theo mẫu `loan-appraisal-cancel.test.ts`), sau đó chạy `npx jest tests/loan-appraisal tests/pipelines --ci --roots tests` và `npx tsc --noEmit`.
6. **Mock + seed.**
   - `mock-service/routes/jev.js` giả lập `POST /jev/v1/chat/completions`:
     - `JSON.parse(messages[0].content)`. Content không phải JSON thì trả 400, giống LiteLLM. Sai tên field câu hỏi cũng trả 400 `INTERNAL_ERROR`.
     - Trả `{model, choices:[{message:{content: "<chuỗi JSON answers>"}}], usage:{prompt_tokens, completion_tokens:0}}`.
     - `?scenario=confident|uncertain|bad_json|error`.
   - Mount trong `mock-service/server.js`.
   - Thêm `ext-jev` vào `lib/db/seed.ts`:
     - `endpointUrl = ${MOCK_BASE_URL}/jev/v1/chat/completions`
     - `extraHeaders` AIHUB
     - `authType: 'BEARER'`, `authSecret` giả (`'test-client-secret'`)
     - `model: dbr-openjev-qwen35-4b`, `jev_contract: chat-json-v1`
     - `timeoutSec: 10`
   - Môi trường thật: admin đổi `endpointUrl` sang `https://aihub.aws.aif.vpbank.dev/v1/chat/completions`, đặt `vaultSecretPath`, và thêm host vào `ALLOWED_PRIVATE_HOSTS`.
   - Verify: chạy tay với worker + mock trên một hồ sơ mẫu, profile đặt `decision_engine=SHADOW`, rồi xem artifact stage 5 trong Operations UI.
7. **Đo đạc** (không phải code): chạy shadow trên 50–100 hồ sơ thật đã có kết luận của chuyên viên, so tỷ lệ khớp và calibration (reliability diagram) trước khi bật `JEV`.

Không làm trong POC: dùng Jev như một step pipeline qua đường AIHub, HITL pause cho loan-appraisal, bảng `DecisionLog`, UI cấu hình riêng.

## (e) Rủi ro và câu hỏi mở

| Mục | Rủi ro / câu hỏi | Đề xuất |
|---|---|---|
| Wire format | **Đã xác minh** (LiteLLM, `dbr-openjev-qwen35-4b`, user content là JSON `{state, questions}`, câu hỏi `{type, instructions, criteria}`). Rủi ro còn lại: LiteLLM/Databricks đổi phiên bản làm đổi format mà không báo, hoặc thông báo lỗi 400 `INTERNAL_ERROR` không nói rõ field nào sai | Adapter có version (`jev_contract`). Validate bằng zod trước khi gửi. Contract test chạy trên mock. Có smoke test thủ công khi nâng version hub |
| Auth | **Đã xác minh:** `Authorization: Bearer`. Còn mở: key dùng chung hay riêng cho từng ứng dụng, chính sách rotate | Lưu key trong Vault (`vaultSecretPath`). Dev dùng biến `JEV_API_KEY`. Không để ở `authSecret` (lưu plaintext, xem Q4) |
| Rate limit (mở) | Hạn mức RPM/TPM của LiteLLM cho key/model chưa biết. Fan-out theo check × hồ sơ có thể chạm 429 | Hỏi team hub. Giới hạn đồng thời trong `runDecision`. 429 → backoff 1 lần rồi REVIEW |
| Max context (mở) | `max_model_len` của `dbr-openjev-qwen35-4b` trên Databricks và giới hạn body của LiteLLM chưa biết | Hỏi team. Trần `state` theo ký tự/token (ước lượng qua `usage.prompt_tokens` trong shadow) |
| SLA độ trễ (mở) | Mới đo một lần, khoảng 2.8s (lần đầu, có TLS, từ máy dev). Chưa có p50/p95 từ mạng worker, chưa biết cold start của Databricks serving | Đo p50/p95 trong shadow (log `latencyMs`). `timeoutSec` 10. Không đặt Jev trên request path đồng bộ |
| Preset `jev_questions` (mở) | Có model dùng preset câu hỏi phía server. Chưa biết danh sách, cách version, ai sở hữu | POC không dùng preset, vì câu hỏi phải có version trong check set của DUGate |
| Mạng / SSRF / TLS | `aihub.aws.aif.vpbank.dev` có thể phân giải ra IP private. `ALLOWED_PRIVATE_HOSTS` chỉ so khớp chính xác. Doc DEPLOYMENT-CONFIG đang ví dụ CIDR sai. CA nội bộ? | Thêm `aihub.aws.aif.vpbank.dev` vào `ALLOWED_PRIVATE_HOSTS` cho app và worker. Thêm CA qua `NODE_EXTRA_CA_CERTS` nếu cần. Sửa doc riêng |
| Model 4B: calibration | Model nhỏ fine-tune thường quá tự tin. Các giá trị đo được (0.9997, 0.93) cho thấy phân phối có thể rất nhọn. Xác suất do System One trả chưa được kiểm chứng calibration trên dữ liệu tín dụng | Đo bằng ECE/reliability diagram trong shadow. Nếu lệch thì thêm temperature scaling hoặc isotonic theo từng check (tham số lưu trong check set, có version). Ngưỡng 0.85 hiện tại không chuyển thẳng sang được |
| Model 4B: tiếng Việt | Qwen có tiếng Việt, nhưng ở 4B thì suy luận trên văn bản OCR có dấu lỗi, tên riêng, thuật ngữ tín dụng (TSBĐ, GCN QSDĐ, HKD) còn yếu. Dễ nhầm "khác người" với "lỗi OCR" (đúng là việc của check BORROWER_IDENTITY) | Code chuẩn hoá trước (bỏ dấu/viết hoa khi so định danh), chỉ đưa cho Jev phần phán đoán. Bộ test vàng tiếng Việt là tiêu chí go/no-go. Giữ LLM lớn làm fallback dưới ngưỡng |
| Model 4B: context length | Context thực tế cấu hình trên hub chưa biết (Qwen nhỏ thường 32k, nhưng hub có thể đặt thấp hơn). Chất lượng của model 4B giảm rõ khi context dài. Evidence stage 5 hiện lên tới khoảng 18k ký tự (tiếng Việt khoảng 1 token/2–3 ký tự) | Mỗi check một request, chỉ chứa evidence liên quan. Đặt trần `state` (ví dụ 6k ký tự). Vượt trần thì trả `JEV_STATE_TOO_LARGE` → REVIEW. Hỏi team Jev về `max_model_len` |
| Model 4B: tuân thủ format | Answer có cấu trúc do System One sinh ra (đã thấy đúng shape trong lần gọi thử), nhưng content vẫn là chuỗi phải parse | Validate chặt bằng zod. Lỗi từng câu → REVIEW, không đoán |
| Ngôn ngữ | Lần gọi thử với tiếng Việt cho kết quả tốt, nhưng mới là câu hỏi CSKH đơn giản. Chưa thử trên evidence tín dụng hay văn bản OCR lỗi | Bộ test vàng tiếng Việt trong bước 7. Đây là tiêu chí go/no-go |
| Mất "reason" và evidence do model chọn | Jev không giải thích. Chuyên viên không thấy lý do. Rào evidence đổi ngữ nghĩa | BA/QLRR duyệt. Giữ LLM làm fallback (`FALLBACK_LLM`) cho các case dưới ngưỡng nếu cần lý do |
| Số học / ngày tháng | Jev yếu ở các phép này | Không hỏi Jev về DSCR/LTV/hạn/ngày. Giữ trong code (`rules.ts`, `dossier-checks.ts`). Lưu ý `PURPOSE.COHERENCE` có so sánh định lượng, nên đưa số đã tính sẵn vào `state` |
| Thông lượng | Mức đồng thời mà LiteLLM/Databricks chịu được chưa biết | Giới hạn đồng thời trong `runDecision` (p-limit, mặc định 4). Lỗi thì trả REVIEW, không làm fail workflow |
| Chi phí | Có `usage.prompt_tokens` nhưng không có cost. `estimateCost` sẽ trả `unpriced` nếu chưa có giá cho `ext:dbr-openjev-qwen35-4b` (bị cảnh báo UNPRICED, `hasUnpricedCost`) | Thêm dòng giá vào `model_pricing_json` (Settings › Bảng giá Model), hoặc chốt tính $0 nội bộ |
| Audit | Gọi in-process không tạo child Operation nên trace trên Operations UI ít hơn | Lưu `jev_shadow`/`DecisionOutcome` vào artifact. Cân nhắc `DecisionLog` ở giai đoạn 2 |
| Prompt injection | Văn bản chứng từ trong `state` có thể chứa "chỉ dẫn" nhằm lừa model | Dùng `untrustedBlock` như hiện tại. Mức chống chịu của Jev với injection chưa biết, cần test đối kháng |

### Phát hiện phụ (ngoài phạm vi, chưa xác minh hết tác động)

- `app/api/internal/ext-connections/route.ts:165`: `authSecret` lưu plaintext khi không dùng Vault, lệch SECURITY-RULES #5.
- Route resume (`app/api/v1/operations/[id]/resume/route.ts:90`) dùng `getPipelineQueue()` mặc định, không qua `resolveTargetQueue` theo worker group như `enqueueSubStep`. Profile gán worker group riêng có thể bị resume trên queue mặc định. Chưa chạy thử để xác nhận.
- `docs/DEPLOYMENT-CONFIG.md:248`: ví dụ CIDR cho `ALLOWED_PRIVATE_HOSTS` không khớp với cách code so khớp.

## Đã xác minh / chưa xác minh

- **Đã đọc code:** `external-api.ts`, `http-client.ts` (SSRF, fetch), `engine.ts` (`runPipeline`), `workflow-engine.ts` (`enqueueSubStep`, `pauseWorkflow`, `createWorkflowContext`, `runWorkflow`), `run-connector-prompt.ts`, `schema.ts` (Operation/ApiKey/ExternalApiConnection/Override/ProfileEndpoint), `runner.ts`, `registry.ts` (types + loan-appraisal), route resume v1, `disbursement.ts` (HITL), `loan-appraisal.ts` stage 4–5, `loan-appraisal/check-set.ts`, `loan-appraisal/prompt-checks.ts`, `mock-service/routes/connectors.js`, `secrets/resolve.ts`, `jest.config.js`, `tests/pipelines/external-api.test.ts` (đầu file).
- **Chưa đọc kỹ:** `account-opening` (chỉ grep), `submit.ts`, route `workflows`, `profile-resolver.mergeParameters`, UI cấu hình check set, `lib/auth-config/*`.
- **Chưa chạy gì.** Không chạy test, build hay probe. Mọi kết luận đều từ đọc code.
- **Về Jev:**
  - Hợp đồng wire (model id, auth, request/response, schema câu hỏi) do orchestrator xác minh bằng lời gọi thật. Bước khảo sát này **không** gọi endpoint và không thấy key.
  - DNS của `aihub.aws.aif.vpbank.dev` (public hay private) chưa kiểm từ mạng worker.
  - Rate limit, max context, SLA, preset vẫn còn mở.
