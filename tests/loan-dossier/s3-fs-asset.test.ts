// D-117 — nối tài sản BĐS bằng Fellegi-Sunter (spec s3_fellegi_sunter.md §9). Dữ liệu giả, không PII thật.
import { MapDossierStageResultSchema } from '@/lib/loan-dossier/contracts/check-stages';
import { loadAssetFsParams, parseAssetFsParams } from '@/lib/loan-dossier/s3/fs/asset-params';
import { osaDistance } from '@/lib/loan-dossier/common/edit-distance';
import { resolveS3AssetMatcher, runMapDossier, type S3AssetMatcher } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, ID_B12, loanApp } from './fixtures/dossier';
import { D0, profileOf } from './fixtures/profile';

const NAME = 'NGUYỄN THỊ AN';
const owner = (id = ID_A12, name = NAME) => ({ party_role: 'OWNER', full_name: name, id_number: id, ownership: { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true } });

/** Đơn vay khai TSBĐ với số GCN `cert`; chủ TSBĐ là chính người vay. */
const app = (cert: string, ids: Record<string, string> = {}) => loanApp(
  [{ party_role: 'BORROWER', full_name: NAME, id_number: ID_A12 }, { party_role: 'COLLATERAL_OWNER', full_name: NAME, id_number: ID_A12 }],
  { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: cert, ...ids } }] },
);
const gcn = (ids: Record<string, string>, parties = [owner()]) => ev('land_use_certificate', { parties, assets: [{ asset_type: 'real_estate', usage_context_hint: null, identifiers: ids }] });
const valuation = (ids: Record<string, string>, value: number) => {
  const v = ev('real_estate_valuation_report', { issue_date: '2026-09-01', parties: [], assets: [{ asset_type: 'real_estate', usage_context_hint: null, identifiers: ids }] });
  v.data!.asset_details = [{ ...((v.data!.asset_details as Array<Record<string, unknown>> | undefined)?.[0] ?? {}), asset_index: 0, valuation_value: value }];
  return { ...v, field_confidences: { ...v.field_confidences, asset_details: 0.95 } };
};

const run = (evidences: EvidenceEnvelope[], asset_matcher?: S3AssetMatcher) => runMapDossier({ evidences, dossier_submitted_at: D0, asset_matcher });
const GCN_IDS = { certificate_number: 'AA 08798136', certificate_book_number: 'CN 6475', land_parcel_number: '933', map_sheet_number: '18' };

describe('osaDistance', () => {
  it('đảo 2 ký tự liền nhau, thêm / bớt / thay 1 ký tự đều là 1; hai lỗi là 2', () => {
    expect(osaDistance('AA08798136', 'AA07898136')).toBe(1);
    expect(osaDistance('AA08798136', 'AA0798136')).toBe(1);
    expect(osaDistance('AA08798136', 'AA08798137')).toBe(1);
    expect(osaDistance('AA08798136', 'AA07898137')).toBe(2);
  });
});

describe('asset_fs_params.json', () => {
  it('catalog hợp lệ; ngưỡng sai chiều → lỗi', () => {
    const r = loadAssetFsParams();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(parseAssetFsParams({ ...r.params, thresholds: { upper: 1, lower: 2 } }).ok).toBe(false);
  });
});

