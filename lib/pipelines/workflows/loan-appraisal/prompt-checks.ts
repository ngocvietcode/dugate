// Thực thi rule LLM của check set.
//
// Nguyên tắc an toàn (nhất quán với cách siết 5C):
//   - Mọi kết luận phải kèm evidence_ids tồn tại trong registry.
//   - PASS chỉ hợp lệ khi evidence đi kèm ở trạng thái ACCEPTED.
//   - confidence < threshold ⇒ REVIEW, không bao giờ FAIL.
//   - Rule khai báo nhưng model không trả ⇒ NOT_RUN, không suy đoán là đạt.

import { JSON_ONLY_OUTPUT_RULE } from '@/lib/loan-dossier/common/llm-json';
import { LAC_CHAR_BUDGET, renderLoanApplicationContext, type LacRender } from '@/lib/loan-dossier/context/render';
import type { LacFact, LoanApplicationContext } from '@/lib/loan-dossier/context/schema';
import { lacScopeFromInputs } from '@/lib/loan-dossier/context/scope';
import type { Profile360 } from '@/lib/loan-dossier/profile360/schema';
import type { LoanCheckDefinition, LoanCheckSet } from './check-set';
import { resolveRuleGroup } from './rule-groups';

/**
 * Schema đầu ra gửi cho model. Khác `LOAN_CHECK_OUTPUT_SCHEMA` (schema lưu trong config_snapshot) ở dạng tham chiếu: model dẫn
 * mã dữ kiện F<n> của Loan Application Context (LAC-R13), hoặc "D<n>:<field>" của phụ lục OCR thô; server đổi về record_id
 * trước khi lưu, nên RuleResult.evidence_ids vẫn là evidence_id thật.
 */
export const PROMPT_CHECK_OUTPUT_SCHEMA =
  '{ "results": [{ "id": "<id kiểm tra>", "status": "PASS|REVIEW|FAIL|INSUFFICIENT_DATA", "confidence": 0.0, '
  + '"code": "<một mã trong danh sách MÃ KẾT QUẢ của kiểm tra>", '
  + '"reason": "<tối đa 2 câu, không lặp lại họ tên hay số định danh>", "evidence_ids": ["F3", "F12.2"] }] }';
import { allowedCodes, parseModelCheckOutput, resolveModelCode } from './check-contract';
import {
  ensurePlaceholders,
  sanitizeFileName,
  UNTRUSTED_DATA_GUARD,
  untrustedBlock,
} from '../prompts/loan-appraisal-prompts';
import type { EvidenceRecord, EvidenceRegistry, FinancialMetrics, RuleResult } from './types';

// ─── Ngân sách dữ liệu đưa vào prompt ─────────────────────────────────────────
// Giới hạn theo KÝ TỰ (≈ token) chứ không theo số dòng: 400 dòng evidence từng
// tạo prompt ~50k ký tự, phần lớn là dữ liệu không rule nào cần (log tra cứu
// CIC, metadata mẫu biểu). ~18k ký tự ≈ 6–7k token tiếng Việt.
export const EVIDENCE_CHAR_BUDGET = 18_000;
/**
 * Phụ lục OCR thô (`ocr.<doc>`) dùng chung ngân sách với LAC: tối đa một phần ba, LAC nhận phần còn lại. Phụ lục chỉ bổ sung cho
 * trường LAC không trình bày được (VD bảng CIC dài), nên không được lấn phần dữ kiện đã gom.
 */
export const OCR_APPENDIX_CHAR_BUDGET = Math.floor(EVIDENCE_CHAR_BUDGET / 3);
const MAX_VALUE_LENGTH = 160;
/** Số phần tử tối đa của một field lặp trong mảng (VD danh sách TCTD đã tra cứu CIC). */
export const MAX_ARRAY_ITEMS_PER_FIELD = 8;
/**
 * Khối metadata mẫu biểu/người ký: không phục vụ phán đoán của rule và dễ làm
 * model nhầm người ký với khách hàng (bước hợp nhất cũng bỏ khối này).
 */
const OMITTED_FIELD_PREFIXES = ['legal_info.'];

export interface PromptCheckInput {
  checkSet: LoanCheckSet;
  evidence: EvidenceRegistry;
  financial: FinancialMetrics;
  /** Loan Application Context (D-103): nguồn dữ liệu duy nhất của rule LLM, trừ phụ lục OCR thô theo `ocr.<doc>`. */
  lac: LoanApplicationContext;
  /** Hồ sơ 360 của cùng lần chạy (D-114): LAC render nguồn thu / hộ kinh doanh theo đơn vị của nó. */
  profile?: Profile360 | null;
}

/** Bảng mã đã gửi cho model trong một lần dựng prompt; parse dùng đúng bảng này để đổi mã về record_id. */
export interface PromptCheckRefs {
  /** F<n> / F<n>.<k> của LAC. */
  render: LacRender;
  /** D<n>:<field> của phụ lục OCR thô; null khi không rule nào khai `ocr.<doc>`. */
  ocr: PromptEvidenceSelection | null;
  /** Template ghi đè trên Profile thiếu {{context}} (kiểu cũ {{master_data}} + {{evidence}}) đã được tự chuyển (D-120). */
  legacyTemplate: boolean;
}

