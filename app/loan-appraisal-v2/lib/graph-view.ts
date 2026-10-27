// Bố cục và nhãn cho sơ đồ quan hệ hồ sơ (thuần, không phụ thuộc React để test được).
// Bố cục CỐ ĐỊNH theo cột, không dùng thuật toán đồ thị: NGƯỜI | TÀI SẢN | CHỨNG TỪ. Vị trí chỉ phụ thuộc loại node và thứ tự S3
// (person-1, person-2…), nên ổn định giữa các lần chạy và không đổi khi bật / tắt lớp chứng từ. Người được xếp theo nhóm vai trò.
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { DossierGraphView, GraphEdge, GraphNode } from '@/lib/loan-dossier/graph/view-contract';

export const NODE_W = 232;
export const NODE_H = 76;
export const COL_GAP = 150;
export const ROW_GAP = 18;
export const HEADER_H = 34;
export const PAD = 16;

export type ColumnId = 'person' | 'asset' | 'evidence';

export const ROLE_LABELS: Record<string, string> = { borrower: 'Khách hàng vay', co_borrower: 'Đồng vay', collateral_owner: 'Chủ TSBĐ', other: 'Liên quan' };
export const ROLE_ORDER = ['borrower', 'co_borrower', 'collateral_owner', 'other'];
export const ASSET_LABELS: Record<string, string> = { real_estate: 'Bất động sản', apartment: 'Căn hộ', vehicle: 'Xe', deposit: 'Tiền gửi', other: 'Tài sản khác' };
export const COLUMN_LABELS: Record<ColumnId, string> = { person: 'Người', asset: 'Tài sản', evidence: 'Chứng từ nguồn' };
export const EDGE_LABELS: Record<string, string> = {
  MENTIONED_IN: 'có trong', OWNS: 'sở hữu', SPOUSE_OF: 'vợ/chồng', RELATIVE_OF: 'nhân thân', LEGAL_REP_OF: 'đại diện pháp luật', SUPERSEDED_BY: 'bị thay bởi', UNMAPPED_IN: 'chưa gắn được',
};
export const REL_LABELS: Record<string, string> = { PARENT_CHILD: 'cha/mẹ - con', SIBLING: 'anh/chị/em', SPOUSE: 'vợ/chồng', OTHER: 'khác', UNKNOWN: 'chưa phân loại' };
export const MATCH_LABELS: Record<string, string> = { ID_NUMBER: 'khớp số định danh', FULL_NAME: 'khớp theo tên', APPROXIMATE: 'gần đúng', WEAK: 'nối yếu' };
export const FLAG_LABELS: Record<string, string> = {
  ROLE_CONFLICT: 'xung đột vai trò', ID_REVIEW: 'số định danh cần rà soát', AMBIGUOUS: 'chưa rõ ngữ cảnh', UNRESOLVED: 'chưa xác định mục đích',
  IDENTIFIER_CONFLICT: 'mâu thuẫn định danh', SUPERSEDED: 'đã bị thay thế', UNMAPPED: 'chưa gắn được người',
};

/** Thông tin hiển thị thêm của node, tra từ ngoài graph (graph không chứa PII). */
export interface NodeFacts {
  /** Tên người / số định danh rút gọn / chủ sở hữu… dạng dòng phụ. */
  name?: string;
  detail?: string;
}

export interface NodeCard { title: string; subtitle: string; detail: string }

export function columnOf(node: GraphNode): ColumnId {
  if (node.kind === 'asset') return 'asset';
  if (node.kind === 'evidence') return 'evidence';
  return 'person'; // person + unmapped cùng cột người
}

