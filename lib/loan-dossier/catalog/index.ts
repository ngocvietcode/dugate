// Bộ nạp catalog dùng chung (T-CAT-02, F-R01). Dữ liệu là bản sao của spec-v3/03_catalogs
// do `npm run sync:loan-catalogs` sinh vào ./data — không sửa tay, không import từ docs/.
import { z } from 'zod';

import docTypesRaw from './data/doc_types.json';
import enumsRaw from './data/enums.json';
import lightRaw from './data/light_extraction.json';
import reasonCodesRaw from './data/reason_codes.json';
import slFieldsRaw from './data/sl_fields.json';

/** Parse một file catalog; lỗi luôn nêu tên file để biết catalog nào hỏng. */
export function parseCatalogFile<T>(fileName: string, raw: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? first.path.join('.') : '(gốc)';
    throw new Error(`Catalog ${fileName} không hợp lệ tại ${where}: ${first?.message ?? 'lỗi không rõ'}`);
  }
  return result.data;
}

// ── doc_types.json ──────────────────────────────────────────────────────────
export const ExtractionLevelSchema = z.enum(['FULL', 'LIGHT']);
export type ExtractionLevel = z.infer<typeof ExtractionLevelSchema>;

const DocTypeSchema = z.object({
  doc_type_key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  doc_type_label: z.string().min(1),
  checklist_group: z.string().min(1),
  needs_extraction: z.boolean(),
  has_parties: z.boolean(),
  has_assets: z.boolean(),
  note: z.string().nullable(),
  /** Dấu hiệu nhận biết trên mặt chứng từ, gửi cho classifier/extractor thay cho `note` (S1-R18). */
  recognition_hint: z.string().min(1).optional(),
  extraction_level: ExtractionLevelSchema,
  /** D-70: danh mục `key_facts` cố định S1 phải trả cho từng instance; chỉ loại FULL (≤ 5 key, `loan_application` ≤ 7). */
  summary_fields: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1).optional(),
}).strict();
export type DocType = z.infer<typeof DocTypeSchema>;

const DocTypesFileSchema = z.object({ version: z.string(), doc_types: z.array(DocTypeSchema) }).strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.doc_types.forEach((d, i) => {
      if (seen.has(d.doc_type_key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['doc_types', i], message: `trùng ${d.doc_type_key}` });
      seen.add(d.doc_type_key);
      if ((d.extraction_level === 'FULL') !== d.needs_extraction) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['doc_types', i], message: 'extraction_level lệch needs_extraction' });
      }
    });
  });

// ── enums.json ──────────────────────────────────────────────────────────────
const EnumsFileSchema = z.object({
  version: z.string(),
  enums: z.record(z.string(), z.array(z.string().nullable()).min(1)),
}).strict();
export type CatalogEnums = Record<string, ReadonlyArray<string | null>>;

// ── reason_codes.json ───────────────────────────────────────────────────────
export const ReasonScopeSchema = z.enum(['STAGE', 'FILE', 'EVIDENCE', 'MAP', 'CHK', 'XCK', 'CSL']);
export type ReasonScope = z.infer<typeof ReasonScopeSchema>;
const ReasonCodeSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  scope: ReasonScopeSchema,
  meaning: z.string(),
  status: z.string().optional(),
  stages: z.string().optional(),
  severity: z.string().optional(),
  pairs_with: z.string().optional(),
}).strict();
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
const ReasonCodesFileSchema = z.object({ version: z.string(), reason_codes: z.array(ReasonCodeSchema) }).strict();

// ── sl_fields.json (S6 không áp dụng trên nền v2 — vẫn nạp để catalog nhất quán) ─
const SlSourceSchema = z.object({
  doc_type_key: z.string(), field_path: z.string(), party_roles: z.array(z.string()),
}).strict();
const SlFieldSchema = z.object({
  field_key: z.string(), label: z.string(), group: z.string(), scope: z.string(),
  applicable_roles: z.array(z.string()), value_type: z.string(), method: z.string(),
  ocr_sources: z.array(SlSourceSchema),
}).strict();
export type SlField = z.infer<typeof SlFieldSchema>;
const SlFieldsFileSchema = z.object({ version: z.string(), excluded: z.string(), fields: z.array(SlFieldSchema) }).strict();

// ── light_extraction.json (S2-R20) ──────────────────────────────────────────
export const LightValueTypeSchema = z.enum(['TEXT', 'DATE', 'MONEY', 'ADDRESS']);
const LightDocSchema = z.object({
  doc_type_key: z.string(),
  subject_party_role: z.string(),
  subject_party_type: z.enum(['INDIVIDUAL', 'ORGANIZATION']),
  fields: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), label: z.string(), value_type: LightValueTypeSchema }).strict()),
  note: z.string().nullable(),
}).strict();
export type LightDocType = z.infer<typeof LightDocSchema>;
const LightFileSchema = z.object({ version: z.string(), description: z.string(), doc_types: z.array(LightDocSchema) }).strict();

// ── cache theo process ──────────────────────────────────────────────────────
let docTypesCache: DocType[] | null = null;
let docTypeIndex: Map<string, DocType> | null = null;
let enumsCache: CatalogEnums | null = null;
let reasonCache: ReasonCode[] | null = null;
let slCache: SlField[] | null = null;
let lightCache: LightDocType[] | null = null;

export function loadDocTypes(): readonly DocType[] {
  if (!docTypesCache) {
    docTypesCache = parseCatalogFile('doc_types.json', docTypesRaw, DocTypesFileSchema).doc_types;
    docTypeIndex = new Map(docTypesCache.map((d) => [d.doc_type_key, d]));
  }
  return docTypesCache;
}

export function docTypeByKey(key: string): DocType | undefined {
  loadDocTypes();
  return docTypeIndex!.get(key);
}

export function loadEnums(): CatalogEnums {
  if (!enumsCache) enumsCache = parseCatalogFile('enums.json', enumsRaw, EnumsFileSchema).enums;
  return enumsCache;
}

/** Giá trị của một enum, ném lỗi nếu catalog không có enum đó. */
export function enumValues(name: string): ReadonlyArray<string | null> {
  const values = loadEnums()[name];
  if (!values) throw new Error(`Catalog enums.json không có enum ${name}`);
  return values;
}

export function loadReasonCodes(): readonly ReasonCode[] {
  if (!reasonCache) reasonCache = parseCatalogFile('reason_codes.json', reasonCodesRaw, ReasonCodesFileSchema).reason_codes;
  return reasonCache;
}

export function isReasonCode(code: string, scope?: ReasonScope): boolean {
  return loadReasonCodes().some((r) => r.code === code && (scope === undefined || r.scope === scope));
}

export function loadSlFields(): readonly SlField[] {
  if (!slCache) slCache = parseCatalogFile('sl_fields.json', slFieldsRaw, SlFieldsFileSchema).fields;
  return slCache;
}

export function loadLightExtraction(): readonly LightDocType[] {
  if (!lightCache) lightCache = parseCatalogFile('light_extraction.json', lightRaw, LightFileSchema).doc_types;
  return lightCache;
}

/** Chỉ dùng trong test: xóa cache để nạp lại. */
export function resetCatalogCache(): void {
  docTypesCache = null; docTypeIndex = null; enumsCache = null; reasonCache = null; slCache = null; lightCache = null;
}
