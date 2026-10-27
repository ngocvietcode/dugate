// Bộ dựng fixture giả (T-TEST-01). Mọi giá trị là dữ liệu giả cố định: tên "NGUYEN VAN A",
// số định danh toàn số 0. Không dùng dữ liệu thật (TS-R05, S-R11).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { docTypeByKey, loadLightExtraction } from '@/lib/loan-dossier/catalog';
import type {
  Address, AssetDescriptor, AssetIdentifiers, DocumentParty, EvidenceEnvelope, LegalInfo,
} from '@/lib/loan-dossier/s2/common-schema';

const SCHEMA_DIR = join(__dirname, '..', '..', '..', 'lib', 'loan-dossier', 'catalog', 'data', 'doc_schemas');

export const FAKE_NAME = 'NGUYEN VAN A';
export const FAKE_ID12 = '000000000000';
export const FAKE_ID9 = '000000000';

export function makeAddress(overrides: Partial<Address> = {}): Address {
  return { full_text: 'SO 1 DUONG A, PHUONG B, QUAN C, HA NOI', street: 'SO 1 DUONG A', ward: 'PHUONG B', district: 'QUAN C', province: 'HA NOI', ...overrides };
}

export function makeLegalInfo(overrides: Partial<LegalInfo> = {}): LegalInfo {
  return {
    document_title: null, form_template_number: null, document_number: null, issuing_authority: null,
    issue_date: '2026-09-20', issue_place: null, valid_until: null, signatories: [], ...overrides,
  };
}

export function makeParty(overrides: Partial<DocumentParty> = {}): DocumentParty {
  return {
    party_index: 0, party_role: 'HOLDER', party_role_raw: null, party_type: 'INDIVIDUAL',
    full_name: FAKE_NAME, id_number: FAKE_ID12, id_type: 'CCCD', id_issue_date: null, id_issue_place: null,
    previous_id_numbers: [], date_of_birth: '1990-01-01', gender: 'MALE', nationality: null,
    permanent_address: makeAddress(), current_address: null, phone_number: null, tax_id: null,
    representative_name: null, representative_position: null, ownership: null, ...overrides,
  };
}

export function makeIdentifiers(overrides: Partial<AssetIdentifiers> = {}): AssetIdentifiers {
  return {
    certificate_number: null, certificate_book_number: null, land_parcel_number: null, map_sheet_number: null,
    apartment_number: null, building_name: null, project_name: null, license_plate: null, chassis_number: null,
    engine_number: null, registration_number: null, ...overrides,
  };
}

export function makeAsset(overrides: Partial<AssetDescriptor> = {}): AssetDescriptor {
  return {
    asset_index: 0, asset_type: 'real_estate', identifiers: makeIdentifiers({ certificate_number: 'BQ 000000' }),
    address: makeAddress(), description: null, usage_context_hint: null, ...overrides,
  };
}

// ── data tối thiểu theo JSON Schema của loại (FULL) ──────────────────────────
type JsonSchema = Record<string, unknown>;
const schemaCache = new Map<string, JsonSchema>();
function loadSchema(file: string): JsonSchema {
  if (!schemaCache.has(file)) schemaCache.set(file, JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')));
  return schemaCache.get(file)!;
}

function resolveRef(ref: string, file: string): [JsonSchema, string] {
  const [target, ptr = ''] = ref.split('#');
  const tfile = target || file;
  let cur: unknown = loadSchema(tfile);
  for (const part of ptr.split('/').filter(Boolean)) cur = (cur as Record<string, unknown>)[part];
  return [cur as JsonSchema, tfile];
}

/** Giá trị tối thiểu hợp lệ: null nếu được, mảng rỗng, object đủ field bắt buộc. */
function minimal(node: JsonSchema, file: string, depth = 0): unknown {
  if (depth > 40) return null;
  if (typeof node.$ref === 'string') {
    const [n, f] = resolveRef(node.$ref, file);
    return minimal(n, f, depth + 1);
  }
  if ('const' in node) return node.const;
  if (Array.isArray(node.enum)) return node.enum.includes(null) ? null : node.enum[0];
  if (Array.isArray(node.oneOf)) {
    const branches = node.oneOf as JsonSchema[];
    if (branches.some((b) => b.type === 'null')) return null;
    return minimal(branches[0], file, depth + 1);
  }
  if (Array.isArray(node.allOf)) {
    const parts = (node.allOf as JsonSchema[]).map((p) => {
      if (typeof p.$ref === 'string') return resolveRef(p.$ref, file);
      return [p, file] as [JsonSchema, string];
    });
    const base = parts.find(([p]) => p.type === 'object' || p.required) ?? parts[0];
    const value = minimal(base[0], base[1], depth + 1) as Record<string, unknown>;
    for (const [p] of parts) {
      for (const [k, v] of Object.entries((p.properties ?? {}) as Record<string, JsonSchema>)) {
        if ('const' in v) value[k] = v.const;
        else if (Array.isArray(v.enum) && !v.enum.includes(value[k])) value[k] = v.enum.includes(null) ? null : v.enum[0];
      }
    }
    return value;
  }
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes('null')) return null;
  if (types.includes('object')) {
    const props = (node.properties ?? {}) as Record<string, JsonSchema>;
    const out: Record<string, unknown> = {};
    for (const k of (node.required ?? []) as string[]) out[k] = minimal(props[k], file, depth + 1);
    return out;
  }
  if (types.includes('array')) {
    const n = Number(node.minItems ?? 0);
    return Array.from({ length: n }, () => minimal(node.items as JsonSchema, file, depth + 1));
  }
  if (types.includes('integer') || types.includes('number')) return Math.max(0, Number(node.minimum ?? 0));
  if (types.includes('boolean')) return false;
  if (types.includes('string')) return 'X';
  return null;
}

