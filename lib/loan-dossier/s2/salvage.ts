// Kiểm schema mềm cho `data` của một bản thể (S2-R21): 1 field sai định dạng không được làm hỏng cả chứng từ.
// Parse chặt trước; lỗi thì sửa CỤC BỘ đúng chỗ zod báo rồi parse lại, tối đa MAX_ROUNDS vòng:
//   - field thiếu (undefined) → null (như S2-R06);
//   - key lạ (strict) → bỏ key;
//   - literal / enum một giá trị (VD party_role của CCCD = HOLDER) → giá trị schema quy định; nhãn gốc vẫn ở party_role_raw;
//   - `parties[i].party_index` / `assets[i].asset_index` → i (chỉ là vị trí trong mảng);
//   - field sai định dạng → null; schema không cho null → [] (mảng) hoặc {} (object, các field con thành null);
//   - vẫn không được → nâng lên field cha; cha là phần tử mảng → bỏ phần tử đó.
// Không bịa giá trị: chỉ thay bằng null/rỗng hoặc giá trị mà chính schema cố định. Field bị thay ghi vào `invalid_fields`
// (chỉ đường dẫn, không giá trị — S2-R19). Không cứu được ở cấp gốc → trả lỗi zod như parse chặt.
import type { ZodError, ZodIssue, ZodTypeAny } from 'zod';

const MAX_ROUNDS = 40;

type Seg = string | number;

export type SalvageResult =
  | { success: true; data: unknown; invalid_fields: string[] }
  | { success: false; error: ZodError };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keyOf = (path: Seg[]) => path.join('.');

function getAt(root: unknown, path: Seg[]): unknown {
  let cur = root;
  for (const s of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[s];
  }
  return cur;
}

/** Gán giá trị tại `path`; cha không còn là object/mảng (đã bị thay ở vòng này) → bỏ qua. */
function setAt(root: unknown, path: Seg[], value: unknown): boolean {
  const parent = getAt(root, path.slice(0, -1));
  if (parent === null || typeof parent !== 'object') return false;
  (parent as Record<string | number, unknown>)[path[path.length - 1]] = value;
  return true;
}

/** `[..., 'parties', i, 'party_index']` / `[..., 'assets', i, 'asset_index']` → i. */
function positionalIndex(path: Seg[]): number | null {
  if (path.length < 3) return null;
  const [arr, i, leaf] = path.slice(-3);
  if (typeof i !== 'number') return null;
  if ((arr === 'parties' && leaf === 'party_index') || (arr === 'assets' && leaf === 'asset_index')) return i;
  return null;
}

/**
 * Parse `raw` theo `schema`; sai thì sửa cục bộ như mô tả đầu file. `invalid_fields` là các đường dẫn bị thay
 * bằng null/rỗng hoặc bị bỏ (phần tử mảng), theo chỉ số tại thời điểm sửa.
 */
export function parseWithSalvage(schema: ZodTypeAny, raw: unknown): SalvageResult {
  const first = schema.safeParse(raw);
  if (first.success) return { success: true, data: first.data, invalid_fields: [] };
  if (!isObj(raw)) return { success: false, error: first.error };

  const work = structuredClone(raw);
  const attempts = new Map<string, number>();
  const invalid = new Set<string>();
  let error = first.error;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const removals: Seg[][] = [];
    let changed = false;
    for (const issue of error.issues) {
      if (repair(work, issue, attempts, invalid, removals)) changed = true;
    }
    // Bỏ phần tử mảng sau cùng, chỉ số giảm dần để không lệch nhau trong cùng vòng.
    const seen = new Set<string>();
    removals
      .filter((p) => (seen.has(keyOf(p)) ? false : (seen.add(keyOf(p)), true)))
      .sort((a, b) => (b[b.length - 1] as number) - (a[a.length - 1] as number))
      .forEach((p) => {
        const arr = getAt(work, p.slice(0, -1));
        if (!Array.isArray(arr)) return;
        arr.splice(p[p.length - 1] as number, 1);
        invalid.add(keyOf(p));
        changed = true;
        // Chỉ số trong mảng đã dịch: quên các lần thử bên trong mảng này.
        const prefix = `${keyOf(p.slice(0, -1))}.`;
        for (const k of [...attempts.keys()]) if (k.startsWith(prefix)) attempts.delete(k);
      });
    if (!changed) break;
    const next = schema.safeParse(work);
    if (next.success) return { success: true, data: next.data, invalid_fields: [...invalid] };
    error = next.error;
  }
  return { success: false, error };
}

function repair(work: unknown, issue: ZodIssue, attempts: Map<string, number>, invalid: Set<string>, removals: Seg[][]): boolean {
  const path = issue.path as Seg[];
  if (issue.code === 'unrecognized_keys') {
    const obj = getAt(work, path);
    if (!isObj(obj)) return false;
    issue.keys.forEach((k) => delete obj[k]);
    return true;
  }
  if (path.length === 0) return false;

  const current = getAt(work, path);
  // Literal / enum chỉ một giá trị: schema đã cố định giá trị, không phải suy đoán.
  const fixed = issue.code === 'invalid_literal' ? { v: issue.expected }
    : issue.code === 'invalid_enum_value' && issue.options.length === 1 ? { v: issue.options[0] } : null;
  if (fixed && !attempts.has(`${keyOf(path)}#fixed`)) {
    attempts.set(`${keyOf(path)}#fixed`, 1);
    return setAt(work, path, fixed.v);
  }
  const pos = positionalIndex(path);
  if (pos !== null && current !== pos) return setAt(work, path, pos);

  // Field thiếu → null, không tính là sai định dạng.
  if (current === undefined && !attempts.has(keyOf(path))) {
    attempts.set(keyOf(path), 1);
    return setAt(work, path, null);
  }
  return escalate(work, path, issue, attempts, invalid, removals);
}

/** Bậc thang: null → [] / {} theo kiểu schema mong đợi → field cha (phần tử mảng → bỏ). */
function escalate(work: unknown, path: Seg[], issue: ZodIssue, attempts: Map<string, number>, invalid: Set<string>, removals: Seg[][]): boolean {
  let p = path;
  let iss: ZodIssue | null = issue;
  while (p.length > 0) {
    const k = keyOf(p);
    const n = attempts.get(k) ?? 0;
    if (n === 0) {
      attempts.set(k, 1);
      invalid.add(k);
      return setAt(work, p, null);
    }
    if (n === 1 && iss?.code === 'invalid_type' && getAt(work, p) === null && (iss.expected === 'array' || iss.expected === 'object')) {
      attempts.set(k, 2);
      return setAt(work, p, iss.expected === 'array' ? [] : {});
    }
    const parentPath = p.slice(0, -1);
    if (Array.isArray(getAt(work, parentPath)) && typeof p[p.length - 1] === 'number') {
      removals.push(p);
      return true;
    }
    p = parentPath;
    iss = null;
  }
  return false;
}
