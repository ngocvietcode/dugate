#!/usr/bin/env node
// Sinh zod cho 30 loại chứng từ FULL (T-DOC-01…27 + 3 loại SME, D-116) từ JSON Schema đã đồng bộ ở
// lib/loan-dossier/catalog/data/doc_schemas/ (spec-v3 03_catalogs/doc_schemas, D-33).
//   → lib/loan-dossier/s2/schemas/{doc_type_key}.ts + index.ts
// Dịch đúng JSON Schema, không thêm/bớt field. Ref `_common` dùng schema chung ở s2/common-schema.ts
// (DocumentParty, AssetDescriptor…); allOf [chung, {properties}] → `.extend()` (override luôn là tập con).
// Gặp keyword chưa hỗ trợ → ném lỗi, không bỏ qua im lặng.
// Dùng: npm run gen:loan-doc-schemas        (ghi file)
//       node scripts/gen-loan-doc-schemas.mjs --check   (exit 1 nếu file lệch nguồn)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'lib', 'loan-dossier', 'catalog', 'data');
const SCHEMA_DIR = join(DATA, 'doc_schemas');
export const OUT_DIR = join(ROOT, 'lib', 'loan-dossier', 's2', 'schemas');

/** Thứ tự T-DOC-01…27 (bảng §7 của S2), rồi 3 loại SME (D-116). */
export const DOC_ORDER = [
  'id_card', 'vneid', 'qr_code_info', 'residence_confirmation', 'marital_status_confirmation',
  'local_cmnd_confirmation', 'same_person_commitment', 'marriage_certificate', 'birth_certificate',
  'loan_application', 'purchase_list', 'goods_purchase_contract', 'vehicle_sale_contract', 'labor_contract',
  'salary_confirmation', 'income_statement', 'land_use_certificate', 'apartment_ownership_certificate',
  'land_use_cert_to_buy', 'vehicle_registration', 'vehicle_inspection', 'real_estate_valuation_report',
  'movable_asset_valuation_report', 'asset_quote', 'external_valuation_certificate', 'cic', 'credit_contract',
  'vat_tax_return', 'balance_sheet', 'financial_performance_report',
];

/** `_common.schema.json#/$defs/X` → biểu thức zod trong common-schema.ts. */
const COMMON = {
  DateString: ['DateStringSchema'],
  NullableDate: ['NullableDateSchema'],
  DateTimeString: ['DateTimeStringSchema'],
  MoneyVND: ['MoneyVNDSchema'],
  NullableMoney: ['NullableMoneySchema'],
  Percent: ['PercentSchema'],
  Confidence: ['ConfidenceSchema'],
  IdNumber: ['IdNumberSchema'],
  NullableIdNumber: ['IdNumberSchema', '.nullable()'],
  NullableString: ['NullableStringSchema'],
  Address: ['AddressSchema'],
  NullableAddress: ['AddressSchema', '.nullable()'],
  Signatory: ['SignatorySchema'],
  LegalInfo: ['LegalInfoSchema'],
  NullableLegalInfo: ['LegalInfoSchema', '.nullable()'],
  PartyOwnership: ['PartyOwnershipSchema'],
  DocumentParty: ['DocumentPartySchema'],
  AssetIdentifiers: ['AssetIdentifiersSchema'],
  AssetDescriptor: ['AssetDescriptorSchema'],
};
/** Ref chung là ZodObject (dùng được `.extend`). */
const COMMON_OBJECTS = new Set(['Address', 'Signatory', 'LegalInfo', 'PartyOwnership', 'DocumentParty', 'AssetIdentifiers', 'AssetDescriptor']);

const IGNORED = new Set(['description', 'title', '$schema', '$id', '$comment', 'examples', '$defs']);
const OVERRIDE_KINDS = ['const', 'enum', 'type', '$ref', 'oneOf'];

const pascal = (s) => s.split(/[_-]/).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const lit = (v) => JSON.stringify(v);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function checkKeys(node, allowed, where) {
  for (const k of Object.keys(node)) {
    if (!IGNORED.has(k) && !allowed.includes(k)) throw new Error(`${where}: keyword chưa hỗ trợ "${k}"`);
  }
}

function enumExpr(values) {
  const nonNull = values.filter((v) => v !== null);
  let base;
  if (nonNull.length === 0) base = 'z.null()';
  else if (nonNull.every((v) => typeof v === 'string')) base = `z.enum([${nonNull.map(lit).join(', ')}])`;
  else if (nonNull.length === 1) base = `z.literal(${lit(nonNull[0])})`;
  else base = `z.union([${nonNull.map((v) => `z.literal(${lit(v)})`).join(', ')}])`;
  return values.includes(null) && nonNull.length > 0 ? `${base}.nullable()` : base;
}

