// Cấu hình workflow loan-appraisal THEO SẢN PHẨM: resolve cho runtime, validate khi ghi, chuyển cấu hình cũ.
import {
  LOAN_PROMPT_STEP_KEYS,
  LOAN_STEP_KEYS,
  migrateLegacyForProduct,
  resolveLoanConfig,
  RETIRED_STEP_KEYS,
  summarizeLoanProductConfigChange,
  validateLoanProductConfig,
} from '@/lib/pipelines/workflows/loan-appraisal/product-config';

const cfg = (product: Record<string, unknown>, code = 'hkd-loan') => ({ version: '1.0', products: { [code]: product } });

describe('step key', () => {
  it('S1/S2/evaluate chỉ chọn model + reasoning, không ghi đè prompt', () => {
    for (const key of ['classify', 'extract', 'evaluate']) {
      expect(LOAN_STEP_KEYS).toContain(key);
      expect(LOAN_PROMPT_STEP_KEYS).not.toContain(key);
    }
    for (const key of ['dossier_precheck', 'policy_checks']) {
      expect(LOAN_PROMPT_STEP_KEYS).toContain(key);
    }
    // intake_review (chấm lại tiêu chí bằng LLM) đã bỏ: tiêu chí dựng từ dossier_precheck, không còn là bước cấu hình.
    expect(LOAN_STEP_KEYS).not.toContain('intake_review');
  });

  it('D-99: danh mục chỉ còn bước workflow thực sự gọi; bước đã gỡ không còn cấu hình được', () => {
    expect([...LOAN_STEP_KEYS].sort()).toEqual(['classify', 'dossier_precheck', 'evaluate', 'extract', 'policy_checks']);
    for (const key of RETIRED_STEP_KEYS) expect(LOAN_STEP_KEYS).not.toContain(key);
  });

  it('D-99: cấu hình đã lưu còn khoá của bước đã gỡ → đọc bỏ êm (không warning), ghi vẫn hợp lệ', () => {
    const product = {
      prompts: { dossier_summary: 'tổng kết cũ', policy_checks: 'rule {{checks}} {{evidence}} {{output_schema}}' },
      models: { master_correction: 'm-old', income_source_classify: 'm-old', evaluate: 'm-eval' },
      reasoning: { loan_purpose_classify: 'low' },
    };
    const r = resolveLoanConfig(cfg(product), 'hkd-loan', 'FULL');
    expect(r.warnings).toEqual([]);
    expect(Object.keys(r.promptOverrides)).toEqual(['policy_checks']);
    expect(r.modelOverrides).toEqual({ evaluate: 'm-eval' });
    expect(r.reasoningEffortOverrides).toEqual({});
    expect(validateLoanProductConfig(cfg(product)).ok).toBe(true);
  });

  it('step lạ (không phải bước đã gỡ) vẫn bị từ chối khi ghi và cảnh báo khi đọc', () => {
    const product = { models: { no_such_step: 'm' } };
    expect(validateLoanProductConfig(cfg(product)).ok).toBe(false);
    expect(resolveLoanConfig(cfg(product), 'hkd-loan', 'FULL').warnings.some((w) => w.includes('no_such_step'))).toBe(true);
  });
});

