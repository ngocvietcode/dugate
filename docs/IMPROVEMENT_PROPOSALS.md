# Đề Xuất Cải Tiến Hệ Thống DU API

**Version:** 1.0  
**Ngày lập:** 02/04/2026  
**Tham chiếu:** `docs/ARCHITECTURE_REVIEW_API.md`  
**Tác giả:** Solution Architect

---

## Mục Lục

| # | Đề Xuất | Mức Ưu Tiên | Effort |
|---|---------|:-----------:|:------:|
| 1 | [Rate Limiting per API Key](#1-rate-limiting-per-api-key) | 🔴 P0 | 1 ngày |
| 2 | [Retry & Circuit Breaker cho Pipeline](#2-retry--circuit-breaker-cho-pipeline) | 🔴 P0 | 1.5 ngày |
| 3 | [Input Validation với Zod](#3-input-validation-với-zod) | 🟡 P1 | 1 ngày |
| 4 | [Fix Prompt Template Engine (Handlebars)](#4-fix-prompt-template-engine-handlebars) | 🟡 P1 | 0.5 ngày |
| 5 | [Multi-document Compare (3+ files)](#5-multi-document-compare-3-files) | 🟡 P1 | 1 ngày |
| 6 | [Cross-language Comparison Workflow](#6-cross-language-comparison-workflow) | 🟢 P2 | 2 ngày |
| 7 | [Batch Processing Endpoint](#7-batch-processing-endpoint) | 🟢 P2 | 2 ngày |
| 8 | [Pre-signed Upload (S3/MinIO)](#8-pre-signed-upload-s3minio) | 🟢 P2 | 3 ngày |
| 9 | [OpenAPI Schema Auto-generation](#9-openapi-schema-auto-generation) | 🟢 P2 | 2 ngày |
| 10 | [Structured Logging & Observability](#10-structured-logging--observability) | 🟢 P2 | 1 ngày |

---

## 1. Rate Limiting per API Key

### Vấn đề
Hiện tại `runner.ts` và middleware không có bất kỳ cơ chế giới hạn request nào. Một API Key có thể gửi vô hạn request/giây, dẫn đến:
- Nguy cơ DDoS từ client (cố ý hoặc bug loop)
- Cạn kiệt tài nguyên External API (và bị provider chặn)
- Một client "ăn" hết quota, ảnh hưởng client khác

### Giải pháp: Sliding Window Rate Limiter

**Phương án A — In-memory (Phù hợp single-instance):**
Sử dụng Map lưu timestamp window per API Key ngay trong process Node.js.

**Phương án B — Redis-based (Phù hợp multi-instance):**
Sử dụng Redis INCR + EXPIRE cho distributed rate limiting.

**Khuyến nghị:** Bắt đầu với **Phương án A**, migrate sang B khi scale.

### Thiết kế chi tiết

#### File mới: `lib/middleware/rate-limiter.ts`

```typescript
// Sliding window counter per API Key
interface RateWindow {
  count: number;
  resetAt: number; // epoch ms
}

const windows = new Map<string, RateWindow>();

const DEFAULT_LIMIT = 60;       // 60 requests
const DEFAULT_WINDOW_MS = 60000; // per 1 phút

export function checkRateLimit(
  apiKeyId: string,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const key = `rate:${apiKeyId}`;
  let window = windows.get(key);

  // Window hết hạn → reset
  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + windowMs };
    windows.set(key, window);
  }

  window.count++;

  return {
    allowed: window.count <= limit,
    remaining: Math.max(0, limit - window.count),
    resetAt: window.resetAt,
  };
}
```

#### Tích hợp vào `runner.ts`
```typescript
// Thêm ở đầu hàm runEndpoint(), sau khi lấy apiKeyId:
const rateCheck = checkRateLimit(apiKeyId ?? 'anonymous');
if (!rateCheck.allowed) {
  return NextResponse.json(
    { type: 'https://dugate.vn/errors/rate-limited', title: 'Too Many Requests',
      status: 429, detail: 'Rate limit exceeded. Try again later.' },
    { status: 429,
      headers: {
        'X-RateLimit-Remaining': String(rateCheck.remaining),
        'X-RateLimit-Reset': String(Math.ceil(rateCheck.resetAt / 1000)),
        'Retry-After': String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)),
      },
    }
  );
}
```

#### Cấu hình per-key (nâng cao)
Cho phép admin set limit per API Key thông qua Prisma:
```prisma
model ApiKey {
  // ... existing fields
  rateLimitPerMinute Int @default(60)
}
```

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 1 ngày (4h code + 4h test) |
| **Files ảnh hưởng** | `lib/middleware/rate-limiter.ts` (mới), `lib/endpoints/runner.ts` |
| **DB migration** | Không (Phương án A). Có nếu thêm trường vào ApiKey |
| **Risk** | Thấp — logic độc lập, không ảnh hưởng pipeline |
| **Rollback** | Xóa 1 block `if` trong runner.ts |

---

## 2. Retry & Circuit Breaker cho Pipeline

### Vấn đề
Hiện tại trong `engine.ts` (dòng 147):
```typescript
const result = await runExternalApiProcessor(ctx, connection, extOverride);
```
Nếu External API trả về lỗi 502/503 tạm thời hoặc timeout mạng, pipeline **fail vĩnh viễn** và đánh dấu `state: 'FAILED'`. Không có cơ chế:
- Retry tự động (exponential backoff)
- Circuit breaker (tạm ngắt connector bị lỗi liên tiếp)
- Dead-letter queue (lưu job fail để xử lý lại)

### Giải pháp: Retry Wrapper + Circuit Breaker

#### File mới: `lib/pipelines/retry.ts`

```typescript
interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[]; // HTTP status codes or error patterns
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,    // 1s → 2s → 4s
  maxDelayMs: 15000,    // Cap at 15s
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'HTTP 502', 'HTTP 503', 'HTTP 429'],
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  options = DEFAULT_OPTIONS
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetryable = options.retryableErrors.some(
        pattern => lastError!.message.includes(pattern)
      );

      if (!isRetryable || attempt === options.maxRetries) {
        throw lastError;
      }

      // Exponential backoff + jitter
      const delay = Math.min(
        options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        options.maxDelayMs
      );
      logger.warn(
        `[RETRY] Attempt ${attempt + 1}/${options.maxRetries} failed: ${lastError.message}. ` +
        `Retrying in ${Math.round(delay)}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

#### File mới: `lib/pipelines/circuit-breaker.ts`

```typescript
interface CircuitState {
  failures: number;
  lastFailure: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

const circuits = new Map<string, CircuitState>();
const FAILURE_THRESHOLD = 5;     // 5 lỗi liên tiếp → mở mạch
const RECOVERY_TIMEOUT = 30000;  // 30s sau mở lại thử

export function checkCircuit(slug: string): boolean {
  const circuit = circuits.get(slug);
  if (!circuit || circuit.state === 'CLOSED') return true; // OK

  if (circuit.state === 'OPEN') {
    // Thử lại sau timeout
    if (Date.now() - circuit.lastFailure > RECOVERY_TIMEOUT) {
      circuit.state = 'HALF_OPEN';
      return true; // Cho 1 request thử
    }
    return false; // Vẫn chặn
  }

  return true; // HALF_OPEN → cho qua
}

export function recordSuccess(slug: string) {
  circuits.set(slug, { failures: 0, lastFailure: 0, state: 'CLOSED' });
}

export function recordFailure(slug: string) {
  const circuit = circuits.get(slug) ?? { failures: 0, lastFailure: 0, state: 'CLOSED' };
  circuit.failures++;
  circuit.lastFailure = Date.now();

  if (circuit.failures >= FAILURE_THRESHOLD) {
    circuit.state = 'OPEN';
  }
  circuits.set(slug, circuit);
}
```

#### Tích hợp vào `engine.ts`
```typescript
// Thay dòng 147:
// const result = await runExternalApiProcessor(ctx, connection, extOverride);

// Thành:
if (!checkCircuit(connection.slug)) {
  throw new Error(`Circuit OPEN for '${connection.slug}'. Service temporarily unavailable.`);
}

const result = await withRetry(
  () => runExternalApiProcessor(ctx, connection, extOverride),
  logger,
);

recordSuccess(connection.slug);

// Trong catch block, thêm:
// recordFailure(connection.slug);
```

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 1.5 ngày (6h code + 6h test retry scenarios) |
| **Files ảnh hưởng** | 2 file mới + `engine.ts` (3 dòng sửa) |
| **DB migration** | Không |
| **Risk** | Trung bình — cần test kỹ edge case retry loop |
| **Rollback** | Revert engine.ts về gọi trực tiếp |

---

## 3. Input Validation với Zod

### Vấn đề
`runner.ts` dòng 132-137 chỉ kiểm tra sự **tồn tại** của client params, không validate **giá trị**:
```typescript
// Hiện tại: chỉ check form.has(p) — không check giá trị hợp lệ
for (const p of Object.keys(subCase.clientParams)) {
  if (form.has(p)) {
    clientParams[p] = form.get(p) as string; // ← Nhận bất kỳ string nào
  }
}
```

Client có thể gửi `output_format=xyz`, `pages=abc`, `max_words=-999` → LLM nhận rác.

### Giải pháp: Zod Schema tự động sinh từ Registry

#### File mới: `lib/endpoints/validation.ts`

```typescript
import { z, ZodSchema } from 'zod';
import type { ParamSchema } from './registry';

/**
 * Sinh Zod schema từ ParamSchema definition trong SERVICE_REGISTRY
 */
function paramToZod(paramDef: ParamSchema): ZodSchema {
  switch (paramDef.type) {
    case 'string':
      let schema = z.string();
      if (paramDef.options?.length) {
        return z.enum(paramDef.options as [string, ...string[]]).optional();
      }
      return schema.optional();

    case 'number':
      return z.coerce.number().positive().optional();

    case 'boolean':
      return z.coerce.boolean().optional();

    case 'array':
      return z.string().optional(); // JSON string array

    default:
      return z.string().optional();
  }
}

/**
 * Tạo Zod validator cho một SubCase
 */
export function buildValidator(
  clientParams: Record<string, ParamSchema>
): ZodSchema {
  const shape: Record<string, ZodSchema> = {};
  for (const [key, def] of Object.entries(clientParams)) {
    shape[key] = paramToZod(def);
  }
  return z.object(shape).passthrough();
}

/**
 * Validate client params, trả về lỗi nếu có
 */
export function validateParams(
  clientParams: Record<string, ParamSchema>,
  values: Record<string, unknown>
): { valid: boolean; errors?: string[] } {
  const schema = buildValidator(clientParams);
  const result = schema.safeParse(values);

  if (result.success) return { valid: true };

  const errors = result.error.issues.map(
    issue => `Param '${issue.path.join('.')}': ${issue.message}`
  );
  return { valid: false, errors };
}
```

#### Tích hợp vào `runner.ts`
```typescript
// Sau bước 4 (Block profileOnlyParams), thêm:

// ── 4.5. Validate client param values ────────────────────────
const validation = validateParams(subCase.clientParams, clientParams);
if (!validation.valid) {
  return apiError(
    422,
    'Validation Error',
    `Invalid parameters: ${validation.errors!.join('; ')}`,
  );
}
```

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 1 ngày (2h code + 3h test + 3h edge cases) |
| **Files ảnh hưởng** | `lib/endpoints/validation.ts` (mới), `runner.ts` (5 dòng thêm) |
| **Dependencies** | Cài thêm `zod` package |
| **Risk** | Thấp — chỉ reject request sai, không ảnh hưởng logic đúng |
| **Chú ý** | Phải đảm bảo default values từ `ParamSchema.default` được inject nếu client không gửi |

---

## 4. Fix Prompt Template Engine (Handlebars)

### Vấn đề
Prompt trong `seed.ts` sử dụng cú pháp Handlebars `{{#if schema}}...{{/if}}`:
```
Extract structured data from the document. Fields to extract: {{fields}}
{{#if schema}}Output schema: {{schema}}{{/if}}
```

Nhưng `external-api.ts` dòng 33-38 chỉ dùng **regex replace đơn giản**:
```typescript
function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }
  return result;
}
```

**Kết quả:** Khi `schema` không được truyền, prompt gửi đi LLM sẽ chứa:
```
{{#if schema}}Output schema: {{schema}}{{/if}}
```
→ LLM nhận raw template syntax, gây nhầm lẫn output.

### Giải pháp

**Phương án A — Lightweight custom parser (Khuyến nghị):**
Hỗ trợ `{{#if var}}` / `{{/if}}` bằng regex xử lý 2 lớp.

**Phương án B — Dùng thư viện Handlebars.js:**
Import `handlebars` package. Mạnh hơn nhưng thêm dependency.

#### Sửa `external-api.ts` — Phương án A

```typescript
function interpolateVariables(
  template: string,
  variables: Record<string, unknown>
): string {
  let result = template;

  // Bước 1: Xử lý {{#if variable}}...{{/if}} blocks
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName, content) => {
      const value = variables[varName];
      // Truthy check: có giá trị và không phải empty string
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return content;
      }
      return ''; // Xóa toàn bộ block
    }
  );

  // Bước 2: Thay thế {{variable}} placeholders
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
      String(value ?? '')
    );
  }

  // Bước 3: Dọn sạch các placeholder còn sót (biến không được truyền)
  result = result.replace(/\{\{[a-zA-Z_]+\}\}/g, '');

  // Bước 4: Xóa dòng trống thừa
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}
```

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 0.5 ngày (2h code + 2h test) |
| **Files ảnh hưởng** | `lib/pipelines/processors/external-api.ts` (thay 1 function) |
| **Risk** | Thấp — giữ nguyên interface, chỉ cải thiện output |
| **Test** | Viết unit test với prompts có/không có `{{#if}}` blocks |

---

## 5. Multi-document Compare (3+ files)

### Vấn đề
- `ext-comparator` prompt chỉ tham chiếu `files[0]` vs `files[1]`
- Mock service hardcode `sourceFile = files[0]`, `targetFile = files[1]`
- Không có cơ chế so sánh N files pairwise hoặc hợp nhất

### Giải pháp: N-way Compare Strategy

Khi nhận 3+ files, hệ thống sẽ:
1. Lấy file đầu tiên làm **baseline** (bản gốc)
2. So sánh tuần tự baseline vs file[1], baseline vs file[2], ...
3. Trả về mảng `comparisons[]` chứa kết quả từng cặp

#### Sửa `registry.ts` — Thêm sub-case `multi`
```typescript
// Thêm vào compare.subCases:
multi: {
  displayName: 'Multi-version Compare',
  description: 'So sánh 1 file gốc (baseline) với nhiều phiên bản sửa đổi. '
    + 'File đầu tiên là bản gốc, các file còn lại lần lượt là v2, v3... '
    + 'Trả về mảng comparisons chứa điểm khác biệt của từng phiên bản.',
  clientParams: { focus: PARAMS.focus, output_format: PARAMS.output_format },
  profileOnlyParams: { business_rules: PARAMS.business_rules },
  connections: ['ext-comparator'],  // Engine sẽ lặp nội bộ
},
```

#### Sửa `engine.ts` — Thêm logic multi-file fan-out
```typescript
// Trước dòng `const result = await runExternalApiProcessor(...)`:

// Phát hiện compare:multi → fan-out
if (
  operation.endpointSlug === 'compare:multi' &&
  ctx.filePaths.length > 2 &&
  i === 0
) {
  // So sánh pairwise: baseline (file[0]) vs từng file khác
  const baseline = ctx.filePaths[0];
  const baselineName = ctx.fileNames[0];
  const comparisons = [];

  for (let f = 1; f < ctx.filePaths.length; f++) {
    const pairCtx = {
      ...ctx,
      filePaths: [baseline, ctx.filePaths[f]],
      fileNames: [baselineName, ctx.fileNames[f]],
    };
    const pairResult = await runExternalApiProcessor(pairCtx, connection, extOverride);
    comparisons.push({
      baseline: baselineName,
      compared_with: ctx.fileNames[f],
      result: JSON.parse(pairResult.content ?? '{}'),
    });
  }

  // Gộp kết quả
  currentText = JSON.stringify({ comparisons, total_versions: ctx.filePaths.length });
  continue; // Skip bước gọi đơn bên dưới
}
```

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 1 ngày |
| **Files ảnh hưởng** | `registry.ts` (thêm sub-case), `engine.ts` (thêm fan-out logic) |
| **Risk** | Trung bình — cần xử lý chi phí (N-1 lần gọi API) |
| **Giới hạn** | Nên cap tối đa 5 files để tránh quá tải |

---

## 6. Cross-language Comparison Workflow

### Vấn đề
Client muốn so sánh bản Tiếng Anh và bản Tiếng Việt của cùng 1 hợp đồng. Hiện phải:
1. Gọi `/transform?action=translate` cho file EN → VN
2. Lấy kết quả lưu local
3. Gọi `/compare?mode=semantic` với 2 file VN

→ 3 bước thủ công, chưa có workflow tự động.

### Giải pháp: Pipeline Chaining tự động

#### Thêm sub-case `cross-lang` trong `compare`
```typescript
// registry.ts → compare.subCases:
'cross-lang': {
  displayName: 'Cross-language Compare',
  description: 'So sánh 2 tài liệu viết bằng 2 ngôn ngữ khác nhau. '
    + 'Hệ thống sẽ tự động dịch cả 2 file về cùng 1 ngôn ngữ đích '
    + '(target_language, mặc định: vi) rồi mới so sánh ngữ nghĩa.',
  clientParams: {
    target_language: PARAMS.target_language,
    focus: PARAMS.focus,
  },
  profileOnlyParams: { business_rules: PARAMS.business_rules },
  connections: ['ext-translator', 'ext-comparator'],
  // Step 1: Dịch cả 2 file sang cùng ngôn ngữ
  // Step 2: So sánh semantic sau khi đã đồng nhất ngôn ngữ
},
```

#### Sửa engine.ts — Xử lý multi-file translation
Trong step đầu tiên (`ext-translator`), cần logic đặc biệt:
- Dịch từng file riêng biệt (fan-out)
- Gom kết quả dịch thành 2 text blocks
- Truyền cả 2 blocks vào step 2 (`ext-comparator`) dưới dạng `input_content`

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 2 ngày (complex fan-out/fan-in logic) |
| **Files ảnh hưởng** | `registry.ts`, `engine.ts`, `ext-comparator.js` mock |
| **Risk** | Cao — cần redesign engine hỗ trợ fan-out/fan-in pattern |
| **Phụ thuộc** | Đề xuất #4 (Fix Handlebars) nên làm trước |

---

## 7. Batch Processing Endpoint

### Vấn đề
Client phải gọi 50 lần API `/extract?type=invoice` cho 50 hóa đơn. Mỗi lần tạo 1 Operation, 1 pipeline, 1 DB record → overhead rất lớn.

### Giải pháp: Endpoint `/api/v1/batch`

#### Luồng xử lý
```
Client POST /batch
  ├── files[]: 50 hóa đơn
  ├── service: "extract"
  ├── discriminator: "type=invoice"
  └── Hệ thống tạo 1 Batch Operation (parent)
       ├── Child Operation #1 (file 1)
       ├── Child Operation #2 (file 2)
       └── ... (xử lý song song, tối đa 5 concurrent)
```

#### Schema DB mới
```prisma
model Operation {
  // ... existing fields
  batchId       String?    // Link to parent batch operation
  batchIndex    Int?       // Thứ tự trong batch (0, 1, 2...)

  @@index([batchId])
}
```

#### File mới: `app/api/v1/batch/route.ts`
```typescript
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll('files[]') as File[];
  const service = form.get('service') as string;
  const discriminator = form.get('discriminator') as string;

  // Tạo parent Batch Operation
  const batchId = crypto.randomUUID();

  // Xử lý song song với concurrency limit
  const CONCURRENCY = 5;
  const results = [];

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.allSettled(
      chunk.map((file, idx) =>
        submitPipelineJob({
          pipeline: [...],
          files: [file],
          endpointSlug: `${service}:${discriminator}`,
          batchId,
          batchIndex: i + idx,
        })
      )
    );
    results.push(...chunkResults);
  }

  return NextResponse.json({
    batch_id: batchId,
    total: files.length,
    submitted: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  }, { status: 202 });
}
```

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 2 ngày |
| **Files ảnh hưởng** | `app/api/v1/batch/route.ts` (mới), `schema.prisma`, `submit.ts` |
| **DB migration** | Có (thêm `batchId`, `batchIndex` vào Operation) |
| **Risk** | Trung bình — cần giới hạn max files per batch (VD: 100) |

---

## 8. Pre-signed Upload (S3/MinIO)

### Vấn đề
File upload hiện đi qua Next.js runtime → buffer toàn bộ vào RAM. Với Vercel limit 4.5MB, các file PDF lớn sẽ fail.

### Giải pháp: 2-step Upload via Object Storage

#### Luồng mới
```
Step 1: Client → GET /api/v1/upload-url
         ← { upload_url: "https://s3.../presigned", file_key: "abc123" }

Step 2: Client → PUT upload_url (file trực tiếp lên S3)
         ← 200 OK

Step 3: Client → POST /api/v1/extract
         ← file_keys=["abc123"] (thay vì multipart upload)
```

#### Triển khai

```typescript
// lib/storage/s3-client.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,       // MinIO local: http://minio:9000
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true, // Cần cho MinIO
});

export async function generateUploadUrl(
  fileKey: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET ?? 'du-uploads',
    Key: fileKey,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn });
}
```

#### Docker Compose — Thêm MinIO
```yaml
# docker-compose.yml
services:
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio-data:/data
```

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 3 ngày (S3 client + API + Docker + runner update) |
| **Files ảnh hưởng** | `lib/storage/` (mới), `app/api/v1/upload-url/`, `runner.ts`, `docker-compose.yml` |
| **Dependencies** | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| **Risk** | Trung bình — cần backward-compatible (vẫn hỗ trợ multipart cũ) |

---

## 9. OpenAPI Schema Auto-generation

### Vấn đề
Swagger/OpenAPI hiện không thể biểu diễn rõ ràng 30 sub-cases vì tất cả đi qua 6 POST endpoints chung. Client SDK không có type-safety.

### Giải pháp: Build-time Script sinh OpenAPI từ Registry

#### File mới: `scripts/generate-openapi.ts`

```typescript
import { SERVICE_REGISTRY, getAllEndpointSlugs } from '../lib/endpoints/registry';

function generateOpenApiSpec() {
  const paths: Record<string, any> = {};

  for (const [svcSlug, service] of Object.entries(SERVICE_REGISTRY)) {
    for (const [caseKey, subCase] of Object.entries(service.subCases)) {
      // Tạo virtual path: /api/v1/extract/invoice
      const virtualPath = `/api/v1/${svcSlug}/${caseKey}`;

      const properties: Record<string, any> = {};

      // Map clientParams → OpenAPI parameters
      for (const [paramName, paramDef] of Object.entries(subCase.clientParams)) {
        properties[paramName] = {
          type: paramDef.type,
          description: paramDef.description,
          enum: paramDef.options,
          default: paramDef.default,
        };
      }

      paths[virtualPath] = {
        post: {
          summary: subCase.displayName,
          description: subCase.description,
          tags: [service.displayName],
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    ...properties,
                  },
                },
              },
            },
          },
          responses: {
            '202': { description: 'Operation accepted' },
            '200': { description: 'Sync result (if ?sync=true)' },
          },
        },
      };
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'DU Gate — Document Understanding API',
      version: '2.0.0',
      description: 'API xử lý, trích xuất, phân tích và so sánh tài liệu.',
    },
    paths,
  };
}
```

Chạy lúc build: `npx ts-node scripts/generate-openapi.ts > public/openapi.json`

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 2 ngày |
| **Risk** | Thấp — chỉ sinh docs, không ảnh hưởng runtime |

---

## 10. Structured Logging & Observability

### Vấn đề
Logger hiện tại (`lib/logger.ts`) đã hỗ trợ JSON mode, nhưng thiếu:
- Request/Response metrics tự động (latency, status code)
- Trace ID propagation chuẩn W3C
- Health check endpoint
- Metrics endpoint (Prometheus format)

### Giải pháp

#### A. Health Check Endpoint
```typescript
// app/api/health/route.ts
export async function GET() {
  const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const status = dbOk ? 200 : 503;

  return NextResponse.json({
    status: dbOk ? 'healthy' : 'degraded',
    checks: {
      database: dbOk ? 'ok' : 'unreachable',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
    version: process.env.APP_VERSION ?? '2.0.0',
  }, { status });
}
```

#### B. Request Metrics Middleware
```typescript
// middleware.ts — thêm tracking
const start = Date.now();
const response = await next();
const latency = Date.now() - start;

response.headers.set('X-Response-Time', `${latency}ms`);
response.headers.set('X-Correlation-Id', correlationId);

logger.info('[HTTP]', {
  method: req.method,
  path: req.nextUrl.pathname,
  status: response.status,
  latencyMs: latency,
});
```

### Effort & Risk

| Hạng mục | Chi tiết |
|----------|----------|
| **Effort** | 1 ngày |
| **Risk** | Thấp |

---

## Tổng Kết Lộ Trình Thực Thi

```
Sprint 1 (Tuần 1) — Critical Fixes
├── #1 Rate Limiting            [1 ngày]
├── #2 Retry + Circuit Breaker  [1.5 ngày]
├── #4 Fix Prompt Template      [0.5 ngày]
└── Buffer test/QA              [1 ngày]

Sprint 2 (Tuần 2) — Quality & DX
├── #3 Zod Validation           [1 ngày]
├── #5 Multi-doc Compare        [1 ngày]
├── #10 Health + Observability  [1 ngày]
└── Buffer test/QA              [2 ngày]

Sprint 3 (Tuần 3-4) — Scale & Features
├── #6 Cross-language Compare   [2 ngày]
├── #7 Batch Processing         [2 ngày]
├── #8 Pre-signed Upload        [3 ngày]
├── #9 OpenAPI Generation       [2 ngày]
└── Buffer test/QA              [1 ngày]
```

**Tổng effort ước tính: ~20 ngày làm việc (4 tuần)**
