// Kiểm tra SƠ BỘ bộ hồ sơ bằng LLM ngay sau S1 (D-73, D-74; V2-R16…R20).
//   Đầu vào : checklist đã resolve (chương trình + luồng + ghi đè Profile) và `files[]` của S1 (`summary`, `key_facts`).
//   Đầu ra  : dòng checklist theo danh mục hồ sơ + quan hệ giữa các chứng từ + tổng quan, do LLM đánh giá.
// Code KHÔNG so sánh nội dung / giá trị giữa các chứng từ. Code chỉ giữ rào chắn HÌNH THỨC (mục lạ, căn cứ không tồn tại hoặc sai loại
// chứng từ, mục bắt buộc bị bỏ sót) và tự tính số đếm — LLM lỗi thì trả UNAVAILABLE, không bao giờ báo "không thiếu sót".
// Bản nháp cho Sale, không có trách nhiệm giải trình. Không log `summary`, `key_facts` hay nội dung kết quả.
import { z } from 'zod';

import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import type { ClassifyData } from '@/lib/loan-dossier/contracts/stage-result';
import { conditionById, itemByKey, loadChecklistCatalog, type ChecklistItem } from '@/lib/loan-dossier/s4/catalog';
import {
  programForProduct, resolveChecklist, type ChecklistOverrides, type ChecklistProgram, type FlowRequirement,
} from '@/lib/loan-dossier/s4/programs';

import { untrustedBlock } from '../prompts/loan-appraisal-prompts';
import { renderPrompt } from './intake-review';
import { DOSSIER_PRECHECK_OUTPUT_SCHEMA, DOSSIER_PRECHECK_PROMPT_TEMPLATE, DOSSIER_PRECHECK_STEP } from './dossier-precheck-prompt';

export { DOSSIER_PRECHECK_OUTPUT_SCHEMA, DOSSIER_PRECHECK_PROMPT_TEMPLATE, DOSSIER_PRECHECK_STEP };


export type PrecheckStatus = 'COMPLETED' | 'UNAVAILABLE' | 'SKIPPED';
export type PrecheckLineStatus = 'PROVIDED' | 'MISSING' | 'UNCERTAIN' | 'NOT_APPLICABLE';
export type PrecheckRelationStatus = 'CONSISTENT' | 'INCONSISTENT' | 'UNCLEAR';
export type PrecheckOverall = 'GAPS_FOUND' | 'NO_GAPS_FOUND';

/** Một chứng từ (file × loại × instance) mà LLM được phép trích dẫn bằng `doc_ref`. */
export interface PrecheckEvidence { doc_ref: string; file_id: string; doc_type_key: string; instance_index: number }

export interface PrecheckLine {
  item_key: string;
  label: string;
  group: string;
  group_label: string;
  requirement: Exclude<FlowRequirement, 'NOT_REQUIRED'>;
  /** Nhãn người / tài sản; null với mục cấp hồ sơ. */
  subject: string | null;
  status: PrecheckLineStatus;
  evidence: PrecheckEvidence[];
  note: string | null;
  /** Code đã chỉnh trạng thái do LLM trả (không có căn cứ hợp lệ, hoặc bị bỏ sót). */
  adjusted: boolean;
}

export interface PrecheckRelation { topic: string; status: PrecheckRelationStatus; evidence: PrecheckEvidence[]; message: string }

export interface PrecheckGroupCount { group: string; label: string; total: number; provided: number; missing: number; uncertain: number; not_applicable: number }

export interface DossierPrecheck {
  version: '1.0';
  /** Bản nháp cho Sale, không phải kết luận chính thức. */
  draft: true;
  status: PrecheckStatus;
  source: 'LLM' | 'NONE';
  warning: string | null;
  flow: string | null;
  program_key: string | null;
  checklist: PrecheckLine[];
  relations: PrecheckRelation[];
  overview: string | null;
  next_actions: string[];
  by_status: Record<PrecheckLineStatus, number>;
  by_group: PrecheckGroupCount[];
  /** Code tính từ dòng đã chỉnh; null khi chưa đánh giá được. */
  overall: PrecheckOverall | null;
  prompt_overridden: boolean;
}

export function isDossierPrecheck(v: unknown): v is DossierPrecheck {
  return !!v && typeof v === 'object' && 'checklist' in v && 'relations' in v && 'by_status' in v && 'status' in v;
}

