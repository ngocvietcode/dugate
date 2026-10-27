// T-MD-09, T-MD-10 — đề xuất và áp dụng hiệu chỉnh master_dossier (MD-R15…R18, R20; MD-AC13…AC16).
import { MasterDossierSchema, MasterFieldSchema } from '@/lib/loan-dossier/contracts/master-dossier';
import type { MasterDossier, MasterField } from '@/lib/loan-dossier/contracts/master-dossier';
import { allowedDistance, applyMasterCorrections, formatOk, proposeMasterCorrections, type CorrectionDecision } from '@/lib/loan-dossier/master/correct';

import { ev, ID_A12, loanApp } from './fixtures/dossier';
import { runDossier } from './fixtures/master';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1990-01-01' };
const gcn = (book: string, file: string) => ({
  ...ev('land_use_certificate', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AA 08798136', certificate_book_number: book } }] }),
  file_name: file,
});
const app = () => loanApp([borrower], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136' } }] });
/** Trường của chứng từ GCN (đề nghị vay cũng có lá cùng tên nhưng chỉ một bản nên không xung đột). */
const docField = (m: MasterDossier, suffix: string) =>
  [...m.documents, ...m.other_documents].filter((d) => d.doc_type_key === 'land_use_certificate')
    .flatMap((d) => d.fields).find((f) => f.path.endsWith(suffix))!;
const select = (proposal_id: string, option_id: string | null, action: CorrectionDecision['action'] = 'SELECT'): CorrectionDecision => ({ proposal_id, action, option_id, reason: 'bản đa số khớp nhau' });

describe('hiệu chỉnh trên hồ sơ dựng thật (MD-AC13)', () => {
  // 3 bản GCN cùng nhóm trùng: 2 bản "CN 6475", 1 bản "CN 6457" (đảo 2 ký tự → cách 2, không phải OCR_NORMALIZED 1 ký tự).
  const build = () => runDossier([app(), gcn('CN 6475', 'so_do.pdf'), gcn('CN 6475', 'chung_thu.pdf'), gcn('CN 6457', 'dinh_gia.pdf')]);

  it('trường xung đột đủ căn cứ → 1 đề xuất; LLM chọn giá trị đa số → CORRECTED, REVIEW, giữ ứng viên', async () => {
    const { master, evidences } = await build();
    const before = docField(master, 'identifiers.certificate_book_number');
    expect(before).toMatchObject({ status: 'CONFLICT', value: null });

    const proposals = proposeMasterCorrections(master, evidences).filter((p) => p.path.endsWith('identifiers.certificate_book_number') && p.scope === 'document');
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.options.map((o) => o.value).sort()).toEqual(['CN 6457', 'CN 6475']);
    const pick = p.options.find((o) => o.value === 'CN 6475')!;

    const fixed = applyMasterCorrections(master, proposals, [select(p.proposal_id, pick.option_id)]);
    const f = docField(fixed, 'identifiers.certificate_book_number');
    expect(f).toMatchObject({ status: 'CORRECTED', value: 'CN 6475', review_status: 'REVIEW' });
    expect(f.candidates).toHaveLength(2);
    expect(f.outliers).toEqual([]);
    expect(f.correction).toMatchObject({ method: 'LLM_SELECTED_CANDIDATE', proposal_id: p.proposal_id, original: { status: 'CONFLICT', value: null }, distance: 2 });
    expect(f.correction!.minority).toEqual([expect.objectContaining({ raw_value: 'CN 6457' })]);
    expect(f.note).toContain('dinh_gia.pdf');
    expect(fixed.summary.corrected).toBe(1);
    expect(fixed.summary.conflict).toBe(master.summary.conflict - 1);
    expect(MasterDossierSchema.safeParse(fixed).success).toBe(true);
    // master gốc không bị sửa tại chỗ
    expect(docField(master, 'identifiers.certificate_book_number').status).toBe('CONFLICT');
  });

  it('LLM được chọn cả giá trị thiểu số (vẫn là giá trị đã đọc)', async () => {
    const { master, evidences } = await build();
    const [p] = proposeMasterCorrections(master, evidences).filter((x) => x.path.endsWith('identifiers.certificate_book_number') && x.scope === 'document');
    const odd = p.options.find((o) => o.value === 'CN 6457')!;
    const fixed = applyMasterCorrections(master, [p], [select(p.proposal_id, odd.option_id)]);
    expect(docField(fixed, 'identifiers.certificate_book_number')).toMatchObject({ status: 'CORRECTED', value: 'CN 6457' });
  });

  it('MD-AC10/MD-R18: cùng đầu vào → cùng đề xuất, cùng kết quả (so từng byte)', async () => {
    const { master, evidences } = await build();
    const a = proposeMasterCorrections(master, evidences);
    const b = proposeMasterCorrections(master, evidences);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const [p] = a.filter((x) => x.scope === 'document');
    const d = [select(p.proposal_id, p.options[0].option_id)];
    expect(JSON.stringify(applyMasterCorrections(master, a, d))).toBe(JSON.stringify(applyMasterCorrections(master, b, d)));
  });

  it('MD-AC14/MD-AC16: KEEP_CONFLICT, mã lạ, option_id ngoài danh sách → giữ nguyên master', async () => {
    const { master, evidences } = await build();
    const proposals = proposeMasterCorrections(master, evidences);
    const p = proposals.find((x) => x.scope === 'document')!;
    expect(applyMasterCorrections(master, proposals, [select(p.proposal_id, null, 'KEEP_CONFLICT')])).toBe(master);
    expect(applyMasterCorrections(master, proposals, [select('mc-000000000000', 'o1')])).toBe(master);
    expect(applyMasterCorrections(master, proposals, [select(p.proposal_id, 'o9')])).toBe(master);
    expect(applyMasterCorrections(master, proposals, [select(p.proposal_id, null)])).toBe(master);
    expect(applyMasterCorrections(master, proposals, [])).toBe(master);
    // quyết định kèm giá trị riêng (ngoài hợp đồng) không được dùng: chỉ option_id có nghĩa
    const sneaky = { ...select(p.proposal_id, 'o9'), value: 'CN 9999' } as CorrectionDecision;
    expect(applyMasterCorrections(master, proposals, [sneaky])).toBe(master);
  });

  it('quyết định đầu tiên của mỗi mã được dùng', async () => {
    const { master, evidences } = await build();
    const p = proposeMasterCorrections(master, evidences).find((x) => x.scope === 'document')!;
    const [a, b] = p.options;
    const fixed = applyMasterCorrections(master, [p], [select(p.proposal_id, a.option_id), select(p.proposal_id, b.option_id)]);
    expect(docField(fixed, 'identifiers.certificate_book_number').value).toBe(a.value);
  });
});

describe('hiệu chỉnh trường của người (MD-R08, MD-R15)', () => {
  const holder = (id: string) => ({ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: id, date_of_birth: '1990-01-01' });
  const build = (cicId: string) => runDossier([
    loanApp([{ ...borrower }]),
    ev('id_card', { parties: [holder(ID_A12)] }),
    ev('cic', { parties: [holder(cicId)] }),
  ]);

  it('CCCD: đề nghị vay + CCCD khớp, CIC lệch 2 ký tự (S5 MISMATCH) → đề xuất ở persons; LLM chọn → CORRECTED', async () => {
    const { master, evidences, s5 } = await build('001090000077');
    const row = s5.data!.results.find((r) => r.field_group === 'id_number')!;
    // Điều kiện tiên quyết: nếu S5 đổi cách xếp loại, test báo ở đây thay vì âm thầm bỏ qua.
    expect(row.match_status).toBe('MISMATCH');
    const before = master.persons[0].fields.find((x) => x.path === 'id_number')!;
    expect(before).toMatchObject({ status: 'CONFLICT', review_status: 'REVIEW', cross_check_result_id: row.result_id });

    const proposals = proposeMasterCorrections(master, evidences).filter((p) => p.scope === 'person' && p.path === 'id_number');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].options.map((o) => o.value).sort()).toEqual([ID_A12, '001090000077'].sort());
    const pick = proposals[0].options.find((o) => o.value === ID_A12)!;
    const fixed = applyMasterCorrections(master, proposals, [select(proposals[0].proposal_id, pick.option_id)]);
    const f = fixed.persons[0].fields.find((x) => x.path === 'id_number')!;
    expect(f).toMatchObject({ status: 'CORRECTED', value: ID_A12, review_status: 'REVIEW', cross_check_result_id: row.result_id, canonical_doc_type_key: before.canonical_doc_type_key });
    expect(f.correction).toMatchObject({ original: { status: 'CONFLICT', value: before.value }, distance: 2 });
    expect(MasterDossierSchema.safeParse(fixed).success).toBe(true);
    // trường người không nằm trong summary của chứng từ
    expect(fixed.summary.corrected).toBe(master.summary.corrected);
  });

  it('CCCD lệch 3 ký tự → không đề xuất (G2), trường giữ CONFLICT', async () => {
    const { master, evidences } = await build('001090000777');
    expect(proposeMasterCorrections(master, evidences).filter((p) => p.scope === 'person')).toEqual([]);
    expect(master.persons[0].fields.find((x) => x.path === 'id_number')!.status).toBe('CONFLICT');
  });
});