export function labelFor(node: GraphNode, facts: ReadonlyMap<string, NodeFacts>, docLabels: ReadonlyMap<string, string>): NodeCard {
  const f = facts.get(node.id);
  switch (node.kind) {
    case 'person': return {
      title: f?.name ?? node.id,
      subtitle: [node.org ? 'Doanh nghiệp' : null, (node.roles ?? []).map((r) => ROLE_LABELS[r] ?? r).join(' · ') || node.id].filter(Boolean).join(' · '),
      detail: f?.detail ?? node.id,
    };
    case 'asset': return { title: ASSET_LABELS[node.type] ?? node.type, subtitle: node.id, detail: f?.detail ?? '' };
    case 'evidence': return { title: docLabels.get(node.type) ?? node.type, subtitle: 'Chứng từ', detail: '' };
    case 'unmapped': return { title: 'Chưa gắn được người', subtitle: node.type, detail: '' };
  }
}

export function edgeLabel(edge: GraphEdge): string {
  const base = EDGE_LABELS[edge.type] ?? edge.type;
  if (edge.type === 'RELATIVE_OF') return `${base}: ${REL_LABELS[edge.label ?? 'UNKNOWN'] ?? edge.label}`;
  if (edge.type === 'OWNS') return edge.label === 'former' ? 'từng đứng tên' : 'chủ hiện tại';
  if (edge.type === 'MENTIONED_IN' && edge.label) return MATCH_LABELS[edge.label] ?? edge.label;
  return base;
}

/** Cạnh hiện nhãn trên sơ đồ: chỉ cạnh mang thông tin riêng (không phải mọi cạnh), tránh nhãn chồng nhau. Cạnh còn lại xem ở bảng chi tiết. */
export function showsLabelOnCanvas(edge: GraphEdge): boolean {
  return edge.type === 'OWNS' || edge.type === 'LEGAL_REP_OF' || edge.type === 'SPOUSE_OF' || edge.type === 'RELATIVE_OF' || edge.warning === true;
}

export interface Visibility { evidence: boolean; unmapped: boolean }

/** Lọc theo lớp đang bật; bỏ cạnh trỏ tới node bị ẩn. */
export function filterGraph(graph: DossierGraphView, show: Visibility): DossierGraphView {
  const visible = new Set(graph.nodes.filter((n) => (n.kind === 'evidence' ? show.evidence : n.kind === 'unmapped' ? show.unmapped : true)).map((n) => n.id));
  return { ...graph, nodes: graph.nodes.filter((n) => visible.has(n.id)), edges: graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target)) };
}

export interface PlacedNode { id: string; column: ColumnId; x: number; y: number; group: string | null }
export interface ColumnBox { id: ColumnId; x: number; y: number; w: number; h: number; count: number }
export interface GroupLabel { column: ColumnId; label: string; x: number; y: number }
export interface Layout { nodes: PlacedNode[]; columns: ColumnBox[]; groups: GroupLabel[]; width: number; height: number }

const GROUP_H = 22;

/** Nhóm của người: theo vai trò chính; party chưa gắn ở cuối cột. */
function personGroup(node: GraphNode): string {
  if (node.kind === 'unmapped') return 'unmapped';
  return ROLE_ORDER.includes(node.type) ? node.type : 'other';
}

/**
 * Bố cục theo cột. Cột trống bị bỏ, các cột còn lại dồn sát nhau. Trong cột người, node xếp theo nhóm vai trò rồi thứ tự S3.
 * Tất định theo thứ tự node đầu vào.
 */
