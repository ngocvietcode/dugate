# dugate Apps — Workflow-as-a-Service

Tầng Apps bên trên dugate Core ([ADR-0002](../docs/adr/0002-core-apps-layering.md)). Mỗi App là một workflow nghiệp vụ
đóng gói thành service theo Workflow Service Contract; hệ thống ngân hàng (LOS…) gọi App, App gọi Core qua API công khai.
Luật cho agent: [CLAUDE.md](CLAUDE.md).

| App | Trạng thái | Spec |
|---|---|---|
| `credit-appraisal-assist` — hỗ trợ thẩm định vay hộ kinh doanh có TSBĐ (lõi LAC) | v0.1.0, chạy E2E trên hạ tầng giả lập | [specs/002](../specs/002-credit-appraisal-assist/spec.md) |

## Thành phần chạy

| Tiến trình | Lệnh | Ghi chú |
|---|---|---|
| API `/apps/v1/*` | `npm run server` | Hono, cổng `PORT` (mặc định 2030) |
| Worker TypeScript | `npm run worker` | task queue `dugate-apps`: workflow + activity Core/projection/webhook |
| Worker LAC Python | `cd credit-kit/lac && python -m lac.worker` | task queue `credit-lac-py`: activity `lacBuild` |
| Temporal | `docker compose --profile apps up -d temporal` | dev server + UI `:8233`; production: cluster self-host (D1) |
| PostgreSQL | DB của Apps (schema `apps`) | `npm run db:migrate` |

### Biến môi trường

| Biến | Dùng ở | Ý nghĩa |
|---|---|---|
| `APPS_DATABASE_URL` | server, worker | PostgreSQL cho schema `apps` |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` | cả ba | mặc định `localhost:7233`, `apps-dev` |
| `APPS_PAYLOAD_KEYS`, `APPS_PAYLOAD_KEY_ID` | cả ba | khoá AES-256 mã hoá payload Temporal (`id:base64`, nhiều khoá để xoay vòng) — lấy từ Vault/KMS |
| `APPS_CALLERS` | server | JSON `[{"id":"LOS","keySha256":"…","trustedUserHeaders":true}]` |
| `APPS_CALLBACK_ALLOWED_HOSTS` | server, worker | host được nhận webhook |
| `APPS_WEBHOOK_SECRET` | worker | khoá ký HMAC webhook |
| `CORE_BASE_URL`, `CORE_API_KEY` | worker | Core và API key role APP của App |
| `APPS_SOURCE_ALLOWED_HOSTS` | worker | host được tải đầu ra DU v5 qua URL |
| `APPS_REVIEW_TIMEOUT` | server | thời hạn chờ soát (mặc định `10 days`) |

## Kiểm tra

```bash
npm ci
npm run typecheck && npm run lint && npm run check:lac-zod
TEMPORAL_CLI=/path/to/temporal LAC_PYTHON=/path/to/venv/bin/python npm test
cd credit-kit/lac && pip install -e '.[draw,dev,worker]' && pytest
```

- `TEMPORAL_CLI`: binary `temporal` có sẵn. Không đặt thì SDK tự tải dev server (cần mạng tới temporal.download).
- `LAC_PYTHON`: python có package `lac[worker]`; thiếu thì test E2E bị bỏ qua.
- Ghi lại history cho replay test sau khi đổi workflow có chủ đích: `RECORD_HISTORIES=1 … npx vitest run test/e2e`.

## Giới hạn hiện tại (v0.1.0)
- Nguồn dữ liệu hồ sơ: đầu ra DU v5 theo `coreOperationId` hoặc URL (LAC-3 chưa chốt); chưa có đường "tài liệu → Core trích xuất".
- Nhánh 2 gửi prompt qua tham số `questions` của Core `generate:qa` tới khi Core có prompt template (C2); connector AIHub cần C7–C9.
- Danh tính người dùng chỉ nhận qua header từ hệ thống gọi được đánh dấu tin cậy; chưa có OIDC trực tiếp.
- Chưa có màn hình soát (B6): chờ Q1 (LOS có deep-link không) và Core trả trang/bbox (C6), đọc lại vùng ảnh (C12).
- Chưa có Dockerfile/Helm cho Apps (Phase 4).
