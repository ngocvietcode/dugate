// Truy vấn đọc từ DossierGraph cho tầng dùng lại (master_dossier). Chỉ đọc; không dựng lại mảng id chéo của S3.
import { nodesOf, outEdges } from './project';
import type { AssetNode, DossierGraph, EvidenceNode, PersonNode } from './types';

export interface PersonView {
  person_id: string;
  primary_role: string;
  identity: PersonNode['identity'];
  /** Chứng từ nguồn (cạnh MENTIONED_IN) theo thứ tự S3. */
  mentions: Array<{ evidence_id: string; party_index: number }>;
}

export interface AssetView {
  asset_id: string;
  asset_type: string;
  identifiers: AssetNode['attrs']['identifiers'];
  usage_contexts: string[];
  sources: Array<{ evidence_id: string; asset_index: number }>;
}

/** Người theo thứ tự S3 (person-1, person-2…). */
export function listPersons(g: DossierGraph): PersonView[] {
  return nodesOf(g, 'person').map(({ id, node }) => {
    const p = node as PersonNode;
    return {
      person_id: id,
      primary_role: p.registry.primary_role,
      identity: p.identity,
      mentions: outEdges(g, id, 'MENTIONED_IN').sort((a, b) => a.edge.seq - b.edge.seq)
        .map((e) => ({ evidence_id: e.target, party_index: e.edge.entry.party_index as number })),
    };
  });
}

/** Tài sản theo thứ tự S3 (asset-1, asset-2…). */
export function listAssets(g: DossierGraph): AssetView[] {
  return nodesOf(g, 'asset').map(({ id, node }) => {
    const a = node as AssetNode;
    return {
      asset_id: id,
      asset_type: a.attrs.asset_type,
      identifiers: a.attrs.identifiers,
      usage_contexts: a.attrs.usage_contexts as string[],
      sources: outEdges(g, id, 'MENTIONED_IN').sort((x, y) => x.edge.seq - y.edge.seq)
        .map((e) => ({ evidence_id: e.target, asset_index: e.edge.entry.asset_index as number })),
    };
  });
}

/** Evidence bị thay thế (S3-R27). */
export function supersededEvidenceIds(g: DossierGraph): Set<string> {
  const out = new Set<string>();
  g.forEachNode((id, attrs) => {
    if (attrs.kind === 'evidence' && (attrs as EvidenceNode).superseded !== null) out.add(id);
  });
  return out;
}
