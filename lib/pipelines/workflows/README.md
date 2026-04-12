# Hướng dẫn: Tạo Workflow mới

## Tổng quan

Workflow là luồng xử lý tài liệu phức tạp, kết nối các steps thông minh (phân loại, bóc tách, đối chiếu, báo cáo) lại với nhau. Hệ thống hỗ trợ:
- **Tuần tự**: `await enqueueSubStep(...)` — chờ xong mới tiếp tục tiến trình.
- **Song song**: `Promise.all(items.map(...))` — chạy N jobs BullMQ đồng thời để tiết kiệm thời gian.
- **Truyền context & Checkpointing**: Output của bước trước có thể làm input của bước sau. Context được lưu (checkpoint) thông qua `currentStep` và `stepsResultJson` để tránh mất dữ liệu.
- **Realtime UI Polling**: Giao diện poll `GET /operations/{id}` để thấy tiến trình `(percent, message, results, status)` được cập nhật theo thời gian thực.
- **Human-in-the-Loop (HITL)**: Tạm dừng Workflow tại bất kỳ bước nào để chờ người dùng duyệt, chỉnh sửa dữ liệu, sau đó resume lại từ đúng checkpoint đó.

Mỗi sub-step là 1 BullMQ job riêng (hiện trong Dashboard), gọi tới connector thực tế qua mock-service hoặc External AI Provider.

---

## Cấu trúc thư mục

```
lib/pipelines/
├── workflow-engine.ts              ← Shared infrastructure (Lõi Engine)
│   ├── WorkflowContext             (Context chứa metadata, currentStep, files, costs...)
│   ├── enqueueSubStep()            (Tạo BullMQ job, chờ kết quả timeout 120s)
│   ├── pauseWorkflow()             (Tạm dừng, chuyển sang WAITING_USER_INPUT)
│   ├── updateProgress()            (Cập nhật % + message cho UI)
│   ├── completeWorkflow()          (Đánh dấu hoàn tất)
│   ├── failWorkflow()              (Đánh dấu lỗi/throw error)
│   └── WORKFLOW_REGISTRY           (Map tên pipeline process → hàm xử lý)
│
└── workflows/
    ├── disbursement.ts             ← Ví dụ mẫu tiêu chuẩn (Giải ngân)
    ├── prompts/
    │   └── disbursement-prompts.ts ← Nơi tách prompt builders cho code gọn gàng
    └── <ten-workflow-moi>.ts       ← File bạn sẽ tạo
```

---

## Các bước tạo Workflow mới

### Bước 1: Tạo file workflow

Tạo file `lib/pipelines/workflows/<ten-workflow>.ts`:

```typescript
// lib/pipelines/workflows/appraisal.ts
// Workflow: Thẩm định tài sản

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  pauseWorkflow,
  completeWorkflow,
} from '@/lib/pipelines/workflow-engine';

export async function runAppraisal(ctx: WorkflowContext): Promise<void> {
  const { logger, filesJson, pipelineVars } = ctx;
  const resumeFromStep = ctx.currentStep; // Checkpoint phục hồi

  let data = {};

  // ── STEP 1: Tuần tự ──────────────────────────────────────
  if (resumeFromStep <= 0) {
    logger.info('[WORKFLOW] Step 1: Phân loại cơ bản');
    await updateProgress(ctx, 10, 'Bước 1: Đang phân loại...');

    const step1 = await enqueueSubStep(
      ctx,
      'ext-classifier',       // slug connector trong DB
      { ...pipelineVars },    // variables truyền vào prompt
      filesJson,              // files gốc (dạng JSON Array string)
    );

    // Kỹ thuật parse payload lồng nhau tránh lỗi "double-escaped JSON"
    try { data = JSON.parse(step1.content || '{}'); } catch {}

    // Lưu vào stepsResult (UI sẽ hiện bảng kết quả)
    ctx.stepsResult.push({
      step: 0,
      stepName: 'Phân loại',
      processor: 'ext-classifier',
      sub_operation_id: step1.operation.id,
      content_preview: data, 
      extracted_data: data,
    });
    
    await updateProgress(ctx, 50, 'Bước 1 hoàn tất.');
  } else {
    // Phục hồi dữ liệu nếu nhảy qua bước do resume
    data = ctx.stepsResult.find(s => s.step === 0)?.extracted_data || {};
  }

  // ── STEP 2: Song song & Human-In-The-Loop ─────────────────
  if (resumeFromStep <= 1) {
    const items = ['a', 'b'];
    await updateProgress(ctx, 55, `Bước 2: Bóc tách song song ${items.length} items...`);

    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const r = await enqueueSubStep(ctx, 'ext-data-extractor', { item }, filesJson);
          return { item, status: 'success', content: JSON.parse(r.content || '{}') };
        } catch (e: any) {
          return { item, status: 'error', error: e.message };
        }
      })
    );

    ctx.stepsResult.push({
      step: 1,
      stepName: 'Bóc tách dữ liệu',
      processor: 'ext-data-extractor',
      extracted_data: results,
      sub_results: results, // array kết quả con để UI loop
    });
    await updateProgress(ctx, 90, 'Bước 2 hoàn tất. Chờ phê duyệt (HITL).');

    // Dừng pipeline lại ở Bước 2, đợi người dùng edit JSON.
    // Lần chạy tiếp theo (Resume), ctx.currentStep sẽ là 2.
    return pauseWorkflow(ctx, 'Vui lòng kiểm duyệt kết quả Bóc tách trước khi tiếp tục.', 2);
  }

  // ── DONE ────────────────────────────────────────────────
  await completeWorkflow(ctx, 'Kết quả cuối cùng dạng Markdown', data);
}
```

