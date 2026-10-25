// Workflow thử cho workflow-kit: chờ quyết định cho các task, trả danh sách đã nhận.
import type { Duration } from '@temporalio/common';
import { ProgressState, ReviewInbox } from '../../src/platform/workflow-kit';

export async function reviewProbe(input: { maker: string; tasks: string[]; timeout: Duration }): Promise<string[]> {
  const open = new Set(input.tasks);
  const progress = new ProgressState();
  const inbox = new ReviewInbox({ makerUserId: input.maker, requiredRoles: ['CREDIT_APPRAISER'],
    isOpenTask: (t) => open.has(t) });
  progress.set({ status: 'WAITING_REVIEW', openTasks: open.size });
  const got: string[] = [];
  while (open.size) {
    const d = await inbox.next(input.timeout);
    if (!d) return [...got, 'TIMEOUT'];
    open.delete(d.taskId);
    got.push(`${d.taskId}:${d.action}:${d.actor.userId}`);
    progress.set({ openTasks: open.size });
  }
  progress.set({ status: 'COMPLETED' });
  return got;
}
