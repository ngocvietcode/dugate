# Implementation Plan — LA v2: tách kết quả OCR theo từng chứng từ (UI only)

Worktree: `d:\Jobs\dugate\.worktrees\la-v2-ocr-split` (branch `fix/la-v2-ocr-split`, base `feat/account-opening`).
Always use absolute paths / `git -C d:\Jobs\dugate\.worktrees\la-v2-ocr-split`. Relative paths land in the parent workspace `d:\Jobs\dugate`.

Scope guard: do NOT touch `lib/pipelines/**`, `app/api/**`, DB/schema, prompts, `app/loan-appraisal/**` (v1, including `app/loan-appraisal/types.ts`), or v1 components. Only files under `app/loan-appraisal-v2/**`, `components/loan-appraisal-v2/**`, `tests/loan-appraisal-v2/**`.

## Root cause (traced in code)

The v2 UI renders `result.grouping.document_views` verbatim (`IntakeWorkspace.tsx` → `<OcrResults views=… extraction=…>`). Those views are built by `buildDocumentPartyViews` in `lib/pipelines/workflows/loan-appraisal/grouping.ts` (backend, read-only for us):

1. One view per (file × doc_type_key). Multi-copy extraction is stored as `data.instances[i]` (`loan-appraisal-prompts.ts` ~L768), so all 4 ID cards are ONE view `CĂN CƯỚC · 40 trường`. `OcrResults` then groups views per file and prints `items.length loại chứng từ` → "2 loại chứng từ · 70 trường". No code splits by `instances[i]`.
2. Wrong party id: `isIdPath` matches any path containing `id_number`, so `old_id_number_9digits` is an id path too. In the multi-party branch, `containerToId.set(container, id)` runs for every id field and the LAST one wins → VNeID instances get `party_id = 145864944 / 163411615` (old CMND), shown as "CCCD 145864944".
3. Wrong name: `buildParticipants` creates a participant for the 9-digit id with `full_name` taken from `nameByFileType` = the FIRST name field of the whole (file, doc type) = instances[0] "NGUYỄN THỊ KIỀU ANH". `buildSegment` copies `participant.full_name` → instance 3 header shows Kiều Anh.
4. Wrong role: the 9-digit ids are not in the loan request seed → participant roles `['UNRESOLVED']` → "Chưa xác định vai trò".

Since backend must stay as-is, the fix is a client-side adapter that re-derives documents and identity from the segment FIELDS (which are correct per `instances[i]` prefix) instead of trusting `party_id` / `party_name` / `roles`.

## Design decisions

- New pure module `app/loan-appraisal-v2/lib/ocr-documents.ts` holds all logic; `OcrResults.tsx` becomes a thin renderer. Reason: jest runs `testEnvironment: 'node'`, `testMatch: **/tests/**/*.test.ts`, no React Testing Library — logic must be pure TS to be testable (same pattern as `selectors.ts` / `selectors.test.ts`).
- Split key = top-level `instances[N]` prefix of `field_path` (regex `/^instances\[(\d+)\]/`). This is the backend's canonical multi-copy wrapper for every doc type, so splitting is generic. Other arrays (`loans[0]`, `owners[0]`) and party prefixes (`borrower.`, `co_borrower.`) are NOT split — they are parts of one document. A view with fewer than 2 distinct instance indexes is "single-instance" and keeps its existing segments (grouping unchanged).
- Identity is read per document from its own fields by leaf name, never by index into another list: `full_name` leaf → name; leaf exactly `id_number` → primary id (fallback leaves `so_cccd`, `cccd`, `so_dinh_danh`, `dinh_danh_ca_nhan`, never anything containing `old_`); leaf starting with `old_id_number` or `cmnd`/`so_cmnd` → old 9-digit id; leaf `identification_type` → document kind.
- Role resolution by normalized id against `result.grouping.participants`, ignoring participants whose roles are only `UNRESOLVED`: primary id → old id → normalized name (only if exactly one resolved participant matches) → backend segment roles (if not just UNRESOLVED) → propagate from another document with the same person key → `UNRESOLVED`.
- Documents of the same person are kept adjacent: inside a split view, instances are stably sorted by first appearance of their person key (`primaryId ?? oldId ?? 'name:'+normalizedName`). Each instance remains its own card. For the fixture the order becomes instances 0, 2 (Kiều Anh), 1, 3 (Ánh Dương).
- Copy (Vietnamese):
  - Per-file header: `${documents} chứng từ (${types} loại) · ${fields} trường`; when documents === types: `${documents} chứng từ · ${fields} trường`. For ho_so_phap_ly.pdf (4 ID instances + 1 other type) that is "5 chứng từ (2 loại) · 70 trường" — the user's "4 chứng từ" example counted only the ID cards; the count must be real documents.
  - Card subtitle: `${files} file · ${documents} chứng từ (${types} loại) đọc được` (+ existing ` · N chứng từ lỗi`), same "drop parenthetical when equal" rule.
  - Document disclosure summary: `${kindLabel} · ${name} · ${n} trường` (name omitted when absent).
  - Kind label from `identification_type`: contains `vneid` or `điện tử` (case/diacritic-insensitive) → `VNeID`; otherwise the trimmed extracted text (`Căn cước`, `Căn cước công dân`); missing → `${detected_form_name || doc_type_label} · bản ${i+1}`.
  - Segment header ID: `CCCD ${primaryId}` when 12 digits, `CMND ${id}` when 9 digits, plus secondary muted `CMND cũ ${oldId}` when an old id exists and differs. Never show the old id as the main number.

