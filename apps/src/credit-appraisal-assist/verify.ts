// Kiểm kết luận nhánh 2 bằng code (spec 002 FR-22, FR-23). Hàm thuần — chạy được trong workflow.
// AI viết, code kiểm: kết luận trích mã không tồn tại, dùng con số không có trong LAC, hoặc đề xuất cho vay/từ chối
// đều bị loại (không tự sửa).
import type { Lac } from '../generated/lac.zod';
import type { Conclusion } from './schema';

export interface VerifyContext {
  factIds: Set<string>;
  conflictIds: Set<string>;     // X# loại C (nhánh 2 chỉ thấy C)
  signalIds: Set<string>;
  metricIds: Set<string>;
  numbers: number[];
  dates: Set<string>;           // ngày ISO có trong facts
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function buildVerifyContext(lac: Lac): VerifyContext {
  const nums: number[] = [];
  const dates = new Set<string>();
  const addVal = (v: unknown) => {
    if (isNum(v)) nums.push(v);
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) dates.add(v.slice(0, 10));
  };
  for (const f of lac.facts) {
    addVal(f.value);
    if (f.field.endsWith('loan_term_months') && isNum(f.value)) nums.push(f.value / 12);
  }
  for (const r of lac.zones.financials) { addVal(r.value); addVal(r.annualized); }
  for (const g of lac.zones.funding_plans) {
    addVal(g.total); addVal(g.items_sum);
    for (const it of g.items as Record<string, unknown>[]) for (const k of ['quantity', 'unit_price', 'amount']) addVal(it[k]);
  }
  for (const m of lac.metrics) {
    if (isNum(m.value)) nums.push(m.value, m.value * 100);
    for (const i of m.inputs) addVal(i.value);
  }
  for (const t of lac.signals) if (isNum(t.threshold)) nums.push(t.threshold, t.threshold * 100);
  for (const d of lac.documents) if (d.date) dates.add(d.date);
  return {
    factIds: new Set(lac.facts.map((f) => f.id)),
    conflictIds: new Set(lac.discrepancies.filter((x) => x.class === 'C').map((x) => x.id)),
    signalIds: new Set(lac.signals.map((t) => t.id)),
    metricIds: new Set(lac.metrics.map((m) => m.id)),
    numbers: nums,
    dates,
  };
}

const UNITS: [RegExp, number][] = [[/^\s*(tỷ|ty)\b/i, 1e9], [/^\s*(triệu|trieu|tr)\b/i, 1e6], [/^\s*(nghìn|nghin|ngàn)\b/i, 1e3]];

/** Các cách đọc số có thể của một token (định dạng VN "1.670.000.000", "69,98%", hoặc kiểu "0.6998"). */
export function readings(token: string): { value: number; decimals: number }[] {
  const t = token.replace(/\s*%$/, '');
  const out: { value: number; decimals: number }[] = [];
  const push = (s: string, decSep: string | null) => {
    const [intPart, frac = ''] = decSep ? s.split(decSep) : [s, ''];
    const v = Number(`${intPart.replace(/[.,]/g, '')}.${frac || '0'}`);
    if (Number.isFinite(v)) out.push({ value: v, decimals: frac.length });
  };
  const dots = (t.match(/\./g) ?? []).length;
  const commas = (t.match(/,/g) ?? []).length;
  if (dots && commas) push(t, t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.');
  else if (dots || commas) {
    const sep = dots ? '.' : ',';
    const groups = t.split(sep);
    const thousands = groups.slice(1).every((g) => g.length === 3);
    if (thousands) push(t, null);
    if (!thousands || groups.length === 2) push(t, sep);
  } else push(t, null);
  if (token.trim().endsWith('%')) {
    return out.flatMap((r) => [r, { value: Number((r.value / 100).toFixed(r.decimals + 2)), decimals: r.decimals + 2 }]);
  }
  return out;
}

/** Token số trong văn bản, sau khi bỏ mã (F12, X03, M-LTV...) và ngày đã có trong LAC. Trả token + bội số đơn vị. */
export function numberTokens(text: string, ctx: Pick<VerifyContext, 'dates'>): { raw: string; unit: number; badDate?: boolean }[] {
  let s = text.replace(/\bM-[A-Z0-9-]+\b/g, ' ').replace(/\b[FXTKDPUABLGI]\d+\b/g, ' ');
  const found: { raw: string; unit: number; badDate?: boolean }[] = [];
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, y, mo, d, d2, mo2, y2) => {
    const iso = y ? `${y}-${mo}-${d}` : `${y2}-${String(mo2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`;
    if (!ctx.dates.has(iso)) found.push({ raw: m, unit: 1, badDate: true });
    return ' ';
  });
  const re = /\d+(?:[.,]\d+)*(?:\s*%)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const rest = s.slice(m.index + m[0].length);
    const unit = UNITS.find(([u]) => u.test(rest))?.[1] ?? 1;
    found.push({ raw: m[0], unit });
  }
  return found;
}

