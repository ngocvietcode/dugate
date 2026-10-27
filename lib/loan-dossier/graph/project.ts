// Hình chiếu: sinh lại các khối output của S3 từ DossierGraph. Mỗi hàm thuần và giữ đúng thứ tự phần tử lẫn thứ tự
// khóa của S3 hiện tại, nên có thể thay thế dần mà không đổi hợp đồng (xem tests/loan-dossier/graph-project.test.ts).
import type { MapDossierData } from '../contracts/check-stages';
import { clone } from './build';
import type { AssetNode, DossierGraph, DossierNode, EvidenceNode, PersonNode, UnmappedNode } from './types';

type Seq = PersonNode | AssetNode | UnmappedNode;

/** Node theo loại, sắp theo `seq` (thứ tự mảng gốc). */
export function nodesOf(g: DossierGraph, kind: Seq['kind']): Array<{ id: string; node: Seq }> {
  const out: Array<{ id: string; node: Seq }> = [];
  g.forEachNode((id, attrs: DossierNode) => {
    if (attrs.kind === kind) out.push({ id, node: attrs as Seq });
  });
  return out.sort((a, b) => a.node.seq - b.node.seq);
}

/** Cạnh ra của node theo loại, trả `[đích, thuộc tính]`. */
export function outEdges<T extends string>(g: DossierGraph, id: string, type: T): Array<{ target: string; edge: Extract<ReturnType<DossierGraph['getEdgeAttributes']>, { type: T }> }> {
  const out: Array<{ target: string; edge: Extract<ReturnType<DossierGraph['getEdgeAttributes']>, { type: T }> }> = [];
  g.forEachOutEdge(id, (_k, attrs, _s, target) => {
    if (attrs.type === type) out.push({ target, edge: attrs as never });
  });
  return out;
}

export function inEdges<T extends string>(g: DossierGraph, id: string, type: T): Array<{ source: string; edge: Extract<ReturnType<DossierGraph['getEdgeAttributes']>, { type: T }> }> {
  const out: Array<{ source: string; edge: Extract<ReturnType<DossierGraph['getEdgeAttributes']>, { type: T }> }> = [];
  g.forEachInEdge(id, (_k, attrs, source) => {
    if (attrs.type === type) out.push({ source, edge: attrs as never });
  });
  return out;
}

export function projectRoleRegistry(g: DossierGraph): MapDossierData['role_registry'] {
  return nodesOf(g, 'person').map(({ id, node }) => ({
    person_id: id,
    roles: clone((node as PersonNode).roles),
    ...clone((node as PersonNode).registry),
    mapped_evidences: outEdges(g, id, 'MENTIONED_IN').sort((a, b) => a.edge.seq - b.edge.seq).map((e) => clone(e.edge.entry)),
  })) as MapDossierData['role_registry'];
}

export function projectCustomer360(g: DossierGraph): MapDossierData['customer_360'] {
  return nodesOf(g, 'person').map(({ id, node }) => {
    const p = node as PersonNode;
    const spouse = outEdges(g, id, 'SPOUSE_OF')[0]?.target ?? null;
    const owned = outEdges(g, id, 'OWNS')
      .filter((e) => e.edge.currentSeq !== null)
      .map((e) => ({ id: e.target, seq: (g.getNodeAttributes(e.target) as AssetNode).seq }))
      .sort((a, b) => a.seq - b.seq)
      .map((a) => a.id);
    // Khóa `organization` chỉ có ở pháp nhân (đúng như S3) nên output của HKD không đổi. Thứ tự khóa: attrs rồi representative_person_id.
    const rep = inEdges(g, id, 'LEGAL_REP_OF')[0]?.source ?? null;
    const organization = p.organization ? { ...clone(p.organization), representative_person_id: rep } : null;
    return {
      person_id: id,
      roles: clone(p.roles),
      identity: clone(p.identity),
      marital_status: p.marital_status,
      spouse_person_id: spouse,
      business: clone(p.business),
      owned_asset_ids: owned,
      ...(organization ? { organization } : {}),
    };
  }) as MapDossierData['customer_360'];
}

