// D-97 — đường chạy chính của workflow không import (lúc chạy) các bước kiểm tra hồ sơ đang tắt.
// Duyệt đồ thị import tĩnh từ entry point; bỏ qua `import type` / `export type` (bị xoá khi biên dịch).
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const ENTRY = 'lib/pipelines/workflows/loan-appraisal.ts';

/** Module thuộc các bước đang tắt (S4, S5, consolidate). Bật lại bước nào thì bỏ khỏi danh sách. master_dossier đã gỡ hẳn (D-115). */
const DISABLED = [
  'lib/pipelines/workflows/loan-appraisal/dossier-consolidate.ts',
  'lib/loan-dossier/s4/run.ts',
  'lib/loan-dossier/s5/run.ts',
];

const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolve(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  else return null; // package ngoài
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.relative(ROOT, candidate).split(path.sep).join('/');
  }
  return null;
}

function runtimeGraph(entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of source.matchAll(IMPORT_RE)) {
      const target = resolve(file, m[1]);
      if (target && !seen.has(target)) { seen.add(target); stack.push(target); }
    }
  }
  return seen;
}

describe('D-97: tách các bước kiểm tra hồ sơ đang tắt khỏi đường chạy chính', () => {
  const graph = runtimeGraph(ENTRY);

  it('bộ duyệt thấy đúng các module chính (kiểm tra chính bộ duyệt)', () => {
    for (const f of ['lib/pipelines/workflows/loan-appraisal/prompt-checks.ts', 'lib/loan-dossier/s3/run.ts', 'lib/pipelines/workflows/loan-appraisal/run-params.ts']) {
      expect(graph.has(f)).toBe(true);
    }
  });

  it.each(DISABLED)('%s không nằm trong đồ thị import lúc chạy', (file) => {
    expect(fs.existsSync(path.join(ROOT, file))).toBe(true); // code vẫn còn (D-82: tắt, không xóa)
    expect(graph.has(file)).toBe(false);
  });
});
