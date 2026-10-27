import {
  DEFAULT_CHECK_SET,
  LOAN_CHECK_CATALOG,
  checkAppliesTo,
  defaultCheckSet,
  LEGACY_CHECK_ID_ALIASES,
  RETIRED_CHECK_IDS,
  canonicalCheckId,
  parseCheckSet,
  summarizeCheckSetChange,
  validateCheckSetValue,
} from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { snapshotPolicy, resolveLoanProductPolicy } from '@/lib/pipelines/workflows/loan-appraisal/product-policy';

const catalogCheck = (id: string) => {
  const found = LOAN_CHECK_CATALOG.find((check) => check.id === id);
  if (!found) throw new Error(`missing ${id}`);
  const { flows: _flows, products: _products, ...rest } = found;
  return rest;
};

describe('loan check-set scope', () => {
  it('checkAppliesTo: rỗng = mọi luồng/sản phẩm', () => {
    expect(checkAppliesTo({ flows: [], products: [] }, 'FAST', 'hkd-loan')).toBe(true);
    expect(checkAppliesTo({ flows: ['FULL'], products: [] }, 'FAST', 'hkd-loan')).toBe(false);
    expect(checkAppliesTo({ flows: ['FAST'], products: ['other'] }, 'FAST', 'hkd-loan')).toBe(false);
    expect(checkAppliesTo({ flows: ['FAST'], products: ['hkd-loan'] }, 'FAST', 'hkd-loan')).toBe(true);
  });

  it('bộ mặc định giữ nguyên toàn bộ catalog cho mọi luồng (tương thích ngược)', () => {
    for (const flow of ['FULL', 'FAST', 'SIMPLE'] as const) {
      const set = defaultCheckSet(flow, 'hkd-loan');
      expect(set.checks.map((check) => check.id)).toEqual(LOAN_CHECK_CATALOG.map((check) => check.id));
      expect(set.flow).toBe(flow);
      expect(set.program).toBe('loan-secured');
    }
    expect(DEFAULT_CHECK_SET.flow).toBe('FULL');
  });

  it('cấu hình cũ không có flows/products vẫn chạy đủ rule ở mọi luồng', () => {
    const raw = { checks: [catalogCheck('LOAN.CAPACITY.MIN_DSCR'), catalogCheck('LOAN.PURPOSE.COHERENCE')] };
    const { checkSet, warnings } = parseCheckSet(raw, 'SIMPLE', 'hkd-loan');
    expect(warnings).toEqual([]);
    expect(checkSet.source).toBe('PROFILE');
    expect(checkSet.checks.map((check) => check.id)).toEqual(['LOAN.CAPACITY.MIN_DSCR', 'LOAN.PURPOSE.COHERENCE']);
    expect(checkSet.checks[0].flows).toEqual(['FULL', 'FAST', 'SIMPLE', 'FLOW_A']);
  });

  it('bỏ mục không áp cho luồng đang chạy', () => {
    const raw = {
      checks: [
        { ...catalogCheck('LOAN.CAPACITY.MIN_DSCR'), flows: ['FULL'] },
        { ...catalogCheck('LOAN.PURPOSE.COHERENCE'), flows: ['full', 'FAST'] },
      ],
    };
    expect(parseCheckSet(raw, 'FAST', 'hkd-loan').checkSet.checks.map((check) => check.id)).toEqual(['LOAN.PURPOSE.COHERENCE']);
    expect(parseCheckSet(raw, 'FULL', 'hkd-loan').checkSet.checks.map((check) => check.id))
      .toEqual(['LOAN.CAPACITY.MIN_DSCR', 'LOAN.PURPOSE.COHERENCE']);
  });

  it('không còn mục nào trong phạm vi ⇒ fallback bộ mặc định của luồng, kèm cảnh báo', () => {
    const raw = { checks: [{ ...catalogCheck('LOAN.CAPACITY.MIN_DSCR'), flows: ['FULL'] }] };
    const { checkSet, warnings } = parseCheckSet(raw, 'SIMPLE', 'hkd-loan');
    expect(checkSet.source).toBe('DEFAULT');
    expect(checkSet.flow).toBe('SIMPLE');
    expect(warnings.join(' ')).toMatch(/luồng SIMPLE/);
  });

  it('snapshot ghi lại luồng của bộ kiểm tra', () => {
    const { checkSet } = parseCheckSet(undefined, 'FAST', 'hkd-loan');
    const snapshot = snapshotPolicy(resolveLoanProductPolicy('hkd-loan'), checkSet);
    expect(snapshot.check_set?.flow).toBe('FAST');
  });
});

describe('validateCheckSetValue — phạm vi', () => {
  const base = catalogCheck('LOAN.CAPACITY.MIN_DSCR');

  it('nhận flows/products hợp lệ', () => {
    expect(validateCheckSetValue({ checks: [{ ...base, flows: ['FULL', 'fast'], products: ['hkd-loan'] }] })).toEqual({ ok: true });
    expect(validateCheckSetValue({ checks: [{ ...base, products: [] }] })).toEqual({ ok: true });
  });

  it('từ chối flows rỗng, luồng lạ hoặc sản phẩm không tồn tại', () => {
    expect(validateCheckSetValue({ checks: [{ ...base, flows: [] }] }).ok).toBe(false);
    expect(validateCheckSetValue({ checks: [{ ...base, flows: ['EXPRESS'] }] }).ok).toBe(false);
    expect(validateCheckSetValue({ checks: [{ ...base, flows: 'FULL' }] }).ok).toBe(false);
    expect(validateCheckSetValue({ checks: [{ ...base, products: ['hkd-lona'] }] }).ok).toBe(false);
  });

  it('audit ghi nhận thay đổi phạm vi', () => {
    const summary = summarizeCheckSetChange(
      { checks: [base] },
      { checks: [{ ...base, flows: ['FULL'] }] },
    );
    expect(summary).toContain('LOAN.CAPACITY.MIN_DSCR[flows]');
  });
});

