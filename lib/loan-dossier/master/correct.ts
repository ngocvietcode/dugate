// Hiệu chỉnh trường CONFLICT của master_dossier (MD-R15…R18, R20; D-67…D-69).
// Hai hàm thuần, tất định, không gọi model, không log giá trị: `proposeMasterCorrections` chọn trường đáng hỏi LLM
// (cổng G2, G3 và loại giá trị); `applyMasterCorrections` nhận quyết định của LLM (chỉ `option_id`) và kiểm tra V1, V2.
//
// Giai đoạn 2 chạy khi hồ sơ nhìn chung đã chính xác, nên xung đột chủ yếu là lỗi đọc OCR giữa các bản. Cổng chỉ quyết định
// CÓ HỎI LLM hay không, không quyết định giá trị: trước đây G1 (đa số tuyệt đối ≥ 2 chứng từ) và G4 (bản lệch cùng một loại tài liệu)
// loại cả trường chỉ có hai bản (1 đối 1) — dạng phổ biến nhất. Nay các giá trị chỉ cần là biến thể đọc sai của nhau (G2);
// số nguồn, độ tin cậy, chứng từ chuẩn và hợp lệ định dạng được đưa cho LLM làm căn cứ chọn, còn LLM vẫn được KEEP_CONFLICT.
import { createHash } from 'crypto';
import { distance } from 'fastest-levenshtein';

import type { MasterDossier, MasterDocument, MasterEntity, MasterEntityField, MasterField, MasterFieldKind } from '../contracts/master-dossier';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { compareKey } from './field';

/** MD-R20: chỉ các loại giá trị định danh / tên / ngày; không money, number, address, text, enum, boolean. */
export const CORRECTABLE_KINDS: ReadonlySet<MasterFieldKind> = new Set<MasterFieldKind>(['code', 'id', 'plate', 'name', 'date']);
/** G2: khoảng cách tối đa giữa khóa so của giá trị lệch và của nhóm đa số. */
export const MAX_CORRECTION_DISTANCE = 2;
/** G2 nới cho họ tên: tên bị đọc sai thường lệch nhiều ký tự hơn (mất dấu, nhầm chữ) so với mã / số. */
export const NAME_RELATIVE_DISTANCE = 0.25;
/** Số giá trị khác nhau tối đa của một trường; nhiều hơn thì không phải biến thể đọc sai của cùng một giá trị. */
export const MAX_CORRECTION_OPTIONS = 4;
/** G3: độ dài tối thiểu của khóa so nhóm đa số. */
const MIN_KEY_LENGTH: Record<string, number> = { code: 6, id: 6, plate: 6, name: 8, date: 8 };
const MAX_REASON = 200;

export type CorrectionScope = 'document' | 'other_document' | 'person' | 'asset';

export interface CorrectionOption {
  option_id: string;
  /** Giá trị đã đọc, nguyên văn. */
  value: unknown;
  /** Khóa so (MD-R06); chỉ dùng nội bộ. */
  key: string;
  /** Lá nguồn (evidence record id) ghi đúng giá trị này. */
  evidence_ids: string[];
  /** "Mẫu biểu (file · tr.a-b)" của từng lá nguồn. */
  where: string[];
  confidence: number | null;
  /** Có lá nguồn thuộc loại chứng từ chuẩn của trường (S5 `canonical_source`, chỉ trường của người / tài sản). */
  canonical: boolean;
  /** Hợp lệ định dạng (CCCD 9 / 12 chữ số, ngày thật); null khi không kiểm tra được. Chỉ là gợi ý, không loại giá trị. */
  format_ok: boolean | null;
}

export interface CorrectionProposal {
  proposal_id: string;
  scope: CorrectionScope;
  /** `document_id` hoặc `entity_id`. */
  scope_id: string;
  /** Tên chứng từ / người / tài sản để LLM biết trường thuộc về đâu. */
  scope_label: string;
  field_index: number;
  path: string;
  label: string;
  kind: MasterFieldKind;
  options: CorrectionOption[];
}

export interface CorrectionDecision {
  proposal_id: string;
  action: 'SELECT' | 'KEEP_CONFLICT';
  option_id: string | null;
  reason: string;
}

const topField = (path: string) => path.split(/[.[]/)[0];
const evidenceOf = (recordId: string) => recordId.split('#')[0];

function whereOf(byId: ReadonlyMap<string, EvidenceEnvelope>, recordId: string): string {
  const e = byId.get(evidenceOf(recordId));
  if (!e) return evidenceOf(recordId);
  const [a, b] = e.page_range;
  return `${e.doc_type_label} (${e.file_name} · tr.${a}${b !== a ? `-${b}` : ''})`;
}

function minConfidence(byId: ReadonlyMap<string, EvidenceEnvelope>, recordIds: string[], path: string): number | null {
  const cs = recordIds.map((r) => byId.get(evidenceOf(r))?.field_confidences[topField(r.split('#')[1] ?? path)] ?? null);
  return cs.length === 0 || cs.some((c) => c === null) ? null : Math.min(...(cs as number[]));
}

/** Gộp `candidates` theo khóa so (một số nguồn S5 có khóa chuẩn hóa khác MD-R06); thứ tự theo lần xuất hiện đầu. */
/** Gợi ý hợp lệ định dạng; null = không kiểm tra được (không phải `false`). */
export function formatOk(kind: MasterFieldKind, value: unknown): boolean | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (kind === 'id') return /^(\d{9}|\d{12})$/.test(s.replace(/[\s.-]/g, ''));
  if (kind === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return y >= 1900 && y <= 2100 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }
  return null;
}

