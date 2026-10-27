# API Reference

All endpoints require authentication (NextAuth session cookie).

---

## POST /api/upload

Upload a file and create a transformation record.

| Field | Value |
|---|---|
| Method | POST |
| Content-Type | multipart/form-data |
| Auth | Required |

### Request

| Param | Type | Required | Description |
|---|---|---|---|
| `file` | File | Yes | `.docx` or `.pdf`, max 100MB |
| `compressLevel` | String | No | PDF only: `screen` / `ebook` / `printer` / `prepress`. Default: `ebook` |

### Response 201

```json
{
  "id": "uuid",
  "fileName": "sop-packaging.docx",
  "fileType": "docx",
  "fileSize": 52428800,
  "status": "pending"
}
```

### Errors

| Code | When |
|---|---|
| 400 | File is not `.docx`/`.pdf`, or exceeds 100MB |
| 401 | Not authenticated |

---

## POST /api/transform

Trigger transformation for an uploaded file.

| Field | Value |
|---|---|
| Method | POST |
| Auth | Required |

### Request

```json
{ "conversionId": "uuid" }
```

### Response 200

```json
{
  "id": "uuid",
  "status": "compressing"
}
```

Transformation runs asynchronously. Poll status via `GET /api/transform/[id]`.

---

## GET /api/transform/[id]

Get transformation status and result.

### Response 200

```json
{
  "id": "uuid",
  "fileName": "sop-packaging.docx",
  "fileType": "docx",
  "fileSize": 52428800,
  "compressLevel": null,
  "compressedSize": null,
  "status": "completed",
  "imageCount": 12,
  "fullMd": "# SOP Packaging\n\nContent...",
  "textOnlyMd": "# SOP Packaging\n\nContent...",
  "images": [
    {
      "id": "uuid",
      "imageName": "packaging-img-001.png",
      "shortAlt": "Bag position on sealing machine",
      "description": "The image shows a 100g tea bag..."
    }
  ],
  "createdAt": "2026-03-25T10:00:00Z"
}
```

When `status` is `pending` / `compressing` / `processing`: `fullMd` and `textOnlyMd` are `null`.

---

## PUT /api/transform/[id]/edit

Save edited Markdown output.

### Request

```json
{
  "fullMd": "# Edited content...",
  "textOnlyMd": "# Edited content..."
}
```

`fullMd` may be `null` for PDF transformations.

### Response 200

```json
{ "success": true }
```

---

## GET /api/transform/[id]/download

Download a ZIP of all output files.

| Field | Value |
|---|---|
| Response | `application/zip` |

### ZIP contents — DOCX

```
[slug]-YYYYMMDD.zip
├── [slug]-full.md
├── [slug]-text-only.md
└── images/
    ├── [slug]-img-001.png
    └── ...
```

### ZIP contents — PDF

```
[slug]-YYYYMMDD.zip
└── [slug]-text-only.md
```

---

## GET /api/history

List transformation history (paginated).

### Query params

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | Int | 1 | Page number |
| `limit` | Int | 20 | Items per page |

### Response 200

```json
{
  "data": [
    {
      "id": "uuid",
      "fileName": "sop-packaging.docx",
      "fileType": "docx",
      "fileSize": 52428800,
      "compressedSize": 5242880,
      "imageCount": 12,
      "status": "completed",
      "createdAt": "2026-03-25T10:00:00Z"
    }
  ],
  "total": 15,
  "page": 1,
  "limit": 20
}
```