// ── Guard G1…G4 trên master dựng tay ────────────────────────────────────────────────
const EV = (n: number) => `ev-00000000000${n}`;
type Cand = { value: string; ev: number[] };
function manual(kind: MasterField['kind'], cands: Cand[], docTypes: Record<number, string>, path = 'parties[0].id_number') {
  const evidences = Object.entries(docTypes).map(([n, key]) => ({ ...ev(key), evidence_id: EV(Number(n)), field_confidences: { parties: 0.95, assets: 0.95 } }));
  const field: MasterField = {
    path, label: 'Trường thử', kind, value: null, status: 'CONFLICT', review_status: 'REVIEW', confidence: null, sources: [],
    candidates: cands.map((c) => ({ value: c.value, evidence_ids: c.ev.map((n) => `${EV(n)}#${path}`) })), outliers: [], note: 'x',
  };
  const master = {
    master_version: '1.0', program_key: null, product_code: null, flow: null, other_documents: [], persons: [], assets: [],
    documents: [{ document_id: 'mdoc-1', item_key: null, item_label: null, checklist_group: null, required: null, checklist_status: null, doc_type_key: null, doc_type_label: null, person_id: null, asset_id: null, copies: [], fields: [field] }],
    summary: { documents_total: 1, documents_present: 0, fields_total: 1, agreed: 0, ocr_normalized: 0, single_source: 0, conflict: 1, missing: 0, corrected: 0 },
  } as unknown as MasterDossier;
  return { master, evidences: evidences as never[] };
}