export function numberAllowed(raw: string, unit: number, allowed: number[]): boolean {
  return readings(raw).some(({ value, decimals }) => {
    if (unit === 1 && decimals === 0 && value <= 12) return true; // số đếm nhỏ (tháng, năm, số người)
    const tol = 0.5 * 10 ** -decimals * unit + 1e-9;
    return allowed.some((a) => Math.abs(a - value * unit) <= tol);
  });
}

const BANNED = ['de xuat cho vay', 'de nghi cho vay', 'nen cho vay', 'khong nen cho vay', 'phe duyet', 'tu choi cho vay',
  'khong cho vay', 'dong y cho vay', 'chap thuan cho vay', 'approve', 'reject the loan'];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export function verifyConclusion(k: Conclusion, ctx: VerifyContext): string[] {
  const why: string[] = [];
  const cited = [...k.fields, ...k.conflicts, ...k.signals];
  if (!cited.length) why.push('không trích mã nào (F#/X#/T#)');
  for (const f of k.fields) if (!ctx.factIds.has(f)) why.push(`trích ${f} không tồn tại`);
  for (const x of k.conflicts) if (!ctx.conflictIds.has(x)) why.push(`trích ${x} không phải mâu thuẫn C hiện có`);
  for (const t of k.signals) if (!ctx.signalIds.has(t)) why.push(`trích ${t} không tồn tại`);
  for (const code of k.text.match(/\b[FXT]\d+\b/g) ?? []) {
    const ok = code[0] === 'F' ? ctx.factIds.has(code) : code[0] === 'X' ? ctx.conflictIds.has(code) : ctx.signalIds.has(code);
    if (!ok) why.push(`văn bản nhắc ${code} không tồn tại`);
  }
  for (const code of k.text.match(/\bM-[A-Z0-9-]+\b/g) ?? []) if (!ctx.metricIds.has(code)) why.push(`văn bản nhắc ${code} không tồn tại`);
  for (const n of numberTokens(k.text, ctx)) {
    if (n.badDate) why.push(`ngày ${n.raw} không có trong LAC`);
    else if (!numberAllowed(n.raw, n.unit, ctx.numbers)) why.push(`con số ${n.raw} không có trong LAC`);
  }
  const f = fold(k.text);
  for (const b of BANNED) if (f.includes(b)) why.push(`chứa đề xuất quyết định («${b}»)`);
  return why;
}

/** Bóc mảng kết luận từ nội dung model trả qua Core (có thể bọc ```json). */
export function parseConclusions(content: string | null, extracted: unknown): unknown[] {
  const pick = (v: unknown): unknown[] | null =>
    Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { conclusions?: unknown }).conclusions)
      ? (v as { conclusions: unknown[] }).conclusions : null;
  const fromExtracted = pick(extracted);
  if (fromExtracted) return fromExtracted;
  if (!content) return [];
  const m = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  try {
    return pick(JSON.parse((m ? m[1] : content).trim())) ?? [];
  } catch {
    return [];
  }
}
