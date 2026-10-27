// Dạng gọn của DossierGraph cho prompt LLM (graph/render.ts) và việc nối vào {{master_data}} của rule LLM.
import { buildDossierGraph, renderDossierGraph } from '@/lib/loan-dossier/graph';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import { DEFAULT_CHECK_SET } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { buildPromptCheckVars } from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';
import type { EvidenceRegistry, FinancialMetrics } from '@/lib/pipelines/workflows/loan-appraisal/types';

import { ev, ID_A12, ID_A9, ID_B12, ID_C12, loanApp } from '../loan-dossier/fixtures/dossier';

const ID_D12 = '001090000004';
const own = (current: boolean) => ({ asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: current });
const now = () => new Date('2026-10-14T03:00:00.000Z');

function dossier(): EvidenceEnvelope[] {
  return [
    loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A9, date_of_birth: '1985-02-02' },
      { party_role: 'CO_BORROWER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
      { party_role: 'SPOUSE', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
      { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_C12 },
      { party_role: 'COLLATERAL_OWNER', full_name: 'PHẠM VĂN DŨNG', id_number: ID_D12 },
    ], {
      id: 'ev-aaaaaaaaaa01', relations: { 3: { raw: 'Mẹ' }, 4: { raw: 'Bạn bè' } },
      assets: [
        { asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { land_parcel_number: '12', map_sheet_number: '5' } },
        { asset_type: 'vehicle', usage_context_hint: 'collateral', identifiers: { license_plate: '51K-123.45' } },
      ],
      data: { business_info: { business_name: 'HKD AN', business_line: 'Bán gạo' } },
    }),
    ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, previous_id_numbers: [ID_A9], date_of_birth: '1985-02-02' }] }),
    ev('vneid', { id: 'ev-aaaaaaaaaa09', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] }),
    ev('land_use_certificate', { id: 'ev-aaaaaaaaaa04', assets: [{ asset_type: 'real_estate', identifiers: { land_parcel_number: '12', map_sheet_number: '5', certificate_number: 'CS01' } }], parties: [{ party_role: 'OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_C12, ownership: own(true) }] }),
    ev('vehicle_registration', { id: 'ev-aaaaaaaaaa05', assets: [{ asset_type: 'vehicle', identifiers: { license_plate: '51K12345', chassis_number: 'RLNAB1234567' } }], parties: [{ party_role: 'OWNER', full_name: 'PHẠM VĂN DŨNG', id_number: ID_D12, ownership: own(true) }] }),
    ev('birth_certificate', { id: 'ev-aaaaaaaaaa06', parties: [{ party_role: 'CHILD', full_name: 'NGUYỄN VĂN AN' }, { party_index: 1, party_role: 'FATHER', full_name: 'NGUYỄN VĂN BỐ' }, { party_index: 2, party_role: 'MOTHER', full_name: 'LÊ THỊ CÚC' }] }),
    ev('cic', { parties: [{ full_name: 'NGƯỜI LẠ', id_number: '001099999999' }] }),
  ];
}

const graphOf = (evs = dossier()) => buildDossierGraph(runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-14', now }).data!);
const ALL = null;

describe('renderDossierGraph', () => {
  it('mỗi người một dòng định danh; tên và số ĐD của một người chỉ xuất hiện một lần', () => {
    const text = renderDossierGraph(graphOf(), ALL);
    expect(text.split('NGUYỄN VĂN AN').length - 1).toBe(1);
    expect(text.split(ID_A12).length - 1).toBe(1);
    expect(text).toMatch(/person-1 borrower · NGUYỄN VĂN AN/);
    expect(text).toContain(`số cũ ${ID_A9}`);
  });

  it('không đưa evidence_id nội bộ; nguồn gọi bằng loại chứng từ và gộp lặp', () => {
    const text = renderDossierGraph(graphOf(), ALL);
    expect(text).not.toMatch(/ev-[0-9a-f]{12}/);
    expect(text).toContain('nguồn: loan_application');
    expect(text).toMatch(/id_card\[ID_NUMBER\]/);
  });

  it('làm rõ liên hệ: vợ/chồng, chủ TSBĐ ↔ khách vay, chủ tài sản bằng id', () => {
    const text = renderDossierGraph(graphOf(), ALL);
    expect(text).toContain('person-1 ⇄ person-2: vợ/chồng');
    expect(text).toMatch(/person-1 → person-3: PARENT_CHILD \(khai: "Mẹ"\), giấy khai sinh xác minh 1\/1/);
    expect(text).toMatch(/person-1 → person-4: OTHER \(khai: "Bạn bè"\)/);
    expect(text).toMatch(/asset-1 real_estate[^\n]*\n\s+chủ hiện tại person-3/);
    expect(text).toMatch(/asset-2 vehicle[^\n]*\n\s+chủ hiện tại person-4/);
  });

  it('báo party chưa gắn được người và bản bị thay thế ở mục LƯU Ý', () => {
    const text = renderDossierGraph(graphOf(), ALL);
    expect(text).toMatch(/LƯU Ý\n[\s\S]*chưa gắn được người: cic — NGƯỜI LẠ/);
  });

  it('chỉ in nhóm rule khai báo: collateral không in định danh/thương mại, income chỉ in kinh doanh', () => {
    const g = graphOf();
    const collateral = renderDossierGraph(g, new Set(['collateral']));
    expect(collateral).toContain('TÀI SẢN');
    expect(collateral).not.toContain('QUAN HỆ');
    expect(collateral).not.toContain('KINH DOANH');
    expect(collateral).not.toContain(ID_A12);
    const income = renderDossierGraph(g, new Set(['income']));
    expect(income).toContain('KINH DOANH');
    expect(income).toContain('business_name=HKD AN');
    // khách vay và đồng vay cùng business → một dòng, không lặp nội dung
    expect(income.split('business_name=HKD AN').length - 1).toBe(1);
    expect(income).toMatch(/person-1, person-2: business_name=HKD AN/);
    expect(income).not.toContain('TÀI SẢN');
    expect(income).not.toContain(ID_A12);
  });

  it('ngắn hơn JSON Customer 360 cũ cho cùng thông tin', () => {
    const data = runMapDossier({ evidences: dossier(), dossier_submitted_at: '2026-10-14', now }).data!;
    const compact = renderDossierGraph(buildDossierGraph(data), ALL);
    expect(compact.length).toBeLessThan(JSON.stringify(data).length);
  });

  it('thuần và tất định; không log tên / số định danh', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const a = renderDossierGraph(graphOf(), ALL);
    const b = renderDossierGraph(graphOf(), ALL);
    expect(a).toBe(b);
    const out = spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n');
    for (const pii of ['NGUYỄN VĂN AN', ID_A12]) expect(out).not.toContain(pii);
    spies.forEach((s) => s.mockRestore());
  });

  it('không có người và tài sản → thông báo rõ, không ném lỗi', () => {
    const empty = buildDossierGraph(runMapDossier({ evidences: [], dossier_submitted_at: '2026-10-14', now }).data!);
    expect(renderDossierGraph(empty, ALL)).toMatch(/chưa gom được/);
    expect(renderDossierGraph(graphOf(), new Set())).toMatch(/không có nhóm dữ liệu/);
  });
});

describe('buildPromptCheckVars + dossierGraph', () => {
  const registry: EvidenceRegistry = { records: [], by_file: [], by_document_type: [] };
  const financial = {} as FinancialMetrics;
  const prompt = (extra: Record<string, unknown>) => String(buildPromptCheckVars({ checkSet: DEFAULT_CHECK_SET, evidence: registry, customer360: {}, financial, ...extra } as never)._prompt);

  it('có graph → khối untrusted_master_data là dạng gọn, không phải JSON', () => {
    const p = prompt({ dossierGraph: graphOf() });
    const block = p.match(/<untrusted_master_data>\n([\s\S]*?)\n<\/untrusted_master_data>/)![1];
    expect(block).toContain('NGƯỜI');
    expect(block).toContain('person-1 borrower');
    expect(block.trim().startsWith('{')).toBe(false);
  });

  it('không có graph → giữ hành vi cũ (JSON Customer 360 rỗng)', () => {
    const p = prompt({ dossierGraph: null, customer360: {} });
    expect(p).toContain('<untrusted_master_data>\n{}\n</untrusted_master_data>');
  });

  it('nhãn khối nói rõ dữ liệu do hệ thống gom, chưa xác minh', () => {
    expect(prompt({ dossierGraph: graphOf() })).toContain('NGƯỜI & TÀI SẢN DO HỆ THỐNG GOM TỪ OCR');
  });
});
