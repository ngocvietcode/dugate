# Hướng dẫn: Workflow Pipeline

## Tổng quan

Workflow là luồng xử lý tài liệu phức tạp, kết nối các bước AI (phân loại, bóc tách, đối chiếu, báo cáo) thành một pipeline hoàn chỉnh. Hệ thống hỗ trợ:
- **Tuần tự**: `await enqueueSubStep(...)` — chờ xong mới tiếp tục.
- **Song song**: `Promise.all(items.map(...))` — chạy N jobs BullMQ đồng thời.
- **Checkpointing**: Context được lưu vào DB qua `currentStep` và `stepsResultJson` để tránh mất dữ liệu khi resume.
- **Human-in-the-Loop (HITL)**: Tạm dừng workflow để người dùng duyệt/chỉnh dữ liệu, sau đó resume từ đúng checkpoint.
- **Prompt Override**: Mỗi bước AI có prompt mặc định trong code. Admin và Client có thể override từng bước qua UI hoặc API.

Mỗi sub-step là 1 BullMQ job riêng, gọi tới connector qua External API hoặc mock-service.

---

## Cấu trúc thư mục

```
lib/pipelines/
├── workflow-engine.ts              ← Shared infrastructure (KHÔNG SỬA, chỉ import)
│   ├── WorkflowContext             (Context chứa metadata, currentStep, files, costs, promptOverrides)
│   ├── parseDeep()                 (Tiện ích parse JSON lồng nhau — DÙNG CHUNG)
│   ├── enqueueSubStep()            (Tạo BullMQ job, chờ kết quả, timeout 120s)
│   ├── pauseWorkflow()             (Tạm dừng → WAITING_USER_INPUT)
│   ├── updateProgress()            (Cập nhật % + message cho UI)
│   ├── completeWorkflow()          (Đánh dấu SUCCEEDED, trigger webhook)
│   ├── failWorkflow()              (Đánh dấu FAILED)
│   └── WORKFLOW_REGISTRY           (Map tên workflow → hàm handler)
│
└── workflows/
    ├── disbursement.ts             ← Workflow mẫu tiêu chuẩn (Giải ngân)
    ├── prompts/
    │   ├── disbursement-prompts.ts ← Prompt builders + Types cho disbursement
    │   └── <workflow>-prompts.ts   ← Tạo file tương tự cho workflow mới
    └── <ten-workflow-moi>.ts       ← File workflow mới
```

---

## Hệ thống Prompt — Hiểu trước khi code

Đây là cơ chế quan trọng nhất. Mỗi bước AI trong workflow có **3 tầng prompt** theo thứ tự ưu tiên:

```
Priority:  [Code _prompt]  >  [Profile Override (UI/API)]  >  [DB Connector Default]
```

### Tầng 1: Code Prompt (Mặc định)
Prompt được viết trong file `*-prompts.ts`, build bằng hàm `buildXxxPrompt()`.
Đây là prompt chạy mặc định khi không có override nào được cấu hình.

```typescript
// disbursement-prompts.ts
export function buildClassifyPrompt(
  fileName: string,
  promptOverride?: string,  // ← Luôn nhận param override
): Record<string, unknown> {
  if (promptOverride) {
    // Tầng 2: Override từ Profile UI/API được inject vào đây
    return { _prompt: interpolatePrompt(promptOverride, { file_name: fileName, ... }) };
  }

  // Tầng 1: Prompt mặc định trong code
  return {
    _prompt: `Phân loại tài liệu "${fileName}" vào các nhóm...`,
  };
}
```

Trong workflow file, truyền override vào từ `ctx.promptOverrides`:
```typescript
// disbursement.ts
await enqueueSubStep(
  ctx,
  'ext-classifier',
  buildClassifyPrompt(file.name, ctx.promptOverrides.classify),  // ← Key là tên step
  singleFileJson,
);
```

**Key của `ctx.promptOverrides`** phải khớp với `step.key` trong `DISBURSEMENT_STEPS` (UI):
- `classify` → Bước 1: Phân loại
- `extract` → Bước 2: Bóc tách
- `crosscheck` → Bước 3: Đối chiếu
- `report` → Bước 4: Tờ trình

### Tầng 2: Profile Override (UI và API)
Admin có thể override prompt của từng bước qua **Trang Profiles → Workflow Prompts Panel**.

Dữ liệu được lưu vào `ProfileEndpoint.parameters` dưới dạng:
```json
{
  "_workflowPrompts": {
    "value": {
      "classify": "Prompt override cho bước 1...",
      "report": "Prompt override cho bước 4... dùng {{classify_summary}}"
    },
    "isLocked": false
  }
}
```

Engine sẽ load tự động vào `ctx.promptOverrides` khi workflow khởi động:
```typescript
// workflow-engine.ts — createWorkflowContext()
promptOverrides = params._workflowPrompts.value;
// → { classify: "...", report: "..." }
```

### Tầng 3: DB Connector Default
Nếu cả 2 tầng trên đều không có → Engine dùng `connection.defaultPrompt` từ DB connector config. Đây là fallback cuối cùng.

