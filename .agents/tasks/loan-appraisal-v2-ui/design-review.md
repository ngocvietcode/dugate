# Design Review: Loan Appraisal v2 UI (round 2)

Verdict: APPROVED (0 HIGH, 0 MEDIUM, 4 NIT)

Reviewed: `d:\Jobs\dugate\.agents\tasks\loan-appraisal-v2-ui/design.md` (revised after round 1, includes section 7 "Phản hồi review"). I checked claims against source at `d:\Jobs\dugate` commit `bdf9593` (branch `feat/account-opening`). I did not run builds or tests; no code exists yet.

## Round 1 findings: resolution check

| # | Sev | Status | Evidence in revised design |
|---|-----|--------|----------------------------|
| 1 | HIGH | Resolved | `V2_BASE = bdf9593` defined in section 0 and used in AC1, AC2, 4.12 |
| 2 | HIGH | Resolved | Base fixed to `bdf9593`; step 0 is a blocking gate; ff-merged history is explicitly not a v2 backend change |
| 3 | MEDIUM | Resolved | `cancelling -> running` after 3 polls with `toast.warning`; AC16; reducer test required |
| 4 | MEDIUM | Resolved | `stalled` phase, `error=null`, "Mở lại kết quả" via `attach`; AC6 |
| 5 | MEDIUM | Resolved | Re-run confirmation Dialog when phase is `succeeded|failed|cancelled`; AC17 |
| 6 | MEDIUM | Resolved | `ApiErrorKind` defined, explicit mapping to `RunErrorKind`, `'cancel'` removed |
| 7 | MEDIUM | Resolved | Source fixed to `opData.result.usage`, per-state rules, `parseUsage` test per state; AC12 |
| 8-12 | NIT | Resolved | Reflected in 4.10, 4.3, section 6, 4.12 |

## Findings

No HIGH or MEDIUM findings.

1. **NIT: Cancel 200 response is ignored.** I read `app/api/v1/operations/[id]/cancel/route.ts`. On success it returns `formatOperationResponse(updated)` with `state: 'CANCELLED'` already set, so the 3-round poll in 4.5 is not needed to learn the outcome. The design still works (the poll will see CANCELLED). Fix, optional: run `applyOperation` on the 200 body and keep the 3-round poll only as a fallback.

2. **NIT: Acceptance criteria are numbered out of order.** AC16 and AC17 sit between AC12 and AC13 in section 1.4. Fix: renumber so the list is sequential and references (AC1, AC2, AC6, AC12, AC16, AC17) stay valid.

3. **NIT: Ambiguous V1-result rule in 4.4.** "`index<3 || done` mới done" does not say what `done` refers to (step-level status). Fix: write "stage is `done` if its index is < 3 or its `step.status` is not FAILED/PENDING", or state "copy the exact predicate from `useLoanAppraisalPolling.ts`".

4. **NIT: Mid-poll fatal errors have no explicit transition row.** 4.5 says 401/403/404 during polling are fatal and 3 network errors stop polling, but the transition list in 4.4 only names `FAILED` via workflow state. Fix: add the line "`running|cancelling -> failed` on fatal poll error (kinds `forbidden`, `not-found`, `network`)".

## Verified Assumptions

- Base commit: `git rev-parse HEAD` in `d:\Jobs\dugate` is `bdf95936...` on `feat/account-opening`; `b46dd21` is an ancestor of it (ff-only is valid). The v2 worktree HEAD is `b46dd21` (step 0 not yet run, as designed).
- `git ls-tree bdf9593 app/loan-appraisal` lists 13 files; `components/ThemeToggle.tsx`, `components/profiles/LoanCheckSetPanel.tsx`, `app/api/v1/operations/[id]/cancel/route.ts` exist at `bdf9593`.
- Cancel route status codes match the design: 404 (missing), 401 (no identity), 403 (wrong key or user), 409 (already done, including the atomic `onlyIf` guard), 200 (formatted operation), 500 (internal).
- Submit contract: v1 posts `product_code`, optional `flow`, and `files[]` to `/api/v1/docs/workflows`; the route uses `normalizeFiles(form)` and requires at least 1 file. v1 poll uses `?view=compact`, a 10-minute timeout and a 3-error stop, as the design states.
- Config endpoints `/api/internal/apikeys` and `/api/internal/profile-endpoints` exist; v1 config uses `ENDPOINT_SLUG = 'workflows:loan-appraisal'` and `?client=`.
- `HeaderNav.tsx` and `PageWrapper.tsx` both use `pathname.startsWith('/loan-appraisal')`, so `/loan-appraisal-v2` inherits full-width behaviour with no edits.
- `app/loan-appraisal/types.ts` and `product.ts` contain no `from '...'` imports (no server-only dependency); `LoanFlow` and `LoanStageKey` are exported from `types.ts`.
- `jest.config.js` maps `@/` to `<rootDir>`, `testMatch` is `**/tests/**/*.test.ts`, and `tsconfig.jest.json` extends `tsconfig.json` with `jsx: react-jsx`. The design's "pure `.ts` lib modules" rule fits this setup, and the `@/` alias resolves.
- Isolation: allowed paths are only `app/loan-appraisal-v2/**`, `components/loan-appraisal-v2/**`, `tests/loan-appraisal-v2/**`; no dependency, backend, API, DB or v1 file is touched; no new endpoint is used.
- Feature parity: the section 3 catalog covers inputs, upload, run, polling, reopen, results phases 1 and 2, evidence, config, and adds cancel and cost/token UI over existing endpoints.
- Accessibility and responsiveness are concrete (ARIA patterns, focus trap, live regions, contrast targets, 360 to 1920px breakpoints).

## Unverified / Wrong Assumptions

- Colour contrast across the five themes is not measured; the design states this and assigns measurement to the coder.
- End-to-end behaviour (worker, Redis, Postgres, real operation payloads) is not verifiable at design time.
- `usage.breakdown` shape across backend versions is assumed; `parseUsage` is defensive.
- I did not read every line of `lib/pipelines/format.ts` again this round; I relied on round 1 verification for the usage contract.

## Verdict

APPROVED. HIGH count 0, MEDIUM count 0. The 4 NITs may be fixed by the planner or coder without blocking.
