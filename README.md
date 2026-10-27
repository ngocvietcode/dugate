# 🏗️ DUGate (Document Understanding API Gateway)

> **Transforming unstructured documents into intelligent, actionable data with a unified API.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

DUGate is a powerful, self-hosted Document Understanding API Gateway. It abstracts the complexity of working with OCR, LLMs, and parsing engines (Pandoc, Ghostscript) into **5 simple, expressive API endpoints**. 

Whether you need to extract data from invoices, compliance-check a contract, or redact sensitive PII, DUGate provides an asynchronous, scalable, and profile-driven architecture to handle it.

---

## ✨ Key Features

- **5 Core API Endpoints** — Consolidates fragmented legacy integrations into a clean, unified architectural standard (`extract`, `analyze`, `transform`, `generate`, `compare`). Served on the canonical **v2** surface (`/api/v2/docs/*`); the legacy v1 surface (incl. `ingest`) stays available for backward compatibility.
- **Deep Profile-Driven Override Routing** — Administrators can enforce specific internal LLM models, system context, or overwrite connection setups entirely *per API Key*. Client applications interact transparently without requiring codebase modifications.
- **Visual Pipeline Chain Builder** — An intuitive **Visual Interface in the Profiles Dashboard** allowing Administrators to securely orchestrate, re-order, and inject *Contextual Prompts* using variable mapping (`{{input_content}}`) dynamically across executing connectors.
- **Asynchronous Pipeline Engine** — Processes large-scale documents seamlessly via an enterprise-grade asynchronous worker queue (`202 Accepted` + Polling/Webhook pattern).
- **Multiple AI Backends** — Natively routes downward into Google Gemini, OpenAI, Claude, or modular internal APIs to comply with strict data locality policies.
- **Standalone Mock Service Engine** — Safely develop and run high-volume Automated Tests against a dedicated internal HTTP Mock Service locally, optimizing integration efforts without incurring external AI token costs.
- **Diagnostic Logging & Auditing** — Includes complete cURL reconstruction and dynamic log extraction for comprehensive tracing and rapid incident resolution.
---

## 🚀 The 5 Core APIs

Instead of rigid endpoints, DUGate uses **action parameters** to adapt to thousands of use cases:

| Endpoint | Purpose | Sub-cases |
|---|---|---|
| `POST /api/v2/docs/extract` | Pull structured JSON from forms & docs. | `disbursement`, `guarantee`, `approval`, `collateral`, `credit-report`, `query`, `payment-order`, `lc`, `invoice`, `business-license`, `account-form`, `id-card`, `civil-doc`, `vehicle-doc`, `insurance`, `contract`, `table` (+ legacy `receipt`, `custom`) |
| `POST /api/v2/docs/analyze` | Evaluate, fact-check, and classify content. | `classify`, `compliance`, `risk`, `quality` (+ legacy `sentiment`, `fact-check`, `summarize-eval`) |
| `POST /api/v2/docs/transform` | Convert formats, translate, redact PII, split pages. | `convert`, `translate`, `rewrite`, `redact`, `template`, `split` |
| `POST /api/v2/docs/generate` | Create new content (summaries, QA, emails). | `summary`, `report`, `email`, `minutes` (+ legacy `outline`, `qa`) |
| `POST /api/v2/docs/compare` | Semantic or text comparisons between files. | `verify`, `diff`, `semantic`, `version` |

> **Backward compatibility:** the legacy v1 surface (`/api/v1/{service}` and `/api/v1/docs/{service}`), including the deprecated `ingest` service (`parse`, `ocr`, `digitize`, `split`), remains fully functional.

*For full parameter lists and JSON structures, refer to the [Integration Guide](docs/DU_INTEGRATION_GUIDE.md).*

---

## ⚡ Quick Start

### 🐳 Docker (Recommended)

The easiest way to get DUGate running along with its PostgreSQL database and mock services.

