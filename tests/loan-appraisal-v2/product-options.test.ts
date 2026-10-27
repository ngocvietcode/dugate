// UI chọn sản phẩm + luồng theo sản phẩm (product-options.ts) — hàm thuần, dữ liệu giả cho trường hợp biên.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CaseSetupPanel } from '@/components/loan-appraisal-v2/setup/CaseSetupPanel';
import { DEFAULT_PRODUCT_CODE, PRODUCT_OPTIONS, coerceFlow, defaultFlowFor, flowOptionsFor, productOptions } from '@/app/loan-appraisal-v2/lib/product-options';

const programs = { programs: [
  { product_codes: ['p1'], flows: [{ flow_key: 'FULL', flow_label: 'Đầy đủ' }, { flow_key: 'FAST', flow_label: 'Nhanh' }] },
  { product_codes: ['p2', 'p3'], flows: [{ flow_key: 'FLOW_A', flow_label: 'Luồng A' }] },
] };

describe('product-options', () => {
  it('liệt kê sản phẩm từ loan_products.json: có hkd-loan và sme; mặc định là hkd-loan', () => {
    expect(PRODUCT_OPTIONS.map((o) => o.value)).toEqual(expect.arrayContaining(['hkd-loan', 'sme']));
    expect(DEFAULT_PRODUCT_CODE).toBe('hkd-loan');
    expect(productOptions({ default_product_code: 'x', products: [{ product_code: 'x', name: 'X' }] })).toEqual([{ value: 'x', label: 'X' }]);
  });

  it('luồng theo sản phẩm: HKD có FULL/FAST/SIMPLE, SME chỉ có FLOW_A; sản phẩm lạ không có luồng', () => {
    expect(flowOptionsFor('hkd-loan').map((o) => o.value)).toEqual(['FULL', 'FAST', 'SIMPLE']);
    expect(flowOptionsFor('sme').map((o) => o.value)).toEqual(['FLOW_A']);
    expect(flowOptionsFor('khong-co')).toEqual([]);
    expect(defaultFlowFor('sme')).toBe('FLOW_A');
    expect(defaultFlowFor('khong-co')).toBeUndefined();
  });

  it('coerceFlow: giữ luồng còn hợp lệ, đổi sản phẩm thì về luồng đầu của sản phẩm mới', () => {
    expect(coerceFlow('p1', 'FAST', programs)).toBe('FAST');
    expect(coerceFlow('p2', 'FAST', programs)).toBe('FLOW_A');
    expect(coerceFlow('p1', undefined, programs)).toBe('FULL');
    expect(coerceFlow('khong-co', 'FULL', programs)).toBeUndefined();
  });
});

describe('CaseSetupPanel: chọn sản phẩm', () => {
  const props = (productCode: string, extra: object = {}) => ({
    phase: 'idle' as const, apiKey: '', onApiKey: () => undefined, productCode, productLocked: false, onProduct: () => undefined,
    flow: defaultFlowFor(productCode) ?? 'FULL', onFlow: () => undefined, customerName: '', customerLocked: false,
    onCustomerName: () => undefined, loanNeed: '', onLoanNeed: () => undefined, entries: [], onFiles: () => undefined, onRemove: () => undefined,
    onClear: () => undefined, onRun: () => undefined, onCancel: () => undefined, ...extra,
  });
  const html = (productCode: string, extra: object = {}) => renderToStaticMarkup(createElement(CaseSetupPanel, props(productCode, extra) as never));

  it('có ô chọn sản phẩm với đủ sản phẩm; luồng đổi theo sản phẩm đã chọn', () => {
    const hkd = html('hkd-loan');
    expect(hkd).toContain('la2-product');
    expect(hkd).toContain('Vay Doanh nghiệp vừa và nhỏ (SME)');
    expect(hkd).toContain('FULL: thẩm định đầy đủ');
    expect(hkd).not.toContain('FLOW_A: luồng A của SME');
    const sme = html('sme');
    expect(sme).toContain('FLOW_A: luồng A của SME');
    expect(sme).not.toContain('FULL: thẩm định đầy đủ');
  });

  it('ô chọn luồng chỉ khóa khi đang chạy; sau khi xong vẫn đổi được để chạy lại', () => {
    const openTag = (out: string) => out.match(/<select id="la2-flow"[^>]*>/)?.[0] ?? '';
    const isDisabled = (tag: string) => /\sdisabled(="")?[\s>]/.test(tag);
    expect(isDisabled(openTag(html('hkd-loan', { phase: 'succeeded' })))).toBe(false);
    expect(isDisabled(openTag(html('hkd-loan', { phase: 'paused' })))).toBe(false);
    expect(isDisabled(openTag(html('hkd-loan', { phase: 'failed' })))).toBe(false);
    expect(isDisabled(openTag(html('hkd-loan', { phase: 'running' })))).toBe(true);
    expect(html('hkd-loan', { phase: 'succeeded' })).toContain('Đổi luồng rồi bấm Chạy lại');
    expect(html('hkd-loan')).not.toContain('Đổi luồng rồi bấm Chạy lại');
  });

  it('khóa chọn sản phẩm khi hồ sơ đã có kết quả', () => {
    // Chỉ xét thẻ <select id="la2-product"> (không quét sang các nút khác có thuộc tính disabled).
    const openTag = (out: string) => out.match(/<select id="la2-product"[^>]*>/)?.[0] ?? '';
    // Thuộc tính disabled đứng riêng (không phải tiền tố CSS disabled:opacity-60 có trong class).
    const isDisabled = (tag: string) => /\sdisabled(="")?[\s>]/.test(tag);
    expect(isDisabled(openTag(html('sme', { productLocked: true })))).toBe(true);
    expect(isDisabled(openTag(html('sme')))).toBe(false);
  });
});
