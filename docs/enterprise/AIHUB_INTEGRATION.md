# Tích hợp VPBank AIHub

| Mục | Giá trị |
|---|---|
| Trạng thái | DRAFT — chờ đặc tả API AIHub (§6) |
| Quyết định | [ADR-0003: Mọi lời gọi LLM đi qua AIHub bằng connector](../adr/0003-llm-via-aihub.md) |

## 1. Bối cảnh
VPBank đã có **AIHub** — nền tảng nội bộ xử lý LLM. dugate không host model, không gọi trực tiếp nhà cung cấp LLM bên ngoài; mọi lời gọi LLM đi qua AIHub dưới dạng `ExternalApiConnection` của Core.

Hệ quả cho các quyết định trước:
- **D2 (chính sách LLM ngoài) được giải quyết ở tầng AIHub**: dugate chỉ nói chuyện với AIHub; việc AIHub định tuyến tới model nào (nội bộ/bên ngoài) và kiểm soát dữ liệu ra ngoài thuộc trách nhiệm & chính sách của AIHub.
- **Spec 002 Q4** được trả lời: BCTC/hồ sơ gửi tới AIHub qua connector.

## 2. Vị trí trong kiến trúc

```
Hệ thống ngân hàng → dugate Apps → dugate Core ──connector──▶ VPBank AIHub ──▶ model (do AIHub quản lý)
                                        │
                                        └─connector──▶ OCR/layout engine (nếu AIHub không đảm nhiệm, §6 A3)
```

## 3. Phân chia trách nhiệm

| Năng lực | AIHub | dugate Core | dugate Apps |
|---|---|---|---|
| Host / chọn / định tuyến model | **Sở hữu** | Chọn connector (endpoint AIHub) theo profile | — |
| Guardrail mức model (lọc nội dung, chặn prompt injection, chính sách dữ liệu ra ngoài) | **Sở hữu** | Không trùng lặp | — |
| Đo token & chargeback toàn ngân hàng | **Sở hữu** | Ghi nhận token/chi phí theo operation (đối soát) | Tổng hợp theo run |
| Prompt cho từng nghiệp vụ tài liệu | (tùy AIHub có prompt registry — §6 A5) | Prompt template có version (C2) | Tham chiếu `prompt_ref` |
| Gọi theo tài liệu: OCR, tách trang, ghép kết quả, retry, timeout | — | **Sở hữu** | — |
| Quy tắc & tính toán nghiệp vụ | — | — | **Sở hữu** |
| Audit lời gọi | Log phía AIHub | Model + prompt version + hash (constitution §15) — liên kết bằng request id AIHub | Liên kết run ↔ operation |

Nguyên tắc: **dugate không tự làm lại năng lực AIHub đã có** (guardrail model, metering, model routing). dugate bổ sung phần AIHub không có: hiểu tài liệu nhiều trang, orchestration, truy vết theo hồ sơ.

## 4. Khoảng trống của Core khi nối AIHub (đã kiểm tra code)

| # | Hiện trạng | Bằng chứng | Bổ sung |
|---|---|---|---|
| C7 | Connector chỉ gửi **multipart/form-data** | `processors/external-api.ts` (`new FormData()`), `http-client.ts` | Thêm `requestMode: MULTIPART \| JSON` + template body JSON (vd. OpenAI-compatible `messages`) nếu API AIHub là JSON |
| C8 | Auth chỉ `API_KEY_HEADER` hoặc `BEARER` tĩnh | `external-api.ts` dòng xử lý `authType` | Thêm `OAUTH2_CLIENT_CREDENTIALS` (cache token, refresh) và/hoặc **mTLS client cert** theo chuẩn tích hợp nội bộ |
| C9 | `modelUsed` luôn là `ext:<slug>`, không lấy tên model thực từ response | `external-api.ts` (`const modelUsed = \`ext:${connection.slug}\``) | Thêm `modelResponsePath` (vd. `model`) + `requestIdResponsePath` (id AIHub) → đáp ứng constitution §15 |
| C10 | Chi phí tính theo bảng giá USD nội bộ của dugate | `lib/config.ts` `calculateCostUsd` | Cấu hình đơn giá theo connector (hoặc 0 nếu AIHub chargeback riêng); dùng `numeric` |
| — | SSRF guard chặn host nội bộ | `http-client.ts` | Cấu hình `ALLOWED_PRIVATE_HOSTS` = host AIHub (không phải thay đổi code) |
| — | Core còn gọi SDK Gemini/OpenAI trực tiếp ở trang test cài đặt | `app/api/settings/test/route.ts` | Tắt ở bản triển khai ngân hàng; egress Internet của dugate bị chặn ở mạng |

Session chaining (`sessionIdResponsePath`, `sessionIdFieldName`) và `responseContentPath` đã có — dùng được nếu AIHub hỗ trợ hội thoại/phiên.

## 5. Cấu hình connector đề xuất

Mỗi *năng lực* là một connector trỏ tới AIHub (có thể cùng endpoint, khác model/tham số), giữ nguyên slug mà registry đang dùng để không phải sửa endpoint:

| Slug (đã có) | Dùng cho | Gợi ý cấu hình AIHub |
|---|---|---|
| `ext-classifier` | `analyze:classify` | model nhanh, JSON output |
| `ext-data-extractor` | `extract:*` | model mạnh, JSON schema output, vision nếu nhận ảnh trang |
| `ext-content-gen` | `generate:*` | model viết tiếng Việt tốt |
| `ext-fact-verifier`, `ext-compliance`, `ext-quality-eval` | `analyze:*` | model reasoning |
| `ext-doc-layout`, `ext-vision-reader` | `ingest:*` (OCR/layout) | AIHub nếu có OCR/vision; nếu không → engine OCR riêng (§6 A3) |

Mọi connector AIHub: `authType` theo C8, `timeoutSec` theo SLA AIHub, `extraHeaders` mang `x-correlation-id` và mã ứng dụng (để AIHub chargeback theo dugate Apps/profile).

## 6. Câu hỏi cho đội AIHub

| # | Câu hỏi | Ảnh hưởng |
|---|---|---|
| A1 | Giao thức API: OpenAI-compatible JSON, REST riêng, hay multipart? Có streaming không? | C7 |
| A2 | Xác thực: API key, OAuth2 client credentials, mTLS? Cấp theo ứng dụng hay theo use case? | C8 |
| A3 | AIHub có OCR/vision (nhận PDF/ảnh) không, hay chỉ text? Giới hạn kích thước/số trang/token context? | Bước ingest & extract của spec 002; có cần engine OCR riêng |
| A4 | Response có trả tên model, request id, token usage không? Trường nào? | C9, C10, truy vết |
| A5 | AIHub có prompt registry/versioning không? Nếu có, dugate tham chiếu prompt của AIHub hay giữ C2 ở Core? | C2 |
| A6 | Có hỗ trợ structured output (JSON schema) không? | Trích xuất có `_evidence` (spec 002 FR-8) |
| A7 | Rate limit / quota theo ứng dụng? SLA latency? | Concurrency activity ở Apps, `timeoutSec` |
| A8 | AIHub định tuyến tới model bên ngoài cho loại dữ liệu nào? Có cần dugate gắn nhãn phân loại dữ liệu trong request không? | Header `x-data-classification` |
| A9 | Môi trường UAT/sandbox để chạy golden set? | Spec 002 T-B11 |
