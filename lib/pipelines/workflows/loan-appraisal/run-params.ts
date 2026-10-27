// Tham số chạy dùng chung (V2-R01): ngày nộp hồ sơ và dữ liệu nhập từ hệ thống gọi. Hàm thuần. Tách khỏi
// `dossier-consolidate.ts` (stage S3→S4→S5 đang tắt) vì S3 ở giai đoạn 2 (`dossier-map.ts`) vẫn dùng (D-97).
import type { ExternalInput } from '@/lib/loan-dossier/s4/context';

/** Ngày nộp hồ sơ mặc định: ngày theo giờ Việt Nam (V2-R01). */
export function vnToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Tham số chạy (V2-R01): `dossier_submitted_at`, `external_input` (hoặc các biến rời) từ pipelineVars. */
export function consolidateParams(vars: Record<string, unknown>, now?: Date): { dossier_submitted_at: string; external_input: ExternalInput | null } {
  const d = typeof vars.dossier_submitted_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(vars.dossier_submitted_at) ? vars.dossier_submitted_at : vnToday(now);
  let ext: Record<string, unknown> | null = null;
  const rawExt = vars.external_input;
  if (rawExt && typeof rawExt === 'object') ext = rawExt as Record<string, unknown>;
  else if (typeof rawExt === 'string' && rawExt.trim()) { try { ext = JSON.parse(rawExt); } catch { ext = null; } }
  const pick = (k: string) => (ext && k in ext ? ext[k] : vars[k]);
  const amount = pick('loan_amount');
  const mortgaged = pick('collateral_mortgaged_elsewhere');
  const deviation = pick('deviation_code');
  const external: ExternalInput = {
    deviation_code: typeof deviation === 'string' ? deviation : null,
    loan_amount: typeof amount === 'number' ? amount : typeof amount === 'string' && /^\d+$/.test(amount) ? Number(amount) : null,
    collateral_mortgaged_elsewhere: typeof mortgaged === 'boolean' ? mortgaged : mortgaged === 'true' ? true : mortgaged === 'false' ? false : null,
  };
  const any = Object.values(external).some((v) => v !== null);
  return { dossier_submitted_at: d, external_input: any ? external : null };
}
