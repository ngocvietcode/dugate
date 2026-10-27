// Tham số Fellegi-Sunter của S3 (T-FS-02; FS-R09, FS-R12). Catalog hỏng → `ok: false`, người gọi chạy luật cũ, không đoán.
import { z } from 'zod';

import raw from '../../catalog/data/fs_params.json';

/** Mức của từng trường so sánh (spec s3_fellegi_sunter.md §3.2). `MISSING` / `NOT_APPLICABLE` không có tham số: trọng số 0. */
export const FS_LEVELS = {
  id_number: ['AGREE', 'OLD_NEW', 'NEAR', 'DISAGREE'],
  full_name: ['EXACT', 'REORDERED', 'SPELLING_DIFFERENCE', 'NO_MATCH'],
  date_of_birth: ['AGREE', 'DAY_MONTH_SWAPPED', 'DISAGREE'],
  gender: ['AGREE', 'DISAGREE'],
  permanent_address: ['AGREE', 'SAME_PROVINCE', 'DISAGREE'],
  id_structure: ['CONSISTENT', 'INCONSISTENT'],
} as const;

export type FsField = keyof typeof FS_LEVELS;

const Prob = z.number().gt(0).lte(1);
const Level = z.object({ m: Prob, u: Prob }).strict();
const comparison = <T extends readonly [string, ...string[]]>(levels: T) => z.object(Object.fromEntries(levels.map((l) => [l, Level])) as { [K in T[number]]: typeof Level })
  .strict()
  .refine((c) => {
    const levels = Object.values(c as Record<string, { m: number; u: number }>);
    return (['m', 'u'] as const).every((k) => Math.abs(levels.reduce((n, v) => n + v[k], 0) - 1) <= 0.01);
  }, 'Σm và Σu của mỗi trường phải ≈ 1');

export const FsParamsSchema = z.object({
  params_version: z.string().min(1),
  source: z.enum(['EXPERT', 'SPLINK']),
  estimated_at: z.string().nullable(),
  dataset_ref: z.string().nullable(),
  prior_match_probability: z.number().gt(0).lt(1),
  thresholds: z.object({ upper: z.number(), lower: z.number(), ambiguity_margin: z.number().min(0) }).strict()
    .refine((t) => t.upper > t.lower, 'upper phải > lower'),
  comparisons: z.object({
    id_number: comparison(FS_LEVELS.id_number),
    full_name: comparison(FS_LEVELS.full_name),
    date_of_birth: comparison(FS_LEVELS.date_of_birth),
    gender: comparison(FS_LEVELS.gender),
    permanent_address: comparison(FS_LEVELS.permanent_address),
    id_structure: comparison(FS_LEVELS.id_structure),
  }).strict(),
}).strict();

export type FsParams = z.infer<typeof FsParamsSchema>;

export type FsParamsResult = { ok: true; params: FsParams } | { ok: false; reason: string };

export function parseFsParams(input: unknown): FsParamsResult {
  const parsed = FsParamsSchema.safeParse(input);
  // Lý do chỉ nêu đường dẫn trường lỗi; catalog không có PII nhưng giữ thói quen không đưa giá trị vào thông báo.
  return parsed.success ? { ok: true, params: parsed.data } : { ok: false, reason: parsed.error.issues.map((i) => i.path.join('.') || i.message).join(', ') };
}

export const loadFsParams = (): FsParamsResult => parseFsParams(raw);
