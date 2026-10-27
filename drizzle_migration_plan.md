# Kế hoạch Chuyển đổi Prisma → Drizzle ORM

## Tổng quan

Sau khi đọc toàn bộ codebase, tôi xác định được **~25 file có sử dụng Prisma** trực tiếp. Phạm vi chuyển đổi đủ gọn để thực hiện trong 2–3 ngày mà không ảnh hưởng business logic, bởi tất cả Prisma calls đều tập trung ở `lib/` và `app/api/`.

---

## 1. Đánh giá Chi tiết Drizzle ORM

### Lý do phù hợp với stack DuGate

| Vấn đề Prisma | Drizzle giải quyết thế nào |
|---|---|
| **Binary Engine (Rust)** — phải `--external:@prisma/client` khi build Worker bằng `esbuild` | Drizzle thuần TypeScript, bundle Worker không cần config external |
| **`prisma.operation.update` bên trong vòng lặp** trong `engine.ts` | Drizzle cú pháp raw SQL batch rõ ràng hơn |
| **`$queryRaw` với `Prisma.sql`** trong analytics route | Drizzle dùng `sql` tagged template + `db.execute()`, type-safe hơn |
| **Type import `from "@prisma/client"`** rải rác trong code | Drizzle infer types từ Schema TypeScript, không cần import riêng |
| **Error code Prisma `P2002`** — hardcode string bắt unique violation | Drizzle dùng PostgreSQL error code `23505` chuẩn hơn |
| **Cold start và Memory** trong Docker container | Drizzle không có Rust engine process |

### Điểm phức tạp cần xử lý

1. **`prisma.$queryRaw` với `Prisma.sql`** — `analytics/route.ts` có 4 raw SQL queries với `DATE_TRUNC`, cần port sang `sql` tagged template của Drizzle
2. **`increment/decrement`** — Prisma native atomic `{ increment: 1 }` → Drizzle: `` sql`${table.column} + 1` ``
3. **`upsert`** — Prisma `upsert` → Drizzle `insert().onConflictDoUpdate()` (PostgreSQL), tương đương hoàn toàn
4. **Type imports** — `ProfileEndpoint`, `ExternalApiConnection`, `ExternalApiOverride` from `@prisma/client` → từ `@/lib/db/schema`
5. **`auth.ts`** — có Prisma client riêng, không dùng singleton từ `lib/prisma.ts`, cần xử lý riêng

---

## 2. Danh sách File Cần Thay đổi

### Nhóm A — Core Infrastructure (làm trước)

| File | Thay đổi |
|---|---|
| `lib/prisma.ts` | → `lib/db/index.ts` — Drizzle singleton |
| `prisma/schema.prisma` | → `lib/db/schema.ts` — Schema TypeScript |
| `prisma/seed.ts` | Rewrite dùng Drizzle |

### Nhóm B — Auth & Guard

| File | Số lượng queries |
|---|---|
| `lib/auth.ts` | 6 queries (Prisma client riêng, không qua singleton) |
| `lib/auth-guard.ts` | 2 queries |

### Nhóm C — Business Logic (lib/)

| File | Số lượng queries | Ghi chú |
|---|---|---|
| `lib/settings.ts` | 3 | `findUnique`, `findMany`, `upsert` |
| `lib/cleanup.ts` | 4 | `findMany`, 2x `update` (decrement), `deleteMany` |
| `lib/storage/dedup.ts` | 3 | `upsert`, 2x `update` + P2002 error handling |
| `lib/endpoints/profile-resolver.ts` | 2 | `findUnique` + type import |
| `lib/endpoints/runner.ts` | 1 | dynamic import `prisma.apiKey.findUnique` |
| `lib/pipelines/submit.ts` | 6 | P2002 race condition handling |
| `lib/pipelines/engine.ts` | 8+ | **Nhiều nhất** — update trong vòng lặp pipeline |
| `lib/pipelines/processors/prompt-resolver.ts` | 0 | Chỉ type imports |
| `lib/pipelines/workflow-engine.ts` | nhiều | Re-export `prisma` + queries |

### Nhóm D — API Routes (app/api/)