describe('parseCheckSet — input', () => {
  it('Profile cũ lưu input hẹp vẫn nhận nguồn hiện hành của catalog', () => {
    const stale = { ...catalogCheck('LOAN.CONSISTENCY.BORROWER_IDENTITY'), input: ['evidence.id_card'] };
    const { checkSet } = parseCheckSet({ checks: [stale] }, 'FULL', 'hkd-loan');
    expect(checkSet.checks[0].input).toEqual(expect.arrayContaining(['evidence.id_card', 'evidence.household_business_license', 'evidence.enterprise_registration_license', 'evidence.loan_application']));
  });
});
describe('rule chung LOAN.* và tương thích id cũ HKD.*', () => {
  it('catalog không còn id gắn tên sản phẩm; mọi rule áp cho mọi sản phẩm (products rỗng) và rule engine dùng id LOAN.*', () => {
    expect(LOAN_CHECK_CATALOG.every((check) => check.id.startsWith('LOAN.'))).toBe(true);
    expect(LOAN_CHECK_CATALOG.every((check) => check.products.length === 0)).toBe(true);
  });

  it('bảng alias đủ: mỗi id chuẩn trong catalog có đúng một id cũ HKD.* trỏ tới nó', () => {
    // Bảng alias chỉ thêm, không bỏ: rule đã gỡ khỏi catalog (RETIRED_CHECK_IDS) vẫn giữ alias để cấu hình đã lưu còn được nhận ra rồi bỏ êm.
    const targets = Object.values(LEGACY_CHECK_ID_ALIASES).sort();
    expect(targets).toEqual([...LOAN_CHECK_CATALOG.map((check) => check.id), ...RETIRED_CHECK_IDS].sort());
    for (const legacy of Object.keys(LEGACY_CHECK_ID_ALIASES)) expect(legacy.startsWith('HKD.')).toBe(true);
    expect(canonicalCheckId('HKD.CAPACITY.MIN_DSCR')).toBe('LOAN.CAPACITY.MIN_DSCR');
    expect(canonicalCheckId('LOAN.CAPACITY.MIN_DSCR')).toBe('LOAN.CAPACITY.MIN_DSCR');
    expect(canonicalCheckId('CUSTOM.X')).toBe('CUSTOM.X');
  });

  it('Profile đã lưu id cũ HKD.*: vẫn chạy, rule engine giữ DETERMINISTIC và tham số riêng, không phát cảnh báo', () => {
    const raw = { checks: [
      { id: 'HKD.CAPACITY.MIN_DSCR', enabled: true, params: { minimum: 1.4 } },
      { id: 'HKD.PURPOSE.COHERENCE', enabled: true },
    ] };
    const { checkSet, warnings } = parseCheckSet(raw, 'FULL', 'hkd-loan');
    expect(warnings).toEqual([]);
    expect(checkSet.checks.map((check) => check.id)).toEqual(['LOAN.CAPACITY.MIN_DSCR', 'LOAN.PURPOSE.COHERENCE']);
    expect(checkSet.checks[0]).toMatchObject({ kind: 'DETERMINISTIC', params: { minimum: 1.4 } });
    expect(checkSet.checks[1].kind).toBe('PROMPT');
  });

  it('cùng một rule khai báo cả id cũ và id mới bị coi là trùng (cả runtime lẫn khi lưu)', () => {
    const raw = { checks: [{ id: 'HKD.CAPACITY.MIN_DSCR' }, { id: 'LOAN.CAPACITY.MIN_DSCR' }] };
    expect(parseCheckSet(raw, 'FULL', 'hkd-loan').warnings.join(' ')).toMatch(/trùng id/);
    expect(validateCheckSetValue({ checks: [{ ...catalogCheck('LOAN.CAPACITY.MIN_DSCR') }, { ...catalogCheck('LOAN.CAPACITY.MIN_DSCR'), id: 'HKD.CAPACITY.MIN_DSCR' }] }).ok).toBe(false);
  });

  it('đường lưu nhận id cũ HKD.* của rule engine (không bị coi là rule engine không có cài đặt)', () => {
    const legacy = { ...catalogCheck('LOAN.CAPACITY.MIN_DSCR'), id: 'HKD.CAPACITY.MIN_DSCR' };
    expect(validateCheckSetValue({ checks: [legacy] })).toEqual({ ok: true });
  });

  it('cùng bộ rule chạy cho sản phẩm sme; ngưỡng riêng theo sản phẩm lấy từ policy khi rule không khai tham số', () => {
    const set = defaultCheckSet('FLOW_A', 'sme');
    expect(set.checks.map((check) => check.id)).toEqual(LOAN_CHECK_CATALOG.map((check) => check.id));
    expect(resolveLoanProductPolicy('sme').policyId).toBe('PP-SME-SECURED');
    expect(resolveLoanProductPolicy('hkd-loan').policyId).toBe('PP-HKD-SECURED');
  });
});
