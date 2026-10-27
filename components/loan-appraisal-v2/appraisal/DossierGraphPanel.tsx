'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Building2, FileText, Home, Network, Users, UserRound, UserX } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { docTypeLabelOf } from '@/app/loan-appraisal-v2/lib/classification-view';
import {
  COLUMN_LABELS, FLAG_LABELS, HEADER_H, NODE_H, NODE_W, buildNodeFacts, countByKind, edgeLabel, filterGraph, labelFor, layoutColumns,
  showsLabelOnCanvas, type ColumnId, type NodeCard, type NodeFacts,
} from '@/app/loan-appraisal-v2/lib/graph-view';
import type { DossierGraphView, GraphEdge, GraphNode } from '@/lib/loan-dossier/graph/view-contract';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';

// Màu lấy từ token của app và biến --la2-* (đổi theo dark mode). React Flow có biến --xy-* riêng nên ghi đè ở khung bao bên dưới.
const RGB = { info: 'rgb(var(--la2-info))', success: 'rgb(var(--la2-success))', warning: 'rgb(var(--la2-warning))', muted: 'rgb(var(--muted-foreground))', border: 'rgb(var(--border))' };

const KIND: Record<GraphNode['kind'], { icon: typeof UserRound; accent: string }> = {
  person: { icon: UserRound, accent: RGB.info },
  asset: { icon: Home, accent: RGB.success },
  evidence: { icon: FileText, accent: RGB.muted },
  unmapped: { icon: UserX, accent: RGB.warning },
};

/** Biến CSS của React Flow trỏ về token của app: nền, nút điều khiển, nhãn cạnh, tay nắm đều theo theme sáng / tối. */
const FLOW_THEME = {
  '--xy-background-color': 'rgb(var(--card))',
  '--xy-background-pattern-color': 'rgb(var(--border))',
  '--xy-node-background-color': 'rgb(var(--card))',
  '--xy-node-color': 'rgb(var(--foreground))',
  '--xy-edge-label-background-color': 'rgb(var(--card))',
  '--xy-edge-label-color': 'rgb(var(--foreground))',
  '--xy-handle-background-color': 'rgb(var(--muted-foreground))',
  '--xy-handle-border-color': 'rgb(var(--card))',
  '--xy-controls-button-background-color': 'rgb(var(--card))',
  '--xy-controls-button-background-color-hover': 'rgb(var(--muted))',
  '--xy-controls-button-color': 'rgb(var(--foreground))',
  '--xy-controls-button-border-color': 'rgb(var(--border))',
  '--xy-edge-stroke': 'rgb(var(--muted-foreground))',
} as React.CSSProperties;

interface CardData extends Record<string, unknown> { node: GraphNode; card: NodeCard; selected: boolean; dim: boolean }
interface ColumnData extends Record<string, unknown> { id: ColumnId; label: string; count: number; w: number; h: number }
interface GroupData extends Record<string, unknown> { label: string }

/** Thẻ node: dải màu theo loại, icon, tên, dòng vai trò, dòng định danh; cờ cảnh báo có chữ. */
const DossierCard = memo(function DossierCard({ data }: NodeProps<Node<CardData>>) {
  const { node, card, selected, dim } = data;
  // Doanh nghiệp dùng icon tòa nhà để phân biệt với cá nhân ngay trên thẻ (không chỉ dựa vào màu).
  const { icon: kindIcon, accent } = KIND[node.kind];
  const Icon = node.kind === 'person' && node.org ? Building2 : kindIcon;
  const flags = node.flags ?? [];
  return (
    <div
      style={{ width: NODE_W, height: NODE_H, borderLeftColor: accent, opacity: dim ? 0.35 : 1 }}
      className={`flex flex-col justify-center rounded-lg border border-l-4 border-border bg-card px-3 py-2 shadow-sm transition-shadow ${selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'}`}
    >
      <Handle id="l" type="target" position={Position.Left} className="!h-2 !w-2 !border-card" />
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-foreground" title={card.title}>{card.title}</p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground" title={card.subtitle}>{card.subtitle}</p>
        </div>
      </div>
      {(card.detail || flags.length > 0) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={card.detail}>{card.detail}</p>
          {flags.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: RGB.warning, background: 'color-mix(in srgb, rgb(var(--la2-warning)) 14%, transparent)' }}>
              <AlertTriangle className="h-3 w-3" aria-hidden />{FLAG_LABELS[flags[0]] ?? flags[0]}{flags.length > 1 ? ` +${flags.length - 1}` : ''}
            </span>
          )}
        </div>
      )}
      <Handle id="r" type="source" position={Position.Right} className="!h-2 !w-2 !border-card" />
    </div>
  );
});

