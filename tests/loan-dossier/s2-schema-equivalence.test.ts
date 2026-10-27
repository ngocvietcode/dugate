// T-DOC-* — zod "dịch đúng JSON Schema": so kết quả zod với Ajv (JSON Schema 2020-12) trên fixture
// và trên các biến thể đột biến từng nút của fixture đầy đủ. Lệch ở bất kỳ biến thể nào là lỗi dịch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020';

import { getDocSchema } from '@/lib/loan-dossier/s2/schema-registry';
import { DOC_DATA_SCHEMAS } from '@/lib/loan-dossier/s2/schemas';

import { makeFullData, makeRichData } from './fixtures/build';

type Json = Record<string, unknown>;
const SCHEMA_DIR = join(__dirname, '..', '..', 'lib', 'loan-dossier', 'catalog', 'data', 'doc_schemas');
const BASE = 'https://specs.loan-appraisal-hkd/v3/documents/';
const load = (file: string): Json => JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'));

// RFC 3339 date-time có múi giờ — cùng nghĩa với `z.string().datetime({ offset: true })`.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const ajv = new Ajv2020({ strict: false, allErrors: false });
ajv.addFormat('date-time', DATE_TIME);
// $ref trong schema loại là đường dẫn tương đối `_common.schema.json` / `_enums.schema.json`.
ajv.addSchema({ ...load('_enums.schema.json'), $id: `${BASE}_enums.schema.json` });
ajv.addSchema({ ...load('_common.schema.json'), $id: `${BASE}_common.schema.json` });

type Mutation = { path: string; what: string; data: unknown };

/** Đột biến từng nút: null, sai kiểu, số lẻ/âm, xóa key, thêm key lạ, thêm/xóa phần tử mảng. */
function mutations(root: Json): Mutation[] {
  const out: Mutation[] = [];
  const replacements: Array<[string, unknown]> = [
    ['null', null], ['string', 'X'], ['decimal', 1.5], ['negative', -1], ['boolean', true], ['object', {}], ['array', []],
  ];
  const walk = (node: unknown, path: Array<string | number>) => {
    const set = (what: string, fn: (parent: Json | unknown[], key: string | number) => void) => {
      const data = JSON.parse(JSON.stringify(root));
      let parent = data;
      for (const seg of path.slice(0, -1)) parent = parent[seg];
      fn(parent, path[path.length - 1]);
      out.push({ path: path.join('.'), what, data });
    };
    if (path.length > 0) {
      for (const [what, v] of replacements) set(what, (p, k) => { (p as Json)[k as string] = v; });
      if (typeof path[path.length - 1] === 'string') set('delete', (p, k) => { delete (p as Json)[k as string]; });
    }
    if (Array.isArray(node)) {
      if (node.length) {
        set('push-copy', (p, k) => {
          const arr = path.length ? (p as Json)[k as string] as unknown[] : (p as unknown as unknown[]);
          arr.push(JSON.parse(JSON.stringify(arr[arr.length - 1])));
        });
      }
      node.forEach((v, i) => walk(v, [...path, i]));
    } else if (node && typeof node === 'object') {
      if (path.length > 0) set('extra-key', (p, k) => { ((p as Json)[k as string] as Json).__extra__ = 1; });
      for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
    }
  };
  walk(root, []);
  out.push({ path: '(gốc)', what: 'extra-key', data: { ...root, __extra__: 1 } });
  return out;
}

describe('zod khớp JSON Schema (Ajv 2020-12) cho 27 loại FULL', () => {
  it.each(Object.keys(DOC_DATA_SCHEMAS))('%s', (key) => {
    const validate = ajv.compile({ ...load(`${key}.schema.json`), $id: `${BASE}${key}.schema.json` });
    const zod = getDocSchema(key);
    const rich = makeRichData(key);
    const minimal = makeFullData(key);
    // Fixture phải hợp lệ ở cả hai bên, nếu không thì phép so đột biến vô nghĩa.
    expect([validate(rich), zod.safeParse(rich).success]).toEqual([true, true]);
    expect([validate(minimal), zod.safeParse(minimal).success]).toEqual([true, true]);

    const cases = mutations(rich);
    const results = cases.map((m) => ({ ...m, ajv: validate(m.data) as boolean, zod: zod.safeParse(m.data).success }));
    const mismatches = results
      .filter((m) => m.ajv !== m.zod)
      .map(({ path, what, ajv: a, zod: z }) => `${path} [${what}] ajv=${a} zod=${z}`);
    expect(mismatches).toEqual([]);
    // Phép so có ý nghĩa: nhiều biến thể, cả nhận lẫn từ chối.
    expect(cases.length).toBeGreaterThan(50);
    expect(results.filter((m) => !m.ajv).length).toBeGreaterThan(cases.length / 2);
    expect(results.some((m) => m.ajv)).toBe(true);
  });
});