## Steps

- [ ] 1. Create the pure adapter module `app/loan-appraisal-v2/lib/ocr-documents.ts`.
      Export:
      - `normalizeIdNumber(value: unknown): string | null` — digits only; return when length ≥ 9 else null (`'0360 9700 2872'` → `036097002872`, `'145 864 944'` → `145864944`).
      - `normalizePersonName(value: unknown): string` — NFD, strip combining marks, `đ/Đ`→`D`, uppercase, collapse whitespace, trim.
      - `instanceIndexOf(path: string): number | null`.
      - `readIdentity(fields: DocumentFieldValue[]): OcrIdentity` → `{ fullName: string|null; idNumber: string|null; oldIdNumber: string|null; identificationType: string|null }` using the leaf rules above (leaf = last `.` segment with any `[n]` stripped).
      - `resolveRoles(identity, participants: ParticipantGroup[], fallback: ParticipantRole[]): ParticipantRole[]` with the order in Design decisions (without cross-document propagation; that happens in `buildOcrFileGroups`).
      - `documentKindLabel(identificationType: string|null, fallback: string): string`.
      - `fallbackViews(extraction: ExtractedDoc[]): DocumentPartyView[]` and its `flatten` helper, MOVED verbatim from `OcrResults.tsx`.
      - `buildOcrFileGroups(views: DocumentPartyView[], participants: ParticipantGroup[]): OcrFileGroup[]` where
        `OcrSegment = { name: string|null; idNumber: string|null; oldIdNumber: string|null; roles: ParticipantRole[]; fields: DocumentFieldValue[] }`,
        `OcrDocument = { key: string; file_name; doc_type_key; doc_type_label; title: string; instance_index: number|null; field_count: number; person_key: string|null; segments: OcrSegment[] }`,
        `OcrFileGroup = { file_name; documents: OcrDocument[]; document_count; type_count; field_count }`.
        Logic: group views by `file_name` (preserve order). For each view, collect all fields of all segments. If ≥2 distinct `instanceIndexOf` values → one `OcrDocument` per instance index (one `OcrSegment` built from that instance's fields via `readIdentity`/`resolveRoles`, fallback roles = roles of the backend segment that contains those fields if any), sorted by person first appearance; fields without an instance prefix (if any) go to an extra document titled `${view label} · Thông tin chung`. Otherwise → one document whose segments map 1:1 from the backend segments, each corrected with `readIdentity(segment.fields)` (name = identity.fullName ?? segment.party_name; id = identity.idNumber ?? normalizeIdNumber(segment.party_id); roles via `resolveRoles(…, segment.roles)`). `title` for single-instance = `detected_form_name || doc_type_label` (unchanged). `field_count` = number of fields in the document; `type_count` = distinct `doc_type_key` in the file. After all files: propagate resolved roles to any segment still `UNRESOLVED` whose person key matches a resolved segment.
      - `documentCountLabel(documents: number, types: number): string` returning `N chứng từ (M loại)` or `N chứng từ`.
      Import types from `@/app/loan-appraisal/types` (read-only use). Use `safeArray` from `./selectors`.
      Files: `d:\Jobs\dugate\.worktrees\la-v2-ocr-split\app\loan-appraisal-v2\lib\ocr-documents.ts`
      Verify: `npx tsc --noEmit` (cwd = worktree) — no errors.

- [ ] 2. Add unit tests `tests/loan-appraisal-v2/ocr-documents.test.ts` (depends on 1), following the fixture-builder style of `tests/loan-appraisal-v2/selectors.test.ts`.
      Fixture `ho_so_phap_ly.pdf` modelled on the user report, reproducing the BUGGY backend output:
      - View A `doc_type_key: 'id_card'`, label `Căn cước`, fields under `instances[0..3]` exactly as in the report (instance 0: full_name `NGUYỄN THỊ KIỀU ANH`, identification_type `Căn cước`, id_number `033199002299`…; instance 1: `TRẦN ÁNH DƯƠNG`, `Căn cước công dân`, `036097002872`…; instance 2: `Nguyễn Thị Kiều Anh`, `Căn cước công dân điện tử (VNeID)`, `033199002299`, old_id_number_9digits `145 864 944`, registered_phone_number; instance 3: `Trần Ánh Dương`, VNeID, id_number `0360 9700 2872`, old `163 411 615`). Segments as the backend emits them: party_id `033199002299` roles `[BORROWER, COLLATERAL_OWNER]`, `036097002872` `[CO_BORROWER]`, `145864944` name `NGUYỄN THỊ KIỀU ANH` roles `[UNRESOLVED]`, `163411615` name `NGUYỄN THỊ KIỀU ANH` roles `[UNRESOLVED]`.
      - View B single-instance `doc_type_key: 'loan_request'` with `borrower.*` and `co_borrower.*` fields in 2 segments.
      - Participants: `033199002299` BORROWER+COLLATERAL_OWNER, `036097002872` CO_BORROWER, `145864944` and `163411615` UNRESOLVED with name `NGUYỄN THỊ KIỀU ANH`.
      Assertions:
      - 1 file group; `document_count === 5`, `type_count === 2`, `field_count` = total fields of both views; `documentCountLabel(5, 2) === '5 chứng từ (2 loại)'`, `documentCountLabel(1, 1) === '1 chứng từ'`.
      - The id_card view yields 4 documents, each with its own `field_count` (sum = view fields) and order instance 0, 2, 1, 3.
      - Per card: instance 0 → name `NGUYỄN THỊ KIỀU ANH`, id `033199002299`, oldId null, roles `[BORROWER, COLLATERAL_OWNER]`, title starts with `Căn cước ·`; instance 1 → `TRẦN ÁNH DƯƠNG`, `036097002872`, `[CO_BORROWER]`, title `Căn cước công dân · …`; instance 2 → `Nguyễn Thị Kiều Anh`, id `033199002299`, oldId `145864944`, roles `[BORROWER, COLLATERAL_OWNER]`, title starts `VNeID ·`; instance 3 → name `Trần Ánh Dương`, id `036097002872`, oldId `163411615`, roles `[CO_BORROWER]`.
      - loan_request stays 1 document with 2 segments, title unchanged.
      - Helpers: `normalizeIdNumber('0360 9700 2872')`, `normalizeIdNumber('12')` → null; `normalizePersonName('Trần Ánh Dương') === normalizePersonName('TRẦN ÁNH DƯƠNG')`; `resolveRoles` falls back to old id, then to a unique name match, then to fallback roles, else `['UNRESOLVED']`.
      - Generic split: a non-ID doc type (e.g. `vehicle_registration` with `instances[0..1]` and no identification_type) yields 2 documents titled `<label> · bản 1` / `bản 2`; a view with only `instances[0]` stays one document.
      - `fallbackViews` + `buildOcrFileGroups` on raw extraction `{ data: { instances: [a, b] } }` with no participants yields 2 documents; roles propagate across same person key when one segment has resolved fallback roles.
      Files: `d:\Jobs\dugate\.worktrees\la-v2-ocr-split\tests\loan-appraisal-v2\ocr-documents.test.ts`
      Verify: `npx jest tests/loan-appraisal-v2` (cwd = worktree) — all suites pass including the new one.

- [ ] 3. Rewire `OcrResults.tsx` to render per-document groups and pass participants from `IntakeWorkspace.tsx` (depends on 1).
      - `OcrResults` props become `{ views, extraction, participants }` (`participants: ParticipantGroup[]`). Remove local `flatten`/`fallbackViews` (import from `ocr-documents`). `const fileGroups = useMemo(() => buildOcrFileGroups(views.length > 0 ? views : fallbackViews(extraction), participants), …)`.
      - CardHeader subtitle: `${fileGroups.length} file · ${documentCountLabel(totalDocs, totalTypes)} đọc được${errors…}` (totalTypes = sum of per-file `type_count`).
      - Per-file `<article>` subtitle: `${documentCountLabel(g.document_count, g.type_count)} · ${g.field_count} trường`.
      - One `<Disclosure>` per `OcrDocument`, `key={doc.key}`, `summary={`${doc.title} · ${doc.field_count} trường`}`.
      - JSON mode: raw = `rawByKey.get(file\u0000docType)`; when `doc.instance_index !== null` and raw has `instances` array, show `raw.instances[doc.instance_index]`.
      - `Segment` takes `OcrSegment`: name `segment.name ?? 'Chưa đọc được tên'`; roles badge from `segment.roles` via `ROLE_LABEL` (empty → `ROLE_LABEL.UNRESOLVED`); id line `CCCD`/`CMND` + `segment.idNumber` (12 vs 9 digits); secondary muted `CMND cũ {oldIdNumber}` when present. Keep existing classes, `FOCUS_RING`, aria attributes.
      - In `IntakeWorkspace.tsx` pass `participants={safeArray(result?.grouping?.participants)}`.
      Files: `d:\Jobs\dugate\.worktrees\la-v2-ocr-split\components\loan-appraisal-v2\intake\OcrResults.tsx`, `d:\Jobs\dugate\.worktrees\la-v2-ocr-split\components\loan-appraisal-v2\intake\IntakeWorkspace.tsx`
      Verify: `npx tsc --noEmit` — no errors; `npx jest tests/loan-appraisal-v2` — still green.

- [ ] 4. Full verification and scope check (depends on 1–3).
      Run in the worktree: `npx jest tests/loan-appraisal-v2`, `npx tsc --noEmit`, `npx next build` (ESLint is not configured — skip lint). Then `git -C d:\Jobs\dugate\.worktrees\la-v2-ocr-split diff --stat feat/account-opening` must list only `app/loan-appraisal-v2/lib/ocr-documents.ts`, `components/loan-appraisal-v2/intake/OcrResults.tsx`, `components/loan-appraisal-v2/intake/IntakeWorkspace.tsx`, `tests/loan-appraisal-v2/ocr-documents.test.ts`. Commit locally on `fix/la-v2-ocr-split`; do not push.
      Files: none new.
      Verify: all three commands exit 0; diff stat limited to the four files above.

## Notes / assumptions

- `selectors.ts` and `operation-mapper.ts` were inspected and are NOT involved: `operation-mapper.ts` only passes `extracted_data` through, and `selectors.ts` has no OCR grouping. No change needed there; `MasterDataPanel.tsx` / `IntakeTable.tsx` consume other backend structures and are out of scope.
- The backend `old_id_number_9digits` mis-pick (grouping.ts `containerToId` / `isIdPath`) still affects backend artefacts (participants list contains extra UNRESOLVED 9-digit participants, master data/cross-check). Fixing that is a backend change and was explicitly excluded; mention it in the final summary as a follow-up.
