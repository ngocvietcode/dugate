# DOCX Transformation

## How It Works

```
.docx
  │
  ▼
Pandoc CLI
  → extracts raw Markdown (text structure)
  → extracts all embedded images
  │
  ▼
Sharp (image compression)
  → resize to max 1600px width
  → quality 80%
  │
  ▼
AI Vision (Gemini / OpenAI / Anthropic)
  → generates detailed description for each image
  → generates short alt text
  │
  ▼
Assembler
  → merges raw Markdown + image descriptions
  → produces full.md and text-only.md
```

## Output Files

| File | Content |
|---|---|
| `full.md` | Text content with AI-generated image descriptions inserted inline |
| `text-only.md` | Text content only, no image references |
| `images/` | Extracted and compressed image files |

## Example

Input: a Word SOP with a diagram on page 3.

`full.md` output:
```markdown
## Step 3: Packaging

Place the bag on the sealing machine as shown below.

![Sealing machine setup](images/sop-img-003.png)
*The image shows a 100g tea bag positioned at the left edge of the sealing jaw,
with the open end facing right. The temperature dial is set to 160°C.*

Seal for 3 seconds, then remove.
```

`text-only.md` output:
```markdown
## Step 3: Packaging

Place the bag on the sealing machine as shown below.

Seal for 3 seconds, then remove.
```

## Requirements

- Pandoc must be installed on the server (`pandoc --version`)
- Supported input: `.docx` (Word 2007+)
- Max file size: 100MB

## Image Compression

Before sending to AI Vision, images are resized with Sharp:
- Max width/height: 1600px
- JPEG/PNG quality: 80%
- Reduces AI API costs and speeds up processing
