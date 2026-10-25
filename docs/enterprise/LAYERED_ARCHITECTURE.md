# dugate — Kiến trúc phân tầng: Core + Apps (Workflow-as-a-Service)

| Mục | Giá trị |
|---|---|
| Trạng thái | **DRAFT** |
| Quyết định | [ADR-0002: Tách Core và Apps, Apps cung cấp workflow như service](../adr/0002-core-apps-layering.md) |
| Bổ sung / điều chỉnh | [ARCHITECTURE_V5](ARCHITECTURE_V5.md) — xem §10 tài liệu này |

---

## 1. Tóm tắt

- **dugate Core** giữ nguyên vai trò: *Document Understanding Gateway* — các endpoint nguyên tử (`ingest`, `extract`, `analyze`, `transform`, `generate`, `compare`), connector tới AI/DU engine, profile, prompt, chi phí, bảo mật. Core **không biết** nghiệp vụ ngân hàng.
- **dugate Apps** là lớp mới bên trên: mỗi App là **một workflow nghiệp vụ đóng gói thành service** (vd. *Kiểm tra bộ hồ sơ giải ngân*, *Kiểm tra chứng từ L/C*, *So sánh văn bản*). App ghép các năng lực của Core, thêm logic đối chiếu và điểm duyệt của người, trả về **kết quả kiểm tra + bằng chứng**.
- Apps **không thay thế** hệ thống IT hiện có (Core banking, LOS, Trade Finance, BPM, ECM, CRM). Hệ thống hiện có vẫn là **system of record** và **process of record**; App chỉ là một *bước dịch vụ* (service task) mà các hệ thống đó gọi tới.

Một câu: **hệ thống ngân hàng hỏi — Apps kiểm tra và trả lời kèm bằng chứng — hệ thống ngân hàng quyết định.**

---

## 2. Mô hình tầng

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TẦNG 0 — Hệ thống IT hiện có của ngân hàng (KHÔNG thay thế)                  │
│  LOS / Trade Finance / Core banking / BPM / ECM / CRM / IdP / ESB / SIEM     │
│  • Sở hữu khách hàng, khoản vay, L/C, quyết định, hạch toán, quy trình tổng  │
└──────────────┬───────────────────────────────────────────▲───────────────────┘
               │ ① gọi App (REST qua ESB/API GW)            │ ④ kết quả + bằng chứng
               │    businessRef, tài liệu (URL ECM), context│    (webhook / event / poll)
               ▼                                            │
┌──────────────────────────────────────────────────────────────────────────────┐
│ TẦNG 2 — dugate Apps (Workflow-as-a-Service)                       [MỚI]     │
│  App: disbursement-check │ lc-document-check │ contract-compare │ ...        │
│  • Orchestration bền vững (Temporal)  • Quy tắc đối chiếu nghiệp vụ          │
│  • Review workbench (soát bằng chứng) • Kết quả chuẩn: findings + evidence   │
│  • KHÔNG: lưu master data, ra quyết định tín dụng, hạch toán, quản lý case   │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ ② chỉ qua API công khai của Core (client có ApiKey role APP)
               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ TẦNG 1 — dugate Core (Document Understanding Gateway)          [HIỆN CÓ]     │
│  /api/v1/docs/{ingest|extract|analyze|transform|generate|compare}            │
│  • Connector registry • Profile/ApiKey • Prompt template • Cost • Audit AI   │
│  • Không biết khái niệm "khoản vay", "L/C", "giải ngân"                      │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ ③ connector (multipart / HTTP)
               ▼
        AI / DU engines: OCR, layout, LLM (on-prem hoặc đã phê duyệt)