export function enabledPromptChecks(checkSet: LoanCheckSet): LoanCheckDefinition[] {
  return checkSet.checks.filter((check) => check.kind === 'PROMPT' && check.enabled);
}

/**
 * Loại chứng từ cần kèm OCR thô (`ocr.<doc_type_key>` trong `input`, D-120). Rỗng ⇒ không có phụ lục. Chỉ rule khai tường minh mới
 * kéo OCR thô vào: LAC đã chứa mọi lá (lossless), phụ lục chỉ dành cho trường LAC trình bày kém (bảng dài, cấu trúc lồng).
 */
export function ocrAppendixDocTypes(checks: LoanCheckDefinition[]): Set<string> {
  const out = new Set<string>();
  for (const source of checks.flatMap((check) => check.input)) {
    const m = source.trim().match(/^ocr\.([a-z0-9_]+)$/);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Giá trị đưa vào prompt: chuỗi cắt ngắn; số/boolean giữ nguyên kiểu. */
function promptValue(value: EvidenceRecord['normalized_value']): string | number | boolean | null {
  if (typeof value !== 'string') return value;
  const oneLine = value.replace(/[\r\n]+/g, ' ');
  return oneLine.length > MAX_VALUE_LENGTH ? `${oneLine.slice(0, MAX_VALUE_LENGTH)}…` : oneLine;
}

/** Tách field path thành segment: "a.b[2].c" → ["a", "b", 2, "c"]. */
function pathSegments(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const pattern = /\[(\d+)\]|([^.[\]]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(path)) !== null) {
    if (match[1] !== undefined) segments.push(Number(match[1]));
    else segments.push(/^\d+$/.test(match[2]) ? Number(match[2]) : match[2].trim());
  }
  return segments;
}

/**
 * Dạng chuẩn của field path để so khớp tham chiếu model trả về: chấp nhận cả
 * "a.b[2].c" lẫn "a.b.2.c" (model hay viết chỉ số mảng bằng dấu chấm).
 */
export function canonicalFieldPath(path: string): string {
  return pathSegments(path)
    .map((segment) => typeof segment === 'number' ? `[${segment}]` : `.${segment}`)
    .join('')
    .replace(/^\./, '');
}

type JsonNode = Record<string, unknown> | unknown[];

function setNested(root: Record<string, unknown>, segments: Array<string | number>, value: unknown): void {
  let node: JsonNode = root;
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    const container = node as Record<string | number, unknown>;
    if (isLast) {
      container[segment] = value;
      return;
    }
    const existing = container[segment];
    if (existing === null || typeof existing !== 'object') {
      container[segment] = typeof segments[index + 1] === 'number' ? [] : {};
    }
    node = container[segment] as JsonNode;
  });
}

/**
 * Mảng có phần tử bị lược (do ngân sách) sẽ thành mảng thưa; JSON hoá mảng thưa
 * ra `null` dễ bị hiểu là "giá trị rỗng". Đổi mảng thưa thành object khoá theo
 * chỉ số để model vẫn đọc đúng chỉ số gốc khi dẫn nguồn.
 */
function densify(node: unknown): unknown {
  if (Array.isArray(node)) {
    const sparse = node.length !== Object.keys(node).length;
    if (!sparse) return node.map(densify);
    return Object.fromEntries(Object.keys(node).map((key) => [key, densify(node[Number(key)])]));
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, child]) => [key, densify(child)]));
  }
  return node;
}

/** Khoá gom các phần tử cùng field trong mảng. `instances[i]` là người/tài sản khác nhau nên giữ nguyên chỉ số. */
function repeatedFieldKey(record: EvidenceRecord): string | null {
  let repeated = false;
  const stripped = record.field_path.replace(/(\binstances)?\[\d+\]/g, (match, instances?: string) => {
    if (instances) return match;
    repeated = true;
    return '[]';
  });
  return repeated ? `${record.file_name}\u0000${record.doc_type_key}\u0000${stripped}` : null;
}

/** Thống kê lần chọn evidence (chỉ số đếm — an toàn để ghi log/content_preview). */
export interface PromptEvidenceStats {
  documents: number;
  shown: number;
  omitted_out_of_scope: number;
  omitted_metadata: number;
  omitted_repeated: number;
  omitted_budget: number;
  chars: number;
}

export interface PromptEvidenceSelection extends PromptEvidenceStats {
  text: string;
  /** "D<n>" → danh sách [field path chuẩn, evidence_id] của evidence ĐÃ hiển thị. */
  refIndex: Map<string, Array<[string, string]>>;
}

