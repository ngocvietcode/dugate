# DUGATE — Hướng dẫn Cấu hình Production Deployment

## Tổng quan kiến trúc Deploy

```
┌─────────────────────────────────────────────────────┐
│  Reverse Proxy (Nginx / Traefik / ALB)              │
│  https://du.aws.rpa.vpbank.dev → host:3013          │
└───────────────────────┬─────────────────────────────┘
                        │
    ┌───────────────────┼──────────────────────────┐
    │  docker-net       │                          │
    │                   ▼                          │
    │  ┌──────────────────────┐                    │
    │  │  skillhub-app        │ port 2023 internal │
    │  │  (Next.js server)    │                    │
    │  └──────────┬───────────┘                    │
    │             │                                │
    │  ┌──────────▼───────────┐  ┌──────────────┐ │
    │  │  Redis (queue/cache) │  │  Worker      │ │
    │  │  port 6379 internal  │  │  (BullMQ)    │ │
    │  └──────────────────────┘  └──────────────┘ │
    │                                              │
    │  PostgreSQL (external hoặc internal)         │
    └──────────────────────────────────────────────┘
```

---

## 1. Cấu hình Port

### Trong Dockerfile (cố định)
```dockerfile
EXPOSE 2023
ENV PORT=2023
ENV HOSTNAME="0.0.0.0"
```

### Trong docker-compose.run.yml (thay đổi được)
```yaml
ports:
  - "${HOST_PORT:-3013}:2023"
```

**Cách đổi port production:**
- Sửa mapping bên trái dấu `:` trong `docker-compose.run.yml`
- Ví dụ muốn expose port `8080`: đổi thành `"8080:2023"`
- Port bên phải (`2023`) KHÔNG đổi — đó là port container internal

---

## 2. Tất cả Environment Variables có thể cấu hình

### 2.1 — App Server (skillhub-app)

| Variable | Default | Mô tả | Khi nào cần đổi |
|----------|---------|--------|------------------|
| `DATABASE_URL` | — (bắt buộc) | PostgreSQL connection string | Luôn cấu hình cho production DB |
| `NEXTAUTH_SECRET` | — (bắt buộc) | Secret mã hóa session (hex 32 bytes) | Mỗi environment khác nhau |
| `NEXTAUTH_URL` | `http://localhost:2023` | Full URL app (cho callback) | Set = domain production |
| `INTERNAL_API_URL` | — | URL nội bộ cho server-to-server call | Set = domain production |
| `ENCRYPTION_KEY` | — (bắt buộc) | AES key mã hóa API key (đúng 32 ký tự) | Mỗi environment khác nhau |
| `REDIS_URL` | `redis://redis:6379` | Redis connection | Đổi nếu Redis external/cluster |
| `PORT` | `2023` | Port Next.js lắng nghe | Thường KHÔNG đổi |
| `UPLOAD_DIR` | `/app/uploads` | Thư mục upload | Đổi nếu mount NFS/EFS |
| `OUTPUT_DIR` | `/app/outputs` | Thư mục output | Đổi nếu mount NFS/EFS |
| `MIGRATION` | `true` | Chạy DB migration khi start | Set `false` sau deploy lần đầu |
| `SEED` | `true` | Chạy seed data khi start | Set `false` sau deploy lần đầu |
| `DB_PUSH` | `false` | Force push schema (dev only) | Luôn `false` trên production |
| `SEED_ADMIN_KEY` | — | API key admin máy-máy cho `/api/v1` (không liên quan SSO) | Đổi thành secret mạnh. Seed dừng nếu thiếu |
| `SEED_ADMIN_EMAILS` | — | Email công ty của ADMIN khởi tạo, phân tách bằng dấu phẩy. Chỉ cần khi seed **DB trắng** | Username lấy phần trước `@`, phải trùng tên trên IDP. Môi trường đã có dữ liệu để trống — seed chỉ cảnh báo |
| `DISABLE_HISTORY` | `false` | Tắt lưu history | Tùy nhu cầu |
| `SYNC_TIMEOUT_MS` | `30000` (code) / `300000` (prod compose) | Timeout cho sync operations (ms) | Tăng nếu pipeline xử lý lâu |
| `ALLOWED_PRIVATE_HOSTS` | — | Whitelist IP/host nội bộ được gọi | Cấu hình theo mạng nội bộ |

### 2.2 — OIDC / SSO (BẮT BUỘC)

Hệ thống **chỉ** đăng nhập bằng SSO — không còn login username/password. Thiếu bất
kỳ biến nào dưới đây thì **không ai đăng nhập được**: trang `/login` hiện thông báo
lỗi cấu hình và `/api/auth/*` trả `503` kèm tên biến còn thiếu trong log.

