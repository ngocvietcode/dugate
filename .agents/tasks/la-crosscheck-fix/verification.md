# Verification — fix/la-crosscheck (worktree d:\Jobs\dugate\.worktrees\la-crosscheck-fix)

Base `c6f0cf7`. Commits: `3aa9057` (backend B1–B8), `f4ee25c` (V2 UI C1–C8), plus a verification-record commit.
All commands were run in the worktree. `--testPathIgnorePatterns .worktrees` was NOT used: the worktree path itself contains `.worktrees`, so that flag would skip every test.

| Command | Result |
|---|---|
| `npx jest tests/loan-appraisal tests/pipelines/loan-appraisal-cancel` | 21 suites / 223 tests passed (baseline 19 / 201; adds `normalizers.test.ts` and `cross-check-identity.test.ts`) |
| `npx jest tests/loan-appraisal-v2` | 9 suites / 73 tests passed (adds `cross-check.test.ts`) |
| `npx jest --ci` (full) | 195 suites passed, 15 failed, 5 skipped; 2050 tests passed, 26 failed, 17 skipped |
| Same 15 failing suites run at base `c6f0cf7` (`git checkout c6f0cf7`, then back) | Same failures: 15 suites failed / 26 tests failed, so they predate this change. The suites are operations-ui, operations-request-tracking, payment-account-management/extract-schemas, pipelines/parse-field-confidence, payroll-verify (e2e-idp-integration, workflow-merge.property), structure-compare/heading-parser and financial-report/registry-params. None of them touch loan-appraisal. |
| `npx tsc --noEmit` | exit 0. This also covers `worker.ts` and `lib/**`, so it is the worker typecheck. |
| `npx next build` | exit 0. Only "Compiled with warnings": D:/d: path-casing warnings for v2.css and next internals, which predate this change. |
| `npm run worker:build` (esbuild worker.ts --bundle …) | exit 0, `worker.js` 6.3 MB (gitignored, not committed) |
| `git diff --stat c6f0cf7 -- app/loan-appraisal` | Only `app/loan-appraisal/types.ts` changed (+14/−1). The one "removed" line is `summary`, which was widened with an optional `insufficient` field. All other changes are new optional fields. |

## Scenario coverage (tests/loan-appraisal/cross-check-identity.test.ts, fixture tests/loan-appraisal/fixtures/ho-so-phap-ly.ts)

- Kịch bản A (4 identity cards only): exactly 2 participants, `NGUYỄN THỊ KIỀU ANH` (alias 145864944) and `TRẦN ÁNH DƯƠNG` (alias 163411615). VNeID instances are attached to the 12-digit ID. `compared > 0`; full_name, id_number, permanent_address, date_of_birth, gender and id_issue_date are MATCH for both people. No rows carry a 9-digit party_id. Sides return `file_names` and `sources[].instance_label` (`Căn cước công dân` / `VNeID`).
- Kịch bản B (+ĐNVV with xã/huyện/tỉnh, P./Thành phố and an unaccented name): roles land on the 12-digit IDs, full_name keeps the accented spelling, and address/name/DOB/ID are MATCH.
- Đ: `ĐỖ VĂN ĐẠT` ≡ `Do Van Dat`, `Đại Đồng` ≡ `Dai Dong`. `TP. Nam Định` ≡ `Thành phố Nam Định`. A different commune is still a MISMATCH.
- Real mismatch: DOB on the physical card vs. VNeID in the same file is a MISMATCH, with sources from instances 0 and 2 and one source labelled VNeID.
- Dates `5/10/1999` ≡ `05/10/1999` ≡ `1999-10-05`. `31/02/2020`, `05/10/99` → null. Gender: Nữ ≡ F ≡ Female; Nam ≠ Nữ.
- Passport-only person becomes participant `C1234567`, and the passport number MATCHes across two files. A passport in the same block as a CCCD becomes an alias of that CCCD.
- Existing tests are unchanged and pass: the marriage certificate case (subjects[0]/[1]) is still INSUFFICIENT, and the 9-digit CMND is still not a mismatch.

## Not verified

- Real operation payload (fixture rebuilt from user-provided values).
- Browser / screen-reader rendering. Jest uses a node environment and there are no component tests. The UI logic is tested through `app/loan-appraisal-v2/lib/cross-check.ts` and `csv.ts`.
