// Loại trường và hợp nhất giá trị giữa các bản (MD-R05, MD-R06, MD-R07).
import type { MasterField, MasterFieldKind } from '../contracts/master-dossier';
import { normIdNumber, normKey } from '../common/normalize';
import { plateKey } from '../s3/asset-key';
import { nearMatch, unaccentedOnly } from '../s5/compare-exact';

export const ACCEPT_CONFIDENCE = 0.8;

const MONEY_KEY = /(amount|value|payment|income|revenue|profit|salary|price|total|_vnd)$/i;
const ID_KEYS = new Set(['id_number', 'previous_id_numbers', 'declared_id_number']);
const NAME_KEY = /(^|_)(full_name|representative_name|owner_name|spouse_name)$|^full_name$/;
const CODE_KEY = /(_number|_code|^tax_id|_no)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+([+-]\d{2}:\d{2}|Z)?)?$/;
const ENUM_VALUE = /^([A-Z][A-Z0-9_]*|[a-z][a-z0-9]*(_[a-z0-9]+)+)$/;

const leafKey = (path: string) => path.split('.').pop()!.replace(/\[\d+\]$/, '');

export function isAddressValue(v: unknown): v is { full_text: string | null } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'full_text' in (v as object);
}

/** MD-R06: loại suy từ tên field + kiểu giá trị (cùng quy ước đặt tên của doc_schemas). */
export function fieldKind(path: string, value: unknown): MasterFieldKind {
  const key = leafKey(path);
  if (isAddressValue(value)) return 'address';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return MONEY_KEY.test(key) ? 'money' : 'number';
  if (key === 'license_plate') return 'plate';
  if (ID_KEYS.has(key)) return 'id';
  if (/(^|\.)identifiers\.[a-z_]+$/.test(path.replace(/\[\d+\]/g, '')) || CODE_KEY.test(key)) return 'code';
  if (NAME_KEY.test(key)) return 'name';
  if (typeof value === 'string' && ISO_DATE.test(value)) return 'date';
  if (typeof value === 'string' && ENUM_VALUE.test(value)) return 'enum';
  return 'text';
}

const upperText = (s: string) => s.normalize('NFC').toLocaleUpperCase('vi-VN').replace(/\s+/g, ' ').trim();

/** MD-R06: khóa so (không dùng làm giá trị). null = không có giá trị. */
export function compareKey(kind: MasterFieldKind, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'address': {
      const t = (value as { full_text: string | null }).full_text;
      return t ? upperText(t).replace(/[.,;:]+/g, ' ').replace(/\s+/g, ' ').trim() || null : null;
    }
    case 'code': return normKey(String(value)) || null;
    case 'id': return normIdNumber(String(value)) || null;
    case 'plate': return plateKey(String(value)) || null;
    case 'name':
    case 'text': return upperText(String(value)) || null;
    case 'money':
    case 'number': return typeof value === 'number' ? String(value) : String(value).trim() || null;
    default: return typeof value === 'string' ? (value.trim() || null) : JSON.stringify(value);
  }
}

export interface CopyValue {
  /** evidence record id (V2-R04) của lá này. */
  record_id: string;
  evidence_id: string;
  value: unknown;
  confidence: number | null;
  primary: boolean;
  /** "Mẫu biểu (file · tr.a-b)" để ghi chú bản lệch. */
  where: string;
}

/**
 * MD-R05: hợp nhất một lá giữa các bản của cùng chứng từ. `values` đã gồm cả bản có giá trị null.
 */
export function mergeField(path: string, label: string, values: ReadonlyArray<CopyValue>): MasterField {
  const sample = values.find((v) => v.value !== null && v.value !== undefined)?.value ?? null;
  const kind = fieldKind(path, sample);
  const present = values
    .map((v) => ({ ...v, key: compareKey(kind, v.value) }))
    .filter((v): v is CopyValue & { key: string } => v.key !== null);
  const base = { path, label, kind, candidates: [] as MasterField['candidates'], outliers: [] as MasterField['outliers'], note: null as string | null };
  const minConf = (xs: ReadonlyArray<CopyValue>) => {
    const cs = xs.map((x) => x.confidence);
    return cs.some((c) => c === null) ? null : Math.min(...(cs as number[]));
  };
  const review = (conf: number | null) => (conf !== null && conf >= ACCEPT_CONFIDENCE ? 'ACCEPTED' as const : 'REVIEW' as const);
  const pick = (xs: ReadonlyArray<CopyValue>) => (xs.find((x) => x.primary) ?? xs[0]).value;
  const groups = new Map<string, Array<CopyValue & { key: string }>>();
  for (const v of present) groups.set(v.key, [...(groups.get(v.key) ?? []), v]);
  const candidates = [...groups.values()].map((g) => ({ value: g[0].value, evidence_ids: g.map((x) => x.record_id) }));

  // (a) không còn giá trị
  if (present.length === 0) {
    return { ...base, value: null, status: 'MISSING', review_status: 'REVIEW', confidence: null, sources: [] };
  }
  // (b), (c) một giá trị
  if (groups.size === 1) {
    const conf = minConf(present);
    return { ...base, value: pick(present), status: present.length === 1 ? 'SINGLE_SOURCE' : 'AGREED', review_status: review(conf), confidence: conf, sources: present.map((x) => x.record_id) };
  }
  // (d) mã/số lệch 1 ký tự so với đa số
  if (kind === 'code' || kind === 'plate') {
    const near = nearMatch(present.map((x) => x.key), present.map((x) => x.evidence_id));
    if (near) {
      const major = present.filter((x) => x.key === near.majority);
      const odd = present[near.outlier];
      const conf = minConf(major);
      return {
        ...base, value: pick(major), status: 'OCR_NORMALIZED', review_status: review(conf), confidence: conf, sources: major.map((x) => x.record_id),
        outliers: [{ evidence_id: odd.record_id, raw_value: odd.value, reason_code: 'PROBABLE_OCR_ERROR' }],
        note: `${near.agreeing} bản ghi giống nhau; ${odd.where} lệch đúng 1 ký tự, nghi do đọc sai — đã chuẩn hóa theo đa số.`,
      };
    }
  }
  // (e) họ tên chỉ khác vì có bản không dấu
  if (kind === 'name' && unaccentedOnly(present.map((x) => x.key))) {
    const accented = present.filter((x) => x.key !== x.key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D'));
    const conf = minConf(present);
    return {
      ...base, value: pick(accented.length ? accented : present), status: 'AGREED', review_status: review(conf), confidence: conf,
      sources: present.map((x) => x.record_id), note: 'Khớp; chỉ khác vì có bản ghi không dấu.',
    };
  }
  // (f) khác thật: chỉ một phía tin cậy → lấy phía đó (REVIEW); ≥ 2 phía tin cậy hoặc không phía nào → CONFLICT
  const high = present.filter((x) => x.confidence !== null && x.confidence >= ACCEPT_CONFIDENCE);
  const highKeys = new Set(high.map((x) => x.key));
  if (highKeys.size === 1) {
    const side = high;
    return {
      ...base, value: pick(side), status: 'SINGLE_SOURCE', review_status: 'REVIEW', confidence: minConf(side), sources: side.map((x) => x.record_id),
      candidates, note: 'Các bản ghi khác nhau; chỉ một giá trị có độ tin cậy cao nên tạm dùng giá trị đó, cần rà soát.',
    };
  }
  return {
    ...base, value: null, status: 'CONFLICT', review_status: 'REVIEW', confidence: null, sources: [],
    candidates, note: 'Các bản của cùng chứng từ ghi khác nhau; không tự chọn bản chuẩn.',
  };
}
