import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: path.resolve(__dirname, '..') });

async function messages(code: string, file: string): Promise<string[]> {
  const [r] = await eslint.lintText(code, { filePath: path.resolve(__dirname, '..', file) });
  return r.messages.map((m) => `${m.ruleId}: ${m.message}`);
}

describe('ranh giới tầng (constitution L2, §10)', () => {
  it('Apps không import code của Core', async () => {
    const m = await messages(`import { db } from '@/lib/db';\nexport const x = db;\n`, 'src/platform/x.ts');
    expect(m.join('\n')).toMatch(/Core/);
  });

  it('workflow không import node builtin hay thư viện I/O', async () => {
    const m = await messages(`import fs from 'fs';\nimport { Pool } from 'pg';\nexport const a = [fs, Pool];\n`,
      'src/credit-appraisal-assist/workflow.ts');
    expect(m.filter((x) => x.includes('no-restricted-imports')).length).toBe(2);
  });

  it('workflow không gọi fetch trực tiếp', async () => {
    const m = await messages(`export async function w() { return fetch('http://x'); }\n`, 'src/credit-appraisal-assist/workflow.ts');
    expect(m.join('\n')).toMatch(/no-restricted-globals/);
  });

  it('workflow được import KIỂU từ activities', async () => {
    const m = await messages(`import type * as acts from '../platform/activities';\nexport type A = typeof acts;\n`,
      'src/credit-appraisal-assist/workflow.ts');
    expect(m.filter((x) => x.includes('no-restricted-imports'))).toEqual([]);
  });

  it('workflow không được import GIÁ TRỊ từ activities', async () => {
    const m = await messages(`import { callCore } from '../platform/activities';\nexport const a = callCore;\n`,
      'src/credit-appraisal-assist/workflow.ts');
    expect(m.join('\n')).toMatch(/proxyActivities/);
  });
});