```

**Luật phụ thuộc một chiều**: Tầng 0 → Apps → Core → Engines. Core không gọi Apps. Apps không gọi Engine trực tiếp. Apps không truy cập DB của Core hay DB của hệ thống ngân hàng.

---

## 3. Trách nhiệm từng tầng

### 3.1 Core — làm / không làm

| Làm | Không làm |
|---|---|
| Năng lực nguyên tử trên tài liệu: OCR, phân loại, trích xuất, so sánh, sinh nội dung | Biết workflow nào gọi mình, hay ý nghĩa nghiệp vụ của kết quả |
| Quản lý connector, timeout, SSRF, secrets, chi phí, hạn mức theo client | Lưu trạng thái nghiệp vụ dài hạn, điểm duyệt của người |
| Prompt **template** có version, gắn theo profile của client | Chứa prompt nghiệp vụ hard-code trong code workflow |
| Truy vết mỗi lời gọi AI (model, prompt version, hash, token) | Ra quyết định |
| Operation bất đồng bộ (AIP-151), idempotency, webhook | Orchestration nhiều bước dài ngày (để cho Apps) |

### 3.2 Apps — làm / không làm

| Làm | Không làm (thuộc hệ thống hiện có) |
|---|---|
| Nhận yêu cầu kiểm tra một bộ hồ sơ theo `businessRef` của hệ thống gọi | Tạo/sở hữu hồ sơ khách hàng, khoản vay, L/C |
| Điều phối nhiều bước Core (song song, tuần tự), retry, timeout, bền vững qua restart | Quy trình tổng end-to-end (từ tiếp nhận tới giải ngân) — đó là việc của BPM/LOS |
| Quy tắc đối chiếu xác định được (khớp số tiền, ngày, tên, điều kiện L/C theo UCP/ISBP do nghiệp vụ định nghĩa) | Phê duyệt tín dụng, quyết định giải ngân, thanh toán L/C |
| Workbench cho cán bộ soát/sửa kết quả trích xuất **có bằng chứng** (trang, vùng, trích dẫn) | Hàng đợi công việc, phân công, escalation toàn ngân hàng (thuộc BPM/LOS) |
| Trả kết quả chuẩn: findings + evidence + dữ liệu trích xuất + báo cáo | Ghi vào core banking / LOS; lưu trữ tài liệu dài hạn (thuộc ECM) |
| Lưu dữ liệu làm việc có thời hạn (TTL) và audit của chính App | Là kho dữ liệu nguồn cho báo cáo nghiệp vụ |

### 3.3 Ma trận sở hữu với hệ thống hiện có

| Năng lực | Hệ thống hiện có | Apps | Core |
|---|---|---|---|
| Thông tin khách hàng / khoản vay / L/C (master data) | **Sở hữu** | Nhận qua `context` khi được gọi (chỉ đọc) | — |
| Quy trình nghiệp vụ tổng, SLA toàn trình | **Sở hữu** | SLA của riêng bước kiểm tra | — |
| Tài liệu gốc & lưu trữ dài hạn | **ECM sở hữu** | Tham chiếu URL; lưu tạm có TTL | Cache có TTL / dedup |
| Đọc hiểu tài liệu (OCR, extract, classify) | — | Gọi Core | **Sở hữu** |
| Đối chiếu chéo nhiều tài liệu + quy tắc nghiệp vụ | (có thể có rule engine riêng) | **Sở hữu** (phần dựa trên tài liệu) | — |
| Soát bằng chứng của người | Phân công, giao việc | **Workbench** soát/sửa | — |
| Quyết định cuối & hạch toán | **Sở hữu** | Chỉ khuyến nghị | — |
| Danh tính người dùng | **IdP sở hữu** | OIDC, map role | OIDC/ApiKey |
| Audit | SIEM tập trung | Audit nghiệp vụ của App → đẩy SIEM | Audit lời gọi AI → đẩy SIEM |

---

## 4. Định vị App trong quy trình ngân hàng

App luôn là **một bước dịch vụ trong quy trình của hệ thống khác**, không phải quy trình chính. Ví dụ giải ngân:

```
LOS / BPM (process of record)                 dugate Apps: disbursement-check         dugate Core
───────────────────────────────               ───────────────────────────────          ───────────
[Tiếp nhận hồ sơ giải ngân]
        │
