// T-S3-10, T-S3-11, T-S3-16, T-S3-12 — quan hệ, giấy khai sinh, bản bị thay thế, Customer 360.
import { buildCustomer360 } from '@/lib/loan-dossier/s3/customer360';
import { verifyByBirthCerts } from '@/lib/loan-dossier/s3/birth-cert';
import { classifyRelationship } from '@/lib/loan-dossier/s3/relationship';
import { findSuperseded } from '@/lib/loan-dossier/s3/superseded';
import { validityByDocType } from '@/lib/loan-dossier/s4/catalog';
import { computeIdState } from '@/lib/loan-dossier/s3/id-check';
import { matchParties } from '@/lib/loan-dossier/s3/match-parties';
import { buildRegistry } from '@/lib/loan-dossier/s3/registry';

import { ev, ID_A12, ID_B12, loanApp } from './fixtures/dossier';

describe('classifyRelationship (S3-R20)', () => {
  it.each([
    ['Vợ', 'SPOUSE', null], ['chong', 'SPOUSE', null], ['Mẹ', 'PARENT_CHILD', 1], ['me', 'PARENT_CHILD', 1], ['Bố đẻ', 'PARENT_CHILD', 1],
    ['CHA', 'PARENT_CHILD', 1], ['Con gái', 'PARENT_CHILD', 1], ['Anh trai', 'SIBLING', 2], ['chi gai', 'SIBLING', 2], ['Em', 'SIBLING', 2],
    ['Bạn bè', 'OTHER', null], ['Đối tác', 'OTHER', null], ['VỢ CON', 'SPOUSE', null],
  ])('%s → %s', (raw, type, required) => {
    expect(classifyRelationship(raw, null, false)).toEqual({ relationship_type: type, required_count: required });
  });
  it('"Bà" (có dấu) không thành BA', () => {
    expect(classifyRelationship('Bà nội', null, false).relationship_type).toBe('OTHER');
  });
  it('declaredType thắng; rỗng + vợ/chồng → SPOUSE; rỗng → null', () => {
    expect(classifyRelationship('Bạn', 'SIBLING', false).relationship_type).toBe('SIBLING');
    expect(classifyRelationship(null, null, true).relationship_type).toBe('SPOUSE');
    expect(classifyRelationship('  ', null, false).relationship_type).toBeNull();
  });
});

describe('verifyByBirthCerts (S3-R21)', () => {
  const cert = (child: string | null, father: string | null, mother: string | null, status: 'SUCCESS' | 'ERROR' = 'SUCCESS') => ({
    ...ev('birth_certificate', { parties: [
      { party_role: 'CHILD', full_name: child },
      ...(father ? [{ party_role: 'FATHER', full_name: father }] : []),
      ...(mother ? [{ party_role: 'MOTHER', full_name: mother }] : []),
    ] }),
    status,
  });
  it('S3-AC11: chủ TSBĐ là mẹ, giấy khai sinh đủ 2 tên → verified 1', () => {
    const r = verifyByBirthCerts(['NGUYỄN VĂN AN'], ['LÊ THỊ MẸ'], 'PARENT_CHILD', [cert('NGUYỄN VĂN AN', 'NGUYỄN VĂN BỐ', 'LÊ THỊ MẸ')]);
    expect(r.verified_count).toBe(1);
  });
  it('PARENT_CHILD chỉ có tên cha mẹ, không có tên con → không hợp lệ', () => {
    expect(verifyByBirthCerts(['NGUYỄN VĂN AN'], ['LÊ THỊ MẸ'], 'PARENT_CHILD', [cert('NGƯỜI KHÁC', 'NGUYỄN VĂN AN', 'LÊ THỊ MẸ')]).verified_count).toBe(0);
  });
  it('SIBLING: mỗi giấy có ≥ 1 tên khớp là hợp lệ; tên khác chính tả không tính; ERROR bỏ', () => {
    const subject = ['NGUYỄN VĂN AN']; const owner = ['NGUYỄN VĂN BÌNH'];
    expect(verifyByBirthCerts(subject, owner, 'SIBLING', [cert('NGUYỄN VĂN AN', 'X Y', 'Z W'), cert('NGUYỄN VĂN BÌNH', 'X Y', 'Z W')]).verified_count).toBe(2);
    expect(verifyByBirthCerts(subject, owner, 'SIBLING', [cert('NGUYỄN VAN AN', 'X Y', 'Z W')]).verified_count).toBe(0);
    expect(verifyByBirthCerts(subject, owner, 'SIBLING', [cert('NGUYỄN VĂN AN', 'X Y', 'Z W', 'ERROR')]).verified_count).toBe(0);
  });
  it('SPOUSE / OTHER / null → 0', () => {
    for (const t of ['SPOUSE', 'OTHER', null] as const) expect(verifyByBirthCerts(['A B'], ['C D'], t, [cert('A B', 'C D', null)]).verified_count).toBe(0);
  });
});

