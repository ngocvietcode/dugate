// T-COR-03 — liên kết chủ thể do người thẩm định khai trong S3 (COR-R08; COR-AC07, COR-AC08, COR-AC09).
import type { SubjectLink } from '@/lib/loan-dossier/corrections/schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, loanApp } from './fixtures/dossier';

const link = (correction_id: string, kind: SubjectLink['kind'], subject_kind: SubjectLink['subject_kind'], a: [EvidenceEnvelope, number], b: [EvidenceEnvelope, number]): SubjectLink => ({
  correction_id, kind, subject_kind, a: { evidence_id: a[0].evidence_id, index: a[1] }, b: { evidence_id: b[0].evidence_id, index: b[1] },
  reason: 'người thẩm định xác nhận', corrected_by: 'u1', corrected_at: '2026-10-30T09:00:00Z',
});
function run(evidences: EvidenceEnvelope[], links: SubjectLink[] = []) {
  let report: { applied: unknown[]; skipped: Array<{ correction_id: string; code: string }> } = { applied: [], skipped: [] };
  const r = runMapDossier({ evidences, dossier_submitted_at: '2026-10-14', links, onLinkReport: (x) => { report = x; } });
  return { data: r.data!, report };
}
const personsWith = (data: ReturnType<typeof run>['data'], evidenceId: string) =>
  data.role_registry.filter((p) => (p.mapped_evidences as Array<{ evidence_id: string }>).some((m) => m.evidence_id === evidenceId)).map((p) => p.person_id);

describe('liên kết người', () => {
  const app = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN HÙNG', date_of_birth: '1990-05-01' }]);
  const father = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN HÙNG', date_of_birth: '1965-01-01' }] });

  it('không có liên kết → như trước (trùng tên thì gộp)', () => {
    const { data } = run([app, father]);
    expect(personsWith(data, father.evidence_id)).toEqual(personsWith(data, app.evidence_id));
  });

  it('COR-AC08: DIFFERENT cha / con trùng tên → CCCD không gộp vào khách vay', () => {
    const { data, report } = run([app, father], [link('d1', 'DIFFERENT_SUBJECT', 'person', [app, 0], [father, 0])]);
    expect(personsWith(data, father.evidence_id)).toEqual([]);
    expect(data.unmapped_evidences.some((u) => (u as { evidence_id?: string }).evidence_id === father.evidence_id)).toBe(true);
    expect(report.applied).toEqual([{ correction_id: 'd1', kind: 'DIFFERENT_SUBJECT' }]);
  });

  it('COR-AC08: DIFFERENT trên hai party cùng số định danh → LINK_CONTRADICTS_ID, vẫn gộp theo số', () => {
    const a = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]);
    const card = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] });
    const { data, report } = run([a, card], [link('d1', 'DIFFERENT_SUBJECT', 'person', [a, 0], [card, 0])]);
    expect(personsWith(data, card.evidence_id)).toEqual(personsWith(data, a.evidence_id));
    expect(report.skipped).toEqual([{ correction_id: 'd1', kind: 'DIFFERENT_SUBJECT', code: 'LINK_CONTRADICTS_ID' }]);
  });

  it('SAME kéo party khác tên, khác số vào khách vay (matched_by HUMAN_LINK), cờ soát số giữ nguyên', () => {
    const a = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]);
    const card = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYEN VAN ANH', id_number: `${ID_A12.slice(0, -2)}99` }] });
    expect(personsWith(run([a, card]).data, card.evidence_id)).toEqual([]);
    const { data, report } = run([a, card], [link('s1', 'SAME_SUBJECT', 'person', [a, 0], [card, 0])]);
    const borrower = data.role_registry.find((p) => p.roles.includes('borrower'))!;
    expect((borrower.mapped_evidences as Array<{ evidence_id: string; matched_by: string }>).find((m) => m.evidence_id === card.evidence_id)?.matched_by).toBe('HUMAN_LINK');
    expect(borrower.id_number_check.requires_review).toBe(true);
    expect(report.applied).toEqual([{ correction_id: 's1', kind: 'SAME_SUBJECT' }]);
  });

  it('COR-AC09: A=B, B=C, A≠C → cả ba LINK_CYCLE, kết quả như không có liên kết', () => {
    const c1 = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'TRẦN VĂN B' }] });
    const c2 = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'LÊ VĂN C' }] });
    const evs = [app, c1, c2];
    const { data, report } = run(evs, [
      link('s1', 'SAME_SUBJECT', 'person', [app, 0], [c1, 0]),
      link('s2', 'SAME_SUBJECT', 'person', [c1, 0], [c2, 0]),
      link('d1', 'DIFFERENT_SUBJECT', 'person', [app, 0], [c2, 0]),
    ]);
    expect(report.skipped.map((s) => [s.correction_id, s.code]).sort()).toEqual([['d1', 'LINK_CYCLE'], ['s1', 'LINK_CYCLE'], ['s2', 'LINK_CYCLE']]);
    expect(data.role_registry).toEqual(run(evs).data.role_registry);
  });

  it('LINK_ORPHAN cho party không có; LINK_UNSUPPORTED cho hai party cùng đơn vay', () => {
    const two = loanApp([{ party_role: 'BORROWER', full_name: 'A' }, { party_role: 'CO_BORROWER', full_name: 'B' }]);
    const { report } = run([two, father], [
      link('o1', 'SAME_SUBJECT', 'person', [two, 0], [father, 7]),
      link('u1', 'SAME_SUBJECT', 'person', [two, 0], [two, 1]),
    ]);
    expect(report.skipped.map((s) => [s.correction_id, s.code])).toEqual([['o1', 'LINK_ORPHAN'], ['u1', 'LINK_UNSUPPORTED']]);
  });
});

