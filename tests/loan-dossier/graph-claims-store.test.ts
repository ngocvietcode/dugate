// Lưu Claim đáng chú ý: chỉ phần có ý nghĩa, nhưng bất biến lossless vẫn kiểm được (lá lưu + lá bỏ qua = tổng lá).
import { buildClaimLedger } from '@/lib/loan-dossier/graph/claims';
import { CLAIMS_VERSION, NOTABLE_STATUSES, StoredClaimsSchema, selectNotableClaims } from '@/lib/loan-dossier/graph/claims-store';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';

import { ev, ID_A12, ID_B12, loanApp } from './fixtures/dossier';

const now = () => new Date('2026-10-14T03:00:00.000Z');
const own = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };
const long = 'AA08798136';

function dossier(over: { wrongCert?: string; dob?: string } = {}): EvidenceEnvelope[] {
  return [
    loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1985-02-02' }, { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_B12 }], {
      id: 'ev-aaaaaaaaaa01',
      assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: long, land_parcel_number: '12', map_sheet_number: '5' } }],
      data: { loan_info: { requested_amount: 600000000, loan_term_months: 18 }, business_info: { business_name: 'HKD AN' } },
    }),
    ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: over.dob ?? '1985-02-02' }] }),
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
const ledgerOf = (evs: EvidenceEnvelope[]) => buildClaimLedger(evs, runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-14', now }).data!);
const stored = (evs: EvidenceEnvelope[]) => selectNotableClaims(ledgerOf(evs));

describe('selectNotableClaims', () => {
  it('hợp lệ theo hợp đồng và bất biến lossless: lá lưu + lá bỏ qua = tổng lá; claim lưu + bỏ = tổng claim', () => {
    for (const evs of [dossier(), dossier({ wrongCert: 'AA08798I36' }), dossier({ dob: '1990-09-09' })]) {
      const s = stored(evs);
      const parsed = StoredClaimsSchema.safeParse(s);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
      expect(s.version).toBe(CLAIMS_VERSION);
      expect(s.claims.reduce((n, c) => n + c.sources.length, 0) + s.omitted_leaves).toBe(s.leaf_count);
      expect(s.claims.length + s.omitted_claims).toBe(s.claim_count);
    }
  });

  it('chỉ lưu claim đáng chú ý: không có DECLARED / SINGLE_SOURCE thường; bỏ phần lớn lá', () => {
    const s = stored(dossier());
    expect(s.claims.every((c) => (NOTABLE_STATUSES as readonly string[]).includes(c.status) || c.unresolved)).toBe(true);
    expect(s.omitted_claims).toBeGreaterThan(s.claims.length);
    expect(s.claims.some((c) => c.status === 'CORROBORATED')).toBe(true);
  });

  it('cặp mâu thuẫn không bị cắt lìa: lưu một thì lưu cả claim đối lập, mọi contradicts trỏ vào claim đã lưu', () => {
    const s = stored(dossier({ dob: '1990-09-09' }));
    const disputed = s.claims.filter((c) => c.status === 'DISPUTED');
    expect(disputed.length).toBe(2);
    const ids = new Set(s.claims.map((c) => c.claim_id));
    for (const c of s.claims) for (const o of c.contradicts) expect(ids.has(o)).toBe(true);
    expect(disputed.map((c) => c.value).sort()).toEqual(['1985-02-02', '1990-09-09']);
  });

  it('bất biến: mọi claim có contradicts đều thuộc trạng thái đáng chú ý (nên cặp mâu thuẫn luôn được lưu cùng nhau)', () => {
    for (const evs of [dossier({ dob: '1990-09-09' }), dossier({ wrongCert: 'AA08798I36' }), dossier({ wrongCert: 'ZZ99' })]) {
      const l = ledgerOf(evs);
      for (const c of l.claims.filter((x) => x.contradicts.length > 0)) expect((NOTABLE_STATUSES as readonly string[]).includes(c.status)).toBe(true);
      // và đối tác của mỗi claim đáng chú ý đã nằm trong bản lưu
      const s = selectNotableClaims(l);
      const ids = new Set(s.claims.map((c) => c.claim_id));
      for (const c of s.claims) for (const o of c.contradicts) expect(ids.has(o)).toBe(true);
    }
  });
  it('Claim MANG GIÁ TRỊ và nguồn của từng bên (đúng quyết định: gửi UI / lưu DB)', () => {
    const s = stored(dossier({ wrongCert: 'AA08798I36' }));
    const cs = s.claims.filter((c) => c.field === 'assets[].identifiers.certificate_number');
    expect(cs.map((c) => c.value).sort()).toEqual(['AA08798136', 'AA08798I36']);
    const odd = cs.find((c) => c.value === 'AA08798I36')!;
    expect(odd.status).toBe('PROBABLE_OCR_ERROR');
    expect(odd.sources).toHaveLength(1);
    expect(odd.sources[0]).toMatchObject({ doc_type_key: 'external_valuation_certificate', record_id: expect.stringContaining('ev-aaaaaaaaaa05#') });
    expect(cs.find((c) => c.value === long)!.sources.map((x) => x.doc_type_key).sort()).toEqual(['land_use_certificate', 'loan_application']);
  });

  it('nguồn chỉ có raw khi khác value (không lặp giá trị); read_confidence là cấp khóa 1', () => {
    const s = stored(dossier());
    for (const c of s.claims) for (const src of c.sources) {
      if ('raw' in src) expect(src.raw).not.toBe(c.value);
      expect(src.read_confidence === null || (src.read_confidence >= 0 && src.read_confidence <= 1)).toBe(true);
    }
  });

  it('claim chưa gắn được chủ thể luôn được lưu (không để mất liên kết âm thầm)', () => {
    const evs = dossier().slice(1); // bỏ đơn vay ⇒ S3 không có người
    const s = stored(evs);
    const un = s.claims.filter((c) => c.unresolved);
    expect(un.length).toBeGreaterThan(0);
    expect(un.every((c) => c.subject.kind === 'document')).toBe(true);
  });

  it('nhỏ hơn nhiều so với sổ đầy đủ', () => {
    const evs = dossier();
    expect(JSON.stringify(stored(evs)).length).toBeLessThan(JSON.stringify(ledgerOf(evs).claims).length / 2);
  });

  it('thuần và tất định; hồ sơ rỗng vẫn hợp lệ', () => {
    expect(JSON.stringify(stored(dossier()))).toBe(JSON.stringify(stored(dossier())));
    const empty = selectNotableClaims({ claims: [], leaf_count: 0, unresolved_count: 0 });
    expect(StoredClaimsSchema.safeParse(empty).success).toBe(true);
  });
});

describe('StoredClaimsSchema', () => {
  const base = () => stored(dossier({ dob: '1990-09-09' }));
  it('từ chối khi lossless bị vi phạm (đếm lá lệch)', () => {
    expect(StoredClaimsSchema.safeParse({ ...base(), omitted_leaves: base().omitted_leaves + 1 }).success).toBe(false);
  });
  it('từ chối contradicts trỏ ra ngoài và claim_id trùng', () => {
    const s = base();
    const bad = { ...s, claims: s.claims.map((c, i) => (i === 0 ? { ...c, contradicts: ['claim-99999'] } : c)) };
    expect(StoredClaimsSchema.safeParse(bad).success).toBe(false);
    expect(StoredClaimsSchema.safeParse({ ...s, claims: [s.claims[0], s.claims[0]] }).success).toBe(false);
  });
  it('strict: trường lạ bị từ chối', () => {
    expect(StoredClaimsSchema.safeParse({ ...base(), extra: 1 }).success).toBe(false);
  });
});
