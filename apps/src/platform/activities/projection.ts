import { and, eq, sql } from 'drizzle-orm';
import { type AuditInput, appendAudit } from '../audit';
import type { ReviewTask } from '../contract';
import type { Db } from '../db';
import { appRun, reviewTask } from '../db/schema';

export interface RunPatch {
  status?: string;
  outcome?: string | null;
  progress?: { percent: number; message: string };
  findings?: unknown[];
  result?: unknown;
  error?: { code: string; message: string } | null;
}

/** Projection AppRun/ReviewTask cho API và UI; nguồn sự thật vẫn là workflow (ARCHITECTURE_V5 §3.2). */
export function createProjectionActivities(db: Db) {
  return {
    async updateRun(runId: string, patch: RunPatch): Promise<void> {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.outcome !== undefined) set.outcome = patch.outcome;
      if (patch.progress) { set.progressPercent = patch.progress.percent; set.progressMessage = patch.progress.message; }
      if (patch.findings !== undefined) set.findings = patch.findings;
      if (patch.result !== undefined) set.result = patch.result;
      if (patch.error !== undefined) set.error = patch.error;
      await db.update(appRun).set(set).where(eq(appRun.runId, runId));
    },

    /** Tạo task mới; task đã có giữ nguyên trạng thái. Cập nhật open_tasks. */
    async syncTasks(runId: string, tasks: Omit<ReviewTask, 'status'>[]): Promise<void> {
      for (const t of tasks) {
        await db.insert(reviewTask).values({ taskId: t.taskId, runId, kind: t.kind, ref: t.ref, severity: t.severity,
          title: t.title }).onConflictDoNothing();
      }
      await db.update(appRun).set({
        openTasks: sql`(SELECT count(*)::int FROM apps.review_task WHERE run_id = ${runId} AND status = 'OPEN')`,
        updatedAt: new Date(),
      }).where(eq(appRun.runId, runId));
    },

    async closeTask(runId: string, taskId: string, decidedBy: string, decision: unknown): Promise<void> {
      await db.update(reviewTask).set({ status: 'DONE', decidedBy, decision: decision as object, doneAt: new Date() })
        .where(and(eq(reviewTask.runId, runId), eq(reviewTask.taskId, taskId)));
      await db.update(appRun).set({
        openTasks: sql`(SELECT count(*)::int FROM apps.review_task WHERE run_id = ${runId} AND status = 'OPEN')`,
      }).where(eq(appRun.runId, runId));
    },

    async audit(e: AuditInput): Promise<string> {
      return appendAudit(db, e);
    },
  };
}
export type ProjectionActivities = ReturnType<typeof createProjectionActivities>;
