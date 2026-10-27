# Payment Account Management (PAM) — Backend Build Guide

> **Audience:** an engineer taking over the `payment-account-management` workflow.
> **Scope:** backend only (registry → runner → engines → split feature → API output).
> The test UI lives at `app/payment-account-management/` and has its own `DESIGN.md`.
> **How to read this:** each section points at real code as `path:line`. Open the
> file alongside the doc — this guide explains *why* and *how it fits*, the code is
> the source of truth for *what*.

---

## 1. What this workflow does

PAM processes a payment-account dossier (mở / cập nhật / đóng / phong tỏa tài khoản).
A client uploads one or more documents (PDF or image); the workflow **classifies**
each document into a known type, **extracts** its fields, and (for some modes)
reconciles against bank-system data.

It is a **code-driven workflow** (a DAG orchestrated in TypeScript), not a linear
pipeline. It is registered under the `workflows` service as
`payment-account-management` and invoked exactly like the other workflows
(payroll-verify, lc-checker, …).

Two things make PAM different from a simple extract call:

1. **Fan-out over N documents** — one request → many per-document results.
2. **Document splitting (optional)** — one uploaded file may be a single scan that
   physically contains several documents concatenated together. When enabled, the
   workflow detects each sub-document, crops it into its own file, and processes it
   independently. This is the `enable_document_splitting` feature (§7).

---

## 2. Request → runner: how a call reaches the code

```
POST /api/v1/docs/workflows            (multipart/form-data)
  process   = "payment-account-management"
  files[]   = <uploaded files>
  metadata  = JSON { "mode": "open", "stage": "e2e", ... }
  header X-API-Key = <key>
```

- **Registry entry:** `lib/endpoints/registry.ts:570` (`'payment-account-management'`).
  It declares the endpoint's parameters (incl. `metadata`, the CSP params, and
  `enable_document_splitting` at `:601`). `isWorkflow: true` marks it code-driven.
- **Allowed file types:** `lib/endpoints/registry.ts:730` restricts PAM to
  **PDF + image only** (`ENDPOINT_ALLOWED_EXTENSIONS`). Excel/DOCX are rejected at
  upload. Do not loosen this without a reason — the extractor and the cropper both
  assume PDF/image.
- **Worker wiring:** the runner is registered in the workflow registry at
  `lib/pipelines/workflow-engine.ts:644` → `runPaymentAccountManagement`
  (imported at `:624`).
- **Params → runner:** the worker merges the profile's parameters and the request's
  `metadata` into `ctx.pipelineVars` before the runner runs. Profile-locked params
  (like `enable_document_splitting`, `csp_*`) are set once per profile in the admin
  UI and **override** request values. See `workflow-engine.ts` `buildContext`
  (the `profileEndpoint.parameters` merge, ~`:563`).

---

## 3. The runner: mode dispatch

Entry point: `lib/pipelines/workflows/payment-account-management/index.ts`.

- `runPaymentAccountManagement` parses `metadata` (`shared/metadata.ts:18`,
  `parseMetadata`), reads `metadata.mode`, and dispatches to a per-mode runner via
  `MODE_REGISTRY` (`index.ts:22`).
- Modes: `open | close | freeze | update` (`shared/types.ts:12`). Today only
  **`open`** and **`update`** have real runners; `close`/`freeze` are stubs.
- The result is wrapped in a standard envelope and passed to `completeWorkflow`
  (see §6 for the exact shape).

Each mode runner takes `(ctx, metadata)` and returns the mode payload. The shared
work (classify, extract, crop) lives in `shared/` so runners stay thin.

### The `open` runner — the reference implementation

`open-account/index.ts:51` (`runOpenAccount`). Read this first; `update-account`
is the same pattern with an extra MB03 required-document gate.

Flow (non-split):
1. `ensureFileIds(ctx)` — every document gets a stable `file_id` (caller-supplied
   or a generated `tmp_<uuid>`). **All mapping keys off `file_id`, never index or
   filename.**
2. `classifyAccountFiles` (`shared/classify-engine.ts:149`) — file-type gate: must
   have ≥1 PDF/image. Buckets the files.
3. `classifyDocumentTypes` (`classify-engine.ts:199`) — one LLM call per document →
   `{code, title, confidence, reason}`.
4. Stage branch:
   - `stage=classification` → return classifications + summary.
   - `stage=extraction` / `e2e` → `extractDocuments` then return per-document
     `{classification, extracted, …}`.

---

## 4. The shared engines

All under `shared/`. Each engine is **mode-agnostic** (the taxonomy/schema is
passed in) and **per-document isolated** (one document failing never aborts the
batch — it becomes an error/unknown result).

