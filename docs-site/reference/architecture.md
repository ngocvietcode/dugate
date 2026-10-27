# Architecture

## Data Flow

```
Browser → Upload API → File Storage (uploads/)
                            │
                ┌───────────┴───────────┐
                │                       │
            .docx?                  .pdf?
                │                       │
                ▼                       ▼
        Pandoc CLI              Ghostscript CLI
        (extract md + images)   (compress PDF)
                │                       │
                ▼                       ▼
        Sharp compress          AI Vision API
        (resize images)         (PDF → markdown)
                │                       │
                ▼                       │
        AI Vision API                   │
        (image → description)           │
                │                       │
                ▼                       ▼
        Assembler               Output: text-only.md
        (merge md + descriptions)
                │
                ▼
        Output: full.md + text-only.md + images/
                │
                ▼
        DB (Transformation record) + File Storage (outputs/)
                │
                ▼
        Preview / Edit / Download ZIP
```

## Directory Structure

```
dugate/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # Upload page
│   ├── login/page.tsx
│   ├── setup/page.tsx              # First-run wizard
│   ├── batch/page.tsx              # Batch upload
│   ├── transform/[id]/page.tsx       # Result: preview + edit + download
│   ├── history/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── upload/route.ts
│       ├── transform/route.ts
│       ├── transform/[id]/route.ts
│       ├── transform/[id]/edit/route.ts
│       ├── transform/[id]/download/route.ts
│       ├── history/route.ts
│       ├── settings/route.ts
│       └── setup/route.ts
├── components/
│   ├── UploadForm.tsx
│   ├── CompressSelector.tsx
│   ├── MarkdownPreview.tsx
│   ├── MarkdownEditor.tsx
│   ├── ConversionHistory.tsx
│   ├── HeaderNav.tsx
│   └── StatusBadge.tsx
├── lib/
│   ├── transformers/
│   │   ├── docx.ts                 # Pandoc + assemble pipeline
│   │   └── pdf.ts                  # Ghostscript + AI pipeline
│   ├── compress/
│   │   ├── images.ts               # Sharp resize + quality
│   │   └── pdf.ts                  # Ghostscript presets
│   ├── ai/
│   │   └── gemini.ts               # AI provider wrapper
│   ├── assembler.ts                # Merge raw.md + descriptions → full.md
│   ├── settings.ts                 # AppSetting CRUD + encryption
│   ├── cleanup.ts                  # Delete old files
│   ├── cleanup-scheduler.ts        # Background cleanup every 6h
│   ├── zip.ts                      # Package output as ZIP
│   └── prisma.ts                   # Prisma client singleton
├── prisma/
│   └── schema.prisma
├── uploads/                        # Git-ignored
└── outputs/                        # Git-ignored
    └── [transformation-id]/
        ├── raw.md
        ├── full.md
        ├── text-only.md
        └── images/
```

## Component Map

| Component | Used in | Function |
|---|---|---|
| `UploadForm` | `/` | Drag-drop or click upload, shows file info |
| `CompressSelector` | `/` | 4 Ghostscript presets, shown for PDF only |
| `MarkdownPreview` | `/transform/[id]` | react-markdown renders HTML from Markdown |
| `MarkdownEditor` | `/transform/[id]` | Textarea for editing Markdown |
| `ConversionHistory` | `/history` | Table of transformations sorted by date |
| `StatusBadge` | `/history`, `/transform/[id]` | Status pill: pending / compressing / processing / completed / failed |
| `HeaderNav` | All pages | Top nav — hidden on `/login` and `/setup` |
