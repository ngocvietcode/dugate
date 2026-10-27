# Verification — LA v2 OCR split per document (iteration 1)

Worktree: `d:\Jobs\dugate\.worktrees\la-v2-ocr-split`, branch `fix/la-v2-ocr-split`, commit `7f631c6`.

| Command (cwd = worktree) | Result |
| --- | --- |
| `npx jest tests/loan-appraisal-v2` | 8 suites passed, 61 tests passed (incl. new `ocr-documents.test.ts`) |
| `npx tsc --noEmit` | exit 0, no errors |
| `npx next build` | exit 0, build completed |
| ESLint | not configured in repo — skipped |
| `git -C d:\Jobs\dugate\.worktrees\la-v2-ocr-split --no-pager diff feat/account-opening...HEAD --stat` | see below |

```
 app/loan-appraisal-v2/lib/ocr-documents.ts         | 300 +++++++++++++++++++++
 .../loan-appraisal-v2/intake/IntakeWorkspace.tsx   |   2 +-
 components/loan-appraisal-v2/intake/OcrResults.tsx |  93 +++----
 tests/loan-appraisal-v2/ocr-documents.test.ts      | 216 +++++++++++++++
 4 files changed, 560 insertions(+), 51 deletions(-)
```

No changes to `lib/pipelines/**`, `app/api/**`, DB/schema, prompts or v1 UI (`app/loan-appraisal/**`).

Notes:
- First test run failed one assertion: single-instance `loan_request` segments picked up participant-level roles (`BORROWER + COLLATERAL_OWNER`) instead of the backend segment role. Fixed by keeping resolved backend roles for single-instance types (only `UNRESOLVED` segments are re-resolved), so those types render unchanged. Re-run: all green.
- Per-file header for the fixture reads `5 chứng từ (2 loại) · 70 trường` (4 ID instances + 1 loan request); the user's "4 chứng từ" example counted only ID cards.
