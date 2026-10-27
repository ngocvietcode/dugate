// Khối `dossier_graph` (nodes + edges, không PII) và bố cục UI.
import { buildCustomer360 } from '@/app/loan-appraisal-v2/lib/customer360-view';
import { DossierGraphViewSchema, buildDossierGraph, toDossierGraphView } from '@/lib/loan-dossier/graph';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import {
  buildNodeFacts, columnOf, countByKind, edgeLabel, filterGraph, labelFor, layoutColumns, maskId, showsLabelOnCanvas, NODE_H, NODE_W,
} from '@/app/loan-appraisal-v2/lib/graph-view';

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
    }),
    ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, previous_id_numbers: [ID_A9] }] }),
    ev('land_use_certificate', { id: 'ev-aaaaaaaaaa04', assets: [{ asset_type: 'real_estate', identifiers: { land_parcel_number: '12', map_sheet_number: '5', certificate_number: 'CS01' } }], parties: [{ party_role: 'OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_C12, ownership: own(true) }] }),
    ev('vehicle_registration', { id: 'ev-aaaaaaaaaa05', assets: [{ asset_type: 'vehicle', identifiers: { license_plate: '51K12345', chassis_number: 'RLNAB1234567' } }], parties: [{ party_role: 'OWNER', full_name: 'PHẠM VĂN DŨNG', id_number: ID_D12, ownership: own(true) }] }),
    ev('birth_certificate', { id: 'ev-aaaaaaaaaa06', parties: [{ party_role: 'CHILD', full_name: 'NGUYỄN VĂN AN' }, { party_index: 1, party_role: 'FATHER', full_name: 'NGUYỄN VĂN BỐ' }, { party_index: 2, party_role: 'MOTHER', full_name: 'LÊ THỊ CÚC' }] }),
    ev('marital_status_confirmation', { id: 'ev-aaaaaaaaaa07', issue_date: '2026-01-05', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], data: { marital_status: 'SINGLE' } }),
    ev('marital_status_confirmation', { id: 'ev-aaaaaaaaaa08', issue_date: '2026-09-20', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], data: { marital_status: 'MARRIED' } }),
    ev('cic', { id: 'ev-aaaaaaaaaa0a', parties: [{ full_name: 'NGƯỜI LẠ', id_number: '001099999999' }] }),
  ];
}
const viewOf = (evs = dossier()) => toDossierGraphView(buildDossierGraph(runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-14', now }).data!));

describe('toDossierGraphView', () => {
  it('hợp lệ theo hợp đồng; mọi cạnh trỏ vào node có thật', () => {
    const v = viewOf();
    const parsed = DossierGraphViewSchema.safeParse(v);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(v.version).toBe('1.0');
  });

  it('không chứa PII: không tên, số định danh, địa chỉ, số tài sản', () => {
    const json = JSON.stringify(viewOf());
    for (const pii of ['NGUYỄN', 'TRẦN', 'LÊ THỊ', 'PHẠM', 'NGƯỜI LẠ', ID_A12, ID_A9, ID_B12, ID_C12, ID_D12, '51K12345', 'CS01', 'RLNAB1234567']) expect(json).not.toContain(pii);
  });

  it('node: người theo person-n, tài sản theo asset-n, chứng từ chỉ khi có cạnh tới nó', () => {
    const v = viewOf();
    expect(v.nodes.filter((n) => n.kind === 'person').map((n) => n.id)).toEqual(['person-1', 'person-2', 'person-3', 'person-4']);
    expect(v.nodes.filter((n) => n.kind === 'asset').map((n) => n.id)).toEqual(['asset-1', 'asset-2']);
    const evidenceIds = new Set(v.nodes.filter((n) => n.kind === 'evidence').map((n) => n.id));
    for (const id of evidenceIds) expect(v.edges.some((e) => e.source === id || e.target === id)).toBe(true);
    expect(v.nodes.find((n) => n.id === 'person-1')).toMatchObject({ type: 'borrower', roles: ['borrower'] });
  });

  it('làm rõ liên hệ: sở hữu hiện tại, vợ/chồng một cạnh, nhân thân chưa xác minh đủ cảnh báo', () => {
    const v = viewOf();
    expect(v.edges.find((e) => e.id === 'OWNS:person-3>asset-1')).toMatchObject({ type: 'OWNS', label: 'current' });
    expect(v.edges.filter((e) => e.type === 'SPOUSE_OF')).toHaveLength(1);
    const rel = v.edges.filter((e) => e.type === 'RELATIVE_OF');
    expect(rel.map((e) => [e.source, e.target, e.label])).toEqual([['person-1', 'person-3', 'PARENT_CHILD'], ['person-1', 'person-4', 'OTHER']]);
    expect(rel[0].warning).toBeUndefined(); // đủ 1/1 giấy khai sinh
  });

  it('bản bị thay thế và party chưa gắn xuất hiện kèm cờ', () => {
    const v = viewOf();
    expect(v.nodes.find((n) => n.id === 'ev-aaaaaaaaaa07')).toMatchObject({ kind: 'evidence', flags: ['SUPERSEDED'] });
    expect(v.edges.find((e) => e.id === 'SUPERSEDED_BY:ev-aaaaaaaaaa07>ev-aaaaaaaaaa08')).toBeDefined();
    const un = v.nodes.find((n) => n.kind === 'unmapped')!;
    expect(un).toMatchObject({ flags: ['UNMAPPED'] });
    expect(v.edges.find((e) => e.type === 'UNMAPPED_IN')).toMatchObject({ warning: true });
  });

  it('thuần và tất định; không có người/tài sản vẫn hợp lệ', () => {
    expect(JSON.stringify(viewOf())).toBe(JSON.stringify(viewOf()));
    const empty = viewOf([]);
    expect(empty.nodes).toEqual([]);
    expect(DossierGraphViewSchema.safeParse(empty).success).toBe(true);
  });

  it('nhỏ hơn nhiều so với customer_360 đầy đủ', () => {
    const data = runMapDossier({ evidences: dossier(), dossier_submitted_at: '2026-10-14', now }).data!;
    expect(JSON.stringify(viewOf()).length).toBeLessThan(JSON.stringify(data).length);
  });
});

describe('DossierGraphViewSchema', () => {
  it('từ chối cạnh trỏ node không tồn tại và id trùng', () => {
    const bad = { version: '1.0', nodes: [{ id: 'a', kind: 'person', type: 'borrower' }, { id: 'a', kind: 'asset', type: 'vehicle' }], edges: [{ id: 'e', source: 'a', target: 'zzz', type: 'OWNS' }] };
    const r = DossierGraphViewSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
  it('từ chối trường lạ (strict) — không lọt PII qua đường này', () => {
    const r = DossierGraphViewSchema.safeParse({ version: '1.0', nodes: [{ id: 'a', kind: 'person', type: 'borrower', full_name: 'X' }], edges: [] });
    expect(r.success).toBe(false);
  });
});

describe('bố cục theo cột (UI)', () => {
  const full = () => viewOf();
  const rect = (p: { x: number; y: number }) => ({ l: p.x, r: p.x + NODE_W, t: p.y, b: p.y + NODE_H });
  const overlap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

  it('mỗi loại node ở đúng một cột cố định: người | tài sản | chứng từ; chưa gắn được nằm cột người', () => {
    const v = full();
    const l = layoutColumns(v);
    const col = new Map(l.nodes.map((n) => [n.id, n.column]));
    for (const n of v.nodes) expect(col.get(n.id)).toBe(columnOf(n));
    const xOf = (c: string) => new Set(l.nodes.filter((n) => n.column === c).map((n) => n.x));
    for (const c of ['person', 'asset', 'evidence']) expect(xOf(c).size).toBe(1);
    const [p, a, e] = ['person', 'asset', 'evidence'].map((c) => [...xOf(c)][0]);
    expect(p).toBeLessThan(a);
    expect(a).toBeLessThan(e);
    expect(l.nodes.find((n) => n.id === v.nodes.find((x) => x.kind === 'unmapped')!.id)!.column).toBe('person');
  });

  it('không hai thẻ nào chồng nhau, mọi thẻ nằm trong khung', () => {
    const l = layoutColumns(full());
    for (let i = 0; i < l.nodes.length; i++) {
      expect(l.nodes[i].x + NODE_W).toBeLessThanOrEqual(l.width);
      expect(l.nodes[i].y + NODE_H).toBeLessThanOrEqual(l.height);
      for (let j = i + 1; j < l.nodes.length; j++) expect(overlap(rect(l.nodes[i]), rect(l.nodes[j]))).toBe(false);
    }
  });

  it('người xếp theo nhóm vai trò (vay → đồng vay → chủ TSBĐ), nhóm có nhãn; chưa gắn ở cuối', () => {
    const v = full();
    const l = layoutColumns(v);
    const people = l.nodes.filter((n) => n.column === 'person');
    const order = people.map((n) => n.group);
    const rank = (g: string | null) => ['borrower', 'co_borrower', 'collateral_owner', 'other', 'unmapped'].indexOf(g ?? '');
    expect([...order].sort((a, b) => rank(a) - rank(b))).toEqual(order);
    expect(order.at(-1)).toBe('unmapped');
    expect(l.groups.map((g) => g.label)).toEqual(expect.arrayContaining(['Khách hàng vay', 'Đồng vay', 'Chủ TSBĐ', 'Chưa gắn được người']));
    // trong cùng nhóm giữ thứ tự S3
    const owners = people.filter((n) => n.group === 'collateral_owner').map((n) => n.id);
    expect(owners).toEqual(['person-3', 'person-4']);
  });

  it('tắt chứng từ: bố cục chỉ còn 2 cột dồn sát, vị trí cột người / tài sản không đổi (ổn định)', () => {
    const v = full();
    const withEv = layoutColumns(v);
    const without = layoutColumns(filterGraph(v, { evidence: false, unmapped: true }));
    expect(without.columns.map((c) => c.id)).toEqual(['person', 'asset']);
    expect(without.width).toBeLessThan(withEv.width);
    for (const n of without.nodes) {
      const before = withEv.nodes.find((x) => x.id === n.id)!;
      expect([n.x, n.y]).toEqual([before.x, before.y]);
    }
  });

  it('tất định; đồ thị rỗng không lỗi', () => {
    expect(JSON.stringify(layoutColumns(full()))).toBe(JSON.stringify(layoutColumns(full())));
    const e = layoutColumns({ version: '1.0', nodes: [], edges: [] });
    expect(e.nodes).toEqual([]);
    expect(e.height).toBeGreaterThan(0);
  });
});

describe('nhãn / lọc / che số định danh (UI)', () => {
  it('filterGraph bỏ chứng từ / người chưa gắn và các cạnh liên quan, không để cạnh treo', () => {
    const v = viewOf();
    const f = filterGraph(v, { evidence: false, unmapped: false });
    expect(f.nodes.every((n) => n.kind === 'person' || n.kind === 'asset')).toBe(true);
    const ids = new Set(f.nodes.map((n) => n.id));
    expect(f.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(f.edges.some((e) => e.type === 'OWNS')).toBe(true);
    expect(DossierGraphViewSchema.safeParse(f).success).toBe(true);
    expect(countByKind(v).person).toBe(4);
  });

  it('maskId che số định danh, giữ 4 số cuối; số ngắn / rỗng xử lý an toàn', () => {
    expect(maskId('001090000001')).toBe('••••0001');
    expect(maskId('012345671')).toBe('••••5671');
    expect(maskId('1234')).toBe('1234');
    expect(maskId('')).toBeNull();
    expect(maskId(null)).toBeNull();
    expect(maskId('001090000001')).not.toContain('0010900');
  });

  it('thẻ người: tên và số định danh đã che tra từ customer_360 (không từ graph); tài sản có một định danh chính', () => {
    const data = runMapDossier({ evidences: dossier(), dossier_submitted_at: '2026-10-14', now }).data!;
    const facts = buildNodeFacts(data);
    expect(facts.get('person-1')).toEqual({ name: 'NGUYỄN VĂN AN', detail: 'ĐD ••••0001' });
    expect(facts.get('asset-2')!.detail).toMatch(/^(Biển số|Số khung|Số ĐK) /);
    expect(JSON.stringify([...facts.values()])).not.toContain(ID_A12);
    const v = viewOf();
    const card = labelFor(v.nodes.find((n) => n.id === 'person-1')!, facts, new Map());
    expect(card).toMatchObject({ title: 'NGUYỄN VĂN AN', subtitle: 'Khách hàng vay', detail: 'ĐD ••••0001' });
    expect(labelFor(v.nodes.find((n) => n.id === 'person-1')!, new Map(), new Map()).title).toBe('person-1');
    expect(buildNodeFacts(null).size).toBe(0);
  });

  it('nhãn cạnh; chỉ cạnh mang thông tin riêng hoặc cảnh báo mới hiện nhãn trên sơ đồ (tránh chồng chữ)', () => {
    const v = viewOf();
    expect(edgeLabel(v.edges.find((e) => e.type === 'OWNS')!)).toBe('chủ hiện tại');
    expect(edgeLabel(v.edges.find((e) => e.type === 'RELATIVE_OF')!)).toMatch(/^nhân thân: /);
    const mentions = v.edges.filter((e) => e.type === 'MENTIONED_IN' && !e.warning);
    expect(mentions.length).toBeGreaterThan(0);
    for (const e of mentions) expect(showsLabelOnCanvas(e)).toBe(false);
    expect(showsLabelOnCanvas(v.edges.find((e) => e.type === 'OWNS')!)).toBe(true);
    expect(showsLabelOnCanvas(v.edges.find((e) => e.type === 'UNMAPPED_IN')!)).toBe(true);
  });
});
describe('Customer 360 tổng hợp theo người', () => {
  const data = () => runMapDossier({ evidences: dossier(), dossier_submitted_at: '2026-10-14', now }).data!;
  const label = (k: string) => `L(${k})`;
  const summary = (withGraph = true) => buildCustomer360(data(), withGraph ? viewOf() : null, label);

  it('một thẻ cho mỗi người, xếp theo nhóm vai trò rồi thứ tự S3', () => {
    const s = summary();
    expect(s.people.map((p) => p.personId)).toEqual(['person-1', 'person-2', 'person-3', 'person-4']);
    expect(s.people[0]).toMatchObject({ name: 'NGUYỄN VĂN AN', roleLabels: ['Khách hàng vay'], marital: 'Đã kết hôn' });
    expect(s.counts).toMatchObject({ people: 4, assets: 2 });
  });

  it('định danh đầy đủ ở bảng này (khác thẻ sơ đồ): số hiện hành và số cũ', () => {
    const p1 = summary().people[0];
    expect(p1.facts).toEqual(expect.arrayContaining([{ label: 'Số định danh', value: ID_A12 }, { label: 'Số cũ', value: ID_A9 }]));
  });

  it('quan hệ lấy từ cạnh graph: vợ/chồng hai chiều (mỗi người thấy người kia), nhân thân kèm loại', () => {
    const s = summary();
    expect(s.people[0].relations.map((r) => [r.otherId, r.text])).toEqual(expect.arrayContaining([['person-2', 'Vợ/chồng'], ['person-3', 'Nhân thân (cha/mẹ - con)'], ['person-4', 'Nhân thân (khác)']]));
    expect(s.people[1].relations.some((r) => r.kind === 'spouse' && r.otherId === 'person-1')).toBe(true);
    expect(s.people[2].relations.some((r) => r.kind === 'relative' && r.otherId === 'person-1')).toBe(true);
  });

  it('tài sản đứng tên của từng người và chủ sở hữu của từng tài sản khớp nhau', () => {
    const s = summary();
    expect(s.people[2].assets).toMatchObject([{ assetId: 'asset-1', current: true, typeLabel: 'Bất động sản' }]);
    expect(s.people[3].assets).toMatchObject([{ assetId: 'asset-2', current: true, typeLabel: 'Xe' }]);
    expect(s.assets.find((a) => a.assetId === 'asset-1')!.owners).toEqual([{ personId: 'person-3', name: 'LÊ THỊ CÚC', current: true }]);
    expect(s.people[0].assets).toEqual([]);
  });

  it('nguồn chứng từ gộp theo loại kèm số lượng; đếm người chưa gắn và bản bị thay thế', () => {
    const s = summary();
    expect(s.people[0].sources.some((x) => x.startsWith('L(id_card)'))).toBe(true);
    expect(s.unmapped).toBeGreaterThan(0);
    expect(s.superseded).toBe(1);
  });

  it('không có graph vẫn dựng được từ customer_360 (vợ/chồng, tài sản); kết quả cũ không vỡ', () => {
    const s = summary(false);
    expect(s.people).toHaveLength(4);
    expect(s.people[2].assets.map((a) => a.assetId)).toEqual(['asset-1']);
    expect(s.people[0].relations.some((r) => r.kind === 'spouse')).toBe(true);
  });

  it('hồ sơ không có người: danh sách rỗng, không ném lỗi', () => {
    const empty = runMapDossier({ evidences: [], dossier_submitted_at: '2026-10-14', now }).data!;
    expect(buildCustomer360(empty, null, label).people).toEqual([]);
  });

  it('kết quả đã lưu thiếu khối (bản cũ / rút gọn): coi là rỗng, không ném lỗi', () => {
    const partial = { role_registry: [], asset_registry: [], customer_360: [] } as never;
    expect(buildCustomer360(partial, null, label)).toMatchObject({ people: [], assets: [], unmapped: 0, superseded: 0 });
    expect(buildCustomer360({} as never, null, label).people).toEqual([]);
  });

  it('thuần và tất định', () => {
    expect(JSON.stringify(summary())).toBe(JSON.stringify(summary()));
  });
});