| File | Ghi chú |
|---|---|
| `app/api/internal/analytics/route.ts` | **PHỨC TẠP** — 4 `$queryRaw` với `Prisma.sql` + `DATE_TRUNC` |
| `app/api/internal/apikeys/route.ts` | 5 CRUD queries |
| `app/api/internal/ext-connections/route.ts` | CRUD |
| `app/api/internal/ext-connections/[id]/route.ts` | CRUD |
| `app/api/internal/ext-connections/[id]/test/route.ts` | queries |
| `app/api/internal/ext-overrides/route.ts` | queries |
| `app/api/internal/profile-endpoints/route.ts` | CRUD |
| `app/api/internal/user-profiles/route.ts` | queries |
| `app/api/internal/recover-stalled/route.ts` | queries |
| `app/api/internal/dev-sync-endpoints/route.ts` | queries |
| `app/api/internal/auth-key/route.ts` | queries |
| `app/api/v1/operations/route.ts` | `findMany` |
| `app/api/v1/operations/[id]/route.ts` | `findUnique` |
| `app/api/v1/operations/[id]/cancel/route.ts` | queries |
| `app/api/v1/operations/[id]/resume/route.ts` | queries |
| `app/api/v1/operations/[id]/download/route.ts` | queries |
| `app/api/v1/billing/usage/route.ts` | queries |
| `app/api/v1/billing/balance/route.ts` | queries |
| `app/api/users/route.ts` | User CRUD |
| `app/api/users/[id]/route.ts` | User CRUD |
| `app/api/operations/route.ts` | queries |
| `app/api/operations/[id]/route.ts` | queries |
| `app/api/settings/cache/route.ts` | queries |
| `app/api/chat/route.ts` | queries |

---

## 3. Schema Mapping: Prisma DSL → Drizzle TypeScript

### Package cài đặt

```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit
```

### `lib/db/schema.ts` — Toàn bộ 8 Models

