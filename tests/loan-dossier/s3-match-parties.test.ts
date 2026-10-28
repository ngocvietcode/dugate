// T-S3-04, T-S3-05, T-S3-06 — ghép party, unmapped, số định danh (S3-R06…R13).
import { computeIdState } from '@/lib/loan-dossier/s3/id-check';
import { matchParties } from '@/lib/loan-dossier/s3/match-parties';
import { buildRegistry } from '@/lib/loan-dossier/s3/registry';
import { buildUnmapped } from '@/lib/loan-dossier/s3/unmapped';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, ID_A9, ID_B12, ID_C12, loanApp } from './fixtures/dossier';

function run(anchor: EvidenceEnvelope, others: EvidenceEnvelope[]) {
  const persons = buildRegistry(anchor);
  const evidences = [anchor, ...others];
  const r = matchParties(persons, evidences, anchor.evidence_id);
  const unmapped = buildUnmapped(r.unmatched, evidences, new Set(r.personOf.keys()), anchor.evidence_id);
  return { ...r, unmapped };
}

const A = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const B = { party_role: 'CO_BORROWER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 };

describe('matchParties', () => {
  it('S3-AC03: CCCD khớp số → ID_NUMBER', () => {
    const { persons } = run(loanApp([A]), [ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })]);
    expect(persons[0].mapped.at(-1)).toMatchObject({ matched_by: 'ID_NUMBER', doc_type_key: 'id_card' });
  });

  it('S3-AC04: tên khác chính tả, không số → unmapped NAME_SPELLING_DIFFERENCE', () => {
    const { unmapped } = run(loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN THỊ HẰNG', id_number: null }]),
      [ev('id_card', { parties: [{ full_name: 'NGUYỄN THI HẰNG', id_number: null }] })]);
    expect(unmapped).toEqual([expect.objectContaining({ reason_code: 'NAME_SPELLING_DIFFERENCE', party_index: 0 })]);
  });

  it('FS-R01: cùng tên, khác số và khác ngày sinh → không ghép; cặp 9 ↔ 12 số vẫn ghép', () => {
    const anchor = loanApp([{ ...A, date_of_birth: '1990-05-01' }]);
    const father = ev('id_card', { parties: [{ full_name: A.full_name, id_number: ID_C12, date_of_birth: '1960-02-02' }] });
    expect(run(anchor, [father]).unmapped).toEqual([expect.objectContaining({ reason_code: 'NO_IDENTITY_MATCH' })]);
    const oldCard = ev('id_card', { parties: [{ full_name: A.full_name, id_number: ID_A9, date_of_birth: '1960-02-02' }] });
    expect(run(anchor, [oldCard]).persons[0].mapped.at(-1)).toMatchObject({ matched_by: 'FULL_NAME' });
  });

  it('số thuộc K() của 2 người → AMBIGUOUS_IDENTITY_MATCH', () => {
    const anchor = loanApp([A, { ...B, id_number: ID_A9 }]);
    const persons = buildRegistry(anchor);
    persons[1].known_ids.add(ID_A12); // giả lập 2 người cùng có số
    const r = matchParties(persons, [anchor, ev('cic', { parties: [{ full_name: 'X Y', id_number: ID_A12 }] })], anchor.evidence_id);
    expect(r.unmatched[0].reason).toBe('AMBIGUOUS_IDENTITY_MATCH');
  });

  it('ghép theo tên mở rộng K(p), chứng từ sau khớp theo số (vòng lặp)', () => {
    const anchor = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: null }]);
    const card = ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] });
    const cic = ev('cic', { parties: [{ full_name: 'NGUYEN VAN AN', id_number: ID_A12 }] });
    const { persons, unmatched } = run(anchor, [cic, card]);
    expect(unmatched).toEqual([]);
    expect(persons[0].mapped.map((m) => [m.doc_type_key, m.matched_by])).toEqual([['loan_application', 'ANCHOR'], ['id_card', 'FULL_NAME'], ['cic', 'ID_NUMBER']]);
  });

  it('confidence số < 0.50 → xét tên', () => {
    const { persons } = run(loanApp([A]), [ev('cic', { confidence: 0.4, parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_C12 }] })]);
    expect(persons[0].mapped.at(-1)!.matched_by).toBe('FULL_NAME');
  });

  it('tên khớp 2 người, DOB phân biệt → ghép 1 người', () => {
    const anchor = loanApp([
      { ...A, date_of_birth: '1980-01-01' },
      { party_role: 'COLLATERAL_OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_C12, date_of_birth: '1955-05-05' },
    ]);
    const persons = buildRegistry(anchor);
    expect(persons).toHaveLength(2);
    const r = matchParties(persons, [anchor, ev('cic', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: null, date_of_birth: '1955-05-05' }] })], anchor.evidence_id);
    expect(r.unmatched).toEqual([]);
    expect(persons[1].mapped.at(-1)!.doc_type_key).toBe('cic');
  });

  it('match_confidence: EXACT ≤ 0.90, REORDERED ≤ 0.85', () => {
    const { persons } = run(loanApp([{ ...A, id_number: null }]), [
      ev('cic', { confidence: 0.99, parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: null }] }),
      ev('cic', { confidence: 0.99, parties: [{ full_name: 'AN NGUYỄN VĂN', id_number: null }] }),
    ]);
    expect(persons[0].mapped.slice(1).map((m) => m.match_confidence)).toEqual([0.9, 0.85]);
  });

  it('cùng input 2 lần → cùng kết quả', () => {
    const anchor = loanApp([A, B]);
    const others = [ev('id_card', { parties: [{ full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 }] })];
    const a = run(anchor, others); const b = run(anchor, others);
    expect(a.persons.map((p) => p.mapped)).toEqual(b.persons.map((p) => p.mapped));
  });
});

