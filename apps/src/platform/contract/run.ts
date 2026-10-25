import { z } from 'zod';
import { BusinessRef } from './common';
import { Finding } from './finding';
import { ReviewMode } from './review';

export const RunEventType = z.enum(['run.started', 'run.review_required', 'run.updated', 'run.completed', 'run.failed',
  'run.cancelled']);
export type RunEventType = z.infer<typeof RunEventType>;

/** Body chung của POST /apps/v1/{app}/runs. `context` do schema riêng của từng App kiểm. */
export const StartRunRequest = z.object({
  requestId: z.string().min(1).max(200).describe('idempotency theo (caller, app, requestId)'),
  businessRef: BusinessRef,
  documents: z.array(z.object({ url: z.string().url(), docTypeHint: z.string().optional() })).default([]),
  context: z.record(z.string(), z.unknown()),
  review: z.object({ mode: ReviewMode.default('DELEGATED'), makerUserId: z.string().min(1) }),
  callback: z.object({ url: z.string().url(), events: z.array(RunEventType).min(1) }).optional(),
});
export type StartRunRequest = z.infer<typeof StartRunRequest>;

export const RunStatus = z.enum(['RUNNING', 'WAITING_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunView = z.object({
  runId: z.string(),
  app: z.string(),
  appVersion: z.string(),
  businessRef: BusinessRef,
  status: RunStatus,
  outcome: z.string().nullable().describe('trạng thái hồ sơ theo App; KHÔNG phải quyết định cho vay'),
  progress: z.object({ percent: z.number().min(0).max(100), message: z.string() }),
  findings: z.array(Finding),
  openTasks: z.number().int(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RunView = z.infer<typeof RunView>;

export const RunEvent = z.object({
  type: RunEventType,
  runId: z.string(),
  app: z.string(),
  businessRef: BusinessRef,
  status: RunStatus,
  outcome: z.string().nullable(),
  at: z.string(),
});
export type RunEvent = z.infer<typeof RunEvent>;
