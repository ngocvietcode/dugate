// Bất biến LOSSLESS của sổ Claim: mọi lá OCR của MỌI loại chứng từ phải có đúng một chỗ trong sổ. Không lá nào rơi, không lá nào nhân đôi.
// Đây là lưới an toàn: field mới xuất hiện trong schema S2 sẽ tự được phủ (quy tắc theo cấu trúc, không liệt kê tay từng loại).
import { buildClaimLedger, genericField, sourceCount, type Claim } from '@/lib/loan-dossier/graph/claims';
import { loadDocTypes } from '@/lib/loan-dossier/catalog';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import { NEAR_MATCH_MIN_LENGTH } from '@/lib/loan-dossier/s5/compare-exact';

import { makeEvidence, makeLightData, makeRichData } from './fixtures/build';
import { ev, ID_A12, ID_B12, loanApp } from './fixtures/dossier';

const now = () => new Date('2026-10-14T03:00:00.000Z');

/** Đếm lá theo đúng định nghĩa của sổ: scalar khác null/undefined, có đường dẫn. */
function countLeaves(value: unknown, path = ''): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v, i) => n + countLeaves(v, `${path}[${i}]`), 0);
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).reduce<number>((n, [k, v]) => n + countLeaves(v, path ? `${path}.${k}` : k), 0);
  return value !== null && value !== undefined && path && ['string', 'number', 'boolean'].includes(typeof value) ? 1 : 0;
}

const allDocTypes = (): Array<{ key: string; level: string }> => loadDocTypes().map((d) => ({ key: d.doc_type_key, level: d.extraction_level }));

const evidenceOf = (key: string, level: string): EvidenceEnvelope => {
  const data = level === 'FULL' ? makeRichData(key) : makeLightData(key);
  // Mọi field cấp 1 có độ tin cậy để kiểm tra read_confidence được gán đúng.
  return makeEvidence(key, { evidence_id: 'ev-0000000000aa', data: data as never, field_confidences: Object.fromEntries(Object.keys(data).map((k) => [k, 0.9])) });
};

