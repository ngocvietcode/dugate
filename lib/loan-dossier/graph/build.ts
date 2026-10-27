// Dựng DossierGraph từ output S3 (`MapDossierData`). Thuần, tất định, không gọi LLM, không log PII:
// lỗi chỉ nêu id (person-n / asset-n / ev-…), không nêu tên hay số định danh.
import { MultiDirectedGraph } from 'graphology';

import type { MapDossierData } from '../contracts/check-stages';
import type { DossierEdge, DossierGraph, DossierNode, OwnsEdge } from './types';

/** Dữ liệu S3 là JSON thuần; sao chép để graph không dùng chung tham chiếu với output. */
export const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function evidenceIdOf(entry: Record<string, unknown>, where: string): string {
  const id = entry.evidence_id;
  if (typeof id !== 'string' || id.length === 0) throw new Error(`${where}: thiếu evidence_id`);
  return id;
}

export function buildDossierGraph(data: MapDossierData): DossierGraph {
  const g: DossierGraph = new MultiDirectedGraph<DossierNode, DossierEdge>();

  const ensureEvidence = (id: string): void => {
    if (!g.hasNode(id)) g.addNode(id, { kind: 'evidence', superseded: null });
  };
  const needPerson = (id: string, where: string): void => {
    if (!g.hasNode(id) || g.getNodeAttribute(id, 'kind') !== 'person') throw new Error(`${where}: ${id} không có trong role_registry`);
  };
  const needAsset = (id: string, where: string): void => {
    if (!g.hasNode(id) || g.getNodeAttribute(id, 'kind') !== 'asset') throw new Error(`${where}: ${id} không có trong asset_registry`);
  };

  // ── Người: role_registry + customer_360 gộp thành một node ──
  const c360 = new Map(data.customer_360.map((c) => [c.person_id, c]));
  if (c360.size !== data.role_registry.length) throw new Error('customer_360 không cùng tập person_id với role_registry');
  data.role_registry.forEach((p, seq) => {
    const c = c360.get(p.person_id);
    if (!c) throw new Error(`customer_360 thiếu ${p.person_id}`);
    const { person_id, roles, mapped_evidences: _mapped, ...registry } = p;
    const { representative_person_id: _rep, ...orgAttrs } = c.organization ?? { representative_person_id: null };
    g.addNode(person_id, {
      kind: 'person', seq, roles: clone(roles), registry: clone(registry),
      identity: clone(c.identity), marital_status: c.marital_status, business: clone(c.business),
      organization: c.organization ? clone(orgAttrs as NonNullable<typeof c.organization>) : null,
    });
  });

  // ── Tài sản ──
  data.asset_registry.forEach((a, seq) => {
    const { asset_id, owner_person_ids: _o, current_owner_person_ids: _c, sources: _s, ...attrs } = a;
    g.addNode(asset_id, { kind: 'asset', seq, attrs: clone(attrs) });
  });

  // ── Chứng từ nguồn của người / tài sản ──
  data.role_registry.forEach((p) => {
    p.mapped_evidences.forEach((entry, seq) => {
      const ev = evidenceIdOf(entry, `mapped_evidences của ${p.person_id}`);
      ensureEvidence(ev);
      g.addDirectedEdgeWithKey(`MENTIONED_IN:${p.person_id}>${ev}:${seq}`, p.person_id, ev, { type: 'MENTIONED_IN', seq, entry: clone(entry) });
    });
  });
  data.asset_registry.forEach((a) => {
    a.sources.forEach((entry, seq) => {
      const ev = evidenceIdOf(entry, `sources của ${a.asset_id}`);
      ensureEvidence(ev);
      g.addDirectedEdgeWithKey(`MENTIONED_IN:${a.asset_id}>${ev}:${seq}`, a.asset_id, ev, { type: 'MENTIONED_IN', seq, entry: clone(entry) });
    });
  });

  // ── Sở hữu: một cạnh mỗi cặp (người, tài sản) ──
  const owns = (personId: string, assetId: string, field: 'ownerSeq' | 'currentSeq', seq: number): void => {
    needPerson(personId, `asset_registry[${assetId}]`);
    const key = `OWNS:${personId}>${assetId}`;
    const prev = g.hasEdge(key) ? (g.getEdgeAttributes(key) as OwnsEdge) : { type: 'OWNS' as const, ownerSeq: null, currentSeq: null };
    const next: OwnsEdge = { ...prev, [field]: seq };
    if (g.hasEdge(key)) g.replaceEdgeAttributes(key, next);
    else g.addDirectedEdgeWithKey(key, personId, assetId, next);
  };
  data.asset_registry.forEach((a) => {
    a.owner_person_ids.forEach((pid, i) => owns(pid, a.asset_id, 'ownerSeq', i));
    a.current_owner_person_ids.forEach((pid, i) => owns(pid, a.asset_id, 'currentSeq', i));
  });

  // ── Vợ/chồng ──
  data.customer_360.forEach((c) => {
    if (c.spouse_person_id === null) return;
    needPerson(c.spouse_person_id, `customer_360[${c.person_id}].spouse_person_id`);
    g.addDirectedEdgeWithKey(`SPOUSE_OF:${c.person_id}>${c.spouse_person_id}`, c.person_id, c.spouse_person_id, { type: 'SPOUSE_OF' });
  });

  // ── Người đại diện theo pháp luật → pháp nhân ──
  data.customer_360.forEach((c) => {
    const rep = c.organization?.representative_person_id ?? null;
    if (rep === null) return;
    needPerson(rep, `customer_360[${c.person_id}].organization.representative_person_id`);
    g.addDirectedEdgeWithKey(`LEGAL_REP_OF:${rep}>${c.person_id}`, rep, c.person_id, { type: 'LEGAL_REP_OF' });
  });

  // ── Nhân thân chủ TSBĐ ↔ khách vay ──
  data.relationship_verifications.forEach((r, seq) => {
    const { subject_person_id, collateral_owner_person_id, ...detail } = r;
    needPerson(subject_person_id, `relationship_verifications[${seq}]`);
    needPerson(collateral_owner_person_id, `relationship_verifications[${seq}]`);
    g.addDirectedEdgeWithKey(`RELATIVE_OF:${seq}`, subject_person_id, collateral_owner_person_id, { type: 'RELATIVE_OF', seq, detail: clone(detail) });
  });

  // ── Bản bị thay thế ──
  data.superseded_evidences.forEach((s, seq) => {
    const { evidence_id, superseded_by_evidence_ids, ...rest } = s;
    if (s.person_id !== null) needPerson(s.person_id, `superseded_evidences[${seq}]`);
    if (s.asset_id !== null) needAsset(s.asset_id, `superseded_evidences[${seq}]`);
    ensureEvidence(evidence_id);
    g.replaceNodeAttributes(evidence_id, { kind: 'evidence', superseded: clone({ ...rest, seq }) });
    superseded_by_evidence_ids.forEach((by, i) => {
      ensureEvidence(by);
      g.addDirectedEdgeWithKey(`SUPERSEDED_BY:${evidence_id}>${by}`, evidence_id, by, { type: 'SUPERSEDED_BY', seq: i });
    });
  });

  // ── Party chưa ghép được ──
  data.unmapped_evidences.forEach((u, seq) => {
    const { evidence_id, ...entry } = u;
    ensureEvidence(evidence_id);
    const key = `unmapped-${seq + 1}`;
    g.addNode(key, { kind: 'unmapped', seq, entry: clone(entry) });
    g.addDirectedEdgeWithKey(`UNMAPPED_IN:${key}>${evidence_id}`, key, evidence_id, { type: 'UNMAPPED_IN' });
  });

  return g;
}
