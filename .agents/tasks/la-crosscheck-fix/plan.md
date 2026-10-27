# Implementation Plan — LA cross-check fix (B1–B8, C1–C8)

Source of truth: `d:\Jobs\dugate\.agents\tasks\la-v2-crosscheck-review.md`.

## Ground rules (read first)

- Work ONLY in the worktree `d:\Jobs\dugate\.worktrees\la-crosscheck-fix` (branch `fix/la-crosscheck`, base `c6f0cf7`). Use absolute paths; relative paths land in the parent workspace. Use `git -C d:\Jobs\dugate\.worktrees\la-crosscheck-fix ...`.
- Do NOT modify anything under `app/loan-appraisal/**` except additive type fields in `app/loan-appraisal/types.ts`. The v1 UI must still compile.
- Backend output changes are additive only: existing fields (`side.documents` = doc_type_label set, `side.value`, `field.party_id`, `subject_label`, `summary.{compared,matched,mismatched}`, `participant.id_number`) keep their meaning. No DB/schema, prompt, or route contract changes.
- Follow CLAUDE.md: surgical changes, match existing style (Vietnamese comments, `safeArray`, pure helpers).

## Verification commands (discovered during exploration)

Run from `d:\Jobs\dugate\.worktrees\la-crosscheck-fix`:

- Targeted tests: `npx jest tests/loan-appraisal tests/loan-appraisal-v2 tests/pipelines/loan-appraisal-cancel` (baseline: 19 suites / 201 tests pass).
- IMPORTANT: inside the worktree do NOT pass `--testPathIgnorePatterns .worktrees` — the worktree's own absolute path contains `.worktrees`, so that flag ignores every test ("0 matches", exit 1). That flag is only for runs from the parent repo root.
- Full suite: `npx jest` (in the worktree).
- Typecheck: `npx tsc --noEmit` (baseline: exit 0). tsconfig includes `**/*.ts`, so this also typechecks `worker.ts` and `lib/**` — it is the worker typecheck.
- Next build: `npx next build`.
- Worker bundle: `npm run worker:build` (produces `worker.js`, gitignored; leave it or delete it, never commit it).
- Jest is `testEnvironment: node`, `testMatch: **/tests/**/*.test.ts` — no React component tests. Put all UI logic in pure modules under `app/loan-appraisal-v2/lib/` and test those.

## Design decisions

- D1 Shared normalizers live in `lib/pipelines/workflows/loan-appraisal/evidence.ts` (already imported by grouping, cross-check-matrix, master-data-dimension): `foldVietnamese`, `normalizePersonId`. One place so Đ handling and ID rules cannot drift.
- D2 Cross-check source = `file_name × doc_type_key × instances[N]` (N from field-path prefix `instances[N]`; `null` when absent). This mirrors how extraction stores multiple copies (`loan-appraisal-prompts.ts` ~L768 wraps copies in `data.instances[i]`) and how v2 `ocr-documents.ts` splits documents.
- D3 Aliases: the old 9-digit CMND is never a participant id when the same container also has a primary id. It becomes `ParticipantGroup.alias_ids` (new optional field). A container whose ONLY id is a 9-digit number that is a known alias is mapped to the canonical 12-digit participant.
- D4 Additive output fields: `ParticipantGroup.alias_ids?: string[]`; `CrossCheckValueSide.file_names?: string[]` and `CrossCheckValueSide.sources?: CrossCheckSideSource[]`; `CrossCheckFieldResult.subject_roles?: ParticipantRole[]`; `CrossCheckMatrixResult.summary.insufficient?: number`. Mirror each in `app/loan-appraisal/types.ts` as optional.
- D5 New compare kinds `address`, `date`, `gender` (the unused old `date` digits-only kind is replaced by a real parser).
- D6 UI: no restructuring of the workflow; backend and UI are coupled (UI consumes B8/D4 fields) so one ordered plan in the existing loop is enough. The UI must also degrade gracefully for OLD stored results (no `sources`, alias 9-digit party rows), so client-side resolution stays even after the backend fix.

## Backward-compat risks for v1 (call out in review)

- `cross_check_matrix.fields` gains rows (date_of_birth, gender, issue_date) and alias rows disappear; `summary` counts change. v1 `CrossCheckMatrixPanel.tsx` renders rows generically (`sides[0..1]`, `documents`) so it keeps working; values become more correct, not different in shape.
- `participants` loses the 9-digit alias entries and `full_name` may change to the same-container name. v1 `OcrResultPanel`/`MasterDataDimensionPanel` read `party_id`/`party_name` generically — fewer, correct segments.
- `master-data.ts` / `dossier-checks.ts` get Đ folding — only makes matching more lenient for Đ/đ; no shape change.
- Name/address MATCH may now appear where v1 previously showed MISMATCH (intended fix).

