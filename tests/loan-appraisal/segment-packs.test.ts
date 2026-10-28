// D-100 — Segment Pack: registry theo phân khúc, kiểm tra khi khởi động, pack HKD giữ nguyên hành vi.
import { parseLoanProducts, loadLoanProducts } from '@/lib/loan-dossier/catalog/products';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import { defaultCheckSet } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { financialInputsFromProfile } from '@/lib/pipelines/workflows/loan-appraisal/financial-inputs';
import { resolveLoanProductPolicy } from '@/lib/pipelines/workflows/loan-appraisal/product-policy';
import { HKD_SECURED_PACK } from '@/lib/pipelines/workflows/loan-appraisal/segment-packs/hkd-secured';
import { packForProduct, validateSegmentPackRegistry } from '@/lib/pipelines/workflows/loan-appraisal/segment-packs/registry';
import { HkdSecuredFinancialStrategy, PolicyStrategy, RecommendationStrategy } from '@/lib/pipelines/workflows/loan-appraisal/strategies';

import { ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';
import { profileOf } from '../loan-dossier/fixtures/profile';

const catalogWith = (segment: string) => {
  const base = loadLoanProducts();
  return parseLoanProducts({ ...base, products: [...base.products, { ...base.products[0], product_code: 'test-corp', segment }] });
};

describe('registry', () => {
  it('danh mục sản phẩm hiện tại hợp lệ: mọi sản phẩm có pack', () => {
    expect(validateSegmentPackRegistry()).toEqual([]);
  });

  it('hkd-loan → hkd-secured, snapshot ghi pack + phân khúc', () => {
    expect(packForProduct('hkd-loan').snapshot).toEqual({ pack_id: 'hkd-secured', pack_version: HKD_SECURED_PACK.pack_version, segment: 'HKD' });
  });

  it('sme vẫn chạy pack HKD (hành vi hiện tại, ghi tường minh) — snapshot cho thấy điều đó', () => {
    expect(packForProduct('sme').snapshot).toEqual({ pack_id: 'hkd-secured', pack_version: HKD_SECURED_PACK.pack_version, segment: 'SME' });
  });

  it('sản phẩm thuộc phân khúc chưa có pack → validate báo lỗi, packForProduct ném lỗi (không có pack mặc định)', () => {
    const catalog = catalogWith('CORPORATE');
    expect(validateSegmentPackRegistry(catalog)).toEqual([expect.stringContaining('"test-corp" (phân khúc CORPORATE)')]);
    expect(() => packForProduct('test-corp', catalog)).toThrow(/CORPORATE/);
  });

  it('mã sản phẩm lạ → INVALID_INPUT', () => {
    expect(() => packForProduct('khong-ton-tai')).toThrow(/INVALID_INPUT/);
  });
});

describe('pack HKD giữ nguyên hành vi của strategy cũ', () => {
  const evs = [
    loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]),
    ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] }),
  ];
  const s3 = runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-01' }).data;
  const policy = resolveLoanProductPolicy('hkd-loan', {});
  const checkSet = defaultCheckSet('FULL', 'hkd-loan');

  it.each([['có S3', s3], ['S3 lỗi', null]] as const)('stage 2–4 cho kết quả giống hệt gọi strategy trực tiếp (%s)', (_label, map) => {
    const profile = profileOf(evs, { s3: map });
    const financial = HKD_SECURED_PACK.calculateFinancials({ profile, s3Available: map !== null });
    expect(financial).toEqual(new HkdSecuredFinancialStrategy().execute({ inputs: financialInputsFromProfile(profile), skipCollateral: map === null }));

    const compliance = HKD_SECURED_PACK.evaluatePolicy({ policy, checkSet, financial, promptResults: [] });
    expect(compliance).toEqual(new PolicyStrategy(policy, checkSet).execute({ facts: { financial }, promptResults: [] }));

    expect(HKD_SECURED_PACK.recommend({ policy, financial, compliance }))
      .toEqual(new RecommendationStrategy(policy).execute({ financial, policy: compliance }));
  });
});
