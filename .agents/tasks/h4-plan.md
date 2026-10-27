# Implementation Plan: H4 - Cancel must stop the loan-appraisal workflow and must not be overwritten

Scope: H4 only. Do NOT fix M7, H2, H3 or other findings. Do NOT commit/stage/revert. Do NOT touch the existing uncommitted changes (LoanCheckSetPanel.tsx, loan-appraisal/check-set.ts, prompt-checks.ts, README.md, staged tests, .worktrees/).
Run tests with `npx jest <path> --ci`. Typecheck with `npx tsc --noEmit`. Comments follow file style (Vietnamese/English mix).

## Findings from code reading (facts the design rests on)

- `lib/operations/state-transition.ts` (NOT `lib/pipelines/state-transition.ts`): `transitionOperationState` reads the row with `SELECT ... FOR UPDATE` inside a transaction (`findOperationForTransition`) and only then evaluates `onlyIf`. If the guard does not match it returns the existing row without writing. So a guard here is atomic (row lock), no check-then-write race.
- The existing `onlyIf` only supports equality (`state`, `done`). "Not CANCELLED" cannot be expressed. Existing callers (`worker-dlq.ts`, `stalled-reaper.ts`, `workflow-engine.ts` ~350) use `{ state: 'RUNNING', done: false }` and must stay unchanged.
- Blocked transitions return the existing row (state 'CANCELLED') instead of throwing. That is the signal the caller uses.
- `completeWorkflow` / `failWorkflow` (workflow-engine.ts ~456 / ~578) call it with no guard; `completeWorkflow` then does `apiKeys.totalUsed += totalCost` and `dispatchWorkflowWebhook('SUCCEEDED')`; `failWorkflow` dispatches `'FAILED'`. `updateProgress` (~429) does a raw `db.update` with no state condition.
- `runLoanAppraisal` wraps everything in a try/catch that calls `failWorkflow`. Stage 0, 1 and 5 have INNER per-file/per-call try/catch around `enqueueSubStep` that swallow errors (fallback results). A thrown "cancelled" signal would be swallowed there unless rethrown. `runWorkflow` also catches handler errors and calls `failWorkflow`.
- Existing mocked tests assert `transitionMock` is called with `objectContaining({operationId, state, changes})` and the mock resolves `{}`. So the fix must (a) only ADD a key to the call and (b) treat the result as "blocked" ONLY when `result?.state === 'CANCELLED'` (a `{}` result must still mean success). Those tests mock `drizzle-orm` as `{ eq, and, sql }` only - do not import `ne`/`inArray` into workflow-engine.ts.
- No `tests/loan-appraisal/` directory exists; nothing imports `runLoanAppraisal` in tests yet. Other workflows' tests either mock the whole engine (financial-report, tracing-portal) or use `jest.requireActual` with mocked `enqueueSubStep` (payment-account-management/update-verify.test.ts).

## Design decisions

1. New guard field `onlyIf.stateNotIn?: string[]` in `TransitionOperationStateInput` (state-transition.ts). Rationale: reuses the existing locked compare-and-set point, so the check and write are one atomic step; additive, so existing `onlyIf` callers are unaffected. The engine passes `stateNotIn: ['CANCELLED']` only (not all terminal states): minimal change, no behavior change for other workflows except on CANCELLED. (Overwriting SUCCEEDED/FAILED is a different, not-reported issue; do not widen.)
2. Blocked complete/fail: return early BEFORE the apiKeys.totalUsed update and BEFORE the webhook; log `ctx.logger.info/warn` one line; never throw (so BullMQ does not retry). Cost already incurred by AI calls on a cancelled run is NOT billed to `apiKeys.totalUsed`: this matches `failWorkflow`, which also never increments totalUsed for a run that incurred cost. Recorded as remaining work (see end).
3. Early stop uses a sentinel: `class WorkflowCancelledError extends Error` plus `isOperationCancelled(ctx)` and `assertNotCancelled(ctx)` exported from workflow-engine.ts (DB read of `operations.state`). `failWorkflow(ctx, err)` returns immediately (no write, no webhook) when `err instanceof WorkflowCancelledError`, and otherwise relies on the guard. So both the loan-appraisal catch and the `runWorkflow` catch route the sentinel to "no-op" without any change to their catch structure.
4. Do NOT add the cancel check inside the shared `enqueueSubStep`. Other workflows wrap it in their own catches (and tests mock it), so a throw there could change their outcome (e.g. be swallowed into a partial result). Instead loan-appraisal gets a local wrapper. Other workflows only get the atomic overwrite guard plus the `updateProgress` guard.
5. `updateProgress` keeps its signature; its UPDATE gets an extra condition so it does not write to a CANCELLED row: `and(eq(operations.id, ctx.operationId), sql\`${operations.state} <> 'CANCELLED'\`)` (only `and/eq/sql`, already in the mocked drizzle-orm). Non-cancelled behavior identical.
6. Cancel route: keep response contract. Harden the cancel write itself with the existing guard `onlyIf: { done: false }` so a cancel racing with completion cannot flip SUCCEEDED to CANCELLED; if the returned row is not `CANCELLED`, return the existing 409 `already-done` response. (Uses only the existing 409 shape.)
7. BullMQ removal of waiting sub-jobs on cancel: NOT done (sub-jobs live in per-worker-group steps queues resolved via `resolveTargetQueue`; job ids are random; active jobs cannot be removed). The sub-op itself is still cancelled at the parent level because no NEW sub-steps start after cancel. Recorded as remaining work.

