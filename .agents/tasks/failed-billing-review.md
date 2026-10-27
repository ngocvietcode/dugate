# FAILED operations charge their incurred AI cost in runPipeline

`runPipeline` now routes every `apiKeys.totalUsed` increment through one closure, `chargeIncurredCost`. It tracks `billedCostUsd` and charges only the not-yet-billed delta. The SUCCEEDED block uses it in place of the inline UPDATE, and the catch block calls it after the FAILED transition. Parent workflows (`failWorkflow`, `pauseWorkflow`, the CANCELLED paths) are untouched and charge nothing, so a FAILED parent cannot re-add what its sub-ops already charged. The change is confined to `engine.ts` and adds no schema change. I did not re-run the suites. The coder's recorded evidence is in the plan file: RED on F1/F3/F5/F6 for behavioral reasons, 14/14 GREEN after, the pipelines/loan-appraisal/operations-request-tracking regression run with only known pre-existing failures, and `tsc` exit 0.

Watch for: (1) the post-success-exception double-charge guard (F4) was green before the change too, so it is a guard rather than a RED proof (confirmed); (2) a single failed connector call carries no usage, so the common failed sub-op charges 0 (confirmed, by design); (3) `workflow-failure.test.ts` has an unrelated H1 (INPUT_INVALID) hunk bundled into the working tree (confirmed).

**Verdict**: APPROVED

## High-level view

The rule is "the operation that ran the AI call charges it once, whatever its final state". The leaf run in `runPipeline` is that operation. Parents own no AI spend, so FAILED, CANCELLED and PAUSED workflows do not charge. The increment count stays at two writers (`runPipeline` and the pre-existing `completeWorkflow`), so no third increment point exists.

Idempotency is in-process. It covers the SUCCEEDED-then-exception-then-catch sequence. Across BullMQ attempts each attempt measures only the steps it re-executed, so the charge is per real spend. A crash between the state write and the charge loses that charge. SUCCEEDED has the same window today.

FAILED only charges the known portion. Missing or unpriced cost adds 0 to the amount and is recorded through the existing row flags plus a `[BILLING]` warn log. Billing errors in the catch are swallowed and logged, so BullMQ does not retry and re-run paid steps.

The suspected SUCCEEDED double count, where `completeWorkflow` adds `ctx.totalCost` on top of sub-op charges, is unchanged. Test C1 pins it, and it is reported but not fixed.

## Issues (0 blocking, 3 non-blocking notes)

1. **Charge after transition can be lost (possible, non-blocking)**: if the FAILED `transitionOperationState` itself throws, the catch exits before the charge. BullMQ then retries, and an attempt that resumes skips the completed steps, so that spend is never billed. This is the same class as the crash window the plan already documented. No action needed; optionally charge before the transition.
2. **Unrelated hunk bundled (confirmed)**: `tests/pipelines/workflow-failure.test.ts` adds INPUT_INVALID classification cases from the earlier H1 task. The hunk is harmless. Keep it out of this change's commit.
3. **F4 is not a RED-on-old test (confirmed)**: it is a guard that passes before and after. The behavioral RED is carried by F1, F3, F5 and F6, which is sufficient.

<details>
<summary>Details</summary>

## Exactly-once across SUCCEEDED, FAILED and the post-success exception

`billedCostUsd` is incremented only after the UPDATE resolves. If the SUCCEEDED-block UPDATE throws, the catch retries the full amount. If the UPDATE succeeds and `updateProgress` or the webhook then throws, the catch sees delta 0 and charges nothing. On a first call the SQL is identical to the old inline UPDATE (`totalUsed + cost`), so SUCCEEDED behavior is unchanged. C2 pins this and is green before and after.

The catch computes `usage` from `usageMeasurements`, and the success block uses the same array, so both calls see the same total. The guards `!apiKeyId`, non-finite delta and `delta <= 0` prevent fabricated or negative charges.

## Attempts, resume and finish-function repeats

On a BullMQ rerun, `usageMeasurements` and `billedCostUsd` start fresh. Resume skips the steps restored from `stepsResultJson`, so only new spend is measured and charged (F5). Spend from an attempt that crashed before terminal is lost. This was already true, and the plan records it as a known gap.

`failWorkflow`, `pauseWorkflow` and `completeWorkflow` on CANCELLED/FAILED rows add nothing new (W1 to W4). The `workflow-engine.ts` diff is the previous H4 work and contains no new increment. H4 guards, `recordCancelledUsage` and the CANCELLED tests (`workflow-cancel-guard`, `loan-appraisal-cancel`) show no diff from this task. The two test files are untracked but unmodified by this task, per the plan.

## Unknown and unpriced cost

`summarizeOperationUsage` adds 0 for null or unpriced measurements and sets `costMissing` or `hasUnpricedCost`. F3 and F3b cover a 0.2 step mixed with an unpriced step (charge exactly 0.2) and all-unknown steps (no charge). The warn log plus the row flags make the partial charge explicit for reconciliation.

## Billing-error isolation

The catch wraps the charge in its own try/catch and logs `[BILLING] Failed to charge`. F6 asserts that `runPipeline` resolves and the FAILED transition and FAILED webhook still happen. The webhook payload path is untouched. `submit.ts` and the `spendingLimit` check are not in the diff.

## Behavioral consequences to carry to the user

Keys with a `spendingLimit` reach the 402 threshold sooner because failed runs now count. `billing/usage` stays SUCCEEDED-only and will no longer sum to `totalUsed`. The SUCCEEDED workflow double count remains, with options (leave, drop the `completeWorkflow` increment, stop sub-ops charging) left for the user.

## Scope and hygiene

Affected scope is every operation executed through `runPipeline`: all standalone pipelines and the 12 registry workflows' sub-steps. Git status shows no commit or new stage from this task. The pre-staged entries (`LoanCheckSetPanel`, `check-set`, `prompt-checks` and others) and `.worktrees/` belong to other people and were not touched.

Not independently verified: I did not re-run the tests or `tsc`, and I relied on the coder's recorded output. I did not run the DB-level behavior, because all tests are mocked.

</details>

<details>
<summary>File map</summary>

- `lib/pipelines/engine.ts`: `chargeIncurredCost` closure, SUCCEEDED block uses it, FAILED catch charges and logs.
- `tests/pipelines/run-pipeline-billing.test.ts` (new): C2, F1 to F7.
- `tests/pipelines/workflow-failed-billing.test.ts` (new): W1 to W4, C1.
- `tests/pipelines/workflow-failure.test.ts`: unrelated INPUT_INVALID cases (H1).

Full diff: `git -C d:\Jobs\dugate diff`

</details>
