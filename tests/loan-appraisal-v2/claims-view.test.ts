// Hiển thị Claim đáng chú ý trong Customer 360: logic nhóm + render thật.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildClaimsSummary, CLAIM_STATUS_LABELS } from '@/app/loan-appraisal-v2/lib/claims-view';
import { ClaimsPanel } from '@/components/loan-appraisal-v2/appraisal/ClaimsPanel';
import { Customer360Panel } from '@/components/loan-appraisal-v2/appraisal/Customer360Panel';
import { buildClaimLedger } from '@/lib/loan-dossier/graph/claims';
import { selectNotableClaims, type StoredClaims } from '@/lib/loan-dossier/graph/claims-store';
import { buildDossierGraph, toDossierGraphView } from '@/lib/loan-dossier/graph';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';

import { ev, ID_A12, ID_B12, loanApp } from '../loan-dossier/fixtures/dossier';

const now = () => new Date('2026-10-14T03:00:00.000Z');
const own = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };
const label = (k: string) => `L(${k})`;
const long = 'AA08798136';

function dossier(over: { wrongCert?: string; dob?: string; vneidName?: string } = {}): EvidenceEnvelope[] {
  return [
    loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1985-02-02' }, { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_B12 }], {
      id: 'ev-aaaaaaaaaa01',
      assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: long, land_parcel_number: '12', map_sheet_number: '5' } }],
      data: { loan_info: { requested_amount: 600000000, loan_term_months: 18 } },
    }),
    ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: over.dob ?? '1985-02-02' }] }),
    ev('vneid', { id: 'ev-aaaaaaaaaa03', parties: [{ party_role: 'HOLDER', full_name: over.vneidName ?? 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1985-02-02' }] }),
    ev('land_use_certificate', {
      id: 'ev-aaaaaaaaaa04', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: long, land_parcel_number: '12', map_sheet_number: '5' } }],
      parties: [{ party_role: 'OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_B12, ownership: own }], data: { asset_details: [{ asset_index: 0, land_area_m2: 120 }] },
    }),
    ev('external_valuation_certificate', {
      id: 'ev-aaaaaaaaaa05', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: over.wrongCert ?? long, land_parcel_number: '12', map_sheet_number: '5' } }], parties: [],
      data: { asset_details: [{ asset_index: 0, valuation_value: 1500000000 }] },
    }),
  ];
}

const build = (over: Parameters<typeof dossier>[0] = {}) => {
  const evs = dossier(over);
  const map = runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-14', now }).data!;
  const stored = selectNotableClaims(buildClaimLedger(evs, map));
  return { evs, map, stored, summary: buildClaimsSummary(stored, map, label)! };
};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const panelHtml = (over: Parameters<typeof dossier>[0] = {}, withClaims = true) => {
  const { evs, map, stored } = build(over);
  const result = { customer_360: map, dossier_graph: toDossierGraphView(buildDossierGraph(map)), ...(withClaims ? { claims: stored } : {}) } as never;
  return renderToStaticMarkup(createElement(Customer360Panel, { result, evidences: evs as never }));
};

