// Đối tác và giao dịch mua (T-360-13, T-360-18; L360-G04, L360-G09, L360-B05). Hàm thuần, tất định, không log.
// Đối tác pháp nhân gộp theo mã số thuế rồi tên pháp nhân EXACT; cá nhân chỉ gộp theo số định danh, không bao giờ theo tên.
// Giao dịch: báo giá, HĐ mua, bảng kê cùng bên bán + cùng đối tượng là một giao dịch; báo giá của bên bán khác là giao dịch riêng.
import { orgNameLevel } from '../common/org-name';
import { normIdNumber, normKey } from '../common/normalize';
import type { MapDossierData } from '../contracts/check-stages';
import type { DocumentParty } from '../s2/common-schema';
import type { Counterparty, PurchaseDeal } from './schema';
import { normText, text, valueAt, type Lookup } from './sources';

/** Vai trò đối tác theo loại chứng từ. Báo giá không có party bên bán: đối tác là `QUOTER` = `quote_info.quoting_company` (chỉ có tên). */
const COUNTERPARTY_ROLES: Record<string, string[]> = {
  goods_purchase_contract: ['SELLER'], vehicle_sale_contract: ['SELLER'], purchase_list: ['SELLER'],
  labor_contract: ['EMPLOYER'], salary_confirmation: ['EMPLOYER'], credit_contract: ['LENDER'],
};

interface Mention {
  evidence_id: string;
  doc_type_key: string;
  party_index: number | null;
  role: string;
  party_type: 'INDIVIDUAL' | 'ORGANIZATION';
  name: string | null;
  tax: string | null;
  idn: string | null;
  person_id: string | null;
}

function collectMentions(lookup: Lookup): Mention[] {
  const out: Mention[] = [];
  for (const e of lookup.evidences) {
    const roles = COUNTERPARTY_ROLES[e.doc_type_key];
    if (!roles) continue;
    for (const p of (e.data?.parties as DocumentParty[] | undefined) ?? []) {
      if (!roles.includes(p.party_role)) continue;
      out.push({
        evidence_id: e.evidence_id, doc_type_key: e.doc_type_key, party_index: p.party_index, role: p.party_role,
        party_type: p.party_type === 'ORGANIZATION' ? 'ORGANIZATION' : 'INDIVIDUAL', name: text(p.full_name),
        tax: normIdNumber(p.tax_id), idn: normIdNumber(p.id_number), person_id: lookup.personOf(e.evidence_id, p.party_index)?.person_id ?? null,
      });
    }
    const quoter = e.doc_type_key === 'asset_quote' ? text(valueAt(e.data, 'quote_info.quoting_company')) : null;
    if (quoter) out.push({ evidence_id: e.evidence_id, doc_type_key: e.doc_type_key, party_index: null, role: 'QUOTER', party_type: 'ORGANIZATION', name: quoter, tax: null, idn: null, person_id: null });
  }
  return out;
}

const sameCounterparty = (a: Mention, b: Mention): boolean => {
  if (a.party_type !== b.party_type) return false;
  if (a.tax && b.tax) return a.tax === b.tax;
  if (a.idn && b.idn) return a.idn === b.idn;
  // Không có số: chỉ pháp nhân được gộp theo tên (L360-G09); cá nhân trùng tên không gộp.
  return a.party_type === 'ORGANIZATION' && !!a.name && !!b.name && orgNameLevel(a.name, b.name) === 'EXACT';
};

export interface TradeResult {
  counterparties: Counterparty[];
  /** `{evidence_id}#{party_index}` hoặc `{evidence_id}#quoter` → `counterparty_id`. */
  counterpartyOf: Map<string, string>;
  deals: PurchaseDeal[];
}

const mentionKey = (m: Pick<Mention, 'evidence_id' | 'party_index'>) => `${m.evidence_id}#${m.party_index ?? 'quoter'}`;

