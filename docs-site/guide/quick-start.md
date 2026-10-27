# Quick Start

## 1. First Run — Setup Wizard

After starting dugate for the first time, open:

```
http://localhost:2023/setup
```

Create your admin account (email + password). This page is only visible when no users exist in the database — it redirects to login on subsequent visits.

## 2. Configure AI Provider

Go to **Settings** (`/settings`) and select an AI provider:

| Provider | Required key |
|---|---|
| Google Gemini | `GEMINI_API_KEY` (or enter in UI) |
| OpenAI | Enter API key in Settings |
| Anthropic | Enter API key in Settings |

Keys entered in the UI are encrypted with AES-256 before being stored in the database.

You can also customize the AI prompt or choose a language preset (English / Vietnamese).

## 3. Upload Your First File

Go to the home page (`/`) and:

1. Drag and drop a `.docx` or `.pdf` file (max 100MB)
2. For PDF: choose a compression preset (ebook is recommended)
3. Click **Transform**

Transformation runs in the background. The page polls for status automatically.

## 4. Review and Download

Once transformation is complete:

- **Preview** the Markdown output
- **Edit** inline if needed
- **Download** a ZIP containing all output files

### DOCX output

```
[filename]-YYYYMMDD.zip
├── [filename]-full.md        ← text + image descriptions
├── [filename]-text-only.md   ← text only
└── images/
    ├── [filename]-img-001.png
    └── ...
```

### PDF output

```
[filename]-YYYYMMDD.zip
└── [filename]-text-only.md
```

## 5. Batch Upload

Go to `/batch` to upload multiple files at once. Each file is converted independently and you can download all results as a single ZIP.

## 6. History

Go to `/history` to see all past transformations, re-download results, or delete entries.
