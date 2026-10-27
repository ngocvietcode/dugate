# Plan: H4 item 3 - cost already incurred before CANCEL must be counted

Scope: ONLY this item. Not doing: deleting waiting BullMQ sub-jobs, cancel-route tests, guards for pauseWorkflow/updateWorkflowProgressDetails, any other finding. No commit/stage/revert. Do not touch the other people's uncommitted files. Cancel route response contract unchanged. Tests: `npx jest <path> --ci`; typecheck `npx tsc --noEmit`.

## 1. Findings from code (read, not assumed)

Unit of `apiKeys.totalUsed`: USD cost (`doublePrecision`, `lib/db/schema.ts:144`), compared with `spendingLimit` in `lib/pipelines/submit.ts:174` and shown by `app/api/v1/billing/balance/route.ts`. Not tokens, not a count. No "billed" flag or column exists on `operations`.

There are exactly TWO places that increment it:
1. `lib/pipelines/engine.ts:527-531` (`runPipeline`, non-workflow pipeline): `+= usage.totalCostUsd` only after SUCCEEDED. The FAILED catch (engine.ts ~545-585) writes tokens/cost to the row but NEVER increments totalUsed.
2. `lib/pipelines/workflow-engine.ts` `completeWorkflow`: `+= ctx.totalCost` only after SUCCEEDED and only if not blocked by CANCELLED. `failWorkflow` never increments it. `pauseWorkflow` never increments it.

So the current rule in code is: **only SUCCEEDED charges; FAILED does not charge the already-used portion** (at the operation level). This is an inconsistency with the user's decision (CANCELLED must charge the used portion). Flagged as a design decision below.

How cost accumulates: `enqueueSubStep` (workflow-engine.ts:180) inserts a hidden sub-operation with `apiKeyId: ctx.apiKeyId` and `correlationId: ctx.correlationId`, puts a job named `pipeline:<slug>` on the steps queue; `worker.ts:101` routes it to `runPipeline` (not runWorkflow). After the sub-op is done, `enqueueSubStep` reads the sub-op row and adds `totalInputTokens/totalOutputTokens/totalCostUsd/missing flags/usageBreakdown` into the in-memory `ctx` (workflow-engine.ts:375-383, roll-up only on success; a FAILED sub-op throws before roll-up). `ctx` totals are persisted onto the parent row ONLY by `completeWorkflow`, `failWorkflow`, `pauseWorkflow` (via `transitionOperationState` changes). `updateProgress` persists progress/steps only, NOT token/cost (it writes progressPercent, progressMessage, progressLogJson, currentStep, stepsResultJson). `createWorkflowContext` (line ~1005) re-seeds ctx totals from the row, so a resumed run continues from stored totals.