---

## Backend

- [ ] 1. Shared normalizers in evidence.ts (B4, B7 core).
      In `lib/pipelines/workflows/loan-appraisal/evidence.ts` add and export:
      - `foldVietnamese(value: string): string` → `value.replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '')` (Đ replaced BEFORE NFD strip).
      - `normalizePersonId(value: unknown): string | null` mirroring v2 `normalizeIdNumber` (`app/loan-appraisal-v2/lib/ocr-documents.ts`): fold, uppercase, strip a leading label `^(SO|NO|CCCD|CMND|CC|ID|PASSPORT)\s*[:.]?\s*` only when the rest still contains a digit, remove `[\s.\-/_:]`; digits-only → needs ≥9 chars; alphanumeric `^[A-Z0-9]{6,20}$` with ≥1 digit → keep; else null.
      - Change `normalizeDocumentId` to call `foldVietnamese` instead of its inline NFD strip (so "ĐT-123" → "DT123", previously "T123").
      Files: evidence.ts
      Tests: new `tests/loan-appraisal/normalizers.test.ts`: `foldVietnamese('ĐỖ VĂN ĐẠT') === 'DO VAN DAT'`; `normalizePersonId('0360 9700 2872') === '036097002872'`, `('145 864 944') === '145864944'`, `('C1234567') === 'C1234567'`, `('c 123-4567') === 'C1234567'`, `('CCCD: 033199002299') === '033199002299'`, `('Không có') === null`, `('AB12') === null`, `('12345678') === null`; `normalizeDocumentId('Số: AA-08798136') === 'AA08798136'` (unchanged), `normalizeDocumentId('Đ12') === 'D12'`.
      Verify: `npx jest tests/loan-appraisal` passes (existing grouping GCN tests still pass).

- [ ] 2. Grouping: primary id per container, aliases, same-container name, passports (B1, B2, B7).
      In `lib/pipelines/workflows/loan-appraisal/grouping.ts`:
      - `isIdPath`: return false when the path matches `/old_id|9digits|cmnd_9|cmnd_cu/` (check first). Keep existing positives; add passport leaves `passport_number|passport_no|so_ho_chieu`. Remove the bare `p.includes('id_number')` fallback only if it would re-admit `old_id_number_9digits` — the exclusion check first makes it safe, so keep it.
      - Add `isOldIdPath(path)` = `/old_id|9digits|cmnd_9|cmnd_cu/` on lowercased path.
      - Replace `idDigits` with `normalizePersonId` everywhere in this file (seedRoles `pickId`, owner ids, buildParticipants, buildDocumentPartyViews).
      - Add helper `containerIdentity(records)` keyed by `${file}\u0000${docType}\u0000${containerKey(path)}` returning `{ primary: string|null, old: string|null, name: string|null }`: primary = the id from `isIdPath` records, preferring a 12-digit digits-only value, then any other (first seen wins among equals) — NOT "last seen"; old = `normalizePersonId` of an `isOldIdPath` record; name = first `isNamePath` record in the SAME container (respect `OTHER_SUBJECT_PATHS`-like exclusion: skip paths containing `signator|representative|spouse|reference_person|father|mother`).
      - Build `aliasToPrimary: Map<old, primary>` from containers having both. Canonicalize helper `canon(id) = aliasToPrimary.get(id) ?? id`.
      - `buildParticipants`: bucket by `canon(id)` per id record; bucket name = that record's container name (B2) — drop `nameByFileType`. `full_name` = seed name if it contains a non-ASCII letter, else the first bucket name containing diacritics, else seed name, else first bucket name. Add `alias_ids: [...]` (aliases whose primary is this id; omit property when empty). Keep sort and the `!hasLoanRequest` note; change the 9-digit note to fire only for participants whose id is 9 digits and not linked via alias.
      - `seedRoles`: canonicalize seeded ids through `aliasToPrimary` (compute aliases before seeding; pass map in).
      - `buildDocumentPartyViews`: `idsInDoc` = set of `canon(primary)` per container (old ids excluded via isIdPath). In the multi-id branch, `containerToId` uses `containerIdentity(...).primary` (canonicalized), fallback `canon(old)` when the container has no primary. `lookup` resolves participants by id and alias.
      Files: grouping.ts, lib/pipelines/workflows/loan-appraisal/types.ts (`ParticipantGroup.alias_ids?: string[]`), app/loan-appraisal/types.ts (same optional field).
      Tests (extend `tests/loan-appraisal/grouping.test.ts`, fixture = the 4 `instances[N]` of `ho_so_phap_ly.pdf` from `tests/loan-appraisal-v2/ocr-documents.test.ts` inst0..inst3 converted to EvidenceRecords under doc_type `id_card`):
      - participants are exactly `033199002299` and `036097002872`; `alias_ids` = `['145864944']` / `['163411615']`.
      - participant names: `NGUYỄN THỊ KIỀU ANH` and `TRẦN ÁNH DƯƠNG` (not both Kiều Anh).
      - document view segments: instance 2 fields carry `party_id 033199002299`, instance 3 → `036097002872`.
      - with an ĐNVV (`loan_request`, `borrower.*`/`co_borrower.*`) in another file, roles BORROWER / CO_BORROWER land on the 12-digit participants.
      - passport-only person (`instances[0].passport_info.passport_number = 'C1234567'`, `personal_info.full_name`) becomes a participant with id `C1234567`.
      Verify: `npx jest tests/loan-appraisal` passes; `npx tsc --noEmit` exit 0.

