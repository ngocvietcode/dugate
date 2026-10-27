// Hợp đồng JSON của khối `dossier_graph` trong kết quả (tách khỏi định dạng nội bộ của graphology để UI không phụ thuộc thư viện).
// Chỉ chứa NHÃN và id; không chứa tên, số định danh, địa chỉ (PII). UI nối với `customer_360` / `documents.evidences` qua `person_id` /
// `asset_id` / `evidence_id` khi cần chi tiết, nên mỗi sự thật vẫn chỉ nằm một chỗ.
import { z } from 'zod';

export const DOSSIER_GRAPH_VERSION = '1.0';

const IdSchema = z.string().min(1);

export const GraphNodeKindSchema = z.enum(['person', 'asset', 'evidence', 'unmapped']);
export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;

export const GraphEdgeTypeSchema = z.enum(['MENTIONED_IN', 'OWNS', 'SPOUSE_OF', 'RELATIVE_OF', 'LEGAL_REP_OF', 'SUPERSEDED_BY', 'UNMAPPED_IN']);
export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

export const GraphNodeSchema = z.object({
  id: IdSchema,
  kind: GraphNodeKindSchema,
  /** person: borrower|co_borrower|collateral_owner|other · asset: real_estate|vehicle|… · evidence: doc_type_key · unmapped: reason_code. */
  type: z.string(),
  /** Vai trò (person) — để tô màu / lọc. */
  roles: z.array(z.string()).optional(),
  /** Chỉ có (	rue) với pháp nhân; vắng mặt với cá nhân để graph của HKD không đổi. */
  org: z.literal(true).optional(),
  /** Trạng thái đáng chú ý: asset context_status, evidence "SUPERSEDED", person "ROLE_CONFLICT" / "ID_REVIEW". */
  flags: z.array(z.string()).optional(),
}).strict();
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  target: IdSchema,
  type: GraphEdgeTypeSchema,
  /** Nhãn ngắn không PII: cách khớp (ANCHOR|ID_NUMBER|FULL_NAME), loại quan hệ, "current"/"former", … */
  label: z.string().optional(),
  /** Cạnh cần chú ý: khớp độ tin cậy thấp, tên lệch chính tả, nối yếu/gần đúng, nhân thân chưa xác minh đủ. */
  warning: z.boolean().optional(),
}).strict();
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const DossierGraphViewSchema = z.object({
  version: z.literal(DOSSIER_GRAPH_VERSION),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
}).strict().superRefine((g, ctx) => {
  const ids = new Set(g.nodes.map((n) => n.id));
  if (ids.size !== g.nodes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'node id trùng' });
  const edgeIds = new Set<string>();
  g.edges.forEach((e, i) => {
    if (edgeIds.has(e.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', i, 'id'], message: 'edge id trùng' });
    edgeIds.add(e.id);
    if (!ids.has(e.source)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', i, 'source'], message: `${e.source} không có trong nodes` });
    if (!ids.has(e.target)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', i, 'target'], message: `${e.target} không có trong nodes` });
  });
});
export type DossierGraphView = z.infer<typeof DossierGraphViewSchema>;