/** Nền cột + tiêu đề cột: không tương tác, nằm dưới các thẻ. */
const ColumnBackdrop = memo(function ColumnBackdrop({ data }: NodeProps<Node<ColumnData>>) {
  return (
    <div style={{ width: data.w, height: data.h }} className="pointer-events-none rounded-xl border border-dashed border-border bg-muted/30">
      <p style={{ height: HEADER_H }} className="flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {data.id === 'person' ? <Users className="h-3.5 w-3.5" aria-hidden /> : data.id === 'asset' ? <Home className="h-3.5 w-3.5" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
        {data.label}<span className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums">{data.count}</span>
      </p>
    </div>
  );
});

const GroupTag = memo(function GroupTag({ data }: NodeProps<Node<GroupData>>) {
  return <p className="pointer-events-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{data.label}</p>;
});

const NODE_TYPES = { dossier: DossierCard, column: ColumnBackdrop, group: GroupTag };

function edgeColor(e: GraphEdge): string {
  if (e.warning) return RGB.warning;
  if (e.type === 'OWNS') return RGB.success;
  if (e.type === 'SPOUSE_OF' || e.type === 'RELATIVE_OF' || e.type === 'LEGAL_REP_OF') return RGB.info;
  if (e.type === 'SUPERSEDED_BY') return RGB.warning;
  return RGB.muted;
}

interface FlowModel { nodes: Node[]; edges: Edge[]; width: number; height: number }