export function projectAssetRegistry(g: DossierGraph): MapDossierData['asset_registry'] {
  const personSeq = (pid: string) => (g.getNodeAttributes(pid) as PersonNode).seq;
  return nodesOf(g, 'asset').map(({ id, node }) => {
    const a = node as AssetNode;
    const owners = inEdges(g, id, 'OWNS');
    const ordered = (field: 'ownerSeq' | 'currentSeq') => owners
      .filter((e) => e.edge[field] !== null)
      .sort((x, y) => (x.edge[field] as number) - (y.edge[field] as number) || personSeq(x.source) - personSeq(y.source))
      .map((e) => e.source);
    return {
      asset_id: id,
      asset_type: a.attrs.asset_type,
      identifiers: clone(a.attrs.identifiers),
      owner_person_ids: ordered('ownerSeq'),
      current_owner_person_ids: ordered('currentSeq'),
      usage_contexts: clone(a.attrs.usage_contexts),
      context_status: a.attrs.context_status,
      context_reason_code: a.attrs.context_reason_code,
      sources: outEdges(g, id, 'MENTIONED_IN').sort((x, y) => x.edge.seq - y.edge.seq).map((e) => clone(e.edge.entry)),
      identifier_conflicts: clone(a.attrs.identifier_conflicts),
    };
  }) as MapDossierData['asset_registry'];
}

export function projectRelationshipVerifications(g: DossierGraph): MapDossierData['relationship_verifications'] {
  const out: Array<{ seq: number; value: unknown }> = [];
  g.forEachEdge((_k, attrs, source, target) => {
    if (attrs.type !== 'RELATIVE_OF') return;
    out.push({ seq: attrs.seq, value: { subject_person_id: source, collateral_owner_person_id: target, ...clone(attrs.detail) } });
  });
  return out.sort((a, b) => a.seq - b.seq).map((x) => x.value) as MapDossierData['relationship_verifications'];
}

export function projectSuperseded(g: DossierGraph): MapDossierData['superseded_evidences'] {
  const out: Array<{ seq: number; value: unknown }> = [];
  g.forEachNode((id, attrs) => {
    if (attrs.kind !== 'evidence') return;
    const s = (attrs as EvidenceNode).superseded;
    if (!s) return;
    const by = outEdges(g, id, 'SUPERSEDED_BY').sort((a, b) => a.edge.seq - b.edge.seq).map((e) => e.target);
    out.push({
      seq: s.seq,
      value: {
        evidence_id: id, doc_type_key: s.doc_type_key, person_id: s.person_id, asset_id: s.asset_id,
        issue_date: s.issue_date, superseded_by_evidence_ids: by, reason_code: s.reason_code,
      },
    });
  });
  return out.sort((a, b) => a.seq - b.seq).map((x) => x.value) as MapDossierData['superseded_evidences'];
}

export function projectUnmapped(g: DossierGraph): MapDossierData['unmapped_evidences'] {
  return nodesOf(g, 'unmapped').map(({ id, node }) => {
    const evidence = outEdges(g, id, 'UNMAPPED_IN')[0]?.target;
    if (!evidence) throw new Error(`${id}: thiếu cạnh UNMAPPED_IN`);
    return { evidence_id: evidence, ...clone((node as UnmappedNode).entry) };
  }) as MapDossierData['unmapped_evidences'];
}

/** Toàn bộ `MapDossierData` dựng lại từ graph. */
export function projectMapDossierData(g: DossierGraph): MapDossierData {
  return {
    role_registry: projectRoleRegistry(g),
    unmapped_evidences: projectUnmapped(g),
    asset_registry: projectAssetRegistry(g),
    relationship_verifications: projectRelationshipVerifications(g),
    customer_360: projectCustomer360(g),
    superseded_evidences: projectSuperseded(g),
  };
}
