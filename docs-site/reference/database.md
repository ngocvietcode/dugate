# Database Schema

## Database

| Info | Value |
|---|---|
| Engine | PostgreSQL |
| ORM | Prisma |
| DB name | `dugate` (configurable via `DATABASE_URL`) |

---

## Models

### Transformation

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | String (UUID) | No | `uuid()` | Primary key |
| `fileName` | String | No | | Original file name |
| `fileType` | String | No | | `docx` or `pdf` |
| `fileSize` | Int | No | | Original file size (bytes) |
| `compressLevel` | String | Yes | null | PDF: `screen`/`ebook`/`printer`/`prepress`. DOCX: null |
| `compressedSize` | Int | Yes | null | Compressed file size (bytes) |
| `originalPath` | String | No | | Path to uploaded file in `uploads/` |
| `fullMdPath` | String | Yes | null | Path to `full.md` (DOCX only) |
| `textOnlyMdPath` | String | No | | Path to `text-only.md` |
| `imagesDir` | String | Yes | null | Path to `images/` folder (DOCX only) |
| `imageCount` | Int | No | 0 | Number of images processed (PDF = 0) |
| `status` | String | No | `pending` | See status flow below |
| `errorMessage` | String | Yes | null | Error detail if `status = failed` |
| `createdBy` | String | No | | User ID from NextAuth session |
| `createdAt` | DateTime | No | `now()` | |
| `updatedAt` | DateTime | No | auto | |
| `deletedAt` | DateTime | Yes | null | Soft delete |

### ImageDescription

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | String (UUID) | No | `uuid()` | Primary key |
| `conversionId` | String | No | | FK → Transformation.id |
| `imageName` | String | No | | Image filename |
| `imagePath` | String | No | | Path to image file |
| `description` | String | No | | Detailed AI description |
| `shortAlt` | String | No | | Short alt text for Markdown |
| `createdAt` | DateTime | No | `now()` | |

### User

Admin UI identities, managed by the application (Drizzle ORM). There is **no NextAuth
adapter** — sessions are stateless JWTs, so no `Account` / `Session` tables exist.

Sign-in is SSO-only: no credential is stored. Columns are `id`, `username` (unique),
`role` (`ADMIN` / `OPS`), `provider`, `providerSub` (unique), `email`, `displayName`,
`createdAt`, `updatedAt`. The legacy `password` column is retained for rollback but is
no longer read or written.

---

## Relationships

```
User       1 ──── * Transformation
Transformation 1 ──── * ImageDescription
```

---

## Status Flow

```
pending → compressing → processing → completed
    │          │             │
    └──────────┴─────────────┴──→ failed
```

| Status | Meaning |
|---|---|
| `pending` | File uploaded, waiting to process |
| `compressing` | Ghostscript (PDF) or Sharp (DOCX images) running |
| `processing` | AI Vision API call in progress |
| `completed` | Done — output files ready |
| `failed` | Error at any step — see `errorMessage` |

---

## Indexes

| Index | Columns | Purpose |
|---|---|---|
| `idx_conversion_created_by` | `createdBy` | Filter history by user |
| `idx_conversion_status` | `status` | Filter by status |
| `idx_conversion_created_at` | `createdAt DESC` | Default sort |
| `idx_image_conversion_id` | `conversionId` | Join with Transformation |
