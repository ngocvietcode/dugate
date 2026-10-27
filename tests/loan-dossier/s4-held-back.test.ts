// S4-R28 (D-64): có chứng từ đúng loại nhưng chưa gán chắc cho người → "Cần rà soát", không báo "Thiếu".
import { buildIntakeAssessment } from '@/lib/pipelines/workflows/loan-appraisal/intake-assessment';

import { ev, loanApp } from './fixtures/dossier';
import { runDossier } from './fixtures/master';

const H = '001054003818';
const W = '001158000017';
const cert = (wifeName: string, hId: string | null, wId: string | null) => ev('marriage_certificate', {
  parties: [
    { party_role: 'WIFE', full_name: wifeName, id_number: wId, date_of_birth: '1958' },
    { party_role: 'HUSBAND', full_name: 'PHẠM TIẾN ANH', id_number: hId, date_of_birth: '1954' },
  ],
  data: { marital_status: 'MARRIED' },
});
const borrower = (id: string | null, name = 'PHẠM TIẾN ANH') => ({ party_role: 'BORROWER', full_name: name, id_number: id });
const spouse = (name: string, id: string | null) => ({ party_role: 'CO_BORROWER', full_name: name, id_number: id });
const idCard = (id: string, dob: string) => ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'PHẠM TIẾN ANH', id_number: id, date_of_birth: dob }] });

async function marriageRows(evs: ReturnType<typeof ev>[]) {
  const r = await runDossier(evs);
  return { r, rows: (r.s4.data?.items ?? []).filter((i) => i.item_key === 'legal_marriage_certificate') };
}

describe('S4-R28: chứng từ có trong hồ sơ nhưng chưa gán chắc cho người', () => {
  it('S4-AC28: vợ ghi "NGHIÊM" còn đề nghị vay ghi "NGHIỆM" (chồng ghép được) → vợ NEEDS_REVIEW/DOCUMENT_OWNER_UNCONFIRMED, không MISSING', async () => {
    const { rows } = await marriageRows([loanApp([borrower(H), spouse('NGHIỆM THỊ MINH', null)]), cert('NGHIÊM THỊ MINH', H, W)]);
    const [husband, wife] = rows;
    expect(husband).toMatchObject({ status: 'PRESENT', reason_code: 'DOCUMENT_FOUND' });
    expect(wife).toMatchObject({ status: 'NEEDS_REVIEW', reason_code: 'DOCUMENT_OWNER_UNCONFIRMED', suggested_action: 'REVIEW_CONTEXT' });
    expect(wife.found_in).toHaveLength(1);
    expect(wife.message).toContain('khác chính tả');
    expect(wife.message).toContain('không phải thiếu chứng từ');
  });

  it('S4-AC28: cả hai người lệch chính tả, không khớp số → cả hai NEEDS_REVIEW (không còn "Thiếu")', async () => {
    const { rows } = await marriageRows([
      loanApp([borrower('001054999999', 'PHẠM TIẾN ÁNH'), spouse('NGHIỆM THỊ MINH', '001158999999')]),
      cert('NGHIÊM THỊ MINH', H, W),
    ]);
    expect(rows.map((r) => [r.status, r.reason_code])).toEqual([['NEEDS_REVIEW', 'DOCUMENT_OWNER_UNCONFIRMED'], ['NEEDS_REVIEW', 'DOCUMENT_OWNER_UNCONFIRMED']]);
  });

  it('S4-AC29: người trên chứng từ có danh tính xung đột → người đó ROLE_CONFLICT_UNRESOLVED, người còn lại DOCUMENT_OWNER_UNCONFIRMED (không MISSING)', async () => {
    const { rows } = await marriageRows([
      loanApp([borrower(H), spouse('NGHIÊM THỊ MINH', W)]),
      idCard(H, '1954-03-12'), idCard('001054000001', '1955-05-05'),
      cert('NGHIÊM THỊ MINH', H, W),
    ]);
    expect(rows.map((r) => [r.status, r.reason_code])).toEqual([['NEEDS_REVIEW', 'ROLE_CONFLICT_UNRESOLVED'], ['NEEDS_REVIEW', 'DOCUMENT_OWNER_UNCONFIRMED']]);
  });

  it('không có chứng từ nào → vẫn MISSING; tên khác hẳn → vẫn MISSING (không gán bừa)', async () => {
    const none = await marriageRows([loanApp([borrower(H), spouse('NGHIÊM THỊ MINH', W)])]);
    expect(none.rows.map((r) => r.status)).toEqual(['MISSING', 'MISSING']);
    const other = ev('marriage_certificate', {
      parties: [{ party_role: 'WIFE', full_name: 'LÊ THỊ HOA', id_number: null }, { party_role: 'HUSBAND', full_name: 'TRẦN VĂN BÌNH', id_number: null }],
      data: { marital_status: 'MARRIED' },
    });
    const diff = await marriageRows([loanApp([borrower(H), spouse('NGHIÊM THỊ MINH', W)]), other]);
    expect(diff.rows.map((r) => r.status)).toEqual(['MISSING', 'MISSING']);
  });

  it('tiêu chí 1 của Sale không báo "Thiếu" nữa; vấn đề chuyển sang tiêu chí 2 (cần xác nhận), mỗi người một điểm', async () => {
    const { r } = await marriageRows([loanApp([borrower(H), spouse('NGHIỆM THỊ MINH', null)]), cert('NGHIÊM THỊ MINH', H, W)]);
    const a = buildIntakeAssessment({
      classify: null, evidences: r.evidences, s3: r.s3.data, checklist: r.s4.data, crossCheck: r.s5.data, master: r.master, acknowledgements: [],
    });
    expect(a.criteria[0].findings.filter((f) => f.message.includes('kết hôn'))).toEqual([]);
    const owner = a.criteria[1].findings.filter((f) => f.code.startsWith('DOC_OWNER:legal_marriage_certificate:'));
    expect(owner).toHaveLength(1);
    expect(owner[0].message).toContain('NGHIỆM THỊ MINH');
    expect(owner[0].acknowledgeable).toBe(true);
  });
});