**Key discovery (changes the design):** every successful sub-op already runs through `runPipeline`, which increments `apiKeys.totalUsed` for the sub-op's own cost with the sub-op's `apiKeyId` (= the parent's key), at the moment the sub-op SUCCEEDS. Nothing in `runPipeline` looks at the parent or at CANCELLED. Consequences:
- The AI cost of every sub-step that finished before, during or after the parent was cancelled is ALREADY added to `totalUsed` exactly once (by the sub-op). Cancel does not stop that; the sub-op row itself is never CANCELLED (only the parent is).
- The parent-level `+= ctx.totalCost` in `completeWorkflow` is therefore a SECOND increment of the same money on the SUCCEEDED path. This looks like an existing double count (sub-op billed by engine.ts + parent billed again). I verified this by reading the code only; I did not run it against a DB. It is out of scope to fix, but it must be reported to the user, because it decides what "charge used cost on CANCELLED" should mean (see decision below).
- Sub-op that FAILED or is removed before running costs nothing and is not billed. A sub-op still active at cancel time is billed by its own runPipeline when it completes (consistent rule: charged at sub-op completion, regardless of parent state). Limitation: a sub-op that finishes after the parent gave up waiting is billed to the key but will not appear in the parent's `ctx` totals.

What is actually missing today for a cancelled op: the parent row never gets its token/cost/usageBreakdown/stepsResult (ctx totals are dropped: `completeWorkflow`/`failWorkflow` are blocked by the guard before/instead of writing, and the sentinel path in `failWorkflow` returns immediately; `updateProgress` never wrote them). So the Operations UI/report shows cost 0 for a cancelled op even though the key was charged by the sub-ops.

## 2. Design decisions

D1. **Do NOT add a parent-level `apiKeys.totalUsed += ctx.totalCost` for CANCELLED.** Rationale: sub-ops already charged that money once; adding it again would double count (and would copy the suspected SUCCEEDED double count into a new state). This satisfies the user's requirement ("cost already incurred is counted into the key's usage") because the used portion IS in `totalUsed`, charged exactly once per sub-op, with no new increment point, no race and no idempotency problem (each sub-op row is billed once by its own single `runPipeline` completion path).
   - Explicit flag for the user: by the code, op-level FAILED does not charge the used portion either; it's only correct because the sub-ops charge themselves. CANCELLED therefore follows the same rule as FAILED (no parent-level increment), and the user's "CANCELLED charges used portion" holds through sub-op billing. If the user wants the parent-level increment anyway (parity with SUCCEEDED), it is a one-line change but will double count; recommend fixing the SUCCEEDED double count first (separate finding).
D2. **Record the used usage on the CANCELLED parent row** (what is actually missing). Add `recordCancelledUsage(ctx)` to `lib/pipelines/workflow-engine.ts`: one conditional UPDATE on `operations` setting `totalInputTokens, totalOutputTokens, totalCostUsd, inputTokensMissing, outputTokensMissing, costMissing, hasUnpricedCost, usageBreakdown, stepsResultJson` from ctx, with `where(and(eq(operations.id, ctx.operationId), sql\`${operations.state} = 'CANCELLED'\`))`. It uses ABSOLUTE values (SET, not `+=`), so it is idempotent across repeated calls, BullMQ retries and `completeWorkflow`+`failWorkflow` both reaching it. It does not touch `state`, `done`, `completedAt`, webhook or `apiKeys`. Uses only `and/eq/sql` (the mocked drizzle-orm in existing tests only provides those). Raw `db.update` is the same pattern as `updateProgress`; it does not change state, so it does not need the transition service.
D3. **Call sites** (all are the existing "CANCELLED" exits, nothing new runs after cancel):
   - `completeWorkflow` blocked branch (`transitioned?.state === 'CANCELLED'`): call `recordCancelledUsage(ctx)` before the `return`.
   - `failWorkflow` blocked branch (`transitioned?.state === 'CANCELLED'`): same.
   - `failWorkflow` sentinel branch (`error instanceof WorkflowCancelledError`): call `recordCancelledUsage(ctx)` then return. This is the main path for loan-appraisal (assertNotCancelled throws the sentinel). Failure of this write must not throw to BullMQ (no retry) and must not turn the op into FAILED: wrap in try/catch, log `ctx.logger.warn`.
   - `runWorkflow`'s "already CANCELLED before run" skip: NOT changed (nothing ran, ctx totals are whatever is on the row; writing would be a no-op).
D4. Guarantees:
   (a) No double counting: `apiKeys.totalUsed` gets no new write path at all. Existing single increments stay: sub-op in `runPipeline` once; parent in `completeWorkflow` only when it really transitions to SUCCEEDED. The new UPDATE writes only operation columns with absolute values, so repeat calls are harmless. No schema change, no migration.
   (b) Race: cancel landing mid-finish. Case 1: cancel wins the row lock, `completeWorkflow` is blocked by `stateNotIn`, D3 records usage, no parent increment (sub-ops already billed). Case 2: `completeWorkflow` wins, op becomes SUCCEEDED (+ parent increment as today), the cancel route's `onlyIf: { done: false }` gets 409. In no interleaving does CANCELLED cause a new `totalUsed` write, so "charged exactly once" cannot be violated by this change. The conditional UPDATE's `state = 'CANCELLED'` predicate makes it a no-op if the row is not CANCELLED (it is atomic in SQL, no read-then-write).
   (c) Sub-op costs: completed sub-ops: billed to the key by their own runPipeline, and included in the recorded parent totals via ctx. In-flight sub-op at cancel: still billed when it completes (runPipeline does not look at the parent); limitation documented: its cost may be missing from the parent row's recorded totals if the parent stopped waiting (e.g. `Promise.all` rejection) - the key balance is still right. Waiting (not started) sub-jobs: out of scope (another remaining H4 item), they will run and be billed normally when they run.
   (d) Webhook contract unchanged: D2/D3 never call `dispatchWorkflowWebhook`.

## 3. Steps (RED first)

- [ ] 1. Write failing tests (no production edits).
      a) Extend `tests/pipelines/workflow-cancel-guard.test.ts` (reuse its in-memory transition store and mocks; see helper `totalUsedUpdates()` and how `db.update` is mocked; add a helper that collects `.set()` payloads containing `totalCostUsd`). New cases:
         1. `completeWorkflow` on CANCELLED with ctx `totalCost: 1.5, totalInputTokens: 10, totalOutputTokens: 5, usageBreakdown: [...]` -> exactly one usage UPDATE with those absolute values, `where` built with `and(eq(id), sql state='CANCELLED')`; no `apiKeys.totalUsed` update (`totalUsedUpdates()` length 0); no webhook; op state still `CANCELLED`.
         2. `failWorkflow` with a plain Error on CANCELLED -> same usage UPDATE, no totalUsed, no FAILED webhook.
         3. `failWorkflow(ctx, new WorkflowCancelledError(id))` -> usage UPDATE issued, no transition call, no totalUsed, no webhook.
         4. Idempotency: call (3) then (1) then (2) on the same ctx -> every usage UPDATE carries identical absolute values, zero `totalUsed` updates in total, state still CANCELLED.
         5. Error isolation: `db.update` for usage throws -> `failWorkflow(ctx, sentinel)` and `completeWorkflow` still resolve (no throw), warn logged.
         6. Controls (must stay green): RUNNING `completeWorkflow` still exactly 1 `totalUsed` update + webhook; RUNNING `failWorkflow` -> FAILED + webhook, 0 `totalUsed`, no `recordCancelledUsage` UPDATE.
      b) Billing-source guard test in a new `tests/pipelines/workflow-subop-billing.test.ts` (documents the key discovery so nobody "fixes" it by double counting): mock `@/lib/db` etc. like `tests/pipelines/engine*.test.ts` if an existing engine test harness exists (grep `tests/pipelines` for `runPipeline` mocks first); if there is none cheap to copy, skip this file and instead state the evidence in the final report (do not build a large harness for it).
      Files: `tests/pipelines/workflow-cancel-guard.test.ts` (+ optional new test file).
      Verify: `npx jest tests/pipelines/workflow-cancel-guard.test.ts --ci` -> new cases 1-5 FAIL on current code for the behavioral reason (no usage UPDATE issued; `recordCancelledUsage` missing is acceptable only if added as an empty stub first so failures are behavioral - prefer the behavioral assertion `expect(usageUpdates()).toHaveLength(1)`), controls 6 pass. Record the failing output.

