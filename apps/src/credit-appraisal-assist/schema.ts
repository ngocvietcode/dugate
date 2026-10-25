import { z } from 'zod';

export const APP = 'credit-appraisal-assist';
export const APP_VERSION = '0.1.0';
export const REQUIRED_ROLES = ['CREDIT_APPRAISER', 'CREDIT_DATA_REVIEWER'] as const;

/** context của StartRunRequest cho App này (spec 002 FR-2). Dữ liệu nghiệp vụ chỉ đến từ đây (L6). */
export const Context = z.object({
  product: z.string().regex(/^[a-z0-9-]+@\d+\.\d+\.\d+$/).describe('cấu hình LAC, vd pp-hkd-secured@0.1.0'),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['STRICT', 'TRIAL']).default('STRICT'),
  interestRate: z.number().positive().max(1).optional().describe('lãi suất năm dạng số, vd 0.105'),
  requireApprovedConfig: z.boolean().default(false).describe('production: true'),
  extracted: z.union([
    z.object({ coreOperationId: z.string().min(1) }),
    z.object({ url: z.string().url() }),
  ]).describe('đầu ra DU v5 của hồ sơ (LAC-3: nguồn chờ chốt)'),
});
export type Context = z.infer<typeof Context>;

export const Outcome = z.enum(['PENDING_SUPPLEMENT', 'PROVISIONAL', 'ELIGIBLE_TO_SUBMIT']);
export type Outcome = z.infer<typeof Outcome>;

/** Kết luận nhánh 2 (sau khi code đã kiểm trích dẫn và con số). */
export const Conclusion = z.object({
  id: z.string().regex(/^K\d+$/),
  text: z.string().min(1),
  fields: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
  signals: z.array(z.string()).default([]),
});
export type Conclusion = z.infer<typeof Conclusion>;

export const Result = z.object({
  outcome: Outcome,
  conclusions: z.array(Conclusion.extend({ provisional: z.boolean(), conditions: z.array(z.string()) })),
  rejectedConclusions: z.array(z.object({ id: z.string(), reasons: z.array(z.string()) })),
  blocking: z.array(z.string()).describe('X#/mục checklist còn chặn'),
  lacRef: z.object({ config: z.string(), stats: z.record(z.string(), z.unknown()) }),
  trace: z.object({ promptRef: z.string(), coreOperations: z.array(z.string()), lacBuilds: z.number().int() }),
});
export type Result = z.infer<typeof Result>;
