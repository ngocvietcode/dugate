// T-S2-07 — trạng thái nhóm trùng (S2-R17, S2-R18).
import { groupDuplicates } from '@/lib/loan-dossier/s2/duplicates';
import type { AssetKeyFn } from '@/lib/loan-dossier/s2/dedup-key';
import { assetKeys } from '@/lib/loan-dossier/s3/asset-key';
import type { AssetDescriptor, EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { makeEvidence, makeParty } from './fixtures/build';
import { ev } from './fixtures/dossier';

const keyFn: AssetKeyFn = (a) => assetKeys(a as unknown as AssetDescriptor);
const HIGH = { parties: 0.9, loan_info: 0.9, legal_info: 0.9 };

function loanApp(overrides: Partial<EvidenceEnvelope> = {}, partyOverrides: Parameters<typeof makeParty>[0] = {}): EvidenceEnvelope {
  const e = makeEvidence('loan_application', { field_confidences: HIGH, ...overrides });
  const parties = [makeParty({ party_role: 'BORROWER', ...partyOverrides }), makeParty({ party_index: 1, party_role: 'SPOUSE', full_name: 'TRAN THI B', id_number: '000000000001' })];
  return { ...e, data: { ...e.data!, parties } };
}

describe('groupDuplicates', () => {
  it('S2-AC08: 2 loan_application giống hệt → cùng nhóm, CONFIRMED_DUPLICATE', () => {
    const out = groupDuplicates([loanApp({ evidence_id: 'ev-00000000000a' }), loanApp({ evidence_id: 'ev-00000000000b' })], keyFn);
    expect(out.map((e) => e.duplicate_group_id)).toEqual(['dup-1', 'dup-1']);
    expect(out[0]).toMatchObject({ duplicate_status: 'CONFIRMED_DUPLICATE', differing_fields: [] });
  });

  it('S2-AC09: khác ngày sinh, confidence 0.9 → CONFLICTING_DUPLICATES, nêu đường dẫn', () => {
    const out = groupDuplicates([loanApp(), loanApp({}, { date_of_birth: '1991-02-02' })], keyFn);
    expect(out[0].duplicate_status).toBe('CONFLICTING_DUPLICATES');
    expect(out[0].differing_fields).toEqual([expect.stringMatching(/^parties\[\d\]\.date_of_birth$/)]);
  });

  it('khác nhưng confidence thấp → DUPLICATE_CANDIDATE', () => {
    const out = groupDuplicates([loanApp(), loanApp({ field_confidences: { ...HIGH, parties: 0.6 } }, { date_of_birth: '1991-02-02' })], keyFn);
    expect(out[0].duplicate_status).toBe('DUPLICATE_CANDIDATE');
  });

  it('lá has_front_side / *_page khác nhau không tính là khác', () => {
    const a = makeEvidence('id_card', { field_confidences: { parties: 0.9, card_info: 0.9 } });
    const b = { ...a, data: { ...a.data!, card_info: { ...(a.data!.card_info as object), has_front_side: true, has_back_side: false } } };
    const a2 = { ...a, data: { ...a.data!, card_info: { ...(a.data!.card_info as object), has_front_side: false, has_back_side: true } } };
    expect(groupDuplicates([a2, b], keyFn)[0].duplicate_status).toBe('CONFIRMED_DUPLICATE');
  });

  it('một bên null → không tính là khác', () => {
    const out = groupDuplicates([loanApp(), loanApp({}, { date_of_birth: null })], keyFn);
    expect(out[0].duplicate_status).toBe('CONFIRMED_DUPLICATE');
  });

  it('nhóm chỉ nhờ tên → DUPLICATE_CANDIDATE', () => {
    const e = makeEvidence('cic', { field_confidences: { parties: 0.9 } });
    const noId = { ...e, data: { ...e.data!, parties: [makeParty({ id_number: null })] } };
    expect(groupDuplicates([noId, { ...noId }], keyFn)[0].duplicate_status).toBe('DUPLICATE_CANDIDATE');
  });

  it('parties khác thứ tự vẫn cùng kết quả', () => {
    const a = loanApp();
    const b = { ...a, data: { ...a.data!, parties: [...(a.data!.parties as unknown[])].reverse() } };
    expect(groupDuplicates([a, b], keyFn)[0]).toMatchObject({ duplicate_status: 'CONFIRMED_DUPLICATE', differing_fields: [] });
  });

  it('evidence ERROR không tham gia nhóm; nhóm đánh số theo thứ tự xuất hiện', () => {
    const err = makeEvidence('loan_application', { status: 'ERROR', reason_code: 'FORM_NOT_FOUND', data: null });
    const c1 = makeEvidence('cic', { field_confidences: { parties: 0.9 } });
    const out = groupDuplicates([c1, err, loanApp(), { ...c1 }, loanApp()], keyFn);
    expect(out.map((e) => e.duplicate_group_id)).toEqual(['dup-1', null, 'dup-2', 'dup-1', 'dup-2']);
  });

  it('khác loại chứng từ không cùng nhóm dù cùng người', () => {
    const out = groupDuplicates([makeEvidence('cic'), makeEvidence('id_card')], keyFn);
    expect(out.map((e) => e.duplicate_group_id)).toEqual([null, null]);
  });

  describe('S2-R18b (D-43): bản trùng lệch 1 ký tự do đọc sai', () => {
    const gcn = (book: string, id: string) => ev('land_use_certificate', {
      id, parties: [], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AA 08798136', certificate_book_number: book } }],
    });

    it('3 bản GCN, 2 bản "CN 6475", 1 bản "CH.6475" (confidence cao) → không xung đột, vẫn nêu lá khác', () => {
      const out = groupDuplicates([gcn('CN 6475', 'ev-0000000000a1'), gcn('CN 6475', 'ev-0000000000a2'), gcn('CH.6475', 'ev-0000000000a3')], keyFn);
      expect(out.map((e) => e.duplicate_group_id)).toEqual(['dup-1', 'dup-1', 'dup-1']);
      expect(out[0].duplicate_status).toBe('DUPLICATE_CANDIDATE');
      expect(out[0].differing_fields).toEqual([expect.stringMatching(/^assets\[0\]\.identifiers\.certificate_book_number$/)]);
    });

    it('chỉ 2 bản lệch 1 ký tự → không có đa số, vẫn CONFLICTING_DUPLICATES', () => {
      const out = groupDuplicates([gcn('CN 6475', 'ev-0000000000b1'), gcn('CH.6475', 'ev-0000000000b2')], keyFn);
      expect(out[0].duplicate_status).toBe('CONFLICTING_DUPLICATES');
    });

    it('lệch 2 ký tự → vẫn CONFLICTING_DUPLICATES', () => {
      const out = groupDuplicates([gcn('CN 6475', 'ev-0000000000c1'), gcn('CN 6475', 'ev-0000000000c2'), gcn('CH 6476', 'ev-0000000000c3')], keyFn);
      expect(out[0].duplicate_status).toBe('CONFLICTING_DUPLICATES');
    });

    it('lá không phải mã/số (ngày sinh) lệch 1 ký tự → vẫn xung đột', () => {
      const out = groupDuplicates([loanApp(), loanApp(), loanApp({}, { date_of_birth: '1990-01-02' })], keyFn);
      expect(out[0].duplicate_status).toBe('CONFLICTING_DUPLICATES');
    });
  });
});