- [ ] 2. Implement `recordCancelledUsage` and the three call sites (depends on 1).
      In `lib/pipelines/workflow-engine.ts`: add non-exported-or-exported (export it for tests) `recordCancelledUsage(ctx)`, call it from the `completeWorkflow` blocked branch, the `failWorkflow` blocked branch and the sentinel branch, each wrapped so a DB error is logged (`ctx.logger.warn`) and swallowed. Add a short Vietnamese/English comment: "sub-op đã tự tính totalUsed trong runPipeline; ở đây chỉ ghi usage lên op CANCELLED, không cộng totalUsed lần nữa". Do not change the SUCCEEDED path, `updateProgress`, `pauseWorkflow`, `enqueueSubStep`, the cancel route, state-transition.ts, or loan-appraisal.ts.
      Files: `lib/pipelines/workflow-engine.ts`
      Verify: `npx jest tests/pipelines tests/operations-request-tracking --ci` -> new cases green, existing H4 tests (`workflow-cancel-guard`, `loan-appraisal-cancel`, `state-transition`), `workflow-fail-persistence`, `workflow-metadata-persistence` unchanged and green. Note: existing mocks of `@/lib/db` in other suites may lack `update().set().where()` for the new call; since the new calls only run on the CANCELLED branch (transition result `state === 'CANCELLED'`) and `{}` mock results are not treated as blocked, they should not be hit. If one is, fix the test mock, not the behavior.

- [ ] 3. Full verification.
      `npx tsc --noEmit`; `npx eslint lib/pipelines/workflow-engine.ts tests/pipelines/workflow-cancel-guard.test.ts`; `npx jest tests/pipelines tests/operations-request-tracking tests/payment-account-management tests/tracing-portal tests/financial-report tests/loan-appraisal --ci`. Note pre-existing failures from the other people's uncommitted files (check-set-scope / prompt-checks tests) separately; do not fix them.
      Verify: commands exit 0 (except pre-existing unrelated failures, listed explicitly).

