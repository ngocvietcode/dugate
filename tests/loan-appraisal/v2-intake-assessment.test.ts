// D-47 — kết quả tiếp nhận theo 4 tiêu chí của Sale.
import { buildIntakeAssessment, parseAcknowledgements, type IntakeAssessmentInput } from '@/lib/pipelines/workflows/loan-appraisal/intake-assessment';
import { criterionViews } from '@/app/loan-appraisal-v2/lib/intake-view';

import { ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';
import { runDossier } from '../loan-dossier/fixtures/master';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1990-01-01' };
const empty = (o: Partial<IntakeAssessmentInput> = {}): IntakeAssessmentInput => ({
  classify: { files: [], repeated_doc_types: [] } as never, evidences: [], s3: null,
  checklist: { items: [], flow: 'FULL' } as never, crossCheck: { results: [] } as never, master: null, acknowledgements: [], ...o,
});
const crit = (a: ReturnType<typeof buildIntakeAssessment>, no: number) => a.criteria[no - 1];

async function dossier(dob = '1990-01-01') {
  const r = await runDossier([loanApp([borrower]), ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER', date_of_birth: dob }] })]);
  return (acks: Array<{ finding_code: string; reason: string }> = []) => buildIntakeAssessment({
    classify: null, evidences: r.evidences, s3: r.s3.data, checklist: r.s4.data, crossCheck: r.s5.data, master: r.master, acknowledgements: acks,
  });
}

describe('4 tiêu chí tiếp nhận', () => {
  it('D-61: bản trùng xung đột ở thông tin phụ (người ký) không thành điểm cần kiểm tra; họ tên chủ thể vẫn tính', () => {
    const doc = (path: string) => ({
      item_key: 'legal_id_card', doc_type_key: 'id_card', item_label: 'Căn cước công dân', doc_type_label: 'CCCD', person_id: null, asset_id: null,
      fields: [{ status: 'CONFLICT', path }],
    });
    const run = (path: string) => buildIntakeAssessment(empty({ master: { documents: [doc(path)] } as never }));
    expect(crit(run('data.legal_info.signatories[0].full_name'), 2).findings).toEqual([]);
    expect(crit(run('data.legal_info.signatories[1].full_name'), 2).status).toBe('PASS');
    const main = crit(run('data.parties[0].full_name'), 2);
    expect(main.findings.map((f) => f.code)).toEqual(['COPY_CONFLICT:legal_id_card:dossier:data.parties[0].full_name']);
    expect(main.status).toBe('NEEDS_EXPLANATION');
  });

  it('luôn đủ 4 tiêu chí; tiêu chí 3 (LOS/Secure App) chưa áp dụng', () => {
    const a = buildIntakeAssessment(empty());
    expect(a.criteria.map((c) => [c.no, c.key])).toEqual([[1, 'DOCUMENTS_COMPLETE'], [2, 'CONSISTENT_ACROSS_DOCUMENTS'], [3, 'SYSTEM_DATA_ACCURATE'], [4, 'READY_FOR_HANDOVER']]);
    expect(crit(a, 3).status).toBe('NOT_APPLICABLE');
    expect(a.ready_for_handover).toBe(true);
  });

  it('1: thiếu chứng từ bắt buộc → Chưa đạt; không giải trình được; 4 chưa sẵn sàng', async () => {
    const run = await dossier();
    const a = run();
    expect(crit(a, 1).status).toBe('FAIL');
    const code = crit(a, 1).findings[0].code;
    expect(code).toMatch(/^DOC_(MISSING|NEEDS_RESCAN):/);
    const acked = run([{ finding_code: code, reason: 'sẽ bổ sung' }]);
    expect(crit(acked, 1).findings[0].status).toBe('OPEN');
    expect(acked.ignored_acknowledgements).toEqual([code]);
    expect(crit(a, 4).status).toBe('FAIL');
  });

  it('2: ngày sinh lệch giữa CCCD và đề nghị vay → Cần giải trình; gửi giải trình → Đã giải trình', async () => {
    const run = await dossier('1991-02-02');
    const a = run();
    const f = crit(a, 2).findings.find((x) => x.code === 'XCHECK:date_of_birth:person-1')!;
    expect(f).toMatchObject({ acknowledgeable: true, status: 'OPEN' });
    expect(crit(a, 2).status).toBe('NEEDS_EXPLANATION');
    const b = run([{ finding_code: f.code, reason: 'CCCD cấp lại, đề nghị vay ghi nhầm' }]);
    expect(crit(b, 2)).toMatchObject({ status: 'ACCEPTED' });
    expect(b.ignored_acknowledgements).toEqual([]);
  });

  it('2: ngày sinh khớp → không có sai lệch trọng yếu', async () => {
    expect(crit((await dossier())(), 2)).toMatchObject({ status: 'PASS', findings: [] });
  });

  it('2 (D-49): địa chỉ thường trú lệch không tính ở bước Sale; S5 vẫn báo lệch', async () => {
    const addr = (full_text: string) => ({ full_text, street: null, ward: null, district: null, province: null });
    const r = await runDossier([
      loanApp([{ ...borrower, permanent_address: addr('Số 1, Xã A') }]),
      ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER', permanent_address: addr('Số 9, Xã B') }] }),
    ]);
    expect(r.s5.data!.results.find((x) => x.field_group === 'permanent_address')?.match_status).toBe('MISMATCH');
    const a = buildIntakeAssessment({ classify: null, evidences: r.evidences, s3: r.s3.data, checklist: r.s4.data, crossCheck: r.s5.data, master: r.master, acknowledgements: [] });
    expect(crit(a, 2)).toMatchObject({ status: 'PASS', findings: [] });
  });

  it('4: tài liệu không đọc được → chưa sẵn sàng; có giải trình → sẵn sàng', () => {
    const bad = { ...ev('cic'), status: 'ERROR' as const, reason_code: 'UNREADABLE_CONTENT', data: null, field_confidences: {} };
    const a = buildIntakeAssessment(empty({ evidences: [bad] }));
    expect(crit(a, 4).status).toBe('FAIL');
    const code = crit(a, 4).findings[0].code;
    expect(code).toBe(`FILE_UNREADABLE:${bad.evidence_id}`);
    expect(buildIntakeAssessment(empty({ evidences: [bad], acknowledgements: [{ finding_code: code, reason: 'bản trùng, đã có bản rõ' }] })).ready_for_handover).toBe(true);
  });

  it('parseAcknowledgements: nhận mảng hoặc chuỗi JSON; bỏ mục thiếu mã/lý do', () => {
    expect(parseAcknowledgements('[{"finding_code":"A","reason":"x"},{"finding_code":"B"},{"reason":"y"}]')).toEqual([{ finding_code: 'A', reason: 'x' }]);
    expect(parseAcknowledgements('không phải json')).toEqual([]);
    expect(parseAcknowledgements(null)).toEqual([]);
  });

  it('giao diện (D-50): liệt kê đủ điểm chưa đạt theo nhóm, kèm điểm đã đạt', () => {
    const it0 = (i: number, status: string, group = 'legal') => ({ item_key: `k${i}`, item_label: `Mục ${i}`, checklist_group: group, required: true, status, person_id: null, asset_id: null });
    const items = [...Array.from({ length: 7 }, (_, i) => it0(i, 'MISSING', i < 4 ? 'legal' : 'collateral')), it0(7, 'PRESENT'), { ...it0(8, 'SUBSTITUTED'), required: false }, it0(9, 'NOT_APPLICABLE')];
    const v = criterionViews(buildIntakeAssessment(empty({ checklist: { items, flow: 'FULL' } as never })));
    expect(v.map((x) => x.status_label)).toEqual(['Chưa đạt', 'Đạt', 'Chưa áp dụng', 'Chưa đạt']);
    expect(v[0].findings_count).toBe(7);
    expect(v[0].findings.map((g) => [g.group, g.lines.length])).toEqual([['I. Hồ sơ pháp lý', 4], ['IV. Tài sản bảo đảm', 3]]);
    expect(v[0].passed.flatMap((g) => g.lines.map((l) => l.text))).toEqual(['Mục 7', 'Mục 8 — đã có chứng từ thay thế']);
  });
});

describe('D-55/D-56: chứng từ hết hạn; tiêu chí 1 chỉ xét loại chứng từ, tiêu chí 2 xét tài sản / vai trò / quan hệ', () => {
  const row = (o: Record<string, unknown>) => ({
    item_key: 'credit_cic_report', item_label: 'Báo cáo CIC KH vay / người đồng vay / chủ TSBĐ', checklist_group: 'credit_relationship', required: true,
    status: 'MISSING', reason_code: 'DOCUMENT_NOT_FOUND', message: 'Chưa có chứng từ trong hồ sơ.', person_id: null, asset_id: null, found_in: [], ...o,
  });
  const expiredCic = row({ reason_code: 'DOCUMENT_EXPIRED', message: 'Chứng từ cấp ngày 2026-07-14 đã quá thời hạn 30 ngày. Cần bổ sung bản cấp từ ngày 2026-09-20 trở đi.' });
  const withItems = (items: unknown[], o: Partial<IntakeAssessmentInput> = {}) => buildIntakeAssessment(empty({ checklist: { items, flow: 'FULL' } as never, ...o }));

  it('chỉ còn chứng từ hết hạn → Cần kiểm tra (không phải Chưa đạt), nêu rõ ngày cấp và hạn; giải trình được', () => {
    const a = withItems([expiredCic]);
    expect(crit(a, 1).status).toBe('NEEDS_EXPLANATION');
    expect(criterionViews(a)[0].status_label).toBe('Cần kiểm tra');
    const f = crit(a, 1).findings[0];
    expect(f).toMatchObject({ code: 'DOC_EXPIRED:credit_cic_report:dossier', acknowledgeable: true, status: 'OPEN' });
    expect(f.message).toBe(`Hết hạn: ${expiredCic.item_label} - ${expiredCic.message}`);
    expect(f.message).not.toMatch(/^Thiếu/);
    expect(a.ready_for_handover).toBe(false);
    const b = withItems([expiredCic], { acknowledgements: [{ finding_code: f.code, reason: 'CIC mới đang chờ xuất' }] });
    expect(crit(b, 1).status).toBe('ACCEPTED');
    expect(b.ready_for_handover).toBe(true);
  });

  it('còn mục thiếu thật cùng với mục hết hạn → vẫn Chưa đạt', () => {
    const a = withItems([expiredCic, row({ item_key: 'legal_id_card', item_label: 'Căn cước công dân', checklist_group: 'legal' })]);
    expect(crit(a, 1).status).toBe('FAIL');
    expect(crit(a, 1).findings.map((x) => x.acknowledgeable)).toEqual([true, false]);
  });

  const FOUND = [{ evidence_id: 'ev-1', file_id: 'f1', file_name: 'gcn.pdf', page: 1, field_path: null }];
  const gcn = (o: Record<string, unknown> = {}) => row({
    item_key: 'collateral_land_use_cert', item_label: 'GCN QSDĐ, quyền sở hữu nhà ở và tài sản gắn liền với đất', checklist_group: 'collateral',
    status: 'NEEDS_REVIEW', reason_code: 'ASSET_CONTEXT_UNRESOLVED', message: 'Chưa xác định được tài sản / mục đích sử dụng tài sản; cần rà soát.', asset_id: 'asset-1', found_in: FOUND, ...o,
  });
  const asset = (o: Record<string, unknown> = {}) => ({
    asset_id: 'asset-1', asset_type: 'real_estate', identifiers: { certificate_number: 'CS 123456' }, usage_contexts: [], context_status: 'UNRESOLVED',
    context_reason_code: 'ASSET_CONTEXT_AMBIGUOUS', identifier_conflicts: [], ...o,
  });
  const run = (items: unknown[], a0: unknown = asset(), crossCheck: unknown = { results: [] }) =>
    withItems(items, { s3: { asset_registry: [a0] } as never, crossCheck: crossCheck as never });

  it('D-56: đã có GCN nhưng tài sản chưa xác định chắc → tiêu chí 1 Đạt (đã có loại chứng từ), vấn đề nằm ở tiêu chí 2, nêu số GCN và lý do', () => {
    const a = run([gcn()]);
    expect(crit(a, 1)).toMatchObject({ status: 'PASS', findings: [] });
    expect(crit(a, 1).passed.map((p) => p.message)).toEqual([`${gcn().item_label} — Số Giấy chứng nhận CS 123456`]);
    expect(crit(a, 2).status).toBe('NEEDS_EXPLANATION');
    expect(crit(a, 2).findings).toHaveLength(1);
    expect(crit(a, 2).findings[0]).toMatchObject({
      code: 'ASSET_IDENTITY:asset-1', acknowledgeable: true,
      message: 'Số Giấy chứng nhận CS 123456: chưa xác định được mục đích sử dụng tài sản (thế chấp / nguồn thu cho thuê).',
    });
    expect(a.criteria.flatMap((c) => [...c.findings, ...c.passed]).map((x) => x.message).join('|')).not.toContain('asset-1');
  });

  it('D-56: định danh ghi khác nhau → nêu các giá trị; mỗi tài sản chỉ nêu một lần dù có nhiều mục', () => {
    const conflict = asset({ usage_contexts: ['collateral'], context_status: 'AMBIGUOUS', context_reason_code: 'ASSET_IDENTIFIER_CONFLICT', identifier_conflicts: [{ field: 'certificate_number', values: ['CS 123456', 'CS 654321'], probable_ocr_error: false }] });
    const a = run([gcn(), gcn({ item_key: 'collateral_valuation' })], conflict);
    expect(crit(a, 2).findings.map((f) => f.message)).toEqual(['Số Giấy chứng nhận CS 123456: Số Giấy chứng nhận ghi khác nhau giữa các chứng từ (CS 123456 / CS 654321).']);
    expect(crit(run([gcn()], asset({ identifiers: {} })), 2).findings[0].message).toMatch(/^Tài sản asset-1: /);
  });

  it('D-56: tài sản đã có sai lệch trọng yếu ở S5 thì không nêu lại thành điểm thứ hai', () => {
    const mismatch = { match_status: 'MISMATCH', field_group: 'asset_identity', sub_field: 'certificate_number', field_label: 'Số Giấy chứng nhận', person_id: null, asset_id: 'asset-1', reason: 'Số GCN ghi khác nhau', values: [] };
    const a = run([gcn()], asset(), { results: [mismatch] });
    expect(crit(a, 2).findings.map((f) => f.code)).toEqual(['XCHECK:asset_identity.certificate_number:asset-1']);
  });

  it('D-56: chưa tìm được chứng từ nào cho mục tài sản → tiêu chí 1 báo Thiếu, tiêu chí 2 không báo', () => {
    const a = run([gcn({ found_in: [] })]);
    expect(crit(a, 1).status).toBe('FAIL');
    expect(crit(a, 1).findings[0].message).toMatch(/^Thiếu: GCN QSDĐ/);
    expect(crit(a, 2).findings).toEqual([]);
  });

  it('D-56: vai trò khớp nhiều danh tính / chưa xác minh quan hệ → tiêu chí 2, mỗi người một điểm', () => {
    const per = (o: Record<string, unknown>) => row({ item_key: 'legal_id_card', item_label: 'Căn cước công dân', checklist_group: 'legal', status: 'NEEDS_REVIEW', person_id: 'person-1', found_in: FOUND, ...o });
    const a = withItems([per({ reason_code: 'ROLE_CONFLICT_UNRESOLVED' }), per({ item_key: 'legal_vneid', reason_code: 'ROLE_CONFLICT_UNRESOLVED' }), per({ item_key: 'legal_birth_certificate', reason_code: 'RELATIONSHIP_UNVERIFIED' })],
      { s3: { customer_360: [{ person_id: 'person-1', identity: { full_name: 'NGUYỄN VĂN AN' } }] } as never });
    expect(crit(a, 1).status).toBe('PASS');
    expect(crit(a, 2).findings.map((f) => f.code)).toEqual(['ROLE_CONFLICT:person-1', 'RELATIONSHIP_UNVERIFIED:person-1']);
    expect(crit(a, 2).findings[0].message).toMatch(/^NGUYỄN VĂN AN: /);
  });

  it('D-56: chỉ có bản không đọc được → tiêu chí 1 báo Cần scan lại; tiêu chí 4 không nêu lại cùng file', () => {
    const bad = { ...ev('cic'), status: 'ERROR' as const, reason_code: 'UNREADABLE_CONTENT', data: null, field_confidences: {} };
    const rescan = row({ status: 'NEEDS_RESCAN', reason_code: 'EXTRACTION_FAILED', message: 'Không đọc được chứng từ; cần scan lại.', found_in: [{ ...FOUND[0], evidence_id: bad.evidence_id }] });
    const a = withItems([rescan], { evidences: [bad] });
    expect(crit(a, 1).findings[0].message).toBe(`Cần scan lại: ${rescan.item_label} - Lý do: Không đọc được chứng từ; cần scan lại.`);
    expect(crit(a, 4).findings).toEqual([]);
    const other = { ...ev('cic'), status: 'ERROR' as const, reason_code: 'UNREADABLE_CONTENT', data: null, field_confidences: {} };
    expect(crit(withItems([rescan], { evidences: [bad, other] }), 4).findings.map((f) => f.code)).toEqual([`FILE_UNREADABLE:${other.evidence_id}`]);
  });
});