/** `dossier_precheck` mặc định bật; chỉ tắt khi truyền rõ false/"false"/"0"/"no" (V2-R20). */
export function isPrecheckEnabled(v: unknown): boolean {
  if (v === false) return false;
  return !(typeof v === 'string' && ['false', '0', 'no'].includes(v.trim().toLowerCase()));
}

// Prompt + schema mặc định nằm ở `dossier-precheck-prompt.ts` (không phụ thuộc catalog) để trang Profile import được.
// ─── Dữ liệu LLM trả về ────────────────────────────────────────────────────────

const RawSchema = z.object({
  checklist: z.array(z.object({
    item_key: z.string().trim().min(1).max(80),
    subject: z.string().max(200).nullish(),
    status: z.enum(['PROVIDED', 'MISSING', 'UNCERTAIN', 'NOT_APPLICABLE']),
    doc_refs: z.array(z.string().max(20)).max(20).default([]),
    note: z.string().max(600).nullish(),
  })).max(300),
  relations: z.array(z.object({
    topic: z.string().trim().min(1).max(160),
    status: z.enum(['CONSISTENT', 'INCONSISTENT', 'UNCLEAR']),
    doc_refs: z.array(z.string().max(20)).max(20).default([]),
    message: z.string().trim().min(1).max(600),
  })).max(60).default([]),
  overview: z.string().trim().min(1).max(1500),
  next_actions: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
});
export type PrecheckRaw = z.infer<typeof RawSchema>;

// ─── Dựng ngữ cảnh ────────────────────────────────────────────────────────────

const CHECKLIST_CHAR_BUDGET = 18_000;
const DOCUMENTS_CHAR_BUDGET = 45_000;

type RowReq = Exclude<FlowRequirement, 'NOT_REQUIRED'>;
interface RowInfo { item: ChecklistItem; requirement: RowReq; accepted: Set<string> }

export interface PrecheckInput {
  classify: ClassifyData;
  product_code: unknown;
  flow: string;
  checklist_overrides?: ChecklistOverrides;
}

export interface PrecheckContext {
  program: ChecklistProgram;
  flow: string;
  rows: Map<string, RowInfo>;
  docs: Map<string, PrecheckEvidence>;
  checklistJson: string;
  documentsJson: string;
  truncated: boolean;
}

/** Loại chứng từ chấp nhận của mục = loại của chính nó + của các mục thay thế (S4-R: substitutes). */
function acceptedDocTypes(item: ChecklistItem): Set<string> {
  const out = new Set(item.accepted_doc_type_keys);
  for (const key of item.substitutes) for (const dt of itemByKey(key)?.accepted_doc_type_keys ?? []) out.add(dt);
  return out;
}