export function layoutColumns(graph: DossierGraphView): Layout {
  const byCol: Record<ColumnId, GraphNode[]> = { person: [], asset: [], evidence: [] };
  for (const n of graph.nodes) byCol[columnOf(n)].push(n);
  const present = (['person', 'asset', 'evidence'] as ColumnId[]).filter((c) => byCol[c].length > 0);

  const nodes: PlacedNode[] = [];
  const groups: GroupLabel[] = [];
  const columns: ColumnBox[] = [];
  let maxBottom = 0;

  present.forEach((col, ci) => {
    const x = PAD + ci * (NODE_W + COL_GAP);
    let y = PAD + HEADER_H;
    let ordered = byCol[col];
    if (col === 'person') {
      const rank = (n: GraphNode) => { const g = personGroup(n); return g === 'unmapped' ? 99 : ROLE_ORDER.indexOf(g); };
      // sort ổn định: cùng nhóm giữ thứ tự S3
      ordered = byCol.person.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((e) => e.n);
    }
    let lastGroup: string | null = null;
    for (const n of ordered) {
      const group = col === 'person' ? personGroup(n) : null;
      if (col === 'person' && group !== lastGroup) {
        groups.push({ column: col, label: group === 'unmapped' ? 'Chưa gắn được người' : ROLE_LABELS[group!] ?? group!, x, y });
        y += GROUP_H;
        lastGroup = group;
      }
      nodes.push({ id: n.id, column: col, x, y, group });
      y += NODE_H + ROW_GAP;
    }
    maxBottom = Math.max(maxBottom, y);
    columns.push({ id: col, x: x - 8, y: PAD, w: NODE_W + 16, h: 0, count: ordered.length });
  });

  const height = Math.max(maxBottom - ROW_GAP + PAD, PAD * 2 + HEADER_H + NODE_H);
  for (const c of columns) c.h = height - PAD * 2;
  const width = PAD * 2 + present.length * NODE_W + Math.max(0, present.length - 1) * COL_GAP;
  return { nodes, columns, groups, width, height };
}

export function countByKind(graph: DossierGraphView): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of graph.nodes) out[n.kind] = (out[n.kind] ?? 0) + 1;
  return out;
}

/** "001090000001" → "••••0001": thẻ trên sơ đồ chỉ cần nhận ra người, không cần lộ đủ số (bảng người & tài sản đã có đủ). */
export function maskId(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\s+/g, '');
  if (!digits) return null;
  return digits.length <= 4 ? digits : `••••${digits.slice(-4)}`;
}

const ASSET_KEY_FIELDS: Array<[string, string]> = [
  ['certificate_number', 'GCN'], ['license_plate', 'Biển số'], ['chassis_number', 'Số khung'], ['registration_number', 'Số ĐK'], ['apartment_number', 'Căn hộ'],
];

/**
 * Thông tin hiển thị của node, tra từ `customer_360` (graph chỉ giữ id). Người: tên + số định danh che; tài sản: một định danh chính
 * (GCN hoặc biển số…) hoặc thửa/tờ.
 */
export function buildNodeFacts(map: MapDossierData | null | undefined): Map<string, NodeFacts> {
  const out = new Map<string, NodeFacts>();
  if (!map) return out;
  for (const c of map.customer_360) {
    const reg = map.role_registry.find((p) => p.person_id === c.person_id);
    if (c.organization) {
      // Pháp nhân: nhận diện bằng mã số thuế (che bớt như số định danh), không dùng số định danh cá nhân.
      const tax = maskId(c.organization.tax_id ?? c.organization.registration_number);
      out.set(c.person_id, { name: c.identity.full_name?.trim() || c.person_id, detail: tax ? `MST ${tax}` : 'Chưa có mã số thuế' });
      continue;
    }
    const id = maskId(c.identity.id_number ?? reg?.current_id_number ?? reg?.declared_id_number);
    out.set(c.person_id, { name: c.identity.full_name?.trim() || c.person_id, detail: id ? `ĐD ${id}` : 'Chưa có số định danh' });
  }
  for (const a of map.asset_registry) {
    const ids = a.identifiers as Record<string, string | null>;
    const hit = ASSET_KEY_FIELDS.find(([k]) => ids[k]);
    const parcel = [ids.land_parcel_number, ids.map_sheet_number].filter(Boolean).join('/');
    out.set(a.asset_id, { detail: hit ? `${hit[1]} ${ids[hit[0]]}` : parcel ? `Thửa/tờ ${parcel}` : 'Chưa có định danh' });
  }
  return out;
}
