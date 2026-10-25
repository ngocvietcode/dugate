import { ApplicationFailure } from '@temporalio/activity';
import { CoreClient, CoreClientError } from '../platform/core-client';
import type { Context } from './schema';

/** Lấy đầu ra DU v5 của hồ sơ (LAC-3: nguồn chờ chốt) — từ Operation của Core hoặc URL đã đăng ký. */
export function createCaseActivities(o: { core: CoreClient; allowedSourceHosts: string[]; fetchImpl?: typeof fetch }) {
  const f = o.fetchImpl ?? fetch;
  return {
    async loadCase(src: Context['extracted']): Promise<unknown> {
      if ('coreOperationId' in src) {
        try {
          const op = await o.core.getOperation(src.coreOperationId);
          if (!op.done || op.metadata.state !== 'SUCCEEDED' || op.result?.extracted_data == null) {
            throw ApplicationFailure.nonRetryable(`Operation ${src.coreOperationId} chưa có kết quả trích xuất (${op.metadata.state})`,
              'SourceNotReady');
          }
          return op.result.extracted_data;
        } catch (e) {
          if (e instanceof CoreClientError && !e.retryable) throw ApplicationFailure.nonRetryable(e.message, 'SourceRejected');
          throw e;
        }
      }
      const u = new URL(src.url);
      if (u.protocol !== 'https:' || !o.allowedSourceHosts.includes(u.hostname)) {
        throw ApplicationFailure.nonRetryable(`nguồn ${u.hostname} chưa được đăng ký`, 'SourceNotAllowed');
      }
      const res = await f(src.url, { signal: AbortSignal.timeout(60_000) });
      if (res.status >= 400 && res.status < 500) throw ApplicationFailure.nonRetryable(`nguồn trả ${res.status}`, 'SourceRejected');
      if (!res.ok) throw new Error(`nguồn trả ${res.status}`);
      return res.json();
    },
  };
}
export type CaseActivities = ReturnType<typeof createCaseActivities>;
