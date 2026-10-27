// Dạng gọn của DossierGraph cho prompt LLM: mỗi người / tài sản MỘT dòng định danh, quan hệ là dòng riêng trỏ bằng id
// (person-n / asset-n), nguồn chứng từ gọi bằng loại chứng từ. Thay cho JSON lồng nhau của Customer 360 cũ (lặp tên, số
// định danh, id chứng từ ở nhiều khối). Hàm thuần, tất định, không log; không đưa evidence_id nội bộ vào văn bản.
import { inEdges, nodesOf, outEdges } from './project';
import type { AssetNode, DossierGraph, EvidenceNode, PersonNode, UnmappedNode } from './types';

/** Nhóm dữ liệu rule khai báo (`master_data.<group>`), cùng tập với `Customer360Group`. */
export type RenderGroup = 'identity' | 'income' | 'collateral' | 'legal' | 'relationship';

const MAX_TEXT = 120;
const MAX_UNMAPPED = 20;
const LOW_MATCH_CONFIDENCE = 0.8;

const ASSET_ID_LABELS: Array<[string, string]> = [
  ['certificate_number', 'GCN'], ['certificate_book_number', 'số vào sổ'], ['land_parcel_number', 'thửa'], ['map_sheet_number', 'tờ bản đồ'],
  ['apartment_number', 'căn hộ'], ['building_name', 'tòa'], ['project_name', 'dự án'], ['license_plate', 'biển số'],
  ['chassis_number', 'số khung'], ['engine_number', 'số máy'], ['registration_number', 'số đăng ký'],
];

const one = (v: unknown): string => {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
};
const present = (v: unknown): boolean => v !== null && v !== undefined && one(v) !== '';

/** Địa chỉ dạng object `{full_text,…}` hoặc chuỗi → một chuỗi. */
const addressText = (a: unknown): string | null => {
  if (!a || typeof a !== 'object') return present(a) ? one(a) : null;
  const t = (a as { full_text?: unknown }).full_text;
  return present(t) ? one(t) : null;
};

/** Giá trị lồng nhau → các cặp `khóa=giá trị` phẳng, bỏ rỗng. */
function flat(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'object' && !Array.isArray(value)) {
    const text = addressText(value);
    if (text !== null && 'full_text' in (value as object)) return [`${prefix}=${text}`];
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k));
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => flat(v, `${prefix}[${i}]`));
  return present(value) ? [`${prefix}=${one(value)}`] : [];
}

/** `loan_application[ANCHOR]`, lặp cùng loại gộp thành `id_card×2`. */
function sourceList(tokens: string[]): string {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => (n > 1 ? `${t}×${n}` : t)).join(', ');
}

function personSources(g: DossierGraph, id: string): string {
  const tokens = outEdges(g, id, 'MENTIONED_IN').sort((a, b) => a.edge.seq - b.edge.seq).map(({ edge }) => {
    const e = edge.entry;
    const notes: string[] = [];
    if (e.matched_by !== 'ANCHOR') notes.push(String(e.matched_by));
    const warnings = Array.isArray(e.warnings) ? e.warnings as string[] : [];
    if (warnings.includes('NAME_SPELLING_DIFFERENCE')) notes.push('tên lệch chính tả');
    if (typeof e.match_confidence === 'number' && e.match_confidence < LOW_MATCH_CONFIDENCE) notes.push(`tin cậy ${e.match_confidence.toFixed(2)}`);
    return `${String(e.doc_type_key)}${notes.length ? `[${notes.join('; ')}]` : ''}`;
  });
  return sourceList(tokens);
}

function assetSources(g: DossierGraph, id: string): string {
  const tokens = outEdges(g, id, 'MENTIONED_IN').sort((a, b) => a.edge.seq - b.edge.seq).map(({ edge }) => {
    const link = String(edge.entry.link ?? '');
    return `${String(edge.entry.doc_type_key)}${link && link !== 'SEED' && link !== 'EXACT' ? `[${link}]` : ''}`;
  });
  return sourceList(tokens);
}

function roleText(p: PersonNode): string {
  const detail = p.registry.other_role_detail;
  return p.roles.map((r) => (r === 'other' && detail ? `other:${detail}` : r)).join('/');
}