function buildCounterparties(lookup: Lookup): { counterparties: Counterparty[]; counterpartyOf: Map<string, string> } {
  const groups: Mention[][] = [];
  for (const m of collectMentions(lookup)) {
    const hit = groups.find((g) => g.some((x) => sameCounterparty(x, m)));
    if (hit) hit.push(m); else groups.push([m]);
  }
  const counterpartyOf = new Map<string, string>();
  const counterparties = groups.map((g, i): Counterparty => {
    const id = `cp-${i + 1}`;
    for (const m of g) counterpartyOf.set(mentionKey(m), id);
    const docs = new Map<string, Set<string>>();
    for (const m of g) docs.set(m.doc_type_key, (docs.get(m.doc_type_key) ?? new Set()).add(m.evidence_id));
    return {
      counterparty_id: id,
      party_type: g[0].party_type,
      name: g.map((m) => m.name).find((x): x is string => !!x) ?? null,
      tax_id: g.map((m) => m.tax).find((x): x is string => !!x) ?? null,
      id_number: g.map((m) => m.idn).find((x): x is string => !!x) ?? null,
      roles: [...new Set(g.map((m) => (m.role === 'QUOTER' ? 'SELLER' : m.role)))],
      person_id: g.map((m) => m.person_id).find((x): x is string => !!x) ?? null,
      documents: [...docs].map(([doc_type_key, evs]) => ({ doc_type_key, count: evs.size })),
    };
  });
  return { counterparties, counterpartyOf };
}

interface DealEntry {
  kind: PurchaseDeal['kind'];
  object: string | null;
  /** Khóa đối tượng: số khung / số máy (EXACT) hoặc hãng|model|năm (PARTIAL). */
  objectKey: { value: string; exact: boolean } | null;
  seller: string | null;
  asset_id: string | null;
  price: PurchaseDeal['prices'][number] | null;
}

function vehicleEntries(e: Lookup['evidences'][number], lookup: Lookup, s3: MapDossierData | null, seller: string | null, source: 'QUOTE' | 'CONTRACT'): DealEntry[] {
  const details = (e.data?.asset_details as Array<Record<string, unknown>> | undefined) ?? [];
  const assets = (e.data?.assets as Array<{ asset_index?: number; identifiers?: Record<string, unknown> }> | undefined) ?? [];
  const totalPath = source === 'CONTRACT' ? 'contract_info.total_amount' : 'quote_info.total_quoted_value';
  const total = valueAt(e.data, totalPath);
  return details.map((d, i) => {
    const idx = typeof d.asset_index === 'number' ? d.asset_index : i;
    const ids = assets.find((a) => a.asset_index === idx)?.identifiers ?? {};
    const hard = normKey(text(ids.chassis_number)) ?? normKey(text(ids.engine_number));
    const parts = [text(d.vehicle_brand), text(d.vehicle_model), typeof d.manufacture_year === 'number' ? String(d.manufacture_year) : null];
    const soft = parts.every(Boolean) ? parts.map((x) => normText(x!)).join('|') : null;
    const pricePath = source === 'CONTRACT' ? `asset_details[${i}].unit_price` : `asset_details[${i}].quoted_value`;
    const own = valueAt(e.data, pricePath);
    const value = typeof own === 'number' ? own : details.length === 1 && typeof total === 'number' ? total : null;
    const path = typeof own === 'number' ? pricePath : totalPath;
    const asset = s3?.asset_registry.find((a) => (a.sources as Array<{ evidence_id: string; asset_index: number }>).some((x) => x.evidence_id === e.evidence_id && x.asset_index === idx));
    return {
      kind: 'VEHICLE' as const,
      object: [text(d.vehicle_name) ?? text(d.asset_name) ?? parts.filter(Boolean).join(' '), text(d.color)].filter(Boolean).join(' · ') || null,
      objectKey: hard ? { value: hard, exact: true } : soft ? { value: soft, exact: false } : null,
      seller,
      asset_id: asset?.asset_id ?? null,
      price: value === null ? null : { value, source, doc_type_key: e.doc_type_key, fact_ids: [lookup.factOf(e.evidence_id, path)?.fact_id].filter((x): x is string => !!x) },
    };
  });
}

