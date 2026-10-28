// Claim: một thông tin được MỘT HOẶC NHIỀU chứng từ khẳng định về một chủ thể (người / tài sản / khoản vay / hộ kinh doanh / chứng từ).
// Sổ cái lossless: MỌI lá của `evidences[].data` được gán đúng MỘT lần làm nguồn của đúng MỘT Claim (không lược, không nhân đôi),
// bất kể loại chứng từ. Giá trị mâu thuẫn là hai Claim riêng nối bằng CONTRADICTS, không phải một giá trị kèm ghi chú.
// Hàm thuần, tất định, không log. Claim MANG GIÁ TRỊ (có thể là PII): chỉ dùng cho UI / lưu DB / LLM, không bao giờ vào log (S3-R26).
import { distance } from 'fastest-levenshtein';

import { isNameMatch, nameLevel, normalizeName, stripDiacritics } from '../common/name';
import { normDate, normIdNumber, normKey, normMoney, normName } from '../common/normalize';
import type { MapDossierData } from '../contracts/check-stages';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { NEAR_MATCH_MIN_LENGTH } from '../s5/compare-exact';

/** Loại chủ thể mà Claim nói về. `document` = thông tin về chính chứng từ (số, ngày cấp, nơi cấp, người ký…). */
export type SubjectKind = 'person' | 'asset' | 'loan' | 'business' | 'document';

export interface SubjectRef { kind: SubjectKind; id: string }

/** Cách lấy giá trị về dạng so sánh được. */
export type ValueKind = 'text' | 'name' | 'id' | 'date' | 'money' | 'number' | 'boolean' | 'key';

/** Vì sao một lá không gắn được vào người / tài sản cụ thể. Không có mã này nghĩa là đã gắn được. */
export type UnresolvedReason = 'NO_SUBJECT_INDEX' | 'PARTY_NOT_MAPPED' | 'ASSET_NOT_MAPPED' | 'NO_SUBJECT_KIND';

export interface ClaimSource {
  /** `{evidence_id}#{field_path}` — cùng dạng với EvidenceRecord.evidence_id (V2-R04) nên rào an toàn hiện có dùng lại được. */
  record_id: string;
  evidence_id: string;
  doc_type_key: string;
  /** Đường dẫn nguyên bản của lá trong `data` (có chỉ số mảng). */
  field_path: string;
  /** Giá trị nguyên văn như model OCR trả. */
  raw: string | number | boolean;
  /** Độ tin cậy ĐỌC CHỮ của khóa cấp 1 chứa lá này (field_confidences); null khi không có. Độ phân giải là cấp 1, không phải từng lá. */
  read_confidence: number | null;
  page: number | null;
}

export type ClaimStatus =
  /** Khai trên giấy đề nghị vay, chưa có chứng từ độc lập xác nhận. */
  | 'DECLARED'
  /** Một chứng từ (không phải đơn vay) khẳng định. */
  | 'SINGLE_SOURCE'
  /** ≥ 2 chứng từ KHÁC NHAU cùng khẳng định cùng giá trị. */
  | 'CORROBORATED'
  /** Có Claim khác về cùng (chủ thể, trường) với giá trị khác về thực chất (khác người, khác số, khác mã). */
  | 'DISPUTED'
  /** Chỉ lệch một ký tự so với đa số: nghi lỗi đọc (không thay đổi kết luận "cùng tài sản"). */
  | 'PROBABLE_OCR_ERROR'
  /** Cùng giá trị về nghĩa nhưng viết khác (dấu tiếng Việt, đảo họ tên): S3 gọi là SPELLING_DIFFERENCE / REORDERED, không phải mâu thuẫn. */
  | 'SPELLING_VARIANT';

export interface Claim {
  claim_id: string;
  subject: SubjectRef;
  /** Tên trường chung đã bỏ chỉ số mảng: `identifiers.certificate_number`, `loan_info.requested_amount`. */
  field: string;
  /** Giá trị chuẩn hóa dùng để gộp / so sánh; null nếu không chuẩn hóa được. */
  value_norm: string | number | boolean | null;
  value_kind: ValueKind;
  /** Giá trị hiển thị: lấy nguyên văn của nguồn đầu tiên. */
  value: string | number | boolean;
  status: ClaimStatus;
  sources: ClaimSource[];
  /** Claim cùng (chủ thể, trường) với giá trị khác. */
  contradicts: string[];
  /** Mã lý do khi chủ thể chưa xác định được; undefined khi đã gắn được. */
  unresolved?: UnresolvedReason;
}

