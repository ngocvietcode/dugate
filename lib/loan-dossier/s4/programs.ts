// Chương trình checklist theo sản phẩm (S4-R24, D-37) và ghi đè từ Profile (S4-R25).
//
// Mô hình: `checklist_catalog.json` định nghĩa MỤC (chứng từ chấp nhận, thay thế, hiệu lực, điều kiện);
// `checklist_programs.json` gom sản phẩm (product_code, nhiều-một) thành CHƯƠNG TRÌNH, khai báo các LUỒNG
// của chương trình (HKD: FULL/FAST/SIMPLE; phân khúc khác tự đặt, VD A/B) và mức yêu cầu của từng mục
// theo luồng. Luồng đầu tiên trong `flows` là luồng mặc định.
//
// Profile ghi đè (param `loan_checklist_overrides`) chỉ đổi MỨC YÊU CẦU của mục ĐÃ CÓ trong catalog ở
// luồng ĐÃ CÓ của chương trình (kể cả đưa một mục có sẵn vào chương trình, hoặc tắt bằng null). Không tạo
// được mục, luồng, chương trình, điều kiện hay loại chứng từ mới — các thứ đó cần code/catalog.
// Runtime khoan dung (bỏ mục sai + warning); đường ghi (API Profile) fail-closed qua `validateChecklistOverrides`.
import { z } from 'zod';

import { parseCatalogFile } from '../catalog';
import raw from '../catalog/data/checklist_programs.json';
import { itemByKey, loadChecklistCatalog, type ChecklistItem } from './catalog';

export const FLOW_REQUIREMENTS = ['REQUIRED', 'CONDITIONAL', 'NOT_REQUIRED'] as const;
export type FlowRequirement = (typeof FLOW_REQUIREMENTS)[number];
const FlowReq = z.enum(FLOW_REQUIREMENTS).nullable();
const FLOW_KEY = /^[A-Z][A-Z0-9_]*$/;

const ProgramSchema = z.object({
  program_key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  program_label: z.string().min(1),
  product_codes: z.array(z.string().min(1)).min(1),
  flows: z.array(z.object({ flow_key: z.string().regex(FLOW_KEY), flow_label: z.string().min(1) }).strict()).min(1),
  /** item_key → flow_key → mức yêu cầu; null = không sinh dòng ở luồng đó. */
  requirements: z.record(z.string(), z.record(z.string(), FlowReq)),
}).strict();
export type ChecklistProgram = z.infer<typeof ProgramSchema>;

