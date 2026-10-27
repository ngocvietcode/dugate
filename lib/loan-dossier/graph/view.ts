// Chiếu DossierGraph (graphology, nội bộ) → DossierGraphView (JSON ổn định, không PII) để lưu vào kết quả và vẽ trên UI.
// Thuần, tất định (thứ tự node theo seq của S3, cạnh theo thứ tự cố định), không log.
import { inEdges, nodesOf, outEdges } from './project';
import type { AssetNode, DossierGraph, EvidenceNode, PersonNode, UnmappedNode } from './types';
import type { DossierGraphView, GraphEdge, GraphNode } from './view-contract';
import { DOSSIER_GRAPH_VERSION } from './view-contract';

const LOW_MATCH_CONFIDENCE = 0.8;

export function toDossierGraphView(g: DossierGraph): DossierGraphView {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  // Chứng từ chỉ xuất hiện khi có cạnh tới người / tài sản / party chưa gắn; node evidence lấy sau cùng theo thứ tự id.
  const evidenceUsed = new Set<string>();

  for (const { id, node } of nodesOf(g, 'person')) {
    const p = node as PersonNode;
    const flags: string[] = [];
    if (p.registry.role_conflict) flags.push('ROLE_CONFLICT');
    if (p.registry.id_number_check.requires_review) flags.push('ID_REVIEW');
    nodes.push({ id, kind: 'person', type: p.registry.primary_role, roles: [...p.roles], ...(p.organization ? { org: true as const } : {}), ...(flags.length ? { flags } : {}) });
  }
  for (const { id, node } of nodesOf(g, 'asset')) {
    const a = (node as AssetNode).attrs;
    const flags: string[] = [];
    if (a.context_status !== 'CONFIRMED') flags.push(a.context_status);
    if ((a.identifier_conflicts as Array<{ probable_ocr_error?: boolean }>).some((c) => c.probable_ocr_error !== true)) flags.push('IDENTIFIER_CONFLICT');
    nodes.push({ id, kind: 'asset', type: a.asset_type, ...(flags.length ? { flags } : {}) });
  }

  // Cạnh người/tài sản → chứng từ
  for (const { id } of [...nodesOf(g, 'person'), ...nodesOf(g, 'asset')]) {
    for (const { target, edge } of outEdges(g, id, 'MENTIONED_IN').sort((a, b) => a.edge.seq - b.edge.seq)) {
      evidenceUsed.add(target);
      const e = edge.entry;
      const by = typeof e.matched_by === 'string' ? e.matched_by : typeof e.link === 'string' ? e.link : undefined;
      const warnings = Array.isArray(e.warnings) ? (e.warnings as string[]) : [];
      const low = typeof e.match_confidence === 'number' && e.match_confidence < LOW_MATCH_CONFIDENCE;
      const weak = e.link === 'APPROXIMATE' || e.link === 'WEAK';
      const warning = warnings.length > 0 || low || weak;
      edges.push({ id: `MENTIONED_IN:${id}>${target}:${edge.seq}`, source: id, target, type: 'MENTIONED_IN', ...(by && by !== 'ANCHOR' && by !== 'SEED' ? { label: by } : {}), ...(warning ? { warning: true } : {}) });
    }
  }

  // Sở hữu
  for (const { id } of nodesOf(g, 'asset')) {
    const pSeq = (pid: string) => (g.getNodeAttributes(pid) as PersonNode).seq;
    for (const { source, edge } of inEdges(g, id, 'OWNS').sort((x, y) => pSeq(x.source) - pSeq(y.source))) {
      edges.push({ id: `OWNS:${source}>${id}`, source, target: id, type: 'OWNS', label: edge.currentSeq !== null ? 'current' : 'former' });
    }
  }

  // Vợ/chồng: một cạnh cho mỗi cặp
  const seenSpouse = new Set<string>();
  for (const { id } of nodesOf(g, 'person')) {
    for (const { target } of outEdges(g, id, 'SPOUSE_OF')) {
      const key = [id, target].sort().join('|');
      if (seenSpouse.has(key)) continue;
      seenSpouse.add(key);
      edges.push({ id: `SPOUSE_OF:${key}`, source: id, target, type: 'SPOUSE_OF' });
    }
  }

  // Người đại diện theo pháp luật → pháp nhân
  for (const { id } of nodesOf(g, 'person')) {
    for (const { source } of inEdges(g, id, 'LEGAL_REP_OF')) {
      edges.push({ id: `LEGAL_REP_OF:${source}>${id}`, source, target: id, type: 'LEGAL_REP_OF' });
    }
  }

  // Nhân thân chủ TSBĐ ↔ khách vay
  const relatives: Array<{ seq: number; edge: GraphEdge }> = [];
  g.forEachEdge((_k, attrs, source, target) => {
    if (attrs.type !== 'RELATIVE_OF') return;
    const d = attrs.detail;
    const unverified = d.required_count !== null && d.verified_count < d.required_count;
    relatives.push({ seq: attrs.seq, edge: { id: `RELATIVE_OF:${attrs.seq}`, source, target, type: 'RELATIVE_OF', label: d.relationship_type ?? 'UNKNOWN', ...(unverified ? { warning: true } : {}) } });
  });
  edges.push(...relatives.sort((a, b) => a.seq - b.seq).map((r) => r.edge));

  // Bản bị thay thế
  const supersededIds: string[] = [];
  g.forEachNode((id, attrs) => {
    if (attrs.kind === 'evidence' && (attrs as EvidenceNode).superseded) supersededIds.push(id);
  });
  for (const id of supersededIds) {
    evidenceUsed.add(id);
    for (const { target, edge } of outEdges(g, id, 'SUPERSEDED_BY').sort((a, b) => a.edge.seq - b.edge.seq)) {
      evidenceUsed.add(target);
      edges.push({ id: `SUPERSEDED_BY:${id}>${target}`, source: id, target, type: 'SUPERSEDED_BY' });
      void edge;
    }
  }

  // Party chưa gắn được người
  for (const { id, node } of nodesOf(g, 'unmapped')) {
    const u = node as UnmappedNode;
    nodes.push({ id, kind: 'unmapped', type: u.entry.reason_code, flags: ['UNMAPPED'] });
    for (const { target } of outEdges(g, id, 'UNMAPPED_IN')) {
      evidenceUsed.add(target);
      edges.push({ id: `UNMAPPED_IN:${id}>${target}`, source: id, target, type: 'UNMAPPED_IN', warning: true });
    }
  }

  // Node chứng từ (id ev-…, type = doc_type_key suy từ cạnh nguồn)
  const docTypeOf = new Map<string, string>();
  g.forEachEdge((_k, attrs, _s, target) => {
    if (attrs.type === 'MENTIONED_IN' && typeof attrs.entry.doc_type_key === 'string') docTypeOf.set(target, attrs.entry.doc_type_key);
  });
  g.forEachNode((id, attrs) => {
    if (attrs.kind === 'evidence' && (attrs as EvidenceNode).superseded) docTypeOf.set(id, (attrs as EvidenceNode).superseded!.doc_type_key);
  });
  g.forEachNode((id, attrs) => {
    if (attrs.kind !== 'evidence' || !evidenceUsed.has(id)) return;
    const superseded = (attrs as EvidenceNode).superseded !== null;
    nodes.push({ id, kind: 'evidence', type: docTypeOf.get(id) ?? 'unknown', ...(superseded ? { flags: ['SUPERSEDED'] } : {}) });
  });

  return { version: DOSSIER_GRAPH_VERSION, nodes, edges };
}
