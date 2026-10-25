// Hộp nhận quyết định soát cho workflow (tất định). Update có validator: quyết định không hợp lệ bị từ chối
// TRƯỚC khi vào history, nên không cần "hoàn tác".
import { ApplicationFailure, condition, defineUpdate, setHandler } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type { Actor, ReviewDecisionBody } from '../contract';
import { checkerViolation } from '../security/maker-checker';

export interface DecisionInput extends ReviewDecisionBody { taskId: string; actor: Actor; at: string }
export interface DecisionAck { accepted: true; taskId: string; seq: number }

export const submitDecision = defineUpdate<DecisionAck, [DecisionInput]>('submitDecision');

export interface ReviewInboxOptions {
  makerUserId: string;
  requiredRoles: readonly string[];
  /** task còn mở mà workflow đang chờ; validator dùng để từ chối quyết định cho task không tồn tại / đã xong */
  isOpenTask: (taskId: string) => boolean;
  /** kiểm nghiệp vụ riêng của App (vd chỉ lỗi A mới được CORRECT_VALUE); trả lý do từ chối hoặc null */
  validate?: (d: DecisionInput) => string | null;
}

export class ReviewInbox {
  private readonly queue: DecisionInput[] = [];
  private seq = 0;

  constructor(o: ReviewInboxOptions) {
    setHandler(submitDecision, (d) => {
      this.queue.push(d);
      return { accepted: true, taskId: d.taskId, seq: ++this.seq };
    }, {
      validator: (d) => {
        const why = checkerViolation(d.actor, o.makerUserId, o.requiredRoles)
          ?? (o.isOpenTask(d.taskId) ? null : `task ${d.taskId} không mở`)
          ?? o.validate?.(d) ?? null;
        if (why) throw ApplicationFailure.nonRetryable(why, 'DecisionRejected');
      },
    });
  }

  /** Lấy quyết định kế tiếp; null nếu hết thời gian chờ. */
  async next(timeout: Duration): Promise<DecisionInput | null> {
    const ok = await condition(() => this.queue.length > 0, timeout);
    return ok ? this.queue.shift()! : null;
  }

  pending(): number {
    return this.queue.length;
  }
}