function toFlow(graph: DossierGraphView, facts: ReadonlyMap<string, NodeFacts>, docLabels: ReadonlyMap<string, string>, selectedId: string | null, related: ReadonlySet<string>): FlowModel {
  const layout = layoutColumns(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const placeById = new Map(layout.nodes.map((p) => [p.id, p]));

  const backdrops: Node<ColumnData>[] = layout.columns.map((c) => ({
    id: `col:${c.id}`, type: 'column', position: { x: c.x, y: c.y }, draggable: false, selectable: false, focusable: false, zIndex: -1,
    data: { id: c.id, label: COLUMN_LABELS[c.id], count: c.count, w: c.w, h: c.h },
  }));
  const tags: Node<GroupData>[] = layout.groups.map((g, i) => ({
    id: `grp:${i}`, type: 'group', position: { x: g.x + 4, y: g.y + 2 }, draggable: false, selectable: false, focusable: false, zIndex: 0, data: { label: g.label },
  }));
  const cards: Node<CardData>[] = layout.nodes.map((p) => {
    const n = byId.get(p.id)!;
    return {
      id: p.id, type: 'dossier', position: { x: p.x, y: p.y }, draggable: false, zIndex: 2,
      data: { node: n, card: labelFor(n, facts, docLabels), selected: n.id === selectedId, dim: selectedId !== null && n.id !== selectedId && !related.has(n.id) },
    };
  });

  const edges: Edge[] = graph.edges.map((e) => {
    const color = edgeColor(e);
    const involved = selectedId !== null && (e.source === selectedId || e.target === selectedId);
    const dim = selectedId !== null && !involved;
    const sameColumn = placeById.get(e.source)?.column === placeById.get(e.target)?.column;
    const label = showsLabelOnCanvas(e) || involved ? edgeLabel(e) : undefined;
    return {
      id: e.id, source: e.source, target: e.target,
      // Cạnh trong cùng một cột (vợ/chồng, nhân thân) đi vòng bên phải để không đè lên thẻ ở giữa.
      sourceHandle: 'r', targetHandle: sameColumn ? 'r' : 'l',
      type: sameColumn ? 'default' : 'smoothstep',
      label,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      style: { stroke: color, strokeWidth: involved ? 2.25 : e.warning ? 1.75 : 1.25, opacity: dim ? 0.15 : 1, ...(e.type === 'MENTIONED_IN' ? { strokeDasharray: '5 4' } : {}) },
      labelStyle: { fontSize: 10, fontWeight: 600, fill: color },
      labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 6,
      zIndex: involved ? 3 : 1,
    };
  });
  return { nodes: [...backdrops, ...tags, ...cards], edges, width: layout.width, height: layout.height };
}

function Detail({ graph, selected, facts, docLabels, onSelect }: {
  graph: DossierGraphView; selected: GraphNode | null; facts: ReadonlyMap<string, NodeFacts>; docLabels: ReadonlyMap<string, string>; onSelect: (id: string) => void;
}) {
  if (!selected) {
    return (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Chi tiết liên hệ</p>
        <p>Chọn một thẻ trên sơ đồ để xem nó liên hệ với ai, tài sản và chứng từ nào. Các thẻ không liên quan sẽ mờ đi.</p>
        <ul className="space-y-1 pt-1">
          <li><span className="mr-1.5 inline-block h-0.5 w-5 align-middle" style={{ background: RGB.success }} />chủ sở hữu tài sản</li>
          <li><span className="mr-1.5 inline-block h-0.5 w-5 align-middle" style={{ background: RGB.info }} />vợ/chồng, nhân thân, đại diện pháp luật</li>
          <li><span className="mr-1.5 inline-block h-0.5 w-5 align-middle border-t-2 border-dashed" style={{ borderColor: RGB.muted }} />có trong chứng từ</li>
          <li><span className="mr-1.5 inline-block h-0.5 w-5 align-middle" style={{ background: RGB.warning }} />cần chú ý</li>
        </ul>
      </div>
    );
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const self = labelFor(selected, facts, docLabels);
  const related = graph.edges.filter((e) => e.source === selected.id || e.target === selected.id);
  return (
    <div className="space-y-2 text-xs">
      <div>
        <p className="text-sm font-semibold text-foreground">{self.title}</p>
        <p className="text-muted-foreground">{self.subtitle}{self.detail ? ` · ${self.detail}` : ''}</p>
      </div>
      {(selected.flags ?? []).length > 0 && (
        <ul className="flex flex-wrap gap-1.5">{(selected.flags ?? []).map((f) => <li key={f}><Badge tone="warning" icon={AlertTriangle}>{FLAG_LABELS[f] ?? f}</Badge></li>)}</ul>
      )}
      {related.length === 0 ? <p className="text-muted-foreground">Không có liên hệ nào.</p> : (
        <ul className="space-y-1">
          {related.map((e) => {
            const otherId = e.source === selected.id ? e.target : e.source;
            const other = byId.get(otherId);
            if (!other) return null;
            const o = labelFor(other, facts, docLabels);
            return (
              <li key={e.id}>
                <button type="button" onClick={() => onSelect(otherId)} className="w-full rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="block text-[11px] text-muted-foreground">{e.source === selected.id ? '→' : '←'} {edgeLabel(e)}{e.warning ? ' · cần chú ý' : ''}</span>
                  <span className="block font-medium text-foreground">{o.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{o.subtitle}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GraphCanvas({ graph, facts, docLabels }: { graph: DossierGraphView; facts: ReadonlyMap<string, NodeFacts>; docLabels: ReadonlyMap<string, string> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showUnmapped, setShowUnmapped] = useState(true);

  const view = useMemo(() => filterGraph(graph, { evidence: showEvidence, unmapped: showUnmapped }), [graph, showEvidence, showUnmapped]);
  const related = useMemo(() => {
    const s = new Set<string>();
    if (selectedId) for (const e of view.edges) { if (e.source === selectedId) s.add(e.target); if (e.target === selectedId) s.add(e.source); }
    return s;
  }, [view, selectedId]);
  const flow = useMemo(() => toFlow(view, facts, docLabels, selectedId, related), [view, facts, docLabels, selectedId, related]);
  const selected = view.nodes.find((n) => n.id === selectedId) ?? null;
  const counts = countByKind(graph);
  const onNodeClick = useCallback((_: unknown, node: Node) => { if (node.type === 'dossier') setSelectedId(node.id); }, []);
  // Chiều cao khung theo nội dung, có trần để không chiếm cả trang.
  const height = Math.min(Math.max(flow.height + 24, 280), 560);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={showEvidence} onChange={(e) => setShowEvidence(e.target.checked)} />Hiện chứng từ nguồn ({counts.evidence ?? 0})</label>
          {(counts.unmapped ?? 0) > 0 && (
            <label className="inline-flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={showUnmapped} onChange={(e) => setShowUnmapped(e.target.checked)} />Hiện người chưa gắn được ({counts.unmapped})</label>
          )}
        </div>
        <div style={{ height, ...FLOW_THEME }} className="overflow-hidden rounded-xl border border-border" role="group" aria-label="Sơ đồ quan hệ người, tài sản và chứng từ">
          <ReactFlow
            key={`${showEvidence}-${showUnmapped}`}
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
            minZoom={0.35}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            zoomOnScroll={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      </div>
      <aside aria-label="Chi tiết liên hệ" className="rounded-xl border border-border bg-card p-3">
        <Detail graph={view} selected={selected} facts={facts} docLabels={docLabels} onSelect={setSelectedId} />
      </aside>
    </div>
  );
}

/**
 * Sơ đồ quan hệ người – tài sản – chứng từ (khối `dossier_graph`). Graph chỉ chứa id và nhãn; tên và định danh tra từ `customer_360`
 * (số định danh che bớt trên thẻ). Không có khối (kết quả cũ, hoặc S3 không dựng được) → không hiện gì thay vì hiện bảng trống.
 */
export function DossierGraphPanel({ result }: { result: AppraisalResult }) {
  const graph = result.dossier_graph ?? null;
  const facts = useMemo(() => buildNodeFacts(result.customer_360), [result.customer_360]);
  const docLabels = useMemo(() => new Map([...new Set((graph?.nodes ?? []).filter((n) => n.kind === 'evidence').map((n) => n.type))].map((t) => [t, docTypeLabelOf(t)] as const)), [graph]);
  if (!graph) return null;
  const people = graph.nodes.filter((n) => n.kind === 'person').length;
  const assets = graph.nodes.filter((n) => n.kind === 'asset').length;
  const flagged = graph.nodes.filter((n) => (n.flags ?? []).length > 0).length + graph.edges.filter((e) => e.warning).length;
  return (
    <Card labelledBy="la2-graph-title">
      <CardHeader
        id="la2-graph-title"
        icon={Network}
        title="Sơ đồ quan hệ hồ sơ"
        subtitle={`${people} người · ${assets} tài sản · ${graph.edges.length} liên hệ`}
        actions={flagged > 0 ? <Badge tone="warning" icon={AlertTriangle}>{flagged} điểm cần chú ý</Badge> : undefined}
      />
      <CardBody>
        {people + assets === 0 ? (
          <EmptyState icon={Network} title="Chưa có quan hệ để vẽ">Chưa gom được người hoặc tài sản từ hồ sơ.</EmptyState>
        ) : (
          <ReactFlowProvider><GraphCanvas graph={graph} facts={facts} docLabels={docLabels} /></ReactFlowProvider>
        )}
      </CardBody>
    </Card>
  );
}
