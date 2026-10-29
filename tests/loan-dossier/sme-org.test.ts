// SME: bên vay là pháp nhân. Khớp theo mã số thuế (không theo tên người), không gộp pháp nhân với cá nhân, không gán vợ/chồng cho công ty,
// người đại diện nối bằng cạnh LEGAL_REP_OF, và output HKD không đổi.
import { MapDossierDataSchema } from '@/lib/loan-dossier/contracts/check-stages';
import { buildDossierGraph, projectMapDossierData, renderDossierGraph, toDossierGraphView, DossierGraphViewSchema } from '@/lib/loan-dossier/graph';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import { checkInvariants } from '@/lib/loan-dossier/s3/status';

import { buildCustomer360View } from '@/app/loan-appraisal-v2/lib/customer360';
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { buildProfile360 } from '@/lib/loan-dossier/profile360/build';
import { buildNodeFacts, edgeLabel, labelFor, showsLabelOnCanvas } from '@/app/loan-appraisal-v2/lib/graph-view';

import { ev, ID_A12, ID_B12, loanApp } from './fixtures/dossier';

const now = () => new Date('2026-10-14T03:00:00.000Z');
const MST = '0312345678';
const ID_R = '001090000055';

const company = (extra: Record<string, unknown> = {}) => ({
  party_role: 'BORROWER', party_type: 'ORGANIZATION', full_name: 'CÔNG TY TNHH ABC', id_number: null, tax_id: MST,
  representative_name: 'NGUYỄN VĂN AN', representative_position: 'Giám đốc', ...extra,
});
const rep = (extra: Record<string, unknown> = {}) => ({ party_role: 'CO_BORROWER', party_type: 'INDIVIDUAL', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, ...extra });
const license = (id: string, party: Record<string, unknown> = {}, fields: Record<string, unknown> = { registration_number: MST }) =>
  ev('enterprise_registration_license', {
    id, parties: [{ party_role: 'OWNER', party_type: 'ORGANIZATION', full_name: 'Cty TNHH ABC', tax_id: MST, ...party }], data: { fields },
  });

const run = (evs: EvidenceEnvelope[]) => runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-14', now });
const smeDossier = (): EvidenceEnvelope[] => [
  loanApp([company(), rep()], { id: 'ev-cccccccccc01' }),
  license('ev-cccccccccc02', { representative_name: 'NGUYỄN VĂN AN', representative_position: 'Giám đốc' }, { registration_number: MST, headquarters_address: { full_text: '12 LÊ LỢI, Q1, HCM', street: '12 LÊ LỢI', ward: null, district: 'Q1', province: 'HCM' } }),
  ev('id_card', { id: 'ev-cccccccccc03', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] }),
];

