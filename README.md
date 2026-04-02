# 🏗️ DUGate (Document Understanding API Gateway)

> **Transforming unstructured documents into intelligent, actionable data with a unified API.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

DUGate is a powerful, self-hosted Document Understanding API Gateway. It abstracts the complexity of working with OCR, LLMs, and parsing engines (Pandoc, Ghostscript) into **6 simple, expressive API endpoints**. 

Whether you need to extract data from invoices, compliance-check a contract, or redact sensitive PII, DUGate provides an asynchronous, scalable, and profile-driven architecture to handle it.

---

## ✨ Key Features

- **6 Core API Endpoints** — Replaces dozens of messy endpoints with a clean, unified structure (`ingest`, `extract`, `analyze`, `transform`, `generate`, `compare`).
- **Deep Profile-Driven Override Routing** — Admins can enforce specific internal LLM models, system context, or overwrite specific connection setups entirely *per API Key*. Client applications never have to change their calling code!
- **Visual Pipeline Chain Builder** — An intuitive **Visual UI in the Profiles Dashboard** allowing Admins to stack, re-order, and inject *Custom Prompts* using variable mapping (`{{input_content}}`) dynamically across executing connectors.
- **Asynchronous Pipeline Engine** — Handles large documents seamlessly via a generic asynchronous task runner (`202 Accepted` + Polling/Webhook pattern).
- **Multiple AI Backends** — Natively routes downward into Google Gemini, OpenAI (GPT-4o), Anthropic (Claude), or modular external APIs.
- **Standalone Mock Service Engine** — Safely develop and run high-volume E2E tests against a dedicated internal HTTP Mock Service locally without burning expensive real AI tokens.
- **Diagnostic Logging** — Includes complete cURL reconstruction and dynamic log extraction for tracing integration bugs.
---

## 🚀 The 6 Core APIs

Instead of rigid endpoints, DUGate uses **action parameters** to adapt to thousands of use cases:

| Endpoint | Purpose | Sub-cases |
|---|---|---|
| `POST /api/v1/ingest` | Parse, OCR, and digitize documents. | `parse`, `ocr`, `digitize`, `split` |
| `POST /api/v1/extract` | Pull structured JSON from forms & docs. | `invoice`, `contract`, `id-card`, `receipt`, `table`, `custom` |
| `POST /api/v1/analyze` | Evaluate, fact-check, and classify content. | `classify`, `sentiment`, `compliance`, `fact-check`, `quality`, `risk`, `summarize-eval` |
| `POST /api/v1/transform` | Convert formats, translate, or redact PII. | `convert`, `translate`, `rewrite`, `redact`, `template` |
| `POST /api/v1/generate` | Create new content (summaries, QA, emails). | `summary`, `qa`, `outline`, `report`, `email`, `minutes` |
| `POST /api/v1/compare` | Semantic or text comparisons between files. | `diff`, `semantic`, `version` |

*For full parameter lists and JSON structures, refer to the [Integration Guide](docs/DU_INTEGRATION_GUIDE.md).*

---

## ⚡ Quick Start

### 🐳 Docker (Recommended)

The easiest way to get DUGate running along with its PostgreSQL database and mock services.

```bash
git clone https://github.com/ngocvietcode/mdconvert.git dugate
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
npx prisma generate
npx prisma db push
npx prisma db seed

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
- **Database**: PostgreSQL with Prisma ORM
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

> **Giải pháp kiến trúc cổng trung gian API (Gateway) giúp trích xuất và biến đổi tài liệu không cấu trúc thành dữ liệu thông minh.**

DUGate là một hệ thống nội bộ đóng vai trò là API Gateway cho các bài toán Document Understanding. Thay vì để các ứng dụng tự gọi hàng tá các dịch vụ OCR, LLM hay công cụ parse file khác nhau một cách hỗn loạn, DUGate gói gọn tất cả sự phức tạp đó vào **6 API tiêu chuẩn**.

Phù hợp cho bất cứ hệ thống nào cần trích xuất thông tin hoá đơn, đánh giá hợp đồng, hay kiểm duyệt tài liệu một cách chuẩn xác, bảo mật nhờ vào cơ chế định tuyến qua Profile (Profile-Driven).

## ✨ Tính Năng Nổi Bật

- **6 Endpoint Cốt Lõi** — Đóng gói hàng trăm use-case thông thường thành cấu trúc nhất quán (`ingest`, `extract`, `analyze`, `transform`, `generate`, `compare`).
- **Override Routing Dựa Trên Profile** — Admin có thể can thiệp sâu vào việc đổi LLM model, thay đổi prompt gốc, hoặc cấu hình lại các kết nối Pipeline theo từng API Key. Ứng dụng client không cần phải đổi code!
- **Visual Pipeline Chain Builder** — Giao diện trực quan trong Dashboard giúp Admin kéo thả, sắp xếp, và tuỳ chỉnh Prompt cho các connector liên tiếp nhau (vd: kết quả đoạn A sẽ nối mượt mà vào Prompt đoạn B thông qua biến `{{input_content}}`).
- **Xử Lý Bất Đồng Bộ (Async Pipeline Engine)** — Phù hợp với các tài liệu hàng trăm trang qua cơ chế `202 Accepted` + Polling.
- **Hỗ trợ đa nền tảng AI** — Kết nối mặc định đến Google Gemini, OpenAI (GPT-4o), Anthropic (Claude), hoặc các external API nội bộ.
- **Standalone Mock Service** — Dịch vụ Mock HTTP tích hợp sẵn giúp bạn thoải mái chạy Automated Test/E2E Test với lưu lượng lớn mà không sợ tốn một đồng tiền tokens AI nào!
- **Theo Dõi Chuyên Sâu (Diagnostic)** — Gateway tự động gen ra mã cURL nội bộ mỗi khi nó tự forward dữ liệu sang bên thứ 3 để bạn kiểm tra lỗi dễ dàng nhất.

## 🚀 6 API Chính

| Endpoint | Chức Năng | Các bài toán (Sub-cases) |
|---|---|---|
| `POST /api/v1/ingest` | Đọc, OCR, và số hoá văn bản thô. | `parse`, `ocr`, `digitize`, `split` |
| `POST /api/v1/extract` | Trích xuất JSON từ các biểu mẫu. | `invoice`, `contract`, `id-card`, `receipt`, `table`, `custom` |
| `POST /api/v1/analyze` | Đánh giá, fact-check, phân loại. | `classify`, `sentiment`, `compliance`, `fact-check`, `quality`, `risk`, `summarize-eval` |
| `POST /api/v1/transform` | Chuyển đổi định dạng, dịch thuật, mã hoá PII. | `convert`, `translate`, `rewrite`, `redact`, `template` |
| `POST /api/v1/generate` | Sinh nội dung mới (summary, báo cáo). | `summary`, `qa`, `outline`, `report`, `email`, `minutes` |
| `POST /api/v1/compare` | So sánh văn bản hoặc tìm khác biệt. | `diff`, `semantic`, `version` |

*Chi tiết vui lòng tham khảo [Integration Guide](docs/DU_INTEGRATION_GUIDE.md).*

## ⚡ Bắt Đầu Nhanh

### 🐳 Docker (Khuyên dùng)

Cách nhanh nhất để chạy DUGate kèm PostgreSQL và Mock Service:

```bash
git clone https://github.com/ngocvietcode/mdconvert.git dugate
cd dugate
cp .env.example .env

# Sửa lại file .env với thông tin CSDL và API Key của bạn
docker compose up -d
```
Bạn sẽ truy cập được trang quản trị Gateway UI tại `http://localhost:2023`.
