// T-S3-01, T-S3-02, T-S3-03 — anchor, tách tên ghép, role registry (S3-R01…R05).
import { pickAnchor } from '@/lib/loan-dossier/s3/anchor';
import { buildRegistry } from '@/lib/loan-dossier/s3/registry';
import { splitJointOwner } from '@/lib/loan-dossier/s3/split-names';

import { makeParty } from './fixtures/build';
import { ev, ID_A12, ID_A9, ID_B12, loanApp } from './fixtures/dossier';

describe('pickAnchor', () => {
  const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN' };
  it('chọn confidence parties cao hơn; hòa → đứng trước', () => {
    const a = loanApp([borrower], { confidence: 0.7 });
    const b = loanApp([borrower], { confidence: 0.9 });
    const c = loanApp([borrower], { confidence: 0.9 });
    expect(pickAnchor([a, b, c])).toBe(b);
  });
  it('không có BORROWER có tên/số → null; evidence ERROR bị bỏ', () => {
    expect(pickAnchor([loanApp([{ party_role: 'BORROWER', full_name: null, id_number: null }])])).toBeNull();
    const err = { ...loanApp([borrower]), status: 'ERROR' as const };
    expect(pickAnchor([err])).toBeNull();
  });
});

describe('splitJointOwner', () => {
  it('"A và B" → 2 party, id null, giữ party_index/party_role', () => {
    const out = splitJointOwner(makeParty({ party_index: 2, party_role: 'OWNER', full_name: 'NGUYỄN VĂN AN và TRẦN THỊ BÌNH' }));
    expect(out.map((p) => [p.full_name, p.id_number, p.party_index, p.party_role])).toEqual([
      ['NGUYỄN VĂN AN', null, 2, 'OWNER'], ['TRẦN THỊ BÌNH', null, 2, 'OWNER'],
    ]);
  });
  it('đoạn 1 từ → không tách; &, ;, CÙNG đều tách; 1 người → không đổi', () => {
    expect(splitJointOwner(makeParty({ full_name: 'AN, BÌNH' }))).toHaveLength(1);
    for (const sep of [' & ', '; ', ' CÙNG ']) expect(splitJointOwner(makeParty({ full_name: `LÊ VĂN AN${sep}LÊ THỊ BÌNH` }))).toHaveLength(2);
    const one = makeParty({ full_name: 'LÊ VĂN AN' });
    expect(splitJointOwner(one)).toEqual([one]);
  });
});

describe('buildRegistry', () => {
  it('S3-AC01: vợ là đồng vay → 1 người roles=[co_borrower] (không giữ other)', () => {
    const p = buildRegistry(loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 },
      { party_role: 'CO_BORROWER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
      { party_role: 'SPOUSE', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
    ]));
    expect(p.map((x) => [x.person_id, x.roles])).toEqual([['person-1', ['borrower']], ['person-2', ['co_borrower']]]);
    expect(p[1].other_role_detail).toBeNull();
  });

  it('S3-AC02: chủ TSBĐ là chính khách vay → 1 người [borrower, collateral_owner]', () => {
    const p = buildRegistry(loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 },
      { party_role: 'COLLATERAL_OWNER', full_name: 'Nguyễn Văn An', id_number: null },
    ]));
    expect(p).toHaveLength(1);
    expect(p[0].roles).toEqual(['borrower', 'collateral_owner']);
  });

  it('chủ TSBĐ không tên không số, quan hệ "Chính chủ" → gộp vào borrower', () => {
    const p = buildRegistry(loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN' },
      { party_role: 'COLLATERAL_OWNER', full_name: null, id_number: null },
    ], { relations: { 1: { raw: 'Chính chủ' } } }));
    expect(p[0].roles).toEqual(['borrower', 'collateral_owner']);
  });

  it('2 chủ TSBĐ → 2 person_id; tên khác chính tả → 2 người, cả hai cảnh báo', () => {
    const p = buildRegistry(loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN THỊ HẰNG', id_number: null },
      { party_role: 'COLLATERAL_OWNER', full_name: 'NGUYỄN THI HẰNG', id_number: null },
      { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ VĂN CƯỜNG', id_number: null },
    ]));
    expect(p.map((x) => x.person_id)).toEqual(['person-1', 'person-2', 'person-3']);
    expect(p[0].mapped[0].warnings).toContain('NAME_SPELLING_DIFFERENCE');
    expect(p[1].mapped[0].warnings).toContain('NAME_SPELLING_DIFFERENCE');
  });

  it('cặp 9/12 số, tên EXACT → cùng người; 2 số 12 khác → khác người', () => {
    expect(buildRegistry(loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 },
      { party_role: 'COLLATERAL_OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A9 },
    ]))).toHaveLength(1);
    expect(buildRegistry(loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 },
      { party_role: 'COLLATERAL_OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_B12 },
    ]))).toHaveLength(2);
  });

  it('party không tên không số → bỏ qua; thứ tự theo vai trò', () => {
    const p = buildRegistry(loanApp([
      { party_role: 'REFERENCE_PERSON', full_name: 'PHẠM VĂN DŨNG' },
      { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN' },
      { party_role: 'CO_BORROWER', full_name: null, id_number: null },
    ]));
    expect(p.map((x) => [x.roles, x.other_role_detail])).toEqual([[['borrower'], null], [['other'], 'reference_person']]);
  });

  it('anchor 1 người không đổi giữa 2 lần chạy', () => {
    const a = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN' }]);
    expect(JSON.stringify(buildRegistry(a), (_k, v) => (v instanceof Set ? [...v] : v))).toBe(JSON.stringify(buildRegistry(a), (_k, v) => (v instanceof Set ? [...v] : v)));
    void ev;
  });
});
