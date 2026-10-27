// T-CAT-01 — catalog trong code phải giống hệt bản spec (F-R01).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'docs', 'loan-appraisal', 'spec-v3', '03_catalogs');
const DEST = join(ROOT, 'lib', 'loan-dossier', 'catalog', 'data');

function listJson(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      for (const sub of readdirSync(full).sort()) if (sub.endsWith('.json')) out.push(`${name}/${sub}`);
    } else if (name.endsWith('.json')) {
      out.push(name);
    }
  }
  return out;
}

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('sync-loan-catalogs (T-CAT-01)', () => {
  it('mọi file trong 03_catalogs có bản trùng SHA-256 trong data/', () => {
    const files = listJson(SRC);
    expect(files.length).toBeGreaterThanOrEqual(36);
    for (const rel of files) {
      expect(existsSync(join(DEST, rel))).toBe(true);
      expect(sha(join(DEST, rel))).toBe(sha(join(SRC, rel)));
    }
  });

  it('không có file thừa trong data/', () => {
    expect(listJson(DEST)).toEqual(listJson(SRC));
  });

  it('chạy hai lần liên tiếp cho cùng kết quả (idempotent)', () => {
    const run = () => execFileSync(process.execPath, [join(ROOT, 'scripts', 'sync-loan-catalogs.mjs')], { encoding: 'utf8' });
    run();
    const before = listJson(DEST).map((rel) => `${rel}:${sha(join(DEST, rel))}`);
    expect(run()).toMatch(/chép 0, xóa 0/);
    expect(listJson(DEST).map((rel) => `${rel}:${sha(join(DEST, rel))}`)).toEqual(before);
  });
});
