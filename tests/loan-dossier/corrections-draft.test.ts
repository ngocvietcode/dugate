// T-COR-08 — kiểm bản nháp hiệu chỉnh do LLM dịch (COR-R19, R20; COR-AC12, COR-AC13, COR-AC14).
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { renderLoanApplicationContext } from '@/lib/loan-dossier/context/render';
import { lacScopeFromInputs } from '@/lib/loan-dossier/context/scope';
import { buildCandidates, validateDrafts } from '@/lib/loan-dossier/corrections/draft';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';

import { ev, loanApp } from './fixtures/dossier';

const RIGHT = '001090000001';
const READ = '001090000007';
const app = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN HÙNG', id_number: RIGHT, date_of_birth: '1990-05-01' }]);
const card = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN HÙNG', id_number: READ, date_of_birth: '1990-05-01' }] });
const father = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN HÙNG', date_of_birth: '1965-01-01' }] });
const gcn = (cert: string) => ev('land_use_certificate', { parties: [{ party_role: 'OWNER', full_name: 'NGUYỄN VĂN HÙNG', id_number: RIGHT }], assets: [{ asset_type: 'real_estate', usage_context_hint: null, identifiers: { certificate_number: cert } }] });
const g1 = gcn('AA 1234');
const g2 = gcn('AA 123 4');
const evidences = [app, card, father, g1, g2];
const s3 = runMapDossier({ evidences, dossier_submitted_at: '2026-10-14' }).data;
const lac = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: 'SUCCESS' });
const render = renderLoanApplicationContext(lac, lacScopeFromInputs([[]]));
const candidates = buildCandidates(s3, lac, render, (k) => k);

const cardRecord = `${card.evidence_id}#parties[0].id_number`;
/** Mã F<n>.<k> trỏ đúng lá CCCD đọc sai. */
const targetCode = [...render.refIndex].find(([code, ids]) => code.includes('.') && ids.length === 1 && ids[0] === cardRecord)![0];
const codeOf = (pick: (c: { evidence_id: string; index: number }) => boolean, map: Map<string, { evidence_id: string; index: number }>) => [...map].find(([, v]) => pick(v))![0];
const run = (instruction: string, items: unknown[]) => validateDrafts({ items }, { instruction, candidates, lac, refIndex: render.refIndex, factIndex: render.factIndex, evidences });

const INSTR = 'Số CCCD của khách vay đúng là 001090000001. AA 1234 và AA 123 4 là cùng một tài sản.';

it('COR-AC12: OCR_FIX đúng lá, value lấy từ chỉ thị; reason mặc định là đoạn trích', () => {
  const [d] = run(INSTR, [{ kind: 'OCR_FIX', target: targetCode, value: RIGHT, quote: 'Số CCCD của khách vay đúng là 001090000001' }]);
  expect(d).toMatchObject({ status: 'PROPOSED', correction: { kind: 'OCR_FIX', record_id: cardRecord, original_value: READ, value: RIGHT }, quote: 'Số CCCD của khách vay đúng là 001090000001' });
});

it('COR-AC12: model tự nghĩ ra giá trị không có trong chỉ thị → REJECTED', () => {
  const [d] = run(INSTR, [{ kind: 'OCR_FIX', target: targetCode, value: '001090000009', quote: 'Số CCCD của khách vay đúng là 001090000001' }]);
  expect(d).toMatchObject({ status: 'REJECTED', code: 'VALUE_NOT_IN_INSTRUCTION', correction: null });
});

it('COR-AC13: hai số GCN đã cùng khóa → NO_CHANGE', () => {
  const a = codeOf((v) => v.evidence_id === g1.evidence_id, candidates.assets);
  const b = codeOf((v) => v.evidence_id === g2.evidence_id, candidates.assets);
  const [d] = run(INSTR, [{ kind: 'SAME_SUBJECT', a, b, quote: 'AA 1234 và AA 123 4 là cùng một tài sản' }]);
  expect(d.status).toBe('NO_CHANGE');
  expect(d.correction).toBeNull();
});

it('COR-AC14: mã không có trong bảng ứng viên, hoặc đoạn trích không có trong chỉ thị → REJECTED', () => {
  const [x, y] = run(INSTR, [
    { kind: 'DIFFERENT_SUBJECT', a: 'P99', b: 'P1', quote: 'Số CCCD' },
    { kind: 'OCR_FIX', target: targetCode, value: RIGHT, quote: 'câu không có trong chỉ thị' },
  ]);
  expect(x).toMatchObject({ status: 'REJECTED', code: 'UNKNOWN_REF' });
  expect(y).toMatchObject({ status: 'REJECTED', code: 'QUOTE_MISMATCH' });
});

it('DIFFERENT_SUBJECT cha / con đang bị gộp → PROPOSED với mã ổn định; CLARIFY → cần làm rõ', () => {
  const borrowerAnchor = codeOf((v) => v.evidence_id === app.evidence_id, candidates.parties);
  const fatherCode = codeOf((v) => v.evidence_id === father.evidence_id, candidates.parties);
  const [d, c] = run('Người sinh 1965 không phải khách vay, là bố.', [
    { kind: 'DIFFERENT_SUBJECT', a: borrowerAnchor, b: fatherCode, quote: 'Người sinh 1965 không phải khách vay' },
    { kind: 'CLARIFY', quote: 'là bố', note: 'Quan hệ cha con cần giấy khai sinh' },
  ]);
  expect(d).toMatchObject({ status: 'PROPOSED', correction: { kind: 'DIFFERENT_SUBJECT', subject_kind: 'person', a: { evidence_id: app.evidence_id, index: 0 }, b: { evidence_id: father.evidence_id, index: 0 } } });
  expect(JSON.stringify(d.correction)).not.toMatch(/person-\d|"P\d+"/);
  expect(c).toMatchObject({ status: 'NEEDS_CLARIFICATION', correction: null });
});

it('đầu ra hỏng / mục sai hình dạng không làm vỡ: mỗi mục một kết quả, không có mục nào áp được', () => {
  expect(validateDrafts('rác', { instruction: INSTR, candidates, lac, refIndex: render.refIndex, factIndex: render.factIndex, evidences })).toEqual([]);
  const out = run(INSTR, [{ kind: 'XÓA_HẾT' }, 7]);
  expect(out.every((d) => d.status === 'REJECTED' && d.correction === null)).toBe(true);
});
