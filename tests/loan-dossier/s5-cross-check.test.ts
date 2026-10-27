// T-S5-01…T-S5-10 — đối chiếu chéo (S5). Hồ sơ giả chạy qua S3 thật.
import { CrossCheckStageResultSchema } from '@/lib/loan-dossier/contracts/check-stages';
import { compareAddress } from '@/lib/loan-dossier/s5/address';
import { compareExact, nearMatch, unaccentedOnly } from '@/lib/loan-dossier/s5/compare-exact';
import { adjudicateDuplicates, adjudicateIdLinkedByDocument, adjudicateIdNumber } from '@/lib/loan-dossier/s5/id-and-dup';
import { loadMatrix, MatrixFileSchema } from '@/lib/loan-dossier/s5/matrix';
import { compareMetric, compareSemantic } from '@/lib/loan-dossier/s5/metric';
import { runCrossCheck, type CrossCheckPorts } from '@/lib/loan-dossier/s5/run';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import raw from '@/lib/loan-dossier/catalog/data/cross_check_matrix.json';

import { ev, ID_A12, ID_A9, ID_B12, ID_C12, loanApp } from './fixtures/dossier';

const D0 = '2026-10-14';
const now = () => new Date('2026-10-14T03:00:00.000Z');
const addr = (full_text: string, province: string | null = null) => ({ full_text, street: null, ward: null, district: null, province });

async function cross(evidences: EvidenceEnvelope[], ports: Partial<CrossCheckPorts> = {}) {
  const s3 = runMapDossier({ evidences, dossier_submitted_at: D0, now });
  const r = await runCrossCheck({ evidences, s3: { status: s3.status, data: s3.data }, now }, { semantic: null, ...ports });
  const p = CrossCheckStageResultSchema.safeParse(r);
  if (!p.success) throw new Error(JSON.stringify(p.error.issues.slice(0, 3), null, 1));
  return { r, s3 };
}
const find = (r: Awaited<ReturnType<typeof cross>>['r'], group: string, sub: string | null = null, person: string | null = 'person-1') =>
  r.data!.results.find((x) => x.field_group === group && x.sub_field === sub && (person === null || x.person_id === person));

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const holder = { party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };

describe('matrix (T-S5-01)', () => {
  it('ma trận thật qua (12 nhóm, 3 rule)', () => {
    const m = loadMatrix();
    expect([m.field_groups.length, m.logic_rules.length]).toEqual([12, 3]);
  });
  it('doc_type_key lạ / loại không bóc tách đầy đủ → lỗi', () => {
    const bad = (k: string) => { const c = JSON.parse(JSON.stringify(raw)); c.field_groups[0].sub_fields[0].sources[0].doc_type_key = k; return MatrixFileSchema.safeParse(c).success; };
    expect(bad('khong_co')).toBe(false);
    expect(bad('household_business_license')).toBe(false);
  });
});