describe('buildUnmapped (S3-R10)', () => {
  const anchor = loanApp([A]);
  it('(a) không party nào ghép được → mỗi party đủ điều kiện 1 phần tử', () => {
    const { unmapped } = run(anchor, [ev('cic', { parties: [{ full_name: 'LÊ VĂN X', id_number: ID_C12 }, { party_index: 1, full_name: 'LÊ VĂN Y', id_number: null }] })]);
    expect(unmapped.map((u) => [u.party_index, u.reason_code])).toEqual([[0, 'NO_IDENTITY_MATCH'], [1, 'NO_IDENTITY_MATCH']]);
  });
  it('(b) có party ghép được → party chưa ghép không vào, trừ chủ sở hữu hiện tại', () => {
    const own = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };
    const { unmapped } = run(anchor, [ev('land_use_certificate', { parties: [
      { party_role: 'OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, ownership: { ...own, is_current_owner: false } },
      { party_role: 'OWNER', full_name: 'LÊ VĂN X', id_number: ID_C12, ownership: own },
      { party_role: 'OWNER', full_name: 'LÊ VĂN Y', id_number: null, ownership: { ...own, is_current_owner: false } },
    ] })]);
    expect(unmapped.map((u) => u.full_name)).toEqual(['LÊ VĂN X']);
  });
  it('(c) không party nào có tên/số → 1 phần tử party_index null', () => {
    const { unmapped } = run(anchor, [ev('cic', { parties: [{ full_name: null, id_number: null }] })]);
    expect(unmapped).toEqual([expect.objectContaining({ party_index: null, reason_code: 'NO_IDENTITY_FIELDS' })]);
  });
  it('(d) SELLER / tổ chức không sinh unmapped', () => {
    const { unmapped } = run(anchor, [
      ev('vehicle_sale_contract', { parties: [{ party_role: 'SELLER', full_name: 'LÊ VĂN X', id_number: null }] }),
      ev('cic', { parties: [{ party_type: 'ORGANIZATION', full_name: 'CÔNG TY X', id_number: null }] }),
    ]);
    expect(unmapped).toEqual([]);
  });
  it('(e) evidence ERROR không tham gia', () => {
    const bad = { ...ev('cic', { parties: [{ full_name: 'LÊ VĂN X', id_number: null }] }), status: 'ERROR' as const };
    expect(run(anchor, [bad]).unmapped).toEqual([]);
  });
});

