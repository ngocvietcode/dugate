// Customer 360 từ hồ sơ vay: chi tiết lấy từ evidences[].data (customer_360 của S3 chỉ giữ định danh).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Customer360Panel } from '@/components/loan-appraisal-v2/appraisal/Customer360Panel';
import { buildCustomer360 } from '@/app/loan-appraisal-v2/lib/customer360-view';
import { assetDetail, loanSummary, personDetail } from '@/app/loan-appraisal-v2/lib/customer360-detail';
import { buildDossierGraph, toDossierGraphView } from '@/lib/loan-dossier/graph';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';

import { ev, ID_A12, ID_A9, ID_B12, loanApp } from '../loan-dossier/fixtures/dossier';

const now = () => new Date('2026-10-14T03:00:00.000Z');
const own = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };
const GCN = 'AA 08798136';
const label = (k: string) => `L(${k})`;

function dossier(): EvidenceEnvelope[] {
  return [
    loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN THỊ KIỀU ANH', id_number: ID_A12, date_of_birth: '1999-10-05', gender: 'FEMALE', phone_number: '0912345678', nationality: 'Việt Nam', id_issue_date: '2021-04-01', id_issue_place: 'Cục CSQLHC về TTXH' },
      { party_role: 'SPOUSE', full_name: 'TRẦN ÁNH DƯƠNG', id_number: ID_B12, date_of_birth: '1997-11-18' },
    ], {
      id: 'ev-aaaaaaaaaa01',
      assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: GCN } }],
      data: {
        asset_details: [{ asset_index: 0, collateral_type_raw: 'Nhà ở và đất ở', owner_names_raw: 'NGUYỄN THỊ KIỀU ANH', owner_party_indexes: [0], declared_value: 1500000000, vehicle_brand: null, vehicle_model: null }],
        business_info: { business_name: 'HKD KIỀU ANH', business_line: 'Bán lẻ tạp hóa', business_address: { full_text: 'Văn Lâm, Hưng Yên', street: null, ward: null, district: null, province: null }, tax_id: '8123456789', registration_number: '01H8001234' },
        loan_info: { requested_amount: 600000000, bank_proposed_amount: 500000000, loan_term_months: 18, interest_rate: 10, interest_rate_code: 'LC10', interest_rate_raw: null, principal_grace_months: 0, loan_purposes: ['Bổ sung vốn lưu động'], loan_purpose_detail: 'Nhập hàng tết', disbursement_method: 'Chuyển khoản', principal_repayment_method: 'Cuối kỳ', interest_repayment_method: 'Hàng tháng' },
        financial_info: { total_income: 40000000, total_income_period: 'MONTHLY', repayment_source: 'Doanh thu cửa hàng', income_details: [{ source: 'Kinh doanh', amount: 40000000, period: 'MONTHLY' }], has_existing_debt: true, existing_monthly_debt_payment: 2000000 },
        collateral_summary: { total_collateral_value: 1500000000, notes: [] },
        ltv: 33,
      },
    }),
    ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN THỊ KIỀU ANH', id_number: ID_A12, previous_id_numbers: [ID_A9], date_of_birth: '1999-10-05' }] }),
    ev('land_use_certificate', {
      id: 'ev-aaaaaaaaaa04', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: GCN } }],
      parties: [{ party_role: 'OWNER', full_name: 'NGUYỄN THỊ KIỀU ANH', id_number: ID_A12, ownership: own }],
      data: {
        asset_details: [{ asset_index: 0, land_area_m2: 120, land_use_purpose: 'ONT', land_use_term_raw: 'Lâu dài', land_use_origin: 'Nhà nước giao đất có thu tiền', house_type: 'Nhà ở riêng lẻ', construction_area_m2: 80, floor_area_m2: 160, number_of_floors: 2, floor: null, ownership_form: 'Sở hữu riêng' }],
        change_records: [{ record_index: 0, change_date: '2024-05-02', change_type: 'Thế chấp', content_raw: 'Thế chấp cho VPBank', party_indexes: [0] }],
      },
    }),
    ev('external_valuation_certificate', {
      id: 'ev-aaaaaaaaaa05', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: GCN } }], parties: [],
      data: {
        asset_details: [{ asset_index: 0, land_area_m2: 120, land_use_status: 'Đang sử dụng', land_value: 1200000000, construction_value: 300000000, valuation_value: 1500000000, asset_grade: null }],
        valuation_info: { appraisal_company: 'Công ty ĐG Việt Á', valuation_certificate_number: 'CT-01/2026', valuation_date: '2026-08-01', valuation_purpose: 'Thế chấp ngân hàng', total_valuation_value: 1500000000 },
      },
    }),
    ev('cic', {
      id: 'ev-aaaaaaaaaa06', parties: [{ party_role: 'CUSTOMER', full_name: 'NGUYỄN THỊ KIỀU ANH', id_number: ID_A12 }],
      data: { reports: [{ party_index: 0, report_datetime: '2026-09-30', cic_code: 'X1', current_debt_group: 1, current_debt_group_raw: 'Nhóm 1', bad_debt_5y: { has_records: false, records_raw: null }, card_late_payment_3y: { has_records: true, records_raw: '2 lần' }, watchlist_debt_12m: { has_records: false, records_raw: null }, queried_institutions_1y_count: 3, queried_institutions: [] }] },
    }),
    ev('income_statement', {
      id: 'ev-aaaaaaaaaa07', parties: [{ party_role: 'BORROWER', full_name: 'NGUYỄN THỊ KIỀU ANH', id_number: ID_A12 }],
      data: { income_summary: {}, income_sources: [{ source_index: 0, party_index: 0, income_type: 'household_business', source_label_raw: 'HKD', monthly_amount: 40000000, frequency_raw: null, household_business: { business_name: 'HKD KIỀU ANH', business_line: 'Bán lẻ tạp hóa', net_revenue_annual: 1200000000, net_profit_annual: 360000000 } }] },
    }),
  ];
}

