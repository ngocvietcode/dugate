// UAT: loại LIGHT (VD GCN ĐKHKD) lỗi hàng loạt field party vì prompt không gửi schema DocumentParty.
import { COMMON_JSON_SCHEMA } from '@/lib/loan-dossier/catalog/doc-schema-json';
import { loadDocTypes } from '@/lib/loan-dossier/catalog';
import { buildExtractPrompt } from '@/lib/loan-dossier/s2/extractor-port';
import { lightJsonSchema } from '@/lib/loan-dossier/s2/light';

const LIGHT = loadDocTypes().filter((d) => d.extraction_level === 'LIGHT').map((d) => d.doc_type_key);
const DEFS = (COMMON_JSON_SCHEMA as { $defs: Record<string, unknown> }).$defs;

function refsOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => refsOf(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (k === '$ref' && typeof v === 'string') out.push(v); else refsOf(v, out);
  }
  return out;
}

describe('S2 · prompt bóc tách nhẹ', () => {
  it('có đủ 17 loại LIGHT', () => expect(LIGHT).toHaveLength(17));

  it.each(LIGHT)('%s: prompt kèm JSON Schema data + định nghĩa DocumentParty/enum; $ref đều tồn tại', (key) => {
    const prompt = buildExtractPrompt(key, [1, 1]);
    expect(prompt).toContain(JSON.stringify(lightJsonSchema(key)));
    expect(prompt).toContain('"DocumentParty"');
    expect(prompt).toContain('"party_index"');
    expect(prompt).toContain('"IdType"');
    for (const r of refsOf(lightJsonSchema(key))) {
      const m = r.match(/^_common\.schema\.json#\/\$defs\/(\w+)$/);
      expect(m && DEFS[m[1]] ? r : `thiếu ${r}`).toBe(r);
    }
  });

  it('household_business_license: fields đúng key của light_extraction.json', () => {
    const fields = (lightJsonSchema('household_business_license').properties as { fields: { required: string[] } }).fields;
    expect(fields.required).toEqual(expect.arrayContaining(['registration_number', 'business_name', 'business_address']));
  });
});