describe('sổ Claim — lossless trên mọi loại chứng từ', () => {
  const docs = allDocTypes();

  it('phủ đủ danh mục chứng từ (47 loại: 30 FULL + 17 LIGHT); thêm loại mới sẽ tự được kiểm', () => {
    expect(docs).toHaveLength(47);
    expect(docs.filter((d) => d.level === 'FULL').length).toBe(30);
    expect(docs.filter((d) => d.level === 'LIGHT').length).toBe(17);
  });

  it.each(docs.map((d) => [d.key, d.level]))('%s (%s): số nguồn = số lá OCR; không rơi, không nhân đôi', (key, level) => {
    const e = evidenceOf(key, level);
    const ledger = buildClaimLedger([e], null);
    expect(ledger.leaf_count).toBe(countLeaves(e.data));
    expect(sourceCount(ledger)).toBe(ledger.leaf_count);
    // mỗi record_id xuất hiện đúng một lần
    const ids = ledger.claims.flatMap((c) => c.sources.map((s) => s.record_id));
    expect(new Set(ids).size).toBe(ids.length);
    // và trỏ về đúng chứng từ
    expect(ids.every((id) => id.startsWith('ev-0000000000aa#'))).toBe(true);
  });

  it.each(docs.map((d) => [d.key, d.level]))('%s (%s): giá trị nguyên văn còn nguyên, không bị chuẩn hóa mất', (key, level) => {
    const e = evidenceOf(key, level);
    const ledger = buildClaimLedger([e], null);
    const data = e.data as Record<string, unknown>;
    const at = (path: string): unknown => path.split(/[.[\]]+/).filter(Boolean).reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], data);
    for (const c of ledger.claims) for (const s of c.sources) expect(at(s.field_path)).toBe(s.raw);
  });

  it('giá trị mà chuẩn hóa THẬT SỰ làm đổi dạng (hoa/thường, dấu cách, dấu gạch, tên): nguyên văn từng nguồn vẫn còn đủ', () => {
    // fixture "giàu" chỉ có "X" nên không bao giờ gặp ca này; dựng tay để chuẩn hóa khác bản gốc.
    const base = (makeRichData('land_use_certificate').parties as Array<Record<string, unknown>>)[0];
    const mk = (id: string, cert: string, name: string) => makeEvidence('land_use_certificate', {
      evidence_id: id,
      file_id: `file-${id.slice(3)}`,
      data: {
        parties: [{ ...base, full_name: name }],
        assets: [{ asset_index: 0, asset_type: 'real_estate', identifiers: { certificate_number: cert }, address: null, description: null, usage_context_hint: null }],
      } as never,
    });
    const evs = [mk('ev-0000000000a1', 'cs 01', 'Nguyễn  Văn   An'), mk('ev-0000000000a2', 'CS-01', 'NGUYỄN VĂN AN')];
    const ledger = buildClaimLedger(evs, null);
    const raws = ledger.claims.flatMap((c) => c.sources.map((s) => [s.record_id, s.raw] as const));
    expect(raws).toEqual(expect.arrayContaining([
      ['ev-0000000000a1#assets[0].identifiers.certificate_number', 'cs 01'],
      ['ev-0000000000a2#assets[0].identifiers.certificate_number', 'CS-01'],
      ['ev-0000000000a1#parties[0].full_name', 'Nguyễn  Văn   An'],
    ]));
    // `value` hiển thị là nguyên văn của nguồn đầu, không phải dạng chuẩn hóa; dạng chuẩn hóa nằm riêng ở value_norm.
    const cert = ledger.claims.find((c) => c.field === 'assets[].identifiers.certificate_number' && c.sources[0].raw === 'cs 01');
    expect(cert?.value).toBe('cs 01');
    expect(cert?.value_norm).toBe('CS01');
    // chưa có S3 nên chưa gắn được chủ thể ⇒ KHÔNG gộp: hai lá là hai claim, mỗi claim giữ nguyên văn của mình
    const certs = ledger.claims.filter((c) => c.field === 'assets[].identifiers.certificate_number');
    expect(certs.map((c) => c.sources[0].raw).sort()).toEqual(['CS-01', 'cs 01']);
    expect(certs.every((c) => c.unresolved !== undefined)).toBe(true);
  });

  it('nhiều chứng từ cùng lúc: tổng nguồn = tổng lá của tất cả; không lá nào lẫn sang chứng từ khác', () => {
    const evs = docs.slice(0, 12).map((d, i) => ({ ...evidenceOf(d.key, d.level), evidence_id: `ev-0000000000${(i + 10).toString(16).padStart(2, '0')}` }));
    const ledger = buildClaimLedger(evs, null);
    expect(ledger.leaf_count).toBe(evs.reduce((n, e) => n + countLeaves(e.data), 0));
    expect(sourceCount(ledger)).toBe(ledger.leaf_count);
    for (const c of ledger.claims) for (const s of c.sources) expect(s.record_id.startsWith(`${s.evidence_id}#`)).toBe(true);
  });

  it('chứng từ lỗi (status ≠ SUCCESS) hoặc data null không vào sổ, không ném lỗi', () => {
    const bad = { ...evidenceOf('id_card', 'FULL'), status: 'ERROR' as const, data: null };
    const ledger = buildClaimLedger([bad as never, { ...evidenceOf('cic', 'FULL'), data: null } as never], null);
    expect(ledger).toEqual({ claims: [], leaf_count: 0, unresolved_count: 0 });
  });

  it('thuần và tất định', () => {
    const evs = docs.slice(0, 10).map((d, i) => ({ ...evidenceOf(d.key, d.level), evidence_id: `ev-0000000000${(i + 10).toString(16).padStart(2, '0')}` }));
    expect(JSON.stringify(buildClaimLedger(evs, null))).toBe(JSON.stringify(buildClaimLedger(evs, null)));
  });

  it('bản ghi bản đồ lá trùng với evidence-v3 (cùng định nghĩa "lá") — rào an toàn dẫn nguồn dùng lại được', () => {
    // evidence-v3 sinh EvidenceRecord cho từng lá bằng cùng quy tắc; record_id của sổ phải khớp từng cái.
    const { buildEvidenceRegistryV3 } = jest.requireActual('@/lib/pipelines/workflows/loan-appraisal/evidence-v3') as typeof import('@/lib/pipelines/workflows/loan-appraisal/evidence-v3');
    const e = evidenceOf('loan_application', 'FULL');
    const reg = buildEvidenceRegistryV3([e], new Set(), null);
    const ledger = buildClaimLedger([e], null);
    const fromReg = new Set(reg.records.map((r) => r.evidence_id));
    const fromLedger = new Set(ledger.claims.flatMap((c) => c.sources.map((s) => s.record_id)));
    expect([...fromLedger].sort()).toEqual([...fromReg].sort());
  });
});

