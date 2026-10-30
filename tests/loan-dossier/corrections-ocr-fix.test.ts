// T-COR-02 — áp OCR_FIX lên evidence (COR-R07; COR-AC03, COR-AC04).
import { applyOcrFixes } from '@/lib/loan-dossier/corrections/ocr-fix';
import type { OcrFix } from '@/lib/loan-dossier/corrections/schema';

import { ev, ID_A12, loanApp } from './fixtures/dossier';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const idCard = () => ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER', id_number: `${ID_A12.slice(0, -1)}7` }, { ...borrower, party_role: 'HOLDER', full_name: 'TRẦN B' }] });
const fix = (record_id: string, original_value: OcrFix['original_value'], value: OcrFix['value'], extra: Partial<OcrFix> = {}): OcrFix => ({
  correction_id: 'c1', kind: 'OCR_FIX', reason: 'đọc sai', corrected_by: 'u1', corrected_at: '2026-10-30T09:00:00Z', record_id, original_value, value, ...extra,
});

describe('applyOcrFixes', () => {
  it('không có bản vá → bản sao sâu bằng đầu vào, không cùng tham chiếu', () => {
    const evs = [loanApp([borrower]), idCard()];
    const out = applyOcrFixes(evs, []);
    expect(out.evidences).toEqual(evs);
    expect(out.evidences[0]).not.toBe(evs[0]);
    expect(out.report).toEqual({ applied: [], skipped: [] });
  });

  it('COR-AC03: sửa đúng phần tử mảng; đầu vào không đổi; field_confidences giữ nguyên', () => {
    const card = idCard();
    const before = JSON.stringify(card);
    const rid = `${card.evidence_id}#parties[0].id_number`;
    const out = applyOcrFixes([card], [fix(rid, `${ID_A12.slice(0, -1)}7`, ID_A12)]);
    const data = out.evidences[0].data as { parties: Array<{ id_number: string; full_name: string }> };
    expect(data.parties[0].id_number).toBe(ID_A12);
    expect(data.parties[1].full_name).toBe('TRẦN B');
    expect(out.evidences[0].field_confidences).toEqual(card.field_confidences);
    expect(out.edited_record_ids).toEqual([rid]);
    expect(JSON.stringify(card)).toBe(before);
  });

  it('original_value so sau chuẩn hóa (khoảng trắng, hoa thường)', () => {
    const card = ev('land_use_certificate', { data: { certificate_number: 'AB 000123' } });
    const out = applyOcrFixes([card], [fix(`${card.evidence_id}#certificate_number`, 'ab000123', 'AB 000128')]);
    expect(out.report.applied).toHaveLength(1);
  });

  it('mỗi mã bỏ qua có một ca', () => {
    const card = idCard();
    const rid = `${card.evidence_id}#parties[0].id_number`;
    const err = { ...ev('cic', {}), status: 'ERROR' as const, data: null, reason_code: 'OCR_FAILED' };
    const cases: Array<[OcrFix, string]> = [
      [fix(`ev-000000000000#parties[0].id_number`, 'x', 'y'), 'ORPHAN_EDIT'],
      [fix(`${card.evidence_id}#parties[5].id_number`, 'x', 'y'), 'ORPHAN_EDIT'],
      [fix(`${card.evidence_id}#parties[0]`, null, 'y'), 'FIELD_NOT_EDITABLE'],
      [fix(`${err.evidence_id}#x`, null, 'y'), 'EDIT_ON_ERROR_EVIDENCE'],
      [fix(rid, '001', ID_A12), 'EDIT_BASE_CHANGED'],
      [fix(rid, `${ID_A12.slice(0, -1)}7`, 12), 'INVALID_VALUE'],
    ];
    for (const [f, code] of cases) {
      const out = applyOcrFixes([card, err], [f]);
      expect(out.report.skipped).toEqual([{ correction_id: 'c1', kind: 'OCR_FIX', code }]);
      expect(out.edited_record_ids).toEqual([]);
    }
  });

  it('hai bản vá cùng lá → corrected_at mới nhất thắng, bản kia DUPLICATE_TARGET', () => {
    const card = idCard();
    const rid = `${card.evidence_id}#parties[0].id_number`;
    const old = `${ID_A12.slice(0, -1)}7`;
    const out = applyOcrFixes([card], [
      fix(rid, old, '111', { correction_id: 'new', corrected_at: '2026-10-30T10:00:00Z' }),
      fix(rid, old, '222', { correction_id: 'old', corrected_at: '2026-10-30T08:00:00Z' }),
    ]);
    expect((out.evidences[0].data as { parties: Array<{ id_number: string }> }).parties[0].id_number).toBe('111');
    expect(out.report.skipped).toEqual([{ correction_id: 'old', kind: 'OCR_FIX', code: 'DUPLICATE_TARGET' }]);
  });
});