const ProgramsFileSchema = z.object({
  version: z.string(),
  description: z.string().optional(),
  programs: z.array(ProgramSchema).min(1),
}).strict().superRefine((c, ctx) => {
  const issue = (path: Array<string | number>, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const keys = new Set<string>();
  const products = new Map<string, string>();
  c.programs.forEach((p, i) => {
    if (keys.has(p.program_key)) issue(['programs', i, 'program_key'], `trùng ${p.program_key}`);
    keys.add(p.program_key);
    p.product_codes.forEach((pc, j) => {
      if (products.has(pc)) issue(['programs', i, 'product_codes', j], `${pc} đã thuộc ${products.get(pc)}`);
      products.set(pc, p.program_key);
    });
    const flows = p.flows.map((f) => f.flow_key);
    if (new Set(flows).size !== flows.length) issue(['programs', i, 'flows'], 'flow_key trùng');
    for (const [itemKey, byFlow] of Object.entries(p.requirements)) {
      const item = itemByKey(itemKey);
      if (!item) { issue(['programs', i, 'requirements', itemKey], 'item_key lạ'); continue; }
      const got = Object.keys(byFlow).sort().join(',');
      if (got !== [...flows].sort().join(',')) issue(['programs', i, 'requirements', itemKey], `phải khai đúng các luồng ${flows.join('/')}`);
      for (const [flow, req] of Object.entries(byFlow)) {
        if (req === 'CONDITIONAL' && !item.condition_id) issue(['programs', i, 'requirements', itemKey, flow], 'CONDITIONAL cần item có condition_id');
      }
    }
  });
});
export type ChecklistProgramsCatalog = z.infer<typeof ProgramsFileSchema>;

let cache: ChecklistProgramsCatalog | null = null;

export function loadChecklistPrograms(): ChecklistProgramsCatalog {
  if (!cache) cache = parseCatalogFile('checklist_programs.json', raw, ProgramsFileSchema);
  return cache;
}

/** Kiểm một catalog chương trình khác (test / mở rộng); ném lỗi nếu sai. */
export function parseChecklistPrograms(value: unknown): ChecklistProgramsCatalog {
  return ProgramsFileSchema.parse(value);
}

export function programForProduct(productCode: unknown, catalog = loadChecklistPrograms()): ChecklistProgram | undefined {
  if (typeof productCode !== 'string') return undefined;
  return catalog.programs.find((p) => p.product_codes.includes(productCode));
}

export function programByKey(programKey: string, catalog = loadChecklistPrograms()): ChecklistProgram | undefined {
  return catalog.programs.find((p) => p.program_key === programKey);
}

export function programFlowKeys(program: ChecklistProgram): string[] {
  return program.flows.map((f) => f.flow_key);
}

/** Luồng mặc định = luồng đầu tiên của chương trình. */
export function defaultFlow(program: ChecklistProgram): string {
  return program.flows[0].flow_key;
}

/** Hợp các luồng của mọi chương trình, theo thứ tự xuất hiện (dùng cho phạm vi rule `flows[]`). */
export function allFlowKeys(catalog = loadChecklistPrograms()): string[] {
  return [...new Set(catalog.programs.flatMap(programFlowKeys))];
}

// ── Ghi đè từ Profile ───────────────────────────────────────────────────────

/** `{ programs: { program_key: { item_key: { FLOW: REQUIRED|CONDITIONAL|NOT_REQUIRED|null } } } }`. */
export type ChecklistOverrides = Record<string, Record<string, Record<string, FlowRequirement | null>>>;

export interface OverrideApplied {
  item_key: string;
  flow: string;
  from: FlowRequirement | null;
  to: FlowRequirement | null;
}

export const MAX_OVERRIDE_ENTRIES = 500;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Mỗi lỗi một chuỗi; dùng chung cho đường chạy (thành warning) và đường ghi (thành lỗi 400). */
function scanOverrides(value: unknown, catalog: ChecklistProgramsCatalog): { overrides: ChecklistOverrides; problems: string[] } {
  const problems: string[] = [];
  const overrides: ChecklistOverrides = {};
  if (!isObj(value)) return { overrides, problems: ['loan_checklist_overrides phải là object.'] };
  const unknownTop = Object.keys(value).filter((k) => k !== 'programs' && k !== 'version');
  if (unknownTop.length) problems.push(`loan_checklist_overrides: key lạ ${unknownTop.join(', ')}.`);
  if (value.version !== undefined && (typeof value.version !== 'string' || !value.version.trim() || value.version.length > 40)) {
    problems.push('loan_checklist_overrides.version phải là chuỗi không rỗng, tối đa 40 ký tự.');
  }
  if (!isObj(value.programs)) return { overrides, problems: [...problems, 'loan_checklist_overrides.programs phải là object.'] };
  let count = 0;
  for (const [programKey, items] of Object.entries(value.programs)) {
    const program = programByKey(programKey, catalog);
    if (!program) { problems.push(`Chương trình "${programKey}" không có trong checklist_programs.json.`); continue; }
    if (!isObj(items)) { problems.push(`${programKey} phải là object item_key → luồng.`); continue; }
    const flows = programFlowKeys(program);
    for (const [itemKey, byFlow] of Object.entries(items)) {
      const item = itemByKey(itemKey);
      if (!item) { problems.push(`${programKey}: mục "${itemKey}" không có trong checklist_catalog.json; không tạo được mục mới.`); continue; }
      if (!isObj(byFlow)) { problems.push(`${programKey}.${itemKey} phải là object luồng → mức yêu cầu.`); continue; }
      for (const [flow, req] of Object.entries(byFlow)) {
        const where = `${programKey}.${itemKey}.${flow}`;
        if (!flows.includes(flow)) { problems.push(`${where}: luồng không thuộc chương trình (${flows.join('/')}).`); continue; }
        if (req !== null && !(FLOW_REQUIREMENTS as readonly unknown[]).includes(req)) {
          problems.push(`${where}: giá trị phải là REQUIRED, CONDITIONAL, NOT_REQUIRED hoặc null.`);
          continue;
        }
        if (req === 'CONDITIONAL' && !item.condition_id) { problems.push(`${where}: mục không có điều kiện nên không đặt CONDITIONAL được.`); continue; }
        if (++count > MAX_OVERRIDE_ENTRIES) { problems.push(`loan_checklist_overrides vượt ${MAX_OVERRIDE_ENTRIES} mục.`); return { overrides, problems }; }
        ((overrides[programKey] ??= {})[itemKey] ??= {})[flow] = req as FlowRequirement | null;
      }
    }
  }
  return { overrides, problems };
}

/** Đường chạy: bỏ mục sai, trả warning. Rỗng/không truyền → không ghi đè. */
export function parseChecklistOverrides(value: unknown, catalog = loadChecklistPrograms()): { overrides: ChecklistOverrides; warnings: string[] } {
  if (value === undefined || value === null || value === '') return { overrides: {}, warnings: [] };
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return { overrides: {}, warnings: ['loan_checklist_overrides không phải JSON; bỏ qua ghi đè checklist.'] }; }
  }
  const { overrides, problems } = scanOverrides(v, catalog);
  return { overrides, warnings: problems.map((p) => `${p} Bỏ qua mục này.`) };
}