describe('S3 với bên vay là pháp nhân', () => {
  it('doanh nghiệp là một "người" riêng, khớp chứng từ theo MST dù tên viết khác', () => {
    const d = run(smeDossier()).data!;
    const org = d.role_registry[0];
    expect(org).toMatchObject({ person_id: 'person-1', roles: ['borrower'], full_name: 'CÔNG TY TNHH ABC' });
    const mapped = org.mapped_evidences.map((m) => [(m as { doc_type_key: string }).doc_type_key, (m as { matched_by: string }).matched_by]);
    expect(mapped).toEqual([['loan_application', 'ANCHOR'], ['enterprise_registration_license', 'ID_NUMBER']]);
  });

  it('người đại diện là cá nhân riêng; không gộp với công ty', () => {
    const d = run(smeDossier()).data!;
    expect(d.role_registry.map((p) => [p.person_id, p.roles])).toEqual([['person-1', ['borrower']], ['person-2', ['co_borrower']]]);
    expect(d.role_registry[1].mapped_evidences.map((m) => (m as { doc_type_key: string }).doc_type_key)).toEqual(['loan_application', 'id_card']);
  });

  it('customer_360.organization: MST, số ĐKDN, trụ sở, người đại diện nối đúng person-2', () => {
    const d = run(smeDossier()).data!;
    expect(d.customer_360[0].organization).toEqual({
      tax_id: MST, registration_number: MST, headquarters_address: expect.objectContaining({ full_text: '12 LÊ LỢI, Q1, HCM' }),
      representative_name: 'NGUYỄN VĂN AN', representative_position: 'Giám đốc', representative_person_id: 'person-2',
    });
    expect(d.customer_360[1]).not.toHaveProperty('organization');
  });

  it('công ty không có vợ/chồng dù đơn vay có party SPOUSE; vợ/chồng cá nhân không bị nối sang công ty', () => {
    const evs = [loanApp([company(), rep(), { party_role: 'SPOUSE', party_type: 'INDIVIDUAL', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 }], { id: 'ev-cccccccccc01' })];
    const d = run(evs).data!;
    expect(d.customer_360.map((c) => c.spouse_person_id)).toEqual([null, null, null]);
  });

  it('hợp lệ hợp đồng (strict) và nhất quán tham chiếu', () => {
    const d = run(smeDossier()).data!;
    const parsed = MapDossierDataSchema.safeParse(d);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(checkInvariants(d, new Set(smeDossier().map((e) => e.evidence_id)))).toEqual([]);
  });

  it('bẫy: MST khác nhau nhưng cùng tên riêng → hai công ty khác nhau, không gộp', () => {
    const evs = [loanApp([company()], { id: 'ev-cccccccccc01' }), license('ev-cccccccccc02', { tax_id: '0399999999', full_name: 'CÔNG TY TNHH ABC' }, { registration_number: '0399999999' })];
    const d = run(evs).data!;
    expect(d.role_registry[0].mapped_evidences.map((m) => (m as { doc_type_key: string }).doc_type_key)).toEqual(['loan_application']);
  });

  it('bẫy: khác loại hình (TNHH ≠ CP) cùng tên riêng, không có MST → không khớp', () => {
    const evs = [loanApp([company()], { id: 'ev-cccccccccc01' }), license('ev-cccccccccc02', { tax_id: null, full_name: 'CÔNG TY CỔ PHẦN ABC' }, {})];
    const d = run(evs).data!;
    expect(d.role_registry[0].mapped_evidences).toHaveLength(1);
  });

  it('không có MST: khớp theo tên pháp nhân (bỏ loại hình) và đánh dấu khớp theo tên', () => {
    const evs = [loanApp([company({ tax_id: null })], { id: 'ev-cccccccccc01' }), license('ev-cccccccccc02', { tax_id: null, full_name: 'Cty TNHH ABC' }, {})];
    const d = run(evs).data!;
    const m = d.role_registry[0].mapped_evidences[1] as { matched_by: string; match_confidence: number };
    expect(m.matched_by).toBe('FULL_NAME');
    expect(m.match_confidence).toBeLessThanOrEqual(0.9);
  });

  it('bẫy: cá nhân trùng tên với công ty (không MST) không bị gộp vào công ty, và ngược lại', () => {
    const evs = [
      loanApp([company({ tax_id: null, full_name: 'ABC' })], { id: 'ev-cccccccccc01' }),
      ev('id_card', { id: 'ev-cccccccccc03', parties: [{ party_role: 'HOLDER', party_type: 'INDIVIDUAL', full_name: 'ABC', id_number: ID_A12 }] }),
    ];
    const d = run(evs).data!;
    expect(d.role_registry[0].mapped_evidences).toHaveLength(1);
    expect(d.unmapped_evidences.map((u) => u.doc_type_key)).toEqual(['id_card']);
  });

  it('khách vay là công ty: không sinh nhân thân (relationship_verifications) cho chủ TSBĐ', () => {
    const evs = [loanApp([company(), { party_role: 'COLLATERAL_OWNER', party_type: 'INDIVIDUAL', full_name: 'LÊ THỊ CÚC', id_number: ID_B12 }], { id: 'ev-cccccccccc01', relations: { 1: { raw: 'Mẹ' } } })];
    expect(run(evs).data!.relationship_verifications).toEqual([]);
  });

  it('người đại diện trùng tên nhiều cá nhân → không nối (representative_person_id = null)', () => {
    const evs = [loanApp([company(), rep(), rep({ party_role: 'COLLATERAL_OWNER', id_number: ID_B12 })], { id: 'ev-cccccccccc01' })];
    const d = run(evs).data!;
    const orgEntry = d.customer_360.find((c) => c.organization)!;
    expect(orgEntry.organization!.representative_person_id).toBeNull();
  });

  it('HKD không đổi: không khóa organization, cá nhân vẫn khớp như cũ', () => {
    const evs = [loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], { id: 'ev-cccccccccc01' }), ev('id_card', { id: 'ev-cccccccccc03', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })];
    const d = run(evs).data!;
    expect(d.customer_360.every((c) => !('organization' in c))).toBe(true);
    expect(d.role_registry[0].mapped_evidences).toHaveLength(2);
  });
});

