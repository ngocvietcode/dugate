# H4: cancel stops loan-appraisal and CANCELLED is no longer overwritten

Cancel now stops loan-appraisal at the next stage or sub-step, and the final SUCCEEDED/FAILED writes are blocked inside the row-locked state transition. The sentinel-based early stop is a no-op in `failWorkflow`, so it is never turned into FAILED. Evidence (RED/GREEN runs, tsc clean) is recorded in `loan-appraisal-review.md`, so I did not re-run suites.

**Verdict**: APPROVED

Watch for: no test for the cancel route change (plan step 5 skipped, acknowledged by the coder, confirmed). The 9 failing suites in the coder's run were not shown to be pre-existing (possible, low risk).

## High-level view

The guard is `onlyIf.stateNotIn`, evaluated after `SELECT ... FOR UPDATE` in `transitionOperationState`. The engine passes `['CANCELLED']` from `completeWorkflow` and `failWorkflow` and treats only `result?.state === 'CANCELLED'` as blocked. Blocked paths return without webhook, without `totalUsed`, and without throwing.

Early stop is a `WorkflowCancelledError` sentinel raised by `assertNotCancelled` in loan-appraisal's `beginStage` and `enqueueChecked`. Inner per-file catches in stages 0, 1 and 5 rethrow it. `failWorkflow` returns immediately for the sentinel. The shared `enqueueSubStep` is untouched.

The cancel route gets `onlyIf: { done: false }` and returns the existing 409 shape if the row is not CANCELLED.

<details>
<summary>Issues (3)</summary>

1. **No cancel-route test (confirmed)**: the `done:false` guard and the new 409 branch are untested. Add the route test from plan step 5 in a follow-up.
2. **Unproven pre-existing failures (possible)**: 9 failing suites were attributed to unrelated causes by grep only, not by running on the old code. Confirm on the base branch before merge.
3. **Known gaps, documented by the coder (confirmed)**: waiting BullMQ sub-jobs are not removed, in-flight AI cost is not billed, and `pauseWorkflow`/`updateWorkflowProgressDetails` can still write to a CANCELLED row. Track separately.

</details>

<details>
<summary>Details</summary>

## Criteria

(a) Race: PASS. The guard sits in `state-transition.ts` after `findOperationForTransition` (row lock) and before any write. `completeWorkflow` and `failWorkflow` have no read-then-write. `assertNotCancelled` is a plain read but is only an early-stop optimization. The authoritative protection is the locked guard, so a cancel landing between the check and the final write is still caught. `updateProgress` uses a conditional UPDATE (`state <> 'CANCELLED'`), so it is also atomic.

(b) Other workflows: PASS. The `onlyIf` additions are additive, and existing `{state, done}` callers are unchanged. `enqueueSubStep` and `pauseWorkflow` are untouched. The only new behavior is for CANCELLED rows: no overwrite, no webhook, no totalUsed, plus `runWorkflow` skipping an op that is already CANCELLED when the job starts. The extra `db.select` in `runWorkflow` uses `operation?.state`, so an empty result is safe. Mocked `{}` transition results are not treated as blocked.

(c) No overwrite and no FAILED: PASS. The sentinel is thrown in `beginStage`/`enqueueChecked`, rethrown by the inner catches (stage 0, 1, 5, the three swallow points), and `failWorkflow` no-ops on it from both loan-appraisal's catch and `runWorkflow`'s catch. Non-sentinel errors after cancel are blocked by `stateNotIn`. Stage 2 has no inner catch, so it propagates naturally.

(d) Side effects: PASS. The early return happens before `job.updateProgress(100)`, the totalUsed update and the webhook. Nothing is thrown, so BullMQ does not retry. The `failWorkflow` blocked path also skips the FAILED webhook.

(e) Tests: PASS. `workflow-cancel-guard.test.ts` runs the real transition service over an in-memory store, with RUNNING controls proving the harness is live. The coder recorded RED on the old code: 4 of 6 failed behaviorally (CANCELLED to SUCCEEDED/FAILED), and the 2 controls passed. `stateNotIn` state-transition test also went RED. Caveat: `loan-appraisal-cancel.test.ts` went RED only at import (sentinel missing), so RED proves nothing behavioral there. On the new code it is still non-tautological: if the inner catch swallowed the sentinel, stage 0 would hit `INVALID_INPUT` and `failWorkflow` would receive a plain Error, failing the `toBeInstanceOf` assertion. It relies on a mocked `assertNotCancelled`, so DB-level cancel detection is only covered by the guard tests. Acceptable.

(f) Contracts and scope: PASS. The route success response is unchanged. The 409 body is the existing shape. The webhook payload is unchanged. M7, H2 and H3 are not touched. The diff also contains earlier-task changes (H1 `INVALID_INPUT` codes in loan-appraisal.ts, with a `workflow-failure.test.ts` case, and evidence.ts for parseMoney). These are not H4 and were not reviewed here beyond noting they are bundled.

## Minor notes

The cancel route's existing `op.done` pre-check still returns 409 for a second cancel, so double cancel behavior is unchanged.

</details>

<details>
<summary>File map</summary>

- `lib/operations/state-transition.ts`: `onlyIf.stateNotIn`
- `lib/pipelines/workflow-engine.ts`: guard in complete/fail/progress, sentinel and helpers, early skip in `runWorkflow`
- `lib/pipelines/workflows/loan-appraisal.ts`: `assertNotCancelled` in `beginStage`, `enqueueChecked`, rethrow in inner catches
- `app/api/v1/operations/[id]/cancel/route.ts`: `done:false` guard plus 409
- tests: `workflow-cancel-guard`, `loan-appraisal-cancel`, `state-transition` additions

</details>
