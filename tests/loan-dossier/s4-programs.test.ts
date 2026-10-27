// S4-R24 / S4-R25 (D-37) — chương trình checklist theo sản phẩm, luồng do chương trình khai báo, ghi đè từ Profile.
import { CheckChecklistStageResultSchema } from '@/lib/loan-dossier/contracts/check-stages';
import { loadChecklistCatalog } from '@/lib/loan-dossier/s4/catalog';
import {
  allFlowKeys, defaultFlow, loadChecklistPrograms, parseChecklistOverrides, parseChecklistPrograms, programFlowKeys,
  programForProduct, resolveChecklist, validateChecklistOverrides, type ChecklistProgramsCatalog,
} from '@/lib/loan-dossier/s4/programs';
import { runChecklist } from '@/lib/loan-dossier/s4/run';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { LOAN_FLOWS, resolveLoanFlow } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { listLoanProductPolicies } from '@/lib/pipelines/workflows/loan-appraisal/product-policy';
import { listLoanProductConfigs, parseLoanProducts, loadLoanProducts, validateProductsAgainstPrograms } from '@/lib/loan-dossier/catalog/products';
import { getLoanProduct } from '@/lib/pipelines/workflows/prompts/loan-appraisal-prompts';
import { resolveLoanProductPolicy } from '@/lib/pipelines/workflows/loan-appraisal/product-policy';
import { LOAN_PRODUCTS } from '@/lib/pipelines/workflows/prompts/loan-appraisal-prompts';

import { classifyOf, ID_A12, loanApp } from './fixtures/dossier';

const D0 = '2026-10-14';
const now = () => new Date('2026-10-14T03:00:00.000Z');
const HKD = () => programForProduct('hkd-loan')!;

/** Catalog thật + 1 chương trình thử nghiệm luồng A/B (không có trong catalog thật). */
function withSme(): ChecklistProgramsCatalog {
  const real = loadChecklistPrograms();
  return parseChecklistPrograms({
    ...real,
    programs: [...real.programs, {
      program_key: 'sme_test',
      program_label: 'SME thử nghiệm',
      product_codes: ['sme-test-a', 'sme-test-b'],
      flows: [{ flow_key: 'A', flow_label: 'Luồng A' }, { flow_key: 'B', flow_label: 'Luồng B' }],
      requirements: {
        legal_id_card: { A: 'REQUIRED', B: 'REQUIRED' },
        credit_cic_report: { A: 'REQUIRED', B: null },
      },
    }],
  });
}

async function run(o: { flow: unknown; product_code: unknown; programs?: ChecklistProgramsCatalog; overrides?: unknown }) {
  const evidences: EvidenceEnvelope[] = [loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }])];
  const s3 = runMapDossier({ evidences, dossier_submitted_at: D0, now });
  const overrides = o.overrides === undefined ? null : parseChecklistOverrides(o.overrides, o.programs).overrides;
  return runChecklist({
    flow: o.flow, product_code: o.product_code, programs: o.programs, checklist_overrides: overrides,
    dossier_submitted_at: D0, external_input: null, classify: classifyOf(evidences), evidences,
    s3: { status: s3.status, data: s3.data }, now,
  }, { llm: null });
}

