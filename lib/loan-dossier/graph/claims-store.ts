// Phần của sổ Claim được LƯU vào kết quả và gửi cho UI: chỉ Claim ĐÁNG CHÚ Ý.
//   CORROBORATED        ≥ 2 chứng từ độc lập cùng khẳng định          → bằng chứng đồng thuận
//   DISPUTED            giá trị định danh khác nhau thật sự            → cần rà soát
//   PROBABLE_OCR_ERROR  lệch đúng 1 ký tự so với đa số                 → nghi lỗi đọc
//   SPELLING_VARIANT    cùng nghĩa, khác dấu                            → ghi nhận cách viết
//   unresolved          không gắn được chủ thể                          → nguy cơ mất liên kết, phải thấy
// KHÔNG lưu DECLARED / SINGLE_SOURCE không tranh chấp: chúng còn nguyên trong `documents.evidences[].data` (đã lưu sẵn) và dựng lại
// được bằng `buildClaimLedger` (thuần, tất định). Bất biến lossless được giữ bằng `ledger.leaf_count` / `claim_count` / `omitted_*`
// để mọi lúc kiểm được: lá đã lưu + lá bỏ qua = tổng lá của sổ.
import { z } from 'zod';

import type { Claim, ClaimLedger } from './claims';

export const CLAIMS_VERSION = '1.0';

export const NOTABLE_STATUSES = ['CORROBORATED', 'DISPUTED', 'PROBABLE_OCR_ERROR', 'SPELLING_VARIANT'] as const;
export type NotableStatus = typeof NOTABLE_STATUSES[number];

const SourceSchema = z.object({
  /** `{evidence_id}#{field_path}` — dẫn nguồn dùng lại rào an toàn của evidence-v3. */
  record_id: z.string().min(1),
  doc_type_key: z.string().min(1),
  /** Chỉ có khi khác `value` của claim (nguồn ghi khác cách viết) để không lặp giá trị. */
  raw: z.union([z.string(), z.number(), z.boolean()]).optional(),
  /** Độ tin cậy ĐỌC CHỮ ở cấp khóa 1; không phải độ tin cậy gán chủ thể. */
  read_confidence: z.number().min(0).max(1).nullable(),
  page: z.number().int().nullable(),
}).strict();

export const StoredClaimSchema = z.object({
  claim_id: z.string().regex(/^claim-\d+$/),
  subject: z.object({ kind: z.enum(['person', 'asset', 'loan', 'business', 'document']), id: z.string().min(1) }).strict(),
  field: z.string().min(1),
  /** Giá trị nguyên văn của nguồn đầu — CÓ THỂ LÀ PII; chỉ UI / DB / LLM, không log (S3-R26). */
  value: z.union([z.string(), z.number(), z.boolean()]),
  status: z.enum([...NOTABLE_STATUSES, 'DECLARED', 'SINGLE_SOURCE']),
  sources: z.array(SourceSchema).min(1),
  contradicts: z.array(z.string().regex(/^claim-\d+$/)),
  unresolved: z.enum(['NO_SUBJECT_INDEX', 'PARTY_NOT_MAPPED', 'ASSET_NOT_MAPPED', 'NO_SUBJECT_KIND']).optional(),
}).strict();
export type StoredClaim = z.infer<typeof StoredClaimSchema>;

export const StoredClaimsSchema = z.object({
  version: z.literal(CLAIMS_VERSION),
  /** Tổng lá OCR đã vào sổ và tổng Claim — để kiểm lossless mà không cần lưu phần đã bỏ. */
  leaf_count: z.number().int().min(0),
  claim_count: z.number().int().min(0),
  /** Số Claim / số lá KHÔNG lưu (còn nguyên ở evidences[].data). stored_leaves + omitted_leaves = leaf_count. */
  omitted_claims: z.number().int().min(0),
  omitted_leaves: z.number().int().min(0),
  claims: z.array(StoredClaimSchema),
}).strict().superRefine((c, ctx) => {
  const ids = new Set(c.claims.map((x) => x.claim_id));
  if (ids.size !== c.claims.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'claim_id trùng' });
  c.claims.forEach((x, i) => x.contradicts.forEach((o) => {
    if (!ids.has(o)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claims', i, 'contradicts'], message: `${o} không có trong claims` });
  }));
  const stored = c.claims.reduce((n, x) => n + x.sources.length, 0);
  if (stored + c.omitted_leaves !== c.leaf_count) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'lá đã lưu + lá bỏ qua phải bằng leaf_count' });
  if (c.claims.length + c.omitted_claims !== c.claim_count) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'claim đã lưu + claim bỏ qua phải bằng claim_count' });
});
export type StoredClaims = z.infer<typeof StoredClaimsSchema>;

const isNotable = (c: Claim): boolean => (NOTABLE_STATUSES as readonly string[]).includes(c.status) || c.unresolved !== undefined;

/** Chọn Claim đáng chú ý. Một claim đối lập với claim đáng chú ý thì cũng được giữ, để cặp mâu thuẫn không bị cắt lìa. */
export function selectNotableClaims(ledger: ClaimLedger): StoredClaims {
  const byId = new Map(ledger.claims.map((c) => [c.claim_id, c]));
  const keep = new Set<string>();
  for (const c of ledger.claims) {
    if (!isNotable(c)) continue;
    keep.add(c.claim_id);
    c.contradicts.forEach((o) => keep.add(o));
  }
  const kept = ledger.claims.filter((c) => keep.has(c.claim_id));
  const claims: StoredClaim[] = kept.map((c) => ({
    claim_id: c.claim_id,
    subject: { kind: c.subject.kind, id: c.subject.id },
    field: c.field,
    value: c.value,
    status: c.status,
    sources: c.sources.map((s) => ({
      record_id: s.record_id,
      doc_type_key: s.doc_type_key,
      ...(s.raw !== c.value ? { raw: s.raw } : {}),
      read_confidence: s.read_confidence,
      page: s.page,
    })),
    contradicts: [...c.contradicts].filter((o) => byId.has(o)),
    ...(c.unresolved ? { unresolved: c.unresolved } : {}),
  }));
  const storedLeaves = kept.reduce((n, c) => n + c.sources.length, 0);
  return {
    version: CLAIMS_VERSION,
    leaf_count: ledger.leaf_count,
    claim_count: ledger.claims.length,
    omitted_claims: ledger.claims.length - kept.length,
    omitted_leaves: ledger.leaf_count - storedLeaves,
    claims,
  };
}
