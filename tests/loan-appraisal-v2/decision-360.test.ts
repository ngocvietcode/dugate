// D-113 — dải tóm tắt và danh sách "cần chú ý" của Customer 360 (view-model, không React).
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { buildDecision360 } from '@/app/loan-appraisal-v2/lib/decision-360';
import type { ClaimsSummary } from '@/app/loan-appraisal-v2/lib/claims-view';
import type { Customer360Summary } from '@/app/loan-appraisal-v2/lib/customer360-view';

const field = (value: unknown, trust: string | null = 'SINGLE_SOURCE') => ({ value, fact_ids: [], trust, review: 'ACCEPTED' });
const profile = {
  profile_version: '0.1',
  loan: { requested_amount: field(600_000_000, 'DISPUTED'), bank_proposed_amount: field(500_000_000), loan_term_months: field(60), interest_rate: field(null, null) },
  parties: [], assets: [{ asset_id: 'asset-1', asset_type: 'real_estate', usage_contexts: ['collateral'], current_owner_person_ids: ['person-1'] }],
  business_units: [{
    business_id: 'biz-1', kind: 'HKD', name: field('TẠP HÓA AN'), registration_number: field('01A8001234'), tax_id: field(null, null),
    business_line: field('Bán lẻ'), business_address: field(null, null), owner_person_ids: ['person-1'],
    mentioned_in: [{ doc_type_key: 'loan_application', count: 1 }], flags: ['BUSINESS_NUMBER_MISMATCH'],
  }],
  income_streams: [
    { income_id: 'inc-1', kind: 'household_business', person_id: 'person-1', business_id: 'biz-1', asset_id: null, employer: null, amounts: [], monthly_amount: 15_000_000, evidenced: false },
    { income_id: 'inc-2', kind: 'salary', person_id: 'person-1', business_id: null, asset_id: null, employer: null, amounts: [], monthly_amount: 10_000_000, evidenced: true },
  ],
  relations: [{ type: 'OPERATES', from: 'person-1', to: 'biz-1', verification: 'UNVERIFIED' }],
  gaps: [], meta: { lac_source_hash: 'x', merge_policy_version: '0.1.0' },
};
const summary = {
  people: [{ personId: 'person-1', name: 'NGUYỄN VĂN AN', roles: ['borrower'], alerts: ['Số CCCD cần xác nhận'] }],
  assets: [], unmapped: 1, superseded: 0, counts: { people: 1, orgs: 0, assets: 0, relations: 0, alerts: 1 },
} as unknown as Customer360Summary;
const claims = { groups: [{ subjectName: 'NGUYỄN VĂN AN', fieldLabel: 'Ngày sinh', tone: 'danger', summary: '2 giá trị' }] } as unknown as ClaimsSummary;

test('tóm tắt + danh sách cần chú ý xếp theo mức độ', () => {
  const d = buildDecision360({ profile_360: profile } as unknown as AppraisalResult, summary, claims, (k) => k);
  expect(d.loan).toMatchObject({ requested: 600_000_000, proposed: 500_000_000, termMonths: 60, disputed: ['Số tiền đề nghị'] });
  expect(d.income).toMatchObject({ monthlyTotal: 25_000_000, unevidenced: 1 });
  expect(d.businesses[0]).toMatchObject({ name: 'TẠP HÓA AN', ownerNames: ['NGUYỄN VĂN AN'], ownerVerified: false });
  expect(d.counts.collateral).toBe(1);
  expect(d.attention.map((a) => a.severity)).toEqual(['danger', 'danger', 'danger', 'warning', 'warning', 'warning', 'info']);
  expect(d.attention[0]).toMatchObject({ subject: 'Khoản vay' });
});

test('kết quả cũ không có profile_360: không lỗi, vẫn có cảnh báo từ S3', () => {
  const d = buildDecision360({} as AppraisalResult, summary, null, (k) => k);
  expect(d.loan).toBeNull();
  expect(d.income.monthlyTotal).toBeNull();
  expect(d.attention.length).toBeGreaterThan(0);
});