describe('graph với doanh nghiệp', () => {
  const data = () => run(smeDossier()).data!;

  it('chiếu ngược khớp từng byte, kể cả khối organization', () => {
    const d = data();
    expect(JSON.stringify(projectMapDossierData(buildDossierGraph(d)))).toBe(JSON.stringify(d));
  });

  it('cạnh LEGAL_REP_OF: người đại diện → doanh nghiệp; không lưu hai chỗ trong node', () => {
    const g = buildDossierGraph(data());
    expect(g.hasEdge('LEGAL_REP_OF:person-2>person-1')).toBe(true);
    expect((g.getNodeAttributes('person-1') as unknown as { organization: Record<string, unknown> }).organization).not.toHaveProperty('representative_person_id');
  });

  it('view: node doanh nghiệp có org=true, cá nhân không; cạnh LEGAL_REP_OF; hợp lệ hợp đồng; không PII', () => {
    const v = toDossierGraphView(buildDossierGraph(data()));
    expect(DossierGraphViewSchema.safeParse(v).success).toBe(true);
    expect(v.nodes.find((n) => n.id === 'person-1')).toMatchObject({ org: true });
    expect(v.nodes.find((n) => n.id === 'person-2')).not.toHaveProperty('org');
    expect(v.edges.find((e) => e.type === 'LEGAL_REP_OF')).toMatchObject({ source: 'person-2', target: 'person-1' });
    const json = JSON.stringify(v);
    for (const pii of [MST, 'CÔNG TY', 'NGUYỄN', ID_A12, 'LÊ LỢI']) expect(json).not.toContain(pii);
  });

  it('render cho LLM: dòng doanh nghiệp có MST / ĐKDN / trụ sở / đại diện, không có giới tính-số ĐD cá nhân; đại diện nối bằng id', () => {
    const text = renderDossierGraph(buildDossierGraph(data()), null);
    const line = text.split('\n').find((l) => l.startsWith('person-1'))!;
    expect(line).toContain('(doanh nghiệp)');
    expect(line).toContain(`MST ${MST}`);
    expect(line).toContain(`số ĐKDN ${MST}`);
    expect(line).toContain('trụ sở 12 LÊ LỢI');
    expect(line).toContain('đại diện NGUYỄN VĂN AN (Giám đốc)');
    expect(line).not.toMatch(/giới tính|sinh |số ĐD/);
    expect(text).toContain('person-2 → person-1: người đại diện theo pháp luật');
    expect(text).not.toMatch(/ev-[0-9a-f]{12}/);
  });
});

describe('UI: Customer 360 và sơ đồ cho doanh nghiệp', () => {
  const d = () => run(smeDossier()).data!;
  const view = () => toDossierGraphView(buildDossierGraph(d()));
  const label = (k: string) => `L(${k})`;

  const c360 = () => {
    const evidences = smeDossier();
    const s3 = run(evidences).data!;
    const lac = buildLoanApplicationContext({ product_code: 'sme', flow: 'FLOW_A', evidences, s3, s3_status: 'SUCCESS' });
    return buildCustomer360View(buildProfile360({ evidences, s3, lac, segment: 'SME' }), label);
  };

  it('thẻ doanh nghiệp: MST, số ĐKDN, trụ sở; không có số định danh cá nhân, ngày sinh, hôn nhân', () => {
    const org = c360().customers.find((p) => p.isOrg)!;
    expect(org.identity.map((f) => f.label)).toEqual(['Mã số thuế', 'Số ĐKDN', 'Trụ sở']);
    expect(org.identity[0].value).toBe(MST);
    expect(org.identity.some((f) => /định danh|sinh|Thường trú|Hôn nhân/.test(f.label))).toBe(false);
  });

  it('quan hệ đại diện hiện ở cả hai phía; SME: đơn vay + GCN ĐKDN là MỘT doanh nghiệp, không dựng hộ kinh doanh (D-112, D-116)', () => {
    const v = c360();
    const org = v.customers.find((p) => p.isOrg)!;
    const person = v.customers.find((p) => !p.isOrg)!;
    expect(org.relations).toEqual([expect.objectContaining({ text: 'Người đại diện theo pháp luật (Giám đốc) · xác minh một phần', name: person.name })]);
    expect(person.relations).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Đại diện theo pháp luật của · xác minh một phần', name: org.name })]));
    expect(v.repayment.businesses).toEqual([expect.objectContaining({ kind: 'Doanh nghiệp', name: 'CÔNG TY TNHH ABC', owners: org.name })]);
  });

  it('thẻ sơ đồ: doanh nghiệp hiện MST che bớt (không lộ đủ), phụ đề có "Doanh nghiệp"; cạnh đại diện có nhãn trên sơ đồ', () => {
    const facts = buildNodeFacts(d());
    expect(facts.get('person-1')).toEqual({ name: 'CÔNG TY TNHH ABC', detail: 'MST ••••5678' });
    const v = view();
    const card = labelFor(v.nodes.find((n) => n.id === 'person-1')!, facts, new Map());
    expect(card.subtitle).toBe('Doanh nghiệp · Khách hàng vay');
    expect(JSON.stringify([...facts.values()])).not.toContain(MST);
    const e = v.edges.find((x) => x.type === 'LEGAL_REP_OF')!;
    expect(edgeLabel(e)).toBe('đại diện pháp luật');
    expect(showsLabelOnCanvas(e)).toBe(true);
  });
});