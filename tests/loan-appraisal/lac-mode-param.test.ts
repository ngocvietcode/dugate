// tests/loan-appraisal/lac-mode-param.test.ts
// D-103: `lac_mode` phải là tham số khai báo của workflows:loan-appraisal. mergeParameters chỉ nhận key có trong
// khai báo sub-case hoặc tham số Profile, nên thiếu khai báo thì client gửi `lac_mode=on` bị bỏ qua và hồ sơ chạy `off`.

jest.mock('@/lib/db', () => ({ db: {} }));
jest.mock('@/lib/db/schema', () => ({ profileEndpoints: {} }));
jest.mock('@/lib/crypto', () => ({ decrypt: (v: string) => v }));

import { SERVICE_REGISTRY } from '@/lib/endpoints/registry';
import { mergeParameters } from '@/lib/endpoints/profile-resolver';
import { resolveLacMode } from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';

const params = SERVICE_REGISTRY.workflows.subCases['loan-appraisal'].parameters;

function merge(form: Record<string, string>, db: Record<string, { value: unknown; isLocked?: boolean }> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  const result = mergeParameters(fd, params, db);
  if (!result.ok) throw new Error('merge rejected');
  return result.vars;
}

describe('lac_mode run parameter', () => {
  it('is declared with off | shadow | on and default off', () => {
    expect(params.lac_mode).toMatchObject({ type: 'string', options: ['off', 'shadow', 'on'], default: 'off' });
  });

  it.each(['off', 'shadow', 'on'])('reaches pipelineVars when the client sends %s', (mode) => {
    const vars = merge({ lac_mode: mode });
    expect(vars.lac_mode).toBe(mode);
    expect(resolveLacMode(vars.lac_mode)).toBe(mode);
  });

  it('defaults to off when absent', () => {
    expect(resolveLacMode(merge({}).lac_mode)).toBe('off');
  });

  it('can be locked by the admin through the Profile', () => {
    const fd = new FormData();
    fd.append('lac_mode', 'on');
    const result = mergeParameters(fd, params, { lac_mode: { value: 'off', isLocked: true } });
    expect(result.ok).toBe(false);
  });
});