## Steps

- [ ] 1. Write the FAILING reproduction tests first (no production edits yet).
      a) `tests/pipelines/workflow-cancel-guard.test.ts`: mock `@/lib/db` (`update` chain + `select` chain), `@/lib/db/schema`, `drizzle-orm` (`eq, and, sql` only) exactly like `tests/operations-request-tracking/workflow-metadata-persistence.test.ts`; mock `@/lib/operations/state-transition` so `transitionOperationState` is backed by `createOperationStateTransitionService` (import the real factory via `jest.requireActual`) over a tiny in-memory store (copy the fake store helpers from `tests/operations-request-tracking/state-transition.test.ts`) seeded with one operation in state `CANCELLED`. Spy `global.fetch`/the webhook sender used by `dispatchWorkflowWebhook` (read it at workflow-engine.ts ~637 to pick the right mock) and the `db.update(apiKeys)` call. Cases: (1) `completeWorkflow` with `totalCost: 1.5`, `apiKeyId: 'k1'`, `webhookUrl` set -> op stays `CANCELLED`, no webhook sent, no `apiKeys.totalUsed` update, resolves without throwing; (2) `failWorkflow` -> stays `CANCELLED`, no FAILED webhook; (3) control: same calls on a `RUNNING` op -> become `SUCCEEDED` / `FAILED`, webhook sent, totalUsed updated (proves the mock harness is real); (4) `failWorkflow(ctx, new WorkflowCancelledError())` -> no transition call at all; (5) `updateProgress` on a cancelled op issues the conditional update (assert `and` was called with 2 args).
      b) `tests/operations-request-tracking/state-transition.test.ts`: add cases for `onlyIf.stateNotIn` (blocked when current state is in the list and row unchanged, applied when not in the list, combined with `done`).
      c) `tests/pipelines/loan-appraisal-cancel.test.ts`: `jest.mock('@/lib/pipelines/workflow-engine', ...)` with `jest.requireActual` spread, mocking `enqueueSubStep`, `updateProgress`, `completeWorkflow`, `failWorkflow`, and `assertNotCancelled` (first call ok, then throws `WorkflowCancelledError`). Build a minimal `WorkflowContext` (model on `tests/tracing-portal/workflow.test.ts`). Cases: cancelled before stage 0 -> `enqueueSubStep` not called, `completeWorkflow` not called; cancelled between stage 0 and 1 (and before the rule-LLM call in stage 5) -> no further `enqueueSubStep`, and the inner per-file catch does NOT swallow it; `failWorkflow` receives (or is not asked to write for) the sentinel, never a FAILED write.
      Files: the three test files above.
      Verify: `npx jest tests/pipelines/workflow-cancel-guard.test.ts tests/pipelines/loan-appraisal-cancel.test.ts tests/operations-request-tracking/state-transition.test.ts --ci` -> the new cancel cases FAIL on the unmodified code (op ends SUCCEEDED/FAILED, webhook sent, totalUsed updated, enqueueSubStep called). Record the failing output in the final summary to prove the bug reproduces. (Missing exports may make them fail at import; that is acceptable only if cases (1)-(3) of 1a also fail for the behavioral reason once stubs exist. If needed, add empty stubs first so failures are behavioral.)

- [ ] 2. Add the atomic guard to the state machine.
      In `lib/operations/state-transition.ts` extend `onlyIf` with `stateNotIn?: readonly string[]` and in `transitionOperationState` add `(input.onlyIf?.stateNotIn?.includes(existing.state))` to the existing no-op condition (same place, after the row lock). Update the doc comment. No change to existing fields.
      Files: `lib/operations/state-transition.ts`
      Verify: `npx jest tests/operations-request-tracking --ci` -> all pass including the new `stateNotIn` cases.

