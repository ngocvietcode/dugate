import { z } from 'zod';
import { Severity } from './common';

/** Bằng chứng trỏ về chứng từ (LAYERED_ARCHITECTURE §5.2). page/bbox có khi Core trả (C6). */
export const Evidence = z.object({
  documentId: z.string(),
  page: z.number().int().positive().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  quote: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Finding = z.object({
  code: z.string().describe('mã quy tắc, vd R-CIC-SUBJECT, R-X-LTV-MARGIN'),
  kind: z.enum(['DISCREPANCY', 'SIGNAL', 'CHECKLIST']),
  severity: Severity.nullable().describe('null với tín hiệu chéo vùng (không chặn)'),
  message: z.string(),
  evidence: z.array(Evidence),
  refs: z.object({
    facts: z.array(z.string()).default([]),
    discrepancies: z.array(z.string()).default([]),
    signals: z.array(z.string()).default([]),
  }),
  rule: z.object({ id: z.string(), configRef: z.string() }),
});
export type Finding = z.infer<typeof Finding>;
