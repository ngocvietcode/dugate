// D-103 — Loan Application Context: phạm vi, render, bảng mã (T-LAC-04; LAC AC-5, AC-8, AC-9).
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { renderLoanApplicationContext } from '@/lib/loan-dossier/context/render';
import { lacScopeFromInputs } from '@/lib/loan-dossier/context/scope';
import { buildProfile360 } from '@/lib/loan-dossier/profile360/build';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, ID_B12, loanApp } from './fixtures/dossier';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const owner = { party_role: 'COLLATERAL_OWNER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 };
const currentOwner = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };

function dossier(extra: EvidenceEnvelope[] = []) {
  const a = loanApp([borrower, owner], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AB123456' } }] });
  a.data!.loan_info = { ...(a.data!.loan_info as object), requested_amount: 600_000_000, bank_proposed_amount: 500_000_000, loan_term_months: 60, interest_rate: 10 };
  const evidences = [
    { ...a, field_confidences: { ...a.field_confidences, loan_info: 0.95 } },
    ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER' }] }),
    ev('id_card', { parties: [{ ...owner, party_role: 'HOLDER' }] }),
    ev('land_use_certificate', { parties: [{ ...owner, party_role: 'OWNER', ownership: currentOwner }], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AB123456' } }] }),
    ...extra,
  ];
  const s3 = runMapDossier({ evidences, dossier_submitted_at: '2026-10-14' }).data;
  return buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: 'SUCCESS' });
}

describe('phạm vi (LAC-R11)', () => {
  it('rule không khai nguồn nhận biết được → toàn bộ', () => {
    expect(lacScopeFromInputs([['abc.def']]).all).toBe(true);
    expect(lacScopeFromInputs([[]]).all).toBe(true);
  });

  it('khóa lac.* và khóa cũ được ánh xạ', () => {
    const s = lacScopeFromInputs([['lac.loan', 'lac.person.collateral_owner'], ['evidence.id_card'], ['master_data.collateral']]);
    expect(s.all).toBe(false);
    expect(s.loan).toBe(true);
    expect([...s.personRoles!]).toEqual(['collateral_owner']);
    expect(s.assetUsages?.size).toBe(0); // master_data.collateral → mọi tài sản
    expect(s.relations).toBe(true);
    expect([...s.docTypes]).toEqual(['id_card']);
  });
});

describe('render', () => {
  const lac = dossier();
  const all = renderLoanApplicationContext(lac, lacScopeFromInputs([[]]));

  it('tất định', () => {
    expect(renderLoanApplicationContext(lac, lacScopeFromInputs([[]])).text).toBe(all.text);
  });

  it('AC-5: mọi mã F<n> / F<n>.<k> trong văn bản có trong bảng mã; bảng mã chỉ trỏ record_id có thật của LAC', () => {
    // Bỏ dòng chú thích đầu (có ví dụ "F3.2").
    const codes = [...all.text.split('\n').slice(1).join('\n').matchAll(/\bF\d+(?:\.\d+)?\b/g)].map((m) => m[0]);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(all.refIndex.has(c)).toBe(true);
    const records = new Set(lac.facts.flatMap((f) => f.sources.map((s) => s.record_id)));
    for (const ids of all.refIndex.values()) for (const id of ids) expect(records.has(id)).toBe(true);
    for (const [code, ids] of all.refIndex) if (/^F\d+\.\d+$/.test(code)) expect(ids).toHaveLength(1);
  });

  it('không có evidence_id, không có tên file trong văn bản; mỗi người một dòng định danh', () => {
    for (const f of lac.facts) for (const s of f.sources) expect(all.text).not.toContain(s.record_id.split('#')[0]);
    expect(all.text).not.toMatch(/\.pdf/);
    expect(all.text).toMatch(/^person-1 · borrower · NGUYỄN VĂN AN$/m);
    expect(all.text).toContain('KHOẢN VAY [loan]');
    expect(all.text).toContain('QUAN HỆ');
  });

  it('lá nội bộ không render', () => {
    expect(all.text).not.toMatch(/party_index|asset_index/);
  });

  it('AC-8: rule chỉ khai master_data.collateral → có tài sản + quan hệ, không có mục khoản vay', () => {
    const r = renderLoanApplicationContext(lac, lacScopeFromInputs([['master_data.collateral']]));
    expect(r.text).toContain('TÀI SẢN');
    expect(r.text).toContain('chủ sở hữu hiện tại');
    expect(r.text).not.toContain('KHOẢN VAY [loan]');
  });

  it('AC-8: rule khai evidence.id_card → có fact có nguồn id_card', () => {
    const r = renderLoanApplicationContext(lac, lacScopeFromInputs([['evidence.id_card']]));
    expect(r.text).toMatch(/\[[A-Z_]+; [^\]]*id_card/);
  });

  it('AC-9: vượt ngân sách → cắt bớt, còn khoảng trống / mâu thuẫn, có dòng "còn N dữ kiện"', () => {
    const small = renderLoanApplicationContext(lac, lacScopeFromInputs([[]]), 1_800);
    expect(small.stats.truncated).toBe(true);
    expect(small.stats.facts_rendered).toBeLessThan(all.stats.facts_rendered);
    expect(small.text).toMatch(/\(… còn \d+ dữ kiện của [a-z0-9-]+ không hiển thị\)/);
    for (const c of [...small.text.split('\n').slice(1).join('\n').matchAll(/\bF\d+(?:\.\d+)?\b/g)].map((m) => m[0])) expect(small.refIndex.has(c)).toBe(true);
  });

  it('mẫu văn bản (xem tay khi review)', () => {
    // eslint-disable-next-line no-console
    if (process.env.LAC_PRINT) console.log(all.text);
    expect(all.stats.chars).toBe(all.text.length);
  });
});

// D-114: có hồ sơ 360 thì nguồn thu / hộ kinh doanh render theo đơn vị (inc-n, biz-n), không làm phẳng, không có `business-1`.
describe('render theo hồ sơ 360 (D-114)', () => {
  const row = (i: number, income_type: string, monthly_amount: number) => ({
    source_index: i, party_index: 0, income_type, source_label_raw: null, monthly_amount, frequency_raw: null,
    salary: null, rental: null, household_business: null, trip_trading: null, enterprise: null,
  });
  const setup = () => {
    const a = loanApp([borrower]);
    a.data!.business_info = { business_name: 'Tạp hóa An', business_line: 'Bán lẻ', business_address: null, tax_id: null, registration_number: '01A8001234' };
    const statement = ev('income_statement', { parties: [{ ...borrower, party_role: 'BORROWER' }], data: { income_sources: [row(0, 'salary', 20_000_000), row(1, 'rental', 5_000_000), row(2, 'other', 5_000_000)], assets: [] } });
    const evidences = [a, statement];
    const s3 = runMapDossier({ evidences, dossier_submitted_at: '2026-10-14' }).data;
    const lac = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: 'SUCCESS' });
    return { lac, profile: buildProfile360({ evidences, s3, lac, segment: 'HKD' }) };
  };

  it('mỗi luồng thu nhập một dòng, dẫn đúng lá của dòng đó; không còn fact phẳng income_sources và mục business-1', () => {
    const { lac, profile } = setup();
    const r = renderLoanApplicationContext(lac, lacScopeFromInputs([[]]), undefined, profile);
    const lines = r.text.split('\n').filter((l) => l.startsWith('- inc-'));
    expect(lines).toHaveLength(3);
    const code = lines[0].match(/\[(F\d+)\]/)![1];
    expect(r.refIndex.get(code)).toEqual([expect.stringMatching(/#income_sources\[0\]\.monthly_amount$/)]);
    expect(r.text).not.toContain('HOẠT ĐỘNG KINH DOANH');
    expect(r.text).toContain('HỘ KINH DOANH');
    const flat = [...r.factIndex].filter(([, id]) => lac.facts.find((f) => f.fact_id === id)!.field.startsWith('income_sources[]')).map(([c]) => c);
    for (const c of flat) expect(r.text.split('\n').filter((l) => new RegExp(`^${c} `).test(l))).toEqual([]);
  });

  it('không có hồ sơ 360: render như trước (có mục HOẠT ĐỘNG KINH DOANH)', () => {
    const { lac } = setup();
    expect(renderLoanApplicationContext(lac, lacScopeFromInputs([[]])).text).toContain('HOẠT ĐỘNG KINH DOANH');
  });
});