function groupOptions(field: MasterField, byId: ReadonlyMap<string, EvidenceEnvelope>, canonicalDocType: string | null): CorrectionOption[] | null {
  const groups = new Map<string, { value: unknown; ids: string[] }>();
  for (const c of field.candidates) {
    const key = compareKey(field.kind, c.value);
    if (key === null) return null;
    const g = groups.get(key);
    if (g) g.ids.push(...c.evidence_ids);
    else groups.set(key, { value: c.value, ids: [...c.evidence_ids] });
  }
  return [...groups.entries()].map(([key, g], i) => ({
    option_id: `o${i + 1}`, value: g.value, key, evidence_ids: g.ids,
    where: g.ids.map((r) => whereOf(byId, r)), confidence: minConfidence(byId, g.ids, field.path),
    canonical: canonicalDocType !== null && g.ids.some((r) => byId.get(evidenceOf(r))?.doc_type_key === canonicalDocType),
    format_ok: formatOk(field.kind, g.value),
  }));
}

const evidenceCount = (o: CorrectionOption) => new Set(o.evidence_ids.map(evidenceOf)).size;

/** Lựa chọn dùng làm mốc so khoảng cách (G2): nhiều chứng từ ủng hộ nhất; hòa thì độ tin cậy cao hơn; hòa nữa thì lựa chọn xuất hiện trước. */
function pickAnchor(options: CorrectionOption[]): CorrectionOption {
  return options.reduce((best, o) => {
    const [a, b] = [evidenceCount(o), evidenceCount(best)];
    if (a !== b) return a > b ? o : best;
    return (o.confidence ?? -1) > (best.confidence ?? -1) ? o : best;
  }, options[0]);
}

/** Khoảng cách tối đa cho phép giữa hai khóa so (G2); họ tên được nới theo độ dài. */
export function allowedDistance(kind: MasterFieldKind, a: string, b: string): number {
  return kind === 'name' ? Math.max(MAX_CORRECTION_DISTANCE, Math.floor(Math.min(a.length, b.length) * NAME_RELATIVE_DISTANCE)) : MAX_CORRECTION_DISTANCE;
}

/**
 * Cổng gửi LLM (MD-R15). Trả về null nếu trường không phải biến thể đọc sai của cùng một giá trị.
 *  - G2: mọi lựa chọn nằm trong khoảng cách cho phép so với lựa chọn được ủng hộ nhiều nhất (1 đối 1 và hòa phiếu vẫn qua).
 *  - G3: khóa dài nhất đủ dài để lệch vài ký tự là lỗi đọc chứ không phải hai giá trị khác nhau.
 *  - Số lựa chọn ≤ MAX_CORRECTION_OPTIONS.
 * Việc CHỌN lựa chọn nào do LLM quyết (kèm số nguồn, độ tin cậy, chứng từ chuẩn, hợp lệ định dạng) và có thể KEEP_CONFLICT.
 */
function eligibleOptions(field: MasterField, byId: ReadonlyMap<string, EvidenceEnvelope>, canonicalDocType: string | null): CorrectionOption[] | null {
  if (field.status !== 'CONFLICT' || !CORRECTABLE_KINDS.has(field.kind)) return null;
  const options = groupOptions(field, byId, canonicalDocType);
  if (!options || options.length < 2 || options.length > MAX_CORRECTION_OPTIONS) return null;
  const top = pickAnchor(options);
  if (Math.max(...options.map((o) => o.key.length)) < (MIN_KEY_LENGTH[field.kind] ?? 6)) return null; // G3
  if (!options.every((o) => o === top || (() => { const d = distance(top.key, o.key); return d >= 1 && d <= allowedDistance(field.kind, top.key, o.key); })())) return null; // G2
  return options;
}

function proposalId(scopeId: string, index: number, path: string, options: CorrectionOption[]): string {
  const keys = options.map((o) => o.key).sort().join('|');
  return `mc-${createHash('sha256').update(`${scopeId}|${index}|${path}|${keys}`).digest('hex').slice(0, 12)}`;
}