interface DocFact {
  doc_ref: string;
  doc_type_key: string;
  doc_type_label: string;
  pages: [number, number];
  confidence: number;
  needs_review: boolean;
  summary: string;
  key_facts: Array<{ subject: string; key: string; value: string | null }>;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}…`);

function collectDocs(classify: ClassifyData): { facts: DocFact[]; refs: PrecheckEvidence[] } {
  const facts: DocFact[] = [];
  const refs: PrecheckEvidence[] = [];
  for (const file of classify.files) {
    if (file.status !== 'CLASSIFIED') continue;
    for (const match of file.matches) {
      for (const inst of match.instances) {
        const doc_ref = `D${String(facts.length + 1).padStart(2, '0')}`;
        refs.push({ doc_ref, file_id: file.file_id, doc_type_key: match.doc_type_key, instance_index: inst.instance_index });
        facts.push({
          doc_ref,
          doc_type_key: match.doc_type_key,
          doc_type_label: docTypeByKey(match.doc_type_key)?.doc_type_label ?? match.doc_type_key,
          pages: [inst.page_range[0], inst.page_range[1]],
          confidence: inst.confidence,
          needs_review: match.needs_manual_review,
          summary: inst.summary,
          key_facts: inst.key_facts.map((k) => ({ subject: k.subject, key: k.key, value: k.value })),
        });
      }
    }
  }
  return { facts, refs };
}

/** Chọn mức rút gọn lớn nhất còn vừa ngân sách; hết cách thì cắt bớt chứng từ cuối (ghi cờ `truncated`). */
function fitDocuments(facts: DocFact[]): { json: string; count: number; truncated: boolean } {
  const levels: Array<(d: DocFact) => unknown> = [
    (d) => ({ ...d, summary: clip(d.summary, 600), key_facts: d.key_facts.map((k) => ({ ...k, value: k.value === null ? null : clip(k.value, 200) })) }),
    (d) => ({ ...d, summary: clip(d.summary, 200), key_facts: d.key_facts.map((k) => ({ ...k, value: k.value === null ? null : clip(k.value, 100) })) }),
    (d) => ({ ...d, summary: '', key_facts: d.key_facts.slice(0, 5).map((k) => ({ ...k, value: k.value === null ? null : clip(k.value, 80) })) }),
  ];
  for (const level of levels) {
    const json = JSON.stringify(facts.map(level));
    if (json.length <= DOCUMENTS_CHAR_BUDGET) return { json, count: facts.length, truncated: false };
  }
  const last = levels[levels.length - 1];
  let count = facts.length;
  let json = JSON.stringify(facts.slice(0, count).map(last));
  while (count > 1 && json.length > DOCUMENTS_CHAR_BUDGET) {
    count = Math.max(1, Math.floor(count * 0.9));
    json = JSON.stringify(facts.slice(0, count).map(last));
  }
  return { json, count, truncated: true };
}

/**
 * Dựng ngữ cảnh gọi LLM. Trả `{ skip }` kèm lý do khi không có gì để đánh giá (không chương trình checklist, luồng sai, chưa có chứng từ).
 * Hàm thuần.
 */
export function buildPrecheckContext(input: PrecheckInput): PrecheckContext | { skip: string } {
  const program = programForProduct(input.product_code);
  if (!program) return { skip: 'Sản phẩm chưa có chương trình checklist; bỏ qua kiểm tra sơ bộ.' };
  const resolved = resolveChecklist(program, input.flow, input.checklist_overrides ?? {});
  const groups = new Map(loadChecklistCatalog().groups.map((g) => [g.checklist_group, g]));
  const rows = new Map<string, RowInfo>();
  const checklistFacts: unknown[] = [];
  for (const row of resolved.rows) {
    if (row.requirement === 'NOT_REQUIRED') continue;
    const accepted = acceptedDocTypes(row.item);
    if (accepted.size === 0) continue; // mục không chấm theo chứng từ (VD dữ liệu từ hệ thống ngoài)
    rows.set(row.item.item_key, { item: row.item, requirement: row.requirement, accepted });
    const cond = row.requirement === 'CONDITIONAL' && row.item.condition_id ? conditionById(row.item.condition_id) : undefined;
    checklistFacts.push({
      item_key: row.item.item_key,
      label: row.item.item_label,
      group: groups.get(row.item.checklist_group)?.group_label ?? row.item.checklist_group,
      scope: row.item.scope,
      requirement: row.requirement,
      ...(cond ? { condition: cond.description } : {}),
      ...(row.item.applies_to_roles.length ? { roles: row.item.applies_to_roles } : {}),
      ...(row.item.asset_types.length ? { asset_types: row.item.asset_types } : {}),
      accepted_doc_types: [...accepted],
      ...(row.item.note ? { note: row.item.note } : {}),
    });
  }
  if (rows.size === 0) return { skip: `Luồng ${input.flow} không có mục checklist nào để kiểm tra.` };

  const { facts, refs } = collectDocs(input.classify);
  if (facts.length === 0) return { skip: 'Chưa có chứng từ nào được nhận dạng để kiểm tra.' };
  const fitted = fitDocuments(facts);
  const checklistJson = JSON.stringify(checklistFacts);
  return {
    program,
    flow: input.flow,
    rows,
    docs: new Map(refs.slice(0, fitted.count).map((r) => [r.doc_ref, r])),
    checklistJson: checklistJson.length <= CHECKLIST_CHAR_BUDGET ? checklistJson : `${checklistJson.slice(0, CHECKLIST_CHAR_BUDGET)}…(đã cắt bớt)`,
    documentsJson: fitted.json,
    truncated: fitted.truncated,
  };
}

// ─── Rào chắn hình thức + tổng hợp ────────────────────────────────────────────────

const emptyCounts = (): Record<PrecheckLineStatus, number> => ({ PROVIDED: 0, MISSING: 0, UNCERTAIN: 0, NOT_APPLICABLE: 0 });
const normSubject = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t && t.toLowerCase() !== 'null' ? t.slice(0, 120) : null;
};
const normNote = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

function resolveRefs(refs: string[], docs: Map<string, PrecheckEvidence>, accepted?: Set<string>): PrecheckEvidence[] {
  const seen = new Set<string>();
  const out: PrecheckEvidence[] = [];
  for (const ref of refs) {
    const key = ref.trim().toUpperCase();
    const doc = docs.get(key);
    if (!doc || seen.has(key)) continue;
    if (accepted && !accepted.has(doc.doc_type_key)) continue;
    seen.add(key);
    out.push(doc);
  }
  return out;
}

/** Áp rào chắn V2-R19 lên phản hồi của LLM. Hàm thuần. */
export function guardPrecheck(ctx: PrecheckContext, raw: PrecheckRaw): { checklist: PrecheckLine[]; relations: PrecheckRelation[] } {
  const groups = new Map(loadChecklistCatalog().groups.map((g) => [g.checklist_group, g.group_label]));
  const lines: PrecheckLine[] = [];
  const seen = new Set<string>();
  const covered = new Set<string>();
  const mk = (row: RowInfo, subject: string | null, status: PrecheckLineStatus, evidence: PrecheckEvidence[], note: string | null, adjusted: boolean): PrecheckLine => ({
    item_key: row.item.item_key,
    label: row.item.item_label,
    group: row.item.checklist_group,
    group_label: groups.get(row.item.checklist_group) ?? row.item.checklist_group,
    requirement: row.requirement,
    subject,
    status,
    evidence,
    note,
    adjusted,
  });

  for (const entry of raw.checklist) {
    const row = ctx.rows.get(entry.item_key.trim());
    if (!row) continue; // (1) mục lạ
    const subject = normSubject(entry.subject);
    const dedup = `${row.item.item_key}|${(subject ?? '').toLowerCase()}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    covered.add(row.item.item_key);
    const evidence = resolveRefs(entry.doc_refs, ctx.docs, row.accepted); // (2) căn cứ có thật, đúng loại chứng từ
    let status: PrecheckLineStatus = entry.status;
    let adjusted = false;
    if (status === 'PROVIDED' && evidence.length === 0) { status = 'UNCERTAIN'; adjusted = true; } // (3)
    if (status === 'NOT_APPLICABLE' && row.requirement === 'REQUIRED') { status = 'UNCERTAIN'; adjusted = true; } // (4)
    lines.push(mk(row, subject, status, evidence, normNote(entry.note), adjusted));
  }
  // (5) mục chưa có dòng nào → UNCERTAIN, không bao giờ ngầm coi là đủ
  for (const row of ctx.rows.values()) {
    if (!covered.has(row.item.item_key)) lines.push(mk(row, null, 'UNCERTAIN', [], 'Chưa có đánh giá cho mục này; cần kiểm tra lại.', true));
  }
  const order = new Map([...ctx.rows.keys()].map((k, i) => [k, i]));
  lines.sort((a, b) => (order.get(a.item_key) ?? 0) - (order.get(b.item_key) ?? 0));

  const all = new Map([...ctx.docs.values()].map((d) => [d.doc_ref, d]));
  const relations: PrecheckRelation[] = raw.relations.map((r) => {
    const evidence = resolveRefs(r.doc_refs, all); // (6)
    const status: PrecheckRelationStatus = r.status === 'INCONSISTENT' && evidence.length === 0 ? 'UNCLEAR' : r.status;
    return { topic: r.topic, status, evidence, message: r.message };
  });
  return { checklist: lines, relations };
}