/** Hướng dẫn dẫn nguồn đặt ngay trong khối dữ liệu để vẫn đúng khi admin override template. */
const EVIDENCE_FORMAT_NOTE = 'Mỗi chứng từ có mã D<n> kèm [tên file · loại chứng từ] và dữ liệu bóc tách dạng JSON. '
  + 'Dẫn nguồn bằng "D<n>:<đường dẫn field>" đúng như trong JSON, VD "D1:personal_info.full_name" hoặc '
  + '"D2:owners[0].id_number". Dòng "REVIEW:" liệt kê field chưa được chấp nhận; field còn lại đã ACCEPTED.';

/**
 * Chọn và định dạng phụ lục OCR thô cho rule LLM (D-120):
 *   1. Chỉ loại chứng từ mà rule khai báo (`ocr.<doc_type>`); `null` = mọi loại.
 *   2. Bỏ metadata mẫu biểu (`legal_info.*`) và cắt field lặp trong mảng.
 *   3. Chia ngân sách ký tự xoay vòng giữa các chứng từ, để một chứng từ dài
 *      (CIC, bảng kê) không chiếm hết chỗ của chứng từ khác.
 *   4. Mỗi chứng từ một mã ngắn D<n> + JSON lồng nhau (không lặp đường dẫn đầy
 *      đủ trên từng dòng như dạng bảng). Model dẫn nguồn "D<n>:<field>", server
 *      đổi về evidence_id thật qua `resolveEvidenceRefs` nên rào an toàn
 *      (tồn tại, ACCEPTED, ngưỡng) giữ nguyên.
 * Hàm thuần và tất định: bước parse dựng lại đúng bảng mã từ cùng input.
 */