function personLine(id: string, p: PersonNode, detailed: boolean): string {
  const parts = [`${id} ${roleText(p)}${p.organization ? ' (doanh nghiệp)' : ''}`, present(p.identity.full_name) ? one(p.identity.full_name) : '(không rõ tên)'];
  if (detailed && p.organization) {
    // Pháp nhân: khóa danh tính là MST / số đăng ký; không có số định danh cá nhân, ngày sinh, giới tính.
    const o = p.organization;
    if (present(o.tax_id)) parts.push(`MST ${one(o.tax_id)}`);
    if (present(o.registration_number)) parts.push(`số ĐKDN ${one(o.registration_number)}`);
    const hq = addressText(o.headquarters_address) ?? addressText(p.identity.permanent_address);
    if (hq) parts.push(`trụ sở ${hq}`);
    if (present(o.representative_name)) parts.push(`đại diện ${one(o.representative_name)}${present(o.representative_position) ? ` (${one(o.representative_position)})` : ''}`);
    if (p.registry.role_conflict) parts.push('XUNG ĐỘT vai trò');
    return parts.join(' · ');
  }
  if (detailed) {
    const current = p.registry.current_id_number ?? p.identity.id_number;
    if (present(current)) parts.push(`số ĐD ${one(current)}`);
    if (p.registry.historical_id_numbers.length) parts.push(`số cũ ${p.registry.historical_id_numbers.map(one).join(', ')}`);
    if (present(p.identity.date_of_birth)) parts.push(`sinh ${one(p.identity.date_of_birth)}`);
    if (present(p.identity.gender)) parts.push(`giới tính ${one(p.identity.gender)}`);
    const perm = addressText(p.identity.permanent_address);
    const cur = addressText(p.identity.current_address);
    if (perm) parts.push(`thường trú ${perm}`);
    if (cur && cur !== perm) parts.push(`hiện tại ${cur}`);
    const check = p.registry.id_number_check;
    if (check.status !== 'CONSISTENT') parts.push(`số ĐD: ${check.status}${check.requires_review ? ' (cần rà soát)' : ''}`);
    if (p.registry.role_conflict) parts.push('XUNG ĐỘT vai trò');
  }
  return parts.join(' · ');
}

/**
 * Văn bản gọn của graph cho các nhóm dữ liệu rule khai báo. `groups = null` ⇒ mọi nhóm (rule không khai báo nguồn).
 * Dòng định danh người luôn có để các nhóm khác trỏ bằng id mà không lặp tên.
 */