```typescript
import {
  pgTable, text, boolean, integer, doublePrecision, timestamp, index, uniqueIndex
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const operations = pgTable('Operation', {
  id:               text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  apiKeyId:         text('apiKeyId'),
  createdByUserId:  text('createdByUserId'),
  idempotencyKey:   text('idempotencyKey').unique(),
  done:             boolean('done').default(false).notNull(),
  state:            text('state').default('RUNNING').notNull(),
  progressPercent:  integer('progressPercent').default(0).notNull(),
  progressMessage:  text('progressMessage'),
  endpointSlug:     text('endpointSlug'),
  pipelineJson:     text('pipelineJson').notNull(),
  currentStep:      integer('currentStep').default(0).notNull(),
  failedAtStep:     integer('failedAtStep'),
  filesJson:        text('filesJson'),
  outputFormat:     text('outputFormat').default('json').notNull(),
  outputContent:    text('outputContent'),
  outputFilePath:   text('outputFilePath'),
  extractedData:    text('extractedData'),
  stepsResultJson:  text('stepsResultJson'),
  totalInputTokens:  integer('totalInputTokens').default(0).notNull(),
  totalOutputTokens: integer('totalOutputTokens').default(0).notNull(),
  pagesProcessed:   integer('pagesProcessed').default(0).notNull(),
  modelUsed:        text('modelUsed'),
  totalCostUsd:     doublePrecision('totalCostUsd').default(0.0).notNull(),
  usageBreakdown:   text('usageBreakdown'),
  webhookUrl:       text('webhookUrl'),
  webhookSentAt:    timestamp('webhookSentAt'),
  errorCode:        text('errorCode'),
  errorMessage:     text('errorMessage'),
  filesDeleted:     boolean('filesDeleted').default(false).notNull(),
  createdAt:        timestamp('createdAt').default(sql`now()`).notNull(),
  updatedAt:        timestamp('updatedAt').notNull().$onUpdate(() => new Date()),
  deletedAt:        timestamp('deletedAt'),
}, (t) => [
  index('operation_state_idx').on(t.state),
  index('operation_apiKeyId_createdAt_idx').on(t.apiKeyId, t.createdAt),
  index('operation_createdAt_idx').on(t.createdAt),
  index('operation_endpointSlug_idx').on(t.endpointSlug),
]);

export const apiKeys = pgTable('ApiKey', {
  id:            text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:          text('name').notNull(),
  keyHash:       text('keyHash').unique().notNull(),
  prefix:        text('prefix').notNull(),
  role:          text('role').default('STANDARD').notNull(),
  note:          text('note'),
  spendingLimit: doublePrecision('spendingLimit').default(0.0).notNull(),
  totalUsed:     doublePrecision('totalUsed').default(0.0).notNull(),
  status:        text('status').default('active').notNull(),
  createdAt:     timestamp('createdAt').default(sql`now()`).notNull(),
  updatedAt:     timestamp('updatedAt').notNull().$onUpdate(() => new Date()),
}, (t) => [index('apikey_status_idx').on(t.status)]);

export const externalApiConnections = pgTable('ExternalApiConnection', {
  id:                    text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:                  text('name').notNull(),
  slug:                  text('slug').unique().notNull(),
  description:           text('description'),
  endpointUrl:           text('endpointUrl').notNull(),
  httpMethod:            text('httpMethod').default('POST').notNull(),
  authType:              text('authType').default('API_KEY_HEADER').notNull(),
  authKeyHeader:         text('authKeyHeader').default('x-api-key').notNull(),
  authSecret:            text('authSecret').notNull(),
  promptFieldName:       text('promptFieldName').default('query').notNull(),
  fileFieldName:         text('fileFieldName').default('files').notNull(),
  fileUrlFieldName:      text('fileUrlFieldName'),
  defaultPrompt:         text('defaultPrompt').notNull(),
  staticFormFields:      text('staticFormFields'),
  extraHeaders:          text('extraHeaders'),
  responseContentPath:   text('responseContentPath').default('content'),
  sessionIdResponsePath: text('sessionIdResponsePath'),
  sessionIdFieldName:    text('sessionIdFieldName'),
  timeoutSec:            integer('timeoutSec').default(60).notNull(),
  state:                 text('state').default('ENABLED').notNull(),
  createdAt:             timestamp('createdAt').default(sql`now()`).notNull(),
  updatedAt:             timestamp('updatedAt').notNull().$onUpdate(() => new Date()),
}, (t) => [
  index('ext_conn_slug_idx').on(t.slug),
  index('ext_conn_state_idx').on(t.state),
]);

export const externalApiOverrides = pgTable('ExternalApiOverride', {
  id:             text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  connectionId:   text('connectionId').notNull(),
  apiKeyId:       text('apiKeyId').notNull(),
  endpointSlug:   text('endpointSlug').notNull(),
  stepId:         text('stepId').default('_default').notNull(),
  promptOverride: text('promptOverride'),
  createdAt:      timestamp('createdAt').default(sql`now()`).notNull(),
  updatedAt:      timestamp('updatedAt').notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('ext_override_unique_idx').on(t.connectionId, t.apiKeyId, t.endpointSlug, t.stepId),
  index('ext_override_apiKeyId_idx').on(t.apiKeyId),
  index('ext_override_connectionId_idx').on(t.connectionId),
  index('ext_override_endpointSlug_idx').on(t.endpointSlug),
]);

export const profileEndpoints = pgTable('ProfileEndpoint', {
  id:                    text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  apiKeyId:              text('apiKeyId').notNull(),
  endpointSlug:          text('endpointSlug').notNull(),
  enabled:               boolean('enabled').default(true).notNull(),
  parameters:            text('parameters'),
  connectionsOverride:   text('connectionsOverride'),
  jobPriority:           text('jobPriority').default('MEDIUM').notNull(),
  fileUrlAuthConfig:     text('fileUrlAuthConfig'),
  allowedFileExtensions: text('allowedFileExtensions'),
  createdAt:             timestamp('createdAt').default(sql`now()`).notNull(),
  updatedAt:             timestamp('updatedAt').notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('profile_endpoint_unique_idx').on(t.apiKeyId, t.endpointSlug),
  index('profile_endpoint_apiKeyId_idx').on(t.apiKeyId),
]);

export const appSettings = pgTable('AppSetting', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  key:       text('key').unique().notNull(),
  value:     text('value').notNull(),
  updatedAt: timestamp('updatedAt').notNull().$onUpdate(() => new Date()),
});

export const fileCaches = pgTable('FileCache', {
  id:             text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  md5Hash:        text('md5Hash').unique().notNull(),
  s3Key:          text('s3Key').notNull(),
  fileName:       text('fileName').notNull(),
  mimeType:       text('mimeType').notNull(),
  size:           integer('size').notNull(),
  refCount:       integer('refCount').default(1).notNull(),
  createdAt:      timestamp('createdAt').default(sql`now()`).notNull(),
  lastAccessedAt: timestamp('lastAccessedAt').default(sql`now()`).notNull(),
}, (t) => [
  index('file_cache_refCount_idx').on(t.refCount),
  index('file_cache_lastAccessedAt_idx').on(t.lastAccessedAt),
]);

export const users = pgTable('User', {
  id:          text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  username:    text('username').unique().notNull(),
  password:    text('password').default('').notNull(),
  role:        text('role').default('USER').notNull(),
  provider:    text('provider'),
  providerSub: text('providerSub').unique(),
  email:       text('email'),
  displayName: text('displayName'),
  createdAt:   timestamp('createdAt').default(sql`now()`).notNull(),
  updatedAt:   timestamp('updatedAt').notNull().$onUpdate(() => new Date()),
});

export const userProfileAssignments = pgTable('UserProfileAssignment', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:    text('userId').notNull(),
  apiKeyId:  text('apiKeyId').notNull(),
  createdAt: timestamp('createdAt').default(sql`now()`).notNull(),
}, (t) => [
  uniqueIndex('user_profile_assignment_unique_idx').on(t.userId, t.apiKeyId),
  index('user_profile_assignment_userId_idx').on(t.userId),
  index('user_profile_assignment_apiKeyId_idx').on(t.apiKeyId),
]);

// ─── Type Exports — thay thế import từ @prisma/client ─────────────────────────
export type Operation = typeof operations.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ExternalApiConnection = typeof externalApiConnections.$inferSelect;
export type ExternalApiOverride = typeof externalApiOverrides.$inferSelect;
export type ProfileEndpoint = typeof profileEndpoints.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type FileCache = typeof fileCaches.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserProfileAssignment = typeof userProfileAssignments.$inferSelect;
```

