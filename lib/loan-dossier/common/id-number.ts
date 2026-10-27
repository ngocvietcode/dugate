// So khớp số định danh (T-COM-02; S3-R06, S3-R12). Hàm thuần.
import { normIdNumber } from './normalize';

export type IdKind = 'ID9' | 'ID12' | 'OTHER';

/** CMND 9 số / CCCD 12 số / loại khác (sau chuẩn hóa chỉ giữ chữ số). */
export function idKind(n: string | null | undefined): IdKind {
  const d = normIdNumber(n);
  if (d?.length === 9) return 'ID9';
  if (d?.length === 12) return 'ID12';
  return 'OTHER';
}

/** Cặp CMND cũ 9 số và CCCD 12 số (không kết luận cùng người, chỉ cho biết là cặp cũ/mới). */
export function isOldNewPair(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = idKind(a);
  const kb = idKind(b);
  return (ka === 'ID9' && kb === 'ID12') || (ka === 'ID12' && kb === 'ID9');
}

/** Cùng số sau chuẩn hóa (so từng chữ số, giữ số 0 đầu). Thiếu một bên → false. */
export function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = normIdNumber(a);
  const db = normIdNumber(b);
  return da !== null && da === db;
}
