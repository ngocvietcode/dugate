# PDF Transformation

## How It Works

```
.pdf
  │
  ▼
Ghostscript CLI
  → compresses PDF (reduces file size)
  → preset: screen / ebook / printer / prepress
  │
  ▼
AI Vision (Gemini / OpenAI / Anthropic)
  → reads PDF pages directly
  → extracts text, tables, and describes visual content
  │
  ▼
text-only.md
```

## Output

PDF transformation produces a single `text-only.md` file. There is no `full.md` or `images/` folder for PDFs — AI Vision reads the rendered pages directly.

## Compression Presets

Choose a preset when uploading:

| Preset | DPI | Use case |
|---|---|---|
| `screen` | 72 dpi | Smallest size, screen viewing only |
| `ebook` | 150 dpi | Good balance — **recommended** |
| `printer` | 300 dpi | High quality print |
| `prepress` | 300 dpi | Maximum quality, largest file |

The compressed PDF is a temporary file — it is used only for AI processing and deleted after transformation completes.

## Requirements

- Ghostscript must be installed (`gs --version`)
- Supported input: `.pdf`
- Max file size: 100MB

## Limitations

- PDF transformation produces **text-only output** — no image extraction
- For PDFs with complex diagrams, AI Vision describes visible content but accuracy depends on the provider and image quality
- Scanned PDFs (image-only) work but quality depends on scan resolution