describe('resolveLoanConfig (runtime, khoan dung)', () => {
  it('không cấu hình → mặc định, không warning', () => {
    const r = resolveLoanConfig(undefined, 'hkd-loan', 'FULL');
    expect(r.configured).toBe(false);
    expect(r.promptOverrides).toEqual({});
    expect(r.checkSet.source).toBe('DEFAULT');
    expect(r.warnings).toEqual([]);
  });

  it('chỉ lấy cấu hình của đúng sản phẩm đang chạy', () => {
    const raw = { products: { 'hkd-loan': { models: { evaluate: 'm-hkd' } }, sme: { models: { evaluate: 'm-sme' } } } };
    expect(resolveLoanConfig(raw, 'hkd-loan', 'FULL').modelOverrides).toEqual({ evaluate: 'm-hkd' });
    expect(resolveLoanConfig(raw, 'sme', 'FLOW_A').modelOverrides).toEqual({ evaluate: 'm-sme' });
  });

  it('nhận cả chuỗi JSON', () => {
    const r = resolveLoanConfig(JSON.stringify(cfg({ reasoning: { dossier_precheck: 'low' } })), 'hkd-loan', 'FULL');
    expect(r.reasoningEffortOverrides).toEqual({ dossier_precheck: 'low' });
  });

  it('bỏ mục sai kèm warning, không throw', () => {
    const r = resolveLoanConfig(cfg({
      models: { buoc_la: 'x', evaluate: 'ok' },
      reasoning: { evaluate: 'cực cao' },
      prompts: { extract: 'không được ghi đè' },
    }), 'hkd-loan', 'FULL');
    expect(r.modelOverrides).toEqual({ evaluate: 'ok' });
    expect(r.reasoningEffortOverrides).toEqual({});
    expect(r.promptOverrides).toEqual({});
    expect(r.warnings.join('\n')).toMatch(/buoc_la/);
    expect(r.warnings.join('\n')).toMatch(/reasoning\.evaluate/);
    expect(r.warnings.join('\n')).toMatch(/prompts: bỏ step lạ "extract"/);
  });

  it('JSON hỏng → mặc định kèm warning', () => {
    const r = resolveLoanConfig('{không phải json', 'hkd-loan', 'FULL');
    expect(r.configured).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('ngưỡng policy theo sản phẩm', () => {
    const r = resolveLoanConfig(cfg({ policy: { minimum_dscr: 1.4 } }), 'hkd-loan', 'FULL');
    expect(r.policyOverrides).toEqual({ minimumDscr: 1.4 });
  });

  it('công tắc theo luồng tắt đúng rule ở đúng luồng', () => {
    const raw = cfg({
      checks: { program: 'loan-secured', version: '1', checks: [{ id: 'LOAN.CAPACITY.MIN_DSCR', enabled: true }] },
      flows: { FAST: { checks: { 'LOAN.CAPACITY.MIN_DSCR': false } } },
    });
    const on = (flow: 'FULL' | 'FAST') => resolveLoanConfig(raw, 'hkd-loan', flow).checkSet.checks.find((c) => c.id === 'LOAN.CAPACITY.MIN_DSCR')?.enabled;
    expect(on('FULL')).toBe(true);
    expect(on('FAST')).toBe(false);
  });

  it('override checklist được dịch sang chương trình của sản phẩm', () => {
    const r = resolveLoanConfig(cfg({ checklist: { legal_qr_code_info: { FAST: 'NOT_REQUIRED' } } }), 'hkd-loan', 'FAST');
    expect(Object.values(r.checklistOverrides)[0]).toEqual({ legal_qr_code_info: { FAST: 'NOT_REQUIRED' } });
  });
});

describe('validateLoanProductConfig (ghi, fail-closed)', () => {
  const err = (value: unknown) => { const r = validateLoanProductConfig(value); return r.ok ? null : r.error; };

  it('chấp nhận cấu hình hợp lệ và cấu hình rỗng', () => {
    expect(err(cfg({ models: { evaluate: 'm' }, reasoning: { evaluate: 'high' }, prompts: { dossier_summary: 'p {{dossier}} {{output_schema}}' } }))).toBeNull();
    expect(err({ products: {} })).toBeNull();
  });

  it.each([
    ['không phải object', 'x', /phải là object/],
    ['key lạ ở gốc', { products: {}, foo: 1 }, /key lạ/],
    ['sản phẩm chưa khai báo', cfg({}, 'khong-co'), /chưa khai báo/],
    ['key lạ trong sản phẩm', cfg({ foo: 1 }), /key lạ/],
    ['step không tồn tại', cfg({ models: { buoc_la: 'm' } }), /không tồn tại/],
    ['ghi đè prompt của bước schema cố định', cfg({ prompts: { classify: 'p' } }), /không ghi đè được/],
    ['reasoning sai', cfg({ reasoning: { evaluate: 'cực cao' } }), /minimal, low, medium hoặc high/],
    ['model rỗng', cfg({ models: { evaluate: '  ' } }), /không rỗng/],
    ['ngưỡng ngoài khoảng', cfg({ policy: { minimum_dscr: 99 } }), /minimum_dscr/],
    ['rule LLM thiếu prompt', cfg({ checks: { checks: [{ id: 'LOAN.CUSTOM.X', kind: 'PROMPT' }] } }), /phải có prompt/],
    ['override checklist mục lạ', cfg({ checklist: { muc_moi: { FULL: 'REQUIRED' } } }), /không tạo được mục mới/],
    ['luồng không thuộc sản phẩm', cfg({ flows: { FLOW_ZZZ: { checks: {} } } }), /không thuộc chương trình/],
    ['công tắc luồng không phải boolean', cfg({ flows: { FULL: { checks: { 'LOAN.CAPACITY.MIN_DSCR': 'tắt' } } } }), /boolean/],
  ])('từ chối: %s', (_name, value, pattern) => {
    expect(err(value)).toMatch(pattern as RegExp);
  });
});

describe('migrateLegacyForProduct', () => {
  const legacy = {
    _workflowPrompts: { value: { policy_checks: 'p', dossier_summary: 'bước đã gỡ (D-99)', intake_review: 'đã bỏ', extract: 'bỏ' } },
    _workflowModels: { value: { evaluate: 'm' } },
    _workflowReasoningEfforts: { value: { evaluate: 'low' } },
    loan_policy: { value: { minimum_dscr: 1.3 } },
    loan_check_set: { value: { program: 'x', version: '1', checks: [
      { id: 'LOAN.CAPACITY.MIN_DSCR', enabled: true, flows: ['FULL'], products: [] },
      { id: 'LOAN.COLLATERAL.MAX_LTV', enabled: true, flows: ['FULL', 'FAST', 'SIMPLE'], products: ['sme'] },
    ] } },
    loan_checklist_overrides: { value: { programs: { hkd_secured: { legal_qr_code_info: { FAST: 'NOT_REQUIRED' } } } } },
  };

  it('gom prompt/model/reasoning/policy, chuyển tag luồng/sản phẩm thành công tắc theo luồng', () => {
    const out = migrateLegacyForProduct(legacy, 'hkd-loan');
    expect(out.prompts).toEqual({ policy_checks: 'p' });
    expect(out.models).toEqual({ evaluate: 'm' });
    expect(out.reasoning).toEqual({ evaluate: 'low' });
    expect(out.policy).toEqual({ minimum_dscr: 1.3 });
    expect(out.checklist).toEqual({ legal_qr_code_info: { FAST: 'NOT_REQUIRED' } });
    // MIN_DSCR chỉ ở FULL → tắt ở FAST/SIMPLE; MAX_LTV giới hạn sản phẩm sme → tắt mọi luồng của hkd-loan.
    expect(out.flows?.FAST?.checks).toEqual({ 'LOAN.CAPACITY.MIN_DSCR': false, 'LOAN.COLLATERAL.MAX_LTV': false });
    expect(out.flows?.FULL?.checks).toEqual({ 'LOAN.COLLATERAL.MAX_LTV': false });
    for (const check of (out.checks as { checks: Array<Record<string, unknown>> }).checks) {
      expect(check).not.toHaveProperty('flows');
      expect(check).not.toHaveProperty('products');
    }
  });

  it('kết quả migrate tự qua validate', () => {
    expect(validateLoanProductConfig({ products: { 'hkd-loan': migrateLegacyForProduct(legacy, 'hkd-loan') } })).toEqual({ ok: true });
  });

  it('Profile không có cấu hình cũ → cấu hình rỗng', () => {
    expect(migrateLegacyForProduct({}, 'hkd-loan')).toEqual({});
  });
});

describe('summarizeLoanProductConfigChange', () => {
  it('chỉ ghi tên sản phẩm + nhóm đã đổi, không lộ nội dung prompt', () => {
    const before = cfg({ models: { evaluate: 'a' } });
    const after = cfg({ models: { evaluate: 'b' }, prompts: { dossier_summary: 'BÍ MẬT' } });
    const summary = summarizeLoanProductConfigChange(before, after) ?? '';
    expect(summary).toContain('hkd-loan: prompts, models');
    expect(summary).not.toContain('BÍ MẬT');
    expect(summarizeLoanProductConfigChange(before, before)).toBeNull();
  });
});