describe('cổng gửi LLM (MD-R15, MD-AC15): biến thể đọc sai của cùng một giá trị', () => {
  const types = { 1: 'id_card', 2: 'cic', 3: 'loan_application', 4: 'vneid' };
  const count = (m: ReturnType<typeof manual>) => proposeMasterCorrections(m.master, m.evidences).length;

  it('đa số rõ (2 đối 1, bản lệch cùng loại) → có đề xuất', () => {
    expect(count(manual('id', [{ value: '001090000001', ev: [1, 3] }, { value: '001090000007', ev: [2] }], types))).toBe(1);
  });
  it('1 đối 1 (chỉ hai bản, dạng phổ biến nhất) → có đề xuất, để LLM dựa vào độ tin cậy / chứng từ chuẩn / định dạng', () => {
    expect(count(manual('id', [{ value: '001090000001', ev: [1] }, { value: '001090000007', ev: [2] }], types))).toBe(1);
  });
  it('2 đối 2 (hòa phiếu) → có đề xuất', () => {
    expect(count(manual('id', [{ value: '001090000001', ev: [1, 3] }, { value: '001090000007', ev: [2, 4] }], types))).toBe(1);
  });
  it('bản lệch đến từ 2 loại tài liệu → có đề xuất (không còn bắt buộc cùng một loại)', () => {
    expect(count(manual('id', [{ value: '001090000001', ev: [1, 3] }, { value: '001090000007', ev: [2] }, { value: '001090000009', ev: [4] }], types))).toBe(1);
  });
  it('lá nguồn cùng một evidence vẫn chỉ tính một nguồn (số nguồn gửi cho LLM)', () => {
    const m = manual('id', [{ value: '001090000001', ev: [1, 1] }, { value: '001090000007', ev: [2] }], types);
    const [p] = proposeMasterCorrections(m.master, m.evidences);
    expect(p.options.map((o) => new Set(o.evidence_ids.map((r) => r.split('#')[0])).size)).toEqual([1, 1]);
  });
  it('G2: cách 3 ký tự → không đề xuất; cách 2 ký tự → có', () => {
    expect(count(manual('id', [{ value: '001090000001', ev: [1, 3] }, { value: '001090000777', ev: [2] }], types))).toBe(0);
    expect(count(manual('id', [{ value: '001090000001', ev: [1, 3] }, { value: '001090000077', ev: [2] }], types))).toBe(1);
  });
  it('G3: khóa quá ngắn → không đề xuất', () => {
    expect(count(manual('code', [{ value: 'AB 12', ev: [1, 3] }, { value: 'AB 13', ev: [2] }], types, 'assets[0].identifiers.certificate_number'))).toBe(0);
  });
  it('quá 4 giá trị khác nhau → không phải biến thể của cùng một giá trị, không đề xuất', () => {
    const five = manual('id', ['001090000001', '001090000002', '001090000003', '001090000004', '001090000005'].map((value, i) => ({ value, ev: [i + 1] })), { 1: 'id_card', 2: 'cic', 3: 'cic', 4: 'cic', 5: 'cic' });
    expect(count(five)).toBe(0);
  });
  it('MD-R20: money / address / text không được hiệu chỉnh dù lệch 1 ký tự', () => {
    for (const kind of ['money', 'number', 'text', 'enum', 'boolean', 'address'] as const) {
      expect(count(manual(kind, [{ value: '100000001', ev: [1, 3] }, { value: '100000002', ev: [2] }], types, 'loan_info.bank_proposed_amount'))).toBe(0);
    }
  });
  it('trường không phải CONFLICT không được đề xuất', () => {
    const m = manual('id', [{ value: '001090000001', ev: [1, 3] }, { value: '001090000007', ev: [2] }], types);
    (m.master.documents[0].fields[0] as { status: string }).status = 'AGREED';
    expect(proposeMasterCorrections(m.master, m.evidences)).toEqual([]);
  });
  it('trường tên (name) và ngày (date) cũng được xét', () => {
    expect(count(manual('name', [{ value: 'NGUYỄN VĂN ANH', ev: [1, 3] }, { value: 'NGUYỄN VĂN AN', ev: [2] }], types, 'parties[0].full_name'))).toBe(1);
    expect(count(manual('date', [{ value: '1990-01-01', ev: [1, 3] }, { value: '1990-01-07', ev: [2] }], types, 'parties[0].date_of_birth'))).toBe(1);
  });
  it('họ tên được nới khoảng cách theo độ dài: tên dài lệch 4 ký tự vẫn qua, mã thì không', () => {
    const long = ['NGUYỄN THỊ MINH THƯƠNG', 'NGUYEN THI MINH THUONG'];
    expect(allowedDistance('name', long[0], long[1])).toBeGreaterThan(2);
    expect(allowedDistance('id', '001090000001', '001090000007')).toBe(2);
    expect(count(manual('name', [{ value: long[0], ev: [1] }, { value: 'NGUYỄN THỊ MINH THUƠNG', ev: [2] }], types, 'parties[0].full_name'))).toBe(1);
  });
});