/** MD-R15, MD-R18: danh sách trường đủ căn cứ để hỏi LLM; cùng master + evidence → cùng kết quả. */
export function proposeMasterCorrections(master: MasterDossier, evidences: ReadonlyArray<EvidenceEnvelope>): CorrectionProposal[] {
  const byId = new Map(evidences.map((e) => [e.evidence_id, e]));
  const out: CorrectionProposal[] = [];
  const scan = (scope: CorrectionScope, scopeId: string, scopeLabel: string, fields: ReadonlyArray<MasterField>) => {
    fields.forEach((f, index) => {
      const options = eligibleOptions(f, byId, 'canonical_doc_type_key' in f ? (f as { canonical_doc_type_key: string | null }).canonical_doc_type_key : null);
      if (options) {
        out.push({
          proposal_id: proposalId(scopeId, index, f.path, options), scope, scope_id: scopeId, scope_label: scopeLabel,
          field_index: index, path: f.path, label: f.label, kind: f.kind, options,
        });
      }
    });
  };
  const docLabel = (d: MasterDocument) => d.item_label ?? d.doc_type_label ?? d.document_id;
  for (const d of master.documents) scan('document', d.document_id, docLabel(d), d.fields);
  for (const d of master.other_documents) scan('other_document', d.document_id, docLabel(d), d.fields);
  for (const e of master.persons) scan('person', e.entity_id, e.label, e.fields);
  for (const e of master.assets) scan('asset', e.entity_id, e.label, e.fields);
  return out;
}

function corrected<T extends MasterField>(field: T, proposal: CorrectionProposal, option: CorrectionOption, reason: string): T {
  const rest = proposal.options.filter((o) => o.option_id !== option.option_id);
  const note = `Đã hiệu chỉnh: chọn "${String(option.value)}" (${option.where.join('; ')}) thay cho ${rest.map((o) => `"${String(o.value)}" (${o.where.join('; ')})`).join('; ')}. Cần xác nhận.`;
  return {
    ...field,
    value: option.value,
    status: 'CORRECTED',
    review_status: 'REVIEW',
    confidence: option.confidence,
    sources: option.evidence_ids,
    outliers: [],
    note,
    correction: {
      method: 'LLM_SELECTED_CANDIDATE',
      proposal_id: proposal.proposal_id,
      original: { status: 'CONFLICT', value: field.value },
      distance: Math.max(...rest.map((o) => distance(option.key, o.key))),
      minority: rest.flatMap((o) => o.evidence_ids.map((evidence_id) => ({ evidence_id, raw_value: o.value }))),
      reason: reason.slice(0, MAX_REASON),
    },
  };
}

/**
 * MD-R16 (V1, V2), MD-R17: áp dụng quyết định của LLM. Quyết định không hợp lệ (mã lạ, `option_id` ngoài danh sách, KEEP_CONFLICT)
 * hoặc trường đã đổi so với đề xuất → giữ nguyên `CONFLICT`. Giá trị áp dụng luôn là nguyên văn một giá trị đã đọc.
 */
export function applyMasterCorrections(
  master: MasterDossier,
  proposals: ReadonlyArray<CorrectionProposal>,
  decisions: ReadonlyArray<CorrectionDecision>,
): MasterDossier {
  const byProposal = new Map(proposals.map((p) => [p.proposal_id, p]));
  const chosen = new Map<string, { proposal: CorrectionProposal; option: CorrectionOption; reason: string }>();
  for (const d of decisions) {
    const proposal = byProposal.get(d.proposal_id); // V1
    if (!proposal || chosen.has(d.proposal_id) || d.action !== 'SELECT') continue;
    const option = proposal.options.find((o) => o.option_id === d.option_id); // V2
    if (option) chosen.set(d.proposal_id, { proposal, option, reason: typeof d.reason === 'string' ? d.reason : '' });
  }
  if (chosen.size === 0) return master;

  const byField = new Map<string, { proposal: CorrectionProposal; option: CorrectionOption; reason: string }>();
  for (const c of chosen.values()) byField.set(`${c.proposal.scope}|${c.proposal.scope_id}|${c.proposal.field_index}`, c);

  const fix = <F extends MasterField>(scope: CorrectionScope, scopeId: string, fields: F[]): F[] => fields.map((f, i) => {
    const c = byField.get(`${scope}|${scopeId}|${i}`);
    return c && f.status === 'CONFLICT' && f.path === c.proposal.path ? corrected(f, c.proposal, c.option, c.reason) : f;
  });
  const fixDocs = (scope: CorrectionScope, docs: MasterDocument[]) => docs.map((d) => ({ ...d, fields: fix(scope, d.document_id, d.fields) }));
  const fixEntities = (scope: CorrectionScope, es: MasterEntity[]) => es.map((e) => ({ ...e, fields: fix<MasterEntityField>(scope, e.entity_id, e.fields) }));

  const documents = fixDocs('document', master.documents);
  const other_documents = fixDocs('other_document', master.other_documents);
  const fields = [...documents, ...other_documents].flatMap((d) => d.fields);
  const count = (s: string) => fields.filter((f) => f.status === s).length;
  return {
    ...master,
    documents,
    other_documents,
    persons: fixEntities('person', master.persons),
    assets: fixEntities('asset', master.assets),
    summary: {
      ...master.summary,
      agreed: count('AGREED'), ocr_normalized: count('OCR_NORMALIZED'), single_source: count('SINGLE_SOURCE'),
      conflict: count('CONFLICT'), missing: count('MISSING'), corrected: count('CORRECTED'),
    },
  };
}
