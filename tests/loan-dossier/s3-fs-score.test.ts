// T-FS-03 — bộ chấm Fellegi-Sunter (spec s3_fellegi_sunter.md §1, §3.3; FS-AC04, FS-AC05).
import { loadFsParams } from '@/lib/loan-dossier/s3/fs/params';
import { matchPartiesFs } from '@/lib/loan-dossier/s3/fs/score';
import { buildRegistry } from '@/lib/loan-dossier/s3/registry';
import { partyKey } from '@/lib/loan-dossier/s3/types';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, loanApp } from './fixtures/dossier';

const loaded = loadFsParams();
if (!loaded.ok) throw new Error(loaded.reason);
const params = loaded.params;

const A = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN HÙNG', id_number: '001090000001', date_of_birth: '1990-05-01', gender: 'MALE' };

function decide(anchor: EvidenceEnvelope, probe: Record<string, unknown>) {
  const card = ev('id_card', { parties: [{ ...probe, party_role: 'HOLDER' }] });
  const { decisions } = matchPartiesFs(buildRegistry(anchor), [anchor, card], anchor.evidence_id, params);
  return decisions.get(partyKey({ evidence_id: card.evidence_id, party_index: 0, sub_index: null }))!;
}

describe('matchPartiesFs', () => {
  it.each([
    ['1. cùng tên, khác số, khác ngày sinh', { full_name: A.full_name, id_number: '001060000009', date_of_birth: '1960-02-02', gender: 'MALE' }, 'NO_IDENTITY_MATCH'],
    ['2. tên khác dấu, không số, cùng ngày sinh', { full_name: 'NGUYEN VAN HUNG', id_number: null, date_of_birth: A.date_of_birth, gender: 'MALE' }, 'MATCH'],
    ['3. số lệch 1 ký tự', { full_name: A.full_name, id_number: '001090000007', date_of_birth: A.date_of_birth, gender: 'MALE' }, 'MATCH'],
    ['4. chỉ trùng tên', { full_name: A.full_name, id_number: null, date_of_birth: null, gender: null }, 'POSSIBLE_MATCH'],
    ['5. cùng số, tên sai dấu', { full_name: 'NGUYỄN VĂN HƯNG', id_number: A.id_number, date_of_birth: A.date_of_birth, gender: 'MALE' }, 'MATCH'],
  ])('FS-AC04 %s → %s', (_label, probe, expected) => {
    expect(decide(loanApp([A]), probe).decision).toBe(expected);
  });

  it('FS-AC05: hai người cùng tên, cùng ngày sinh, party không số → AMBIGUOUS_IDENTITY_MATCH', () => {
    const twins = loanApp([A, { ...A, party_role: 'CO_BORROWER', id_number: '001090000002' }]);
    expect(decide(twins, { full_name: A.full_name, id_number: null, date_of_birth: A.date_of_birth, gender: 'MALE' }).decision).toBe('AMBIGUOUS_IDENTITY_MATCH');
  });
});
