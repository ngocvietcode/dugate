// Tài sản (D-114): tài sản S3 kèm chủ sở hữu, các chứng thư định giá còn hiệu lực và giá trị dùng tính LTV theo chính sách (D-112: thấp
// nhất). Chi tiết vật lý lấy từ LAC. Hàm thuần, tất định.
import type { MapDossierData } from '../contracts/check-stages';
import type { MergePolicies } from './policies';
import type { Collateral } from './schema';
import { basisAt, detailsOf, text, valueAt, type Lookup } from './sources';

export const VALUATION_DOC_TYPES: ReadonlySet<string> = new Set(['real_estate_valuation_report', 'external_valuation_certificate', 'movable_asset_valuation_report']);
const KEY_FIELDS = ['certificate_number', 'license_plate', 'chassis_number', 'registration_number', 'apartment_number'];

export function buildCollateral(lookup: Lookup, s3: MapDossierData | null, policies: MergePolicies | null): Collateral[] {
  const live = new Map(lookup.evidences.map((e) => [e.evidence_id, e]));
  return (s3?.asset_registry ?? []).map((a) => {
    const ids = a.identifiers as Record<string, unknown>;
    const valuations: Collateral['valuations'] = [];
    const sources = a.sources as Array<{ evidence_id: string; asset_index: number; link?: string; match?: unknown }>;
    for (const src of sources) {
      const e = live.get(src.evidence_id);
      if (!e || !VALUATION_DOC_TYPES.has(e.doc_type_key)) continue;
      const details = (e.data?.asset_details as Array<{ asset_index?: number }> | undefined) ?? [];
      const i = details.findIndex((d) => d.asset_index === src.asset_index);
      const basis = i >= 0 ? basisAt(e, `asset_details[${i}].valuation_value`) : null;
      if (!basis) continue;
      valuations.push({
        value: basis.value,
        valuation_date: text(valueAt(e.data, 'valuation_info.valuation_date')),
        appraiser: text(valueAt(e.data, 'valuation_info.appraisal_company')),
        doc_type_key: e.doc_type_key,
        record_id: basis.record_ids[0],
        review: basis.review_record_ids.length > 0 ? 'REVIEW' : 'ACCEPTED',
      });
    }
    const owners = [...new Set([...a.owner_person_ids, ...a.current_owner_person_ids])].map((person_id) => ({ person_id, current: a.current_owner_person_ids.includes(person_id) }));
    return {
      asset_id: a.asset_id,
      asset_type: a.asset_type,
      key: KEY_FIELDS.map((k) => text(ids[k])).find((x): x is string => !!x) ?? null,
      usage_contexts: [...a.usage_contexts],
      context_status: a.context_status,
      match_review: a.context_status !== 'CONFIRMED' && sources.some((s) => s.match !== undefined || s.link === 'APPROXIMATE' || s.link === 'POSSIBLE'),
      owners,
      valuations,
      chosen_value: policies && valuations.length > 0 ? Math.min(...valuations.map((v) => v.value)) : null,
      details: detailsOf(lookup.lac, a.asset_id, new Set()),
    } satisfies Collateral;
  });
}
