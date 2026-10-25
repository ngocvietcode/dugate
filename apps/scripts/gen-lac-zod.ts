// Sinh src/generated/lac.zod.ts từ credit-kit/contracts/lac.schema.json (plan 002 P3).
//   npm run gen:lac-zod     — ghi file
//   npm run check:lac-zod   — CI: báo lỗi nếu file sinh lệch với schema
import fs from 'node:fs';
import path from 'node:path';
import { jsonSchemaToZod } from 'json-schema-to-zod';

const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'credit-kit', 'contracts', 'lac.schema.json');
const outPath = path.join(root, 'src', 'generated', 'lac.zod.ts');

/** json-schema-to-zod không theo $ref: nhúng $defs vào chỗ dùng (schema LAC không đệ quy). */
function inline(node: unknown, defs: Record<string, unknown>): unknown {
  if (Array.isArray(node)) return node.map((x) => inline(x, defs));
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.$ref === 'string' && o.$ref.startsWith('#/$defs/')) return inline(defs[o.$ref.slice(8)], defs);
    return Object.fromEntries(Object.entries(o).filter(([k]) => k !== '$defs' && k !== '$schema' && k !== '$id')
      .map(([k, v]) => [k, inline(v, defs)]));
  }
  return node;
}

export function generate(): string {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const body = jsonSchemaToZod(inline(schema, schema.$defs ?? {}) as object, { name: 'LacSchema', module: 'esm', type: 'Lac' });
  return `// SINH TỰ ĐỘNG từ credit-kit/contracts/lac.schema.json — không sửa tay. Chạy: npm run gen:lac-zod\n/* eslint-disable */\n${body}`;
}

if (require.main === module) {
  const text = generate();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    if (cur !== text) { console.error('src/generated/lac.zod.ts lệch với lac.schema.json — chạy npm run gen:lac-zod'); process.exit(1); }
    console.log('lac.zod.ts khớp schema');
  } else {
    fs.writeFileSync(outPath, text);
    console.log(`đã ghi ${path.relative(root, outPath)}`);
  }
}
