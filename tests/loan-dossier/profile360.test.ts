// Hồ sơ 360 — nguồn sự thật duy nhất (D-110, D-114): HKD, luồng thu nhập, chính sách, vấn đề cần xử lý, số cho stage 2
// (loan_360.md AC-8…AC-12, AC-18).
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { parseMergePolicies } from '@/lib/loan-dossier/profile360/policies';
import { Profile360Schema } from '@/lib/loan-dossier/profile360/schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { financialInputsFromProfile } from '@/lib/pipelines/workflows/loan-appraisal/financial-inputs';

import { ev, ID_A12, ID_B12, ID_C12, loanApp } from './fixtures/dossier';
import { D0, profileOf } from './fixtures/profile';

const A = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const B = { party_role: 'CO_BORROWER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 };
const addr = (full_text: string) => ({ full_text, street: null, ward: null, district: null, province: null });

const profile = (evidences: EvidenceEnvelope[], policies?: unknown) =>
  Profile360Schema.parse(profileOf(evidences, policies === undefined ? {} : { policies: parseMergePolicies(policies) }));

const app = (business_info: Record<string, unknown> | null) => {
  const a = loanApp([A, B]);
  a.data!.business_info = business_info;
  return a;
};
const license = (holder: Record<string, unknown>, registration_number: string, business_name = 'TẠP HÓA AN') =>
  ev('household_business_license', {
    parties: [{ ...holder, party_role: 'HOLDER' }],
    data: { fields: { registration_number, business_name, business_address: addr('Xã Yên Cường, Ninh Bình'), business_line: 'Bán lẻ tạp hóa' } },
  });
const row = (i: number, income_type: string, monthly_amount: number, extra: Record<string, unknown> = {}) => ({
  source_index: i, party_index: 0, income_type, source_label_raw: null, monthly_amount, frequency_raw: null,
  salary: null, rental: null, household_business: null, trip_trading: null, enterprise: null, ...extra,
});
const hkdBlock = (business_name: string, net_profit_annual: number | null = null) => ({
  business_name, business_forms: [], business_line: null, operating_time_raw: null, actual_address: null, premises_type_raw: null,
  premises_area_m2: null, net_revenue_annual: null, cogs_annual: null, gross_profit_annual: null, total_cost_annual: null, net_profit_annual,
});
const statement = (rows: Array<Record<string, unknown>>) => ev('income_statement', { parties: [{ ...A, party_role: 'BORROWER' }], data: { income_sources: rows, assets: [] } });

describe('đơn vị HKD (L360-B01…B03)', () => {
  it('AC-8: đơn vay + GCN ĐKHKD + bảng kê cùng một HKD → một đơn vị, OPERATES VERIFIED; lợi nhuận năm vào stage 2 đúng một lần', () => {
    const hkd = { business_name: 'Tạp hóa An', business_line: 'Bán lẻ', business_address: null, tax_id: null, registration_number: '01A8001234' };
    const p = profile([app(hkd), license(A, '01A8001234'), statement([row(0, 'household_business', 15_000_000, { household_business: hkdBlock('TẠP HÓA AN', 180_000_000) })])]);
    expect(p.business_units).toHaveLength(1);
    expect(p.business_units[0]).toMatchObject({ business_id: 'biz-1', owner_person_ids: ['person-1'], flags: [], registration_number: { value: '01A8001234' } });
    expect(p.business_units[0].registration_number.fact_ids).toHaveLength(2);
    expect(p.relations).toEqual(expect.arrayContaining([
      { type: 'OPERATES', from: 'person-1', to: 'biz-1', verification: 'VERIFIED' },
      { type: 'EARNS_FROM', from: 'inc-1', to: 'biz-1', verification: 'VERIFIED' },
    ]));
    expect(p.income_streams[0]).toMatchObject({ kind: 'household_business', business_id: 'biz-1', evidenced: true });
    expect(financialInputsFromProfile(p).profit?.value).toBe(180_000_000);
  });

  it('AC-9: vợ và chồng mỗi người một GCN → hai đơn vị, mỗi đơn vị một chủ', () => {
    const p = profile([app(null), license(A, '01A8000001', 'TẠP HÓA AN'), license(B, '01A8000002', 'BÁN THỊT BÌNH')]);
    expect(p.business_units.map((u) => u.owner_person_ids)).toEqual([['person-1'], ['person-2']]);
  });

  it('AC-12: cùng chủ, cùng tên, khác số GCN → không gộp, cả hai gắn cờ và một vấn đề "Phải xử lý"', () => {
    const p = profile([app(null), license(A, '01A8000001'), license(A, '01A8000009')]);
    expect(p.business_units.map((u) => u.flags)).toEqual([['BUSINESS_NUMBER_MISMATCH'], ['BUSINESS_NUMBER_MISMATCH']]);
    expect(p.issues.filter((i) => i.code === 'BUSINESS_NUMBER_MISMATCH').every((i) => i.severity === 'danger')).toBe(true);
  });

  it('D-112: sản phẩm SME không dựng hộ kinh doanh từ business_info của đơn vay', () => {
    const evs = [app({ business_name: 'X', business_line: null, business_address: null, tax_id: null, registration_number: '01A1' })];
    expect(profileOf(evs, { segment: 'SME' }).business_units).toEqual([]);
    expect(profileOf(evs, { segment: 'HKD' }).business_units).toHaveLength(1);
  });
});

describe('luồng thu nhập (L360-B04, L360-G03)', () => {
  it('AC-10: 3 dòng 20tr / 5tr / 5tr → 3 luồng, tổng 30tr', () => {
    const p = profile([app(null), statement([row(0, 'salary', 20_000_000), row(1, 'rental', 5_000_000), row(2, 'other', 5_000_000)])]);
    expect(p.income_streams.map((s) => s.kind)).toEqual(['salary', 'rental', 'other']);
    expect(p.income_streams.reduce((n, s) => n + (s.monthly_amount ?? 0), 0)).toBe(30_000_000);
  });

  it('AC-18: lương cùng chủ lao động trên 2 chứng từ → một luồng, số theo chính sách MIN; sao kê lương → evidenced', () => {
    const employer = { party_role: 'EMPLOYER', party_type: 'ORGANIZATION', full_name: 'CÔNG TY TNHH ABC', id_number: null };
    const p = profile([
      app(null),
      statement([row(0, 'salary', 20_000_000, { salary: { employer_name: 'Công ty TNHH ABC', current_job_raw: null, position: null, months_at_employer: null, workplace_address: null } })]),
      ev('labor_contract', { parties: [employer, { ...A, party_role: 'EMPLOYEE' }], data: { contract_info: { contract_number: null, contract_type_raw: null, sign_date: null, effective_date: null, expiry_date: null, position: null, work_location_raw: null, monthly_salary: 18_000_000, payment_terms_raw: null } } }),
      ev('payroll_bank_statement', { parties: [{ ...A, party_role: 'HOLDER' }] }),
    ]);
    expect(p.income_streams).toHaveLength(1);
    expect(p.income_streams[0]).toMatchObject({ kind: 'salary', person_id: 'person-1', monthly_amount: 18_000_000, evidenced: true });
  });

  it('catalog chính sách hỏng → không chọn số tiền, có vấn đề MERGE_POLICY_INVALID', () => {
    const p = profile([app(null), statement([row(0, 'salary', 20_000_000)])], { policy_version: '' });
    expect(p.income_streams[0].monthly_amount).toBeNull();
    expect(p.issues.some((i) => i.code === 'MERGE_POLICY_INVALID')).toBe(true);
  });
});

describe('một nguồn sự thật (D-114)', () => {
  it('bảng kê thu nhập là lời khai: tên chỉ có trên đơn vay + bảng kê → DECLARED, không CORROBORATED', () => {
    const evs = [loanApp([A]), statement([row(0, 'salary', 10_000_000)])];
    const s3 = runMapDossier({ evidences: evs, dossier_submitted_at: D0 }).data;
    const lac = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences: evs, s3, s3_status: 'SUCCESS' });
    const names = lac.facts.filter((f) => f.subject_id === 'person-1' && f.field.endsWith('full_name'));
    expect(names.map((f) => f.trust)).toEqual(['DECLARED']);
  });

  it('mâu thuẫn số định danh chỉ thành MỘT vấn đề (cờ S3 trùng bị gộp)', () => {
    const p = profile([loanApp([A]), ev('id_card', { parties: [{ ...A, party_role: 'HOLDER', id_number: ID_C12 }] })]);
    const forPerson = p.issues.filter((i) => i.subject_id === 'person-1');
    expect(forPerson.map((i) => i.code)).toEqual(['FIELD_CONFLICT']);
    expect(p.conflicts.map((c) => c.field)).toEqual(['parties[].id_number']);
  });
});