describe('checklist_programs.json (S4-R24)', () => {
  it('HKD: chương trình hkd_secured cho hkd-loan, luồng FULL/FAST/SIMPLE, mặc định FULL, 43 mục (D-52 bỏ 3 mục theo spec BU)', () => {
    const p = HKD();
    expect(p.program_key).toBe('hkd_secured');
    expect(programFlowKeys(p)).toEqual(['FULL', 'FAST', 'SIMPLE']);
    expect(defaultFlow(p)).toBe('FULL');
    expect(Object.keys(p.requirements)).toHaveLength(loadChecklistCatalog().items.length - 3);
    for (const k of ['loan_plan_exception_approval_memo', 'credit_other_institution_contract', 'collateral_cic_check']) expect(p.requirements).not.toHaveProperty(k);
  });

  it('số mục theo luồng (hồi quy; D-52 bỏ tờ trình ngoại lệ, HĐTD TCTD khác, CIC TSBĐ; D-54 QR không bắt buộc)', () => {
    const count = (flow: string) => {
      const rows = resolveChecklist(HKD(), flow).rows;
      return { rows: rows.length, REQUIRED: rows.filter((r) => r.requirement === 'REQUIRED').length, CONDITIONAL: rows.filter((r) => r.requirement === 'CONDITIONAL').length };
    };
    expect(count('FULL')).toEqual({ rows: 43, REQUIRED: 7, CONDITIONAL: 29 });
    expect(count('FAST')).toEqual({ rows: 23, REQUIRED: 8, CONDITIONAL: 10 });
    expect(count('SIMPLE')).toEqual({ rows: 37, REQUIRED: 7, CONDITIONAL: 23 });
  });

  it('D-54: QR CCCD không bắt buộc ở cả 3 luồng — hồ sơ không có QR không bị báo thiếu', async () => {
    for (const flow of ['FULL', 'FAST', 'SIMPLE']) {
      const r = await run({ flow, product_code: 'hkd-loan' });
      const qr = r.data!.items.filter((i) => i.item_key === 'legal_qr_code_info');
      expect(qr.length).toBeGreaterThan(0);
      expect(qr.every((i) => !i.required && i.status === 'NOT_APPLICABLE')).toBe(true);
    }
  });

  it('mọi sản phẩm vay trong code đều có policy và chương trình checklist', () => {
    const policies = new Set(listLoanProductPolicies().map((p) => p.productCode));
    for (const code of Object.keys(LOAN_PRODUCTS)) {
      expect({ code, policy: policies.has(code), program: !!programForProduct(code) }).toEqual({ code, policy: true, program: true });
    }
  });

  it('catalog sai bị từ chối: 1 sản phẩm 2 chương trình, thiếu luồng, CONDITIONAL không có điều kiện, mục lạ', () => {
    const real = loadChecklistPrograms();
    const prog = (o: object) => ({ program_key: 'x', program_label: 'X', product_codes: ['x'], flows: [{ flow_key: 'A', flow_label: 'A' }], requirements: {}, ...o });
    const bad = (p: object) => () => parseChecklistPrograms({ ...real, programs: [...real.programs, prog(p)] });
    expect(bad({ product_codes: ['hkd-loan'] })).toThrow('hkd-loan đã thuộc hkd_secured');
    expect(bad({ requirements: { legal_id_card: {} } })).toThrow('phải khai đúng các luồng');
    expect(bad({ requirements: { legal_id_card: { A: 'CONDITIONAL' } } })).toThrow('CONDITIONAL cần item có condition_id');
    expect(bad({ requirements: { khong_co: { A: 'REQUIRED' } } })).toThrow('item_key lạ');
    expect(bad({ flows: [{ flow_key: 'a', flow_label: 'a' }] })).toThrow();
  });

  it('rule check-set: LOAN_FLOWS = hợp luồng mọi chương trình; resolveLoanFlow lạ → luồng mặc định của chương trình', () => {
    expect(LOAN_FLOWS).toEqual(['FULL', 'FAST', 'SIMPLE', 'FLOW_A']);
    expect(allFlowKeys(withSme())).toEqual(['FULL', 'FAST', 'SIMPLE', 'FLOW_A', 'A', 'B']);
    expect(resolveLoanFlow({ flow: 'fast' }, 'hkd-loan')).toBe('FAST');
    expect(resolveLoanFlow({ flow: 'FLOW_A' }, 'hkd-loan')).toBe('FULL');
    expect(resolveLoanFlow({ flow: 'flow_a' }, 'sme')).toBe('FLOW_A');
    expect(resolveLoanFlow({ flow: 'FULL' }, 'sme')).toBe('FLOW_A');
    expect(resolveLoanFlow({}, 'hkd-loan')).toBe('FULL');
  });
});

describe('runChecklist theo chương trình', () => {
  it('HKD: output ghi program_key, product_code, không có ghi đè', async () => {
    const r = await run({ flow: 'FAST', product_code: 'hkd-loan' });
    expect(CheckChecklistStageResultSchema.safeParse(r).success).toBe(true);
    expect(r.data).toMatchObject({ flow: 'FAST', program_key: 'hkd_secured', product_code: 'hkd-loan', overrides_applied: [] });
  });

  it('chương trình A/B: nhiều sản phẩm dùng chung; chỉ sinh dòng mục khai trong chương trình; null → bỏ ở luồng đó', async () => {
    const programs = withSme();
    const a = await run({ flow: 'A', product_code: 'sme-test-b', programs });
    expect(CheckChecklistStageResultSchema.safeParse(a).success).toBe(true);
    expect(a.data).toMatchObject({ flow: 'A', program_key: 'sme_test', product_code: 'sme-test-b' });
    expect([...new Set(a.data!.items.map((i) => i.item_key))].sort()).toEqual(['credit_cic_report', 'legal_id_card']);
    const b = await run({ flow: 'B', product_code: 'sme-test-a', programs });
    expect([...new Set(b.data!.items.map((i) => i.item_key))]).toEqual(['legal_id_card']);
  });

  it('luồng không thuộc chương trình → INVALID_FLOW; sản phẩm không có chương trình → UNKNOWN_CHECKLIST_PROGRAM', async () => {
    const programs = withSme();
    const r1 = await run({ flow: 'FULL', product_code: 'sme-test-a', programs });
    expect([r1.status, r1.status_code, r1.message]).toEqual(['FAILED', 'INVALID_FLOW', 'Thiếu hoặc sai luồng hồ sơ (A/B).']);
    const r2 = await run({ flow: 'A', product_code: 'khong-co', programs });
    expect([r2.status, r2.status_code, r2.data]).toEqual(['FAILED', 'UNKNOWN_CHECKLIST_PROGRAM', null]);
    expect((await run({ flow: 'FULL', product_code: undefined })).status_code).toBe('UNKNOWN_CHECKLIST_PROGRAM');
  });
});