### `lib/db/index.ts` — Drizzle Singleton (thay thế lib/prisma.ts)

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { db: ReturnType<typeof drizzle> | undefined };

function createDb() {
  const queryClient = postgres(process.env.DATABASE_URL!, {
    max: process.env.NODE_ENV === 'production' ? 10 : 3,
  });
  return drizzle(queryClient, {
    schema,
    logger: process.env.NODE_ENV === 'development',
  });
}

export const db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== 'production') globalForDb.db = db;

export * from './schema';
```

### `drizzle.config.ts` — Migration Config

```typescript
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

---

## 4. Pattern Chuyển đổi Quan trọng

### Pattern 1: findUnique → select + eq + limit(1)

```typescript
// Prisma
const key = await prisma.apiKey.findUnique({ where: { keyHash } });

// Drizzle — trả về array, dùng destructuring
import { eq } from 'drizzle-orm';
const [key] = await db.select().from(apiKeys)
  .where(eq(apiKeys.keyHash, keyHash)).limit(1);
// key có thể undefined nếu không tìm thấy
```

### Pattern 2: Composite unique key lookup

```typescript
// Prisma
const profile = await prisma.profileEndpoint.findUnique({
  where: { apiKeyId_endpointSlug: { apiKeyId, endpointSlug } },
});

// Drizzle
import { and, eq } from 'drizzle-orm';
const [profile] = await db.select().from(profileEndpoints)
  .where(and(
    eq(profileEndpoints.apiKeyId, apiKeyId),
    eq(profileEndpoints.endpointSlug, endpointSlug),
  )).limit(1);
```

### Pattern 3: upsert → insert().onConflictDoUpdate()

