// Workflow App Hỗ trợ thẩm định — vay hộ kinh doanh có TSBĐ (spec 002). CHỈ logic tất định (constitution §10):
// mọi side effect qua activity; LAC chạy ở worker Python (task queue riêng).
import {
  ApplicationFailure, CancellationScope, isCancellation, proxyActivities, workflowInfo,
} from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type { CoreActivities, ProjectionActivities, WebhookActivities } from '../platform/activities';
import type { BusinessRef, RunEvent, RunEventType, RunStatus } from '../platform/contract';
import { ProgressState, ReviewInbox } from '../platform/workflow-kit';
import { type Lac, LacSchema } from '../generated/lac.zod';
import type { CaseActivities } from './activities';
import { findingsFromLac } from './findings';
import {
  applyDecision, decisionViolation, emptyOverrides, merge, reconcile, type Resolution, reviewTasks, type TaskSpec,
} from './merge';
import { BRANCH2_PROMPT_REF, branch2Prompt } from './prompts';
import { APP, type Conclusion, Conclusion as ConclusionSchema, type Context, REQUIRED_ROLES, type Result } from './schema';
import { buildVerifyContext, parseConclusions, verifyConclusion } from './verify';

export interface CreditAppraisalInput {
  runId: string;
  caller: string;
  businessRef: BusinessRef;
  makerUserId: string;
  reviewMode: 'DELEGATED' | 'EMBEDDED' | 'NONE';
  callback?: { url: string; events: RunEventType[] };
  context: Context;
  lacTaskQueue: string;
  reviewTimeout: Duration;
}

const core = proxyActivities<CoreActivities>({
  startToCloseTimeout: '15 minutes', heartbeatTimeout: '1 minute',
  retry: { initialInterval: '5 seconds', maximumAttempts: 6, nonRetryableErrorTypes: ['CoreRequestRejected', 'CoreOperationFailed'] },
});
const sys = proxyActivities<ProjectionActivities & WebhookActivities & CaseActivities>({
  startToCloseTimeout: '1 minute', retry: { initialInterval: '2 seconds', maximumAttempts: 10 },
});