/** Số đếm theo trạng thái, theo nhóm và `overall` — do code tính từ dòng đã chỉnh (V2-R19.7). */
export function summarizePrecheck(lines: PrecheckLine[], relations: PrecheckRelation[]): Pick<DossierPrecheck, 'by_status' | 'by_group' | 'overall'> {
  const by_status = emptyCounts();
  const byGroup = new Map<string, PrecheckGroupCount>();
  for (const g of loadChecklistCatalog().groups) {
    byGroup.set(g.checklist_group, { group: g.checklist_group, label: g.group_label, total: 0, provided: 0, missing: 0, uncertain: 0, not_applicable: 0 });
  }
  for (const l of lines) {
    by_status[l.status] += 1;
    const g = byGroup.get(l.group);
    if (!g) continue;
    g.total += 1;
    if (l.status === 'PROVIDED') g.provided += 1;
    else if (l.status === 'MISSING') g.missing += 1;
    else if (l.status === 'UNCERTAIN') g.uncertain += 1;
    else g.not_applicable += 1;
  }
  const gap = lines.some((l) => l.status === 'MISSING' || (l.status === 'UNCERTAIN' && l.requirement === 'REQUIRED'))
    || relations.some((r) => r.status === 'INCONSISTENT');
  return { by_status, by_group: [...byGroup.values()].filter((g) => g.total > 0), overall: gap ? 'GAPS_FOUND' : 'NO_GAPS_FOUND' };
}