describe('liên kết tài sản', () => {
  const owner = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
  // Không có thửa / tờ: khóa tài sản chỉ còn số GCN (thửa + tờ trùng nhau là khóa chính xác).
  const gcn = (cert: string) => ev('land_use_certificate', {
    parties: [{ ...owner, party_role: 'OWNER' }],
    assets: [{ asset_type: 'real_estate', usage_context_hint: null, identifiers: { certificate_number: cert } }],
  });

  it('COR-AC07: SAME hai GCN số khác hẳn → một tài sản, member vào bằng HUMAN', () => {
    const a = gcn('AB 000123');
    const b = gcn('CD 777999');
    const app = loanApp([owner]);
    expect(run([app, a, b]).data.asset_registry).toHaveLength(2);
    const { data, report } = run([app, a, b], [link('s1', 'SAME_SUBJECT', 'asset', [a, 0], [b, 0])]);
    expect(data.asset_registry).toHaveLength(1);
    expect((data.asset_registry[0].sources as Array<{ link: string }>).map((s) => s.link)).toContain('HUMAN');
    expect(report.applied).toEqual([{ correction_id: 's1', kind: 'SAME_SUBJECT' }]);
  });

  it('DIFFERENT chặn nối gần đúng (số lệch 1 ký tự) nhưng không thắng khóa chính xác', () => {
    const app = loanApp([owner]);
    const a = gcn('AB 000123');
    const near = gcn('AB 000128');
    expect(run([app, a, near]).data.asset_registry).toHaveLength(1);
    const split = run([app, a, near], [link('d1', 'DIFFERENT_SUBJECT', 'asset', [a, 0], [near, 0])]);
    expect(split.data.asset_registry).toHaveLength(2);
    expect(split.report.applied).toEqual([{ correction_id: 'd1', kind: 'DIFFERENT_SUBJECT' }]);

    const same = gcn('AB 000123');
    const keyed = run([app, a, same], [link('d2', 'DIFFERENT_SUBJECT', 'asset', [a, 0], [same, 0])]);
    expect(keyed.data.asset_registry).toHaveLength(1);
    expect(keyed.report.skipped).toEqual([{ correction_id: 'd2', kind: 'DIFFERENT_SUBJECT', code: 'LINK_CONTRADICTS_ID' }]);
  });
});
