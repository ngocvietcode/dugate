// Chi tiết cho Customer 360 lấy từ `documents.evidences[].data` (đã có sẵn trong kết quả; `customer_360` của S3 chỉ giữ phần định danh nên mỏng).
// Thuần, tất định, chịu được dữ liệu thiếu. Mọi giá trị đều kèm nguồn (loại chứng từ) để người dùng truy ngược.
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import { formatCurrencyVnd } from './format';

/** Phần của evidence mà view đọc (khớp DossierEvidence, khai báo hẹp để test không phải dựng cả envelope). */
export interface EvidenceLike {
  evidence_id: string;
  doc_type_key: string;
  doc_type_label?: string | null;
  file_name?: string | null;
  status?: string;
  data: Record<string, unknown> | null;
}

export interface DetailRow { label: string; value: string; source?: string }

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x): x is Rec => rec(x) !== null) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const money = (v: unknown): string | null => { const n = num(v); return n === null ? null : formatCurrencyVnd(n); };
const address = (v: unknown): string | null => str(rec(v)?.full_text) ?? str(v);

const ok = (e: EvidenceLike) => (e.status === undefined || e.status === 'SUCCESS') && e.data !== null;
const byType = (evs: ReadonlyArray<EvidenceLike>, key: string) => evs.filter((e) => e.doc_type_key === key && ok(e));
const row = (label: string, value: string | null | undefined, source?: string): DetailRow[] => (value ? [{ label, value, source }] : []);

// ── Nhãn ────────────────────────────────────────────────────────────────────
const GENDER: Record<string, string> = { MALE: 'Nam', FEMALE: 'Nữ' };
const PERIOD: Record<string, string> = { MONTHLY: '/tháng', ANNUAL: '/năm', POINT_IN_TIME: '' };
const LAND_PURPOSE: Record<string, string> = { ONT: 'Đất ở nông thôn', ODT: 'Đất ở đô thị', CLN: 'Đất trồng cây lâu năm' };
const INCOME_TYPE: Record<string, string> = { salary: 'Lương', rental: 'Cho thuê', household_business: 'Hộ kinh doanh', trip_trading: 'Buôn chuyến', enterprise: 'Doanh nghiệp', other: 'Khác' };
const DEBT_GROUP: Record<number, string> = { 1: 'Nhóm 1 (đủ tiêu chuẩn)', 2: 'Nhóm 2 (cần chú ý)', 3: 'Nhóm 3 (dưới tiêu chuẩn)', 4: 'Nhóm 4 (nghi ngờ)', 5: 'Nhóm 5 (có khả năng mất vốn)' };

// ── Người ───────────────────────────────────────────────────────────────────
export interface PersonDetail {
  /** Giới tính, SĐT, quốc tịch, nơi cấp giấy tờ… ngoài những gì S3 đã gom. */
  personal: DetailRow[];
  /** Hộ kinh doanh / doanh nghiệp (business_info của đơn vay). */
  business: DetailRow[];
  /** Nguồn thu nhập theo bảng kê thu nhập. */
  income: DetailRow[];
  /** Tín dụng (CIC): nhóm nợ, nợ xấu, truy vấn. */
  credit: DetailRow[];
}

/** Party của chứng từ khớp `person_id` (theo mapped_evidences) → tìm party đầy đủ nhất cho từng trường. */
function partiesOf(map: MapDossierData, personId: string, evs: ReadonlyArray<EvidenceLike>): Array<{ party: Rec; doc: string; evidenceId: string; partyIndex: number }> {
  const reg = (map.role_registry ?? []).find((p) => p.person_id === personId);
  const byId = new Map(evs.map((e) => [e.evidence_id, e]));
  const out: Array<{ party: Rec; doc: string; evidenceId: string; partyIndex: number }> = [];
  for (const m of (reg?.mapped_evidences ?? []) as Array<{ evidence_id?: string; party_index?: number; doc_type_key?: string }>) {
    const e = m.evidence_id ? byId.get(m.evidence_id) : undefined;
    if (!e || !ok(e) || typeof m.party_index !== 'number') continue;
    const party = arr(e.data?.parties).find((p) => num(p.party_index) === m.party_index);
    if (party) out.push({ party, doc: e.doc_type_label ?? e.doc_type_key, evidenceId: e.evidence_id, partyIndex: m.party_index });
  }
  return out;
}