[Service task: Kiểm tra bộ chứng từ] ──POST /apps/v1/disbursement-check/runs──▶ start workflow
        │  (chờ callback)                       │  classify từng file ───────────▶ analyze:classify
        │                                       │  extract theo loại ────────────▶ extract:custom
        │                                       │  đối chiếu quy tắc (trong App)
        │                                       │  cần người soát? ─┐
        │ ◀── event run.review_required ────────│◀──────────────────┘
[User task trong LOS: "Soát kết quả"]           │  (chờ quyết định, tới 30 ngày)
   cán bộ mở deep-link → Review workbench ──────▶ POST /tasks/{id}/decision (maker≠checker)
        │                                       │  sinh báo cáo ─────────────────▶ generate:report
        │ ◀── event run.completed (findings) ───│
[Cán bộ thẩm định / phê duyệt trong LOS]   ← quyết định thuộc LOS
[Hạch toán trên Core banking]
```

Điểm then chốt:
- **LOS vẫn giữ user task** "soát kết quả" (phân công, ưu tiên, nhắc việc, escalation). App chỉ cung cấp *màn hình soát bằng chứng* qua deep-link/nhúng, vì BPM thường không hiển thị được vùng bằng chứng trên trang tài liệu.
- Nếu ngân hàng muốn soát hoàn toàn trên giao diện của họ, App cung cấp API đầy đủ (`GET /tasks/{id}` + `POST /decision`) — workbench là tùy chọn.
- Kết quả của App là **khuyến nghị có bằng chứng**; LOS ghi nhận quyết định.

---

## 5. Workflow Service Contract (chuẩn chung cho mọi App)

Mọi App tuân theo cùng một contract để (a) hệ thống ngân hàng tích hợp một lần dùng cho nhiều App, (b) AI agent sinh App mới theo khuôn.

### 5.1 API

| Method | Path | Mục đích |
|---|---|---|
| `GET` | `/apps/v1` | Danh mục App, version, schema input/output |
| `POST` | `/apps/v1/{app}/runs` | Bắt đầu một lần kiểm tra |
| `GET` | `/apps/v1/runs/{runId}` | Trạng thái + kết quả |
| `POST` | `/apps/v1/runs/{runId}:cancel` | Hủy |
| `GET` | `/apps/v1/runs/{runId}/tasks` | Các điểm cần người soát |
| `POST` | `/apps/v1/tasks/{taskId}/decision` | Gửi quyết định soát (approve / edit / reject) |
| `GET` | `/apps/v1/runs/{runId}/report` | Báo cáo (PDF/HTML) |

Request start (rút gọn):
```json
{
  "requestId": "LOS-REQ-2026-000123",           // idempotency: (caller, app, requestId)
  "businessRef": { "system": "LOS", "type": "LOAN_DISBURSEMENT", "id": "HD-889912" },
  "documents": [{ "url": "https://ecm.bank.local/doc/…", "docTypeHint": "INVOICE" }],
  "context": { "approvedAmount": "1500000000", "currency": "VND", "borrowerName": "…" },
  "review": { "mode": "DELEGATED", "makerUserId": "u123" },   // DELEGATED | EMBEDDED | NONE
  "callback": { "url": "https://esb.bank.local/hooks/dugate", "events": ["run.review_required", "run.completed", "run.failed"] }
}
```

### 5.2 Kết quả chuẩn

```json
{
  "runId": "run_…", "app": "disbursement-check", "appVersion": "1.3.0",
  "status": "COMPLETED",               // RUNNING | WAITING_REVIEW | COMPLETED | FAILED | CANCELLED
  "outcome": "DISCREPANCIES_FOUND",    // PASS | DISCREPANCIES_FOUND | INCONCLUSIVE  (khuyến nghị, không phải quyết định)
  "findings": [{
    "code": "AMOUNT_MISMATCH", "severity": "HIGH",
    "message": "Tổng hóa đơn 1.62 tỷ vượt số tiền được duyệt 1.5 tỷ",
    "evidence": [{ "documentId": "d1", "page": 2, "bbox": [120, 340, 410, 362], "quote": "Tổng cộng: 1.620.000.000" }],
    "rule": { "id": "DSB-007", "version": 2 }
  }],
  "extracted": { "...": "dữ liệu trích xuất đã qua soát" },
  "review": { "reviewedBy": "u456", "edits": 3 },
  "trace": { "coreOperations": ["op_…"], "promptVersions": { "classify": "dsb-classify@4" } }
}
```

`findings[].evidence` là yêu cầu bắt buộc: mọi kết luận phải trỏ được về vị trí trong tài liệu — phục vụ giải trình với kiểm toán và giúp cán bộ soát nhanh.

### 5.3 Sự kiện
`run.started`, `run.review_required`, `run.completed`, `run.failed`, `run.cancelled` — webhook ký HMAC-SHA256, retry có backoff; tùy chọn publish lên Kafka/MQ của ngân hàng qua adapter.

---

## 6. Quan hệ Apps → Core

### 6.1 Nguyên tắc
1. Mỗi App là **một client của Core**: có ApiKey riêng (role mới `APP`), ProfileEndpoint riêng → hạn mức chi phí, tham số khóa, connector override, prompt template đều quản lý bằng cơ chế Core đã có.
2. App chỉ gọi **API công khai** `/api/v1/docs/*` qua SDK sinh từ OpenAPI (`core-client`). Không import code `lib/` của Core.
3. Idempotency: mỗi lời gọi Core từ App gửi `idempotency key = runId + stepKey (+ fileIndex)` → Temporal retry activity không tạo Operation trùng (Core đã hỗ trợ `idempotencyKey`).
4. Tài liệu đi bằng `file_urls` (Core đã hỗ trợ tải theo URL với auth config theo profile + SSRF guard). App không giữ bytes tài liệu.

### 6.2 Khoảng trống của Core để làm được điều này (đã kiểm tra code)

| # | Hiện trạng | Bằng chứng | Bổ sung cần cho Core |
|---|---|---|---|
| C1 | Workflow hiện gọi connector **trực tiếp** qua sub-operation, bỏ qua endpoint công khai | `workflow-engine.ts` `enqueueSubStep(ctx, 'ext-classifier', …)` | App phải đi qua endpoint `analyze`/`extract`/… |
| C2 | Prompt nghiệp vụ được build trong code workflow và truyền qua biến nội bộ `_prompt` (ưu tiên cao nhất); API công khai không nhận prompt tùy ý | `processors/external-api.ts` (`ctx.variables._prompt ? 'code' : …`), `workflows/prompts/*` | **Prompt template có version trong Core**, App tham chiếu `prompt_ref` + biến; template gắn với profile của App và qua maker-checker. Không mở `_prompt` ra API công khai |
| C3 | Connector `ext-doc-compare` (dùng bởi doc-compare) không có endpoint công khai nào; `ext-fact-verifier` chỉ xuất hiện như bước thứ 2 của `analyze:fact-check` | `lib/endpoints/registry.ts` | Thêm sub-case (vd. `compare:structured`) hoặc cho profile của App map connector qua `connectionsOverride` |
| C4 | Mỗi lời gọi phải gửi lại file; OCR đã làm ở bước trước không tái sử dụng được trực tiếp | `submit.ts` (file/`file_urls` theo từng request) | **Document handle**: `ingest` trả `documentId` + text/layout; các endpoint sau nhận `document_ids` thay cho file |
| C5 | Không có loại client "ứng dụng nội bộ"; role ApiKey chỉ `STANDARD`/`ADMIN` | `lib/db/schema.ts` `apiKeys.role` | Role `APP` (được dùng `prompt_ref`, `document_ids`, hạn mức riêng) |
| C6 | Kết quả trích xuất chưa chuẩn hóa vị trí bằng chứng (trang/bbox) | connector trả `content`/`extractedData` tự do | Chuẩn hóa `evidence` trong output của `extract`/`analyze` (phụ thuộc engine có trả layout) |

Các bổ sung này đều là **năng lực chung** (dùng được cho mọi client, không riêng App), nên vẫn giữ Core trung lập nghiệp vụ.

### 6.3 Gọi Core từ workflow
- v1 (đơn giản, bền): activity `callCore` submit async + **poll có heartbeat** tới khi Operation `done`. Restart worker → Temporal retry activity → idempotency key trả lại Operation cũ, không gọi engine lần hai.
- v2 (tối ưu): Core webhook → endpoint callback của Apps → hoàn tất activity bất đồng bộ (async activity completion bằng task token). Chỉ làm khi số lượng lớn.

---

## 7. Đặt Temporal ở đâu & dữ liệu

| Hạng mục | Quyết định đề xuất |
|---|---|
| Temporal | **Chỉ ở tầng Apps** (namespace `apps-<env>`). Core giữ mô hình Operation + BullMQ cho các thao tác nguyên tử (1 endpoint = chuỗi connector ngắn) |
| Lý do | Durability nhiều bước + chờ người là bài toán của Apps; Core ops ngắn, đã có idempotency + retry; tránh dời toàn bộ Core sang Temporal (giảm rủi ro, giảm phạm vi) |
| DB của Apps | Schema/DB riêng: `AppRun` (projection), `ReviewTask`, `Finding`, `AppAuditEvent`, `RuleSet` (version). Không dùng chung bảng `Operation` của Core |
| Dữ liệu tài liệu | Không lưu bytes; lưu `documentId`/URL + sha256. Dữ liệu trích xuất & findings lưu có TTL theo chính sách (vd. 90 ngày), bản cuối do hệ thống gọi lưu vào ECM/LOS |
| Audit | App audit (start, decision, edit trước/sau, cancel) + Core audit (lời gọi AI) — nối với nhau qua `runId` ↔ `coreOperationId`, đẩy về SIEM |

---

## 8. Chế độ duyệt của người (HITL)

| Mode | Khi nào dùng | Ai giữ hàng đợi việc | Màn hình soát |
|---|---|---|---|
| `DELEGATED` (mặc định) | Có LOS/BPM quản lý user task | Hệ thống ngân hàng | Deep-link vào workbench của App hoặc UI của ngân hàng qua API |
| `EMBEDDED` | Đơn vị chưa có BPM cho bước này (pilot) | Danh sách việc tối giản trong App | Workbench của App |
| `NONE` | Kiểm tra tham khảo, không ảnh hưởng quyết định | — | — |

Áp dụng mọi mode: maker ≠ checker kiểm tra ở server; chỉnh sửa lưu trước/sau; quá hạn soát → `run.failed` với lý do `REVIEW_TIMEOUT` (hệ thống gọi tự quyết định escalation).

---

## 9. Thiết kế cho AI Agent ở tầng Apps

- **App = một thư mục theo khuôn cố định** + manifest khai báo:
  ```yaml
  # apps/<app>/app.yaml
  name: disbursement-check
  version: 1.3.0
  owner: Khối Tín dụng
  input: ./schema.ts#Input
  output: ./schema.ts#Output
  coreCapabilities: [analyze:classify, extract:custom, generate:report]
  promptRefs: [dsb-classify, dsb-extract, dsb-report]
  review: { modes: [DELEGATED, EMBEDDED], timeout: 30d }
  rules: ./rules/          # quy tắc đối chiếu thuần, có unit test từng rule
  ```
- **Agent làm việc trong một App chỉ cần đọc**: manifest, `core-client` (SDK), contract chung (§5), constitution. Không cần hiểu nội bộ Core → bối cảnh nhỏ, ít sai.
- **Danh mục năng lực Core** sinh tự động từ `SERVICE_REGISTRY` (đã có `GET /api/v1/services`) → agent biết Core có gì, thiếu gì thì mở spec cho Core thay vì tự gọi connector.
- **Quy tắc đối chiếu là hàm thuần** (`rules/*.ts`) với bảng test case → agent thêm/sửa rule an toàn, nghiệp vụ đọc được test.
- **Guardrail**: lint cấm Apps import `@/lib/**` của Core; contract test với `mock-service`; workflow test + replay test; validate manifest trong CI (capability khai báo phải tồn tại trong registry Core).

---

## 10. Điều chỉnh so với ARCHITECTURE_V5

| ARCHITECTURE_V5 | Điều chỉnh |
|---|---|
| Temporal thay engine cho cả workflow và pipeline cấu hình của Core (Phase 3) | Temporal **chỉ cho Apps**; Core giữ Operation/BullMQ. Phase 3 "gỡ BullMQ" bỏ khỏi phạm vi, đánh giá lại sau |
| Workflow `disbursement`, `lc-checker`, `doc-compare` port tại chỗ trong `lib/temporal/` | Port thành **App** ở thư mục riêng, gọi Core qua API; workflow cũ trong Core giữ chạy tới khi App tương ứng thay thế, rồi gỡ |
| Prompt Registry đặt chung | Prompt template là năng lực **Core** (C2); App chỉ tham chiếu |
| Maker-checker HITL trong Core | HITL thuộc **Apps**; maker-checker cấu hình (connector, prompt, profile) vẫn ở **Core** |
| Spec 001 pilot doc-compare trên Core | Pilot đi qua cả 2 tầng → cần C3 (+C2 nếu dùng prompt riêng) trước |

### Lộ trình điều chỉnh
| Phase | Nội dung |
|---|---|
| 0 | Vệ sinh + tài liệu agent (như V5) |
| 1-Core | C5 role `APP`, C2 prompt template + `prompt_ref`, C3 expose năng lực compare; OpenAPI → `core-client` |
| 1-Apps | Khung Apps: Temporal (dev), Workflow Service Contract, App `contract-compare` pilot (từ doc-compare), `EMBEDDED`/`NONE` review |
| 2 | App `disbursement-check`, `lc-document-check` với `DELEGATED` review, findings + evidence (C6), webhook/MQ adapter; C4 document handle |
| 3 | Gỡ `lib/pipelines/workflows/*` và `workflow-engine.ts` khỏi Core khi các App đã thay thế; tái cấu trúc monorepo (D3) |
| 4 | Hardening production (HA/DR, Vault, SIEM, pentest) |

---

## 11. Quyết định mở

| # | Câu hỏi | Đề xuất |
|---|---|---|
| L1 | Apps nằm cùng repo dugate (thư mục `apps/`, deploy riêng) hay repo riêng? | Cùng repo giai đoạn đầu — thay đổi Core + App trong một PR, lint chặn import chéo; tách repo khi có đội riêng |
| L2 | Hệ thống gọi App đầu tiên là gì (LOS, Trade Finance, BPM nào)? Có ESB/Kafka không? | Cần thông tin để chốt adapter sự kiện |
| L3 | Review workbench: deep-link sang UI App có chấp nhận được không, hay bắt buộc soát trong UI ngân hàng? | `DELEGATED` + deep-link |
| L4 | Quy tắc đối chiếu (vd. dung sai số tiền, điều kiện UCP 600/ISBP) do ai sở hữu & phê duyệt version? | Nghiệp vụ sở hữu, rule có version + maker-checker như prompt |
| L5 | TTL dữ liệu làm việc của Apps & Core | 90 ngày, bản cuối lưu ECM do hệ thống gọi |
| L6 | App có được đọc dữ liệu tham chiếu trực tiếp từ hệ thống ngân hàng (vd. gọi LOS lấy hạn mức) không, hay chỉ nhận qua `context`? | Chỉ qua `context` (context-in, findings-out) — tránh phụ thuộc ngược và quyền truy cập rộng |