describe('findSuperseded (S3-R27)', () => {
  const rules = validityByDocType();
  const holder = { party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
  const person = (ids: string[], p = 'person-1') => new Map(ids.map((id) => [id, p]));

  it('S3-AC15: hôn nhân cũ hết hạn + bản cấp lại còn hạn → bản cũ bị thay thế', () => {
    const old = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-01-05' });
    const fresh = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-09-20' });
    const out = findSuperseded([old, fresh], person([old.evidence_id, fresh.evidence_id]), [], rules, '2026-10-14');
    expect(out).toEqual([expect.objectContaining({ evidence_id: old.evidence_id, superseded_by_evidence_ids: [fresh.evidence_id], person_id: 'person-1', reason_code: 'DOCUMENT_EXPIRED' })]);
  });
  it('S3-AC16: chỉ 1 bản hết hạn → []; 2 bản cùng còn hạn → []', () => {
    const one = ev('residence_confirmation', { parties: [holder], issue_date: '2025-01-01' });
    expect(findSuperseded([one], person([one.evidence_id]), [], rules, '2026-10-14')).toEqual([]);
    const a = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-08-01' });
    const b = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-09-01' });
    expect(findSuperseded([a, b], person([a.evidence_id, b.evidence_id]), [], rules, '2026-10-14')).toEqual([]);
  });
  it('bản hết hạn của người A không bị thay bởi bản còn hạn của người B', () => {
    const a = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-01-05' });
    const b = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-09-20' });
    const map = new Map([[a.evidence_id, 'person-1'], [b.evidence_id, 'person-2']]);
    expect(findSuperseded([a, b], map, [], rules, '2026-10-14')).toEqual([]);
  });
  it('định giá cũ > 365 ngày và bản mới cùng asset → bản cũ bị thay thế', () => {
    const old = ev('real_estate_valuation_report', { issue_date: '2025-01-01' });
    const fresh = ev('real_estate_valuation_report', { issue_date: '2026-06-01' });
    const assets = [{ asset_id: 'asset-1', sources: [{ evidence_id: old.evidence_id }, { evidence_id: fresh.evidence_id }] }] as never;
    const out = findSuperseded([old, fresh], new Map(), assets, rules, '2026-10-14');
    expect(out.map((s) => [s.evidence_id, s.asset_id])).toEqual([[old.evidence_id, 'asset-1']]);
  });
  it('CCCD (validity null) chỉ bị thay khi valid_until in trên giấy đã qua', () => {
    const old = ev('id_card', { parties: [holder], issue_date: '2010-01-01', valid_until: '2025-01-01' });
    const fresh = ev('id_card', { parties: [holder], issue_date: '2025-01-02', valid_until: '2040-01-01' });
    const out = findSuperseded([old, fresh], person([old.evidence_id, fresh.evidence_id]), [], rules, '2026-10-14');
    expect(out.map((s) => s.evidence_id)).toEqual([old.evidence_id]);
    const noExpiry = ev('id_card', { parties: [holder], issue_date: '2010-01-01' });
    expect(findSuperseded([noExpiry, fresh], person([noExpiry.evidence_id, fresh.evidence_id]), [], rules, '2026-10-14')).toEqual([]);
  });
  it('bản dateOK = false không được coi là bản thay thế', () => {
    const old = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-01-05' });
    const noDate = ev('marital_status_confirmation', { parties: [holder], issue_date: null });
    expect(findSuperseded([old, noDate], person([old.evidence_id, noDate.evidence_id]), [], rules, '2026-10-14')).toEqual([]);
  });
});

describe('buildCustomer360 (S3-R22)', () => {
  const anchor = loanApp([
    { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1980-01-01' },
    { party_role: 'SPOUSE', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
  ], { relations: { 0: { marital: 'SINGLE' } }, data: { business_info: { business_name: 'HKD AN' } } });

  function c360(others: ReturnType<typeof ev>[], superseded: string[] = []) {
    const persons = buildRegistry(anchor);
    const all = [anchor, ...others];
    matchParties(persons, all, anchor.evidence_id);
    const states = new Map(persons.map((p) => [p.person_id, computeIdState(p)]));
    return buildCustomer360(persons, states, [{ asset_id: 'asset-1', current_owner_person_ids: ['person-1'] }] as never, all, anchor, new Set(superseded));
  }

  it('địa chỉ: evidence HOLDER có issue_date mới nhất thắng', () => {
    const addr = (t: string) => ({ full_text: t, street: null, ward: null, district: null, province: null });
    const c = c360([
      ev('residence_confirmation', { issue_date: '2026-01-01', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, permanent_address: addr('CŨ') }] }),
      ev('residence_confirmation', { issue_date: '2026-09-01', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, permanent_address: addr('MỚI') }] }),
    ]);
    expect(c[0].identity.permanent_address?.full_text).toBe('MỚI');
  });

  it('marital_status theo giấy mới nhất; bản bị thay thế không làm nguồn (S3-AC15)', () => {
    const holder = { party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
    const old = ev('marital_status_confirmation', { issue_date: '2026-01-05', parties: [holder], data: { marital_status: 'SINGLE' } });
    const fresh = ev('marital_status_confirmation', { issue_date: '2026-09-20', parties: [holder], data: { marital_status: 'MARRIED' } });
    expect(c360([old, fresh])[0].marital_status).toBe('MARRIED');
    expect(c360([fresh, old], [fresh.evidence_id])[0].marital_status).toBe('SINGLE');
    expect(c360([])[0].marital_status).toBe('SINGLE'); // từ party_details anchor
  });

  it('spouse đối xứng; business chỉ borrower/co_borrower; owned_asset_ids', () => {
    const c = c360([]);
    expect([c[0].spouse_person_id, c[1].spouse_person_id]).toEqual(['person-2', 'person-1']);
    expect(c[0].business).toEqual({ business_name: 'HKD AN' });
    expect(c[1].business).toBeNull();
    expect([c[0].owned_asset_ids, c[1].owned_asset_ids]).toEqual([['asset-1'], []]);
    expect(c[0].identity).toMatchObject({ id_number: ID_A12, date_of_birth: '1980-01-01' });
  });
});
