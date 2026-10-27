// Nạp và kiểm tra catalog checklist (T-S4-01). Bản sao của spec-v3/03_catalogs/checklist_catalog.json
// do `npm run sync:loan-catalogs` chép — không sửa tay. Catalog chỉ định nghĩa MỤC; mức yêu cầu theo
// sản phẩm/luồng nằm ở chương trình checklist (programs.ts, S4-R24).
import { z } from 'zod';

import { docTypeByKey, enumValues, parseCatalogFile } from '../catalog';
import raw from '../catalog/data/checklist_catalog.json';

const ItemSchema = z.object({
  item_key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  checklist_group: z.string(),
  checklist_subgroup: z.string().nullable(),
  item_no: z.number().int().min(1),
  item_label: z.string(),
  /** Có thể rỗng: mục không chấm theo chứng từ (VD dữ liệu lấy từ hệ thống ngoài). */
  accepted_doc_type_keys: z.array(z.string()),
  substitutes: z.array(z.string()),
  requires_exact_doc_when_met: z.boolean(),
  scope: z.enum(['PERSON', 'DOSSIER', 'ASSET']),
  applies_to_roles: z.array(z.string()),
  asset_types: z.array(z.string()),
  usage_context: z.string().nullable(),
  condition_id: z.string().nullable(),
  original_or_copy: z.string().nullable(),
  validity_days: z.number().int().min(1).nullable(),
  has_count_rule: z.boolean(),
  note: z.string().nullable(),
  ignore_printed_expiry: z.boolean(),
}).strict();
export type ChecklistItem = z.infer<typeof ItemSchema>;

const ConditionSchema = z.object({
  condition_id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string(),
  condition_source: z.string(),
  evaluation_mode: z.enum(['RULE', 'LLM_SEMANTIC']),
  part_condition_ids: z.array(z.string()),
  input_paths: z.array(z.string()),
  logic: z.string(),
  on_input_missing: z.enum(['REQUIRED', 'NOT_REQUIRED', 'NEEDS_REVIEW']),
  note: z.string().nullable(),
}).strict();
export type ChecklistCondition = z.infer<typeof ConditionSchema>;

const GroupSchema = z.object({
  checklist_group: z.string(), group_label: z.string(), group_no: z.string(), scope: z.enum(['PERSON', 'DOSSIER', 'ASSET']),
}).strict();
export type ChecklistGroupDef = z.infer<typeof GroupSchema>;

const FileSchema = z.object({
  catalog_version: z.string(),
  groups: z.array(GroupSchema),
  items: z.array(ItemSchema),
  conditions: z.array(ConditionSchema),
}).strict().superRefine((c, ctx) => {
  const issue = (path: Array<string | number>, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const items = new Set(c.items.map((i) => i.item_key));
  const conditions = new Set(c.conditions.map((x) => x.condition_id));
  const groups = new Set(c.groups.map((g) => g.checklist_group));
  if (items.size !== c.items.length) issue(['items'], 'item_key trùng');
  c.items.forEach((it, i) => {
    if (!groups.has(it.checklist_group)) issue(['items', i, 'checklist_group'], `nhóm lạ ${it.checklist_group}`);
    it.accepted_doc_type_keys.forEach((k, j) => { if (!docTypeByKey(k)) issue(['items', i, 'accepted_doc_type_keys', j], `doc_type_key lạ ${k}`); });
    it.substitutes.forEach((s, j) => { if (!items.has(s)) issue(['items', i, 'substitutes', j], `item thay thế lạ ${s}`); });
    if (it.condition_id && !conditions.has(it.condition_id)) issue(['items', i, 'condition_id'], `condition lạ ${it.condition_id}`);
    const roles = enumValues('Role');
    it.applies_to_roles.forEach((r, j) => { if (!roles.includes(r)) issue(['items', i, 'applies_to_roles', j], `role lạ ${r}`); });
  });
  c.conditions.forEach((x, i) => x.part_condition_ids.forEach((p, j) => { if (!conditions.has(p)) issue(['conditions', i, 'part_condition_ids', j], `condition lạ ${p}`); }));
});
export type ChecklistCatalog = z.infer<typeof FileSchema>;

let cache: ChecklistCatalog | null = null;

export function loadChecklistCatalog(): ChecklistCatalog {
  if (!cache) cache = parseCatalogFile('checklist_catalog.json', raw, FileSchema);
  return cache;
}

export interface DocValidityRule {
  validityDays: number | null;
  ignorePrintedExpiry: boolean;
  scope: 'PERSON' | 'DOSSIER' | 'ASSET';
}

/**
 * Quy tắc hiệu lực theo loại chứng từ (cho S3-R27): lấy item đầu tiên (theo thứ tự catalog) nhận loại đó. Loại không
 * thuộc item nào → không có thời hạn, phạm vi hồ sơ.
 */
export function validityByDocType(): Map<string, DocValidityRule> {
  const out = new Map<string, DocValidityRule>();
  for (const it of loadChecklistCatalog().items) {
    for (const k of it.accepted_doc_type_keys) {
      if (!out.has(k)) out.set(k, { validityDays: it.validity_days, ignorePrintedExpiry: it.ignore_printed_expiry, scope: it.scope });
    }
  }
  return out;
}

export function itemByKey(key: string): ChecklistItem | undefined {
  return loadChecklistCatalog().items.find((it) => it.item_key === key);
}

export function conditionById(id: string): ChecklistCondition | undefined {
  return loadChecklistCatalog().conditions.find((c) => c.condition_id === id);
}
