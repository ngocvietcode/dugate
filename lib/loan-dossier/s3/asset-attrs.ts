// Thuộc tính tài sản, chủ sở hữu, ngữ cảnh sử dụng (T-S3-09; S3-R16, R17, R18, R19).
import type { AssetIdentifiers, DocumentParty } from '../s2/common-schema';
import { hasFullKey } from './asset-key';
import type { AssetGroup, Descriptor, IdentifierConflict, LinkKind } from './asset-group';
import type { Evidence } from './types';

export interface AssetSource {
  evidence_id: string;
  doc_type_key: string;
  asset_index: number;
  link: LinkKind;
}

export interface AssetRegistryEntry {
  asset_id: string;
  asset_type: string;
  identifiers: AssetIdentifiers;
  owner_person_ids: string[];
  current_owner_person_ids: string[];
  usage_contexts: Array<'collateral' | 'rental_income'>;
  context_status: 'CONFIRMED' | 'AMBIGUOUS' | 'UNRESOLVED';
  context_reason_code: 'ASSET_CONTEXT_AMBIGUOUS' | 'ASSET_IDENTIFIER_CONFLICT' | null;
  sources: AssetSource[];
  identifier_conflicts: IdentifierConflict[];
}

const CONTEXT_ORDER = ['collateral', 'rental_income'] as const;
const FAMILY = (t: string) => (t === 'real_estate' || t === 'apartment' ? 'property' : t === 'vehicle' ? 'vehicle' : null);

/** Mức ưu tiên nguồn S3-R16: 1 = được ownership trỏ tới; 2 = không hint; 3 = có hint. */
const levelOf = (d: Descriptor) => (d.owned ? 1 : d.descriptor.usage_context_hint === null ? 2 : 3);

function byPriority(members: Descriptor[]): Descriptor[] {
  return [...members].sort((a, b) => levelOf(a) - levelOf(b) || b.confidence - a.confidence || a.evidence_order - b.evidence_order || a.asset_index - b.asset_index);
}

/** Tài sản mà party OWNER thuộc về (S3-R17): theo ownership.asset_index; null + evidence 1 tài sản → tài sản đó. */
export function ownedAssetIndex(party: DocumentParty, evidence: Evidence): number | null {
  if (party.ownership) return party.ownership.asset_index;
  const assets = (evidence.data?.assets as unknown[] | undefined) ?? [];
  return assets.length === 1 ? (assets[0] as { asset_index: number }).asset_index : null;
}

/** Mốc của chứng từ sở hữu: max ngày biến động CHANGE_RECORD trỏ tới tài sản, không có → ngày cấp. */
function milestone(e: Evidence, assetIndex: number): string | null {
  const parties = (e.data?.parties as DocumentParty[] | undefined) ?? [];
  const dates = parties
    .filter((p) => p.ownership?.asset_index === assetIndex && p.ownership.ownership_source === 'CHANGE_RECORD' && p.ownership.ownership_change_date)
    .map((p) => p.ownership!.ownership_change_date!);
  if (dates.length > 0) return dates.reduce((a, b) => (b > a ? b : a));
  return (e.data?.legal_info as { issue_date?: string | null } | null | undefined)?.issue_date ?? null;
}

/**
 * `personOf`: partyKey → person_id (S3-R04 party con dùng sub_index). Không dùng chủ TSBĐ khai trên đơn vay làm
 * chủ sở hữu: chỉ party `OWNER` của chứng từ sở hữu.
 */
