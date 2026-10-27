// Customer 360 tổng hợp: MỖI NGƯỜI MỘT THẺ, gom từ DossierGraph + customer_360 (định danh, quan hệ, tài sản sở hữu, nguồn chứng từ, cảnh báo).
// Thuần, không phụ thuộc React để test được. Quan hệ lấy từ cạnh graph nên không còn phải đối chiếu tay các mảng id chéo của S3.
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { DossierGraphView, GraphEdge } from '@/lib/loan-dossier/graph/view-contract';
import { assetDetail, loanSummary, personDetail, type AssetDetail, type EvidenceLike, type LoanSummary, type PersonDetail } from './customer360-detail';
import { ASSET_LABELS, FLAG_LABELS, REL_LABELS, ROLE_LABELS, ROLE_ORDER } from './graph-view';

type Entry = MapDossierData['customer_360'][number];
type Registry = MapDossierData['role_registry'][number];
type AssetEntry = MapDossierData['asset_registry'][number];

export const MARITAL_LABELS: Record<string, string> = { SINGLE: 'Độc thân', MARRIED: 'Đã kết hôn', DIVORCED: 'Ly hôn', WIDOWED: 'Góa' };
export const ID_STATUS_LABELS: Record<string, string> = {
  CONSISTENT: 'Nhất quán', HISTORICAL_ID_NUMBER: 'Có số cũ', CONFLICT: 'Mâu thuẫn', MISSING: 'Thiếu', MULTIPLE: 'Nhiều số',
};

export type Severity = 'ok' | 'warn';

export interface Fact { label: string; value: string }
export interface RelationRow { kind: 'spouse' | 'relative' | 'legal_rep'; otherId: string; otherName: string; text: string; warn: boolean }
export interface AssetRow { assetId: string; typeLabel: string; key: string; current: boolean; warn: boolean }
export interface PersonCard {
  personId: string;
  name: string;
  /** Pháp nhân (doanh nghiệp): thẻ hiện MST / số ĐKDN / trụ sở / người đại diện thay cho ngày sinh, giới tính, hôn nhân. */
  isOrg: boolean;
  roles: string[];
  roleLabels: string[];
  facts: Fact[];
  marital: string | null;
  relations: RelationRow[];
  assets: AssetRow[];
  /** Loại chứng từ đã gom vào người này, kèm số lượng: "CCCD ×2". */
  sources: string[];
  alerts: string[];
  /** Chi tiết lấy từ chứng từ (liên hệ, hộ kinh doanh, thu nhập, tín dụng CIC). Rỗng khi không có `evidences`. */
  detail: PersonDetail;
}
export interface AssetCard {
  assetId: string; typeLabel: string; key: string; purpose: string | null;
  owners: Array<{ personId: string; name: string; current: boolean }>; alerts: string[];
  /** Chi tiết vật lý / định giá / biến động đăng ký lấy từ chứng từ. */
  detail: AssetDetail;
}
export interface Customer360Summary {
  /** Khoản vay, thu nhập khai, mục đích (từ giấy đề nghị vay). null khi không có đơn vay đọc được. */
  loan: LoanSummary | null;
  people: PersonCard[];
  assets: AssetCard[];
  /** Party chưa gắn được người (cần xem lại) và bản chứng từ đã bị thay thế. */
  unmapped: number;
  superseded: number;
  counts: { people: number; orgs: number; assets: number; relations: number; alerts: number };
}

const present = (v: unknown): v is string | number => v !== null && v !== undefined && String(v).trim() !== '';

const ASSET_KEY_FIELDS: Array<[string, string]> = [
  ['certificate_number', 'GCN'], ['license_plate', 'Biển số'], ['chassis_number', 'Số khung'], ['registration_number', 'Số ĐK'], ['apartment_number', 'Căn hộ'],
];

function assetKey(a: AssetEntry): string {
  const ids = a.identifiers as Record<string, string | null>;
  const hit = ASSET_KEY_FIELDS.find(([k]) => present(ids[k]));
  if (hit) return `${hit[1]} ${ids[hit[0]]}`;
  const parcel = [ids.land_parcel_number, ids.map_sheet_number].filter(present).join('/');
  return parcel ? `Thửa/tờ ${parcel}` : 'Chưa có định danh';
}

function addressOf(a: { full_text?: string | null } | null | undefined): string | null {
  return a && present(a.full_text) ? String(a.full_text) : null;
}

/**
 * Tổng hợp Customer 360 theo người. `docTypeLabel` đổi doc_type_key → nhãn tiếng Việt (truyền vào để hàm này không phụ thuộc catalog).
 * Thứ tự người: theo nhóm vai trò (vay → đồng vay → chủ TSBĐ → khác), trong nhóm theo thứ tự S3.
 */
