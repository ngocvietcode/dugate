import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate } from '../scripts/gen-lac-zod';
import { LacSchema } from '../src/generated/lac.zod';

const dir = path.join(__dirname, '..', 'credit-kit', 'contracts', 'examples');

describe('contract lac.json (Python -> TypeScript)', () => {
  it('Zod sinh ra khớp lac.schema.json hiện tại', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'src', 'generated', 'lac.zod.ts'), 'utf8')).toBe(generate());
  });

  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.lac.json'))) {
    it(`parse được ${f} do worker Python tạo`, () => {
      const lac = LacSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      expect(lac.discrepancies.every((x) => /^[0-9a-f]{12}$/.test(x.key))).toBe(true);
    });
  }

  it('từ chối lac.json sai contract', () => {
    const lac = JSON.parse(fs.readFileSync(path.join(dir, 'hkd_income_x12.lac.json'), 'utf8'));
    lac.discrepancies[0].class = 'Z';
    expect(LacSchema.safeParse(lac).success).toBe(false);
  });
});