export function personDetail(map: MapDossierData, personId: string, evs: ReadonlyArray<EvidenceLike>, docLabel: (k: string) => string): PersonDetail {
  const parties = partiesOf(map, personId, evs);
  const first = <T,>(pick: (p: Rec) => T | null): { value: T; doc: string } | null => {
    for (const x of parties) { const v = pick(x.party); if (v !== null && v !== undefined) return { value: v, doc: x.doc }; }
    return null;
  };
  const isOrg = parties.some((x) => x.party.party_type === 'ORGANIZATION');

  const personal: DetailRow[] = [];
  const gender = first((p) => str(p.gender));
  const phone = first((p) => str(p.phone_number));
  const nation = first((p) => str(p.nationality));
  const idType = first((p) => str(p.id_type));
  const issueDate = first((p) => str(p.id_issue_date));
  const issuePlace = first((p) => str(p.id_issue_place));
  const cur = first((p) => address(p.current_address));
  if (!isOrg) {
    personal.push(...row('Giới tính', gender ? GENDER[gender.value] ?? gender.value : null, gender?.doc));
    personal.push(...row('Quốc tịch', nation?.value, nation?.doc));
    personal.push(...row('Loại giấy tờ', idType?.value, idType?.doc));
    personal.push(...row('Ngày cấp', issueDate?.value, issueDate?.doc));
    personal.push(...row('Nơi cấp', issuePlace?.value, issuePlace?.doc));
    personal.push(...row('Địa chỉ hiện tại', cur?.value, cur?.doc));
  }
  personal.push(...row('Điện thoại', phone?.value, phone?.doc));

  // Quan hệ khai trên đơn vay + quan hệ với khách vay
  const app = byType(evs, 'loan_application')[0];
  const mapped = (map.role_registry ?? []).find((p) => p.person_id === personId)?.mapped_evidences as Array<{ evidence_id?: string; party_index?: number }> | undefined;
  const anchorIdx = mapped?.find((m) => m.evidence_id === app?.evidence_id)?.party_index;
  const pd = typeof anchorIdx === 'number' ? arr(app?.data?.party_details).find((d) => num(d.party_index) === anchorIdx) : undefined;
  if (pd) {
    personal.push(...row('Quan hệ với khách vay (khai)', str(pd.relationship_to_borrower_raw), docLabel('loan_application')));
    personal.push(...row('Mục khai trên đơn', str(pd.form_section)?.replace(/^SECTION_/, 'Mục ').replace(/_/g, '.') ?? null));
  }

  // Hộ kinh doanh
  const business: DetailRow[] = [];
  const bizEntry = (map.customer_360 ?? []).find((c) => c.person_id === personId)?.business as Rec | null | undefined;
  if (bizEntry) {
    const src = docLabel('loan_application');
    business.push(...row('Tên', str(bizEntry.business_name), src), ...row('Ngành nghề', str(bizEntry.business_line), src),
      ...row('Địa điểm', address(bizEntry.business_address), src), ...row('Mã số thuế', str(bizEntry.tax_id), src), ...row('Số đăng ký', str(bizEntry.registration_number), src));
  }

  // Thu nhập (bảng kê): nguồn thu của người này
  const income: DetailRow[] = [];
  const idx = new Set(parties.filter((x) => byType(evs, 'income_statement').some((e) => e.evidence_id === x.evidenceId)).map((x) => x.partyIndex));
  for (const e of byType(evs, 'income_statement')) {
    for (const s of arr(e.data?.income_sources)) {
      if (idx.size > 0 && !idx.has(num(s.party_index) ?? -1)) continue;
      const type = str(s.income_type);
      const label = INCOME_TYPE[type ?? ''] ?? type ?? 'Nguồn thu';
      const monthly = money(s.monthly_amount);
      const hb = rec(s.household_business);
      const detail = [str(hb?.business_line), hb && num(hb.net_revenue_annual) !== null ? `DT ${money(hb.net_revenue_annual)}/năm` : null, hb && num(hb.net_profit_annual) !== null ? `LN ${money(hb.net_profit_annual)}/năm` : null].filter(Boolean).join(' · ');
      income.push(...row(label, [monthly ? `${monthly}/tháng` : null, detail || null].filter(Boolean).join(' · ') || null, docLabel('income_statement')));
    }
  }

  // Tín dụng CIC
  const credit: DetailRow[] = [];
  const cicIdx = new Map<string, number>();
  for (const x of parties) cicIdx.set(x.evidenceId, x.partyIndex);
  for (const e of byType(evs, 'cic')) {
    const mine = cicIdx.get(e.evidence_id);
    for (const r of arr(e.data?.reports)) {
      if (mine !== undefined && num(r.party_index) !== mine) continue;
      if (mine === undefined) continue;
      const src = docLabel('cic');
      const g = num(r.current_debt_group);
      credit.push(...row('Nhóm nợ hiện tại', g !== null ? DEBT_GROUP[g] ?? `Nhóm ${g}` : str(r.current_debt_group_raw), src));
      const flag = (k: string, label: string) => { const o = rec(r[k]); if (o && typeof o.has_records === 'boolean') credit.push(...row(label, o.has_records ? `Có${str(o.records_raw) ? ` — ${str(o.records_raw)}` : ''}` : 'Không', src)); };
      flag('bad_debt_5y', 'Nợ xấu 5 năm');
      flag('card_late_payment_3y', 'Chậm thanh toán thẻ 3 năm');
      flag('watchlist_debt_12m', 'Nợ cần chú ý 12 tháng');
      const q = num(r.queried_institutions_1y_count);
      credit.push(...row('Số TCTD truy vấn (1 năm)', q !== null ? String(q) : null, src));
      credit.push(...row('Ngày báo cáo', str(r.report_datetime), src));
    }
  }
  return { personal, business, income, credit };
}

