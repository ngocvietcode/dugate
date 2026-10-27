// D-103 — Loan Application Context: dựng (T-LAC-01…03; LAC AC-1…AC-4).
import { buildClaimLedger } from '@/lib/loan-dossier/graph/claims';
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { LoanApplicationContextSchema } from '@/lib/loan-dossier/context/schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, ID_B12, loanApp } from './fixtures/dossier';

const D0 = '2026-10-14';
const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const owner = { party_role: 'COLLATERAL_OWNER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 };

function app(loan: Record<string, unknown> = {}, conf = 0.95) {
  const a = loanApp([borrower, owner], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AB123456' } }] });
  a.data!.loan_info = { ...(a.data!.loan_info as object), requested_amount: 600_000_000, bank_proposed_amount: 500_000_000, loan_term_months: 60, interest_rate: 10, ...loan };
  return { ...a, field_confidences: { ...a.field_confidences, loan_info: conf } };
}
const idCard = (p: Record<string, unknown>) => ev('id_card', { parties: [{ ...p, party_role: 'HOLDER' }] });
const currentOwner = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };
const gcn = (cert = 'AB123456') => ev('land_use_certificate', {
  parties: [{ ...owner, party_role: 'OWNER', ownership: currentOwner }],
  assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: cert } }],
});

function lac(evidences: EvidenceEnvelope[], withS3 = true) {
  const s3 = withS3 ? runMapDossier({ evidences, dossier_submitted_at: D0 }).data : null;
  return { lac: buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: withS3 ? 'SUCCESS' : null }), s3 };
}