---

## Cách setup Prompt qua UI (Profiles Page)

Dành cho Admin cần tùy chỉnh prompt cho một ứng dụng/client cụ thể mà không cần deploy code mới.

**Điều kiện:** Endpoint phải là `isWorkflow = true`.

**Các bước:**

1. Mở **Profiles** → Chọn Profile → Tìm endpoint workflow (VD: `workflows/disbursement`)
2. Click **Chỉnh sửa** → Cuộn xuống mục **Workflow Prompts (X Bước DAG)**
3. Mỗi bước hiển thị:
   - **Code Prompt (Mặc định)**: Preview prompt gốc từ code
   - **Biến dynamic**: Danh sách `{{variable}}` có thể dùng trong override
   - Button **Override Prompt**: Kích hoạt để nhập prompt mới
4. Khi override active, bạn có thể nhập prompt tùy chỉnh. Dùng các biến dynamic bằng cách click vào button biến hoặc gõ tay `{{variable_name}}`
5. Click **Lưu Toàn bộ Thiết lập** → Override được lưu vào DB

> ⚠️ **Lưu ý quan trọng khi override Bước 2, 3, 4**: Các bước này có phần **dynamic sections** được inject từ bước trước.
> Nếu bạn override mà không giữ các biến `{{doc_sections}}`, `{{extraction_detail}}`, v.v., dữ liệu từ bước trước sẽ bị mất.

**Các biến dynamic theo từng bước:**

| Bước | Key | Biến có thể dùng |
|------|-----|-----------------|
| 1. Classify | `classify` | `{{file_name}}`, `{{categories}}` |
| 2. Extract | `extract` | `{{file_name}}`, `{{doc_sections}}` ← dynamic từ Bước 1 |
| 3. Crosscheck | `crosscheck` | `{{extraction_summary}}`, `{{extraction_detail}}`, `{{reference_data}}` ← dynamic |
| 4. Report | `report` | `{{classify_summary}}`, `{{extraction_data}}`, `{{crosscheck_verdict}}`, `{{checks_summary}}` |

---

## Cách setup Prompt qua API

Client cũng có thể truyền prompt override khi gọi API (nếu `_workflowPrompts` param không bị `isLocked: true`).

```bash
curl -X POST http://localhost:2023/api/v1/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -F "process=disbursement" \
  -F "files[]=@invoice.pdf" \
  -F '_workflowPrompts={"classify":"Custom classify prompt...","report":"Custom report..."}'
```

> ⚠️ Nếu Admin đã bật **🔒 KHÓA** cho `_workflowPrompts` trong Profiles, Client sẽ không override được — giá trị Profile sẽ luôn được dùng.

---

## Tạo Workflow mới — Từng bước

### Bước 1: Tạo file prompts

```typescript
// lib/pipelines/workflows/prompts/appraisal-prompts.ts

export function buildAppraisalPrompt(
  data: unknown,
  promptOverride?: string,
): Record<string, unknown> {
  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, { data: JSON.stringify(data) }) };
  }
  return { _prompt: `Thẩm định tài sản dựa trên: ${JSON.stringify(data)}...` };
}

function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    key in vars ? vars[key] : match,
  );
}
```

### Bước 2: Tạo file workflow

```typescript
// lib/pipelines/workflows/appraisal.ts
import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  pauseWorkflow,
  completeWorkflow,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';
import { buildAppraisalPrompt } from './prompts/appraisal-prompts';

export async function runAppraisal(ctx: WorkflowContext): Promise<void> {
  const { logger, filesJson } = ctx;
  const resumeFromStep = ctx.currentStep;

  if (resumeFromStep <= 0) {
    await updateProgress(ctx, 10, 'Bước 1: Đang phân tích...');

    const step1 = await enqueueSubStep(
      ctx,
      'ext-classifier',
      buildAppraisalPrompt({}, ctx.promptOverrides.classify), // ← truyền override
      filesJson,
    );

    // Luôn dùng parseDeep cho output AI
    const data = parseDeep(step1.content);

    ctx.stepsResult.push({
      step: 0,
      stepName: 'Phân tích tài sản',
      processor: 'ext-classifier',
      sub_operation_id: step1.operation.id,
      content_preview: data,
      extracted_data: data,
    });
    await updateProgress(ctx, 50, 'Bước 1 hoàn tất.');
  }

  if (resumeFromStep <= 1) {
    // ... xử lý tiếp ...
    return pauseWorkflow(ctx, 'Vui lòng kiểm tra trước khi tiếp tục.', 2);
  }

  await completeWorkflow(ctx, 'Kết quả cuối cùng', {});
}
```

### Bước 3: Đăng ký vào Registry

```typescript
// lib/pipelines/workflow-engine.ts — cuối file
import { runAppraisal } from '@/lib/pipelines/workflows/appraisal';

const WORKFLOW_REGISTRY = {
  disbursement: runDisbursement,
  appraisal: runAppraisal,    // ← THÊM DÒNG NÀY
};
```

### Bước 4: Đăng ký Endpoint

