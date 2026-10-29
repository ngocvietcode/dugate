// Tham số Fellegi-Sunter nối tài sản BĐS (D-117; spec s3_fellegi_sunter.md §9). Catalog hỏng → `ok: false`, người gọi chạy luật cũ.
import { z } from 'zod';

import raw from '../../catalog/data/asset_fs_params.json';

/**
 * Mức của từng trường so sánh tài sản. `MISSING` không có tham số: trọng số 0 (thiếu không phải bất đồng).
 * Thửa/tờ, căn/tòa không chấm: trùng đã là khóa chính xác, khác là điều kiện loại trừ cứng (asset-group `FS_VETO_FIELDS`).
 */
export const ASSET_FS_LEVELS = {
  certificate_number: ['AGREE', 'NEAR', 'DISAGREE'],
  certificate_book_number: ['AGREE', 'DIGITS_AGREE', 'DISAGREE'],
  owner: ['AGREE', 'DISAGREE'],
  /** `DISAGREE` chỉ để Σm = Σu = 1; chưa phát sinh cho tới khi có bảng địa danh 2025 (OQ-FS-04). */
  address: ['AGREE', 'DISAGREE'],
} as const;

export type AssetFsField = keyof typeof ASSET_FS_LEVELS;

const Prob = z.number().gt(0).lte(1);
const Level = z.object({ m: Prob, u: Prob }).strict();
const comparison = <T extends readonly [string, ...string[]]>(levels: T) => z.object(Object.fromEntries(levels.map((l) => [l, Level])) as { [K in T[number]]: typeof Level })
  .strict()
  .refine((c) => {
    const levels = Object.values(c as Record<string, { m: number; u: number }>);
    return (['m', 'u'] as const).every((k) => Math.abs(levels.reduce((n, v) => n + v[k], 0) - 1) <= 0.01);
  }, 'Σm và Σu của mỗi trường phải ≈ 1');

export const AssetFsParamsSchema = z.object({
  params_version: z.string().min(1),
  source: z.enum(['EXPERT', 'ESTIMATED']),
  estimated_at: z.string().nullable(),
  dataset_ref: z.string().nullable(),
  thresholds: z.object({ upper: z.number(), lower: z.number() }).strict().refine((t) => t.upper > t.lower, 'upper phải > lower'),
  comparisons: z.object({
    certificate_number: comparison(ASSET_FS_LEVELS.certificate_number),
    certificate_book_number: comparison(ASSET_FS_LEVELS.certificate_book_number),
    owner: comparison(ASSET_FS_LEVELS.owner),
    address: comparison(ASSET_FS_LEVELS.address),
  }).strict(),
}).strict();

export type AssetFsParams = z.infer<typeof AssetFsParamsSchema>;

export type AssetFsParamsResult = { ok: true; params: AssetFsParams } | { ok: false; reason: string };

export function parseAssetFsParams(input: unknown): AssetFsParamsResult {
  const parsed = AssetFsParamsSchema.safeParse(input);
  return parsed.success ? { ok: true, params: parsed.data } : { ok: false, reason: parsed.error.issues.map((i) => i.path.join('.') || i.message).join(', ') };
}

export const loadAssetFsParams = (): AssetFsParamsResult => parseAssetFsParams(raw);
