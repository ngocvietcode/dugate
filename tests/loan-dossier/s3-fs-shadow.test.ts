// T-FS-03 — chế độ shadow (FS-AC03, FS-AC10): output S3 giống hệt luật; thống kê chỉ có số đếm.
import { runMapStage } from '@/lib/pipelines/workflows/loan-appraisal/dossier-map';

import { ev, loanApp } from './fixtures/dossier';

const A = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN HÙNG', id_number: '001090000001', date_of_birth: '1990-05-01', gender: 'MALE' };
const evidences = [
  loanApp([A]),
  ev('id_card', { parties: [{ ...A, party_role: 'HOLDER' }] }),
  ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYEN VAN HUNG', id_number: null, date_of_birth: A.date_of_birth, gender: 'MALE' }] }),
];
const now = () => new Date('2026-10-14T00:00:00Z');

it('shadow: data giống rules; fs_shadow đếm khác biệt, không chứa giá trị', () => {
  const rules = runMapStage(evidences, {}, now);
  const shadow = runMapStage(evidences, { s3_matcher: 'shadow' }, now);
  expect(shadow.data).toEqual(rules.data);
  expect(rules.fs_shadow).toBeUndefined();
  // Thẻ thứ 2 (tên khác dấu, cùng ngày sinh): luật không ghép (S3-R08), FS ghép.
  expect(shadow.fs_shadow).toMatchObject({ params_version: '0.1.0-expert', parties: 2, same: 1, fs_only: 1, rules_only: 0, different_person: 0 });
  const text = JSON.stringify(shadow.fs_shadow);
  for (const v of ['NGUYỄN VĂN HÙNG', 'NGUYEN VAN HUNG', A.id_number, A.date_of_birth]) expect(text).not.toContain(v);
});