| File | Responsibility |
|---|---|
| `file-classify.ts` | Pure file-type bucketing (pdf/image/excel/other) by ext+MIME. |
| `documents.ts` | The document-type **taxonomy** (`ACCOUNT_DOCUMENTS`): code, indicators, disambiguation description, title template with `<slot>`s. |
| `classify-engine.ts` | LLM classification — both the non-split (`classifyDocumentTypes:199`) and split (`classifyDocumentSegments:426`) paths. |
| `extract-engine.ts` | LLM field extraction (`extractDocuments:70`) — one call per document, merges fixed fields, wraps each field as `{value, confidence}`. |
| `extract-schemas.ts` / `schemas.ts` | Per-code extraction schemas (which fields to read, fixed fields). |
| `prompts/doc-prompts.ts` | Prompt builders for classify / split-classify / extract. |
| `prompts/common-prompts.ts` | Shared prompt fragments + `{{var}}` interpolation. |
| `page-count.ts` | Split-only: reads a file's real page count (pdf-lib). |
| `crop.ts` | Split-only: crops a segment's pages into its own PDF. |
| `utils.ts` | Buffers, extension, diacritics, confidence parsing. |

The connector slugs the engines call: `ext-classifier` (classification),
`ext-data-extractor` (extraction). They are `ExternalApiConnection` rows; the
engine sends a single prompt string (`_prompt`) + the file via `enqueueSubStep`.

---

## 5. Document splitting (`enable_document_splitting`)

**Problem it solves:** a client uploads one scanned PDF that is actually several
documents stitched together (e.g. an account form on pages 1–3, an ID card on
pages 4 and 6). Without splitting, the extractor sees one blob and produces garbage.

**Turned on where:** it is a **profile-locked** boolean parameter
(`registry.ts:601`, `defaultLocked: true`). An admin enables it per API-key profile;
it is not a per-request flag. The runner reads it at `open-account/index.ts:84`:
```ts
const splitEnabled = ctx.pipelineVars.enable_document_splitting === true;
```
Only `open-account` is wired for split today (`update-account` stays non-split).

### The split pipeline (open-account/index.ts:86 onward)

When `splitEnabled` is true, the whole stage is handled inside the `if (splitEnabled)`
block (`:89`) and never falls through to the non-split path.

**Step A — page-count pre-pass.** For each file, `getPageCount` (`page-count.ts:28`)
reads the real page count via pdf-lib (images = 1 page, unreadable = `null`). This
is the *ground truth* used to validate the LLM.

**Step B — classify into page-ranged segments.** `classifyDocumentSegments`
(`classify-engine.ts:426`) asks the LLM to split ONE file into segments, each:
```
{ code, title, confidence, reason, pages: number[] }
```
`pages` are 1-based and may be **non-contiguous** (`[1,4]` for a 2-sided ID card
whose sides landed on non-adjacent pages).

**Step C — validate + retry (LangGraph-style, 3 attempts).** The LLM can hallucinate
pages, so we do NOT trust it blindly:
- `validateSegments` (`classify-engine.ts:325`) checks the returned pages against
  the real page count: no out-of-bounds page, no page in two segments, no page left
  unassigned.
- If invalid, we keep a `messages` thread (system prompt → the LLM's bad answer →
  a specific error message) and re-send it. Only the thread grows — it is the single
  dynamic parameter, rendered into one `_prompt` by `renderSplitPrompt`
  (`prompts/doc-prompts.ts:182`). See `SplitMessage` (`doc-prompts.ts:101`).
- Max attempts = `SPLIT_MAX_ATTEMPTS = 3` (`classify-engine.ts:32`). If all fail,
  `repairPartition` (`:385`) fixes the last answer (dedupe overlaps, bucket
  unassigned pages into an `unknown` segment) and the result is flagged with
  `warning`. The workflow always continues — it never dies on a bad split.

**Step D — segments become first-class documents.** Each segment is promoted to a
`ClassifiedDoc` (`classify-engine.ts:105`):
- generated `file_id` = `seg_<uuid>`,
- `name` = `<codeAcronym>-<slug(title)>` via `makeSegmentName` (`:125`) — a
  multi-part code collapses to an acronym (`can_cuoc_cong_dan` → `CCCD`), a
  single-part code is kept (`MB02`); `N/A` titles drop the tail.
- `source = { file_id, name, pages }` pointing back to the **parent** scan file.

**Step E — crop, then extract.** For extraction/e2e (`open-account/index.ts:106+`):
- `cropSegment` (`crop.ts:35`) builds a new PDF containing only the segment's pages
  (pdf-lib `copyPages`, 1-based→0-based, out-of-range skipped), uploads it to
  `"<operationId>/crops/<segId>.pdf"`. Image parents need no crop (return as-is).