describe('so khớp đơn vị', () => {
  it('EXACT: text giữ dấu; mã so từng ký tự; biển số bỏ hậu tố', () => {
    expect(compareExact(['nguyễn văn a', 'NGUYỄN  VĂN A'], 'text').allEqual).toBe(true);
    expect(compareExact(['NGUYỄN VĂN A', 'NGUYEN VAN A'], 'text').allEqual).toBe(false);
    expect(compareExact(['BS872510', 'BS872511'], 'code').allEqual).toBe(false);
    expect(compareExact(['88C-276.60 (T)', '88C27660'], 'plate').allEqual).toBe(true);
  });
  it('S5-AC05/AC06: địa chỉ so trên bề mặt chứng từ — khác hoa/thường, dấu câu, khoảng trắng → EXACT_MATCH; địa danh cũ/mới khác văn bản → MISMATCH', () => {
    expect(compareAddress([addr('Số 1, Xã A'), addr('SỐ 1,  XÃ A.')])).toMatchObject({ match_status: 'MATCH', reason_code: 'EXACT_MATCH' });
    const oldNew = compareAddress([addr('XÃ A, HUYỆN B, TỈNH C', 'P1'), addr('XÃ A MỚI, TỈNH C', 'P1')]);
    expect([oldNew.match_status, oldNew.reason_code]).toEqual(['MISMATCH', 'VALUE_CONFLICT']);
    expect(oldNew.normalized).toEqual(['XÃ A, HUYỆN B, TỈNH C', 'XÃ A MỚI, TỈNH C']);
    expect(compareAddress.length).toBe(1); // không có tham số dữ liệu địa giới / LLM
  });
  it('METRIC: khác kỳ → METRIC_INCOMPATIBLE; cùng kỳ khác số → MISMATCH; cùng số → MATCH', () => {
    expect(compareMetric([{ value: 1, metric: 'annual_revenue', period: 'ANNUAL', unit: 'VND' }, { value: 1, metric: 'monthly_income', period: 'MONTHLY', unit: 'VND' }]).reason_code).toBe('METRIC_INCOMPATIBLE');
    expect(compareMetric([{ value: 1, metric: 'm', period: 'MONTHLY', unit: 'VND' }, { value: 2, metric: 'm', period: 'MONTHLY', unit: 'VND' }]).match_status).toBe('MISMATCH');
    expect(compareMetric([{ value: 2, metric: 'm', period: 'MONTHLY', unit: 'VND' }, { value: 2, metric: 'm', period: 'MONTHLY', unit: 'VND' }]).match_status).toBe('MATCH');
  });
  it('SEMANTIC: SAME → MATCH; UNSURE → MISMATCH (S5-AC12); lỗi / nhãn lạ → SEMANTIC_UNAVAILABLE; chỉ 2 chuỗi tới port', async () => {
    const seen: string[][] = [];
    const port = (label: string) => ({ judge: async (a: string, b: string) => { seen.push([a, b]); return label; } });
    expect((await compareSemantic(['Bán tạp hóa', 'Kinh doanh tạp hóa'], port('SAME'))).reason_code).toBe('SEMANTIC_MATCH');
    expect(await compareSemantic(['A', 'B'], port('UNSURE'))).toMatchObject({ match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT' });
    expect((await compareSemantic(['A', 'B'], port('MAYBE'))).reason_code).toBe('SEMANTIC_UNAVAILABLE');
    expect((await compareSemantic(['A', 'B'], { judge: async () => { throw new Error('timeout'); } })).match_status).toBe('UNDETERMINED');
    expect(seen.every((p) => p.length === 2)).toBe(true);
  });
  it('S5-AC03/AC04: số định danh lịch sử vs hiện tại; 2 số CURRENT; bản trùng xung đột', () => {
    expect(adjudicateIdNumber([{ normalized: ID_A9, id_status: 'HISTORICAL' }, { normalized: ID_A12, id_status: 'CURRENT' }])?.reason_code).toBe('HISTORICAL_ID_NUMBER');
    expect(adjudicateIdNumber([{ normalized: ID_A12, id_status: 'CURRENT' }, { normalized: ID_C12, id_status: 'CURRENT' }, { normalized: ID_A9, id_status: 'HISTORICAL' }])).toMatchObject({ reason_code: 'CURRENT_ID_NUMBER_CONFLICT', severity: 'HIGH' });
    expect(adjudicateDuplicates([{ normalized: 'A', duplicate_group_id: 'dup-1', duplicate_status: 'CONFLICTING_DUPLICATES' }, { normalized: 'B', duplicate_group_id: 'dup-1', duplicate_status: 'CONFLICTING_DUPLICATES' }])?.reason_code).toBe('DUPLICATE_VALUE_CONFLICT');
  });
});

describe('runCrossCheck', () => {
  it('S5-AC01: CCCD và đơn vay cùng tên/số → 2 dòng MATCH', async () => {
    const { r } = await cross([loanApp([borrower]), ev('id_card', { parties: [holder] })]);
    expect(find(r, 'full_name')).toMatchObject({ match_status: 'MATCH', reason_code: 'EXACT_MATCH', severity: 'INFO', requires_review: false });
    expect(find(r, 'id_number')).toMatchObject({ match_status: 'MATCH' });
    expect(find(r, 'full_name')!.canonical_source).toMatchObject({ rule: 'CURRENT_IDENTITY_DOCUMENT', doc_type_key: 'id_card' });
  });

  it('S5-AC15: tên chỉ khác vì CIC ghi không dấu → MATCH/UNACCENTED_MATCH; 2 cách viết có dấu khác nhau → vẫn MISMATCH', async () => {
    const cic = (name: string) => ev('cic', { parties: [{ ...holder, full_name: name }] });
    const { r } = await cross([loanApp([borrower]), ev('id_card', { parties: [{ ...holder, full_name: 'Nguyễn Văn An' }] }), cic('NGUYEN VAN AN')]);
    const row = find(r, 'full_name')!;
    expect(row.values.map((v) => v.source.doc_type_key)).toContain('cic');
    expect(row).toMatchObject({ match_status: 'MATCH', reason_code: 'UNACCENTED_MATCH', severity: 'INFO', requires_review: false });

    const { r: r2 } = await cross([loanApp([borrower]), ev('id_card', { parties: [{ ...holder, full_name: 'NGUYỄN VĂN ÂN' }] }), cic('NGUYEN VAN AN')]);
    expect(find(r2, 'full_name')).toMatchObject({ match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT' });
  });

  it('unaccentedOnly: chỉ áp khi các bản có dấu cùng một cách viết', () => {
    expect(unaccentedOnly(['NGUYỄN VĂN AN', 'NGUYEN VAN AN', 'NGUYỄN VĂN AN'])).toBe(true);
    expect(unaccentedOnly(['NGUYỄN VĂN AN', 'NGUYỄN VĂN ÂN', 'NGUYEN VAN AN'])).toBe(false);
    expect(unaccentedOnly(['NGUYỄN VĂN AN', 'NGUYEN VAN ANH'])).toBe(false);
    expect(unaccentedOnly(['NGUYỄN VĂN AN', 'NGUYỄN VĂN AN'])).toBe(false);
    expect(unaccentedOnly(['ĐỖ VĂN AN', 'DO VAN AN', null])).toBe(true);
  });

  it('S5-AC02: đơn vay ghi số lệch 1 chữ số → MISMATCH/VALUE_CONFLICT', async () => {
    const { r } = await cross([loanApp([{ ...borrower, id_number: '001090000009' }]), ev('id_card', { parties: [holder] })]);
    expect(find(r, 'id_number')).toMatchObject({ match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT' });
  });

  it('S5-AC03: CMND 9 số trên đơn vay vs CCCD 12 số in số cũ → UNDETERMINED/HISTORICAL, giữ cả hai số', async () => {
    const { r } = await cross([loanApp([{ ...borrower, id_number: ID_A9 }]), ev('id_card', { parties: [{ ...holder, previous_id_numbers: [ID_A9] }] })]);
    const row = find(r, 'id_number')!;
    expect([row.match_status, row.reason_code]).toEqual(['UNDETERMINED', 'HISTORICAL_ID_NUMBER']);
    expect(row.values.map((v) => v.normalized_value).sort()).toEqual([ID_A12, ID_A9, ID_A9].sort());
    expect(r.status_code).toBe('UNDETERMINED_RESULTS_PRESENT');
  });

  it('S5-AC18 (D-61): QR thể hiện cả CMND 9 số và CCCD 12 số → MATCH/ID_LINKED_BY_DOCUMENT, không cần rà soát; QR chỉ có 1 số thì vẫn UNDETERMINED', async () => {
    const app = loanApp([{ ...borrower, id_number: ID_A9 }]);
    const withBoth = await cross([app, ev('qr_code_info', { parties: [{ ...holder, previous_id_numbers: [ID_A9] }] }), ev('id_card', { parties: [holder] })]);
    const linked = find(withBoth.r, 'id_number')!;
    expect(linked).toMatchObject({ match_status: 'MATCH', reason_code: 'ID_LINKED_BY_DOCUMENT', severity: 'INFO', requires_review: false });
    expect(linked.values.map((v) => v.normalized_value).sort()).toEqual([ID_A12, ID_A12, ID_A9, ID_A9].sort()); // vẫn giữ cả hai số
    expect(withBoth.r.status_code).toBe('COMPLETED');

    const qrOnly12 = await cross([app, ev('qr_code_info', { parties: [holder] }), ev('id_card', { parties: [{ ...holder, previous_id_numbers: [ID_A9] }] })]);
    expect(find(qrOnly12.r, 'id_number')).toMatchObject({ match_status: 'UNDETERMINED', reason_code: 'HISTORICAL_ID_NUMBER' });
  });

  it('S5-AC18 (D-61): cam kết 2 CMND/CCCD và xác nhận CMND địa phương cũng nối 2 số → MATCH/ID_LINKED_BY_DOCUMENT', async () => {
    const app = loanApp([{ ...borrower, id_number: ID_A9 }]);
    for (const docType of ['same_person_commitment', 'local_cmnd_confirmation']) {
      const { r } = await cross([app, ev(docType, { parties: [{ ...holder, previous_id_numbers: [ID_A9] }] }), ev('id_card', { parties: [holder] })]);
      const row = find(r, 'id_number')!;
      expect(row).toMatchObject({ match_status: 'MATCH', reason_code: 'ID_LINKED_BY_DOCUMENT', requires_review: false });
      expect(row.reason).toContain(docType === 'same_person_commitment' ? 'cam kết' : 'xác nhận CMND');
      expect(row.values.some((v) => v.source.doc_type_key === docType)).toBe(true);
    }
  });

  it('adjudicateIdLinkedByDocument: chứng từ nối phải phủ mọi số đang so, và chỉ tính QR / cam kết / xác nhận CMND', () => {
    const src = (evidence_id: string, doc_type_key: string, normalized: string | null) => ({ evidence_id, doc_type_key, normalized });
    for (const t of ['qr_code_info', 'same_person_commitment', 'local_cmnd_confirmation']) {
      expect(adjudicateIdLinkedByDocument([src('q', t, ID_A12), src('q', t, ID_A9), src('l', 'loan_application', ID_A9)])?.reason_code).toBe('ID_LINKED_BY_DOCUMENT');
    }
    // chứng từ nối chỉ có 1 trong 2 số → chưa đủ
    expect(adjudicateIdLinkedByDocument([src('q', 'qr_code_info', ID_A12), src('l', 'loan_application', ID_A9)])).toBeNull();
    // chứng từ nối có 2 số nhưng còn số thứ 3 ngoài nó → chưa đủ
    expect(adjudicateIdLinkedByDocument([src('q', 'qr_code_info', ID_A12), src('q', 'qr_code_info', ID_A9), src('l', 'loan_application', ID_B12)])).toBeNull();
    // chứng từ không thuộc nhóm nối (id_card) có đủ 2 số → không áp dụng
    expect(adjudicateIdLinkedByDocument([src('c', 'id_card', ID_A12), src('c', 'id_card', ID_A9)])).toBeNull();
    expect(adjudicateIdLinkedByDocument([src('q', 'qr_code_info', ID_A12)])).toBeNull();
  });

  it('S5-AC19 (D-63): tình trạng hôn nhân trên đề nghị vay ngược với giấy xác nhận → MISMATCH; cùng giá trị → MATCH; thiếu một bên → không có dòng', async () => {
    const confirm = (marital_status: string) => ev('marital_status_confirmation', { parties: [holder], data: { marital_status, marital_status_raw: null } });
    // Đề nghị vay: Ly hôn; xác nhận: Đã kết hôn → lệch (và ngược lại)
    const divorced = await cross([loanApp([borrower], { relations: { 0: { marital: 'DIVORCED' } } }), confirm('MARRIED')]);
    expect(find(divorced.r, 'marital_status')).toMatchObject({ match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT', requires_review: true });
    const married = await cross([loanApp([borrower], { relations: { 0: { marital: 'MARRIED' } } }), confirm('DIVORCED')]);
    expect(find(married.r, 'marital_status')).toMatchObject({ match_status: 'MISMATCH' });
    const same = await cross([loanApp([borrower], { relations: { 0: { marital: 'DIVORCED' } } }), confirm('DIVORCED')]);
    expect(find(same.r, 'marital_status')).toMatchObject({ match_status: 'MATCH', requires_review: false });
    // Đề nghị vay không khai (null) → chỉ 1 nguồn → không dòng
    const missing = await cross([loanApp([borrower]), confirm('MARRIED')]);
    expect(find(missing.r, 'marital_status')).toBeUndefined();
  });

  it('S5-AC07: requested ≠ bank_proposed nhưng bank_proposed khớp bảng kê → MATCH', async () => {
    const app = loanApp([borrower]);
    app.data!.loan_info = { ...(app.data!.loan_info as object), requested_amount: 600_000_000, bank_proposed_amount: 500_000_000 };
    const list = ev('purchase_list', { parties: [{ ...borrower, party_role: 'CUSTOMER' }], data: { funding_plan: { loan_amount: 500_000_000, total_amount: 700_000_000 } } });
    const { r } = await cross([app, list]);
    expect(find(r, 'loan_amount')).toMatchObject({ match_status: 'MATCH', comparison_method: 'METRIC' });
    // requested_amount của chính đơn vay không tham gia (S5-R10).
    expect(find(r, 'loan_amount')!.values.map((v) => v.source.field_path)).toEqual(['data.loan_info.bank_proposed_amount', 'data.funding_plan.loan_amount']);
  });

  it('S5-AC08/AC09: 1 nguồn → không dòng; khách vay và đồng vay khác tên → không so chéo', async () => {
    const { r } = await cross([loanApp([borrower, { party_role: 'CO_BORROWER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 }]), ev('id_card', { parties: [holder] })]);
    expect(find(r, 'business_line')).toBeUndefined();
    expect(r.data!.results.filter((x) => x.person_id === 'person-2')).toEqual([]);
  });

  it('S5-AC10: identifier_conflicts chassis → dòng MISMATCH chassis_number', async () => {
    const app = loanApp([borrower], { assets: [{ asset_type: 'vehicle', usage_context_hint: 'collateral', identifiers: { chassis_number: 'RLNAB1234567', license_plate: '51K1' } }] });
    const reg = ev('vehicle_registration', { parties: [], assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234568', license_plate: '51K1' } }] });
    const { r } = await cross([app, reg]);
    expect(find(r, 'movable_asset_info', 'chassis_number', null)).toMatchObject({ match_status: 'MISMATCH', asset_id: 'asset-1', person_id: null });
  });

  it('S5-AC16: số GCN — 2 chứng từ ghi giống nhau, 1 chứng từ thiếu 1 ký tự → NEAR_MATCH/PROBABLE_OCR_ERROR, vẫn cần xem; tài sản vẫn CONFIRMED', async () => {
    const rea = (cert: string) => ({ asset_type: 'real_estate', usage_context_hint: null, identifiers: { certificate_number: cert } });
    const app = loanApp([borrower], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136' } }] });
    const gcn = ev('land_use_certificate', { parties: [], assets: [rea('AA 08798136')] });
    const val = { ...ev('real_estate_valuation_report', { parties: [], assets: [rea('AA 0798136')] }), file_name: 'dinh_gia_doi_chieu.pdf' };
    const { r, s3 } = await cross([app, gcn, val]);
    const row = find(r, 'real_estate_info', 'certificate_number', null)!;
    expect(row).toMatchObject({ match_status: 'NEAR_MATCH', reason_code: 'PROBABLE_OCR_ERROR', severity: 'INFO', requires_review: true });
    expect(row.reason).toMatch(/^2 chứng từ ghi giống nhau; .+ \(dinh_gia_doi_chieu\.pdf( tr\.\d+)?\) lệch đúng 1 ký tự/);
    expect(row.reason).toContain(val.doc_type_label);
    expect(r.content_preview).toMatchObject({ near_match_count: 1 });
    expect(r.status).toBe('SUCCESS');
    const asset = s3.data!.asset_registry[0];
    expect(asset).toMatchObject({ context_status: 'CONFIRMED', context_reason_code: null, usage_contexts: ['collateral'] });
    expect(asset.identifier_conflicts).toEqual([expect.objectContaining({ field: 'certificate_number', probable_ocr_error: true, outlier_evidence_ids: [val.evidence_id] })]);
  });

  it('S5-AC17 (D-43): bản trùng GCN đọc "CH.6475" thay vì "CN 6475" — dù nhóm trùng đang CONFLICTING vẫn ra NEAR_MATCH, không DUPLICATE_VALUE_CONFLICT', async () => {
    const gcn = (book: string, file: string) => ({
      ...ev('land_use_certificate', { parties: [], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AA 08798136', certificate_book_number: book } }] }),
      file_name: file, duplicate_group_id: 'dup-1', duplicate_status: 'CONFLICTING_DUPLICATES', differing_fields: ['assets[0].identifiers.certificate_book_number'],
    });
    const app = loanApp([borrower], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136' } }] });
    const { r } = await cross([app, gcn('CN 6475', 'so_do.pdf'), gcn('CN 6475', 'chung_thu_dinh_gia_tai_san.pdf'), gcn('CH.6475', 'dinh_gia_doi_chieu.pdf')]);
    const row = find(r, 'real_estate_info', 'certificate_book_number', null)!;
    expect(row).toMatchObject({ match_status: 'NEAR_MATCH', reason_code: 'PROBABLE_OCR_ERROR' });
    expect(row.reason).toContain('(dinh_gia_doi_chieu.pdf');
  });

  it('nearMatch: chỉ khi đa số ≥ 2 chứng từ, đúng 1 nguồn lệch 1 ký tự, mã dài ≥ 6', () => {
    expect(nearMatch(['AA08798136', 'AA08798136', 'AA0798136'])).toMatchObject({ majority: 'AA08798136', outlier: 2, agreeing: 2 });
    expect(nearMatch(['AA08798136', 'AA0798136'])).toBeNull(); // không có đa số
    expect(nearMatch(['AA08798136', 'AA08798136', 'AA0798136', 'AA0798136'])).toBeNull(); // 2 nguồn lệch
    expect(nearMatch(['AA08798136', 'AA08798136', 'AA0798130'])).toBeNull(); // lệch 2 ký tự
    expect(nearMatch(['12345', '12345', '1234'])).toBeNull(); // mã ngắn
    expect(nearMatch(['AA08798136', 'AA08798136', 'AA0798136'], ['ev-1', 'ev-1', 'ev-2'])).toBeNull(); // đa số chỉ từ 1 chứng từ
  });

  it('S5-AC11: tổng hợp đồng < số tiền vay → violated; ngược lại vẫn ghi violated=false', async () => {
    const app = loanApp([borrower]);
    app.data!.loan_info = { ...(app.data!.loan_info as object), bank_proposed_amount: 500_000_000 };
    const list = (total: number) => ev('purchase_list', { parties: [{ ...borrower, party_role: 'CUSTOMER' }], data: { funding_plan: { loan_amount: null, total_amount: total } } });
    const below = (await cross([app, list(400_000_000)])).r.data!.logic_findings.find((f) => f.rule_key === 'purchase_total_below_loan_amount')!;
    expect([below.violated, below.severity, below.needs_ba_confirmation]).toEqual([true, 'REVIEW', true]);
    const ok = (await cross([app, list(600_000_000)])).r.data!.logic_findings.find((f) => f.rule_key === 'purchase_total_below_loan_amount')!;
    expect(ok.violated).toBe(false);
  });

  it('S5-AC13: chạy lại → result_id giống hệt; S5-R14 không đổi id_number_check', async () => {
    const evs = [loanApp([borrower]), ev('id_card', { parties: [holder] }), ev('cic', { parties: [holder] })];
    const a = await cross(evs);
    const b = await cross(evs);
    expect(a.r.data!.results.map((x) => x.result_id)).toEqual(b.r.data!.results.map((x) => x.result_id));
    expect(a.r.data!.results.map((x) => x.result_id)).toEqual(a.r.data!.results.map((_, i) => `xck-${i + 1}`));
    expect(a.s3.data!.role_registry[0].id_number_check.status).toBe('CONSISTENT');
  });

  it('S5-AC14: hôn nhân cũ bị thay thế → skipped SUPERSEDED', async () => {
    const old = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-01-05' });
    const fresh = ev('marital_status_confirmation', { parties: [holder], issue_date: '2026-09-20' });
    const { r } = await cross([loanApp([borrower]), old, fresh]);
    expect(r.data!.skipped_evidences).toContainEqual({ evidence_id: old.evidence_id, doc_type_key: 'marital_status_confirmation', skip_reason: 'SUPERSEDED' });
  });

  it('trạng thái stage: không có registry → UNAVAILABLE; 1 evidence → SINGLE_DOCUMENT_ONLY; không cặp → NO_COMPARABLE_PAIRS', async () => {
    expect((await cross([ev('id_card', { parties: [holder] })])).r.status_code).toBe('ROLE_REGISTRY_UNAVAILABLE');
    expect((await cross([loanApp([borrower])])).r.status_code).toBe('SINGLE_DOCUMENT_ONLY');
    expect((await cross([loanApp([borrower]), ev('household_business_photo', { parties: [{ party_role: 'HOLDER', full_name: 'X Y' }] })])).r.status_code).toBe('NO_COMPARABLE_PAIRS');
  });

  it('content_preview khớp và không log PII', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const { r } = await cross([loanApp([{ ...borrower, id_number: '001090000009' }]), ev('id_card', { parties: [holder] })]);
    const p = r.content_preview!;
    expect(p.match_count + p.near_match_count + p.mismatch_count + p.undetermined_count).toBe(p.total_comparisons);
    expect(spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n')).not.toContain(ID_A12);
    spies.forEach((s) => s.mockRestore());
  });
});

describe('D-57: hoãn so ngữ nghĩa ở giai đoạn tiếp nhận', () => {
  const semanticPair = () => [
    loanApp([borrower], { data: { business_info: { business_line: 'Bán gạo', business_address: null } } }),
    ev('purchase_list', { parties: [{ ...borrower, party_role: 'CUSTOMER' }], data: { business_info: { business_line: 'Bán điện thoại', business_address: null } } }),
  ];

  it('defer_semantic: cặp cần LLM ra SEMANTIC_DEFERRED, không gọi port, không tính là cần rà soát', async () => {
    const judge = jest.fn(async () => 'DIFFERENT');
    const { r } = await cross(semanticPair(), { semantic: { judge }, defer_semantic: true });
    expect(judge).not.toHaveBeenCalled();
    expect(find(r, 'business_line')).toMatchObject({ match_status: 'UNDETERMINED', reason_code: 'SEMANTIC_DEFERRED', severity: 'INFO', requires_review: false });
    expect(r.status_code).not.toBe('UNDETERMINED_RESULTS_PRESENT');
  });

  it('chuỗi giống hệt vẫn MATCH khi hoãn; không hoãn thì gọi port như cũ', async () => {
    const same = semanticPair();
    same[1] = ev('purchase_list', { parties: [{ ...borrower, party_role: 'CUSTOMER' }], data: { business_info: { business_line: 'BÁN GẠO', business_address: null } } });
    expect(find((await cross(same, { defer_semantic: true })).r, 'business_line')?.match_status).toBe('MATCH');
    const judge = jest.fn(async () => 'DIFFERENT');
    const { r } = await cross(semanticPair(), { semantic: { judge } });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(find(r, 'business_line')).toMatchObject({ match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT' });
  });

  it('compareSemantic opts.defer', async () => {
    expect(await compareSemantic(['A', 'B'], null, { defer: true })).toMatchObject({ match_status: 'UNDETERMINED', reason_code: 'SEMANTIC_DEFERRED' });
    expect((await compareSemantic(['A', 'a'], null, { defer: true })).match_status).toBe('MATCH');
  });
});