export function selectPromptEvidence(
  evidence: EvidenceRegistry,
  docTypes: Set<string> | null,
  budget = EVIDENCE_CHAR_BUDGET,
): PromptEvidenceSelection {
  const extracted = evidence.records.filter((record) => record.evidence_kind !== 'CHECKLIST_STATUS');
  const inScope = docTypes
    ? extracted.filter((record) => docTypes.has(record.doc_type_key) || (record.master_scope !== undefined && docTypes.has(record.master_scope)))
    : extracted;
  const omittedOutOfScope = extracted.length - inScope.length;

  const withoutMetadata = inScope.filter((record) => !OMITTED_FIELD_PREFIXES.some((prefix) => record.field_path.startsWith(prefix)));
  const omittedMetadata = inScope.length - withoutMetadata.length;

  const repeatCount = new Map<string, number>();
  const candidates: EvidenceRecord[] = [];
  for (const record of withoutMetadata) {
    const key = repeatedFieldKey(record);
    if (key) {
      const count = (repeatCount.get(key) ?? 0) + 1;
      repeatCount.set(key, count);
      if (count > MAX_ARRAY_ITEMS_PER_FIELD) continue;
    }
    candidates.push(record);
  }
  const omittedRepeated = withoutMetadata.length - candidates.length;

  // Nhóm theo chứng từ (file + loại), giữ thứ tự xuất hiện.
  const blocks = new Map<string, { file_name: string; doc_type_key: string; records: EvidenceRecord[]; taken: number }>();
  for (const record of candidates) {
    const key = `${record.file_name}\u0000${record.doc_type_key}`;
    let block = blocks.get(key);
    if (!block) {
      block = { file_name: record.file_name, doc_type_key: record.doc_type_key, records: [], taken: 0 };
      blocks.set(key, block);
    }
    block.records.push(record);
  }

  // Xoay vòng: mỗi lượt lấy 1 field từ mỗi chứng từ cho tới khi hết ngân sách.
  // Chi phí ước theo JSON của khoá lá + giá trị (+ đường dẫn nếu là field REVIEW).
  const headerCost = (block: { file_name: string; doc_type_key: string }) =>
    sanitizeFileName(block.file_name).length + block.doc_type_key.length + 14;
  const fieldCost = (record: EvidenceRecord) => {
    const segments = pathSegments(record.field_path);
    const leaf = segments[segments.length - 1];
    return JSON.stringify(String(leaf)).length + JSON.stringify(promptValue(record.normalized_value)).length + 2
      + (record.review_status === 'REVIEW' ? record.field_path.length + 2 : 0);
  };
  const blockList = [...blocks.values()];
  let used = EVIDENCE_FORMAT_NOTE.length + 1;
  let shown = 0;
  let exhausted = false;
  while (!exhausted) {
    let progressed = false;
    for (const block of blockList) {
      if (block.taken >= block.records.length) continue;
      const cost = fieldCost(block.records[block.taken]) + (block.taken === 0 ? headerCost(block) : 0);
      if (used + cost > budget) { exhausted = true; break; }
      block.taken += 1;
      used += cost;
      shown += 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  const omittedBudget = candidates.length - shown;

  // Mã D<n> chỉ cấp cho chứng từ có ít nhất một field được hiển thị.
  const refIndex = new Map<string, Array<[string, string]>>();
  const rendered = blockList.filter((block) => block.taken > 0).map((block, index) => {
    const code = `D${index + 1}`;
    const visible = block.records.slice(0, block.taken);
    const data: Record<string, unknown> = {};
    for (const record of visible) setNested(data, pathSegments(record.field_path), promptValue(record.normalized_value));
    refIndex.set(code, visible.map((record) => [canonicalFieldPath(record.field_path), record.evidence_id]));

    const reviewPaths = visible.filter((record) => record.review_status === 'REVIEW').map((record) => canonicalFieldPath(record.field_path));
    const remaining = block.records.length - block.taken;
    return [
      `${code} [${sanitizeFileName(block.file_name)} · ${block.doc_type_key}]`,
      ...(reviewPaths.length === 0 ? [] : reviewPaths.length === visible.length
        ? ['REVIEW: toàn bộ field của chứng từ này']
        : [`REVIEW: ${reviewPaths.join(', ')}`]),
      JSON.stringify(densify(data)),
      ...(remaining > 0 ? [`(… lược ${remaining} field của chứng từ này do giới hạn độ dài)`] : []),
    ].join('\n');
  });

  const notes: string[] = [];
  if (omittedRepeated > 0) {
    notes.push(`lược ${omittedRepeated} giá trị lặp trong mảng (chỉ giữ ${MAX_ARRAY_ITEMS_PER_FIELD} phần tử đầu mỗi field)`);
  }
  if (omittedBudget > 0) notes.push(`lược ${omittedBudget} field do giới hạn độ dài`);
  const text = [
    ...(rendered.length > 0 ? [EVIDENCE_FORMAT_NOTE, ...rendered] : ['(không có evidence thuộc nguồn dữ liệu các kiểm tra khai báo)']),
    ...(notes.length > 0 ? [`(Ghi chú: ${notes.join('; ')}. Dữ liệu cần để kết luận mà không có ở đây ⇒ trả INSUFFICIENT_DATA.)`] : []),
  ].join('\n');

  return {
    text,
    refIndex,
    documents: rendered.length,
    shown,
    omitted_out_of_scope: omittedOutOfScope,
    omitted_metadata: omittedMetadata,
    omitted_repeated: omittedRepeated,
    omitted_budget: omittedBudget,
    chars: text.length,
  };
}

/** Số evidence tối đa một tham chiếu nhóm (VD "D2:owners[0]") được mở rộng thành. */
const MAX_EVIDENCE_PER_GROUP_REF = 6;

/**
 * Đổi tham chiếu model trả về thành evidence_id thật.
 *   - "D<n>:<field>" khớp đúng field đã hiển thị ⇒ evidence_id của field đó.
 *   - "D<n>:<nhóm>" (đường dẫn cha) ⇒ tối đa 6 field đã hiển thị bên trong nhóm.
 *   - evidence_id gốc (ev-…) vẫn nhận, để template override kiểu cũ không vỡ.
 * Tham chiếu tới field KHÔNG được hiển thị cho model bị loại: model không thể đã đọc nó.
 */
export function resolveEvidenceRefs(
  requested: readonly string[],
  selection: Pick<PromptEvidenceSelection, 'refIndex'>,
  validIds: ReadonlySet<string>,
): { evidenceIds: string[]; dropped: number } {
  const resolved: string[] = [];
  let dropped = 0;
  for (const raw of requested) {
    const ref = raw.trim();
    if (validIds.has(ref)) { resolved.push(ref); continue; }
    const match = /^(D\d+)\s*[:.]\s*(.+)$/i.exec(ref);
    const entries = match ? selection.refIndex.get(match[1].toUpperCase()) : undefined;
    if (!match || !entries) { dropped += 1; continue; }
    const path = canonicalFieldPath(match[2]);
    const exact = entries.find(([fieldPath]) => fieldPath === path);
    if (exact) { resolved.push(exact[1]); continue; }
    const grouped = entries
      .filter(([fieldPath]) => fieldPath.startsWith(`${path}.`) || fieldPath.startsWith(`${path}[`))
      .slice(0, MAX_EVIDENCE_PER_GROUP_REF);
    if (grouped.length === 0) { dropped += 1; continue; }
    resolved.push(...grouped.map(([, id]) => id));
  }
  return { evidenceIds: [...new Set(resolved)], dropped };
}

/**
 * LAC-R13 (D-103): đổi mã dữ kiện F<n> / F<n>.<k> về record_id (= evidence_id của registry, V2-R04). Mã lạ bị bỏ; evidence_id gốc
 * vẫn nhận nếu có trong registry. Rào an toàn hiện có (tồn tại, ACCEPTED, ngưỡng) chạy trên kết quả như đường D<n>.
 */
export function resolveContextRefs(
  requested: readonly string[],
  render: Pick<LacRender, 'refIndex'>,
  validIds: ReadonlySet<string>,
): { evidenceIds: string[]; dropped: number } {
  const resolved: string[] = [];
  let dropped = 0;
  for (const raw of requested) {
    const ref = raw.trim();
    if (validIds.has(ref)) { resolved.push(ref); continue; }
    const ids = render.refIndex.get(ref.toUpperCase());
    if (!ids || ids.length === 0) { dropped += 1; continue; }
    resolved.push(...ids);
  }
  return { evidenceIds: [...new Set(resolved)], dropped };
}

const OCR_REF = /^D\d+\s*[:.]/i;

/**
 * Đổi mọi mã model trả về: "D<n>:<field>" qua bảng mã của phụ lục OCR thô (không có phụ lục ⇒ bị bỏ), còn lại (F<n>, record_id gốc)
 * qua bảng mã LAC. Cả hai cho ra record_id của cùng registry, nên rào trust của LAC áp như nhau dù model dẫn bằng mã nào.
 */
/** Phần bảng mã mà parse cần (đủ để dựng tay trong test). */
export interface PromptRefIndex {
  render: Pick<LacRender, 'refIndex'>;
  ocr: Pick<PromptEvidenceSelection, 'refIndex'> | null;
}

export function resolvePromptRefs(
  requested: readonly string[],
  refs: PromptRefIndex,
  validIds: ReadonlySet<string>,
): { evidenceIds: string[]; dropped: number } {
  const ocrRefs = requested.filter((ref) => OCR_REF.test(ref.trim()));
  const fromLac = resolveContextRefs(requested.filter((ref) => !OCR_REF.test(ref.trim())), refs.render, validIds);
  const fromOcr = refs.ocr ? resolveEvidenceRefs(ocrRefs, refs.ocr, validIds) : { evidenceIds: [], dropped: ocrRefs.length };
  return { evidenceIds: [...new Set([...fromLac.evidenceIds, ...fromOcr.evidenceIds])], dropped: fromLac.dropped + fromOcr.dropped };
}

/** Trust nào không cho phép PASS (LAC-R13 bước 3). */
const UNSAFE_PASS_TRUST = new Set<LacFact['trust']>(['DISPUTED', 'PROBABLE_OCR_ERROR', 'SUPERSEDED']);

function compactFinancial(financial: FinancialMetrics): string {
  return Object.entries(financial)
    .map(([key, metric]) => `${key}: ${metric.status === 'CALCULATED' ? metric.value : 'CHƯA ĐỦ DỮ LIỆU'}`)
    .join('\n');
}

/**
 * Prompt mặc định của rule LLM (step key `policy_checks`; LAC-R16, spec §6.2, D-120). Dùng chung cho code và bản mẫu trên /profiles.
 * Placeholder bắt buộc: {{checks}}, {{context}}, {{output_schema}}; tùy chọn {{financial}}, {{evidence}} (phụ lục OCR thô, chỉ có nội
 * dung khi rule khai `ocr.<doc>`). Ngưỡng tin cậy KHÔNG đưa vào prompt để model không tự nâng confidence cho vượt ngưỡng; ngưỡng chỉ
 * áp ở bước parse. Quy tắc 2, 5 và hai quy tắc về chủ thể / mâu thuẫn cũng được code kiểm lại khi parse (LAC-R13), prompt chỉ nói trước.
 */
export const POLICY_CHECKS_PROMPT_TEMPLATE = `Bạn là chuyên viên thẩm định tín dụng. Thực hiện từng KIỂM TRA dưới đây trên HỒ SƠ VAY đã được hệ thống bóc tách và gom.

QUY TẮC BẮT BUỘC:
1. Mỗi kiểm tra phải trả về đúng một kết quả, dùng lại đúng id đã cho.
2. evidence_ids là mã dữ kiện F<n> (hoặc F<n>.<k> để chỉ chứng từ thứ k của dữ kiện đó) có trong HỒ SƠ VAY bên dưới. Chỉ khi dữ liệu cần dùng chỉ có ở PHỤ LỤC OCR THÔ mới dẫn "D<n>:<đường dẫn field>" của phụ lục. Tuyệt đối không tự tạo mã.
3. Nếu không tìm được dữ kiện để chứng minh, trả status="INSUFFICIENT_DATA" và evidence_ids=[]. Không suy đoán. Kiểm tra cần dữ liệu nằm ở mục KHOẢNG TRỐNG thì trả INSUFFICIENT_DATA.
4. status chỉ nhận: PASS | REVIEW | FAIL | INSUFFICIENT_DATA.
5. PASS chỉ khi mọi dữ kiện dẫn chiếu không "cần soát" và không DISPUTED / PROBABLE_OCR_ERROR. Dữ kiện DECLARED là lời khai của khách hàng (đơn vay, bảng kê): PASS không được dẫn dữ kiện DECLARED; dẫn dữ kiện CORROBORATED / SINGLE_SOURCE của chính thông tin đó, không có thì trả REVIEW.
6. Người và tài sản đã được hệ thống gom: person-n / asset-n là CÙNG một chủ thể trên mọi chứng từ. Không tự gom lại; nếu thấy gom sai, trả REVIEW và nêu lý do.
7. Mâu thuẫn đã được liệt kê ở mục MÂU THUẪN; chỉ báo mâu thuẫn khác khi khác biệt mang tính thực chất (OCR có thể sai dấu, nhầm O↔0, l↔1).
8. confidence là số thực 0..1 thể hiện mức chắc chắn của bạn; BẮT BUỘC có cho mọi kết quả.
9. reason viết bằng tiếng Việt, ngắn gọn (tối đa 2 câu), nêu rõ giá trị bạn đã so sánh. Mỗi kết quả dẫn tối đa 6 mã tiêu biểu.

CHỈ SỐ TÀI CHÍNH ĐÃ TÍNH:
{{financial}}

HỒ SƠ VAY (dữ kiện F<n> [trạng thái; nguồn], quan hệ, mâu thuẫn, khoảng trống):
{{context}}

PHỤ LỤC OCR THÔ (chỉ các loại chứng từ kiểm tra khai ocr.<loại>; mỗi chứng từ: mã D<n> [file · loại], dòng REVIEW nếu có, rồi JSON):
{{evidence}}

CÁC KIỂM TRA CẦN THỰC HIỆN:
{{checks}}

CHỈ trả về JSON đúng schema sau, không kèm lời dẫn hay markdown:
{{output_schema}}`;

const NO_OCR_APPENDIX = '(không có — không kiểm tra nào khai ocr.<loại chứng từ>)';

/**
 * D-120: template ghi đè kiểu cũ (trước LAC: {{master_data}} + {{evidence}}, không có {{context}}) được tự chuyển thay vì chạy
 * đường cũ đã gỡ: {{master_data}} đầu tiên thành {{context}}, các chỗ còn lại bỏ; thiếu cả hai thì nối {{context}} ở cuối.
 * {{evidence}} giữ nguyên nghĩa phụ lục OCR thô.
 */
export function upgradeLegacyPolicyTemplate(template: string): { template: string; legacy: boolean } {
  if (/\{\{\s*context\s*\}\}/.test(template)) return { template, legacy: false };
  let replaced = false;
  const upgraded = template.replace(/\{\{\s*master_data\s*\}\}/g, () => {
    if (replaced) return '';
    replaced = true;
    return '{{context}}';
  });
  return { template: ensurePlaceholders(upgraded, ['context']), legacy: true };
}

/** Dựng prompt cho TẤT CẢ rule LLM trong một lần gọi để giảm chi phí. */
export function buildPromptCheckVars(
  input: PromptCheckInput,
  promptOverride?: string,
  /** Nhận bảng mã F<n> / D<n> đã gửi (để parse) và cờ template cũ (để ghi warning). */
  onRefs?: (refs: PromptCheckRefs) => void,
): Record<string, unknown> {
  const checks = enabledPromptChecks(input.checkSet);
  const checkBlock = checks
    .map((check) => [
      `--- KIỂM TRA id="${check.id}" ---`,
      `Tên: ${check.name}`,
      `Nguồn dữ liệu khai báo: ${check.input.join(', ') || 'không khai báo'}`,
      `MÃ KẾT QUẢ (chọn đúng một mã cho trường "code"): ${allowedCodes(check.outputs?.codes).join(' | ')}`,
      `Yêu cầu: ${check.prompt}`,
    ].join('\n'))
    .join('\n\n');

  // Phụ lục OCR thô trước, LAC nhận phần ngân sách còn lại (cùng tổng với một khối dữ liệu).
  const ocrTypes = ocrAppendixDocTypes(checks);
  const ocr = ocrTypes.size > 0 ? selectPromptEvidence(input.evidence, ocrTypes, OCR_APPENDIX_CHAR_BUDGET) : null;
  const render = renderLoanApplicationContext(input.lac, lacScopeFromInputs(checks.map((c) => c.input)), LAC_CHAR_BUDGET - (ocr?.chars ?? 0), input.profile ?? null);
  const { template, legacy } = upgradeLegacyPolicyTemplate(promptOverride || POLICY_CHECKS_PROMPT_TEMPLATE);
  onRefs?.({ render, ocr, legacyTemplate: legacy });

  const required = ['checks', 'context', 'output_schema', ...(ocr ? ['evidence'] : [])];
  const body = ensurePlaceholders(template, required).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    switch (key) {
      case 'checks': return checkBlock;
      case 'context': return untrustedBlock('untrusted_loan_context', render.text);
      case 'evidence': return ocr ? untrustedBlock('untrusted_evidence', ocr.text) : NO_OCR_APPENDIX;
      case 'financial': return compactFinancial(input.financial);
      case 'output_schema': return PROMPT_CHECK_OUTPUT_SCHEMA;
      default: return match;
    }
  });
  return { _prompt: `${UNTRUSTED_DATA_GUARD}\n\n${body}\n\n${JSON_ONLY_OUTPUT_RULE}` };
}

