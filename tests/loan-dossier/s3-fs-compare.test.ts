// T-FS-02 — bộ so sánh và catalog tham số Fellegi-Sunter (spec s3_fellegi_sunter.md §3.2, FS-R04, FS-R09).
import { comparePair } from '@/lib/loan-dossier/s3/fs/compare';
import { loadFsParams, parseFsParams } from '@/lib/loan-dossier/s3/fs/params';
import type { Person } from '@/lib/loan-dossier/s3/types';
import type { DocumentParty } from '@/lib/loan-dossier/s2/common-schema';

import { makeParty } from './fixtures/build';

const base: Partial<DocumentParty> = { full_name: 'NGUYỄN VĂN HÙNG', id_number: '001090000001', date_of_birth: '1990-05-01', gender: 'MALE' };
const other = makeParty(base);
const person = { known_ids: new Set(['001090000001']) } as unknown as Person;
const levels = (o: Partial<DocumentParty>, confidence = 1) => comparePair(makeParty({ ...base, ...o }), confidence, other, person);

describe('comparePair (§3.2)', () => {
  it.each([
    ['id AGREE, bỏ giới tính + cấu trúc (FS-R04)', {}, { id_number: 'AGREE', gender: 'MISSING', id_structure: 'MISSING' }],
    ['id NEAR', { id_number: '001090000007' }, { id_number: 'NEAR', gender: 'MISSING' }],
    ['id OLD_NEW (9 ↔ 12)', { id_number: '012345678' }, { id_number: 'OLD_NEW' }],
    ['id DISAGREE, cấu trúc lệch năm sinh', { id_number: '001060000009' }, { id_number: 'DISAGREE', id_structure: 'INCONSISTENT', gender: 'AGREE' }],
    ['id confidence thấp → MISSING', { id_number: '001060000009' }, { id_number: 'MISSING' }, 0.3],
    ['tên khác dấu', { full_name: 'NGUYEN VAN HUNG' }, { full_name: 'SPELLING_DIFFERENCE' }],
    ['ngày / tháng đảo', { date_of_birth: '1990-01-05' }, { date_of_birth: 'DAY_MONTH_SWAPPED' }],
    ['ngày sinh khác', { date_of_birth: '1960-02-02' }, { date_of_birth: 'DISAGREE' }],
    ['không có ngày sinh', { date_of_birth: null }, { date_of_birth: 'MISSING' }],
  ] as Array<[string, Partial<DocumentParty>, Record<string, string>, number?]>)('%s', (_label, o, expected, confidence = 1) => {
    expect(levels(o, confidence)).toMatchObject(expected);
  });
});

describe('fs_params.json (FS-R09)', () => {
  it('catalog trong repo hợp lệ; upper ≤ lower → ok: false', () => {
    const current = loadFsParams();
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(parseFsParams({ ...current.params, thresholds: { upper: 0, lower: 0, ambiguity_margin: 6 } }).ok).toBe(false);
  });
});
