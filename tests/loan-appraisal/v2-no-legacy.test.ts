// T-V2-11 — gỡ phần cũ (V2-R02, V2-R05).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const WF = join(ROOT, 'lib', 'pipelines', 'workflows');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('gỡ module v2 cũ', () => {
  it('lib/pipelines/workflows/loan-appraisal* không còn form_code, LOAN_FORMS, catalogFormat', () => {
    const files = [join(WF, 'loan-appraisal.ts'), ...tsFiles(join(WF, 'loan-appraisal')), join(WF, 'prompts', 'loan-appraisal-prompts.ts')];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect({ f, hit: /form_code|LOAN_FORMS|catalogFormat/.test(src) }).toEqual({ f, hit: false });
    }
  });

  it('module thay bởi S3–S5 và danh mục mẫu biểu UAT đã xóa; trang /loan-appraisal cũ đã gỡ', () => {
    for (const name of ['form-catalog', 'forms', 'grouping', 'cross-check-matrix', 'checklist-flow', 'dossier-checks', 'master-data-dimension']) {
      expect(existsSync(join(WF, 'loan-appraisal', `${name}.ts`))).toBe(false);
    }
    expect(existsSync(join(ROOT, 'scripts', 'gen-loan-form-catalog.js'))).toBe(false);
    expect(existsSync(join(ROOT, 'app', 'loan-appraisal', 'page.tsx'))).toBe(false);
    expect(readFileSync(join(ROOT, 'lib', 'navigation', 'registry.ts'), 'utf8')).not.toMatch(/path: '\/loan-appraisal'/);
  });

  it('tsc --noEmit không lỗi', () => {
    expect(() => execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', join(ROOT, 'tsconfig.json')], {
      cwd: ROOT, stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2560' },
    })).not.toThrow();
  }, 300_000);
});