export function renderDossierGraph(g: DossierGraph, groups: ReadonlySet<string> | null): string {
  const want = (k: RenderGroup) => groups === null || groups.has(k);
  if (groups !== null && groups.size === 0) return '(không có nhóm dữ liệu người & tài sản nào được khai báo)';

  const persons = nodesOf(g, 'person').map(({ id, node }) => ({ id, node: node as PersonNode }));
  const assets = nodesOf(g, 'asset').map(({ id, node }) => ({ id, node: node as AssetNode }));
  if (persons.length === 0 && assets.length === 0) return '(chưa gom được người & tài sản từ hồ sơ)';

  const out: string[] = [
    'Ký hiệu: person-n / asset-n là mã người / tài sản đã gom; "nguồn" là loại chứng từ chứa thông tin (trong [ ] là cách khớp hoặc cảnh báo).',
  ];

  // ── Người ──
  const showIdentity = want('identity');
  if (persons.length > 0) {
    out.push('NGƯỜI');
    for (const { id, node } of persons) {
      out.push(personLine(id, node, showIdentity));
      if (showIdentity) {
        const src = personSources(g, id);
        if (src) out.push(`  nguồn: ${src}`);
      }
    }
  }

  // ── Quan hệ ──
  if (want('relationship') || want('legal')) {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const { id } of persons) {
      for (const { target } of outEdges(g, id, 'SPOUSE_OF')) {
        const key = [id, target].sort().join('|');
        if (!seen.has(key)) { seen.add(key); lines.push(`${id} ⇄ ${target}: vợ/chồng`); }
      }
    }
    // Người đại diện theo pháp luật của doanh nghiệp (gom được trong registry); tên + chức danh nằm ở dòng của doanh nghiệp.
    for (const { id } of persons) {
      for (const { target } of outEdges(g, id, 'LEGAL_REP_OF')) lines.push(`${id} → ${target}: người đại diện theo pháp luật`);
    }
    const relatives: Array<{ seq: number; text: string }> = [];
    g.forEachEdge((_k, attrs, source, target) => {
      if (attrs.type !== 'RELATIVE_OF') return;
      const d = attrs.detail;
      const kind = d.relationship_type ?? 'chưa phân loại';
      const declared = present(d.relationship_raw) ? ` (khai: "${one(d.relationship_raw)}")` : '';
      const verify = d.required_count !== null ? `, giấy khai sinh xác minh ${d.verified_count}/${d.required_count}` : '';
      relatives.push({ seq: attrs.seq, text: `${source} → ${target}: ${kind}${declared}${verify}` });
    });
    lines.push(...relatives.sort((a, b) => a.seq - b.seq).map((r) => r.text));
    for (const { id, node } of persons) {
      if (node.marital_status) lines.push(`${id} hôn nhân: ${node.marital_status}`);
    }
    if (lines.length > 0) out.push('QUAN HỆ', ...lines);
  }

  // ── Tài sản và chủ sở hữu ──
  if (want('collateral') && assets.length > 0) {
    out.push('TÀI SẢN');
    for (const { id, node } of assets) {
      const a = node.attrs;
      const ids = ASSET_ID_LABELS
        .map(([k, label]) => [label, (a.identifiers as Record<string, unknown>)[k]] as const)
        .filter(([, v]) => present(v)).map(([label, v]) => `${label} ${one(v)}`);
      const parts = [`${id} ${a.asset_type}`, a.usage_contexts.length ? `mục đích ${(a.usage_contexts as string[]).join('+')}` : 'chưa rõ mục đích', ...ids];
      if (a.context_status !== 'CONFIRMED') parts.push(`${a.context_status}${a.context_reason_code ? `: ${a.context_reason_code}` : ''}`);
      out.push(parts.join(' · '));

      const owners = inEdges(g, id, 'OWNS');
      const pSeq = (pid: string) => (g.getNodeAttributes(pid) as PersonNode).seq;
      const current = owners.filter((e) => e.edge.currentSeq !== null).sort((x, y) => (x.edge.currentSeq as number) - (y.edge.currentSeq as number) || pSeq(x.source) - pSeq(y.source)).map((e) => e.source);
      const former = owners.filter((e) => e.edge.currentSeq === null && e.edge.ownerSeq !== null).sort((x, y) => pSeq(x.source) - pSeq(y.source)).map((e) => e.source);
      const ownerParts = [current.length ? `chủ hiện tại ${current.join(', ')}` : 'chưa xác định chủ hiện tại', ...(former.length ? [`từng đứng tên ${former.join(', ')}`] : [])];
      const src = assetSources(g, id);
      out.push(`  ${ownerParts.join('; ')}${src ? `; nguồn: ${src}` : ''}`);
      for (const c of a.identifier_conflicts as Array<Record<string, unknown>>) {
        const values = Array.isArray(c.values) ? (c.values as unknown[]).map(one).join(' | ') : '';
        out.push(`  mâu thuẫn ${one(c.field)}: ${values}${c.probable_ocr_error === true ? ' (nghi lỗi đọc)' : ''}`);
      }
    }
  }

  // ── Doanh nghiệp / hộ kinh doanh ──
  // S3 gắn cùng `business` cho khách vay và đồng vay; gộp các người có nội dung giống hệt vào một dòng để không lặp.
  if (want('income')) {
    const byContent = new Map<string, string[]>();
    for (const { id, node } of persons) {
      if (!node.business) continue;
      const content = flat(node.business).join('; ');
      if (content) byContent.set(content, [...(byContent.get(content) ?? []), id]);
    }
    const lines = [...byContent].map(([content, ids]) => `${ids.join(', ')}: ${content}`);
    if (lines.length > 0) out.push('KINH DOANH', ...lines);
  }

  // ── Lưu ý: party chưa gắn được người, bản bị thay thế ──
  const notes: string[] = [];
  if (showIdentity) {
    const unmapped = nodesOf(g, 'unmapped').map(({ id, node }) => ({ id, node: (node as UnmappedNode) }));
    for (const { id, node } of unmapped.slice(0, MAX_UNMAPPED)) {
      const e = node.entry;
      const who = [present(e.full_name) ? one(e.full_name) : null, present(e.id_number) ? `số ${one(e.id_number)}` : null].filter(Boolean).join(', ');
      const doc = outEdges(g, id, 'UNMAPPED_IN')[0]?.target;
      const docType = doc ? ((g.getNodeAttributes(doc) as EvidenceNode).superseded?.doc_type_key ?? String(e.doc_type_key)) : String(e.doc_type_key);
      notes.push(`chưa gắn được người: ${docType} — ${who || '(không tên/số)'} — ${e.reason_code}`);
    }
    if (unmapped.length > MAX_UNMAPPED) notes.push(`(… ${unmapped.length - MAX_UNMAPPED} mục chưa gắn khác)`);
  }
  const supersededNotes: string[] = [];
  g.forEachNode((_id, attrs) => {
    if (attrs.kind !== 'evidence') return;
    const s = (attrs as EvidenceNode).superseded;
    if (!s) return;
    const scope = s.person_id ?? s.asset_id;
    supersededNotes.push(`bản đã bị thay thế bởi bản mới hơn: ${s.doc_type_key}${s.issue_date ? ` (cấp ${s.issue_date})` : ''}${scope ? ` — ${scope}` : ''}`);
  });
  notes.push(...supersededNotes);
  if (notes.length > 0) out.push('LƯU Ý', ...notes);

  return out.join('\n');
}
