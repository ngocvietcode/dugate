// T-MD-12 — các bước sau dùng giá trị hiệu chỉnh + giao diện (MD-R19, MD-AC18).
import { evidenceWhere, masterFieldRows, masterGroups, masterStatusTone, MASTER_STATUS_LABELS } from '@/app/loan-appraisal-v2/lib/master-view';
import { applyMasterCorrections, proposeMasterCorrections } from '@/lib/loan-dossier/master/correct';
import { buildIntakeAssessment } from '@/lib/pipelines/workflows/loan-appraisal/intake-assessment';
import { applyMasterToCustomer360, masterEvidenceRegistry } from '@/lib/pipelines/workflows/loan-appraisal/master-dossier';
import { toLegacyCustomer360 } from '@/lib/pipelines/workflows/loan-appraisal/evidence-v3';
import { buildEvidenceRegistryV3 } from '@/lib/pipelines/workflows/loan-appraisal/evidence-v3';
import { briefMasterDossier } from '@/lib/pipelines/workflows/loan-appraisal/integration-payload';

import { ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';
import { runDossier } from '../loan-dossier/fixtures/master';

const BAD_ID = '001090000077';
const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const holder = (id: string) => ({ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: id });
const gcn = (book: string, file: string) => ({
  ...ev('land_use_certificate', { parties: [holder(ID_A12)], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AA 08798136', certificate_book_number: book } }] }),
  file_name: file,
});

async function dossier(evs = [loanApp([borrower]), ev('id_card', { parties: [holder(ID_A12)] }), ev('cic', { parties: [holder(BAD_ID)] })]) {
  const r = await runDossier(evs);
  const proposals = proposeMasterCorrections(r.master, r.evidences);
  const decisions = proposals.map((p) => ({ proposal_id: p.proposal_id, action: 'SELECT' as const, option_id: p.options.find((o) => o.value === ID_A12 || o.value === 'CN 6475')?.option_id ?? null, reason: 'đa số' }));
  const fixed = applyMasterCorrections(r.master, proposals, decisions);
  return { ...r, proposals, fixed };
}
const assess = (r: Awaited<ReturnType<typeof dossier>>, master: typeof r.master | null) => buildIntakeAssessment({
  classify: null, evidences: r.evidences, s3: r.s3.data, checklist: r.s4.data, crossCheck: r.s5.data, master, acknowledgements: [],
});
const c2 = (a: ReturnType<typeof buildIntakeAssessment>) => a.criteria.find((c) => c.key === 'CONSISTENT_ACROSS_DOCUMENTS')!;

describe('Customer 360 cho Rule LLM (MD-R19 c)', () => {
  it('CCCD đã hiệu chỉnh → identity.id_number lấy giá trị đã sửa; customer_360 của S3 không đổi', async () => {
    const r = await dossier();
    const s3Before = JSON.stringify(r.s3.data!.customer_360);
    const legacy = toLegacyCustomer360(r.s3.data);
    const out = applyMasterToCustomer360(legacy, r.fixed);
    expect(out.identity).toMatchObject({ id_number: ID_A12 });
    expect(out.relationship).toEqual(legacy.relationship);
    expect(JSON.stringify(r.s3.data!.customer_360)).toBe(s3Before);
  });
  it('CONFLICT chưa hiệu chỉnh, hoặc không có master → giữ nguyên', async () => {
    const r = await dossier();
    const legacy = toLegacyCustomer360(r.s3.data);
    expect(applyMasterToCustomer360(legacy, r.master)).toEqual(legacy);
    expect(applyMasterToCustomer360(legacy, null)).toBe(legacy);
  });
  it('trường tài sản CORRECTED (identifiers.*) → ghi đè đúng khóa identifiers của đúng tài sản, tài sản khác giữ nguyên', () => {
    const field = (path: string, status: string, value: string) => ({ path, label: path, kind: 'code', value, status, review_status: 'REVIEW', confidence: null, sources: [], candidates: [], outliers: [], note: null });
    const master = {
      persons: [],
      assets: [
        { entity_id: 'asset-1', label: 'a1', document_ids: [], fields: [field('identifiers.certificate_number', 'CORRECTED', 'AA 08798136'), field('identifiers.chassis_number', 'CONFLICT', 'ZZ')] },
        { entity_id: 'asset-2', label: 'a2', document_ids: [], fields: [field('identifiers.certificate_number', 'AGREED', 'XX')] },
      ],
    } as never;
    const c360 = { collateral: { assets: [
      { asset_id: 'asset-1', identifiers: { certificate_number: 'AA 08798163', chassis_number: 'K1' } },
      { asset_id: 'asset-2', identifiers: { certificate_number: 'BB 1' } },
    ] } };
    const out = applyMasterToCustomer360(c360, master);
    const assets = out.collateral!.assets as Array<{ asset_id: string; identifiers: Record<string, unknown> }>;
    expect(assets[0].identifiers).toEqual({ certificate_number: 'AA 08798136', chassis_number: 'K1' });
    expect(assets[1]).toBe((c360.collateral.assets as unknown[])[1]);
    expect((c360.collateral.assets as Array<{ identifiers: Record<string, unknown> }>)[0].identifiers.certificate_number).toBe('AA 08798163');
  });
});

describe('Rule LLM nhận giá trị đã hiệu chỉnh (MD-R19 a)', () => {
  it('registry mang value đã sửa, review_status = REVIEW', async () => {
    const r = await dossier();
    const raw = buildEvidenceRegistryV3(r.evidences, new Set(), r.s4.data);
    const reg = masterEvidenceRegistry(r.fixed, raw);
    const rec = reg.records.find((x) => x.master_scope === 'master:person' && x.field_path === 'id_number')!;
    expect(rec).toMatchObject({ value: ID_A12, review_status: 'REVIEW' });
    expect(String(rec.value)).not.toContain('CHƯA THỐNG NHẤT');
    // trước hiệu chỉnh: ứng viên được nêu hết, không tự chọn
    const before = masterEvidenceRegistry(r.master, raw).records.find((x) => x.master_scope === 'master:person' && x.field_path === 'id_number')!;
    expect(String(before.value)).toContain('CHƯA THỐNG NHẤT');
  });
});

describe('tiêu chí 2 của intake_assessment (MD-R19 d, MD-AC18)', () => {
  it('trước hiệu chỉnh: CCCD lệch là điểm cần kiểm tra', async () => {
    const r = await dossier();
    const a = c2(assess(r, r.master));
    expect(a.findings.some((f) => f.code.startsWith('XCHECK:id_number'))).toBe(true);
    expect(a.status).toBe('NEEDS_EXPLANATION');
  });
  it('sau hiệu chỉnh: không còn điểm cho CCCD, có dòng "đã hiệu chỉnh" trong danh sách đã khớp', async () => {
    const r = await dossier();
    const a = c2(assess(r, r.fixed));
    expect(a.findings.filter((f) => f.code.startsWith('XCHECK:id_number'))).toEqual([]);
    expect(a.passed.some((p) => p.code.startsWith('CORRECTED_OK:person-1:id_number') && p.message.includes('đã hiệu chỉnh theo đa số, cần xác nhận'))).toBe(true);
  });
  it('trường CONFLICT khác chưa hiệu chỉnh vẫn ra điểm cần kiểm tra như cũ', async () => {
    const r = await dossier();
    // LLM không chọn → master giữ CONFLICT
    const kept = applyMasterCorrections(r.master, r.proposals, [{ proposal_id: r.proposals[0].proposal_id, action: 'KEEP_CONFLICT', option_id: null, reason: '' }]);
    expect(kept).toBe(r.master);
    expect(c2(assess(r, kept)).findings.some((f) => f.code.startsWith('XCHECK:id_number'))).toBe(true);
  });
  it('số vào sổ GCN của chứng từ đã hiệu chỉnh → COPY_CONFLICT chuyển sang đã khớp', async () => {
    const app = loanApp([borrower], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136' } }] });
    const r = await dossier([app, gcn('CN 6475', 'a.pdf'), gcn('CN 6475', 'b.pdf'), gcn('CN 6457', 'c.pdf')]);
    expect(c2(assess(r, r.master)).findings.some((f) => f.code.startsWith('COPY_CONFLICT:') && f.code.endsWith('certificate_book_number'))).toBe(true);
    const after = c2(assess(r, r.fixed));
    expect(after.findings.some((f) => f.code.startsWith('COPY_CONFLICT:') && f.code.endsWith('certificate_book_number'))).toBe(false);
    expect(after.passed.some((p) => p.code.startsWith('CORRECTED_OK:') && p.code.endsWith('certificate_book_number'))).toBe(true);
  });
});

describe('giao diện (MD-R19 e)', () => {
  it('thêm nhãn CORRECTED; 5 nhãn cũ không đổi', () => {
    expect(MASTER_STATUS_LABELS).toEqual({
      AGREED: 'Thống nhất', OCR_NORMALIZED: 'Đã chuẩn hóa (nghi lỗi đọc)', SINGLE_SOURCE: 'Một nguồn', CONFLICT: 'Chưa thống nhất', MISSING: 'Thiếu',
      CORRECTED: 'Đã hiệu chỉnh (cần xác nhận)',
    });
    expect(masterStatusTone('CORRECTED', 'REVIEW')).toBe('warning');
    expect(masterStatusTone('CONFLICT', 'REVIEW')).toBe('danger');
    expect(masterStatusTone('OCR_NORMALIZED', 'ACCEPTED')).toBe('info');
  });
  it('dòng CORRECTED hiện giá trị đã chọn và giá trị bị loại kèm nơi ghi; CONFLICT vẫn "Chưa thống nhất"', async () => {
    const app = loanApp([borrower], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136' } }] });
    const r = await dossier([app, gcn('CN 6475', 'a.pdf'), gcn('CN 6475', 'b.pdf'), gcn('CN 6457', 'dinh_gia.pdf')]);
    const where = evidenceWhere(r.evidences);
    const pick = (m: typeof r.master) => [...m.documents, ...m.other_documents].filter((d) => d.doc_type_key === 'land_use_certificate').flatMap((d) => d.fields).find((f) => f.path.endsWith('certificate_book_number'))!;
    const before = masterFieldRows([pick(r.master)], where)[0];
    expect(before).toMatchObject({ value: 'Chưa thống nhất', status_label: 'Chưa thống nhất', tone: 'danger' });
    const row = masterFieldRows([pick(r.fixed)], where)[0];
    expect(row).toMatchObject({ value: 'CN 6475', status: 'CORRECTED', status_label: 'Đã hiệu chỉnh (cần xác nhận)', tone: 'warning' });
    expect(row.details.filter((d) => d.startsWith('Bản lệch: CN 6457')).length).toBeGreaterThan(0);
    expect(row.details.join('\n')).toContain('dinh_gia.pdf');
    const docs = masterGroups(r.fixed, where).flatMap((g) => g.documents);
    expect(docs.some((d) => d.corrected > 0)).toBe(true);
    expect(docs.every((d) => d.conflicts === 0 || d.rows.some((x) => x.status === 'CONFLICT'))).toBe(true);
  });
});

describe('payload tích hợp (MD-R19 e)', () => {
  it('trường CORRECTED qua status + needs_review + note; không lộ correction/candidates', async () => {
    const r = await dossier();
    const brief = briefMasterDossier(r.fixed)!;
    const f = brief.persons[0].fields.find((x) => x.path === 'id_number')!;
    expect(f).toMatchObject({ status: 'CORRECTED', value: ID_A12, needs_review: true });
    expect(f.note).toContain('Đã hiệu chỉnh');
    expect(f).not.toHaveProperty('correction');
    expect(f).not.toHaveProperty('candidates');
    expect(brief.summary).toHaveProperty('corrected');
  });
});