/** data tối thiểu của loại FULL (field null / mảng rỗng) + `legal_info` có ngày cấp; mảng `parties`/`assets` bắt buộc có 1 phần tử. */
export function makeFullData(docTypeKey: string): Record<string, unknown> {
  const file = `${docTypeKey}.schema.json`;
  const schema = loadSchema(file);
  const data = minimal(schema, file) as Record<string, unknown>;
  if ('legal_info' in data) data.legal_info = makeLegalInfo();
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  // `parties`: 1 phần tử khi mảng bắt buộc (có hoặc không minItems) — chứng từ nào cũng có chủ thể (S2-R20).
  // `assets`: chỉ khi schema đòi minItems ≥ 1.
  const one = (key: string, whenRequired: boolean) => {
    const p = props[key];
    if (!p || !p.items) return null;
    const needed = Number(p.minItems ?? 0) >= 1 || (whenRequired && required.has(key));
    if (!needed) return null;
    return minimal(p.items as JsonSchema, file) as Record<string, unknown>;
  };
  const party = one('parties', true);
  if (party) {
    // Số party và vai trò từng vị trí theo ràng buộc mảng (minItems, prefixItems, contains) — lấy từ bản rich.
    const shape = rich(props.parties, file) as Array<Record<string, unknown>>;
    data.parties = shape.map((p) => makeParty({
      party_index: p.party_index as number,
      party_role: p.party_role as string,
      party_type: p.party_type as string,
      id_type: (p.id_type ?? null) as string | null,
      ownership: null,
    }));
  }
  const asset = one('assets', false);
  if (asset) {
    data.assets = [makeAsset({
      asset_type: asset.asset_type as string,
      usage_context_hint: (asset.usage_context_hint ?? null) as string | null,
    })];
  }
  return data;
}

// ── data "đầy đủ" theo JSON Schema: mọi field có giá trị khác null (để test chạm mọi nhánh) ─
/** Giá trị giả hợp lệ cho các kiểu chung có pattern/format (theo tên def trong `_common.schema.json`). */
const RICH_COMMON: Record<string, unknown> = {
  DateString: '2026-01-15', NullableDate: '2026-01-15', DateTimeString: '2026-01-15T08:00:00+07:00',
  MoneyVND: 1000000, NullableMoney: 1000000, Percent: 10, Confidence: 0.9,
  IdNumber: FAKE_ID12, NullableIdNumber: FAKE_ID12, NullableString: 'X',
};

function applyOverride(value: Record<string, unknown>, props: Record<string, JsonSchema>): void {
  for (const [k, v] of Object.entries(props)) {
    if ('const' in v) value[k] = v.const;
    else if (Array.isArray(v.enum) && !v.enum.includes(value[k])) value[k] = v.enum.find((x) => x !== null) ?? null;
    else if (v.type === 'null') value[k] = null;
    if (typeof v.minimum === 'number' && typeof value[k] === 'number' && (value[k] as number) < v.minimum) value[k] = v.minimum;
    if (typeof v.maximum === 'number' && typeof value[k] === 'number' && (value[k] as number) > v.maximum) value[k] = v.maximum;
  }
}