```bash
git clone https://github.com/ngocvietcode/dugate.git dugate
cd dugate
cp .env.example .env

# Edit .env to set DATABASE_URL, NEXTAUTH_SECRET, and your AI API Keys
docker compose up -d
```

### 💻 Local Development

Prerequisites: `pandoc`, `ghostscript`, `Node.js 20+`.

```bash
npm install
cp .env.example .env

# Setup your Postgres Database locally, then run:
npx drizzle-kit push   # sync schema to the database
npm run seed           # seed initial data (lib/db/seed.ts)

npm run dev
# Access the Gateway UI at http://localhost:2023
```

---

## 📖 Documentation & Architecture

Dive deeper into the design philosophy, client integration, and the powerful admin configuration interfaces:

- **[Admin Multi-Connector Guide](docs/admin-multi-connector-guide.md)** — Guide on routing overrides, visual dynamic pipeline chain building, and connector mapping (ex: output mapping into subsequent prompts).
- **[API Design Proposal](docs/API_DESIGN_PROPOSAL.md)** — Architectural overview, endpoint philosophy, and request/response lifecycles.
- **[Integration & Admin Guide](docs/DU_INTEGRATION_GUIDE.md)** — Comprehensive guide on API parameter usage, Async polling patterns, and basic Profile configuration.

---

## 🛠️ Tech Stack

- **Core**: Next.js 14 (App Router), TypeScript, NextAuth.js
- **Database**: PostgreSQL with Drizzle ORM
- **Engines**: 
  - `Pandoc` (DOCX structure parsing)
  - `Ghostscript` (PDF rendering & compression)
  - `Sharp` (Image optimization)
- **AI Integration**: Official SDKs for Gemini, OpenAI, Claude.

---

## 🤝 Contributing

We welcome contributions! Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for details on setting up the developer environment and submitting pull requests.

---

## 📄 License

[AGPL-3.0](LICENSE) — Free to use and self-host. Modifications must be open-sourced under the same license. 

> *Built to give developers total control over Document AI workflows.*

<br/>

---

# 🇻🇳 DUGate (Vietnamese Version)

> **Giải pháp kiến trúc cổng trung gian API (Gateway) vận hành quy chuẩn, trích xuất và biến đổi tài liệu phi cấu trúc thành dữ liệu thông minh an toàn và tin cậy.**

DUGate là một hệ thống nội bộ đóng vai trò là API Gateway chuyên biệt cho các bài toán Phân tích Tài liệu (Document Understanding). Thay vì để các ứng dụng nghiệp vụ gọi trực tiếp và phân mảnh đến các dịch vụ OCR, LLM hay công cụ parse file khác nhau, DUGate quy chuẩn hóa toàn bộ sự phức tạp đó vào **5 API tiêu chuẩn cấp doanh nghiệp**.

Hệ thống được thiết kế đặc biệt phù hợp cho các quy trình nghiệp vụ yêu cầu tính bảo mật, chính xác và nhất quán cao như: trích xuất thông tin hoá đơn chứng từ, đánh giá rủi ro hợp đồng, hay kiểm duyệt tài liệu. Điều này được đảm bảo thông qua cơ chế định tuyến chặt chẽ theo Hồ sơ thiết lập (Profile-Driven).

## ✨ Năng Lực Cốt Lõi

