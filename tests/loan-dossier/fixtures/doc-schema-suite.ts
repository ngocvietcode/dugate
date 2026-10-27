// Bộ test dùng chung cho schema zod từng loại FULL (T-DOC-*): DoD trong S2 §7.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { enumValues } from '@/lib/loan-dossier/catalog';
import { getDocSchema } from '@/lib/loan-dossier/s2/schema-registry';

import { makeFullData, makeRichData } from './build';

type Json = Record<string, unknown>;
const SCHEMA_DIR = join(__dirname, '..', '..', '..', 'lib', 'loan-dossier', 'catalog', 'data', 'doc_schemas');
const load = (file: string): Json => JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function resolve(node: Json, file: string): [Json, string] {
  if (typeof node.$ref !== 'string') return [node, file];
  const [target, ptr = ''] = node.$ref.split('#');
  const f = target || file;
  let cur: unknown = load(f);
  for (const part of ptr.split('/').filter(Boolean)) cur = (cur as Json)[part];
  return resolve(cur as Json, f);
}

/** Tập `party_role` mà JSON Schema của item party cho phép (override cuối cùng thắng). */
function rolesOf(node: Json, file: string): string[] | null {
  const [n, f] = resolve(node, file);
  if (Array.isArray(n.allOf)) {
    const parts = n.allOf as Json[];
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const r = rolesOf(parts[i], f);
      if (r) return r;
    }
    return null;
  }
  const role = (n.properties as Record<string, Json> | undefined)?.party_role;
  if (!role) return null;
  const [r] = resolve(role, f);
  if ('const' in r) return [r.const as string];
  if (Array.isArray(r.enum)) return (r.enum as Array<string | null>).filter((x): x is string => x !== null);
  return null;
}

/** party_role được JSON Schema cho phép ở `data.parties` (items + prefixItems). */
export function jsonSchemaPartyRoles(docTypeKey: string): string[] {
  const file = `${docTypeKey}.schema.json`;
  const parties = (load(file).properties as Record<string, Json>).parties;
  const nodes = [parties.items as Json, ...((parties.prefixItems ?? []) as Json[])];
  const out = new Set<string>();
  for (const node of nodes) for (const r of rolesOf(node, file) ?? []) out.add(r);
  return [...out].sort();
}

/** Biến thể của data rich khi đặt `party_role = role`: thay từng vị trí, hoặc thêm 1 party ở cuối. */
function roleVariants(rich: Json, role: string): Json[] {
  const parties = rich.parties as Json[];
  const out: Json[] = parties.map((_, i) => {
    const d = clone(rich);
    (d.parties as Json[])[i].party_role = role;
    return d;
  });
  const appended = clone(rich);
  const extra = clone(parties[parties.length - 1]);
  extra.party_index = parties.length;
  extra.party_role = role;
  (appended.parties as Json[]).push(extra);
  out.push(appended);
  return out;
}

/** Object lồng đầu tiên (không phải party) trong data — để thử field lạ ở tầng con. */
function firstNestedObject(data: Json): string[] | null {
  for (const [k, v] of Object.entries(data)) {
    if (k === 'parties') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) return [k];
    if (Array.isArray(v) && v[0] && typeof v[0] === 'object') return [k, '0'];
  }
  return null;
}

export function describeDocSchema(docTypeKey: string, allowedRoles: readonly string[]): void {
  describe(`schema ${docTypeKey}`, () => {
    const schema = getDocSchema(docTypeKey);
    const required = new Set((load(`${docTypeKey}.schema.json`).required ?? []) as string[]);
    const ok = (d: unknown) => schema.safeParse(d).success;

    it('fixture tối thiểu hợp lệ qua', () => {
      const r = schema.safeParse(makeFullData(docTypeKey));
      expect(r.success ? [] : r.error.issues).toEqual([]);
    });

    it('fixture đầy đủ (mọi field khác null) hợp lệ qua', () => {
      const r = schema.safeParse(makeRichData(docTypeKey));
      expect(r.success ? [] : r.error.issues).toEqual([]);
    });

    it('thiếu parties bị từ chối', () => {
      expect(required.has('parties')).toBe(true);
      const d = makeRichData(docTypeKey);
      delete d.parties;
      expect(ok(d)).toBe(false);
    });

    it(required.has('legal_info') ? 'thiếu legal_info bị từ chối' : 'JSON Schema không có legal_info → thêm vào bị từ chối', () => {
      const d = makeRichData(docTypeKey);
      if (required.has('legal_info')) delete d.legal_info;
      else d.legal_info = null;
      expect(ok(d)).toBe(false);
    });

    it('field lạ bị từ chối ở gốc, trong party và trong object con', () => {
      const d = makeRichData(docTypeKey);
      expect(ok({ ...d, unknown_field: 'X' })).toBe(false);
      const p = clone(d);
      (p.parties as Json[])[0].unknown_field = 'X';
      expect(ok(p)).toBe(false);
      const path = firstNestedObject(d);
      if (path) {
        const n = clone(d);
        let cur: Json = n;
        for (const seg of path) cur = cur[seg] as Json;
        cur.unknown_field = 'X';
        expect(ok(n)).toBe(false);
      }
    });

    it('JSON Schema cho phép đúng tập party_role của bảng §7', () => {
      expect(jsonSchemaPartyRoles(docTypeKey)).toEqual([...allowedRoles].sort());
    });

    it('party_role chỉ trong tập cho phép', () => {
      const rich = makeRichData(docTypeKey);
      const all = enumValues('PartyRole').filter((r): r is string => r !== null);
      for (const role of all) {
        const accepted = roleVariants(rich, role).some(ok);
        expect({ role, accepted }).toEqual({ role, accepted: allowedRoles.includes(role) });
      }
    });
  });
}