class FileGen {
  constructor(key) {
    this.key = key;
    this.file = `${key}.schema.json`;
    this.schema = readJson(join(SCHEMA_DIR, this.file));
    this.enums = readJson(join(SCHEMA_DIR, '_enums.schema.json')).$defs;
    this.commonUsed = new Set();
    this.helpersUsed = new Set();
    this.defsDone = new Map(); // tên def → đã emit
    this.defsOut = [];
    this.visiting = new Set();
  }

  /** Ref → [biểu thức, có phải ZodObject]. */
  ref(ref, where) {
    const [target, ptr = ''] = ref.split('#');
    const name = ptr.replace(/^\/\$defs\//, '');
    if (!ptr.startsWith('/$defs/') || name.includes('/')) throw new Error(`${where}: ref không hỗ trợ ${ref}`);
    if (target === '_common.schema.json') {
      const m = COMMON[name];
      if (!m) throw new Error(`${where}: chưa ánh xạ _common ${name}`);
      this.commonUsed.add(m[0]);
      return [m[0] + (m[1] ?? ''), COMMON_OBJECTS.has(name) && !m[1]];
    }
    if (target === '_enums.schema.json') {
      const def = this.enums[name];
      if (!def || !Array.isArray(def.enum)) throw new Error(`${where}: enum ${name} không có trong _enums`);
      return [enumExpr(def.enum), false];
    }
    if (target !== '') throw new Error(`${where}: ref tới file lạ ${ref}`);
    const def = this.schema.$defs?.[name];
    if (!def) throw new Error(`${where}: không có $defs/${name}`);
    if (!this.defsDone.has(name)) {
      if (this.visiting.has(name)) throw new Error(`${where}: ref vòng ${name}`);
      this.visiting.add(name);
      const [expr, isObj] = this.node(def, `${this.file}#/$defs/${name}`);
      this.visiting.delete(name);
      this.defsOut.push(`const ${name} = ${expr};`);
      this.defsDone.set(name, isObj);
    }
    return [name, this.defsDone.get(name)];
  }

  /** JSON Schema node → [biểu thức zod, là ZodObject]. */
  node(n, where) {
    if (n.$ref !== undefined) {
      checkKeys(n, ['$ref'], where);
      return this.ref(n.$ref, where);
    }
    if (n.allOf && n.type !== 'array') return this.allOf(n, where);
    if (n.oneOf) {
      checkKeys(n, ['oneOf'], where);
      const nonNull = n.oneOf.filter((b) => !(b.type === 'null' && Object.keys(b).filter((k) => !IGNORED.has(k)).length === 1));
      if (nonNull.length === 1 && nonNull.length < n.oneOf.length) return [`${this.node(nonNull[0], `${where}/oneOf`)[0]}.nullable()`, false];
      throw new Error(`${where}: oneOf chỉ hỗ trợ dạng [X, null]`);
    }
    if ('const' in n) {
      checkKeys(n, ['const', 'type'], where);
      return [n.const === null ? 'z.null()' : `z.literal(${lit(n.const)})`, false];
    }
    if (Array.isArray(n.enum)) {
      checkKeys(n, ['enum', 'type'], where);
      return [enumExpr(n.enum), false];
    }
    // Không ghi type nhưng có properties/required (VD `contains`): phần tử là object, field khác tự do.
    const types = n.type === undefined && (n.properties || n.required) ? ['object'] : Array.isArray(n.type) ? n.type : [n.type];
    const nullable = types.includes('null');
    const main = types.filter((t) => t !== 'null');
    if (main.length === 0) {
      checkKeys(n, ['type'], where);
      return ['z.null()', false];
    }
    if (main.length !== 1) throw new Error(`${where}: type nhiều nhánh ${JSON.stringify(n.type)}`);
    let expr; let isObj = false;
    switch (main[0]) {
      case 'string':
        checkKeys(n, ['type', 'pattern', 'minLength', 'maxLength'], where);
        expr = 'z.string()';
        if (n.minLength !== undefined) expr += `.min(${n.minLength})`;
        if (n.maxLength !== undefined) expr += `.max(${n.maxLength})`;
        if (n.pattern !== undefined) expr += `.regex(new RegExp(${lit(n.pattern)}))`;
        break;
      case 'integer':
      case 'number':
        checkKeys(n, ['type', 'minimum', 'maximum'], where);
        expr = main[0] === 'integer' ? 'z.number().int()' : 'z.number()';
        if (n.minimum !== undefined) expr += `.min(${n.minimum})`;
        if (n.maximum !== undefined) expr += `.max(${n.maximum})`;
        break;
      case 'boolean':
        checkKeys(n, ['type'], where);
        expr = 'z.boolean()';
        break;
      case 'object':
        [expr, isObj] = this.object(n, where);
        break;
      case 'array':
        expr = this.array(n, where);
        break;
      default:
        throw new Error(`${where}: type lạ ${main[0]}`);
    }
    return nullable ? [`${expr}.nullable()`, false] : [expr, isObj];
  }

  object(n, where) {
    checkKeys(n, ['type', 'properties', 'required', 'additionalProperties'], where);
    const props = n.properties ?? {};
    const required = new Set(n.required ?? []);
    for (const r of required) if (!(r in props)) throw new Error(`${where}: required "${r}" không có trong properties`);
    if (n.additionalProperties !== undefined && n.additionalProperties !== false) throw new Error(`${where}: additionalProperties chỉ hỗ trợ false`);
    const lines = Object.entries(props).map(([k, v]) => {
      const [e] = this.node(v, `${where}/${k}`);
      return `  ${k}: ${e}${required.has(k) ? '' : '.optional()'},`;
    });
    const body = lines.length ? `z.object({\n${lines.join('\n')}\n})` : 'z.object({})';
    return [`${body}${n.additionalProperties === false ? '.strict()' : '.passthrough()'}`, n.additionalProperties === false];
  }

  array(n, where) {
    checkKeys(n, ['type', 'items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems', 'allOf'], where);
    if (!n.items) throw new Error(`${where}: array thiếu items`);
    const [item] = this.node(n.items, `${where}/items`);
    let expr;
    if (n.prefixItems) {
      if ((n.minItems ?? 0) < n.prefixItems.length) throw new Error(`${where}: prefixItems cần minItems ≥ số phần tử prefix`);
      const prefix = n.prefixItems.map((p, i) => this.node(p, `${where}/prefixItems/${i}`)[0]);
      expr = `z.tuple([${prefix.join(', ')}]).rest(${item})`;
      if (n.maxItems !== undefined) expr += `.refine((a) => a.length <= ${n.maxItems}, 'tối đa ${n.maxItems} phần tử')`;
    } else {
      expr = `z.array(${item})`;
      if (n.minItems !== undefined) expr += `.min(${n.minItems})`;
      if (n.maxItems !== undefined) expr += `.max(${n.maxItems})`;
    }
    if (n.uniqueItems) {
      this.helpersUsed.add('uniqueItems');
      expr += '.superRefine(uniqueItems)';
    }
    if (n.allOf) {
      const rules = n.allOf.map((c, i) => {
        checkKeys(c, ['contains', 'minContains', 'maxContains'], `${where}/allOf/${i}`);
        if (!c.contains) throw new Error(`${where}/allOf/${i}: allOf trên array chỉ hỗ trợ contains`);
        const [schema] = this.node(c.contains, `${where}/allOf/${i}/contains`);
        const max = c.maxContains === undefined ? 'null' : c.maxContains;
        const label = Object.entries(c.contains.properties ?? {}).map(([k, v]) => `${k} = ${'const' in v ? v.const : '…'}`).join(', ');
        return `{ schema: ${schema.replace(/\n\s*/g, ' ')}, min: ${c.minContains ?? 1}, max: ${max}, label: ${lit(label)} }`;
      });
      this.helpersUsed.add('containsRule');
      expr += `.superRefine(containsRule([\n    ${rules.join(',\n    ')},\n  ]))`;
    }
    return expr;
  }

  /** allOf [base (ref/object), {properties: override}…] → base.extend(override). */
  allOf(n, where) {
    checkKeys(n, ['allOf'], where);
    const [first, ...rest] = n.allOf;
    const [base, isObj] = this.node(first, `${where}/allOf/0`);
    if (!isObj) throw new Error(`${where}: allOf cần phần tử đầu là ZodObject`);
    const lines = [];
    rest.forEach((part, i) => {
      checkKeys(part, ['properties'], `${where}/allOf/${i + 1}`);
      for (const [k, v] of Object.entries(part.properties ?? {})) {
        const keys = Object.keys(v).filter((x) => !IGNORED.has(x));
        if (keys.length > 0 && keys.every((x) => x === 'minimum' || x === 'maximum')) {
          // Chỉ siết khoảng số trên field số của base: giữ kiểu base, thêm min/max (giao của allOf).
          let e = `${base}.shape.${k}`;
          if (v.minimum !== undefined) e += `.min(${v.minimum})`;
          if (v.maximum !== undefined) e += `.max(${v.maximum})`;
          lines.push(`  ${k}: ${e},`);
          continue;
        }
        if (!OVERRIDE_KINDS.some((kind) => kind in v)) throw new Error(`${where}/${k}: override phải có ${OVERRIDE_KINDS.join('/')} hoặc chỉ minimum/maximum`);
        lines.push(`  ${k}: ${this.node(v, `${where}/${k}`)[0]},`);
      }
    });
    return [lines.length ? `${base}.extend({\n${lines.join('\n')}\n})` : base, true];
  }

  render(index, label) {
    const [root] = this.node(Object.fromEntries(Object.entries(this.schema).filter(([k]) => k !== '$defs')), this.file);
    const name = `${pascal(this.key)}DataSchema`;
    const desc = `${this.key} (${label})`;
    const imports = [`import { z } from 'zod';`, ''];
    if (this.commonUsed.size) imports.push(`import {\n  ${[...this.commonUsed].sort().join(',\n  ')},\n} from '../common-schema';`);
    if (this.helpersUsed.size) imports.push(`import { ${[...this.helpersUsed].sort().join(', ')} } from './_helpers';`);
    const tdoc = `T-DOC-${String(index + 1).padStart(2, '0')}`;
    return [
      `// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/${this.file} — KHÔNG sửa tay.`,
      `// ${tdoc} — ${desc}`,
      ...imports,
      '',
      ...this.defsOut.flatMap((d) => [d, '']),
      `export const ${name} = ${root};`,
      `export type ${pascal(this.key)}Data = z.infer<typeof ${name}>;`,
      '',
    ].join('\n');
  }
}

/** Mọi file cần sinh: Map(tên file → nội dung). */
export function generate() {
  const onDisk = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json') && !f.startsWith('_')).map((f) => f.replace('.schema.json', '')).sort();
  const expected = [...DOC_ORDER].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(expected)) throw new Error(`doc_schemas lệch 27 loại: ${onDisk.join(', ')}`);
  const labels = new Map(readJson(join(DATA, 'doc_types.json')).doc_types.map((d) => [d.doc_type_key, d.doc_type_label]));
  const out = new Map();
  DOC_ORDER.forEach((key, i) => {
    if (!labels.has(key)) throw new Error(`doc_types.json không có ${key}`);
    out.set(`${key}.ts`, new FileGen(key).render(i, labels.get(key)));
  });
  out.set('index.ts', [
    '// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs — KHÔNG sửa tay.',
    '// Bảng schema zod của 27 loại FULL; tra qua s2/schema-registry.ts (T-S2-01).',
    "import type { ZodTypeAny } from 'zod';",
    '',
    ...DOC_ORDER.map((k) => `import { ${pascal(k)}DataSchema } from './${k}';`),
    '',
    'export const DOC_DATA_SCHEMAS: Readonly<Record<string, ZodTypeAny>> = {',
    ...DOC_ORDER.map((k) => `  ${k}: ${pascal(k)}DataSchema,`),
    '};',
    '',
    ...DOC_ORDER.map((k) => `export { ${pascal(k)}DataSchema } from './${k}';`),
    ...DOC_ORDER.map((k) => `export type { ${pascal(k)}Data } from './${k}';`),
    '',
  ].join('\n'));
  return out;
}

const HAND_WRITTEN = new Set(['_helpers.ts']);

function main() {
  const check = process.argv.includes('--check');
  const files = generate();
  let changed = 0; let removed = 0;
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, content] of files) {
    const path = join(OUT_DIR, name);
    const cur = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null;
    if (cur !== content) {
      changed += 1;
      if (check) console.error(`lệch: ${name}`);
      else writeFileSync(path, content, 'utf8');
    }
  }
  for (const name of readdirSync(OUT_DIR)) {
    if (!files.has(name) && !HAND_WRITTEN.has(name)) {
      removed += 1;
      if (check) console.error(`thừa: ${name}`);
      else rmSync(join(OUT_DIR, name));
    }
  }
  console.log(`gen-loan-doc-schemas: ${files.size} file, ${check ? 'lệch' : 'ghi'} ${changed}, ${check ? 'thừa' : 'xóa'} ${removed}`);
  if (check && changed + removed > 0) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
