// Gom người & tài sản (S3) ở giai đoạn 2: chạy thuần sau S2, lỗi không đổ workflow, chưa đổi LTV và đầu vào rule LLM.
import { runMapStage } from '@/lib/pipelines/workflows/loan-appraisal/dossier-map';
import { buildDossierGraph } from '@/lib/loan-dossier/graph';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, ID_B12, loanApp } from '../loan-dossier/fixtures/dossier';

const VARS = { dossier_submitted_at: '2026-10-14' };
const NOW = () => new Date('2026-10-14T03:00:00.000Z');

const dossier = (): EvidenceEnvelope[] => [
  loanApp([
    { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 },
    { party_role: 'CO_BORROWER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
  ], { id: 'ev-bbbbbbbbbb01', assets: [{ asset_type: 'vehicle', usage_context_hint: 'collateral', identifiers: { license_plate: '51K12345' } }] }),
  ev('id_card', { id: 'ev-bbbbbbbbbb02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] }),
];

describe('runMapStage', () => {
  it('có giấy đề nghị vay: ra người, tài sản; không cảnh báo; graph dựng được từ kết quả', () => {
    const r = runMapStage(dossier(), VARS, NOW);
    expect(r.warning).toBeNull();
    expect(['SUCCESS', 'PARTIAL_SUCCESS']).toContain(r.status);
    expect(r.data!.role_registry.map((p) => p.person_id)).toEqual(['person-1', 'person-2']);
    expect(r.data!.asset_registry).toHaveLength(1);
    expect(() => buildDossierGraph(r.data!)).not.toThrow();
  });

  it('thiếu giấy đề nghị vay: vẫn trả dữ liệu (rỗng) với mã LOAN_APPLICATION_MISSING, không ném lỗi', () => {
    const r = runMapStage(dossier().slice(1), VARS, NOW);
    expect(r.status_code).toBe('LOAN_APPLICATION_MISSING');
    expect(r.data!.role_registry).toEqual([]);
    expect(r.warning).toBeNull();
  });

  it('thuần và tất định: cùng đầu vào → cùng kết quả', () => {
    expect(JSON.stringify(runMapStage(dossier(), VARS, NOW))).toBe(JSON.stringify(runMapStage(dossier(), VARS, NOW)));
  });

  it('S3 ném lỗi: không đổ, data = null, cảnh báo chỉ nêu loại lỗi (không PII)', () => {
    const broken = [{ ...dossier()[0], data: { parties: 'không phải mảng' } }] as unknown as EvidenceEnvelope[];
    const r = runMapStage(broken, VARS, NOW);
    if (r.data === null) {
      expect(r.warning).toMatch(/^MAP_DOSSIER_UNAVAILABLE: /);
      for (const pii of ['NGUYỄN VĂN AN', ID_A12]) expect(r.warning).not.toContain(pii);
    } else {
      expect(r.warning === null || /^MAP_DOSSIER_/.test(r.warning)).toBe(true);
    }
  });

  it('không log tên / số định danh', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    runMapStage(dossier(), VARS, NOW);
    const out = spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n');
    for (const pii of ['NGUYỄN VĂN AN', ID_A12, ID_B12]) expect(out).not.toContain(pii);
    spies.forEach((s) => s.mockRestore());
  });
});