describe('tín hiệu gửi LLM: định dạng và chứng từ chuẩn', () => {
  it('formatOk: CCCD 9 / 12 số hợp lệ, ngày thật; sai độ dài / ngày không tồn tại là false; loại khác là null', () => {
    expect(formatOk('id', '001090000001')).toBe(true);
    expect(formatOk('id', '001090000')).toBe(true);
    expect(formatOk('id', '0010900000011')).toBe(false);
    expect(formatOk('id', '00109000001')).toBe(false);
    expect(formatOk('date', '1990-02-30')).toBe(false);
    expect(formatOk('date', '1990-01-07')).toBe(true);
    expect(formatOk('name', 'AN')).toBeNull();
  });
  it('mỗi lựa chọn mang format_ok; 1 đối 1 với bản sai định dạng được đánh dấu để LLM ưu tiên bản còn lại', () => {
    const m = manual('id', [{ value: '001090000001', ev: [1] }, { value: '00109000001', ev: [2] }], { 1: 'id_card', 2: 'cic' });
    const [p] = proposeMasterCorrections(m.master, m.evidences);
    expect(p.options.map((o) => [o.value, o.format_ok])).toEqual([['001090000001', true], ['00109000001', false]]);
  });
});
describe('hợp đồng CORRECTED (T-MD-09)', () => {
  const base = {
    path: 'a', label: 'a', kind: 'code', value: 'CN 6475', status: 'CORRECTED', review_status: 'REVIEW', confidence: 0.9,
    sources: ['ev-000000000001#a'], outliers: [], note: 'n',
    candidates: [{ value: 'CN 6475', evidence_ids: ['ev-000000000001#a'] }, { value: 'CN 6457', evidence_ids: ['ev-000000000002#a'] }],
    correction: { method: 'LLM_SELECTED_CANDIDATE', proposal_id: 'mc-0123456789ab', original: { status: 'CONFLICT', value: null }, distance: 2, minority: [{ evidence_id: 'ev-000000000002#a', raw_value: 'CN 6457' }], reason: 'x' },
  };
  it('hợp lệ khi đủ correction, REVIEW, value, ≥ 2 ứng viên', () => {
    expect(MasterFieldSchema.safeParse(base).success).toBe(true);
  });
  it.each([
    ['thiếu correction', { correction: undefined }],
    ['review_status ACCEPTED', { review_status: 'ACCEPTED' }],
    ['value null', { value: null }],
    ['ít hơn 2 ứng viên', { candidates: base.candidates.slice(0, 1) }],
    ['sources rỗng', { sources: [] }],
    ['thiếu note', { note: null }],
    ['method lạ', { correction: { ...base.correction, method: 'LLM_PROPOSED_VALUE' } }],
  ])('từ chối CORRECTED %s', (_name, patch) => {
    expect(MasterFieldSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it('trạng thái khác mà có correction bị từ chối', () => {
    expect(MasterFieldSchema.safeParse({ ...base, status: 'AGREED' }).success).toBe(false);
  });
});