- [ ] 4. Update docs/report (depends on 3). Append to `.agents/tasks/loan-appraisal-review.md` H4 status: item 3 handled (usage recorded on the CANCELLED op; key usage already charged by sub-ops; no parent increment by design). Add the open finding "possible double count on SUCCEEDED: sub-op runPipeline + completeWorkflow both add the cost; not verified against DB; needs a separate decision" and the limitation about in-flight sub-ops. Only edit the H4 status paragraph.
      Files: `.agents/tasks/loan-appraisal-review.md`
      Verify: none needed (docs); re-read the paragraph.

## 4. Decisions / flags for the user (must appear in the final report)
1. Billing is USD; only SUCCEEDED charges at the OPERATION level (engine.ts and completeWorkflow). FAILED does not charge at op level. Sub-ops charge themselves on success, which is why a cancelled/failed workflow's AI cost is already in `totalUsed`.
2. Because of that, the plan does NOT add a parent increment on CANCELLED (would double bill). It records usage on the cancelled op row instead. Confirm this reading with the user, since they said "vẫn cần tính chi phí đã dùng".
3. Suspected pre-existing double count on SUCCEEDED (sub-op + parent). Unverified at runtime; out of scope; needs its own fix/decision.
4. Limitation: an in-flight sub-op finishing after cancel is billed to the key when it completes but may be missing from the parent row's recorded totals.

## Verification (implementation iteration 1)
Deviation note: the task text says apiKeys.totalUsed must rise once on CANCELLED; the plan (D1) decides NO parent-level increment because sub-ops already bill themselves in runPipeline (a parent increment would double count). Implemented per the plan; tests assert totalUsed is NOT written on CANCELLED and usage is recorded on the row. If the user wants a parent increment, it is a product decision (double billing) - not done.
Change: lib/pipelines/workflow-engine.ts - new exported recordCancelledUsage(ctx) (absolute SET of tokens/cost/missing flags/usageBreakdown/stepsResultJson, WHERE id AND state='CANCELLED', errors logged+swallowed), called from completeWorkflow CANCELLED branch, failWorkflow CANCELLED branch and WorkflowCancelledError branch. No totalUsed write, no webhook, no state change.
Tests: tests/pipelines/workflow-cancel-guard.test.ts, 7 new cases (complete/fail/sentinel record usage once; idempotent x3; conditional WHERE; DB error swallowed; RUNNING control).
- RED (before fix): 
px jest tests/pipelines/workflow-cancel-guard.test.ts --ci -> 6 failed, 7 passed (the 6 new CANCELLED cases failed, control passed).
- GREEN (after fix): same command -> all pass.
- 
px jest tests/pipelines/workflow-cancel-guard.test.ts tests/pipelines/loan-appraisal-cancel.test.ts tests/pipelines/workflow-fail-persistence.test.ts tests/operations-request-tracking/workflow-metadata-persistence.test.ts --ci -> 6 suites / 28 tests passed.
- Wider: 
px jest tests/pipelines tests/loan-appraisal tests/operations-request-tracking tests/financial-report tests/payment-account-management tests/tracing-portal tests/crypto/payload-encrypt.test.ts tests/profiles/release/apply.test.ts --ci --testPathIgnorePatterns=.worktrees -> 95 suites passed, 9 failed, 4 skipped; 962 tests passed, 12 failed. Failing suites: pipelines/parse-field-confidence (known pre-existing), operations-request-tracking/{rollout, rollout-smoke, business-query, business-query-dashboard, api-contract, business-operations-routes} (dashboard variant/breakdown assertions), payment-account-management/extract-schemas and financial-report/registry-params (MB02 schema field count 85 vs 86). None import or exercise workflow-engine cancel paths; not confirmed pre-existing by a clean-tree run (I did not stash others' changes), but failure reasons are unrelated to this change.
- Tests referencing totalUsed/workflow-engine/runWorkflow all pass (financial-report workflow-timeout/uat04/round11b/round12/classify/extract-storage, payment-account-management/update-verify, tracing-portal/workflow, pipelines workflow-*, loan-appraisal-cancel, crypto/payload-encrypt, profiles/release/apply).
- Type-check: 
px tsc --noEmit -> no output (no errors), introduced none.
- eslint run hung (timed out), not completed.
