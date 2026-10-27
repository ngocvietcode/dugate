// Khóa trùng `dedup_key` (T-S2-06; S2-R17).
import { normIdNumber, normName } from '../common/normalize';

export type AssetKeyFn = (asset: { asset_type: string; identifiers: Record<string, string | null> }) => string[];

interface DedupInput {
  doc_type_key: string;
  data: Record<string, unknown> | null;
}

export interface DedupKey {
  key: string | null;
  keyByNameOnly: boolean;
}

/**
 * `loan_application` → hằng; evidence có `assets[]` → tập khóa tài sản đã sắp (bỏ tài sản không khóa);
 * còn lại → tập định danh party `INDIVIDUAL` (số, không có thì tên chuẩn hóa). Tập rỗng → null.
 * Trừ `loan_application`, nối thêm `legal_info.issue_date` khi khác null (hai lần cấp khác ngày không trùng);
 * `issue_date = null` đánh dấu riêng để không trùng với bản có ngày.
 */
export function dedupKey(env: DedupInput, assetKeyFn: AssetKeyFn): DedupKey {
  if (env.doc_type_key === 'loan_application') return { key: 'loan_application', keyByNameOnly: false };
  const data = env.data ?? {};
  let parts: string[] = [];
  let byNameOnly = false;
  const assets = Array.isArray(data.assets) ? (data.assets as Array<{ asset_type: string; identifiers: Record<string, string | null> }>) : [];
  if (assets.length > 0) {
    parts = [...new Set(assets.flatMap((a) => assetKeyFn(a)))].sort();
  } else {
    const parties = Array.isArray(data.parties)
      ? (data.parties as Array<{ party_type: string; id_number: string | null; full_name: string | null }>)
      : [];
    const individuals = parties.filter((p) => p.party_type === 'INDIVIDUAL');
    const ids = individuals.map((p) => {
      const id = normIdNumber(p.id_number);
      if (id) return `id:${id}`;
      const name = normName(p.full_name);
      return name ? `name:${name}` : null;
    }).filter((v): v is string => v !== null);
    parts = [...new Set(ids)].sort();
    byNameOnly = parts.length > 0 && parts.every((p) => p.startsWith('name:'));
  }
  if (parts.length === 0) return { key: null, keyByNameOnly: false };
  const issueDate = (data.legal_info as { issue_date?: string | null } | null | undefined)?.issue_date ?? null;
  const key = `${parts.join('|')}#issue:${issueDate ?? 'null'}`;
  return { key, keyByNameOnly: byNameOnly };
}