### Bước 2: Đăng ký vào Registry

Mở `lib/pipelines/workflow-engine.ts`, thêm vào cuối file trong biến `WORKFLOW_REGISTRY`:

```typescript
import { runAppraisal } from '@/lib/pipelines/workflows/appraisal';

const WORKFLOW_REGISTRY: Record<string, (ctx: WorkflowContext) => Promise<void>> = {
  disbursement: runDisbursement,
  appraisal: runAppraisal,       // ← THÊM DÒNG NÀY
};
```

### Bước 3: Đăng ký endpoint Profile API

Mở `lib/endpoints/registry.ts`, thêm `subCase` mới trong group `workflows`:

```typescript
workflows: {
  subCases: {
    disbursement: { ... },
    appraisal: {                 // ← THÊM BLOCK NÀY
      label: 'Thẩm định tài sản',
      description: 'Workflow thẩm định giá trị tài sản đảm bảo',
      parameters: {
        asset_type: { type: 'string', required: false },
      },
    },
  },
},
```

### Bước 4: Rebuild & Test

Bởi vì codebase của Worker hoàn toàn được đóng gói trong Docker, mỗi lần sửa file TS trong `lib/` bạn **Phải build và restart lại Worker**:

```bash
# Debug Terminal (Hot reload)
npx tsx worker.ts

# Rebuild Docker worker (Môi trường chuẩn)
docker-compose build worker
docker-compose up -d worker
```

**Lệnh Test bằng cURL thủ công:**
```bash
# Bắn API tạo workflow
curl -X POST http://localhost:2023/api/v1/workflows \
  -H "x-api-key: sk-admin-default-secret-key" \
  -F "process=appraisal" \
  -F "files[]=@document.pdf"

# Resume workflow (Hit WAITING_USER_INPUT pause state)
curl -X POST http://localhost:2023/api/v1/operations/{operation_id}/resume \
  -H "x-api-key: sk-admin-default-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"modifiedPayload": {"step": 1, "jsonStr": "{ \"item\": \"a modified\" }" }}'
```

---

## API Reference nhanh

### `enqueueSubStep(ctx, processorSlug, variables, filesJson)`

| Tham số | Ý nghĩa |
|---------|---------|
| `ctx` | WorkflowContext (chứa operationId, logger, db stats...) |
| `processorSlug` | Slug connector trong DB: `ext-classifier`, `ext-data-extractor`, `ext-fact-verifier`, ... |
| `variables` | Object truyền vào prompt template. |
| `filesJson` | JSON string mảng files (`ctx.filesJson`), hoặc `null`. Mảng file sẽ được forward qua `multipart/form-data` |

**Trả về**: `{ operation, content, extractedData }`

### Tracking State Functions

- **`updateProgress(ctx, percent, message)`**: Cập nhật DB. Hỗ trợ UI progress bar.
- **`pauseWorkflow(ctx, message, nextStepIndex)`**: Dừng pipeline (đánh dấu `WAITING_USER_INPUT`) và lưu checkpoint `nextStepIndex`. 
- **`completeWorkflow(ctx, outputContent, extractedData)`**: Đánh dấu `SUCCEEDED`. Lưu DB + Token Cost + Trigger Webhook.
- **`failWorkflow(ctx, error)`**: Đánh dấu `FAILED`.

---

## Mẹo & Xử lý lỗi thường gặp