describe('nhóm gộp khác (T-360-13…18)', () => {
  const seller = { party_role: 'SELLER', party_type: 'ORGANIZATION', full_name: 'CÔNG TY TNHH Ô TÔ MIỀN BẮC' };
  const car = (price_key: string, v: number) => ({ asset_index: 0, vehicle_brand: 'TOYOTA', vehicle_model: 'VIOS', vehicle_type: null, manufacture_year: 2026, color: 'Trắng', [price_key]: v });

  it('T-360-13: báo giá + HĐ mua cùng bên bán, cùng xe → một giao dịch giá theo HĐ; giá lệch và vay vượt giá → cảnh báo', () => {
    const a = loanApp([A]);
    a.data!.loan_info = { ...(a.data!.loan_info as object), requested_amount: 700_000_000 };
    const quote = ev('asset_quote', { parties: [{ ...A, party_role: 'CUSTOMER' }], assets: [{ asset_type: 'vehicle' }],
      data: { asset_details: [{ ...car('quoted_value', 620_000_000), asset_name: null, quantity: 1 }], quote_info: { quoting_company: 'Công ty TNHH Ô tô Miền Bắc', quote_number: null, total_quoted_value: 620_000_000 } } });
    const contract = ev('vehicle_sale_contract', { parties: [seller, { ...A, party_role: 'BUYER' }], assets: [{ asset_type: 'vehicle' }],
      data: { asset_details: [{ ...car('unit_price', 600_000_000), vehicle_name: null }], contract_info: { contract_number: 'HD-01', sign_date: null, total_amount: 600_000_000, payment_terms_raw: null } } });
    const p = profile([a, quote, contract]);
    expect(p.counterparties).toHaveLength(1);
    expect(p.purchase_deals).toHaveLength(1);
    expect(p.purchase_deals[0]).toMatchObject({ kind: 'VEHICLE', seller_counterparty_id: 'cp-1', price: 600_000_000, link: 'PARTIAL' });
    expect(p.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['DEAL_PRICE_MISMATCH', 'LOAN_EXCEEDS_DEAL']));
  });

  it('T-360-17 / T-360-16: CCCD hết hạn trước ngày nộp → cảnh báo; xác nhận cư trú → thành viên trỏ về chủ hộ', () => {
    const id = ev('id_card', { parties: [{ ...A, party_role: 'HOLDER' }], valid_until: '2026-01-01' });
    const ct07 = ev('residence_confirmation', {
      parties: [{ ...A, party_role: 'HOLDER' }, { ...B, party_role: 'HOUSEHOLD_MEMBER', party_role_raw: 'Vợ' }],
      data: { residence_info: { place_of_origin: null, temporary_address: null, temporary_residence_from: null, temporary_residence_until: null, temporary_residence_duration_raw: null, household_head_party_index: 0, holder_relationship_to_household_head_raw: 'Chủ hộ' } },
    });
    const p = profile([loanApp([A, B]), id, ct07]);
    const an = p.customers.find((c) => c.person_id === 'person-1')!;
    expect(an.id_documents).toEqual([expect.objectContaining({ doc_type_key: 'id_card', valid_until: '2026-01-01', expired: true })]);
    expect(p.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ID_DOCUMENT_EXPIRED', subject_id: 'person-1' })]));
    expect(p.customers.find((c) => c.person_id === 'person-2')!.relations).toEqual(expect.arrayContaining([
      { type: 'HOUSEHOLD_MEMBER_OF', person_id: 'person-1', verification: 'NOT_REQUIRED', detail: 'Vợ' },
    ]));
  });
});