```typescript
// lib/endpoints/registry.ts
workflows: {
  subCases: {
    disbursement: { ... },
    appraisal: {
      label: 'Thẩm định tài sản',
      description: 'Workflow thẩm định giá trị tài sản',
      parameters: {},
    },
  },
},
```

### Bước 5: Thêm Step Config cho Workflow Prompt Panel (UI)

```typescript
// app/profiles/page.tsx — tạo mảng steps tương tự DISBURSEMENT_STEPS
const APPRAISAL_STEPS: WorkflowStep[] = [
  {
    key: 'classify',          // ← phải khớp với ctx.promptOverrides.classify
    label: 'Bước 1: Phân tích',
    icon: '🏠',
    connector: 'ext-classifier',
    description: 'Phân tích thông tin tài sản',
    variables: [{ name: '{{file_name}}', desc: 'Tên file đang xử lý' }],
    codePromptPreview: `Thẩm định tài sản trong file "{{file_name}}"...`,
    hasDynamicSections: false,
  },
];
```

### Bước 6: Rebuild & Test

```bash
# Phát triển (hot reload — không cần Docker rebuild)
npx tsx worker.ts

# Production
docker-compose build worker
docker-compose up -d worker

# Test
curl -X POST http://localhost:2023/api/v1/workflows \
  -H "x-api-key: sk-admin-default-secret-key" \
  -F "process=appraisal" \
  -F "files[]=@document.pdf"
```

---

## API Reference

### `enqueueSubStep(ctx, processorSlug, variables, filesJson)`

| Tham số | Ý nghĩa |
|---------|---------|
| `ctx` | WorkflowContext — chứa `operationId`, `logger`, `promptOverrides`, `costs` |
| `processorSlug` | Slug connector: `ext-classifier`, `ext-data-extractor`, `ext-fact-verifier`, `ext-content-gen` |
| `variables` | Object truyền vào connector. Dùng key `_prompt` để bypass DB template |
| `filesJson` | JSON string array files hoặc `null` |

**Trả về**: `{ operation: Operation, content: string | null, extractedData: unknown }`

### Lifecycle Functions

| Function | Tác dụng |
|---|---|
| `updateProgress(ctx, percent, message)` | Cập nhật DB progress. UI poll thấy ngay. |
| `pauseWorkflow(ctx, message, nextStep)` | Chuyển sang `WAITING_USER_INPUT`. Lưu checkpoint `nextStep`. |
| `completeWorkflow(ctx, outputContent, data)` | Đánh dấu `SUCCEEDED`. Lưu cost + trigger webhook. |
| `failWorkflow(ctx, error)` | Đánh dấu `FAILED`. |
| `parseDeep(val)` | Recursively unpack JSON string lồng nhau → native object. Luôn dùng cho output AI. |

---

## Mẹo & Lưu ý quan trọng

1. **Luôn dùng `parseDeep()`** cho output của AI connector trước khi push vào `stepsResult`. AI thường trả về JSON string lồng nhau — `parseDeep` xử lý toàn bộ đệ quy.
2. **Phục hồi state khi Resume** — Biến nội bộ biến mất khi Node.js restart. Luôn dùng `ctx.stepsResult.find(s => s.step === N)?.extracted_data` thay vì biến local.
3. **Timeout** — Sub-step timeout cứng là 120s. Sau đó engine kiểm tra DB — nếu job đã done nhưng event bị miss thì vẫn tiếp tục.
4. **Error isolation** — Trong `Promise.all`, wrap `try/catch` ở từng `map()` callback và return `{ status: 'error' }`, tránh throw hủy toàn batch.
5. **Key `_prompt` bypass DB** — Khi truyền `{ _prompt: "..." }` vào variables, connector dùng giá trị này thay vì `defaultPrompt` trong DB.
6. **Import order** — Tất cả `import` phải ở đầu file, kể cả `pauseWorkflow`.

---

## Tích hợp Client

### `POST /api/v1/workflows` — Khởi tạo

```bash
curl -X POST http://localhost:2023/api/v1/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -F "process=disbursement" \
  -F "files[]=@invoice.pdf" \
  -F "webhookUrl=https://your-app.com/webhook"
```

### `GET /api/v1/operations/{id}` — Theo dõi

```json
{
  "state": "RUNNING | SUCCEEDED | FAILED | WAITING_USER_INPUT",
  "progressPercent": 45,
  "progressMessage": "Bước 2/4: Đang bóc tách...",
  "stepsResult": [ ... ],
  "outputContent": null
}
```

### `POST /api/v1/operations/{id}/resume` — Phê duyệt HITL

```bash
curl -X POST http://localhost:2023/api/v1/operations/{id}/resume \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "step": 1, "extracted_data": { ... } }'
```

> `step` là index bước cần cập nhật. Index `0` hợp lệ.

### Webhook Payload

```json
{ "operation_id": "...", "state": "SUCCEEDED", "done": true, "error": null }
```

`done: false` khi `PAUSED` (HITL). `done: true` chỉ khi `SUCCEEDED` hoặc `FAILED`.
