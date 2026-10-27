# Per-document OCR cards for multi-instance Loan Appraisal V2 results

The V2 intake OCR panel used to show one card per backend `document_view`, so all four ID cards in `ho_so_phap_ly.pdf` ended up in a single "Căn cước · 40 trường" group. Their headers also came from the backend `party_id`/`party_name`, which is how the VNeID instances got the old 9-digit CMND as their ID, the wrong name, and "Chưa xác định vai trò". The fix adds a client-side adapter (`app/loan-appraisal-v2/lib/ocr-documents.ts`). It splits any view whose fields carry two or more distinct `instances[N]` prefixes into one document per instance, reads each instance's identity from its own fields, and resolves roles against `grouping.participants` by normalized `id_number`, then the old 9-digit ID, then a unique name match. The diff touches only V2 UI and V2 tests. The backend shape is unchanged. Watch for: single-instance cards now take their header name/ID from the first matching field instead of the backend `party_name`/`party_id` (likely, non-blocking), non-numeric IDs such as passports lose their header ID (likely, non-blocking), and the top-level subtitle adds up type counts per file (confirmed, minor).

**Verdict**: APPROVED

## High-level view

The split is driven by structure, not by person or document type. Fields are grouped by their `instances[N]` path prefix, whichever backend segment they arrived in. Any doc type with two or more instances is split. Fields without an instance prefix become a "Thông tin chung" card. Views with fewer than two instances go through a single-document path that keeps the backend segments. A generic vehicle-registration test and a single-instance ID test cover both paths.

The header bugs are fixed at their root in the UI. The backend grouping attached the wrong `party_id`/`party_name` to the VNeID segments, and the old UI rendered those values verbatim. The new code reads `full_name`, `id_number` (digits only), `old_id_number_9digits` and `identification_type` from each instance's own fields. The old number shows only as a secondary "CMND cũ" detail. Roles come from a lookup against resolved participants by normalized ID, not from array position. A final pass copies roles across documents that share a person key, so a VNeID card inherits the physical card's role. On the fixture, instance 3 renders as "VNeID · Trần Ánh Dương", ID 036097002872, CMND cũ 163411615, role Người đồng vay.

Headers now count documents. The fixture file reads "5 chứng từ (2 loại) · 70 trường": four ID instances plus one loan request. That is correct; the user's "4 chứng từ" example counted only the ID cards. JSON mode shows each card's own `instances[N]` slice of the raw extraction.

The diff touches four files, all within the allowed scope: `app/loan-appraisal-v2/lib/ocr-documents.ts`, `components/loan-appraisal-v2/intake/{OcrResults,IntakeWorkspace}.tsx`, and `tests/loan-appraisal-v2/ocr-documents.test.ts`. It touches nothing under `lib/pipelines/**`, `app/api/**`, DB/schema, prompts or `app/loan-appraisal/**`. The only link to V1 is a read-only type import. The verification evidence is adequate: jest 8 suites / 61 tests, `tsc --noEmit` exit 0 and `next build` exit 0 are recorded in both the commit message and `verification.md`.

<details>
<summary>Issues (3)</summary>

1. **Single-instance header source changed** — (likely, non-blocking) `singleDocument` → `buildSegment` takes the header from `identity.fullName ?? backend.party_name`, where `identity` is the first `full_name`/`id_number` leaf in the segment. If a backend segment contains nested people (spouse, collateral owner), the header can show the wrong person. For single-instance views, prefer the backend `party_name`/`party_id` and use the field-derived values only as a fallback.
2. **Non-numeric IDs dropped from header** — (likely, non-blocking) `normalizeIdNumber` strips everything except digits and returns null below 9 digits. Passport-style IDs (e.g. `C1234567`) therefore show no ID in the header and cannot match participants by ID. Keep the raw alphanumeric value when digit-normalization fails.
3. **Top-level type count summed per file** — (confirmed, minor) `OcrResults` adds up `type_count` across files. If the same doc type appears in two files, the subtitle reports "(2 loại)" for one type. Compute it as a distinct set of `doc_type_key` across all groups.

</details>

<details>
<summary>Details</summary>

### Instance-prefix splitting in `splitView`

`splitView` walks every field of every backend segment and buckets it by `instances[N]`. It records which backend segment owned each field, so that segment's roles can serve as the last fallback. The bucketing ignores segment boundaries, so it holds up even though the backend currently produces one segment per instance with the wrong party metadata. Cards are then reordered so that one person's documents sit next to each other (fixture order 0, 2, 1, 3). This is a display choice; reviewers expecting page order will see a different sequence. Fields without an instance prefix become an extra "Thông tin chung" card that counts as a document in "N chứng từ", which slightly inflates the count for views that mix shared and per-instance fields.

### Identity and role resolution

`readIdentity` matches on the last path segment. Any `old_id_number*`/`cmnd`/`so_cmnd` leaf goes to `oldIdNumber`. Only the leaves in `PRIMARY_ID_LEAVES` can become `idNumber`, so the 9-digit number can no longer be promoted to the main ID. `resolveRoles` filters out UNRESOLVED participants before matching. This matters because the backend emits phantom participants `145864944`/`163411615` with UNRESOLVED roles, and the filter stops them from capturing the VNeID cards. The name fallback applies only when exactly one participant matches, so a duplicate name cannot assign a role. Cross-document propagation keys on normalized ID first and falls back to `name:<NORMALIZED>` only when a document has no ID at all. Two different people with the same name and no extracted ID would share roles. That case is narrow.

Single-instance views keep resolved backend roles and re-resolve only UNRESOLVED ones. This fixes the regression noted in `verification.md`. The header name/ID for those views, however, now comes from `readIdentity` over the segment's fields rather than from the backend's `party_name`/`party_id`:

```ts
name: identity.fullName ?? backend?.party_name ?? null,
idNumber: identity.idNumber ?? normalizeIdNumber(backend?.party_id),
```

For a loan-request segment whose fields include a nested `spouse.full_name` or `collateral.owner.id_number` ahead of the borrower's own, the header would name the wrong person. The fixture uses flat `borrower.*` fields, so the tests don't exercise this.

### Test coverage

`ocr-documents.test.ts` builds the buggy backend output for the user's exact file: one merged view, with VNeID segments carrying the old ID, the wrong name and UNRESOLVED. It asserts per-card name, normalized ID, old ID, role and title for all four instances, plus the "5 chứng từ (2 loại)" count and the 70-field total. Generic splitting, single-instance passthrough, the raw-extraction fallback and role propagation are covered. Not tested: the `OcrResults` render itself (subtitle, the "CMND cũ" chip, per-instance JSON slicing in `rawFor`), the "Thông tin chung" shared-field card, alphanumeric IDs, and single-instance segments with nested person fields.

</details>

<details>
<summary>File map</summary>

- `app/loan-appraisal-v2/lib/ocr-documents.ts`: new adapter for splitting, identity reading, role resolution, count labels; `fallbackViews` moved here from `OcrResults`.
- `components/loan-appraisal-v2/intake/OcrResults.tsx`: renders `OcrFileGroup`/`OcrDocument`, adds the "CMND cũ" chip, document-count headers, per-instance JSON.
- `components/loan-appraisal-v2/intake/IntakeWorkspace.tsx`: passes `grouping.participants` to `OcrResults`.
- `tests/loan-appraisal-v2/ocr-documents.test.ts`: new fixture-based tests.

Full diff: `git -C d:\Jobs\dugate\.worktrees\la-v2-ocr-split --no-pager diff feat/account-opening...HEAD`

</details>