export interface ClaimLedger {
  claims: Claim[];
  /** Số lá OCR vào sổ. Bất biến lossless: bằng tổng `sources` của mọi claim. */
  leaf_count: number;
  /** Lá có chủ thể chưa xác định (vẫn nằm trong claim, gắn vào `document`). */
  unresolved_count: number;
}

// ─── Duyệt lá ────────────────────────────────────────────────────────────────

interface Leaf { path: string; value: string | number | boolean }

/** Lá = mọi giá trị scalar khác null/undefined. Chuỗi rỗng giữ nguyên (là dữ liệu OCR, không bỏ). */
function leavesOf(value: unknown, path: string, out: Leaf[]): void {
  if (Array.isArray(value)) value.forEach((v, i) => leavesOf(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) leavesOf(v, path ? `${path}.${k}` : k, out);
  else if (value !== null && value !== undefined && path && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) out.push({ path, value });
}

/** `parties[2].full_name` → `parties[].full_name`. */
export function genericField(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

const topKey = (path: string) => path.split(/[.[]/)[0];

// ─── Chủ thể ────────────────────────────────────────────────────────────────

/** Trường mà giá trị là một CHỈ SỐ trỏ tới người / tài sản khác trong cùng chứng từ (liên kết, không phải thông tin). */
const INDEX_FIELDS = /(^|\.)(party_index|party_indexes\[\]|owner_party_indexes\[\]|asset_index)$/;

interface SubjectIndex {
  /** `evidence_id` → party_index → person_id */
  person: Map<string, Map<number, string>>;
  /** `evidence_id` → asset_index → asset_id */
  asset: Map<string, Map<number, string>>;
}

function indexSubjects(map: MapDossierData | null): SubjectIndex {
  const person = new Map<string, Map<number, string>>();
  const asset = new Map<string, Map<number, string>>();
  for (const p of map?.role_registry ?? []) {
    for (const m of p.mapped_evidences as Array<{ evidence_id?: string; party_index?: number }>) {
      if (typeof m.evidence_id !== 'string' || typeof m.party_index !== 'number') continue;
      const inner = person.get(m.evidence_id) ?? new Map<number, string>();
      if (!inner.has(m.party_index)) inner.set(m.party_index, p.person_id);
      person.set(m.evidence_id, inner);
    }
  }
  for (const a of map?.asset_registry ?? []) {
    for (const s of a.sources as Array<{ evidence_id?: string; asset_index?: number }>) {
      if (typeof s.evidence_id !== 'string' || typeof s.asset_index !== 'number') continue;
      const inner = asset.get(s.evidence_id) ?? new Map<number, string>();
      if (!inner.has(s.asset_index)) inner.set(s.asset_index, a.asset_id);
      asset.set(s.evidence_id, inner);
    }
  }
  return { person, asset };
}

/**
 * Tên nhóm đầu của đường dẫn → loại chủ thể + cách lấy chỉ số. Quy tắc theo CẤU TRÚC của schema S2 (mọi mảng con của chứng từ mang
 * `party_index` / `asset_index` của chính phần tử đó), nên áp dụng cho cả chứng từ mới thêm sau này mà không phải liệt kê từng loại.
 */
function subjectOf(
  evidence: EvidenceEnvelope,
  path: string,
  data: Record<string, unknown>,
  idx: SubjectIndex,
): { subject: SubjectRef; unresolved?: UnresolvedReason } {
  const doc: SubjectRef = { kind: 'document', id: evidence.evidence_id };
  const m = path.match(/^([a-z_]+)\[(\d+)\]/);
  const top = path.split(/[.[]/)[0];

  // Phần tử mảng có chỉ số riêng trong chính phần tử: parties[i], party_details[i], reports[i], income_sources[i], asset_details[i], assets[i]…
  if (m) {
    const arr = data[m[1]];
    const item = Array.isArray(arr) ? (arr[Number(m[2])] as Record<string, unknown> | undefined) : undefined;
    const pIdx = item && typeof item.party_index === 'number' ? item.party_index : null;
    const aIdx = item && typeof item.asset_index === 'number' ? item.asset_index : null;
    if (m[1] === 'parties' || m[1] === 'party_details' || m[1] === 'reports') {
      const i = pIdx ?? (m[1] === 'parties' ? Number(m[2]) : null);
      if (i === null) return { subject: doc, unresolved: 'NO_SUBJECT_INDEX' };
      const pid = idx.person.get(evidence.evidence_id)?.get(i);
      return pid ? { subject: { kind: 'person', id: pid } } : { subject: doc, unresolved: 'PARTY_NOT_MAPPED' };
    }
    if (m[1] === 'assets' || m[1] === 'asset_details') {
      const i = aIdx ?? (m[1] === 'assets' ? Number(m[2]) : null);
      if (i === null) return { subject: doc, unresolved: 'NO_SUBJECT_INDEX' };
      const aid = idx.asset.get(evidence.evidence_id)?.get(i);
      return aid ? { subject: { kind: 'asset', id: aid } } : { subject: doc, unresolved: 'ASSET_NOT_MAPPED' };
    }
    if (m[1] === 'income_sources') {
      if (pIdx === null) return { subject: doc, unresolved: 'NO_SUBJECT_INDEX' };
      const pid = idx.person.get(evidence.evidence_id)?.get(pIdx);
      return pid ? { subject: { kind: 'person', id: pid } } : { subject: doc, unresolved: 'PARTY_NOT_MAPPED' };
    }
    if (m[1] === 'change_records') {
      // Biến động đăng ký là sự kiện của tài sản trong chứng từ (GCN 1 tài sản); người liên quan nằm ở `party_indexes[]` của chính nó.
      const only = idx.asset.get(evidence.evidence_id);
      if (only && only.size === 1) return { subject: { kind: 'asset', id: [...only.values()][0] } };
      return { subject: doc, unresolved: 'NO_SUBJECT_INDEX' };
    }
  }
  if (top === 'business_info') return { subject: { kind: 'business', id: `business:${evidence.evidence_id}` } };
  if (top === 'loan_info' || top === 'financial_info' || top === 'collateral_summary' || top === 'ltv' || top === 'officer_info') {
    return { subject: { kind: 'loan', id: `loan:${evidence.evidence_id}` } };
  }
  // valuation_info mô tả chứng thư và tài sản được định giá; với chứng từ định giá 1 tài sản thì gắn tài sản, ngược lại gắn chứng từ.
  if (top === 'valuation_info') {
    const only = idx.asset.get(evidence.evidence_id);
    if (only && only.size === 1) return { subject: { kind: 'asset', id: [...only.values()][0] } };
  }
  return { subject: doc };
}

// ─── Chuẩn hóa giá trị ──────────────────────────────────────────────────────

function kindOf(field: string, value: string | number | boolean): ValueKind {
  const leaf = field.split('.').pop() ?? field;
  if (typeof value === 'boolean') return 'boolean';
  if (/(^|_)(date|datetime)$|_date$|^date_of_birth$/.test(leaf)) return 'date';
  if (/^(id_number|tax_id|previous_id_numbers\[\])$/.test(leaf) || leaf === 'id_number') return 'id';
  if (/^(certificate_number|certificate_book_number|land_parcel_number|map_sheet_number|apartment_number|license_plate|chassis_number|engine_number|registration_number|valuation_certificate_number|case_code|dao_code)$/.test(leaf)) return 'key';
  if (/(^|_)(name|full_name)$/.test(leaf) && !/_raw$/.test(leaf)) return 'name';
  if (typeof value === 'number') return /(amount|value|income|profit|revenue|cogs|cost|debt|payment|price|turnover)/.test(leaf) ? 'money' : 'number';
  return 'text';
}

function normalizeValue(kind: ValueKind, value: string | number | boolean): string | number | boolean | null {
  switch (kind) {
    case 'boolean': return value;
    case 'number': return typeof value === 'number' ? value : Number.isFinite(Number(value)) ? Number(value) : null;
    case 'money': return typeof value === 'number' ? value : normMoney(String(value));
    case 'date': return normDate(String(value));
    case 'id': return normIdNumber(String(value));
    case 'key': return normKey(String(value));
    case 'name': return normName(String(value));
    case 'text': { const s = String(value).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN'); return s || null; }
  }
}

// ─── Sổ cái ─────────────────────────────────────────────────────────────────

/**
 * Trường nào được phép coi là "cùng một thông tin" giữa các chứng từ (gộp thành một Claim nhiều nguồn và so mâu thuẫn).
 * Còn lại mỗi lá tự là một Claim một nguồn: không gộp được (bảng, dòng, đoạn tự do) thì giữ nguyên, tuyệt đối không bỏ.
 */
const COMPARABLE = new Set<ValueKind>(['id', 'key', 'name', 'date', 'money', 'number', 'boolean']);

/** Trường chỉ mang tính liên kết nội bộ của chứng từ — vẫn vào sổ (lossless) nhưng không tạo mâu thuẫn. */
const NEVER_CONTRADICT = (field: string) => INDEX_FIELDS.test(field) || /_index$|_indexes\[\]$/.test(field.split('.').pop() ?? '');

/**
 * Trường mà HAI GIÁ TRỊ KHÁC NHAU của cùng chủ thể là mâu thuẫn thật: định danh (số, mã, tên) và ngày sinh. Các trường còn lại
 * (diện tích, giá trị định giá, số tiền, độ tuổi chứng từ…) khác nhau giữa các chứng từ là bình thường — mỗi chứng từ đo / khai một
 * lúc, một cách — nên vẫn vào sổ nhưng KHÔNG sinh CONTRADICTS (tránh báo giả làm loãng các cảnh báo thật).
 */
const IDENTITY_KINDS = new Set<ValueKind>(['id', 'key', 'name', 'date']);

/** Trường ngày nào là định danh: chỉ ngày sinh. Ngày cấp / ngày ký / ngày định giá khác nhau giữa các chứng từ là bình thường. */
const isIdentityDate = (field: string) => /(^|\.)date_of_birth$/.test(field);

const isIdentityField = (kind: ValueKind, field: string) => (kind === 'date' ? isIdentityDate(field) : IDENTITY_KINDS.has(kind));

export function buildClaimLedger(evidences: ReadonlyArray<EvidenceEnvelope>, map: MapDossierData | null): ClaimLedger {
  const idx = indexSubjects(map);
  type Draft = { subject: SubjectRef; field: string; kind: ValueKind; norm: string | number | boolean | null; value: string | number | boolean; sources: ClaimSource[]; unresolved?: UnresolvedReason };
  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();
  let leafCount = 0;
  let unresolvedCount = 0;

  for (const e of evidences) {
    if (e.status !== 'SUCCESS' || !e.data) continue;
    const data = e.data as Record<string, unknown>;
    const ls: Leaf[] = [];
    leavesOf(data, '', ls);
    for (const l of ls) {
      leafCount += 1;
      const { subject, unresolved } = subjectOf(e, l.path, data, idx);
      if (unresolved) unresolvedCount += 1;
      const field = genericField(l.path);
      const kind = kindOf(field, l.value);
      const norm = normalizeValue(kind, l.value);
      const conf = e.field_confidences[topKey(l.path)];
      const page = e.source_pages?.[topKey(l.path)];
      const source: ClaimSource = {
        record_id: `${e.evidence_id}#${l.path}`, evidence_id: e.evidence_id, doc_type_key: e.doc_type_key, field_path: l.path, raw: l.value,
        read_confidence: typeof conf === 'number' ? conf : null,
        page: typeof page === 'number' ? page : Array.isArray(page) && typeof page[0] === 'number' ? page[0] : null,
      };
      // Chỉ gộp khi: so sánh được, đã chuẩn hóa được, đã gắn chủ thể, và không phải khóa liên kết nội bộ.
      const mergeable = COMPARABLE.has(kind) && norm !== null && !unresolved && subject.kind !== 'document' && !NEVER_CONTRADICT(field);
      const key = mergeable ? `${subject.kind}:${subject.id}\u0000${field}\u0000${String(norm)}` : null;
      const existing = key ? byKey.get(key) : undefined;
      if (existing) { existing.sources.push(source); continue; }
      const d: Draft = { subject, field, kind, norm, value: l.value, sources: [source], ...(unresolved ? { unresolved } : {}) };
      drafts.push(d);
      if (key) byKey.set(key, d);
    }
  }

  // Mâu thuẫn: cùng (chủ thể, trường) mà khác giá trị chuẩn hóa. Chỉ xét trường ĐỊNH DANH, đã gắn chủ thể.
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (!isIdentityField(d.kind, d.field) || d.norm === null || d.unresolved || d.subject.kind === 'document' || NEVER_CONTRADICT(d.field)) continue;
    const g = `${d.subject.kind}:${d.subject.id}\u0000${d.field}`;
    groups.set(g, [...(groups.get(g) ?? []), d]);
  }

  const claims: Claim[] = drafts.map((d, i) => ({
    claim_id: `claim-${i + 1}`, subject: d.subject, field: d.field, value_norm: d.norm, value_kind: d.kind, value: d.value,
    status: 'SINGLE_SOURCE' as ClaimStatus, sources: d.sources, contradicts: [], ...(d.unresolved ? { unresolved: d.unresolved } : {}),
  }));
  const idOf = new Map(drafts.map((d, i) => [d, claims[i]]));

  for (const members of groups.values()) {
    const cs = members.map((m) => idOf.get(m)!);
    // Một chủ thể có thể hợp lệ có NHIỀU giá trị cùng trường khi trường mang nhiều phần tử (số cũ `previous_id_numbers[]`, CCCD gắn chip…):
    // chỉ coi là mâu thuẫn khi trường là "một giá trị duy nhất" — tức không có chỉ số mảng sau phần tử chủ thể.
    const exclusive = cs.every((c) => !c.sources.some((s) => /\[\d+\]/.test(s.field_path.replace(/^(parties|assets|asset_details|party_details|reports|income_sources|change_records)\[\d+\]/, ''))));
    if (cs.length < 2 || !exclusive) continue;
    markStatus(cs);
  }
  for (const c of claims) {
    if (c.status === 'SINGLE_SOURCE' || c.status === 'DISPUTED' || c.status === 'PROBABLE_OCR_ERROR' || c.status === 'SPELLING_VARIANT') {
      if (c.contradicts.length > 0 || c.status === 'SPELLING_VARIANT') continue;
    }
    // D-112: cùng quy tắc với LAC — xác nhận độc lập cần ≥ 2 LOẠI chứng từ; nhiều bản của cùng một loại (kể cả đơn vay) không tính.
    const docTypes = new Set(c.sources.map((s) => s.doc_type_key));
    const declared = c.sources.every((s) => s.doc_type_key === 'loan_application');
    c.status = docTypes.size >= 2 ? 'CORROBORATED' : declared ? 'DECLARED' : 'SINGLE_SOURCE';
  }
  return { claims, leaf_count: leafCount, unresolved_count: unresolvedCount };
}

/** Hai tên cùng nghĩa (đảo họ tên / khác dấu) → khác cách viết, không phải mâu thuẫn. Tái dùng luật của S3 (nameLevel), không viết luật thứ hai. */
const sameName = (a: Claim, b: Claim) => a.value_kind === 'name' && isNameMatch(nameLevel(String(a.value), String(b.value)));
const variantName = (a: Claim, b: Claim) => a.value_kind === 'name' && nameLevel(String(a.value), String(b.value)) === 'SPELLING_DIFFERENCE'
  && stripDiacritics(normalizeName(String(a.value))) === stripDiacritics(normalizeName(String(b.value)));

/**
 * Xếp trạng thái cho nhóm có nhiều giá trị khác nhau cùng (chủ thể, trường).
 *  - Tên: chỉ khác dấu → SPELLING_VARIANT (hai bên đều giữ, KHÔNG nối CONTRADICTS). Đảo họ tên → coi như cùng, bỏ qua.
 *  - Còn lại: nối CONTRADICTS; lệch đúng 1 ký tự so với đa số (mã dài ≥ NEAR_MATCH_MIN_LENGTH) → nghi lỗi đọc, ngược lại DISPUTED.
 */
function markStatus(group: Claim[]): void {
  const weight = (c: Claim) => new Set(c.sources.map((s) => s.evidence_id)).size;
  const sorted = [...group].sort((a, b) => weight(b) - weight(a));
  const major = sorted[0];

  const real = group.filter((c) => c === major || !(sameName(c, major) || variantName(c, major)));
  for (const c of group) {
    if (c !== major && variantName(c, major)) c.status = 'SPELLING_VARIANT';
  }
  if (real.length < 2) return; // mọi giá trị còn lại chỉ là cách viết khác của giá trị đa số
  for (const c of real) c.contradicts = real.filter((o) => o !== c).map((o) => o.claim_id);
  for (const c of real) {
    const textual = typeof c.value_norm === 'string' && typeof major.value_norm === 'string';
    const near = c !== major && textual && c.value_kind === 'key' && weight(c) === 1 && weight(major) >= 2
      && (c.value_norm as string).length >= NEAR_MATCH_MIN_LENGTH && (major.value_norm as string).length >= NEAR_MATCH_MIN_LENGTH && distance(c.value_norm as string, major.value_norm as string) === 1;
    c.status = near ? 'PROBABLE_OCR_ERROR' : 'DISPUTED';
  }
}

/** Tổng số nguồn trong sổ — phải bằng `leaf_count` (bất biến lossless). */
export function sourceCount(ledger: ClaimLedger): number {
  return ledger.claims.reduce((n, c) => n + c.sources.length, 0);
}