const evs = () => dossier() as unknown as Array<Parameters<typeof personDetail>[2][number]>;
const data = () => runMapDossier({ evidences: dossier(), dossier_submitted_at: '2026-10-14', now }).data!;
const graph = () => toDossierGraphView(buildDossierGraph(data()));
const labelOf = (rows: Array<{ label: string; value: string }>, l: string) => rows.find((r) => r.label === l)?.value;

describe('chi tiết khoản vay (từ đơn vay)', () => {
  it('đủ số tiền, thời hạn, lãi suất, nguồn trả nợ, nợ hiện hữu, mục đích, thu nhập khai', () => {
    const l = loanSummary(evs(), label)!;
    expect(labelOf(l.rows, 'Số tiền đề nghị')).toContain('600.000.000');
    expect(labelOf(l.rows, 'Số tiền ngân hàng đề xuất')).toContain('500.000.000');
    expect(labelOf(l.rows, 'Thời hạn')).toBe('18 tháng');
    expect(labelOf(l.rows, 'Lãi suất')).toBe('10%/năm (LC10)');
    expect(labelOf(l.rows, 'Nguồn trả nợ')).toBe('Doanh thu cửa hàng');
    expect(labelOf(l.rows, 'Nợ hiện hữu')).toContain('2.000.000');
    expect(labelOf(l.rows, 'LTV (khai)')).toBe('33%');
    expect(l.purposes).toEqual(['Bổ sung vốn lưu động', 'Nhập hàng tết']);
    expect(l.incomeDetails[0]).toMatchObject({ label: 'Kinh doanh' });
    expect(l.rows.every((r) => r.source === 'L(loan_application)')).toBe(true);
  });

  it('không có đơn vay → null; đơn vay trống → null (không hiện khối rỗng)', () => {
    expect(loanSummary([], label)).toBeNull();
    const empty = [{ evidence_id: 'ev-x', doc_type_key: 'loan_application', data: { loan_info: null, financial_info: null, collateral_summary: null } }];
    expect(loanSummary(empty, label)).toBeNull();
  });
});

describe('chi tiết người', () => {
  it('thông tin cá nhân đầy đủ hơn customer_360: giới tính, SĐT, quốc tịch, cấp ngày/nơi, quan hệ khai', () => {
    const d = personDetail(data(), 'person-1', evs(), label);
    expect(labelOf(d.personal, 'Giới tính')).toBe('Nữ');
    expect(labelOf(d.personal, 'Điện thoại')).toBe('0912345678');
    expect(labelOf(d.personal, 'Quốc tịch')).toBe('Việt Nam');
    expect(labelOf(d.personal, 'Ngày cấp')).toBe('2021-04-01');
    expect(labelOf(d.personal, 'Nơi cấp')).toBe('Cục CSQLHC về TTXH');
  });

  it('hộ kinh doanh, thu nhập (kèm doanh thu / lợi nhuận năm) và CIC (nhóm nợ, thẻ chậm, truy vấn)', () => {
    const d = personDetail(data(), 'person-1', evs(), label);
    expect(labelOf(d.business, 'Tên')).toBe('HKD KIỀU ANH');
    expect(labelOf(d.business, 'Mã số thuế')).toBe('8123456789');
    expect(d.income[0].label).toBe('Hộ kinh doanh');
    expect(d.income[0].value).toContain('40.000.000');
    expect(d.income[0].value).toContain('DT 1.200.000.000');
    expect(labelOf(d.credit, 'Nhóm nợ hiện tại')).toBe('Nhóm 1 (đủ tiêu chuẩn)');
    expect(labelOf(d.credit, 'Nợ xấu 5 năm')).toBe('Không');
    expect(labelOf(d.credit, 'Chậm thanh toán thẻ 3 năm')).toBe('Có — 2 lần');
    expect(labelOf(d.credit, 'Số TCTD truy vấn (1 năm)')).toBe('3');
  });

  it('CIC chỉ lấy báo cáo của đúng người, không lẫn sang người khác', () => {
    const other = personDetail(data(), 'person-2', evs(), label);
    expect(other.credit).toEqual([]);
  });

  it('không có evidences → phần cần chứng từ rỗng, không ném lỗi (hộ kinh doanh vẫn có vì lấy từ customer_360)', () => {
    const d = personDetail(data(), 'person-1', [], label);
    expect(d.personal).toEqual([]);
    expect(d.income).toEqual([]);
    expect(d.credit).toEqual([]);
    expect(labelOf(d.business, 'Tên')).toBe('HKD KIỀU ANH');
  });
});