export function buildCustomer360(
  map: MapDossierData,
  graph: DossierGraphView | null,
  docTypeLabel: (key: string) => string,
  evidences: ReadonlyArray<EvidenceLike> = [],
): Customer360Summary {
  // Kết quả đã lưu có thể thiếu khối (bản cũ / rút gọn): coi khối vắng mặt là rỗng thay vì ném lỗi.
  const reg = new Map<string, Registry>((map.role_registry ?? []).map((p) => [p.person_id, p]));
  const c360 = new Map<string, Entry>((map.customer_360 ?? []).map((c) => [c.person_id, c]));
  const nameOf = (id: string) => c360.get(id)?.identity.full_name?.trim() || reg.get(id)?.full_name?.trim() || id;
  const assetRegistry = map.asset_registry ?? [];
  const assetById = new Map(assetRegistry.map((a) => [a.asset_id, a]));

  // Cạnh: ưu tiên graph (nguồn quan hệ thống nhất); không có graph thì dựng lại từ mảng id của customer_360.
  const edges: GraphEdge[] = graph?.edges ?? [];
  const owns = (pid: string) => {
    if (graph) return edges.filter((e) => e.type === 'OWNS' && e.source === pid).map((e) => ({ assetId: e.target, current: e.label !== 'former' }));
    return (c360.get(pid)?.owned_asset_ids ?? []).map((assetId) => ({ assetId, current: true }));
  };

  const people: PersonCard[] = [];
  for (const entry of map.customer_360 ?? []) {
    const r = reg.get(entry.person_id);
    const id = entry.identity;
    const facts: Fact[] = [];
    const org = entry.organization;
    if (org) {
      // Pháp nhân: khóa danh tính là MST / số đăng ký; không có số định danh cá nhân, ngày sinh, hôn nhân.
      if (present(org.tax_id)) facts.push({ label: 'Mã số thuế', value: String(org.tax_id) });
      if (present(org.registration_number)) facts.push({ label: 'Số ĐKDN', value: String(org.registration_number) });
      const hq = addressOf(org.headquarters_address) ?? addressOf(id.permanent_address);
      if (hq) facts.push({ label: 'Trụ sở', value: hq });
    } else {
      const idNumber = id.id_number ?? r?.current_id_number ?? r?.declared_id_number;
      if (present(idNumber)) facts.push({ label: 'Số định danh', value: String(idNumber) });
      if (r && r.historical_id_numbers.length > 0) facts.push({ label: 'Số cũ', value: r.historical_id_numbers.join(', ') });
      if (present(id.date_of_birth)) facts.push({ label: 'Ngày sinh', value: String(id.date_of_birth) });
      const perm = addressOf(id.permanent_address);
      const cur = addressOf(id.current_address);
      if (perm) facts.push({ label: 'Thường trú', value: perm });
      if (cur && cur !== perm) facts.push({ label: 'Hiện tại', value: cur });
    }

    const alerts: string[] = [];
    if (r?.id_number_check.requires_review) alerts.push(`Số định danh cần rà soát (${ID_STATUS_LABELS[r.id_number_check.status] ?? r.id_number_check.status})`);
    if (r?.role_conflict) alerts.push(FLAG_LABELS.ROLE_CONFLICT);

    const relations: RelationRow[] = [];
    // Người đại diện theo pháp luật: hiện ở cả hai phía (công ty thấy ai đại diện, cá nhân thấy mình đại diện cho công ty nào).
    for (const e of edges) {
      if (e.type !== 'LEGAL_REP_OF') continue;
      if (e.target === entry.person_id) {
        const pos = org && present(org.representative_position) ? ` (${org.representative_position})` : '';
        relations.push({ kind: 'legal_rep', otherId: e.source, otherName: nameOf(e.source), text: `Người đại diện theo pháp luật${pos}`, warn: false });
      } else if (e.source === entry.person_id) {
        relations.push({ kind: 'legal_rep', otherId: e.target, otherName: nameOf(e.target), text: 'Đại diện theo pháp luật của', warn: false });
      }
    }
    // Không có graph (kết quả cũ): lấy từ customer_360.organization.
    if (!graph && org?.representative_person_id) relations.push({ kind: 'legal_rep', otherId: org.representative_person_id, otherName: nameOf(org.representative_person_id), text: 'Người đại diện theo pháp luật', warn: false });
    const seenSpouse = new Set<string>();
    for (const e of edges) {
      if (e.type === 'SPOUSE_OF' && (e.source === entry.person_id || e.target === entry.person_id)) {
        const other = e.source === entry.person_id ? e.target : e.source;
        if (seenSpouse.has(other)) continue;
        seenSpouse.add(other);
        relations.push({ kind: 'spouse', otherId: other, otherName: nameOf(other), text: 'Vợ/chồng', warn: false });
      }
      if (e.type === 'RELATIVE_OF' && (e.source === entry.person_id || e.target === entry.person_id)) {
        const outgoing = e.source === entry.person_id;
        const other = outgoing ? e.target : e.source;
        const kind = REL_LABELS[e.label ?? 'UNKNOWN'] ?? e.label ?? 'chưa phân loại';
        relations.push({ kind: 'relative', otherId: other, otherName: nameOf(other), text: `Nhân thân (${kind})${e.warning ? ' · chưa xác minh đủ' : ''}`, warn: e.warning === true });
        if (e.warning) alerts.push(`Nhân thân với ${nameOf(other)} chưa xác minh đủ`);
      }
    }
    // Không có graph: dùng spouse_person_id của customer_360.
    if (!graph && entry.spouse_person_id) relations.push({ kind: 'spouse', otherId: entry.spouse_person_id, otherName: nameOf(entry.spouse_person_id), text: 'Vợ/chồng', warn: false });

    const assets: AssetRow[] = owns(entry.person_id).map(({ assetId, current }) => {
      const a = assetById.get(assetId);
      const warn = a ? a.context_status !== 'CONFIRMED' || a.identifier_conflicts.length > 0 : false;
      return { assetId, typeLabel: a ? ASSET_LABELS[a.asset_type] ?? a.asset_type : assetId, key: a ? assetKey(a) : '', current, warn };
    });
    for (const row of assets) if (row.warn) alerts.push(`Tài sản ${row.assetId} cần xác nhận`);

    // Nguồn chứng từ
    const counts = new Map<string, number>();
    for (const m of (r?.mapped_evidences ?? []) as Array<{ doc_type_key?: string }>) {
      if (m.doc_type_key) counts.set(m.doc_type_key, (counts.get(m.doc_type_key) ?? 0) + 1);
    }
    const sources = [...counts].map(([k, n]) => `${docTypeLabel(k)}${n > 1 ? ` ×${n}` : ''}`);

    people.push({
      personId: entry.person_id, name: nameOf(entry.person_id), isOrg: Boolean(org), roles: [...entry.roles], roleLabels: entry.roles.map((x) => ROLE_LABELS[x] ?? x),
      facts, marital: !org && entry.marital_status ? MARITAL_LABELS[entry.marital_status] ?? entry.marital_status : null, relations, assets, sources, alerts,
      detail: personDetail(map, entry.person_id, evidences, docTypeLabel),
    });
  }

  const rank = (p: PersonCard) => { const i = ROLE_ORDER.indexOf(p.roles.find((x) => ROLE_ORDER.includes(x)) ?? 'other'); return i < 0 ? ROLE_ORDER.length : i; };
  const sorted = people.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((e) => e.p);

  const assetCards: AssetCard[] = assetRegistry.map((a) => {
    const alerts: string[] = [];
    if (a.context_status !== 'CONFIRMED') alerts.push(a.context_status === 'UNRESOLVED' ? FLAG_LABELS.UNRESOLVED : 'Mục đích tài sản cần xác nhận');
    if (a.identifier_conflicts.length > 0) alerts.push(FLAG_LABELS.IDENTIFIER_CONFLICT);
    const owners = [
      ...a.current_owner_person_ids.map((pid) => ({ personId: pid, name: nameOf(pid), current: true })),
      ...a.owner_person_ids.filter((pid) => !a.current_owner_person_ids.includes(pid)).map((pid) => ({ personId: pid, name: nameOf(pid), current: false })),
    ];
    const purpose = a.usage_contexts.length ? a.usage_contexts.map((u) => (u === 'collateral' ? 'TSBĐ' : 'Cho thuê')).join(' + ') : null;
    return {
      assetId: a.asset_id, typeLabel: ASSET_LABELS[a.asset_type] ?? a.asset_type, key: assetKey(a), purpose, owners, alerts,
      detail: assetDetail(map, a.asset_id, evidences, docTypeLabel),
    };
  });

  const relationCount = new Set(edges.filter((e) => e.type === 'SPOUSE_OF' || e.type === 'RELATIVE_OF').map((e) => e.id)).size
    || sorted.reduce((n, p) => n + p.relations.length, 0);
  const alertCount = sorted.reduce((n, p) => n + p.alerts.length, 0) + assetCards.reduce((n, a) => n + a.alerts.length, 0);
  return {
    loan: loanSummary(evidences, docTypeLabel),
    people: sorted, assets: assetCards, unmapped: (map.unmapped_evidences ?? []).length, superseded: (map.superseded_evidences ?? []).length,
    counts: { people: sorted.filter((p) => !p.isOrg).length, orgs: sorted.filter((p) => p.isOrg).length, assets: assetCards.length, relations: relationCount, alerts: alertCount },
  };
}