function collectDeals(lookup: Lookup, s3: MapDossierData | null, counterpartyOf: Map<string, string>): DealEntry[] {
  const out: DealEntry[] = [];
  for (const e of lookup.evidences) {
    const parties = (e.data?.parties as DocumentParty[] | undefined) ?? [];
    const sellerParty = parties.find((p) => p.party_role === 'SELLER');
    const seller = sellerParty ? counterpartyOf.get(mentionKey({ evidence_id: e.evidence_id, party_index: sellerParty.party_index })) ?? null : null;
    if (e.doc_type_key === 'vehicle_sale_contract') out.push(...vehicleEntries(e, lookup, s3, seller, 'CONTRACT'));
    if (e.doc_type_key === 'asset_quote') {
      const quoter = counterpartyOf.get(mentionKey({ evidence_id: e.evidence_id, party_index: null })) ?? seller;
      out.push(...vehicleEntries(e, lookup, s3, quoter, 'QUOTE'));
    }
    if (e.doc_type_key === 'goods_purchase_contract' || e.doc_type_key === 'purchase_list') {
      const path = e.doc_type_key === 'goods_purchase_contract' ? 'contract_info.total_amount' : 'funding_plan.total_amount';
      const v = valueAt(e.data, path);
      const number = e.doc_type_key === 'goods_purchase_contract' ? normKey(text(valueAt(e.data, 'contract_info.contract_number'))) : null;
      out.push({
        kind: 'GOODS',
        object: text(valueAt(e.data, 'goods_summary.goods_description')),
        objectKey: number ? { value: number, exact: true } : null,
        seller,
        asset_id: null,
        price: typeof v === 'number'
          ? { value: v, source: e.doc_type_key === 'goods_purchase_contract' ? 'CONTRACT' : 'PURCHASE_LIST', doc_type_key: e.doc_type_key, fact_ids: [lookup.factOf(e.evidence_id, path)?.fact_id].filter((x): x is string => !!x) }
          : null,
      });
    }
  }
  return out;
}

/** Cùng giao dịch: cùng loại; xe → cùng khóa đối tượng (số khung / máy, hoặc hãng|model|năm) và không khác bên bán; hàng hóa → cùng bên bán. */
function sameDeal(a: DealEntry, b: DealEntry): boolean {
  if (a.kind !== b.kind) return false;
  const sellersCompatible = !a.seller || !b.seller || a.seller === b.seller;
  if (a.kind === 'VEHICLE') {
    // S3 đã gom cùng tài sản → cùng giao dịch; khác asset_id (thường do thiếu số khung) vẫn xét tiếp theo khóa đối tượng.
    if (a.asset_id && a.asset_id === b.asset_id) return true;
    return !!a.objectKey && !!b.objectKey && a.objectKey.value === b.objectKey.value && sellersCompatible && !!(a.seller || b.seller || a.objectKey.exact);
  }
  return !!a.seller && a.seller === b.seller;
}

export function buildTrade(lookup: Lookup, s3: MapDossierData | null): TradeResult {
  const { counterparties, counterpartyOf } = buildCounterparties(lookup);
  const groups: DealEntry[][] = [];
  for (const d of collectDeals(lookup, s3, counterpartyOf)) {
    const hit = groups.find((g) => g.some((x) => sameDeal(x, d)));
    if (hit) hit.push(d); else groups.push([d]);
  }
  const deals = groups.map((g, i): PurchaseDeal => {
    const prices = g.flatMap((d) => (d.price ? [d.price] : []));
    const contract = prices.find((p) => p.source === 'CONTRACT');
    const quotes = prices.filter((p) => p.source === 'QUOTE').map((p) => p.value);
    const list = prices.find((p) => p.source === 'PURCHASE_LIST');
    return {
      deal_id: `deal-${i + 1}`,
      kind: g[0].kind,
      object: g.map((d) => d.object).find((x): x is string => !!x) ?? null,
      seller_counterparty_id: g.map((d) => d.seller).find((x): x is string => !!x) ?? null,
      asset_id: g.map((d) => d.asset_id).find((x): x is string => !!x) ?? null,
      link: g.length === 1 ? 'SINGLE' : new Set(g.map((d) => d.asset_id)).size === 1 && g[0].asset_id || (g.every((d) => d.objectKey?.exact) && new Set(g.map((d) => d.objectKey!.value)).size === 1) ? 'EXACT' : 'PARTIAL',
      prices,
      price: contract?.value ?? (quotes.length ? Math.min(...quotes) : list?.value ?? null),
    };
  });
  return { counterparties, counterpartyOf, deals };
}