```typescript
// Prisma
await prisma.appSetting.upsert({
  where: { key },
  update: { value: stored },
  create: { key, value: stored },
});

// Drizzle (PostgreSQL ON CONFLICT DO UPDATE)
await db.insert(appSettings)
  .values({ key, value: stored })
  .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } });
```

### Pattern 4: Atomic increment/decrement

```typescript
// Prisma
await prisma.apiKey.update({
  where: { id },
  data: { totalUsed: { increment: totalCost } },
});

// Drizzle — atomic SQL expression
import { sql } from 'drizzle-orm';
await db.update(apiKeys)
  .set({ totalUsed: sql`${apiKeys.totalUsed} + ${totalCost}` })
  .where(eq(apiKeys.id, id));
```

### Pattern 5: $queryRaw → db.execute() với sql tag

```typescript
// Prisma
import { Prisma } from '@prisma/client';
const result = await prisma.$queryRaw<Array<{ time_bucket: Date; count: bigint }>>(
  Prisma.sql`SELECT DATE_TRUNC('hour', "createdAt") as time_bucket, COUNT(id) as count
             FROM "Operation" WHERE "createdAt" >= ${startDate}`
);

// Drizzle
import { sql } from 'drizzle-orm';
const result = await db.execute<{ time_bucket: Date; count: bigint }>(
  sql`SELECT DATE_TRUNC('hour', "createdAt") as time_bucket, COUNT(id) as count
      FROM "Operation" WHERE "createdAt" >= ${startDate}`
);
// Lưu ý: postgres.js trả về bigint cho COUNT → vẫn cần Number() cast như cũ
```

### Pattern 6: Unique Constraint Error (P2002 → 23505)

```typescript
// Prisma: bắt P2002
const isUniqueViolation = err instanceof Error
  && 'code' in err && (err as any).code === 'P2002';

// Drizzle với postgres.js driver
import type { PostgresError } from 'postgres';
const isUniqueViolation = (err as PostgresError)?.code === '23505';
// Hoặc đơn giản hơn:
const isUniqueViolation = err instanceof Error
  && err.message.includes('unique constraint');
```

### Pattern 7: Type import thay thế

```typescript
// Cũ — Prisma
import type { ProfileEndpoint, ExternalApiConnection } from '@prisma/client';

// Mới — Drizzle inferred types
import type { ProfileEndpoint, ExternalApiConnection } from '@/lib/db/schema';
```

### Pattern 8: findMany với where phức tạp

```typescript
// Prisma
const expired = await prisma.operation.findMany({
  where: {
    createdAt: { lt: cutoff },
    filesDeleted: false,
    deletedAt: null,
  },
  select: { id: true, filesJson: true, outputFilePath: true },
});

// Drizzle
import { lt, eq, isNull, and } from 'drizzle-orm';
const expired = await db.select({
  id: operations.id,
  filesJson: operations.filesJson,
  outputFilePath: operations.outputFilePath,
}).from(operations)
  .where(and(
    lt(operations.createdAt, cutoff),
    eq(operations.filesDeleted, false),
    isNull(operations.deletedAt),
  ));
```

---

## 5. Lộ trình Thực hiện (4 Giai đoạn)

> [!IMPORTANT]
> **Chiến lược an toàn**: Database KHÔNG thay đổi gì cả — chỉ thay ORM layer. Có thể rollback bất cứ lúc nào trong quá trình.

### Giai đoạn 1: Setup & Schema (nửa ngày)

- [ ] Cài packages: `npm install drizzle-orm postgres && npm install -D drizzle-kit`
- [ ] Tạo `lib/db/schema.ts` (copy từ kế hoạch trên)
- [ ] Tạo `lib/db/index.ts` (Drizzle singleton)
- [ ] Tạo `drizzle.config.ts`
- [ ] Chạy `npx drizzle-kit introspect` để verify schema match DB hiện tại
- [ ] Snapshot migration: `npx drizzle-kit generate` (không chạy migrate — DB đã có)

### Giai đoạn 2: Worker & Core Engine (1 ngày — ưu tiên cao nhất)

Worker được hưởng lợi nhiều nhất từ việc loại bỏ Prisma binary.