describe('ghi đè từ Profile (S4-R25)', () => {
  const valid = {
    programs: {
      hkd_secured: {
        legal_vneid: { FAST: 'NOT_REQUIRED' },
        credit_cic_report: { FAST: null },
        income_salary_labor_contract: { FAST: 'REQUIRED' },
      },
    },
  };

  it('đổi mức, bỏ mục (null), đưa mục có sẵn vào luồng; overrides_applied ghi from → to', async () => {
    expect(validateChecklistOverrides(valid)).toEqual({ ok: true });
    const base = resolveChecklist(HKD(), 'FAST');
    const r = await run({ flow: 'FAST', product_code: 'hkd-loan', overrides: valid });
    expect(CheckChecklistStageResultSchema.safeParse(r).success).toBe(true);
    const keys = new Set(r.data!.items.map((i) => i.item_key));
    expect(keys.has('credit_cic_report')).toBe(false);
    expect(keys.has('income_salary_labor_contract')).toBe(true);
    expect(r.data!.items.filter((i) => i.item_key === 'legal_vneid').every((i) => !i.required)).toBe(true);
    const fromOf = (k: string) => base.rows.find((x) => x.item.item_key === k)?.requirement ?? null;
    expect(r.data!.overrides_applied).toEqual([
      { item_key: 'legal_vneid', flow: 'FAST', from: fromOf('legal_vneid'), to: 'NOT_REQUIRED' },
      { item_key: 'income_salary_labor_contract', flow: 'FAST', from: null, to: 'REQUIRED' },
      { item_key: 'credit_cic_report', flow: 'FAST', from: fromOf('credit_cic_report'), to: null },
    ].sort((x, y) => loadChecklistCatalog().items.findIndex((i) => i.item_key === x.item_key) - loadChecklistCatalog().items.findIndex((i) => i.item_key === y.item_key)));
  });

  it('ghi đè chỉ áp cho luồng đã nêu, luồng khác giữ nguyên', () => {
    const { overrides } = parseChecklistOverrides(valid);
    const full = resolveChecklist(HKD(), 'FULL', overrides);
    expect(full.overrides_applied).toEqual([]);
    expect(full.rows).toEqual(resolveChecklist(HKD(), 'FULL').rows);
  });

  it('đường ghi fail-closed: chương trình/mục/luồng lạ, giá trị lạ, CONDITIONAL không có điều kiện', () => {
    const err = (v: unknown) => { const r = validateChecklistOverrides(v); return r.ok ? null : r.error; };
    expect(err([])).toBe('loan_checklist_overrides phải là object.');
    expect(err({ programs: { khong_co: {} } })).toContain('Chương trình "khong_co"');
    expect(err({ programs: { hkd_secured: { muc_moi: { FULL: 'REQUIRED' } } } })).toContain('không tạo được mục mới');
    expect(err({ programs: { hkd_secured: { legal_id_card: { A: 'REQUIRED' } } } })).toContain('luồng không thuộc chương trình');
    expect(err({ programs: { hkd_secured: { legal_id_card: { FULL: 'BAT_BUOC' } } } })).toContain('giá trị phải là');
    expect(err({ programs: { hkd_secured: { legal_id_card: { FULL: 'CONDITIONAL' } } } })).toContain('không đặt CONDITIONAL');
    expect(err({ programs: {}, extra: 1 })).toContain('key lạ extra');
  });

  it('đường chạy khoan dung: bỏ mục sai + warning, giữ mục đúng; chuỗi JSON cũng nhận', () => {
    const mixed = { programs: { hkd_secured: { legal_id_card: { FULL: 'BAT_BUOC' }, legal_vneid: { FAST: 'NOT_REQUIRED' } } } };
    const r = parseChecklistOverrides(JSON.stringify(mixed));
    expect(r.overrides).toEqual({ hkd_secured: { legal_vneid: { FAST: 'NOT_REQUIRED' } } });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('Bỏ qua mục này');
    expect(parseChecklistOverrides('{oops').warnings[0]).toContain('không phải JSON');
    expect(parseChecklistOverrides(undefined)).toEqual({ overrides: {}, warnings: [] });
  });
});
describe('danh mục sản phẩm cấu hình được (loan_products.json) và chương trình SME / FLOW_A', () => {
  it('mỗi sản phẩm có đúng một chương trình và ngược lại (kiểm chéo)', () => {
    expect(validateProductsAgainstPrograms(listLoanProductConfigs(), loadChecklistPrograms().programs)).toEqual([]);
  });

  it('kiểm chéo bắt thiếu chương trình, sản phẩm thuộc nhiều chương trình, chương trình trỏ sản phẩm chưa khai', () => {
    const programs = [{ program_key: 'p1', product_codes: ['a'] }, { program_key: 'p2', product_codes: ['a', 'zzz'] }];
    const problems = validateProductsAgainstPrograms([{ product_code: 'a' }, { product_code: 'b' }], programs);
    expect(problems.join('\n')).toMatch(/b chưa có chương trình/);
    expect(problems.join('\n')).toMatch(/a thuộc nhiều chương trình: p1, p2/);
    expect(problems.join('\n')).toMatch(/p2 tham chiếu product_code zzz/);
  });

  it('getLoanProduct và resolveLoanProductPolicy đọc từ catalog: hkd-loan, sme; mã lạ vẫn bị từ chối; không truyền mã → sản phẩm mặc định', () => {
    expect(getLoanProduct('sme').name).toMatch(/SME/);
    expect(getLoanProduct(undefined).code).toBe(loadLoanProducts().default_product_code);
    expect(() => getLoanProduct('khong-co')).toThrow('INVALID_INPUT');
    expect(resolveLoanProductPolicy('sme')).toMatchObject({ productCode: 'sme', policyId: 'PP-SME-SECURED', thresholdSource: 'DEFAULT' });
    expect(resolveLoanProductPolicy('hkd-loan')).toMatchObject({ minimumDscr: 1.25, maximumLtv: 0.7, maximumAmountVnd: 3_000_000_000 });
    expect(() => resolveLoanProductPolicy('khong-co')).toThrow('INVALID_INPUT');
  });

  it('ngưỡng ghi đè của Profile áp lên đúng sản phẩm và đánh dấu nguồn PROFILE', () => {
    expect(resolveLoanProductPolicy('sme', { minimumDscr: 1.5 })).toMatchObject({ minimumDscr: 1.5, maximumLtv: 0.7, thresholdSource: 'PROFILE' });
  });

  it('catalog sản phẩm sai bị từ chối: trùng mã, mã mặc định không tồn tại, ngưỡng ngoài khoảng, mã sai định dạng', () => {
    const real = loadLoanProducts();
    const sample = real.products[0];
    expect(() => parseLoanProducts({ ...real, products: [sample, sample] })).toThrow('trùng');
    expect(() => parseLoanProducts({ ...real, default_product_code: 'khong-co' })).toThrow('không có trong products');
    expect(() => parseLoanProducts({ ...real, products: [{ ...sample, policy: { ...sample.policy, maximum_ltv: 5 } }] })).toThrow();
    expect(() => parseLoanProducts({ ...real, products: [{ ...sample, product_code: 'SME_Loan' }] })).toThrow();
  });

  it('SME dùng luồng FLOW_A (mặc định duy nhất); FULL/FAST/SIMPLE không hợp lệ với SME', () => {
    const sme = programForProduct('sme')!;
    expect(sme.program_key).toBe('sme_secured');
    expect(programFlowKeys(sme)).toEqual(['FLOW_A']);
    expect(defaultFlow(sme)).toBe('FLOW_A');
    expect(Object.keys(sme.requirements)).toHaveLength(loadChecklistCatalog().items.length);
  });

  it('SME FLOW_A: có dòng checklist; runChecklist chạy được với sản phẩm sme, và luồng của HKD bị INVALID_FLOW', async () => {
    expect(resolveChecklist(programForProduct('sme')!, 'FLOW_A').rows.length).toBeGreaterThan(0);
    const ok = await run({ flow: 'FLOW_A', product_code: 'sme' });
    expect(CheckChecklistStageResultSchema.safeParse(ok).success).toBe(true);
    expect(ok.data).toMatchObject({ flow: 'FLOW_A', program_key: 'sme_secured', product_code: 'sme' });
    const bad = await run({ flow: 'FULL', product_code: 'sme' });
    expect([bad.status, bad.status_code]).toEqual(['FAILED', 'INVALID_FLOW']);
    const crossed = await run({ flow: 'FLOW_A', product_code: 'hkd-loan' });
    expect([crossed.status, crossed.status_code]).toEqual(['FAILED', 'INVALID_FLOW']);
  });

  it('chương trình HKD không bị đổi bởi việc thêm SME (hồi quy 43 mục FULL)', () => {
    expect(resolveChecklist(HKD(), 'FULL').rows).toHaveLength(43);
  });
});