// ── Tài sản ─────────────────────────────────────────────────────────────────
export interface AssetDetail {
  /** Thông tin vật lý / pháp lý (diện tích, mục đích, hình thức sở hữu, nhãn hiệu xe…). */
  physical: DetailRow[];
  /** Giá trị khai trên đơn vay, giá trị định giá từng chứng thư. */
  valuation: DetailRow[];
  /** Biến động đăng ký trên GCN (chuyển nhượng, thế chấp…). */
  changes: DetailRow[];
}

/** Dòng `asset_details` của chứng từ ứng với tài sản này, theo `asset_index` của nguồn trong registry. */
function assetRows(map: MapDossierData, assetId: string, evs: ReadonlyArray<EvidenceLike>): Array<{ e: EvidenceLike; d: Rec | undefined; assetIndex: number }> {
  const a = (map.asset_registry ?? []).find((x) => x.asset_id === assetId);
  const byId = new Map(evs.map((e) => [e.evidence_id, e]));
  const out: Array<{ e: EvidenceLike; d: Rec | undefined; assetIndex: number }> = [];
  for (const s of (a?.sources ?? []) as Array<{ evidence_id?: string; asset_index?: number }>) {
    const e = s.evidence_id ? byId.get(s.evidence_id) : undefined;
    if (!e || !ok(e) || typeof s.asset_index !== 'number') continue;
    out.push({ e, d: arr(e.data?.asset_details).find((x) => num(x.asset_index) === s.asset_index), assetIndex: s.asset_index });
  }
  return out;
}

