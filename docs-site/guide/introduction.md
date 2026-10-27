# Introduction

## What is dugate?

**dugate** is a self-hosted web tool that transforms `.docx` and `.pdf` files into clean Markdown, optimized for use with AI agents, Claude Projects, and Claude Code.

When you feed documents to an AI, raw text is often not enough — especially for SOPs, manuals, or guides that contain images. dugate solves this by:

1. Extracting images from Word documents
2. Sending each image to AI Vision (Gemini / OpenAI / Anthropic)
3. Generating a detailed text description for each image
4. Assembling everything into a single Markdown file

The result is a `full.md` that an AI can fully understand — even the visual parts.

## Use Cases

| Use case | How dugate helps |
|---|---|
| **Claude Projects** | Upload SOP or manual as Markdown context — Claude understands every image |
| **Claude Code** | Drop `full.md` into your project so Claude Code has full context |
| **AI Agents** | Feed structured Markdown to your agent instead of raw PDFs |
| **Knowledge base** | Transform company documentation to Markdown for indexing |
| **Translation / editing** | Edit Markdown output in the built-in editor before using |

## Two Transformation Flows

```
DOCX → Pandoc → extract text + images → AI Vision → full.md + text-only.md + images/

PDF  → Ghostscript → compress → AI Vision (page by page) → text-only.md
```

## Key Features

- **Batch upload** — transform multiple files in one session
- **Multi AI provider** — Gemini, OpenAI, Anthropic — switchable from the UI
- **Inline editor** — preview and edit Markdown before downloading
- **Auto cleanup** — files deleted after 24h
- **Self-hosted** — your data stays on your server
- **Bilingual prompts** — English and Vietnamese presets

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Backend | Next.js API Routes, Prisma ORM |
| Database | PostgreSQL |
| DOCX parsing | Pandoc (CLI) |
| PDF rendering | Ghostscript (CLI) |
| Image processing | Sharp |
| AI Vision | Gemini / OpenAI / Anthropic |
| Auth | NextAuth.js |