const VALID_STATUSES = new Set(['PASS', 'REVIEW', 'FAIL', 'INSUFFICIENT_DATA']);

function normalizeStatus(raw: unknown): 'PASS' | 'REVIEW' | 'FAIL' | 'INSUFFICIENT_DATA' | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return VALID_STATUSES.has(upper) ? upper as 'PASS' | 'REVIEW' | 'FAIL' | 'INSUFFICIENT_DATA' : null;
}

function normalizeConfidence(raw: unknown): number | null {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return null;
  // Một số model trả 0..100 thay vì 0..1.
  const scaled = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  if (scaled < 0 || scaled > 1) return null;
  return scaled;
}

/**
 * Chuẩn hoá output của rule LLM thành RuleResult, áp toàn bộ rào an toàn.
 * Không tin model: mọi evidence_id không tồn tại đều bị loại.
 */
export function parsePromptCheckResults(
  parsed: unknown,
  checkSet: LoanCheckSet,
  evidence: EvidenceRegistry,
  /** Bảng mã F<n> (LAC) và D<n> (phụ lục OCR thô) đã gửi cho model, từ `buildPromptCheckVars`. */
  refs: PromptRefIndex,
  /** LAC của lần dựng prompt: rào theo trust của dữ kiện được dẫn (LAC-R13), dẫn bằng F<n> hay D<n> đều áp. */
  lac: Pick<LoanApplicationContext, 'facts'>,
): RuleResult[] {
  const checks = enabledPromptChecks(checkSet);
  if (checks.length === 0) return [];

  const validIds = new Set(evidence.records.map((record) => record.evidence_id));
  const factOfRecord = new Map<string, LacFact>();
  for (const f of lac.facts) for (const s of f.sources) factOfRecord.set(s.record_id, f);
  const acceptedIds = new Set(
    evidence.records.filter((record) => record.review_status === 'ACCEPTED').map((record) => record.evidence_id),
  );

  // Parse bằng zod (check-contract.ts): phần tử sai hình dạng bị bỏ riêng lẻ, kiểm tra tương ứng ra NOT_RUN.
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of parseModelCheckOutput(parsed).items) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry as unknown as Record<string, unknown>);
  }

  return checks.map((check) => {
    const threshold = check.threshold ?? 0.85;
    const base = {
      rule_id: check.id,
      rule_version: check.version,
      severity: check.severity,
      exception_allowed: check.exception_allowed,
      check_kind: 'PROMPT' as const,
      check_name: check.name,
      group: resolveRuleGroup(check),
      threshold,
      expected: check.input.length > 0 ? { input: check.input } : undefined,
    };

    const raw = byId.get(check.id);
    if (!raw) {
      return {
        ...base,
        result: 'NOT_RUN',
        actual: null,
        confidence: null,
        reason_code: 'PROMPT_CHECK_NOT_RETURNED',
        message: 'Kiểm tra được cấu hình nhưng không có kết quả trả về; không được coi là đạt.',
        evidence_ids: [],
      } satisfies RuleResult;
    }

    const status = normalizeStatus(raw.status);
    const confidence = normalizeConfidence(raw.confidence);
    const reason = typeof raw.reason === 'string' && raw.reason.trim()
      ? raw.reason.trim().slice(0, 1_000)
      : 'Không có diễn giải từ kiểm tra.';
    const requestedEvidence = Array.isArray(raw.evidence_ids)
      ? raw.evidence_ids.filter((id): id is string => typeof id === 'string')
      : [];
    const { evidenceIds, dropped: droppedEvidence } = resolvePromptRefs(requestedEvidence, refs, validIds);
    // Mã đóng: chỉ nhận mã rule đã khai báo; ngoài danh sách → UNKNOWN_CODE và hạ REVIEW (không bao giờ PASS/FAIL).
    const resolvedCode = resolveModelCode(typeof raw.code === 'string' ? raw.code : undefined, check.outputs?.codes);
    const withCode = <T extends object>(r: T): T & { model_code?: string } => (resolvedCode.code ? { ...r, model_code: resolvedCode.code } : r);

    if (resolvedCode.unknown) {
      return withCode({
        ...base,
        result: 'REVIEW',
        actual: status,
        confidence,
        reason_code: 'PROMPT_CHECK_UNKNOWN_CODE',
        message: `${reason} (Mã kết quả của model nằm ngoài danh sách đã khai báo của rule nên hạ xuống cần rà soát.)`,
        evidence_ids: evidenceIds,
      }) satisfies RuleResult;
    }

    if (!status) {
      return {
        ...base,
        result: 'INSUFFICIENT_DATA',
        actual: null,
        confidence,
        reason_code: 'PROMPT_CHECK_INVALID_STATUS',
        message: 'Kết quả trả về không đúng schema; không dùng làm kết luận.',
        evidence_ids: evidenceIds,
      } satisfies RuleResult;
    }

    // Thiếu evidence hợp lệ ⇒ không được kết luận, bất kể model nói gì.
    if (evidenceIds.length === 0) {
      return {
        ...base,
        result: 'INSUFFICIENT_DATA',
        actual: status,
        confidence,
        reason_code: 'PROMPT_CHECK_EVIDENCE_MISSING',
        message: droppedEvidence > 0
          ? `${reason} (Đã loại ${droppedEvidence} tham chiếu evidence không tồn tại.)`
          : `${reason} (Không có evidence truy xuất được nên không dùng làm kết luận.)`,
        evidence_ids: [],
      } satisfies RuleResult;
    }

    // PASS phải dựa trên evidence đã được chấp nhận.
    if (status === 'PASS' && !evidenceIds.every((id) => acceptedIds.has(id))) {
      return {
        ...base,
        result: 'REVIEW',
        actual: status,
        confidence,
        reason_code: 'PROMPT_CHECK_EVIDENCE_NOT_ACCEPTED',
        message: `${reason} (Evidence dẫn chiếu chưa ở trạng thái ACCEPTED nên hạ xuống cần rà soát.)`,
        evidence_ids: evidenceIds,
      } satisfies RuleResult;
    }

    // LAC-R13 (D-103): PASS không được dựa trên dữ kiện đang tranh chấp / nghi đọc sai / bị thay thế,
    // và không được chỉ dựa trên lời khai trên đơn vay (trừ rule khai allow_declared_pass).
    if (status === 'PASS') {
      const cited = [...new Set(evidenceIds.map((id) => factOfRecord.get(id)).filter((f): f is LacFact => !!f))];
      if (cited.some((f) => UNSAFE_PASS_TRUST.has(f.trust))) {
        return {
          ...base,
          result: 'REVIEW',
          actual: status,
          confidence,
          reason_code: 'PROMPT_CHECK_EVIDENCE_DISPUTED',
          message: `${reason} (Dữ kiện dẫn chiếu đang mâu thuẫn giữa các chứng từ, nghi đọc sai hoặc đã bị thay thế nên hạ xuống cần rà soát.)`,
          evidence_ids: evidenceIds,
        } satisfies RuleResult;
      }
      // D-112: một fact DECLARED bất kỳ là đủ để hạ. "Mọi fact" bị vượt bằng cách dẫn kèm một fact không liên quan.
      if (cited.some((f) => f.trust === 'DECLARED') && !check.allow_declared_pass) {
        return {
          ...base,
          result: 'REVIEW',
          actual: status,
          confidence,
          reason_code: 'PROMPT_CHECK_DECLARED_ONLY',
          message: `${reason} (Dẫn chiếu có dữ kiện chỉ là lời khai của khách hàng (đơn vay, bảng kê), chưa có chứng từ khác xác nhận nên hạ xuống cần rà soát.)`,
          evidence_ids: evidenceIds,
        } satisfies RuleResult;
      }
    }

    // Kết luận PASS/FAIL mà không kèm confidence thì không kiểm được ngưỡng ⇒
    // cần người rà soát. Trước đây thiếu confidence là bỏ qua luôn bước ngưỡng.
    if (confidence === null && (status === 'PASS' || status === 'FAIL')) {
      return {
        ...base,
        result: 'REVIEW',
        actual: status,
        confidence,
        reason_code: 'PROMPT_CHECK_CONFIDENCE_MISSING',
        message: `${reason} (Kết quả không kèm độ tin cậy nên chưa dùng làm kết luận.)`,
        evidence_ids: evidenceIds,
      } satisfies RuleResult;
    }

    // Dưới ngưỡng tin cậy ⇒ cần người rà soát, không kết luận đạt hay không đạt.
    if (confidence !== null && confidence < threshold) {
      return {
        ...base,
        result: 'REVIEW',
        actual: status,
        confidence,
        reason_code: 'PROMPT_CHECK_BELOW_THRESHOLD',
        message: `${reason} (Độ tin cậy ${(confidence * 100).toFixed(0)}% dưới ngưỡng ${(threshold * 100).toFixed(0)}%.)`,
        evidence_ids: evidenceIds,
      } satisfies RuleResult;
    }

    return withCode({
      ...base,
      result: status,
      actual: status,
      confidence,
      reason_code: `PROMPT_CHECK_${status}`,
      message: droppedEvidence > 0 ? `${reason} (Đã loại ${droppedEvidence} tham chiếu evidence không tồn tại.)` : reason,
      evidence_ids: evidenceIds,
    }) satisfies RuleResult;
  });
}

/** Kết quả NOT_RUN cho toàn bộ rule LLM khi không gọi được connector. */
export function promptChecksNotRun(checkSet: LoanCheckSet, reason: string): RuleResult[] {
  return enabledPromptChecks(checkSet).map((check) => ({
    rule_id: check.id,
    rule_version: check.version,
    severity: check.severity,
    exception_allowed: check.exception_allowed,
    check_kind: 'PROMPT',
    check_name: check.name,
    group: resolveRuleGroup(check),
    threshold: check.threshold ?? 0.85,
    result: 'NOT_RUN',
    actual: null,
    confidence: null,
    reason_code: 'PROMPT_CHECK_EXECUTION_FAILED',
    message: `Không thực hiện được kiểm tra: ${reason}`,
    evidence_ids: [],
  }));
}