- [ ] 3. Cross-check matrix: per-instance sources, normalizers, new fields, side sources (B3, B4, B5, B6, B7, B8).
      In `lib/pipelines/workflows/loan-appraisal/cross-check-matrix.ts`:
      - `stripDiacritics` → delegate to `foldVietnamese` (B4); `parseNames` and text kind use it (also fix `\bvà\b` split which now never matches after fold — keep `\bva\b`).
      - `CompareKind` adds `'address' | 'gender'`; `permanent_address` spec → `kind: 'address'`; `business_address` → `kind: 'address'`.
      - `normalizeAddress(raw)` (B5): fold, lowercase, replace `[^a-z0-9]+` with space, tokenize; remove multi-word admin prefixes `thanh pho`, `thi tran`, `thi xa` then single tokens `xa, phuong, huyen, quan, tinh, tp, tx, tt, p, q`; strip leading zeros of numeric tokens (`05`→`5`); join with space; null if < 2 chars. Comment why the dictionary exists.
      - `parseDateKey(raw)` (B6): trim; ISO `^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})` (optional time suffix) → y,m,d; else first `(\d{1,2})\D+(\d{1,2})\D+(\d{4})` → d,m,y ("5/10/1999", "05-10-1999", "Ngày 05 tháng 10 năm 1999"); validate month 1–12, day 1–31 and real calendar date via `Date.UTC` round-trip; return `YYYY-MM-DD`; otherwise null (never guess, 2-digit years → null). Export it for tests.
      - `normalizeGender(raw)`: fold+lower+trim; `nam|male|m` → `M`; `nu|female|f` → `F`; else null.
      - `normalizeKey`: route `date` → `parseDateKey`, `gender` → `normalizeGender`, `address` → `normalizeAddress`.
      - `STANDARD_FIELDS` additions (dimension `party`, group `Pháp lý`), placed after `id_number`:
        - `date_of_birth` 'Ngày sinh', kind date, leaf `/^(date_of_birth|dob|birth_date|ngay_sinh)$/`, exclude `OTHER_SUBJECT_PATHS`.
        - `gender` 'Giới tính', kind gender, leaf `/^(gender|sex|gioi_tinh)$/`, exclude `OTHER_SUBJECT_PATHS`.
        - `id_issue_date` 'Ngày cấp CCCD/CMND', kind date, leaf `/^(issue_date|id_issue_date|id_issued_date|ngay_cap)$/`, requirePath `/identification_details|id_issue|id_issued|ngay_cap|^(borrower|co_borrower|collateral_owner)\./`, exclude `${OTHER_SUBJECT_PATHS.source}|legal_info|passport|registration|notary|cert`.
      - `id_number` spec leaf adds `passport_number|passport_no|so_ho_chieu` (B7); keep the `old_id_number|9digits|cmnd_9` exclusion.
      - `clusterSides` (B3): source key = `${file}\u0000${docType}\u0000${instanceIndexOf(path) ?? '-'}` where `instanceIndexOf` parses `^instances\[(\d+)\]`; `ambiguous` computed per that source. Cluster tracks per-source detail. Each side keeps `value`, `documents` (unchanged: set of doc_type_label), `evidence_ids`, and adds `file_names` (unique) and `sources: CrossCheckSideSource[]` = `{ file_name, doc_type_key, doc_type_label, instance_index: number|null, instance_label: string|null, evidence_ids }` (B8).
      - `instance_label`: from the evidence registry, the `identification_type` leaf in the same file×docType×instance: folded contains `vneid` or `dien tu` → `'VNeID'`, else the raw value; when no identification_type and instance_index !== null → `bản ${index + 1}`; else null. Build a `Map<sourceKey, label>` once in `buildCrossCheckMatrix` and pass into `clusterSides`.
      - Party loop: also include records whose party is an alias of the participant (`participant.alias_ids`) for old view shapes; set `subject_roles: participant.roles` on party rows.
      - `summary.insufficient` = count of INSUFFICIENT rows (additive).
      Files: cross-check-matrix.ts, lib/.../types.ts (add `CrossCheckSideSource`, optional `file_names`, `sources`, `subject_roles`, `summary.insufficient`), app/loan-appraisal/types.ts (same, optional).
      Tests (extend `tests/loan-appraisal/cross-check-matrix.test.ts`; add an end-to-end describe that runs `buildEvidenceRegistry`-shaped records → `buildDossierGrouping` → `buildCrossCheckMatrix`):
      - Scenario A (only the 4 instances): `summary.compared > 0`; for 033199002299 full_name/id_number/permanent_address/date_of_birth/gender/id_issue_date are MATCH (hard copy vs VNeID); no row has `party_id` 145864944/163411615; subject_label for 036097002872 is `TRẦN ÁNH DƯƠNG`.
      - Scenario B (+ ĐNVV in `dnvv.pdf` with `xã/huyện/tỉnh`, `P./Thành phố`, unaccented name): permanent_address and full_name MATCH for both people.
      - Scenario C/D: `ĐỖ VĂN ĐẠT` vs `Do Van Dat` MATCH; `Thôn Văn Ó, Đại Đồng` vs `Thon Van O, Dai Dong` MATCH.
      - A real mismatch inside one file still detected: instance 0 DOB `05/10/1999` vs instance 2 DOB `06/10/1999` → MISMATCH with 2 sides whose `sources[].instance_index` are 0 and 2 and one `instance_label` is `VNeID`.
      - Dates: `5/10/1999` ≡ `05/10/1999` ≡ `1999-10-05` MATCH; `parseDateKey('31/02/2020') === null`.
      - Gender `Nữ` ≡ `F` ≡ `Female` MATCH; `Nam` vs `Nữ` MISMATCH.
      - Passport: `C1234567` vs `c 123-4567` MATCH across two files.
      - Existing tests unchanged and passing (kết hôn subjects[0]/[1] still INSUFFICIENT; CMND 9-digit still not a mismatch).
      Verify: `npx jest tests/loan-appraisal` passes; `npx tsc --noEmit` exit 0.