1. **Double Escaped JSON (`"{\"key\":\"val\"}"`)**: Connector output trả về string. Hãy thiết kế hàm tiện ích parseDeep tĩnh để chuyển hóa chuỗi JSON kép lồng nhau về lại dạng Native Object trước khi push vào `ctx.stepsResult`. Giao diện AI-Demo sẽ render đẹp và tự thụt lề thay thế.
2. **Crash Worker lúc Resuming**: Biến nội bộ (e.g. `mergedClassifyData`) trong Workflow của bạn thường không tồn tại khi Resume (do process Node.js restart hoặc skip lại Step cũ). Luôn ưu tiên dùng `ctx.stepsResult.find(...)` phục hồi nó từ Checkpoint thay vì Query Database vòng vèo!
3. **Mất Đồng Bộ Tiến Trình (Timeout)**: Thời gian Timeout cứng cho 1 job SubStep là 120 giây (Xem `SUB_STEP_TIMEOUT`). Nếu Job con chạy lố, Worker Workflow sẽ chủ động throw Exception để tránh treo Memory rác.
4. **Error isolation**: Nếu bạn chạy `Promise.all` và không muốn bị hỏng toàn bộ pipeline khi có 1 job lỗi. Bạn cần bọc `try/catch` tại CẤP ĐỘ MAP callback, return object `{ status: 'error', reason: err }` vào array, và check độ dài array đó thay vì ném throw ra hàm cha.

---

## Tài liệu Tích hợp Client (Client API Integration)

Dành cho các hệ thống Frontend, ERP, Mobile App hoặc đối tác (Client) muốn tích hợp và gọi Workflow của hệ thống này.

### 1. Khởi tạo Workflow (`POST /api/v1/workflows`)

Client sẽ gửi tài liệu và các tham số khởi tạo thông qua `multipart/form-data`.

- **Endpoint**: `POST /api/v1/workflows`
- **Headers**:
  - `x-api-key`: API Key của ứng dụng/profile.
- **Body (`form-data`)**:
  - `process` (Required): Tên workflow (VD: `disbursement`, `appraisal`).
  - `files[]` (Optional): Danh sách các file tài liệu đính kèm.
  - `webhookUrl` (Optional): URL nhận callback khi workflow hoàn tất hoặc PAUSED.
  - `[...custom_vars]` (Optional): Các biến tùy chỉnh khác (như `applicantName`, `referenceNumber`).
  
**Kết quả trả về**: Hệ thống KHÔNG trả về kết quả ngay do tính chất bất đồng bộ. Thay vào đó trả về `operation_id` để Client tracking.

```json
{
  "operation_id": "f5d0a6c...-...",
  "status": "RUNNING",
  "message": "Workflow started successfully."
}
```

### 2. Theo dõi Tiến độ (`GET /api/v1/operations/{id}`)

Client sử dụng `operation_id` để gọi Polling định kỳ (e.g. mỗi 2 - 3 giây) nhằm vẽ thanh Tiến trình (Progress Bar), lấy trạng thái hiện tại hoặc nhận dữ liệu bảng (Step Result).

- **Endpoint**: `GET /api/v1/operations/{operation_id}`
- **Headers**:
  - `x-api-key`: API Key của ứng dụng.

**Response Paylaod**:
```json
{
  "id": "f5d0a6c...-...",
  "state": "RUNNING",             // Các state: RUNNING, SUCCEEDED, FAILED, WAITING_USER_INPUT
  "progressPercent": 45,          // 45% (Dùng vẽ Progress bar)
  "progressMessage": "Bước 2/4: Đang Bóc tách hóa đơn...",
  "stepsResult": [ ... ],         // Chi tiết output của từng bước (Dùng render Data Grid)
  "outputContent": null,          // Kết quả cuối cùng (Chỉ có khi state = SUCCEEDED)
  "errorMessage": null
}
```

### 3. Phê duyệt & Tiếp tục (Human-in-the-Loop)

Nếu workflow gọi `pauseWorkflow()`, state sẽ chuyển sang `WAITING_USER_INPUT`. 
Lúc này, UI của Client có thể hiển thị form cho phép Người dùng (Human) kiểm tra và chỉnh sửa dữ liệu JSON/Forms. Sau khi duyệt xong, Client gửi yêu cầu Resume:

- **Endpoint**: `POST /api/v1/operations/{operation_id}/resume`
- **Headers**:
  - `x-api-key`: API Key.
  - `Content-Type`: `application/json`
- **Body**: Truyền vào dữ liệu đã được người dùng chỉnh sửa.
  ```json
  {
    "modifiedPayload": {
      "verified_data": { ... } // Dữ liệu đã edit
    }
  }
  ```

Hệ thống sẽ cập nhật lại DB và tái khởi động BullMQ Worker chạy các bước kế tiếp.

### 4. Tích hợp Webhook (Push Notify)

Nếu Client không muốn gọi Polling liên tục, họ có thể khai báo tham số `webhookUrl` khi tạo Workflow.
Khi Workflow có sự kiện chuyển đổi trạng thái (e.g. `SUCCEEDED`, `FAILED`, `PAUSED`), Hệ thống sẽ tự động gọi luồng `POST` lại về webhook URL của Client.

**Payload nhận được tại Client Webhook:**
```json
{
  "operation_id": "f5d0a6c...",
  "state": "SUCCEEDED",       // Hoặc FAILED / PAUSED
  "done": true,              
  "error": null               // Chứa mã lỗi nếu state là FAILED
}
```
