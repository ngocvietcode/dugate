// tests/queue/select-workflow-queue.test.ts
// E4 phương án A (docs/WORKFLOW-SUSPEND-DESIGN.md §3): job workflow sang queue `workflow`, nhưng chỉ khi đã có worker nghe.
// Deploy web trước worker (hoặc worker group chưa nâng cấp) thì job về queue pipeline — worker pipeline vẫn chạy được workflow.

jest.mock('@/lib/queue/redis', () => ({ createRedisConnection: () => ({}) }));
jest.mock('@/lib/db', () => ({ db: {} }));
jest.mock('@/lib/db/schema', () => ({ apiKeys: {}, workerGroups: {} }));
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(), raw: jest.fn() };
jest.mock('@/lib/logger', () => ({ Logger: jest.fn(() => logger) }));

import type { Queue } from 'bullmq';
import { selectWorkflowQueue, type RouteResult } from '@/lib/queue/worker-group-router';

function route(workflowWorkers: number | Error): RouteResult {
  const queue = { name: 'pipeline.g' } as unknown as Queue;
  const workflowQueue = {
    name: 'workflow.g',
    getWorkersCount: async () => {
      if (workflowWorkers instanceof Error) throw workflowWorkers;
      return workflowWorkers;
    },
  } as unknown as Queue;
  return {
    queue, queueName: 'pipeline.g',
    workflowQueue, workflowQueueName: 'workflow.g',
  } as unknown as RouteResult;
}

beforeEach(() => jest.clearAllMocks());

describe('selectWorkflowQueue', () => {
  it('uses the workflow queue once a worker listens on it', async () => {
    const r = route(1);
    await expect(selectWorkflowQueue(r)).resolves.toEqual({ queue: r.workflowQueue, queueName: 'workflow.g' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the pipeline queue when no worker listens yet', async () => {
    const r = route(0);
    await expect(selectWorkflowQueue(r)).resolves.toEqual({ queue: r.queue, queueName: 'pipeline.g' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the pipeline queue when the worker count cannot be read', async () => {
    const r = route(new Error('ECONNREFUSED'));
    await expect(selectWorkflowQueue(r)).resolves.toEqual({ queue: r.queue, queueName: 'pipeline.g' });
  });
});
