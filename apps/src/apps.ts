// Registry các App (server dùng để kiểm context và start workflow đúng loại).
import type { Duration } from '@temporalio/common';
import type { ZodType } from 'zod';
import type { StartRunRequest } from './platform/contract';
import { Context as CaaContext } from './credit-appraisal-assist/schema';
import type { CreditAppraisalInput } from './credit-appraisal-assist/workflow';

export interface AppDef {
  name: string;
  version: string;
  workflowType: string;
  context: ZodType;
  outcomes: string[];
  buildInput(req: StartRunRequest, ctx: unknown, runId: string, caller: string, env: AppEnv): unknown;
}
export interface AppEnv { lacTaskQueue: string; reviewTimeout: Duration }

export const APPS: Record<string, AppDef> = {
  'credit-appraisal-assist': {
    name: 'credit-appraisal-assist', version: '0.1.0', workflowType: 'creditAppraisalAssist', context: CaaContext,
    outcomes: ['PENDING_SUPPLEMENT', 'PROVISIONAL', 'ELIGIBLE_TO_SUBMIT'],
    buildInput: (req, ctx, runId, caller, env): CreditAppraisalInput => ({
      runId, caller, businessRef: req.businessRef, makerUserId: req.review.makerUserId, reviewMode: req.review.mode,
      callback: req.callback, context: ctx as CreditAppraisalInput['context'], lacTaskQueue: env.lacTaskQueue,
      reviewTimeout: env.reviewTimeout,
    }),
  },
};