// ─── Gọi LLM ──────────────────────────────────────────────────────────────────

/** Cổng gọi model: trả nội dung đã parse JSON (hoặc chuỗi thô). Ném lỗi khi model lỗi / timeout. */
export type AskPrecheck = (prompt: string) => Promise<unknown>;

function inactive(status: 'UNAVAILABLE' | 'SKIPPED', warning: string, meta: { flow: string | null; program_key: string | null; prompt_overridden: boolean }): DossierPrecheck {
  return {
    version: '1.0', draft: true, status, source: 'NONE', warning, flow: meta.flow, program_key: meta.program_key,
    checklist: [], relations: [], overview: null, next_actions: [], by_status: emptyCounts(), by_group: [], overall: null,
    prompt_overridden: meta.prompt_overridden,
  };
}

/** Kết quả `SKIPPED` khi tham số tắt bước (V2-R20). */
export function skippedPrecheck(reason: string): DossierPrecheck {
  return inactive('SKIPPED', reason, { flow: null, program_key: null, prompt_overridden: false });
}

/**
 * Chạy bước kiểm tra sơ bộ. Lỗi model / sai định dạng → `UNAVAILABLE` (không làm đổ stage). Ném lại lỗi huỷ (`isPassThroughError`).
 */
export async function runDossierPrecheck(
  input: PrecheckInput,
  ask: AskPrecheck,
  overrides: Readonly<Record<string, string | undefined>>,
  isPassThroughError: (err: unknown) => boolean = () => false,
): Promise<DossierPrecheck> {
  const prompt_overridden = Boolean(overrides[DOSSIER_PRECHECK_STEP]);
  const ctx = buildPrecheckContext(input);
  if ('skip' in ctx) return inactive('SKIPPED', ctx.skip, { flow: input.flow, program_key: null, prompt_overridden });
  const meta = { flow: ctx.flow, program_key: ctx.program.program_key, prompt_overridden };

  let raw: PrecheckRaw;
  try {
    const prompt = renderPrompt(overrides[DOSSIER_PRECHECK_STEP] || DOSSIER_PRECHECK_PROMPT_TEMPLATE, ['checklist', 'documents', 'output_schema'], {
      checklist: untrustedBlock('untrusted_checklist', ctx.checklistJson),
      documents: untrustedBlock('untrusted_documents', ctx.documentsJson),
      output_schema: DOSSIER_PRECHECK_OUTPUT_SCHEMA,
    });
    const answer = await ask(prompt);
    const parsed = RawSchema.safeParse(answer);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return inactive('UNAVAILABLE', `Phản hồi kiểm tra sơ bộ không đúng định dạng (${first?.path.join('.') || '(gốc)'}: ${first?.message ?? 'không hợp lệ'}).`, meta);
    }
    raw = parsed.data;
  } catch (err) {
    if (isPassThroughError(err)) throw err;
    return inactive('UNAVAILABLE', `Không gọi được LLM kiểm tra sơ bộ: ${err instanceof Error ? err.message : String(err)}.`, meta);
  }

  const guarded = guardPrecheck(ctx, raw);
  return {
    version: '1.0',
    draft: true,
    status: 'COMPLETED',
    source: 'LLM',
    warning: ctx.truncated ? 'Danh sách chứng từ quá dài nên một phần chứng từ cuối chưa được đưa vào đánh giá.' : null,
    flow: ctx.flow,
    program_key: ctx.program.program_key,
    checklist: guarded.checklist,
    relations: guarded.relations,
    overview: raw.overview,
    next_actions: raw.next_actions,
    ...summarizePrecheck(guarded.checklist, guarded.relations),
    prompt_overridden,
  };
}