- [ ] 3. Engine: guard complete/fail/progress and add cancel helpers (depends on 2).
      In `lib/pipelines/workflow-engine.ts`: add `WorkflowCancelledError`, `isOperationCancelled(ctx)`, `assertNotCancelled(ctx)`. In `completeWorkflow` pass `onlyIf: { stateNotIn: ['CANCELLED'] }`; if `result?.state === 'CANCELLED'` log `[WORKFLOW] ... already CANCELLED, skipping SUCCEEDED` and `return` before `job.updateProgress(100)`, totalUsed update and webhook. Same in `failWorkflow` (plus early return for `WorkflowCancelledError` with an info log, before writing). Add the `state <> 'CANCELLED'` condition to `updateProgress`. In `runWorkflow`, after context creation, `if (await isOperationCancelled(ctx)) { log; return; }` (only affects already-cancelled ops). Leave `pauseWorkflow`, `updateWorkflowProgressDetails` and `enqueueSubStep` untouched.
      Files: `lib/pipelines/workflow-engine.ts`
      Verify: `npx jest tests/pipelines tests/operations-request-tracking --ci` -> the cases in `workflow-cancel-guard.test.ts` pass; existing `workflow-fail-persistence.test.ts` and `workflow-metadata-persistence.test.ts` still pass unchanged.

- [ ] 4. Loan appraisal early stop (depends on 3).
      In `lib/pipelines/workflows/loan-appraisal.ts`: call `await assertNotCancelled(ctx)` at the top of `beginStage` (covers stages 0-7) and add a local `enqueueChecked(...)` wrapper that runs `assertNotCancelled` then `enqueueSubStep`; replace the three `enqueueSubStep` calls (classify, extract, fact-verifier stage 2, rule LLM stage 5) with it. In the inner catch blocks of stages 0, 1 and 5 add `if (error instanceof WorkflowCancelledError) throw error;` as the first line so the per-file fallback does not swallow cancel. The outer catch keeps calling `failWorkflow`, which now no-ops for the sentinel. Do not touch the uncommitted check-set/prompt-checks changes beyond these lines.
      Files: `lib/pipelines/workflows/loan-appraisal.ts`
      Verify: `npx jest tests/pipelines/loan-appraisal-cancel.test.ts tests/pipelines --ci` passes; `npx jest tests/payment-account-management tests/tracing-portal tests/financial-report --ci` still pass (other workflows unaffected).

- [ ] 5. Cancel route guard (depends on 2).
      In `app/api/v1/operations/[id]/cancel/route.ts` call `transitionOperationState` with `onlyIf: { done: false }`; if `updated.state !== 'CANCELLED'` return the existing 409 `already-done` JSON. Success response (`formatOperationResponse(updated)`) unchanged. Add a route test `tests/pipelines/cancel-route.test.ts` (mock auth + db like other route tests; grep `tests/` for an existing `resolveCallerIdentity` mock to copy) covering: running -> 200 CANCELLED; guard blocked -> 409.
      Files: `app/api/v1/operations/[id]/cancel/route.ts`, `tests/pipelines/cancel-route.test.ts`
      Verify: `npx jest tests/pipelines/cancel-route.test.ts --ci` passes.

- [ ] 6. Full verification.
      Run `npx tsc --noEmit`, `npx eslint` on the changed files, then `npx jest tests/pipelines tests/operations-request-tracking tests/payment-account-management tests/tracing-portal tests/financial-report --ci`. Also grep tests for `workflow-engine` consumers for any other suites (disbursement, payroll-verify, statement-analyze, account-opening) and run those directories. All must pass; new tests from step 1 now green.
      Files: none.
      Verify: commands above exit 0.

## Checks the reviewer must apply

- No race: cancel protection is inside the row-locked transaction (`FOR UPDATE`), not a separate read-then-write in the engine.
- Other workflows: the only behavior difference is "a CANCELLED op is no longer overwritten / no SUCCEEDED-FAILED webhook / no totalUsed". `enqueueSubStep` is unchanged. `pauseWorkflow` unchanged.
- Cancelled run is never turned into FAILED: sentinel rethrown through inner catches and no-op'd in `failWorkflow`; `failWorkflow` also guarded by `stateNotIn` for non-sentinel errors that occur after cancel.
- Blocked path never throws (no BullMQ retry) and uses `result?.state === 'CANCELLED'` so `{}` mocks keep working.
- Webhook payload/contract and cancel route response shape unchanged.

## Remaining work (not done here)

- Remove waiting BullMQ sub-jobs on cancel; abort in-flight (active) AI calls.
- Persist cost/usage incurred before cancel (currently dropped because the guard blocks the whole write) and decide whether to bill it.
- `pauseWorkflow` and `updateWorkflowProgressDetails` can still write to a CANCELLED op.
- Other findings (M7, H2, H3, ...) untouched.