- [ ] 4. Đ folding in the remaining normalizers (B4 "all normalizers").
      Replace inline NFD stripping with `foldVietnamese` in `master-data.ts` `stripDiacritics`, `dossier-checks.ts` `normalizeVn`; `master-data-dimension.ts` and `strategies.ts` `asciiLower` already map đ — switch them to `foldVietnamese` only if trivial, otherwise leave (they are already correct).
      Files: lib/pipelines/workflows/loan-appraisal/master-data.ts, dossier-checks.ts
      Verify: `npx jest tests/loan-appraisal` passes.

## V2 UI

- [ ] 5. Pure cross-check view-model module (C1, C3, C4, C6, C7 logic).
      Create `app/loan-appraisal-v2/lib/cross-check.ts` (no React) exporting:
      - `buildPersonIndex(groups: OcrFileGroup[], participants: ParticipantGroup[])` → `CrossCheckPerson[]` `{ key, name, idNumber, oldIdNumbers: string[], roles }`. Seed from participants (`normalizeIdNumber(id_number)`, `alias_ids`), then merge OCR segments from `buildOcrFileGroups` by `idNumber`/`oldIdNumber` (adds old ids → aliases, fills roles). Name preference: first name containing diacritics (hard copy), else first non-empty.
      - `resolveCrossCheckSubject(field, persons)` → `{ personKey, title, idNumber, roles, isAlias }` for `dimension === 'party'`: match `normalizeIdNumber(field.party_id)` against `idNumber`, then `oldIdNumbers` (→ `isAlias: true`). Title format `NAME · CCCD 036097002872 · Người đồng vay` (use `ROLE_LABEL` from `app/loan-appraisal-v2/copy.ts`; prefer `field.subject_roles` when present; "Hộ chiếu" prefix instead of "CCCD" when id has a letter). Unmatched party with 9-digit id: title = `subject_label · CMND cũ <id>` — never `CCCD <9-digit>`. Asset rows: `Tài sản · ${subject_label}`; single rows: `Toàn hồ sơ`.
      - `groupMismatchesByPerson(fields, persons)` → ordered `{ key, title, fields }[]`: persons in role order (BORROWER, CO_BORROWER, COLLATERAL_OWNER, UNRESOLVED), then assets, then single; inside a group sort by `GROUP_ORDER` (move the constant here and import it in the component).
      - `sideSourcesOf(side, lookup)` → `{ file_name, doc_type_label, instance_label }[]`: use `side.sources` when present; else derive from `side.evidence_ids` via the evidence lookup (`instanceIndexOf(record.field_path)` → `bản N+1`, VNeID detection via the same instance's `identification_type` record when present).
      - `aiFindingsOf(conflicts, dossierChecks)` → conflicts whose `severity\u0000title\u0000message` key is not in dossier_checks (same key as `integration-payload.ts` `findingKey`).
      - `looksLikeFormattingOnly(sides)` (C7): true when ≥2 sides and all values are equal after fold + lowercase + removing admin prefix tokens (same list as backend B5) + removing non-alphanumerics. Only used as a hint for OLD results; document that.
      - `insufficientCount(matrix)` = `summary.insufficient ?? fields.filter(INSUFFICIENT).length`.
      Files: app/loan-appraisal-v2/lib/cross-check.ts
      Tests: `tests/loan-appraisal-v2/cross-check.test.ts` using the OLD backend fixture from `ocr-documents.test.ts` (4 participants incl. 145864944/163411615, rows labelled `NGUYỄN THỊ KIỀU ANH`): row with party_id 163411615 resolves to `TRẦN ÁNH DƯƠNG · CCCD 036097002872 · Người đồng vay`, `isAlias: true`; no title contains `CCCD 145864944`; grouping puts alias rows under the canonical person; aiFindingsOf drops dossier_checks; sideSourcesOf with `sources` and with lookup-only; looksLikeFormattingOnly(`Đại Đồng` vs `xã Đại Đồng`) true, (`033199002299` vs `036097002872`) false; new-backend fixture (`sources`, `subject_roles`, `alias_ids`) also resolves.
      Verify: `npx jest tests/loan-appraisal-v2` passes; `npx tsc --noEmit` exit 0.

- [ ] 6. CSV export: all sides + copy (C5, C8, C1).
      In `app/loan-appraisal-v2/lib/csv.ts` `crossCheckRows(fields, subjectOf?: (f) => string)`: header `['Nhóm hồ sơ', 'Trường dữ liệu', 'Đối tượng', 'Chứng từ A', 'Giá trị A', 'Chứng từ B', 'Giá trị B', 'Giá trị khác', 'Kết quả']`; "Chứng từ" cell uses `side.sources` (`file · type · instance_label`) when present else `documents`; "Giá trị khác" = sides[2..] as `docs: value` joined by ` | `; Đối tượng = `subjectOf?.(field) ?? subject_label ?? ''`. `crossCheckCsv` forwards the optional arg.
      Files: app/loan-appraisal-v2/lib/csv.ts, tests/loan-appraisal-v2/format-csv-id.test.ts (add a 3-side case asserting the third value appears and header contains `Trường dữ liệu`).
      Verify: `npx jest tests/loan-appraisal-v2` passes.

- [ ] 7. Components: matrix card, dialog, workspace wiring (C1–C8 rendering).
      - `components/loan-appraisal-v2/intake/IntakeWorkspace.tsx`: memoize `ocrGroups = buildOcrFileGroups(views.length ? views : fallbackViews(extractedDocs), participants)` and `persons = buildPersonIndex(ocrGroups, participants)`; compute `aiFindings = aiFindingsOf(conflicts, dossierChecks)`; render `<CrossCheckMatrix matrix={matrix} persons={persons} aiFindings={aiFindings} />`. Fallback card subtitle → `${conflicts.length} phát hiện` (C8).
      - `CrossCheckMatrix.tsx`:
        - C2: `insufficient = insufficientCount(matrix)`; subtitle `… · ${matched} khớp · ${mismatched} lệch · ${insufficient} chưa đủ dữ liệu`. When `compared === 0`: Badge tone `neutral` "Chưa đủ dữ liệu để đối chiếu" and a `TONE_BOX.neutral` box "N trường chỉ có 1 nguồn chứng từ nên chưa đối chiếu được." instead of the green text. Green "Không có trường lệch" only when compared > 0 and mismatched = 0.
        - C6/C1: render `groupMismatchesByPerson` as `<section aria-labelledby>` per person with an `h4` title (name · CCCD · roles); MismatchCard title = `field_label` (person already in heading); alias rows get a small "Bản VNeID — chưa đối chiếu" note.
        - C4: each side lists `sideSourcesOf(side, useEvidenceLookup())` as `file_name · doc_type_label · instance_label`; "Toàn bộ chứng từ nguồn" disclosure uses `<EvidenceChips ids={field.evidence_ids} label="" />` (real files). Stop using `sourceFilesOf` there.
        - C7: when `looksLikeFormattingOnly(sides)`, show a neutral hint chip "Có thể chỉ khác cách viết" with `title` explaining it is a hint and the result is unchanged.
        - C3: if `aiFindings.length`, a sub-section `h4` "Phát hiện của AI" with `<Badge tone="info">AI</Badge>`, list via `FindingItem` (import from `./BusinessWarnings`), and one line "Các mục mức Nghiêm trọng xuất hiện trong “Việc cần hoàn tất”."
        - C8: when `fields.length === 0`, keep the button disabled, add `aria-describedby` pointing to a span "Chưa có trường nào trong ma trận đối chiếu."
      - `CrossCheckDialog.tsx`: accept `persons` prop; column header "Field" → "Trường dữ liệu"; "Đối tượng" cell = resolved subject title; replace A/B columns with one "Các vế đối chiếu" column listing every side (sources + value) (C5); "Nguồn" column → `EvidenceChips ids={field.evidence_ids}`; CSV download passes `subjectOf`. Keep `RESULT_LABEL` and `sourceFilesOf` exports (remove `sourceFilesOf` only if nothing imports it after the change).
      Files: components/loan-appraisal-v2/intake/{IntakeWorkspace,CrossCheckMatrix,CrossCheckDialog}.tsx
      Verify: `npx tsc --noEmit` exit 0; `npx jest tests/loan-appraisal-v2` passes; `npx next build` succeeds.

## Final verification

- [ ] 8. Full verification and v1 compile check.
      Run in the worktree: `npx jest` (full suite, no `.worktrees` ignore flag), `npx tsc --noEmit`, `npx next build`, `npm run worker:build`. Confirm `git -C d:\Jobs\dugate\.worktrees\la-crosscheck-fix diff --stat c6f0cf7` shows no file under `app/loan-appraisal/` other than `app/loan-appraisal/types.ts`, and that diff of that file only adds optional fields. Do not commit `worker.js` or `tsconfig.tsbuildinfo`.
      Commit locally on `fix/la-crosscheck` (e.g. `fix(loan-appraisal): cross-check per document instance, aliases, normalizers` and `fix(loan-appraisal-v2): cross-check subject identity, AI findings, all sides`). Never push.

## Mapping

| Item | Plan step |
|---|---|
| B1 old id excluded, prefer 12-digit, alias | 2 |
| B2 name from same container | 2 |
| B3 source per instance, ambiguity per instance | 3 |
| B4 Đ→D everywhere | 1, 3, 4 |
| B5 admin-prefix address normalization | 3 |
| B6 DOB / gender / issue date + real date parser | 3 |
| B7 alphanumeric ids, passport leaves | 1, 2, 3 |
| B8 file_names / sources / instance label | 3 |
| C1 subject identity, alias merge | 5, 7 |
| C2 neutral empty state + insufficient count | 5, 7 |
| C3 "Phát hiện của AI" | 5, 7 |
| C4 file + instance per side, real-file disclosure | 5, 7 |
| C5 all sides in dialog + CSV | 6, 7 |
| C6 group by person then group | 5, 7 |
| C7 formatting-only hint (old results) | 5, 7 |
| C8 copy fixes | 6, 7 |

## Assumptions / gaps

- Real operation payload not available; fixtures reuse the user-provided `ho_so_phap_ly.pdf` values (same as `tests/loan-appraisal-v2/ocr-documents.test.ts`).
- After B4/B5, C7 can only trigger on results stored before this fix; it is kept as a hint for those.
- `full_name` preference for diacritic names changes the participant label from an unaccented ĐNVV name to the ID-card spelling; same person, v1-safe.