**Không có biến bật/tắt.** Ba biến dưới đây có đủ giá trị là SSO hoạt động. Biến
`OIDC_ENABLED` cũ đã bị bỏ khỏi code — môi trường nào còn truyền nó thì vô hại,
ứng dụng bỏ qua.

| Variable | Default | Mô tả |
|----------|---------|--------|
| `OIDC_ISSUER` | — | URL issuer của Identity Provider (**chỉ URL gốc** — code tự ghép `/.well-known/openid-configuration`) |
| `OIDC_CLIENT_ID` | — | Client ID đăng ký với IDP |
| `OIDC_CLIENT_SECRET` | — | Client Secret |

Đăng ký `<NEXTAUTH_URL>/api/auth/callback/oidc` làm redirect URI với IDP.
`NEXTAUTH_URL` phải là domain thật — NextAuth giới hạn `callbackUrl` theo giá trị này.

Cấp quyền là **pre-provisioning**, không có JIT: identity nào chưa được ADMIN tạo
trước tại `/settings/users` thì bị từ chối đăng nhập (`/login?error=AccessDenied`).
Username trong DUGate phải trùng tên đăng nhập trên IDP.

### 2.3 — Worker (Background Job Processing)

| Variable | Default | Mô tả | Gợi ý Production |
|----------|---------|--------|-------------------|
| `WORKER_CONCURRENCY` | `5` | Số pipeline job chạy đồng thời | 5–15 tùy CPU/RAM |
| `SUBSTEP_WORKER_CONCURRENCY` | `WORKER_CONCURRENCY × 2` | Số sub-step job đồng thời | 5–20, set thấp nếu RAM hạn chế |
| `WORKFLOW_CONCURRENCY` | `WORKER_CONCURRENCY × 2` | Số job workflow (cha) đồng thời trên queue `workflow` / `workflow.<group>`. Job cha phần lớn chỉ chờ sub-step nên đặt cao hơn `WORKER_CONCURRENCY` được; trần thật là bộ nhớ (worker tự dừng ở `WORKER_MEMORY_THRESHOLD`) | 10–20; đo heap trên hồ sơ lớn trước khi tăng |
| `MAX_QUEUE_DEPTH` | `500` | Số job tối đa trong queue trước khi reject | Tăng nếu burst traffic lớn |
| `WORKER_MEMORY_THRESHOLD` | `0.90` | % heap để pause worker (0.0–1.0) | 0.85–0.95 |
| `REDIS_URL` | `redis://redis:6379` | Redis cho BullMQ | Cùng Redis với app |
| `SYNC_TIMEOUT_MS` | `30000` | Timeout từng step | 60000–300000 cho production |

### 2.4 — Rate Limiting

| Variable | Default | Mô tả | Gợi ý Production |
|----------|---------|--------|-------------------|
| `RATE_LIMIT_API_KEY` | `100` | Max requests/phút per API key | 50–500 tùy use case |
| `RATE_LIMIT_IP` | `30` | Max requests/phút per IP (unauthenticated) | 10–60 |

### 2.5 — Build (docker-compose.build.yml)

| Variable | Default | Mô tả |
|----------|---------|--------|
| `IMAGE_NAME` | `dugate` | Tên Docker image |
| `IMAGE_TAG` | `latest` | Tag version (nên dùng semver) |
| `DOCKERHUB_PROXY_REGISTRY` | `dockerhub-proxy.aws.platform.vpbank.dev` | Docker registry proxy |
| `NPM_PROXY_REGISTRY` | `https://registry.aws.platform.vpbank.dev/...` | NPM registry proxy |
| `NODE_IMAGE` | `library/node:20-slim` | Base Node image |

---

## 3. Cách điều chỉnh Worker cho Production

### Kịch bản 1: Máy chủ mạnh (8+ CPU, 16GB+ RAM)
```env
WORKER_CONCURRENCY=15
SUBSTEP_WORKER_CONCURRENCY=20
MAX_QUEUE_DEPTH=1000
WORKER_MEMORY_THRESHOLD=0.90
SYNC_TIMEOUT_MS=300000
```

### Kịch bản 2: Máy chủ vừa (4 CPU, 8GB RAM) — **Khuyến nghị**
```env
WORKER_CONCURRENCY=5
SUBSTEP_WORKER_CONCURRENCY=10
MAX_QUEUE_DEPTH=500
WORKER_MEMORY_THRESHOLD=0.85
SYNC_TIMEOUT_MS=300000
```

### Kịch bản 3: Máy chủ yếu (2 CPU, 4GB RAM)
```env
WORKER_CONCURRENCY=3
SUBSTEP_WORKER_CONCURRENCY=5
MAX_QUEUE_DEPTH=200
WORKER_MEMORY_THRESHOLD=0.80
SYNC_TIMEOUT_MS=120000
```