function rich(node: JsonSchema, file: string, depth = 0): unknown {
  if (depth > 40) return null;
  if (typeof node.$ref === 'string') {
    const [target, ptr = ''] = node.$ref.split('#');
    const name = ptr.replace('/$defs/', '');
    if ((target || file) === '_common.schema.json' && name in RICH_COMMON) return RICH_COMMON[name];
    const [n, f] = resolveRef(node.$ref, file);
    return rich(n, f, depth + 1);
  }
  if ('const' in node) return node.const;
  if (Array.isArray(node.enum)) return node.enum.find((x) => x !== null) ?? null;
  if (Array.isArray(node.oneOf)) {
    const branch = (node.oneOf as JsonSchema[]).find((b) => b.type !== 'null') ?? (node.oneOf as JsonSchema[])[0];
    return rich(branch, file, depth + 1);
  }
  if (Array.isArray(node.allOf) && node.type !== 'array') {
    const [first, ...rest] = node.allOf as JsonSchema[];
    const value = rich(first, file, depth + 1) as Record<string, unknown>;
    for (const p of rest) applyOverride(value, (p.properties ?? {}) as Record<string, JsonSchema>);
    return value;
  }
  const types = (Array.isArray(node.type) ? node.type : [node.type]).filter((t) => t !== 'null');
  const t = types[0];
  if (t === 'object') {
    const props = (node.properties ?? {}) as Record<string, JsonSchema>;
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, rich(v, file, depth + 1)]));
  }
  if (t === 'array') {
    const items: unknown[] = [];
    for (const p of (node.prefixItems ?? []) as JsonSchema[]) items.push(rich(p, file, depth + 1));
    const contains = ((node.allOf ?? []) as JsonSchema[]).filter((c) => c.contains && Number(c.minContains ?? 1) >= 1);
    for (const c of contains) {
      const item = rich(node.items as JsonSchema, file, depth + 1) as Record<string, unknown>;
      applyOverride(item, ((c.contains as JsonSchema).properties ?? {}) as Record<string, JsonSchema>);
      items.push(item);
    }
    while (items.length < Math.max(1, Number(node.minItems ?? 0))) items.push(rich(node.items as JsonSchema, file, depth + 1));
    items.forEach((it, i) => {
      if (it && typeof it === 'object' && 'party_index' in it) (it as Record<string, unknown>).party_index = i;
    });
    return items;
  }
  if (t === 'integer' || t === 'number') return Math.max(1, Number(node.minimum ?? 1));
  if (t === 'boolean') return true;
  if (t === 'string') return 'X';
  return null;
}

/** data của loại FULL với mọi field khác null, mảng 1 phần tử (hoặc đủ ràng buộc contains/minItems). */
export function makeRichData(docTypeKey: string): Record<string, unknown> {
  const file = `${docTypeKey}.schema.json`;
  return rich(loadSchema(file), file) as Record<string, unknown>;
}

/** data của loại LIGHT theo `light_extraction.json` (S2-R20). */
export function makeLightData(docTypeKey: string): Record<string, unknown> {
  const light = loadLightExtraction().find((d) => d.doc_type_key === docTypeKey);
  if (!light) throw new Error(`makeLightData: ${docTypeKey} không phải loại LIGHT`);
  const fields: Record<string, unknown> = {};
  for (const f of light.fields) fields[f.key] = null;
  return {
    parties: [makeParty({ party_role: light.subject_party_role, party_type: light.subject_party_type })],
    legal_info: makeLegalInfo(),
    fields,
  };
}

export function makeEvidence(docTypeKey: string, overrides: Partial<EvidenceEnvelope> = {}): EvidenceEnvelope {
  const docType = docTypeByKey(docTypeKey);
  if (!docType) throw new Error(`makeEvidence: doc_type_key lạ ${docTypeKey}`);
  return {
    // id có chữ hex để không trùng mẫu số định danh 9/12 chữ số (test "không giá trị nào khớp số định danh thật").
    evidence_id: 'ev-00000000000a',
    extraction_level: docType.extraction_level,
    file_id: 'file-00000000000a',
    file_name: 'ho-so-gia.pdf',
    doc_type_key: docTypeKey,
    doc_type_label: docType.doc_type_label,
    instance_index: 1,
    page_range: [1, 1],
    status: 'SUCCESS',
    reason_code: null,
    message: null,
    detected_form_name: null,
    form_variant: null,
    schema_version: '3.0.0',
    data: docType.extraction_level === 'FULL' ? makeFullData(docTypeKey) : makeLightData(docTypeKey),
    field_confidences: {},
    source_pages: {},
    duplicate_group_id: null,
    duplicate_status: null,
    differing_fields: [],
    ...overrides,
  };
}

// ── file giả ────────────────────────────────────────────────────────────────
/** PNG tối thiểu (chỉ header + IHDR) — đủ để nhận dạng magic bytes, không phải ảnh xem được. */
export function makePng(width = 1, height = 1): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const len = Buffer.alloc(4); len.writeUInt32BE(13, 0);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), len, Buffer.from('IHDR'), ihdr, Buffer.alloc(4)]);
}

/** PDF tối thiểu `pages` trang (chuỗi byte, không thư viện). */
export function makePdf(pages = 1): Buffer {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  const objs = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages} >> endobj`,
    ...Array.from({ length: pages }, (_, i) => `${3 + i} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj`),
  ];
  return Buffer.from(`%PDF-1.4\n${objs.join('\n')}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}