export function assetDetail(map: MapDossierData, assetId: string, evs: ReadonlyArray<EvidenceLike>, docLabel: (k: string) => string): AssetDetail {
  const rows = assetRows(map, assetId, evs);
  const physical: DetailRow[] = [];
  const valuation: DetailRow[] = [];
  const changes: DetailRow[] = [];
  const seen = new Set<string>();
  const add = (list: DetailRow[], label: string, value: string | null, source: string) => {
    if (!value) return;
    const key = `${list === physical ? 'p' : list === valuation ? 'v' : 'c'}|${label}|${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ label, value, source });
  };

  for (const { e, d, assetIndex } of rows) {
    const src = docLabel(e.doc_type_key);
    if (e.doc_type_key === 'loan_application' && d) {
      add(physical, 'Loại TSBĐ (khai)', str(d.collateral_type_raw), src);
      add(valuation, 'Giá trị khai trên đơn', money(d.declared_value), src);
      add(physical, 'Chủ sở hữu (khai)', str(d.owner_names_raw), src);
      add(physical, 'Hãng xe', [str(d.vehicle_brand), str(d.vehicle_model)].filter(Boolean).join(' ') || null, src);
    }
    if ((e.doc_type_key === 'land_use_certificate' || e.doc_type_key === 'apartment_ownership_certificate' || e.doc_type_key === 'land_use_cert_to_buy') && d) {
      const purpose = str(d.land_use_purpose);
      add(physical, 'Diện tích đất', num(d.land_area_m2) !== null ? `${num(d.land_area_m2)} m²` : null, src);
      add(physical, 'Mục đích sử dụng', purpose ? LAND_PURPOSE[purpose] ?? purpose : null, src);
      add(physical, 'Thời hạn sử dụng', str(d.land_use_term_raw), src);
      add(physical, 'Nguồn gốc sử dụng', str(d.land_use_origin), src);
      add(physical, 'Loại nhà', str(d.house_type), src);
      add(physical, 'Diện tích xây dựng', num(d.construction_area_m2) !== null ? `${num(d.construction_area_m2)} m²` : null, src);
      add(physical, 'Diện tích sàn', num(d.floor_area_m2) !== null ? `${num(d.floor_area_m2)} m²` : null, src);
      add(physical, 'Số tầng', num(d.number_of_floors) !== null ? String(num(d.number_of_floors)) : null, src);
      add(physical, 'Hình thức sở hữu', str(d.ownership_form), src);
    }
    if (e.doc_type_key === 'vehicle_registration' && d) {
      add(physical, 'Nhãn hiệu / mẫu', [str(d.vehicle_brand), str(d.vehicle_model)].filter(Boolean).join(' ') || null, src);
      add(physical, 'Loại xe', str(d.vehicle_type), src);
      add(physical, 'Năm sản xuất', num(d.manufacture_year) !== null ? String(num(d.manufacture_year)) : null, src);
      add(physical, 'Màu', str(d.color), src);
      add(physical, 'Đăng ký lần đầu', str(d.first_registration_date), src);
    }
    if ((e.doc_type_key === 'external_valuation_certificate' || e.doc_type_key === 'real_estate_valuation_report' || e.doc_type_key === 'movable_asset_valuation_report') && d) {
      const v = rec(e.data?.valuation_info);
      const total = money(d.valuation_value);
      const by = [str(v?.appraisal_company), str(v?.valuation_date)].filter(Boolean).join(' · ');
      add(valuation, 'Giá trị định giá', total ? `${total}${by ? ` (${by})` : ''}` : null, src);
      add(valuation, 'Giá trị đất', money(d.land_value), src);
      add(valuation, 'Giá trị công trình', money(d.construction_value), src);
      add(valuation, 'Mục đích định giá', str(v?.valuation_purpose), src);
      add(valuation, 'Số chứng thư', str(v?.valuation_certificate_number), src);
    }
    // Biến động trên GCN: chỉ các biến động nhắc tới người/tài sản của chứng từ này
    if (e.doc_type_key === 'land_use_certificate' || e.doc_type_key === 'apartment_ownership_certificate') {
      for (const c of arr(e.data?.change_records)) {
        const text = [str(c.change_date), str(c.change_type), str(c.content_raw)].filter(Boolean).join(' · ');
        add(changes, 'Biến động', text || null, src);
      }
    }
    void assetIndex;
  }
  return { physical, valuation, changes };
}

// ── Khoản vay (từ đơn vay) ──────────────────────────────────────────────────
export interface LoanSummary {
  rows: DetailRow[];
  /** Mục đích vay (nhiều dòng). */
  purposes: string[];
  incomeDetails: DetailRow[];
}

export function loanSummary(evs: ReadonlyArray<EvidenceLike>, docLabel: (k: string) => string): LoanSummary | null {
  const app = byType(evs, 'loan_application')[0];
  if (!app) return null;
  const src = docLabel('loan_application');
  const loan = rec(app.data?.loan_info);
  const fin = rec(app.data?.financial_info);
  const coll = rec(app.data?.collateral_summary);
  const rows: DetailRow[] = [];
  if (loan) {
    rows.push(...row('Số tiền đề nghị', money(loan.requested_amount), src));
    rows.push(...row('Số tiền ngân hàng đề xuất', money(loan.bank_proposed_amount), src));
    const term = num(loan.loan_term_months);
    rows.push(...row('Thời hạn', term !== null ? `${term} tháng` : null, src));
    const rate = num(loan.interest_rate);
    rows.push(...row('Lãi suất', rate !== null ? `${rate}%/năm${str(loan.interest_rate_code) ? ` (${str(loan.interest_rate_code)})` : ''}` : str(loan.interest_rate_raw), src));
    const grace = num(loan.principal_grace_months);
    rows.push(...row('Ân hạn gốc', grace !== null && grace > 0 ? `${grace} tháng` : null, src));
    rows.push(...row('Phương thức giải ngân', str(loan.disbursement_method), src));
    rows.push(...row('Trả gốc', str(loan.principal_repayment_method), src));
    rows.push(...row('Trả lãi', str(loan.interest_repayment_method), src));
  }
  if (fin) {
    const total = money(fin.total_income);
    rows.push(...row('Tổng thu nhập khai', total ? `${total}${PERIOD[String(fin.total_income_period)] ?? ''}` : null, src));
    rows.push(...row('Nguồn trả nợ', str(fin.repayment_source), src));
    if (typeof fin.has_existing_debt === 'boolean') rows.push(...row('Nợ hiện hữu', fin.has_existing_debt ? `Có${money(fin.existing_monthly_debt_payment) ? ` — ${money(fin.existing_monthly_debt_payment)}/tháng` : ''}` : 'Không', src));
  }
  rows.push(...row('Tổng giá trị TSBĐ (khai)', money(coll?.total_collateral_value), src));
  const ltv = num(app.data?.ltv);
  rows.push(...row('LTV (khai)', ltv !== null ? `${ltv}%` : null, src));
  const purposes = [...(Array.isArray(loan?.loan_purposes) ? (loan!.loan_purposes as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []), ...(str(loan?.loan_purpose_detail) ? [str(loan!.loan_purpose_detail)!] : [])];
  const incomeDetails: DetailRow[] = arr(fin?.income_details).flatMap((d) => row(str(d.source) ?? 'Nguồn thu', money(d.amount) ? `${money(d.amount)}${PERIOD[String(d.period)] ?? ''}` : null, src));
  if (rows.length === 0 && purposes.length === 0 && incomeDetails.length === 0) return null;
  return { rows, purposes: [...new Set(purposes)], incomeDetails };
}