describe('sổ Claim — gắn chủ thể trên hồ sơ có S3', () => {
  const own = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };
  const dossier = (): EvidenceEnvelope[] => [
    loanApp([
      { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1985-02-02' },
      { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_B12 },
    ], {
      id: 'ev-aaaaaaaaaa01',
      assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'CS01', land_parcel_number: '12', map_sheet_number: '5' } }],
      data: {
        asset_details: [{ asset_index: 0, collateral_type_raw: 'Nhà đất', owner_names_raw: 'LÊ THỊ CÚC', owner_party_indexes: [1], declared_value: 1500000000, vehicle_brand: null, vehicle_model: null }],
        loan_info: { requested_amount: 600000000, bank_proposed_amount: 500000000, loan_term_months: 18 },
        business_info: { business_name: 'HKD AN', tax_id: '8123456789' },
      },
    }),
    ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1985-02-02' }] }),
    ev('land_use_certificate', {
      id: 'ev-aaaaaaaaaa04',
      assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS01', land_parcel_number: '12', map_sheet_number: '5' } }],
      parties: [{ party_role: 'OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_B12, ownership: own }],
      data: { asset_details: [{ asset_index: 0, land_area_m2: 120 }] },
    }),
    ev('external_valuation_certificate', {
      id: 'ev-aaaaaaaaaa05',
      assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS0I', land_parcel_number: '12', map_sheet_number: '5' } }], parties: [],
      data: { asset_details: [{ asset_index: 0, land_area_m2: 120, valuation_value: 1500000000 }], valuation_info: { appraisal_company: 'Công ty X' } },
    }),
  ];
  const run = () => {
    const evs = dossier();
    const map = runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-14', now }).data!;
    return { evs, map, ledger: buildClaimLedger(evs, map) };
  };
  const find = (cs: Claim[], subject: string, field: string) => cs.filter((c) => c.subject.id === subject && c.field === field);

  it('lossless trên hồ sơ thật: số nguồn = số lá', () => {
    const { ledger, evs } = run();
    expect(sourceCount(ledger)).toBe(ledger.leaf_count);
    expect(ledger.leaf_count).toBe(evs.reduce((n, e) => n + countLeaves(e.data), 0));
  });

  it('thông tin người gắn đúng person-n qua party_index, kể cả từ nhiều chứng từ; cùng giá trị gộp thành MỘT claim nhiều nguồn', () => {
    const { ledger } = run();
    const id = find(ledger.claims, 'person-1', 'parties[].id_number');
    expect(id).toHaveLength(1);
    expect(id[0].sources.map((s) => s.evidence_id).sort()).toEqual(['ev-aaaaaaaaaa01', 'ev-aaaaaaaaaa02']);
    expect(id[0].status).toBe('CORROBORATED');
    expect(id[0].contradicts).toEqual([]);
  });

  it('khoản vay và hộ kinh doanh có chủ thể riêng; khai trên đơn vay ở trạng thái DECLARED', () => {
    const { ledger } = run();
    const amount = ledger.claims.find((c) => c.field === 'loan_info.requested_amount')!;
    expect(amount.subject.kind).toBe('loan');
    expect(amount.status).toBe('DECLARED');
    expect(amount.value).toBe(600000000);
    expect(ledger.claims.find((c) => c.field === 'business_info.tax_id')!.subject.kind).toBe('business');
  });

  it('hai chứng từ ghi số GCN khác nhau → HAI claim giữ cả hai nguồn, nối CONTRADICTS; mã ngắn lệch 1 ký tự vẫn là DISPUTED (đúng như S3)', () => {
    const { ledger, map } = run();
    const asset = map.asset_registry[0].asset_id;
    const cs = find(ledger.claims, asset, 'assets[].identifiers.certificate_number');
    expect(cs.map((c) => c.value).sort()).toEqual(['CS01', 'CS0I']);
    const [a, b] = cs;
    expect(a.contradicts).toEqual([b.claim_id]);
    expect(b.contradicts).toEqual([a.claim_id]);
    const odd = cs.find((c) => c.value === 'CS0I')!;
    const major = cs.find((c) => c.value === 'CS01')!;
    expect(major.sources.map((s) => s.doc_type_key).sort()).toEqual(['land_use_certificate', 'loan_application']);
    expect(odd.sources.map((s) => s.doc_type_key)).toEqual(['external_valuation_certificate']);
    // Mã chỉ 4 ký tự (< NEAR_MATCH_MIN_LENGTH) nên không đủ căn cứ coi là lỗi đọc: cùng kết luận với identifier_conflicts của S3.
    expect(map.asset_registry[0].identifier_conflicts[0]).toMatchObject({ probable_ocr_error: false });
    expect(odd.status).toBe('DISPUTED');
    expect(major.status).toBe('DISPUTED');
  });

  it(`mã dài ≥ ${NEAR_MATCH_MIN_LENGTH} ký tự, đa số ≥ 2 chứng từ, đúng 1 chứng từ lệch 1 ký tự → PROBABLE_OCR_ERROR (khớp S3)`, () => {
    const long = 'AA08798136'; const wrong = 'AA08798I36';
    const gcn = (id: string, num: string) => ev('land_use_certificate', { id, assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: num, land_parcel_number: '12', map_sheet_number: '5' } }], parties: [{ party_role: 'OWNER', full_name: 'B', id_number: ID_B12, ownership: own }] });
    const evs = [
      loanApp([{ party_role: 'BORROWER', full_name: 'A', id_number: ID_A12 }, { party_role: 'COLLATERAL_OWNER', full_name: 'B', id_number: ID_B12 }], { id: 'ev-aaaaaaaaaa01', assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: long, land_parcel_number: '12', map_sheet_number: '5' } }] }),
      gcn('ev-aaaaaaaaaa04', long),
      ev('external_valuation_certificate', { id: 'ev-aaaaaaaaaa05', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: wrong, land_parcel_number: '12', map_sheet_number: '5' } }], parties: [] }),
    ];
    const map = runMapDossier({ evidences: evs, dossier_submitted_at: '2026-10-14', now }).data!;
    expect(map.asset_registry[0].identifier_conflicts[0]).toMatchObject({ probable_ocr_error: true });
    const cs = buildClaimLedger(evs, map).claims.filter((c) => c.field === 'assets[].identifiers.certificate_number');
    expect(cs.find((c) => c.value === wrong)!.status).toBe('PROBABLE_OCR_ERROR');
    expect(cs.find((c) => c.value === long)!.status).toBe('DISPUTED');
    expect(cs.find((c) => c.value === long)!.sources).toHaveLength(2);
  });

  it('giá trị cùng nhau nhưng khác cách viết (hoa/thường, dấu cách) gộp một claim, không tạo mâu thuẫn giả', () => {
    const evs = [ev('land_use_certificate', { id: 'ev-aaaaaaaaaa04', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'cs 01' } }], parties: [{ party_role: 'OWNER', full_name: 'A', id_number: ID_A12, ownership: own }] }),
      ev('real_estate_valuation_report', { id: 'ev-aaaaaaaaaa05', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS-01' } }], parties: [] })];
    const map = runMapDossier({ evidences: [loanApp([{ party_role: 'BORROWER', full_name: 'A', id_number: ID_A12 }], { id: 'ev-aaaaaaaaaa01', assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'CS01' } }] }), ...evs], dossier_submitted_at: '2026-10-14', now }).data!;
    const ledger = buildClaimLedger([loanApp([{ party_role: 'BORROWER', full_name: 'A', id_number: ID_A12 }], { id: 'ev-aaaaaaaaaa01', assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'CS01' } }] }), ...evs], map);
    const cs = ledger.claims.filter((c) => c.field === 'assets[].identifiers.certificate_number');
    expect(cs).toHaveLength(1);
    expect(cs[0].sources).toHaveLength(3);
    expect(cs[0].status).toBe('CORROBORATED');
  });

  it('khóa liên kết (party_index, asset_index) vào sổ nhưng không bao giờ tạo mâu thuẫn', () => {
    const { ledger } = run();
    for (const c of ledger.claims.filter((x) => /(_index|_indexes\[\])$/.test(x.field))) expect(c.contradicts).toEqual([]);
  });

  it('read_confidence là độ tin cậy ĐỌC CHỮ cấp 1 (field_confidences), không phải độ tin cậy gán chủ thể', () => {
    const e = evidenceOf('id_card', 'FULL');
    const ledger = buildClaimLedger([e], null);
    expect(ledger.claims.flatMap((c) => c.sources).every((s) => s.read_confidence === 0.9)).toBe(true);
  });

  it('lá chưa gắn được chủ thể vẫn ở trong sổ, gắn vào chứng từ và có lý do; không mất', () => {
    const e = evidenceOf('cic', 'FULL'); // không có S3
    const ledger = buildClaimLedger([e], null);
    const unresolved = ledger.claims.filter((c) => c.unresolved);
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.every((c) => c.subject.kind === 'document')).toBe(true);
    expect(ledger.unresolved_count).toBe(unresolved.reduce((n, c) => n + c.sources.length, 0));
    expect(sourceCount(ledger)).toBe(ledger.leaf_count);
  });
});