- **5 Endpoint Xử Lý Tập Trung** — Quy chuẩn hoá hàng trăm nghiệp vụ tài liệu thông thường thành cấu trúc API đồng nhất (`extract`, `analyze`, `transform`, `generate`, `compare`). Phục vụ trên bề mặt chuẩn **v2** (`/api/v2/docs/*`); bề mặt v1 cũ (gồm cả `ingest`) vẫn giữ để tương thích ngược.
- **Override Routing Dựa Trên Profile** — Quản trị viên hệ thống có thẩm quyền can thiệp vào việc định tuyến LLM model, thay đổi System Prompt, hoặc cấu hình lại các luồng xử lý Pipeline theo từng API Key. Đảm bảo ứng dụng Client giao tiếp một cách minh bạch mà không cần can thiệp mã nguồn.
- **Chuỗi Nghiệp Vụ Trực Quan (Pipeline Builder)** — Giao diện Dashboard cung cấp khả năng thiết lập luồng xử lý chuyên sâu, cho phép phân bổ và ánh xạ Prompt động cho các dịch vụ liên tiếp nhau (vd: kết quả nghiệp vụ A sẽ đóng vai trò Dữ liệu đầu vào cho Prompt nghiệp vụ B thông qua biến `{{input_content}}`).
- **Cơ Chế Xử Lý Bất Đồng Bộ (Async Engine)** — Đáp ứng khả năng khai thác khối lượng tài liệu lớn thông qua cơ chế phản hồi `202 Accepted` kết hợp Webhook/Polling, đảm bảo tính ổn định của hệ thống lõi.
- **Hỗ Trợ Mở Rộng Đa Nền Tảng AI** — Hỗ trợ kết nối an toàn đến Google Gemini, OpenAI, Claude, hoặc tích hợp trực tiếp vào các mô hình AI/Dịch vụ nội bộ của doanh nghiệp nhằm đáp ứng tiêu chuẩn nội bộ.
- **Hệ Thống Dịch Vụ Giả Lập (Mock Service)** — Môi trường Mock HTTP độc lập hỗ trợ kỹ sư vận hành các kịch bản kiểm thử tự động (Automated/E2E Test) trên quy mô lớn, tối ưu hóa triệt để chi phí vận hành API.
- **Giám Sát Định Tuyến & Truy Vết (Diagnostic)** — Gateway tự động khởi tạo và lưu vết mã cURL nội bộ mỗi khi thực hiện giao tiếp với dịch vụ bên thứ 3, hỗ trợ công tác kiểm toán (audit) và phát hiện lỗi nhanh chóng.

## 🚀 5 API Chính

| Endpoint | Chức Năng | Các bài toán (Sub-cases) |
|---|---|---|
| `POST /api/v2/docs/extract` | Trích xuất JSON từ các biểu mẫu. | `disbursement`, `guarantee`, `approval`, `collateral`, `credit-report`, `query`, `payment-order`, `lc`, `invoice`, `business-license`, `account-form`, `id-card`, `civil-doc`, `vehicle-doc`, `insurance`, `contract`, `table` (+ legacy `receipt`, `custom`) |
| `POST /api/v2/docs/analyze` | Đánh giá, fact-check, phân loại. | `classify`, `compliance`, `risk`, `quality` (+ legacy `sentiment`, `fact-check`, `summarize-eval`) |
| `POST /api/v2/docs/transform` | Chuyển đổi định dạng, dịch thuật, mã hoá PII, tách trang. | `convert`, `translate`, `rewrite`, `redact`, `template`, `split` |
| `POST /api/v2/docs/generate` | Sinh nội dung mới (summary, báo cáo). | `summary`, `report`, `email`, `minutes` (+ legacy `outline`, `qa`) |
| `POST /api/v2/docs/compare` | So sánh văn bản hoặc tìm khác biệt. | `verify`, `diff`, `semantic`, `version` |

> **Tương thích ngược:** bề mặt v1 cũ (`/api/v1/{service}` và `/api/v1/docs/{service}`), gồm cả service `ingest` đã deprecated (`parse`, `ocr`, `digitize`, `split`), vẫn hoạt động đầy đủ.

*Chi tiết vui lòng tham khảo [Integration Guide](docs/DU_INTEGRATION_GUIDE.md).*

## ⚡ Bắt Đầu Nhanh

### 🐳 Docker (Khuyên dùng)

Cách nhanh nhất để chạy DUGate kèm PostgreSQL và Mock Service:

```bash
git clone https://github.com/ngocvietcode/dugate.git dugate
cd dugate
cp .env.example .env

# Sửa lại file .env với thông tin CSDL và API Key của bạn
docker compose up -d
```
Bạn sẽ truy cập được trang quản trị Gateway UI tại `http://localhost:2023`.