describe('contract và bất biến', () => {
  const evs = [app(), idCard(borrower), idCard(owner), gcn()];

  it('output đúng schema', () => {
    expect(() => LoanApplicationContextSchema.parse(lac(evs).lac)).not.toThrow();
  });

  it('AC-1: tất định — dựng hai lần cho kết quả giống hệt', () => {
    expect(JSON.stringify(lac(evs).lac)).toBe(JSON.stringify(lac(evs).lac));
  });

  it('AC-2: lossless — tổng nguồn của mọi fact = leaf_count của sổ Claim', () => {
    const { lac: c, s3 } = lac(evs);
    const total = c.facts.reduce((n, f) => n + f.sources.length, 0);
    expect(total).toBe(c.meta.leaf_count);
    expect(c.meta.leaf_count).toBe(buildClaimLedger(evs, s3).leaf_count);
    expect(c.meta.source_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('chủ thể', () => {
  it('người / tài sản dùng nguyên mã của S3; có một chủ thể khoản vay', () => {
    const { lac: c, s3 } = lac([app(), idCard(borrower), gcn()]);
    const ids = c.subjects.map((s) => s.subject_id);
    expect(ids[0]).toBe('loan');
    for (const p of s3!.role_registry) expect(ids).toContain(p.person_id);
    for (const a of s3!.asset_registry) expect(ids).toContain(a.asset_id);
    const borrowerSubject = c.subjects.find((s) => s.roles.includes('borrower'))!;
    expect(borrowerSubject.label).toBe('NGUYỄN VĂN AN');
  });

  it('AC-3a: hai bản chụp cùng một đơn vay → một chủ thể loan, số tiền CORROBORATED', () => {
    const { lac: c } = lac([app(), app(), idCard(borrower)]);
    expect(c.subjects.filter((s) => s.kind === 'loan')).toHaveLength(1);
    const amount = c.facts.filter((f) => f.subject_id === 'loan' && f.field === 'loan_info.bank_proposed_amount');
    expect(amount).toHaveLength(1);
    expect(amount[0].trust).toBe('CORROBORATED');
    expect(amount[0].sources).toHaveLength(2);
  });

  it('AC-3b: hai đơn vay ghi khác số tiền → DISPUTED, nối contradicts, có gap + conflict', () => {
    const { lac: c } = lac([app(), app({ bank_proposed_amount: 700_000_000 }), idCard(borrower)]);
    const amounts = c.facts.filter((f) => f.subject_id === 'loan' && f.field === 'loan_info.bank_proposed_amount');
    expect(amounts).toHaveLength(2);
    for (const f of amounts) expect(f.trust).toBe('DISPUTED');
    expect(amounts[0].contradicts).toContain(amounts[1].fact_id);
    expect(c.gaps).toContainEqual({ code: 'LOAN_APPLICATION_DUPLICATE', subject_id: 'loan', count: 1 });
    expect(c.conflicts.some((x) => x.subject_id === 'loan' && x.field === 'loan_info.bank_proposed_amount' && x.kind === 'DISPUTED')).toBe(true);
  });

  it('dữ kiện chỉ có trên đơn vay → DECLARED; có trên ≥ 2 chứng từ → CORROBORATED', () => {
    const { lac: c } = lac([app(), idCard(borrower)]);
    expect(c.facts.find((f) => f.field === 'loan_info.loan_term_months')?.trust).toBe('DECLARED');
    const idFacts = c.facts.filter((f) => f.field.endsWith('id_number') && f.value === ID_A12);
    expect(idFacts.some((f) => f.trust === 'CORROBORATED')).toBe(true);
  });
});

describe('review theo độ tin cậy đọc (LAC-R06)', () => {
  it('loan_info đọc < 0.80 → fact khoản vay REVIEW; ≥ 0.80 → ACCEPTED', () => {
    const low = lac([app({}, 0.5), idCard(borrower)]).lac.facts.find((f) => f.field === 'loan_info.bank_proposed_amount')!;
    const high = lac([app({}, 0.95), idCard(borrower)]).lac.facts.find((f) => f.field === 'loan_info.bank_proposed_amount')!;
    expect(low.review).toBe('REVIEW');
    expect(high.review).toBe('ACCEPTED');
  });
});

describe('quan hệ, mâu thuẫn, khoảng trống', () => {
  it('chủ TSBĐ hiện tại → quan hệ OWNS có căn cứ dẫn được', () => {
    const { lac: c, s3 } = lac([app(), idCard(borrower), idCard(owner), gcn()]);
    const ownerId = s3!.role_registry.find((p) => p.roles.includes('collateral_owner'))!.person_id;
    const owns = c.relations.find((r) => r.type === 'OWNS' && r.from === ownerId);
    expect(owns).toBeDefined();
    expect(owns!.support_fact_ids.length).toBeGreaterThan(0);
    for (const id of owns!.support_fact_ids) expect(c.facts.find((f) => f.fact_id === id)?.subject_id).toBe(ownerId);
  });

  it('lá không mang thông tin (party_index, party_role, ownership, thành phần địa chỉ) có trong facts nhưng hidden', () => {
    const { lac: c } = lac([app(), idCard(borrower)]);
    const hiddenFacts = c.facts.filter((f) => f.hidden);
    expect(hiddenFacts.length).toBeGreaterThan(0);
    for (const f of hiddenFacts) expect(f.field).toMatch(/index|party_role|party_type|ownership|address\.(street|ward|district|province)/);
  });

  it('AC-4: S3 lỗi → LAC vẫn dựng (loan + doc-*), có gap S3_UNAVAILABLE, không rỗng', () => {
    const { lac: c } = lac([app(), idCard(borrower)], false);
    expect(c.gaps).toContainEqual({ code: 'S3_UNAVAILABLE', subject_id: null, count: 1 });
    expect(c.subjects.some((s) => s.kind === 'loan')).toBe(true);
    expect(c.subjects.some((s) => s.kind === 'document')).toBe(true);
    expect(c.facts.length).toBeGreaterThan(0);
  });

  it('không có đơn vay → gap NO_LOAN_APPLICATION', () => {
    expect(lac([idCard(borrower)]).lac.gaps.map((g) => g.code)).toContain('NO_LOAN_APPLICATION');
  });

  it('evidence ERROR → gap EVIDENCE_READ_ERROR', () => {
    const broken = { ...idCard(owner), status: 'ERROR' as const, data: null, field_confidences: {} };
    expect(lac([app(), idCard(borrower), broken as unknown as EvidenceEnvelope]).lac.gaps).toContainEqual({ code: 'EVIDENCE_READ_ERROR', subject_id: null, count: 1 });
  });
});