export function finalizeAssets(groups: AssetGroup[], personOf: ReadonlyMap<string, string>, evidences: ReadonlyArray<Evidence>): AssetRegistryEntry[] {
  const evidenceById = new Map(evidences.map((e) => [e.evidence_id, e]));
  const personsOfParty = (e: Evidence, p: DocumentParty): string[] => {
    const ids: string[] = [];
    for (const [k, v] of personOf) if (k.startsWith(`${e.evidence_id}#${p.party_index}#`) && !ids.includes(v)) ids.push(v);
    return ids;
  };

  return groups.map((g) => {
    const ordered = byPriority(g.members);
    const top = ordered[0];
    let asset_type = top.descriptor.asset_type;
    if (FAMILY(asset_type) === 'property' && ordered.some((d) => levelOf(d) === 1 && d.descriptor.asset_type === 'apartment')) asset_type = 'apartment';
    const identifiers = { ...top.descriptor.identifiers };
    for (const field of Object.keys(identifiers) as Array<keyof AssetIdentifiers>) {
      identifiers[field] = ordered.map((d) => d.descriptor.identifiers[field]).find((v) => v !== null && v !== undefined) ?? null;
    }

    // S3-R17 chủ sở hữu
    const owners: string[] = [];
    const ownershipEvidence: Array<{ e: Evidence; assetIndex: number; order: number }> = [];
    for (const m of g.members) {
      const e = evidenceById.get(m.evidence_id)!;
      const parties = (e.data?.parties as DocumentParty[] | undefined) ?? [];
      for (const p of parties) {
        if (p.party_role !== 'OWNER' || ownedAssetIndex(p, e) !== m.asset_index) continue;
        for (const id of personsOfParty(e, p)) if (!owners.includes(id)) owners.push(id);
      }
      if (parties.some((p) => p.ownership?.asset_index === m.asset_index)) ownershipEvidence.push({ e, assetIndex: m.asset_index, order: m.evidence_order });
    }
    let current: string[] = [];
    if (ownershipEvidence.length > 0) {
      const best = [...ownershipEvidence].sort((a, b) => {
        const ma = milestone(a.e, a.assetIndex); const mb = milestone(b.e, b.assetIndex);
        if (ma !== mb) { if (ma === null) return 1; if (mb === null) return -1; return ma < mb ? 1 : -1; }
        return a.order - b.order;
      })[0];
      const parties = (best.e.data?.parties as DocumentParty[] | undefined) ?? [];
      for (const p of parties) {
        if (p.ownership?.asset_index !== best.assetIndex || !p.ownership.is_current_owner) continue;
        for (const id of personsOfParty(best.e, p)) if (!current.includes(id)) current.push(id);
      }
    }

    // S3-R18 ngữ cảnh
    const hints = new Set(g.members.map((m) => m.descriptor.usage_context_hint).filter((h): h is 'collateral' | 'rental_income' => h !== null));
    const usage_contexts = CONTEXT_ORDER.filter((c) => hints.has(c));

    // S3-R19 trạng thái ngữ cảnh
    const fam = FAMILY(asset_type);
    const noFullKey = fam !== null && !g.members.some((m) => hasFullKey(m.descriptor));
    let context_status: AssetRegistryEntry['context_status'] = 'CONFIRMED';
    let context_reason_code: AssetRegistryEntry['context_reason_code'] = null;
    if (usage_contexts.length === 0) { context_status = 'UNRESOLVED'; context_reason_code = 'ASSET_CONTEXT_AMBIGUOUS'; }
    else if (g.identifier_conflicts.some((c) => !c.probable_ocr_error) || g.ambiguous) { context_status = 'AMBIGUOUS'; context_reason_code = 'ASSET_IDENTIFIER_CONFLICT'; }
    else if (g.weak || noFullKey) { context_status = 'AMBIGUOUS'; context_reason_code = 'ASSET_CONTEXT_AMBIGUOUS'; }

    return {
      asset_id: g.asset_id,
      asset_type,
      identifiers,
      owner_person_ids: owners,
      current_owner_person_ids: current,
      usage_contexts,
      context_status,
      context_reason_code,
      sources: g.members.map((m, i) => ({ evidence_id: m.evidence_id, doc_type_key: m.doc_type_key, asset_index: m.asset_index, link: g.links[i] })),
      identifier_conflicts: g.identifier_conflicts,
    };
  });
}