### Scale ngang (nhiều worker container)
Có thể chạy nhiều container `worker` trỏ chung Redis:
```yaml
worker-1:
  image: dugate:0.0.6
  command: ["node", "worker.js"]
  environment:
    WORKER_CONCURRENCY: 5
    SUBSTEP_WORKER_CONCURRENCY: 5
    REDIS_URL: redis://redis:6379

worker-2:
  image: dugate:0.0.6
  command: ["node", "worker.js"]
  environment:
    WORKER_CONCURRENCY: 5
    SUBSTEP_WORKER_CONCURRENCY: 5
    REDIS_URL: redis://redis:6379
```
→ Tổng throughput: 10 pipeline + 10 sub-step = 20 job đồng thời.

---

## 4. Cách điều chỉnh Rate Limit cho Production

### Cho hệ thống tích hợp (API-to-API, internal)
```env
RATE_LIMIT_API_KEY=500    # Cho phép 500 req/phút per key
RATE_LIMIT_IP=100         # IP-based higher vì internal network
```

### Cho public-facing
```env
RATE_LIMIT_API_KEY=60     # Thấp hơn để bảo vệ
RATE_LIMIT_IP=20
```

---

## 5. File Upload & Body Size

| Cấu hình | Giá trị | Nơi set |
|-----------|---------|---------|
| Next.js Server Actions body limit | 300MB | `next.config.mjs` (build-time) |
| Application file size check | 100MB | `lib/config.ts` → `MAX_FILE_SIZE_BYTES` |
| Reverse proxy (Nginx) | Cần set `client_max_body_size` | Nginx config |

---

## 6. Ví dụ Production .env đầy đủ

```env
# ─── Database ──────────────────────────────────────────
DATABASE_URL=postgresql://dugate:${DB_PASSWORD}@db-host:5432/dugate

# ─── Auth ──────────────────────────────────────────────
NEXTAUTH_SECRET=a1b2c3d4e5f6...hex32bytes
NEXTAUTH_URL=https://du.aws.rpa.vpbank.dev
ENCRYPTION_KEY=exactly-32-characters-string!!

# ─── OIDC (bắt buộc — không có cờ bật/tắt) ─────────────
OIDC_ISSUER=https://portal.aws.rpa.vpbank.dev/proxy-service/identity/application/o/skillhub
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret

# ─── Redis ─────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ─── Worker ────────────────────────────────────────────
WORKER_CONCURRENCY=5
SUBSTEP_WORKER_CONCURRENCY=5
MAX_QUEUE_DEPTH=500
WORKER_MEMORY_THRESHOLD=0.90
SYNC_TIMEOUT_MS=300000

# ─── Rate Limiting ────────────────────────────────────
RATE_LIMIT_API_KEY=100
RATE_LIMIT_IP=30

# ─── Startup ──────────────────────────────────────────
MIGRATION=false
SEED=false
DB_PUSH=false
SEED_ADMIN_KEY=your-admin-api-key
# Chỉ cần khi seed DB trắng; môi trường đã có dữ liệu để trống
SEED_ADMIN_EMAILS=first.admin@vpbank.com.vn

# ─── Paths ─────────────────────────────────────────────
UPLOAD_DIR=/app/uploads
OUTPUT_DIR=/app/outputs
ALLOWED_PRIVATE_HOSTS=10.0.0.0/8,172.16.0.0/12

# ─── Build ─────────────────────────────────────────────
IMAGE_TAG=0.0.6
```

---

## 7. Thông tin cho hệ thống tích hợp (Integration Spec)

```yaml
Service: DUGATE
Base URL: https://du.aws.rpa.vpbank.dev
Port (external): 3013 (hoặc tùy reverse proxy)
Port (container): 2023

Authentication:
  - Method: API Key (header: x-api-key)
  - Alternative: OIDC Bearer Token

Rate Limits:
  - Per API Key: 100 requests/minute (configurable)
  - Per IP: 30 requests/minute (configurable)
  - Response 429 kèm header Retry-After

Concurrency:
  - HTTP requests: Unlimited (Node.js event loop, giới hạn bởi hardware)
  - Background jobs: 5 pipeline + 5 sub-steps = 10 concurrent (configurable)
  - Max queue depth: 500 jobs pending

Timeouts:
  - Sync API: 300 seconds (SYNC_TIMEOUT_MS)
  - Stalled job detection: 30 seconds

Upload:
  - Max file size: 100MB (application check)
  - Body limit: 300MB (Next.js server actions)

Reliability:
  - Job retry: 3 attempts
  - Auto-pause on memory pressure (>90% heap)
  - Graceful shutdown on SIGTERM
```
