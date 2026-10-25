import { z } from 'zod';

/** Người thực hiện hành động, do lớp xác thực của Apps điền (không lấy từ body). */
export const Actor = z.object({
  userId: z.string().min(1),
  roles: z.array(z.string()).default([]),
});
export type Actor = z.infer<typeof Actor>;

export const BusinessRef = z.object({
  system: z.string().min(1).describe('hệ thống gọi, vd LOS'),
  type: z.string().min(1).describe('loại hồ sơ, vd LOAN_APPLICATION'),
  id: z.string().min(1).describe('mã hồ sơ ở hệ thống gọi'),
});
export type BusinessRef = z.infer<typeof BusinessRef>;

export const Severity = z.enum(['S1', 'S2', 'S3', 'S4']);
export type Severity = z.infer<typeof Severity>;
