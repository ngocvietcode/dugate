# Record incurred usage on CANCELLED loan-appraisal operations (H4 item 3)

A cancelled workflow used to lose its token/cost totals: `completeWorkflow`/`failWorkflow` were blocked by the CANCELLED guard and `updateProgress` never persisted cost. The change adds `recordCancelledUsage(ctx)`, an absolute-value conditional UPDATE (`WHERE id AND state='CANCELLED'`), called from the three CANCELLED exits (complete blocked, fail blocked, `WorkflowCancelledError` early stop). It adds no new write to `apiKeys.totalUsed`. The coder's reasoning is that every sub-operation already bills itself in `runPipeline` (`engine.ts:527`), so the AI cost incurred before a cancel is already in `totalUsed` exactly once. A parent-level increment would bill it twice.

Watch for: (1) this deviates from the literal task wording ("CANCELLED must increment totalUsed"). It is correct only because of the sub-op billing path, which I confirmed by reading the code (confirmed: `enqueueSubStep` inserts the sub-op with `apiKeyId: ctx.apiKeyId`, and `runPipeline` increments by `usage.totalCostUsd`). It was not run against a DB, and no test pins it. (2) The user should be told that `completeWorkflow` on SUCCEEDED adds `ctx.totalCost` on top of the sub-op charges (likely pre-existing double count, out of scope).

**Verdict**: APPROVED

## High-level view

The chosen single increment point is the sub-op's own `runPipeline` completion. Each sub-op row is billed once by its own path, so cancel-vs-finish races, BullMQ retries and repeated `completeWorkflow`/`failWorkflow` calls cannot bill again, because the cancel path writes no `totalUsed` at all. The new UPDATE sets absolute values guarded by `state='CANCELLED'`, so repeats are harmless and it is a no-op if the row is not cancelled.

SUCCEEDED/FAILED behavior is untouched outside the CANCELLED branches. The new code sits only in the existing CANCELLED exits, and the control tests cover RUNNING to SUCCEEDED (webhook plus one totalUsed update) and RUNNING to FAILED. No webhook is dispatched on any new path. The usage report (`billing/usage`) filters on `state='SUCCEEDED'`, so recording cost on CANCELLED rows does not feed another aggregate.

<details>
<summary>Issues (3)</summary>

1. **Literal requirement vs. implementation** (likely, non-blocking) — the task said CANCELLED must increment `totalUsed`; the implementation relies on sub-op billing instead. Confirm with the user that "cost already incurred is counted" is satisfied this way (the plan and verification note already flag it).
2. **Sub-op billing premise untested** (possible, non-blocking) — the plan's optional billing-source guard test was skipped. Nothing fails if someone later removes sub-op billing or adds a parent increment. Consider a small test around `runPipeline`.
3. **Possible SUCCEEDED double count** (likely, pre-existing, out of scope) — `completeWorkflow` adds `ctx.totalCost` even though sub-ops already billed it. Needs its own decision. Also, an in-flight sub-op finishing after cancel is billed to the key but may be missing from the parent row's recorded totals.

</details>

<details>
<summary>Details</summary>

## Single increment point and the cancel race

`totalUsed` has two writers: `runPipeline` (per sub-op, on its own SUCCEEDED) and `completeWorkflow` (parent, only when the transition really lands SUCCEEDED, since the `stateNotIn: ['CANCELLED']` guard runs under the row lock in `transitionOperationState`). The diff adds no third writer. A cancel that lands mid-finish has two outcomes. If the cancel wins the lock, `completeWorkflow` returns early and records usage without touching `apiKeys`. If the finish wins, the op is SUCCEEDED and the cancel route gets 409 via `onlyIf: { done: false }`. In both cases the cancel adds no charge. "Exactly once" for the used portion therefore holds through sub-op billing (confirmed by reading `engine.ts` and `enqueueSubStep`; not executed against a DB).

An in-flight sub-op at cancel time is still billed when it completes, since `runPipeline` ignores the parent. The key balance is therefore right. The parent row's recorded totals can miss that cost if the parent already stopped waiting; this is documented as a limitation.

## recordCancelledUsage behavior

The UPDATE uses SET with values from ctx, and its WHERE includes the `state = 'CANCELLED'` predicate. Repeat invocations (sentinel, then complete, then fail on the same ctx) write identical values. Errors are logged and swallowed, so a DB blip neither retries the job via BullMQ nor turns CANCELLED into FAILED. One asymmetry: `ctx` totals are rolled up only from successful sub-ops, so on resume after a crash the row totals are seeded from the stored row. That is consistent with the existing design.

## Tests

The new `describe` in `workflow-cancel-guard.test.ts` has 7 cases covering complete, fail and sentinel paths (one usage write, no totalUsed, no webhook, state stays CANCELLED), idempotency across three calls, the conditional WHERE, error swallowing, and a RUNNING control. The coder recorded RED before the fix (6 failed, 7 passed, failing for the behavioral reason that no usage UPDATE was issued) and GREEN after. Four related suites passed (28 tests), the wider run had only unrelated failures, and `tsc --noEmit` was clean. The eslint run hung and was not completed. Not tested: the sub-op billing assumption (issue 2), and the concurrent interleaving itself (the mocked transition store is sequential).

## Bundled changes

The working tree also contains earlier H1/H4 work in the same files (`parseMoney`, `INVALID_INPUT` codes, `assertNotCancelled`, the `stateNotIn` guard, and a cancel-route change). These are not part of this item and were not re-reviewed here.

</details>

<details>
<summary>File map</summary>

- `lib/pipelines/workflow-engine.ts` — new `recordCancelledUsage`, called from three CANCELLED exits
- `tests/pipelines/workflow-cancel-guard.test.ts` — untracked file, 7 new cases for item 3
- `lib/operations/state-transition.ts`, `lib/pipelines/workflows/loan-appraisal.ts` — earlier H4 work, no item 3 changes

Full diff: `git diff` plus the untracked test file.

</details>