describe('computeIdState (S3-R11…R13)', () => {
  const state = (anchor: EvidenceEnvelope, others: EvidenceEnvelope[]) => {
    const { persons } = run(anchor, others);
    return computeIdState(persons[0]);
  };

  it('S3-AC05: đơn vay số 9, thẻ số 12 in số 9 mặt sau → HISTORICAL_ID_NUMBER INFO', () => {
    const s = state(loanApp([{ ...A, id_number: ID_A9 }]), [ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, previous_id_numbers: [ID_A9] }] })]);
    expect([s.current_id_number, s.historical_id_numbers, s.id_number_check.status, s.id_number_check.severity]).toEqual([ID_A12, [ID_A9], 'HISTORICAL_ID_NUMBER', 'INFO']);
  });

  it('HISTORICAL nâng REVIEW khi confidence < 0.80', () => {
    const s = state(loanApp([{ ...A, id_number: ID_A9 }]), [ev('id_card', { confidence: 0.7, parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, previous_id_numbers: [ID_A9] }] })]);
    expect([s.id_number_check.severity, s.id_number_check.requires_review]).toEqual(['REVIEW', true]);
  });

  it('S3-AC06: 2 thẻ cùng vai khác ngày sinh → role_conflict, current null', () => {
    const anchor = loanApp([{ ...A, id_number: null }]);
    const s = state(anchor, [
      ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1980-01-01' }] }),
      ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_C12, date_of_birth: '1990-01-01' }] }),
    ]);
    expect([s.role_conflict, s.current_id_number, s.id_number_check.status]).toEqual([true, null, 'CURRENT_ID_NUMBER_CONFLICT']);
    expect(s.role_conflict_details[0].candidates).toHaveLength(2);
  });

  it('2 số 12 khác nhau, cùng DOB → xung đột, không role_conflict', () => {
    const s = state(loanApp([{ ...A, id_number: null }]), [
      ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] }),
      ev('vneid', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_C12 }] }),
    ]);
    expect([s.role_conflict, s.current_id_number, s.id_number_check.severity]).toEqual([false, null, 'HIGH']);
  });

  it('ưu tiên số 12 hơn số 9', () => {
    const s = state(loanApp([{ ...A, id_number: null }]), [
      ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A9 }] }),
      ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] }),
    ]);
    expect(s.current_id_number).toBe(ID_A12);
  });

  it('DECLARED_ID_DIFFERS / OBSERVED_ID_DIFFERS / CONSISTENT', () => {
    const declared = state(loanApp([{ ...A, id_number: ID_C12 }]), [ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })]);
    expect(declared.id_number_check.reason_code).toBe('DECLARED_ID_DIFFERS');
    const observed = state(loanApp([A]), [ev('cic', { confidence: 0.4, parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_C12 }] })]);
    expect(observed.id_number_check.reason_code).toBe('OBSERVED_ID_DIFFERS');
    const ok = state(loanApp([A]), [ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })]);
    expect(ok.id_number_check).toEqual({ status: 'CONSISTENT', severity: 'INFO', requires_review: false, reason_code: null });
  });

  it('observed ⊇ historical ∪ {current}', () => {
    const s = state(loanApp([{ ...A, id_number: ID_A9 }]), [ev('id_card', { parties: [{ full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, previous_id_numbers: [ID_A9] }] })]);
    for (const n of [...s.historical_id_numbers, s.current_id_number!]) expect(s.observed_id_numbers).toContain(n);
  });
});
