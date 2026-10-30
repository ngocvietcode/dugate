// T-COR-01 — hợp đồng case input và niêm phong (case_corrections.md COR-R03, COR-R14; COR-AC02).
import { CASE_INPUT_CONTRACT, CASE_INPUT_VERSION, CaseInputSchema, MAX_CORRECTIONS } from '@/lib/loan-dossier/corrections/schema';
import { canonicalJson, sealCase, verifyCaseSeal, type SealSubject } from '@/lib/loan-dossier/corrections/seal';

import { classifyOf, ev, ID_A12, loanApp } from './fixtures/dossier';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const evidences = [loanApp([borrower]), ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER' }] })];
const classify = classifyOf(evidences);
const subject = (): SealSubject => ({
  source_operation_id: 'op-1', product_code: 'hkd-loan', flow: 'FULL', workflow_version: '2.0.0',
  documents: JSON.parse(JSON.stringify({ classify: { files: classify.files, repeated_doc_types: classify.repeated_doc_types }, evidences })),
  dossier_precheck: { status: 'SKIPPED' },
});
const base = { reason: 'Đã đối chiếu bản gốc', corrected_by: 'user-01', corrected_at: '2026-10-30T09:00:00+07:00' };
const recordId = `${evidences[1].evidence_id}#parties[0].id_number`;

function caseInput(corrections: unknown[] = []) {
  const s = subject();
  return { contract: CASE_INPUT_CONTRACT, contract_version: CASE_INPUT_VERSION, documents: s.documents, dossier_precheck: s.dossier_precheck, case_seal: sealCase(s), corrections };
}

beforeAll(() => { process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcd'; });

describe('niêm phong', () => {
  it('seal rồi verify → true; bản sao JSON vẫn verify được', () => {
    const s = subject();
    const seal = sealCase(s);
    expect(seal.mac).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCaseSeal(seal, JSON.parse(JSON.stringify(s.documents)), s.dossier_precheck)).toBe(true);
  });

  it('COR-AC02: đổi 1 ký tự documents, đổi product_code / flow, đổi precheck → false', () => {
    const s = subject();
    const seal = sealCase(s);
    const docs = JSON.parse(JSON.stringify(s.documents));
    docs.evidences[1].data.parties[0].id_number = `${ID_A12.slice(0, -1)}9`;
    expect(verifyCaseSeal(seal, docs, s.dossier_precheck)).toBe(false);
    expect(verifyCaseSeal({ ...seal, product_code: 'sme-loan' }, s.documents, s.dossier_precheck)).toBe(false);
    expect(verifyCaseSeal({ ...seal, flow: 'FAST' }, s.documents, s.dossier_precheck)).toBe(false);
    expect(verifyCaseSeal(seal, s.documents, { status: 'PASS' })).toBe(false);
  });

  it('key_id lạ, mac sai độ dài, khóa khác → false, không ném lỗi', () => {
    const s = subject();
    const seal = sealCase(s);
    expect(verifyCaseSeal({ ...seal, key_id: 'v2' as never }, s.documents, s.dossier_precheck)).toBe(false);
    expect(verifyCaseSeal({ ...seal, mac: 'ab' }, s.documents, s.dossier_precheck)).toBe(false);
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'another-test-key-0123456789abcdef';
    expect(verifyCaseSeal(seal, s.documents, s.dossier_precheck)).toBe(false);
    process.env.ENCRYPTION_KEY = saved;
  });

  it('canonicalJson không phụ thuộc thứ tự khóa, giữ thứ tự mảng', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
    expect(canonicalJson({ a: undefined, b: 'x' })).toBe('{"b":"x"}');
  });
});

describe('CaseInputSchema', () => {
  const fix = { ...base, correction_id: 'c1', kind: 'OCR_FIX', record_id: recordId, original_value: ID_A12, value: '079199912345' };

  it('nhận case input hợp lệ với ba loại hiệu chỉnh', () => {
    const ok = CaseInputSchema.safeParse(caseInput([
      fix,
      { ...base, correction_id: 'c2', kind: 'FACT_RESOLUTION', record_ids: [recordId, `${evidences[0].evidence_id}#parties[0].id_number`], chosen_record_id: recordId },
      { ...base, correction_id: 'c3', kind: 'DIFFERENT_SUBJECT', subject_kind: 'person', a: { evidence_id: evidences[0].evidence_id, index: 0 }, b: { evidence_id: evidences[1].evidence_id, index: 0 } },
    ]));
    expect(ok.success).toBe(true);
  });

  it('từ chối field lạ, correction_id trùng, chosen ∉ record_ids, a = b, quá số lượng, lý do rỗng', () => {
    expect(CaseInputSchema.safeParse({ ...caseInput([fix]), extra: 1 }).success).toBe(false);
    expect(CaseInputSchema.safeParse(caseInput([fix, { ...fix }])).success).toBe(false);
    expect(CaseInputSchema.safeParse(caseInput([{ ...base, correction_id: 'c2', kind: 'FACT_RESOLUTION', record_ids: [recordId, `${recordId}x`], chosen_record_id: `${recordId}y` }])).success).toBe(false);
    const occ = { evidence_id: evidences[0].evidence_id, index: 0 };
    expect(CaseInputSchema.safeParse(caseInput([{ ...base, correction_id: 'c3', kind: 'SAME_SUBJECT', subject_kind: 'asset', a: occ, b: occ }])).success).toBe(false);
    expect(CaseInputSchema.safeParse(caseInput(Array.from({ length: MAX_CORRECTIONS + 1 }, (_, i) => ({ ...fix, correction_id: `c${i}` })))).success).toBe(false);
    expect(CaseInputSchema.safeParse(caseInput([{ ...fix, reason: '   ' }])).success).toBe(false);
    expect(CaseInputSchema.safeParse(caseInput([{ ...fix, record_id: 'không-phải-record' }])).success).toBe(false);
  });
});