- The cropped file is fed to the **unchanged** `extractDocuments`.
- Crops are throwaway: deleted in a `try/finally` via `backend.deleteMany` (non-fatal;
  the 7-day storage sweep is the backstop). Pattern mirrors payroll-verify's page
  splits.

> **Why crop instead of "tell the LLM to read only pages [1,4]"?** Because we already
> proved the model mishandles page bounds — that's the whole reason Step C exists.
> Cropping makes the page partition physically real instead of trusting the model twice.

---

## 6. API output format

Poll `GET /api/v1/operations/{id}`. The envelope (see `lib/pipelines/format.ts`):

```jsonc
{
  "name": "operations/<id>",
  "done": true,
  "result": {
    "extracted_data": { /* ← the PAM envelope, below */ },
    "content": "...", "usage": {...}, "download_url": "..."
  }
}
```

`result.extracted_data` is the PAM envelope; the mode payload sits under its
`result`:
```jsonc
{
  "request_id": "<id>",
  "skill_code": "payment-account-management",
  "status": "SUCCESS",
  "metadata": { "mode": "open", "stage": "classification", ... },
  "result": { "stage": "...", "documents": [ ... ], "summary": {...} }
}
```

### `documents[]` item — consistent across modes except `source`/`warning`

**Non-split** (classification stage):
```jsonc
{ "file_id":"tmp_a1", "name":"cccd.jpg",
  "classification":{ "code":"can_cuoc_cong_dan", "title":"Nguyễn Văn A - 038...",
                     "confidence":0.97, "reason":"..." } }
```

**Split** adds `source` (and `warning` when auto-repaired); the envelope adds
`split: true`:
```jsonc
{ "file_id":"seg_7f3c", "name":"CCCD-nguyen-van-a-038...",
  "classification":{ ... },
  "source":{ "file_id":"tmp_root", "name":"ho-so.pdf", "pages":[4,6] } }
```

Extraction/e2e items additionally carry `extracted` (and `error?`). Envelope shape
per stage (both modes identical apart from `split`):

| Stage | Envelope |
|---|---|
| classification | `{ stage, [split:true,] documents, summary }` |
| extraction / e2e | `{ stage, [split:true,] documents }` |

> Consistency rule to preserve: the only allowed per-mode differences in a
> `documents[]` item are `source` and `warning` (split-only). If you add a field,
> add it to both modes or gate it clearly.

---

## 7. How to run & test locally

Prereqs: PostgreSQL + Redis running, plus the worker.
```bash
npm run dev          # API on :2023
npm run worker:dev   # BullMQ worker (runs the workflow)
```
Then either use the test UI at `/payment-account-management`, or curl:
```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "X-API-Key: <key>" \
  -F process=payment-account-management \
  -F 'metadata={"mode":"open","stage":"e2e"}' \
  -F 'files[]=@dossier.pdf'
# → { "name": "operations/<id>" }; poll GET /api/v1/operations/<id>
```

**To test splitting:** the API key's profile must have `enable_document_splitting`
turned on (admin → profile → the PAM endpoint params). Then upload a single PDF that
concatenates several documents and run `stage=classification` first (fastest way to
see the segments), then `e2e`.

Type-check the whole change set with:
```bash
node node_modules/typescript/bin/tsc --noEmit
```

---

## 8. How to extend

- **Add a document type:** add an entry to `ACCOUNT_DOCUMENTS` (`documents.ts`) with
  a good `description` (the disambiguation rules are what the classifier reads). If
  it should be extractable, add its schema to `extract-schemas.ts`.
- **Add split support to `update-account`:** it currently gates on a required MB03
  document. You must decide how that gate interacts with segments from a mixed file
  before wiring `classifyDocumentSegments` + crop into it (mirror `open-account`).
- **Change retry count / validation strictness:** `SPLIT_MAX_ATTEMPTS`
  (`classify-engine.ts:32`) and `validateSegments` (`:325`).
- **Change crop storage/cleanup:** `crop.ts` (upload key) and the `finally` block in
  `open-account/index.ts`.

---

## 9. Gotchas / invariants (read before editing)

1. **`file_id` is the only join key** — never map documents by index or filename.
2. **Per-document isolation** — every engine catches per-file errors and returns an
   error/unknown result; do not let one bad file throw out of a `Promise.all`.
3. **Split never trusts LLM pages** — always validate against `getPageCount`; keep
   the retry + repair path.
4. **Crops are intermediates** — always cleaned in `finally`; do not persist them.
5. **`enable_document_splitting` is profile-locked** — it is not a request field;
   testing requires a profile with it enabled.
6. **PAM is PDF/image only** — enforced at `registry.ts:730`; the cropper and
   extractor assume it.
```