export type OverrideValidation = { ok: true } | { ok: false; error: string };

/** Đường ghi (API Profile): fail-closed, trả lỗi đầu tiên. */
export function validateChecklistOverrides(value: unknown, catalog = loadChecklistPrograms()): OverrideValidation {
  const { problems } = scanOverrides(value, catalog);
  return problems.length ? { ok: false, error: problems[0] } : { ok: true };
}

// ── Checklist áp cho 1 lần chạy ─────────────────────────────────────────────

export interface ResolvedRow {
  item: ChecklistItem;
  requirement: FlowRequirement;
}

export interface ResolvedChecklist {
  program: ChecklistProgram;
  flow: string;
  /** Mục có dòng ở luồng (mức khác null sau ghi đè), theo thứ tự `checklist_catalog.json`. */
  rows: ResolvedRow[];
  overrides_applied: OverrideApplied[];
}

/** Mức yêu cầu sau ghi đè cho mọi mục của catalog ở `flow`; `flow` phải thuộc chương trình. */
export function resolveChecklist(program: ChecklistProgram, flow: string, overrides: ChecklistOverrides = {}): ResolvedChecklist {
  const own = overrides[program.program_key] ?? {};
  const rows: ResolvedRow[] = [];
  const overrides_applied: OverrideApplied[] = [];
  for (const item of loadChecklistCatalog().items) {
    const base = program.requirements[item.item_key]?.[flow] ?? null;
    const byFlow = own[item.item_key];
    const has = byFlow !== undefined && Object.prototype.hasOwnProperty.call(byFlow, flow);
    const req = has ? byFlow[flow] : base;
    if (has && req !== base) overrides_applied.push({ item_key: item.item_key, flow, from: base, to: req });
    if (req !== null) rows.push({ item, requirement: req });
  }
  return { program, flow, rows, overrides_applied };
}