describe('nối tài sản BĐS bằng FS (D-117)', () => {
  it('UAT: đơn vay ghi GCN đảo 2 ký tự, GCN + định giá cùng số → 1 tài sản; nghi lỗi đọc (D-41, D-118) nên CONFIRMED', () => {
    const evs = [app('AA07898136', { certificate_book_number: 'CN 6475' }), gcn(GCN_IDS), valuation({ certificate_number: 'AA08798136', land_parcel_number: '933', map_sheet_number: '18' }, 2_386_560_000)];
    const r = run(evs);
    expect(MapDossierStageResultSchema.safeParse(r).success).toBe(true);
    const assets = r.data!.asset_registry;
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ usage_contexts: ['collateral'], context_status: 'CONFIRMED', context_reason_code: null });
    const sources = assets[0].sources as Array<{ doc_type_key: string; link: string; match?: { decision: string; breakdown: Record<string, string> } }>;
    expect(sources.map((s) => s.link)).toEqual(['SEED', 'EXACT', 'EXACT']);
    expect(sources.find((s) => s.doc_type_key === 'land_use_certificate')!.match).toMatchObject({ decision: 'MATCH', breakdown: { certificate_number: 'NEAR', certificate_book_number: 'AGREE', owner: 'AGREE' } });
    const appId = evs[0].evidence_id;
    expect(assets[0].identifier_conflicts).toEqual([expect.objectContaining({ field: 'certificate_number', probable_ocr_error: true, outlier_evidence_ids: [appId] })]);
  });

  it('s3_asset_matcher = rules → luật cũ (Levenshtein 1) tách 2 tài sản như trước', () => {
    expect(run([app('AA07898136', { certificate_book_number: 'CN 6475' }), gcn(GCN_IDS)], 'rules').data!.asset_registry).toHaveLength(2);
    expect(resolveS3AssetMatcher('RULES')).toBe('rules');
    expect(resolveS3AssetMatcher(undefined)).toBe('fs');
    expect(resolveS3AssetMatcher('xyz')).toBe('fs');
  });

  it('chỉ số GCN gần khớp, không bằng chứng khác → POSSIBLE: vẫn gộp, AMBIGUOUS', () => {
    const assets = run([app('AA07898136'), gcn({ certificate_number: 'AA08798136' }, [])]).data!.asset_registry;
    expect(assets).toHaveLength(1);
    expect((assets[0].sources as Array<{ link: string }>).map((s) => s.link)).toEqual(['SEED', 'POSSIBLE']);
    expect(assets[0].context_status).toBe('AMBIGUOUS');
  });

  it('số GCN gần khớp nhưng chủ sở hữu khác → không nối', () => {
    const assets = run([app('AA07898136'), gcn({ certificate_number: 'AA08798136' }, [owner(ID_B12, 'TRẦN VĂN BÌNH')])]).data!.asset_registry;
    expect(assets).toHaveLength(2);
  });

  it('số GCN khác hẳn, chỉ trùng số vào sổ và chủ → không nối; thửa/tờ khác → không nối dù GCN gần khớp', () => {
    expect(run([app('BB12345678', { certificate_book_number: 'CN 6475' }), gcn(GCN_IDS)]).data!.asset_registry).toHaveLength(2);
    const parcel = run([app('AA07898136', { certificate_book_number: 'CN 6475', land_parcel_number: '934', map_sheet_number: '18' }), gcn(GCN_IDS)]).data!.asset_registry;
    expect(parcel).toHaveLength(2);
  });

  it('D-119: hai GCN khác thửa của cùng chủ, số chỉ đảo 2 ký tự → không gộp qua đơn vay; đơn vay theo GCN trùng số', () => {
    const evs = [
      app('BX123456'),
      gcn({ certificate_number: 'BX123456', land_parcel_number: '10', map_sheet_number: '3' }),
      gcn({ certificate_number: 'BX123465', land_parcel_number: '77', map_sheet_number: '9' }),
    ];
    const assets = run(evs).data!.asset_registry;
    expect(assets).toHaveLength(2);
    expect((assets[0].sources as Array<{ evidence_id: string }>).map((s) => s.evidence_id)).toEqual([evs[0].evidence_id, evs[1].evidence_id]);
    expect(assets[0]).toMatchObject({ context_status: 'CONFIRMED', identifier_conflicts: [] });
    expect((assets[1].sources as Array<{ evidence_id: string }>).map((s) => s.evidence_id)).toEqual([evs[2].evidence_id]);
  });

  it('số vào sổ chỉ khác tiền tố / số 0 đầu (CN 6475 ↔ CS 06475) vẫn là bằng chứng nối', () => {
    const r = run([app('AA07898136', { certificate_book_number: 'CS 06475' }), gcn(GCN_IDS)]);
    const src = (r.data!.asset_registry[0].sources as Array<{ match?: { decision: string; breakdown: Record<string, string> } }>)[1];
    expect(r.data!.asset_registry).toHaveLength(1);
    expect(src.match).toMatchObject({ decision: 'MATCH', breakdown: { certificate_book_number: 'DIGITS_AGREE' } });
  });
});

describe('hồ sơ 360 với tài sản gộp (D-117, D-118)', () => {
  it('UAT: số GCN đảo 2 ký tự là biến thể nghi đọc sai, không phải mâu thuẫn; LTV dùng giá định giá chính thức', () => {
    const p = profileOf([app('AA07898136', { certificate_book_number: 'CN 6475' }), gcn(GCN_IDS), valuation({ certificate_number: 'AA08798136', land_parcel_number: '933', map_sheet_number: '18' }, 2_386_560_000)]);
    expect(p.conflicts.map((c) => [c.subject_id, c.field, c.kind])).toEqual([['asset-1', 'assets[].identifiers.certificate_number', 'PROBABLE_OCR_ERROR']]);
    expect(p.collateral[0]).toMatchObject({ context_status: 'CONFIRMED', match_review: false, chosen_value: 2_386_560_000 });
    const codes = p.issues.map((i) => i.code);
    expect(codes).toContain('PROBABLE_OCR_ERROR');
    for (const c of ['FIELD_CONFLICT', 'COLLATERAL_MATCH_REVIEW_REQUIRED', 'COLLATERAL_NOT_VALUED', 'COLLATERAL_CONTEXT_AMBIGUOUS']) expect(codes).not.toContain(c);
    expect(p.financial_basis.collateral_value).toMatchObject({ value: 2_386_560_000, review_record_ids: [] });
  });

  it('chỉ một chứng từ ghi số đúng (không có đa số) → vẫn gộp chờ xác nhận: COLLATERAL_MATCH_REVIEW_REQUIRED, LTV là bản ghi cần xem', () => {
    const p = profileOf([app('AA07898136'), valuation({ certificate_number: 'AA08798136' }, 2_386_560_000)]);
    expect(p.collateral).toHaveLength(1);
    expect(p.collateral[0]).toMatchObject({ match_review: true, chosen_value: 2_386_560_000 });
    const codes = p.issues.map((i) => i.code);
    expect(codes).toContain('COLLATERAL_MATCH_REVIEW_REQUIRED');
    expect(codes).not.toContain('COLLATERAL_NOT_VALUED');
    expect(codes).not.toContain('COLLATERAL_CONTEXT_AMBIGUOUS');
    expect(p.financial_basis.collateral_value!.value).toBe(2_386_560_000);
    expect(p.financial_basis.collateral_value!.review_record_ids.length).toBeGreaterThan(0);
  });
});