- [ ] `lib/pipelines/engine.ts` (8+ queries — nhiều nhất)
- [ ] `lib/pipelines/submit.ts` (6 queries + P2002 race condition)
- [ ] `lib/pipelines/workflow-engine.ts` (re-export prisma + queries)
- [ ] `lib/storage/dedup.ts` (upsert + P2002)
- [ ] `lib/cleanup.ts` (4 queries với decrement)
- [ ] `lib/settings.ts` (3 queries với upsert)
- [ ] `lib/endpoints/runner.ts` (dynamic import prisma)
- [ ] `lib/endpoints/profile-resolver.ts` (2 queries + type import)
- [ ] `lib/pipelines/processors/prompt-resolver.ts` (type imports only)

### Giai đoạn 3: Auth & API Routes (1–2 ngày)

- [ ] `lib/auth.ts` (6 queries, Prisma client riêng)
- [ ] `lib/auth-guard.ts` (2 queries)
- [ ] `app/api/internal/analytics/route.ts` (**phức tạp nhất** — 4 raw SQL)
- [ ] Toàn bộ `app/api/internal/**` (9 routes)
- [ ] Toàn bộ `app/api/v1/**` (6 routes)
- [ ] `app/api/users/**`, `app/api/operations/**`, `app/api/chat/**`

### Giai đoạn 4: Cleanup & Verification (nửa ngày)

- [ ] Xóa `lib/prisma.ts`
- [ ] Xóa `prisma/schema.prisma`
- [ ] Cập nhật `worker:build` trong `package.json` (bỏ `--external:@prisma/client --external:prisma`)
- [ ] Uninstall: `npm uninstall prisma @prisma/client`
- [ ] Cập nhật `Dockerfile` (bỏ `prisma generate`, đổi `prisma migrate deploy` → `drizzle-kit migrate`)
- [ ] Test smoke toàn diện: login, tạo operation, upload file, analytics

---

## 6. Cập nhật `worker:build` Script

```diff
- "worker:build": "npx esbuild worker.ts --bundle --platform=node --target=node20 --outfile=worker.js --external:@prisma/client --external:prisma --external:bcryptjs ...",
+ "worker:build": "npx esbuild worker.ts --bundle --platform=node --target=node20 --outfile=worker.js --external:bcryptjs --external:ioredis --external:bullmq --external:mammoth --external:sharp --external:openai --alias:@=.",
```

> [!TIP]
> Drizzle ORM (`drizzle-orm`) và driver `postgres` đều là pure TypeScript, bundle vào Worker hoàn toàn không cần `--external`. Đây là điểm cải thiện lớn nhất về Developer Experience.

---

## 7. Cập nhật Dockerfile

```dockerfile
# Xóa:
RUN npx prisma generate

# Thay migration command:
# Cũ:
RUN npx prisma migrate deploy
# Mới:
RUN npx drizzle-kit migrate
```

---

## 8. Rủi ro & Biện pháp

| Rủi ro | Mức độ | Biện pháp |
|---|---|---|
| Schema mismatch (tên bảng, cột) | Trung bình | `drizzle-kit introspect` verify trước khi code |
| P2002 → 23505 error handling sai | Trung bình | Test riêng `dedup.ts` + `submit.ts` |
| `$updatedAt` không tự động cập nhật | Thấp | Dùng `.$onUpdate(() => new Date())` trong schema |
| Analytics: `bigint` type từ postgres.js | Thấp | Đã xử lý `Number()` cast từ trước — giữ nguyên |
| NextAuth session bị ảnh hưởng | Rất thấp | Dùng JWT strategy, không có DB-backed session |

---

## Câu hỏi cần xác nhận

> [!IMPORTANT]
> **Q1 — Chiến lược**: Thực hiện từng giai đoạn (an toàn) hay Big Bang toàn bộ trong 1 lần (nhanh hơn)?

> [!IMPORTANT]
> **Q2 — Dockerfile**: File `docker-entrypoint.sh` hiện đang chạy `prisma migrate deploy`. Có muốn tôi cập nhật cả entrypoint script sang Drizzle không?

> [!IMPORTANT]
> **Q3 — Seed data**: Có muốn migrate cả `prisma/seed.ts` sang Drizzle trong cùng lần này không?
