// T-MD-01, T-MD-02 — hợp đồng và chứng từ hợp nhất của master_dossier (MD-R02…R07, MD-R12).
import { MasterDossierSchema, MasterFieldSchema } from '@/lib/loan-dossier/contracts/master-dossier';
import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import { alignedLeaves, planCopies } from '@/lib/loan-dossier/master/document';
import { compareKey, fieldKind, mergeField } from '@/lib/loan-dossier/master/field';
import { buildMasterDossier, tryBuildMasterDossier } from '@/lib/loan-dossier/master/build';
import catalog from '@/lib/loan-dossier/catalog/data/doc_types.json';
import enums from '@/lib/loan-dossier/catalog/data/enums.json';

import { ev, ID_A12, loanApp } from './fixtures/dossier';
import { makeEvidence } from './fixtures/build';
import { runDossier } from './fixtures/master';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1990-01-01' };
const gcn = (book: string, file: string) => ({
  ...ev('land_use_certificate', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AA 08798136', certificate_book_number: book } }] }),
  file_name: file,
});
const app = (o: Parameters<typeof loanApp>[1] = {}, party: Record<string, unknown> = {}) => loanApp([{ ...borrower, ...party }], {
  assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136' } }], ...o,
});
const allDocs = (m: Awaited<ReturnType<typeof runDossier>>['master']) => [...m.documents, ...m.other_documents];

describe('hợp đồng (T-MD-01)', () => {
  const f = { path: 'a', label: 'a', kind: 'code', value: null, review_status: 'REVIEW', confidence: null, sources: [], candidates: [], outliers: [], note: null };
  it('CONFLICT bắt buộc value = null và candidates ≥ 2', () => {
    const cand = [{ value: 'X', evidence_ids: ['ev-000000000001#a'] }, { value: 'Y', evidence_ids: ['ev-000000000002#a'] }];
    expect(MasterFieldSchema.safeParse({ ...f, status: 'CONFLICT', candidates: cand }).success).toBe(true);
    expect(MasterFieldSchema.safeParse({ ...f, status: 'CONFLICT', value: 'X', candidates: cand }).success).toBe(false);
    expect(MasterFieldSchema.safeParse({ ...f, status: 'CONFLICT', candidates: cand.slice(0, 1) }).success).toBe(false);
  });
  it('OCR_NORMALIZED bắt buộc outliers và note; MISSING bắt buộc value null, sources rỗng', () => {
    expect(MasterFieldSchema.safeParse({ ...f, status: 'OCR_NORMALIZED', value: 'X' }).success).toBe(false);
    expect(MasterFieldSchema.safeParse({ ...f, status: 'MISSING', sources: ['ev-000000000001#a'] }).success).toBe(false);
    expect(MasterFieldSchema.safeParse({ ...f, status: 'MISSING' }).success).toBe(true);
  });
  it('enum MasterFieldStatus, MasterCopyRole có trong enums.json', () => {
    const e = (enums as { enums: Record<string, string[]> }).enums;
    expect(e.MasterFieldStatus).toEqual(['AGREED', 'OCR_NORMALIZED', 'SINGLE_SOURCE', 'CONFLICT', 'MISSING', 'CORRECTED']);
    expect(e.MasterCopyRole).toEqual(['PRIMARY', 'DUPLICATE', 'SUPERSEDED', 'EXCLUDED']);
  });
});

describe('loại trường (MD-R06)', () => {
  it('suy loại theo tên field + kiểu giá trị', () => {
    expect(fieldKind('assets[0].identifiers.certificate_book_number', 'CN 6475')).toBe('code');
    expect(fieldKind('parties[0].id_number', '0331')).toBe('id');
    expect(fieldKind('assets[0].identifiers.license_plate', '51K1')).toBe('plate');
    expect(fieldKind('parties[0].full_name', 'A')).toBe('name');
    expect(fieldKind('parties[0].date_of_birth', '1990-01-01')).toBe('date');
    expect(fieldKind('loan_info.bank_proposed_amount', 1)).toBe('money');
    expect(fieldKind('loan_info.loan_term_months', 18)).toBe('number');
    expect(fieldKind('parties[0].permanent_address', { full_text: 'x' })).toBe('address');
    expect(compareKey('code', 'CH.6475')).toBe('CH6475');
  });
  it('mọi lá của evidence mẫu ở cả 47 loại đều có loại', () => {
    const keys = (catalog as { doc_types: Array<{ doc_type_key: string }> }).doc_types.map((d) => d.doc_type_key);
    expect(keys).toHaveLength(47);
    for (const k of keys) {
      expect(docTypeByKey(k)).toBeDefined();
      const e = makeEvidence(k);
      for (const [path, l] of alignedLeaves(e.data ?? {})) expect(typeof fieldKind(path, l.value)).toBe('string');
    }
  });
});

describe('hợp nhất bản trùng (T-MD-02)', () => {
  it('MD-AC01: 3 bản GCN "CN 6475", "CN 6475", "CH.6475" → OCR_NORMALIZED theo đa số, note nêu mẫu biểu + file', async () => {
    const { master } = await runDossier([app(), gcn('CN 6475', 'so_do.pdf'), gcn('CN 6475', 'chung_thu.pdf'), gcn('CH.6475', 'dinh_gia_doi_chieu.pdf')]);
    const doc = allDocs(master).find((d) => d.doc_type_key === 'land_use_certificate' && d.fields.length > 0)!;
    expect(doc.copies.filter((c) => c.role === 'PRIMARY' || c.role === 'DUPLICATE')).toHaveLength(3);
    const f = doc.fields.find((x) => x.path.endsWith('identifiers.certificate_book_number'))!;
    expect(f).toMatchObject({ status: 'OCR_NORMALIZED', value: 'CN 6475', review_status: 'ACCEPTED' });
    expect(f.outliers).toEqual([expect.objectContaining({ raw_value: 'CH.6475', reason_code: 'PROBABLE_OCR_ERROR' })]);
    expect(f.note).toContain('(dinh_gia_doi_chieu.pdf');
    expect(MasterDossierSchema.safeParse(master).success).toBe(true);
  });

  it('MD-AC02: 2 bản đề nghị vay khác ngày sinh, cả hai confidence 0.95 → CONFLICT, value null, 2 ứng viên', async () => {
    const { master } = await runDossier([app(), app({}, { date_of_birth: '1991-02-02' })]);
    const doc = allDocs(master).find((d) => d.doc_type_key === 'loan_application')!;
    const f = doc.fields.find((x) => x.path.endsWith('date_of_birth'))!;
    expect(f).toMatchObject({ status: 'CONFLICT', value: null, review_status: 'REVIEW' });
    expect(f.candidates.map((c) => c.value).sort()).toEqual(['1990-01-01', '1991-02-02']);
  });

  it('MD-R05 (f): một phía confidence thấp → SINGLE_SOURCE/REVIEW, giữ ứng viên', () => {
    const v = (value: string, confidence: number, i: number) => ({ record_id: `ev-00000000000${i}#parties[0].date_of_birth`, evidence_id: `ev-00000000000${i}`, value, confidence, primary: i === 1, where: 'x' });
    const f = mergeField('parties[0].date_of_birth', 'x', [v('1990-01-01', 0.95, 1), v('1991-02-02', 0.5, 2)]);
    expect(f).toMatchObject({ status: 'SINGLE_SOURCE', value: '1990-01-01', review_status: 'REVIEW' });
    expect(f.candidates).toHaveLength(2);
  });

  it('MD-AC04: luồng FULL, mục bắt buộc chưa có chứng từ → MasterDocument MISSING, copies = []', async () => {
    const { master, s4 } = await runDossier([app()]);
    expect(master.documents).toHaveLength(s4.data!.items.length);
    const missing = master.documents.filter((d) => d.checklist_status === 'MISSING' && d.required);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((d) => d.copies.length === 0 && d.fields.length === 0)).toBe(true);
  });

  it('MD-AC05: bản nhận nhầm loại → EXCLUDED/FORM_NOT_FOUND, bản bị thay thế → SUPERSEDED; không góp giá trị', () => {
    const ok = ev('cic', { parties: [{ party_role: 'HOLDER', full_name: 'A', id_number: ID_A12 }] });
    const wrong = { ...ev('cic'), status: 'ERROR' as const, reason_code: 'FORM_NOT_FOUND', data: null, field_confidences: {} };
    const old = ev('cic', { parties: [{ party_role: 'HOLDER', full_name: 'A', id_number: ID_A12 }] });
    const order = new Map([ok, wrong, old].map((e, i) => [e.evidence_id, i]));
    const plans = planCopies([ok, wrong, old], new Set([old.evidence_id]), 'cic', order);
    expect(plans.map((p) => [p.role, p.excluded_reason])).toEqual([['PRIMARY', null], ['EXCLUDED', 'FORM_NOT_FOUND'], ['SUPERSEDED', null]]);
  });

  it('2 chứng từ cùng loại khác nhóm trùng (bản thể khác) → không trộn giá trị; cụm phụ EXCLUDED/OTHER_INSTANCE', () => {
    const a = { ...ev('cic'), duplicate_group_id: null, duplicate_status: null };
    const b = { ...ev('cic'), duplicate_group_id: null, duplicate_status: null };
    const plans = planCopies([a, b], new Set(), 'cic', new Map([[a.evidence_id, 0], [b.evidence_id, 1]]));
    expect(plans.map((p) => p.role)).toEqual(['PRIMARY', 'EXCLUDED']);
    expect(plans[1].excluded_reason).toBe('OTHER_INSTANCE');
  });

  it('MD-AC10: cùng đầu vào chạy 2 lần → giống hệt', async () => {
    const { input } = await runDossier([app(), gcn('CN 6475', 'a.pdf'), gcn('CH.6475', 'b.pdf')]);
    expect(JSON.stringify(buildMasterDossier(input))).toBe(JSON.stringify(buildMasterDossier(input)));
  });

  it('MD-AC12: đầu vào hỏng → master null + cảnh báo không chứa giá trị', () => {
    const r = tryBuildMasterDossier({ evidences: null as never, s3: null, checklist: null, crossCheck: null });
    expect(r.master).toBeNull();
    expect(r.warning).toMatch(/^MASTER_DOSSIER_UNAVAILABLE/);
  });
});
