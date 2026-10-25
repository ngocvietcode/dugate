import { ApplicationFailure, Context, sleep } from '@temporalio/activity';
import { CoreClient, CoreClientError, type CoreService, type FileUrlEntry, operationId } from '../core-client';

export interface CallCoreInput {
  runId: string;
  stepKey: string;              // khoá ổn định của bước trong run -> idempotency
  service: CoreService;
  sub: string;
  params?: Record<string, string>;
  fileUrls?: FileUrlEntry[];
  correlationId?: string;
}

export interface CallCoreResult {
  operationId: string;
  content: string | null;
  extractedData: unknown;
  usage: { inputTokens: number; outputTokens: number; model: string | null; costUsd: number };
}

/**
 * Gửi một lệnh tới Core rồi chờ Operation xong (poll + heartbeat).
 * Idempotency-Key = runId:stepKey nên Temporal retry hay worker restart không tạo Operation trùng (spec 002 NFR-3).
 */
export function createCoreActivities(client: CoreClient, opts: { pollMs?: number } = {}) {
  const pollMs = opts.pollMs ?? 2_000;
  return {
    async callCore(input: CallCoreInput): Promise<CallCoreResult> {
      const ctx = Context.current();
      const key = `${input.runId}:${input.stepKey}`;
      let opId = (ctx.info.heartbeatDetails as { operationId?: string } | undefined)?.operationId;
      try {
        if (!opId) {
          const op = await client.submit({ service: input.service, sub: input.sub, params: input.params,
            fileUrls: input.fileUrls, idempotencyKey: key, correlationId: input.correlationId ?? input.runId });
          opId = operationId(op);
        }
        for (;;) {
          ctx.heartbeat({ operationId: opId });
          const op = await client.getOperation(opId);
          if (op.done) {
            if (op.metadata.state !== 'SUCCEEDED') {
              throw ApplicationFailure.nonRetryable(
                `Core operation ${opId} ${op.metadata.state}: ${op.error?.message ?? ''}`, 'CoreOperationFailed',
                { operationId: opId, code: op.error?.code ?? null });
            }
            const u = op.result?.usage ?? {};
            return { operationId: opId, content: op.result?.content ?? null, extractedData: op.result?.extracted_data ?? null,
              usage: { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, model: u.model_used ?? null,
                costUsd: u.cost_usd ?? 0 } };
          }
          await sleep(pollMs);
        }
      } catch (e) {
        if (e instanceof CoreClientError && !e.retryable) {
          throw ApplicationFailure.nonRetryable(e.message, 'CoreRequestRejected', { status: e.status });
        }
        throw e;
      }
    },
  };
}
export type CoreActivities = ReturnType<typeof createCoreActivities>;