describe('buildClaimsSummary', () => {
  it('không có claims (kết quả cũ / S3 lỗi) → null, UI không hiện khối rỗng', () => {
    expect(buildClaimsSummary(null, null, label)).toBeNull();
    expect(buildClaimsSummary(undefined, null, label)).toBeNull();
  });

  it('hồ sơ bình thường: không có cảnh báo; thông tin định danh được nhiều chứng từ khớp hiện là "được xác nhận"', () => {
    const { summary } = build();
    expect(summary.counts).toMatchObject({ disputed: 0, ocrError: 0 });
    expect(summary.counts.corroborated).toBeGreaterThan(0);
    const idGroup = summary.groups.find((g) => g.fieldLabel === 'Số định danh' && g.subjectId === 'person-1')!;
    expect(idGroup.tone).toBe('success');
    expect(idGroup.summary).toMatch(/\d+ chứng từ khớp nhau/);
    expect(summary.bySubject.get('person-1')!.warnings).toEqual([]);
    expect(summary.bySubject.get('person-1')!.confirmed.join(' ')).toContain('Số định danh');
  });

  it('ngày sinh lệch: một nhóm "không khớp" nêu cả hai giá trị, mỗi giá trị kèm nguồn riêng; cảnh báo gắn đúng người', () => {
    const { summary } = build({ dob: '1990-09-09' });
    const g = summary.groups.find((x) => x.tone === 'danger')!;
    expect(g.subjectId).toBe('person-1');
    expect(g.subjectName).toBe('NGUYỄN VĂN AN');
    expect(g.fieldLabel).toBe('Ngày sinh');
    expect(g.claims.map((c) => c.value).sort()).toEqual(['1985-02-02', '1990-09-09']);
    expect(g.summary).toBe('Ngày sinh: 1985-02-02 ≠ 1990-09-09');
    const odd = g.claims.find((c) => c.value === '1990-09-09')!;
    expect(odd.sources.map((s) => s.doc)).toEqual(['L(id_card)']);
    expect(summary.bySubject.get('person-1')!.warnings).toEqual(['Ngày sinh không khớp giữa các chứng từ']);
  });

  it('mâu thuẫn xếp trước đồng thuận', () => {
    const { summary } = build({ dob: '1990-09-09' });
    const tones = summary.groups.map((g) => g.tone);
    expect(tones.indexOf('danger')).toBeLessThan(tones.indexOf('success'));
  });

  it('số GCN lệch 1 ký tự (mã dài): "nghi lỗi đọc chữ", gắn đúng tài sản, kèm nguồn riêng', () => {
    const { summary, map } = build({ wrongCert: 'AA08798I36' });
    const g = summary.groups.find((x) => x.tone === 'warning')!;
    expect(g.subjectId).toBe(map.asset_registry[0].asset_id);
    expect(g.fieldLabel).toContain('Số GCN');
    expect(g.subjectName).toContain('Bất động sản');
    const bad = g.claims.find((c) => c.value === 'AA08798I36')!;
    expect(bad.statusLabel).toBe(CLAIM_STATUS_LABELS.PROBABLE_OCR_ERROR);
    expect(bad.sources[0].doc).toBe('L(external_valuation_certificate)');
    expect(summary.counts.ocrError).toBe(1);
    expect(summary.bySubject.get(map.asset_registry[0].asset_id)!.warnings.length).toBe(1);
  });

  it('tên chỉ khác dấu: ghi nhận "khác cách viết", KHÔNG phải cảnh báo', () => {
    const { summary } = build({ vneidName: 'NGUYEN VAN AN' });
    const g = summary.groups.find((x) => x.tone === 'info')!;
    expect(g.fieldLabel).toBe('Họ và tên');
    expect(summary.counts).toMatchObject({ disputed: 0, ocrError: 0, variants: 1 });
    expect(summary.bySubject.get('person-1')!.warnings).toEqual([]);
    expect(summary.bySubject.get('person-1')!.variants[0]).toContain('cách viết');
  });

  it('độ tin cậy là phần trăm ĐỌC CHỮ làm tròn; nguồn có nguyên văn khi khác giá trị hiển thị', () => {
    const { summary } = build({ vneidName: 'NGUYEN VAN AN' });
    const claims = summary.groups.find((x) => x.tone === 'info')!.claims;
    for (const s of claims.flatMap((c) => c.sources)) expect(s.readPercent === null || (s.readPercent >= 0 && s.readPercent <= 100)).toBe(true);
    expect(claims.map((c) => c.value).sort()).toEqual(['NGUYEN VAN AN', 'NGUYỄN VĂN AN']);
  });

  it('claim chưa gắn chủ thể được đếm theo lý do bằng tiếng Việt, không biến mất', () => {
    const evs = dossier().slice(1);
    const stored = selectNotableClaims(buildClaimLedger(evs, runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-14', now }).data!));
    const s = buildClaimsSummary(stored, null, label)!;
    expect(s.counts.unresolved).toBeGreaterThan(0);
    expect(s.unresolved.every((u) => u.label.length > 10 && !/^[A-Z_]+$/.test(u.label))).toBe(true);
  });

  it('bất biến lossless được truyền ra: số mục hiển thị + số mục bỏ qua = tổng', () => {
    const { summary, stored } = build();
    expect(summary.coverage.shownLeaves + summary.coverage.omittedLeaves).toBe(summary.coverage.leafCount);
    expect(summary.coverage.leafCount).toBe(stored.leaf_count);
  });

  it('thuần và tất định', () => {
    expect(JSON.stringify(build({ dob: '1990-09-09' }).summary.groups)).toBe(JSON.stringify(build({ dob: '1990-09-09' }).summary.groups));
  });
});

describe('Customer360Panel + ClaimsPanel (render)', () => {
  it('có mâu thuẫn: khối "Đối chiếu giữa các chứng từ" hiện, nêu cả hai giá trị và nguồn; cảnh báo hiện ngay trên thẻ người', () => {
    const t = text(panelHtml({ dob: '1990-09-09' }));
    expect(t).toContain('Đối chiếu giữa các chứng từ');
    expect(t).toContain('Không khớp, cần rà soát');
    expect(t).toContain('1985-02-02');
    expect(t).toContain('1990-09-09');
    expect(t).toContain('Căn cước công dân');
    expect(t).toContain('Ngày sinh không khớp giữa các chứng từ');
    // đúng thứ tự: Khoản vay → Đối chiếu → Tài sản → Người
    const order = ['Khoản vay', 'Đối chiếu giữa các chứng từ', 'Tài sản (1)', 'Người (2)'].map((s) => t.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('header gộp số cảnh báo của claim vào "điểm cần chú ý"', () => {
    expect(text(panelHtml({ dob: '1990-09-09' }))).toMatch(/[1-9]\d* điểm cần chú ý/);
    expect(text(panelHtml())).not.toMatch(/điểm cần chú ý/);
  });

  it('hồ sơ bình thường: không có mục cảnh báo, có mục "được nhiều chứng từ xác nhận"', () => {
    const t = text(panelHtml());
    expect(t).not.toContain('Không khớp, cần rà soát');
    expect(t).toContain('Được nhiều chứng từ xác nhận');
    expect(t).toContain('Đã khớp giữa các chứng từ');
  });

  it('KẾT QUẢ CŨ không có claims: panel vẫn hiện đủ, không có khối đối chiếu, không lỗi', () => {
    const t = text(panelHtml({ dob: '1990-09-09' }, false));
    expect(t).not.toContain('Đối chiếu giữa các chứng từ');
    expect(t).toContain('Khoản vay');
    expect(t).toContain('Người (2)');
  });

  it('có claims nhưng rỗng: thông báo trung tính thay vì khối trống', () => {
    const empty: StoredClaims = { version: '1.0', leaf_count: 0, claim_count: 0, omitted_claims: 0, omitted_leaves: 0, claims: [] };
    const html = renderToStaticMarkup(createElement(ClaimsPanel, { summary: buildClaimsSummary(empty, null, label)! }));
    expect(text(html)).toContain('Chưa thấy thông tin nào được nhiều chứng từ cùng khẳng định hoặc mâu thuẫn');
  });

  it('không dùng màu làm tín hiệu duy nhất: mỗi nhóm có nhãn chữ trạng thái', () => {
    const t = text(panelHtml({ dob: '1990-09-09' }));
    expect(t).toContain(CLAIM_STATUS_LABELS.DISPUTED);
  });
});
