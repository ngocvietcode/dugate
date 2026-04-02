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