describe('chi tiết tài sản', () => {
  it('đặc điểm từ GCN, giá trị từ chứng thư định giá + khai trên đơn, biến động đăng ký', () => {
    const d = assetDetail(data(), 'asset-1', evs(), label);
    expect(labelOf(d.physical, 'Diện tích đất')).toBe('120 m²');
    expect(labelOf(d.physical, 'Mục đích sử dụng')).toBe('Đất ở nông thôn');
    expect(labelOf(d.physical, 'Số tầng')).toBe('2');
    expect(labelOf(d.physical, 'Hình thức sở hữu')).toBe('Sở hữu riêng');
    expect(labelOf(d.physical, 'Loại TSBĐ (khai)')).toBe('Nhà ở và đất ở');
    expect(labelOf(d.valuation, 'Giá trị khai trên đơn')).toContain('1.500.000.000');
    expect(labelOf(d.valuation, 'Giá trị định giá')).toContain('Công ty ĐG Việt Á');
    expect(labelOf(d.valuation, 'Giá trị đất')).toContain('1.200.000.000');
    expect(d.changes[0].value).toContain('Thế chấp');
  });

  it('mỗi dòng có nguồn chứng từ; giá trị trùng giữa các chứng từ không lặp', () => {
    const d = assetDetail(data(), 'asset-1', evs(), label);
    expect(d.physical.every((r) => r.source)).toBe(true);
    const keys = d.physical.map((r) => `${r.label}|${r.value}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('buildCustomer360 với evidences', () => {
  it('tổng hợp có khoản vay, chi tiết người và tài sản; không evidences thì vẫn dựng được phần cũ', () => {
    const s = buildCustomer360(data(), graph(), label, evs());
    expect(s.loan).not.toBeNull();
    expect(s.people[0].detail.credit.length).toBeGreaterThan(0);
    expect(s.assets[0].detail.valuation.length).toBeGreaterThan(0);
    const bare = buildCustomer360(data(), graph(), label);
    expect(bare.loan).toBeNull();
    expect(bare.people).toHaveLength(2);
    expect(bare.assets[0].detail).toEqual({ physical: [], valuation: [], changes: [] });
  });

  it('thuần và tất định', () => {
    expect(JSON.stringify(buildCustomer360(data(), graph(), label, evs()))).toBe(JSON.stringify(buildCustomer360(data(), graph(), label, evs())));
  });
});

describe('Customer360Panel (render)', () => {
  const html = (evidences: EvidenceEnvelope[] = dossier(), pick: (d: ReturnType<typeof data>) => unknown = (d) => d) => {
    const d = runMapDossier({ evidences, dossier_submitted_at: '2026-10-14', now }).data!;
    const result = { customer_360: pick(d), dossier_graph: toDossierGraphView(buildDossierGraph(d)) } as never;
    return renderToStaticMarkup(createElement(Customer360Panel, { result, evidences: evidences as never }));
  };
  const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('thứ tự: Khoản vay → Tài sản → Người; có đủ chi tiết, không chỉ định danh', () => {
    const t = text(html());
    const a = t.indexOf('Khoản vay'); const b = t.indexOf('Tài sản (1)'); const c = t.indexOf('Người (2)');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    for (const s of ['600.000.000', '18 tháng', 'Doanh thu cửa hàng', 'Mục đích vay', 'Nhập hàng tết', 'Đất ở nông thôn', '120 m²', 'Công ty ĐG Việt Á', 'Giá trị định giá']) expect(t).toContain(s);
    // D-113: chi tiết người (CIC, hộ kinh doanh) thu gọn mặc định khi người đó không có cảnh báo; tiêu đề vẫn báo số mục.
    expect(t).toMatch(/Chi tiết từ chứng từ \(\d+ mục\)/);
  });

  it('nguồn là chip theo loại chứng từ (không chứa tên file trong dòng); tên file ở tooltip', () => {
    const h = html();
    const t = text(h);
    expect(t).not.toMatch(/\.pdf \(/);
    expect(h).toMatch(/title="[^"]*\.pdf/);
  });

  it('không có đơn vay đọc được: không hiện khối Khoản vay, vẫn hiện người', () => {
    const t = text(html(dossier().slice(1)));
    expect(t).not.toContain('Khoản vay');
  });

  it('không evidences (kết quả cũ): vẫn hiện người & tài sản, không ném lỗi', () => {
    const d = runMapDossier({ evidences: dossier(), dossier_submitted_at: '2026-10-14', now }).data!;
    const out = renderToStaticMarkup(createElement(Customer360Panel, { result: { customer_360: d } as never }));
    expect(out).toContain('NGUYỄN THỊ KIỀU ANH');
    expect(out).not.toContain('Khoản vay');
  });
});