describe('sổ Claim — không báo mâu thuẫn giả trên hồ sơ bình thường', () => {
  const own = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };
  const evs = (): EvidenceEnvelope[] => [
    loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1985-02-02' }], {
      id: 'ev-aaaaaaaaaa01', assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136', land_parcel_number: '12', map_sheet_number: '5' } }],
    }),
    ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'Nguyễn Văn An', id_number: ID_A12, previous_id_numbers: ['012345671'], date_of_birth: '1985-02-02' }] }),
    ev('vneid', { id: 'ev-aaaaaaaaaa03', parties: [{ party_role: 'HOLDER', full_name: 'NGUYEN VAN AN', id_number: ID_A12, date_of_birth: '1985-02-02' }] }),
    ev('land_use_certificate', {
      id: 'ev-aaaaaaaaaa04', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AA08798136', land_parcel_number: '12', map_sheet_number: '5' } }],
      parties: [{ party_role: 'OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, ownership: own }], data: { asset_details: [{ asset_index: 0, land_area_m2: 120 }] },
    }),
    ev('external_valuation_certificate', {
      id: 'ev-aaaaaaaaaa05', assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AA08798136', land_parcel_number: '12', map_sheet_number: '5' } }], parties: [],
      data: { asset_details: [{ asset_index: 0, land_area_m2: 118.5, valuation_value: 1450000000 }] },
    }),
  ];
  const ledger = () => { const e = evs(); return buildClaimLedger(e, runMapDossier({ evidences: e, dossier_submitted_at: '2026-10-14', now }).data!); };

  it('cùng tên khác dấu (NGUYEN VAN AN / Nguyễn Văn An) là SPELLING_VARIANT, KHÔNG nối CONTRADICTS', () => {
    const names = ledger().claims.filter((c) => c.subject.id === 'person-1' && c.field === 'parties[].full_name');
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.every((c) => c.contradicts.length === 0)).toBe(true);
    expect(names.some((c) => c.status === 'SPELLING_VARIANT')).toBe(true);
    // cả hai biến thể đều còn nguyên nguồn
    expect(names.flatMap((c) => c.sources.map((s) => s.raw))).toEqual(expect.arrayContaining(['NGUYỄN VĂN AN', 'Nguyễn Văn An', 'NGUYEN VAN AN']));
  });

  it('diện tích / giá trị định giá khác nhau giữa các chứng từ là bình thường: vào sổ nhưng không CONTRADICTS', () => {
    const area = ledger().claims.filter((c) => c.field === 'asset_details[].land_area_m2');
    expect(area.map((c) => c.value).sort()).toEqual([118.5, 120]);
    expect(area.every((c) => c.contradicts.length === 0 && c.status !== 'DISPUTED')).toBe(true);
  });

  it('số định danh hiện hành và số cũ (previous_id_numbers[]) không bao giờ mâu thuẫn nhau', () => {
    const ids = ledger().claims.filter((c) => c.subject.id === 'person-1' && /id_number/.test(c.field));
    expect(ids.every((c) => c.contradicts.length === 0)).toBe(true);
  });

  it('hồ sơ bình thường: KHÔNG có claim DISPUTED / PROBABLE_OCR_ERROR nào', () => {
    expect(ledger().claims.filter((c) => c.status === 'DISPUTED' || c.status === 'PROBABLE_OCR_ERROR')).toEqual([]);
  });

  it('khác SỐ định danh thật sự (khác người) vẫn là DISPUTED', () => {
    const e = evs();
    e[2] = ev('vneid', { id: 'ev-aaaaaaaaaa03', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: '001090009999', date_of_birth: '1985-02-02' }] });
    const map = runMapDossier({ evidences: e, dossier_submitted_at: '2026-10-14', now }).data!;
    const ids = buildClaimLedger(e, map).claims.filter((c) => c.field === 'parties[].id_number' && c.contradicts.length > 0);
    // Có thể S3 tách thành hai người; nếu vẫn cùng person thì phải là DISPUTED
    for (const c of ids) expect(c.status).toBe('DISPUTED');
  });

  it('khác ngày sinh của cùng một người là DISPUTED', () => {
    const e = evs();
    e[1] = ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, previous_id_numbers: [], date_of_birth: '1990-09-09' }] });
    const map = runMapDossier({ evidences: e, dossier_submitted_at: '2026-10-14', now }).data!;
    const dobs = buildClaimLedger(e, map).claims.filter((c) => c.subject.id === 'person-1' && c.field === 'parties[].date_of_birth');
    // đơn vay + VNeID cùng ghi 1985-02-02 (gộp một claim 2 nguồn), CCCD ghi 1990-09-09 → 2 claim đối lập
    expect(dobs.map((d) => [d.value, d.sources.length]).sort()).toEqual([['1985-02-02', 2], ['1990-09-09', 1]]);
    expect(dobs.every((d) => d.status === 'DISPUTED' && d.contradicts.length === 1)).toBe(true);
  });
});
describe('genericField', () => {
  it('bỏ chỉ số mảng', () => {
    expect(genericField('parties[2].full_name')).toBe('parties[].full_name');
    expect(genericField('a[0].b[12].c')).toBe('a[].b[].c');
  });
});

