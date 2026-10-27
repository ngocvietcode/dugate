# Batch Upload

## Overview

The batch upload page (`/batch`) allows you to transform multiple files in a single session. Each file is processed independently and tracked separately.

## How to Use

1. Go to `/batch`
2. Drag and drop or select multiple `.docx` or `.pdf` files
3. For each PDF, choose a compression preset (or use the default)
4. Click **Transform All**
5. Track progress per file
6. Download individual files or all results as a single ZIP

## Progress Tracking

Each file shows its own status badge:

| Status | Meaning |
|---|---|
| `pending` | Queued, waiting to start |
| `compressing` | Ghostscript (PDF) or Sharp (DOCX images) running |
| `processing` | AI Vision API call in progress |
| `completed` | Done — ready to download |
| `failed` | Error — see error message |

## Batch Download

Once all files are completed, click **Download All** to get a single ZIP containing all output files organized by transformation.

## Limits

- Max file size per file: 100MB
- No hard limit on number of files per batch, but large batches may take time depending on your server and AI provider rate limits