export async function creditAppraisalAssist(input: CreditAppraisalInput): Promise<Result> {
  const { runId, context: ctx } = input;
  const lacAct = proxyActivities<{ lacBuild(p: unknown): Promise<unknown> }>({
    taskQueue: input.lacTaskQueue, startToCloseTimeout: '2 minutes', retry: { maximumAttempts: 5 },
  });
  const progress = new ProgressState();
  const overrides = emptyOverrides();
  const ledger: Record<string, Resolution> = {};
  const done = new Set<string>();
  let tasks = new Map<string, TaskSpec>();
  let lac: Lac | undefined;
  let conclusions: Conclusion[] = [];
  const rejected: { id: string; reasons: string[] }[] = [];
  const coreOps: string[] = [];
  let builds = 0;
  let branch2Calls = 0;
  let eventSeq = 0;
  const now = () => new Date().toISOString();

  const emit = async (type: RunEventType, status: RunStatus, outcome: string | null) => {
    if (!input.callback?.events.includes(type)) return;
    const event: RunEvent = { type, runId, app: APP, businessRef: input.businessRef, status, outcome, at: now() };
    await sys.deliverWebhook({ url: input.callback.url, event, eventId: `${runId}:${++eventSeq}` });
  };

  const build = async (): Promise<Lac> => {
    builds++;
    const raw = await lacAct.lacBuild({ case: du, refDate: ctx.referenceDate, config: ctx.product,
      interestRate: ctx.interestRate ?? null, overrides, requireApproved: ctx.requireApprovedConfig });
    const parsed = LacSchema.safeParse(raw);
    if (!parsed.success) throw ApplicationFailure.nonRetryable('lac.json sai contract', 'LacContractViolation');
    return parsed.data;
  };

  /** Nhánh 2: hỏi AIHub qua Core trên bản trích LAC; code kiểm từng kết luận (FR-20..23). */
  const branch2 = async (l: Lac, opts: { onlyIds?: string[]; previous?: Conclusion[]; newConflicts?: string[] } = {}) => {
    const r = await core.callCore({ runId, stepKey: `branch2:${++branch2Calls}`, service: 'generate', sub: 'qa',
      params: { questions: branch2Prompt(opts) },
      files: [{ name: 'lac-branch2.md', content: l.branch2.markdown, type: 'text/markdown' }] });
    coreOps.push(r.operationId);
    const vctx = buildVerifyContext(l);
    const ok: Conclusion[] = [];
    for (const item of parseConclusions(r.content, r.extractedData)) {
      const p = ConclusionSchema.safeParse(item);
      if (!p.success) { rejected.push({ id: String((item as { id?: unknown })?.id ?? '?'), reasons: ['sai định dạng'] }); continue; }
      const why = verifyConclusion(p.data, vctx);
      if (why.length) rejected.push({ id: p.data.id, reasons: why }); else ok.push(p.data);
    }
    return ok;
  };

  const publish = async (status: RunStatus, message: string) => {
    const m = merge(lac!, ledger, conclusions);
    progress.set({ status, message, openTasks: [...tasks.keys()].filter((t) => !done.has(t)).length });
    await sys.updateRun(runId, { status, outcome: m.outcome, progress: { percent: progress.value.percent, message },
      findings: findingsFromLac(lac!) });
    return m;
  };

  let du: unknown;
  try {
    progress.set({ percent: 5, message: 'Đọc dữ liệu trích xuất' });
    await sys.updateRun(runId, { status: 'RUNNING', progress: { percent: 5, message: 'Đọc dữ liệu trích xuất' } });
    await sys.audit({ runId, actor: input.caller, action: 'run.start', object: runId,
      after: { businessRef: input.businessRef, product: ctx.product, mode: ctx.mode, maker: input.makerUserId }, at: now() });
    await emit('run.started', 'RUNNING', null);
    du = await sys.loadCase(ctx.extracted);

    progress.set({ percent: 20, message: 'Dựng Loan Application Context' });
    lac = await build();
    const p1 = lac.case.phase1 as { status: string } | null;
    if (ctx.mode === 'STRICT' && p1?.status === 'INCOMPLETE') {
      const m = merge(lac, ledger, []);
      return await finish(m, 'Hồ sơ chưa đủ (Giai đoạn 1): trả RM bổ sung');
    }

    progress.set({ percent: 40, message: 'Thẩm định nhánh 2 và soát dữ liệu nhánh 1' });
    const firstBranch2 = branch2(lac);
    const initial = input.reviewMode === 'NONE' ? [] : reviewTasks(lac, runId);
    tasks = new Map(initial.map((t) => [t.taskId, t]));
    if (initial.length) {
      await sys.syncTasks(runId, initial.map((t) => ({ ...t, runId })));
      await publish('WAITING_REVIEW', `Chờ soát ${initial.length} điểm`);
      await emit('run.review_required', 'WAITING_REVIEW', null);
    }
    conclusions = await firstBranch2;
    if (initial.length) await publish('WAITING_REVIEW', `Chờ soát ${initial.length} điểm`); // outcome có kết luận nhánh 2

    const inbox = new ReviewInbox({
      makerUserId: input.makerUserId, requiredRoles: REQUIRED_ROLES,
      isOpenTask: (t) => tasks.has(t) && !done.has(t),
      validate: (d) => decisionViolation(d, tasks.get(d.taskId), lac!),
    });

    while ([...tasks.keys()].some((t) => !done.has(t))) {
      const d = await inbox.next(input.reviewTimeout);
      if (!d) throw ApplicationFailure.nonRetryable('quá hạn soát dữ liệu', 'REVIEW_TIMEOUT');
      const task = tasks.get(d.taskId)!;
      const before = JSON.stringify(overrides);
      applyDecision(overrides, ledger, d, task, lac);
      done.add(d.taskId);
      await sys.closeTask(runId, d.taskId, d.actor.userId, { action: d.action, newClass: d.newClass ?? null,
        field: d.field ?? null, reason: d.reason });
      await sys.audit({ runId, actor: d.actor.userId, action: `review.${d.action}`, object: task.ref,
        before: { title: task.title }, after: { newClass: d.newClass ?? null, field: d.field ?? null, value: d.value ?? null,
          resolution: ledger[task.ref] ?? null }, reason: d.reason, at: d.at });

      if (JSON.stringify(overrides) !== before) {
        const prev = lac;
        lac = await build();
        const r = reconcile(prev, lac, conclusions);
        conclusions = r.conclusions;
        if (r.affected.length || r.newConflicts.length) {
          const redo = await branch2(lac, { onlyIds: r.affected, previous: conclusions.filter((k) => r.affected.includes(k.id)),
            newConflicts: r.newConflicts });
          conclusions = [...conclusions.filter((k) => !r.affected.includes(k.id)), ...redo.filter((k) => !conclusions.some(
            (c) => c.id === k.id && !r.affected.includes(k.id)))].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
        }
        const fresh = reviewTasks(lac, runId, done).filter((t) => !tasks.has(t.taskId));
        for (const t of fresh) tasks.set(t.taskId, t);
        if (fresh.length) await sys.syncTasks(runId, fresh.map((t) => ({ ...t, runId })));
      }
      const open = [...tasks.keys()].filter((t) => !done.has(t)).length;
      const m = await publish(open ? 'WAITING_REVIEW' : 'RUNNING', open ? `Còn ${open} điểm chờ soát` : 'Đã soát xong');
      await emit('run.updated', open ? 'WAITING_REVIEW' : 'RUNNING', m.outcome);
    }
    return await finish(merge(lac, ledger, conclusions), 'Hoàn tất');
  } catch (e) {
    if (isCancellation(e)) {
      await CancellationScope.nonCancellable(async () => {
        await sys.updateRun(runId, { status: 'CANCELLED', progress: { percent: progress.value.percent, message: 'Đã huỷ' } });
        await sys.audit({ runId, actor: input.caller, action: 'run.cancel', object: runId, at: now() });
        await emit('run.cancelled', 'CANCELLED', null);
      });
      throw e;
    }
    const err = e as ApplicationFailure & { cause?: ApplicationFailure };
    const code = err.type ?? err.cause?.type ?? 'RUN_FAILED';
    await sys.updateRun(runId, { status: 'FAILED', error: { code, message: err.cause?.message ?? err.message } });
    await emit('run.failed', 'FAILED', null);
    throw e;
  }

  async function finish(m: ReturnType<typeof merge>, message: string): Promise<Result> {
    const result: Result = {
      outcome: m.outcome, conclusions: m.conclusions, rejectedConclusions: rejected, blocking: m.blocking,
      lacRef: { config: `${lac!.case.config.product}@${lac!.case.config.version}`, stats: lac!.stats },
      trace: { promptRef: BRANCH2_PROMPT_REF, coreOperations: coreOps, lacBuilds: builds },
    };
    progress.set({ status: 'COMPLETED', percent: 100, message });
    await sys.updateRun(runId, { status: 'COMPLETED', outcome: m.outcome, progress: { percent: 100, message },
      findings: findingsFromLac(lac!), result: { ...result, lac } });
    await sys.audit({ runId, actor: 'system', action: 'run.complete', object: runId,
      after: { outcome: m.outcome, blocking: m.blocking.length, workflowRunId: workflowInfo().runId }, at: now() });
    await emit('run.completed', 'COMPLETED', m.outcome);
    return result;
  }
}
