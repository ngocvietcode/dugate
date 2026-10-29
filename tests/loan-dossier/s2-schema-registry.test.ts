// T-S2-01 — registry schema zod 27 loại FULL; file sinh trong s2/schemas/ khớp JSON Schema nguồn.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { loadDocTypes } from '@/lib/loan-dossier/catalog';
import {
  fullDocTypeKeys, getDocSchema, notImplementedDocTypes, UNKNOWN_DOC_TYPE, UnknownDocTypeError,
} from '@/lib/loan-dossier/s2/schema-registry';
import { DOC_DATA_SCHEMAS } from '@/lib/loan-dossier/s2/schemas';

const ROOT = join(__dirname, '..', '..');

describe('schema registry (T-S2-01)', () => {
  it('30 key FULL đều có entry, không thừa key', () => {
    expect(fullDocTypeKeys()).toHaveLength(30);
    expect(Object.keys(DOC_DATA_SCHEMAS).sort()).toEqual(fullDocTypeKeys().sort());
    for (const k of fullDocTypeKeys()) expect(getDocSchema(k)).toBe(DOC_DATA_SCHEMAS[k]);
  });

  it('không còn key notImplemented (T-DOC-01…27 xong)', () => {
    expect(notImplementedDocTypes()).toEqual([]);
  });

  it('deposit_certificate (LIGHT) → ném UNKNOWN_DOC_TYPE', () => {
    expect(() => getDocSchema('deposit_certificate')).toThrow(UnknownDocTypeError);
    try {
      getDocSchema('deposit_certificate');
    } catch (e) {
      expect((e as UnknownDocTypeError).code).toBe(UNKNOWN_DOC_TYPE);
    }
  });

  it('mọi loại LIGHT và key lạ → ném lỗi', () => {
    for (const d of loadDocTypes().filter((x) => x.extraction_level === 'LIGHT')) {
      expect(() => getDocSchema(d.doc_type_key)).toThrow(UNKNOWN_DOC_TYPE);
    }
    expect(() => getDocSchema('khong_co')).toThrow(UNKNOWN_DOC_TYPE);
  });

  it('file sinh trong s2/schemas khớp JSON Schema hiện tại (gen-loan-doc-schemas --check)', () => {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'gen-loan-doc-schemas.mjs'), '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/lệch 0, thừa 0/);
  });
});
