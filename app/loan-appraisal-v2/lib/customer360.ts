// Customer 360 trên giao diện (D-114): CHỈ đọc `result.profile_360` — nguồn sự thật duy nhất, cùng số với stage 2 (DSCR / LTV).
// Không đọc OCR, sổ Claim hay `customer_360` trực tiếp. Trục đọc: vấn đề cần xử lý → đề nghị vay vốn → khách hàng → nguồn trả nợ → nghĩa vụ nợ
// → tài sản bảo đảm. Thuần, không phụ thuộc React để test được.
import type { LacTrust } from '@/lib/loan-dossier/context/schema';
import type { Collateral, Customer, DetailFact, Issue, Profile360, ProfileField } from '@/lib/loan-dossier/profile360/schema';
import { formatCurrencyVnd } from './format';
import { ASSET_LABELS, REL_LABELS, ROLE_LABELS } from './graph-view';
import type { Tone } from './tone';

export interface Row { label: string; value: string; /** "2 loại chứng từ khớp", "chỉ lời khai", "cần soát"… */ note: string | null; tone: Tone | null }

export interface CustomerCard {
  personId: string;
  name: string;
  isOrg: boolean;
  roleLabels: string[];
  identity: Row[];
  relations: Array<{ text: string; name: string; tone: Tone }>;
  /** Giấy tờ định danh: "CCCD 0123… · hết hạn 2025-01-01". */
  idDocuments: Row[];
  documents: string[];
  details: Row[];
  /** Số điểm cần xử lý (danger + warning) gắn với người này. */
  issueCount: number;
}

/** Giao dịch mua tài trợ bằng khoản vay (L360-G04) — hiển thị ngay dưới đề nghị vay để đối chiếu số tiền. */
export interface DealRow { object: string; seller: string; related: boolean; prices: string; price: string; mismatch: boolean }

export interface IncomeRow { kind: string; owner: string; business: string | null; monthly: string; evidenced: boolean }
export interface BusinessRow { kind: string; name: string; registration: string; line: string; owners: string; verified: boolean; documents: string[] }
export interface ObligationRow { kind: string; owner: string; lender: string; amount: string; note: string }
export interface CollateralCard {
  assetId: string;
  title: string;
  usage: string;
  confirmed: boolean;
  owners: string;
  valuations: Array<{ value: string; date: string; source: string; review: boolean }>;
  chosenValue: string | null;
  details: Row[];
  issueCount: number;
}

export interface Customer360View {
  issues: { items: Issue[]; danger: number; warning: number; info: number };
  loan: { rows: Row[]; purposes: string[]; disputed: boolean; deals: DealRow[] };
  customers: CustomerCard[];
  repayment: { monthlyTotal: string | null; dscrProfit: string | null; dscrRevenue: string | null; dscrLabel: string; income: IncomeRow[]; businesses: BusinessRow[] };
  obligations: ObligationRow[];
  collateral: CollateralCard[];
  counts: { customers: number; collateral: number };
}

const TRUST_NOTE: Record<LacTrust, { note: string; tone: Tone | null }> = {
  CORROBORATED: { note: 'nhiều loại chứng từ khớp', tone: 'success' },
  SINGLE_SOURCE: { note: '1 loại chứng từ', tone: null },
  DECLARED: { note: 'chỉ lời khai', tone: 'warning' },
  SPELLING_VARIANT: { note: 'khác cách viết', tone: null },
  PROBABLE_OCR_ERROR: { note: 'nghi đọc sai', tone: 'warning' },
  DISPUTED: { note: 'mâu thuẫn', tone: 'danger' },
  SUPERSEDED: { note: 'bản cũ', tone: null },
};
const MARITAL: Record<string, string> = { SINGLE: 'Độc thân', MARRIED: 'Đã kết hôn', DIVORCED: 'Ly hôn', WIDOWED: 'Góa' };
const INCOME_KIND: Record<string, string> = {
  salary: 'Lương', rental: 'Cho thuê tài sản', household_business: 'Hộ kinh doanh', trip_trading: 'Kinh doanh vận tải', enterprise: 'Doanh nghiệp', other: 'Khác',
};
const OBLIGATION_KIND: Record<string, string> = { DECLARED: 'Khai trên đơn vay', CREDIT_CONTRACT: 'HĐ tín dụng TCTD khác', CIC: 'CIC' };
const PRICE_SOURCE: Record<string, string> = { QUOTE: 'Báo giá', CONTRACT: 'HĐ mua', PURCHASE_LIST: 'Bảng kê' };
const USAGE: Record<string, string> = { collateral: 'Tài sản bảo đảm', rental_income: 'Tài sản cho thuê' };
const VERIFY_TONE: Record<string, Tone> = { VERIFIED: 'success', PARTIAL: 'warning', UNVERIFIED: 'warning', NOT_REQUIRED: 'neutral' };
const VERIFY_TEXT: Record<string, string> = { VERIFIED: 'đã xác minh', PARTIAL: 'xác minh một phần', UNVERIFIED: 'chưa xác minh', NOT_REQUIRED: '' };

const show = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : typeof v === 'boolean' ? (v ? 'Có' : 'Không') : String(v));

function trustRow(label: string, field: ProfileField, format: (v: string | number | boolean) => string = String): Row | null {
  if (field.value === null) return field.trust === 'DISPUTED' ? { label, value: 'Các chứng từ ghi khác nhau', note: TRUST_NOTE.DISPUTED.note, tone: 'danger' } : null;
  const t = field.trust ? TRUST_NOTE[field.trust] : null;
  const review = field.review === 'REVIEW';
  return { label, value: format(field.value), note: [t?.note, review ? 'cần soát' : null].filter(Boolean).join(' · ') || null, tone: t?.tone ?? (review ? 'warning' : null) };
}

function factRow(f: DetailFact, docLabel: (k: string) => string): Row {
  const t = TRUST_NOTE[f.trust];
  const value = typeof f.value === 'number' && /tiền|giá|thu|lợi nhuận|doanh/i.test(f.label) ? formatCurrencyVnd(f.value) : show(f.value) ?? '';
  return { label: f.label, value, note: [f.doc_types.map(docLabel).join(', '), t.tone ? t.note : null, f.review === 'REVIEW' ? 'cần soát' : null].filter(Boolean).join(' · ') || null, tone: t.tone };
}

const money = (v: string | number | boolean) => (typeof v === 'number' ? formatCurrencyVnd(v) : String(v));
const plain = (r: Row | null): r is Row => r !== null;

function customerCard(c: Customer, nameOf: (id: string) => string, docLabel: (k: string) => string, issues: readonly Issue[]): CustomerCard {
  const isOrg = c.party_type === 'ORGANIZATION';
  const org = c.organization;
  const candidates: Array<Row | null> = isOrg
    ? [
      org?.tax_id ? { label: 'Mã số thuế', value: org.tax_id, note: null, tone: null } : null,
      org?.registration_number ? { label: 'Số ĐKDN', value: org.registration_number, note: null, tone: null } : null,
      org?.headquarters_address ? { label: 'Trụ sở', value: org.headquarters_address, note: null, tone: null } : null,
    ]
    : [
      trustRow('Số định danh', c.id_number),
      c.historical_id_numbers.length > 0 ? { label: 'Số cũ', value: c.historical_id_numbers.join(', '), note: null, tone: null } : null,
      trustRow('Ngày sinh', c.date_of_birth),
      c.permanent_address ? { label: 'Thường trú', value: c.permanent_address, note: null, tone: null } : null,
      c.current_address && c.current_address !== c.permanent_address ? { label: 'Hiện tại', value: c.current_address, note: null, tone: null } : null,
      c.marital_status ? { label: 'Hôn nhân', value: MARITAL[c.marital_status] ?? c.marital_status, note: null, tone: null } : null,
    ];
  const identity = candidates.filter(plain);
  const relations = c.relations.map((r) => {
    const base = r.type === 'SPOUSE_OF' ? 'Vợ/chồng'
      : r.type === 'RELATIVE_OF' ? `Nhân thân (${REL_LABELS[r.detail?.split(' · ')[0] ?? 'UNKNOWN'] ?? r.detail?.split(' · ')[0] ?? 'chưa phân loại'})`
      : r.type === 'HOUSEHOLD_MEMBER_OF' ? `Cùng hộ, chủ hộ${r.detail ? ` (${r.detail})` : ''}`
      : r.type === 'REPRESENTED_BY' ? `Người đại diện theo pháp luật${org?.representative_position ? ` (${org.representative_position})` : ''}`
      : 'Đại diện theo pháp luật của';
    const v = VERIFY_TEXT[r.verification];
    return { text: v ? `${base} · ${v}` : base, name: nameOf(r.person_id), tone: VERIFY_TONE[r.verification] };
  });
  return {
    personId: c.person_id,
    name: nameOf(c.person_id),
    isOrg,
    roleLabels: c.roles.map((r) => { const [role, detail] = r.split(':'); return detail ? `${ROLE_LABELS[role] ?? role} (${detail})` : ROLE_LABELS[role] ?? role; }),
    identity,
    relations,
    idDocuments: c.id_documents.map((d) => ({
      label: docLabel(d.doc_type_key),
      value: [d.number, d.issue_date ? `cấp ${d.issue_date}` : null].filter(Boolean).join(' · ') || '—',
      note: d.valid_until ? `${d.expired ? 'hết hạn' : 'hiệu lực đến'} ${d.valid_until}` : null,
      tone: d.expired ? 'danger' : null,
    })),
    documents: c.documents.map((d) => `${docLabel(d.doc_type_key)}${d.count > 1 ? ` ×${d.count}` : ''}`),
    details: c.details.map((f) => factRow(f, docLabel)),
    issueCount: issues.filter((i) => i.subject_id === c.person_id && i.severity !== 'info').length,
  };
}

function collateralCard(a: Collateral, nameOf: (id: string) => string, docLabel: (k: string) => string, issues: readonly Issue[]): CollateralCard {
  return {
    assetId: a.asset_id,
    title: `${ASSET_LABELS[a.asset_type] ?? a.asset_type}${a.key ? ` · ${a.key}` : ''}`,
    usage: a.usage_contexts.map((u) => USAGE[u] ?? u).join(', ') || 'Chưa xác định mục đích',
    confirmed: a.context_status === 'CONFIRMED',
    owners: a.owners.length === 0 ? 'Chưa xác định' : a.owners.map((o) => `${nameOf(o.person_id)}${o.current ? '' : ' (trước đây)'}`).join(', '),
    valuations: a.valuations.map((v) => ({ value: formatCurrencyVnd(v.value), date: v.valuation_date ?? '—', source: [docLabel(v.doc_type_key), v.appraiser].filter(Boolean).join(' · '), review: v.review === 'REVIEW' })),
    chosenValue: a.chosen_value === null ? null : formatCurrencyVnd(a.chosen_value),
    details: a.details.map((f) => factRow(f, docLabel)),
    issueCount: issues.filter((i) => i.subject_id === a.asset_id && i.severity !== 'info').length,
  };
}

export function buildCustomer360View(p: Profile360, docLabel: (key: string) => string): Customer360View {
  const names = new Map(p.customers.map((c) => [c.person_id, show(c.full_name.value) ?? c.person_id]));
  const nameOf = (id: string | null) => (id ? names.get(id) ?? id : 'Chưa xác định');
  const units = new Map(p.business_units.map((u) => [u.business_id, show(u.name.value) ?? u.business_id]));
  const basis = p.financial_basis;
  const monthly = p.income_streams.map((s) => s.monthly_amount).filter((x): x is number => x !== null);
  const loanFields = p.loan;
  const cps = new Map(p.counterparties.map((c) => [c.counterparty_id, c]));
  return {
    issues: {
      items: p.issues,
      danger: p.issues.filter((i) => i.severity === 'danger').length,
      warning: p.issues.filter((i) => i.severity === 'warning').length,
      info: p.issues.filter((i) => i.severity === 'info').length,
    },
    loan: {
      rows: [
        trustRow('Số tiền đề nghị', loanFields.requested_amount, money),
        trustRow('Số tiền ngân hàng đề xuất', loanFields.bank_proposed_amount, money),
        trustRow('Thời hạn', loanFields.loan_term_months, (v) => `${v} tháng`),
        trustRow('Lãi suất', loanFields.interest_rate, (v) => `${v}%/năm`),
      ].filter(plain),
      purposes: loanFields.purposes,
      deals: p.purchase_deals.map((d) => {
        const cp = d.seller_counterparty_id ? cps.get(d.seller_counterparty_id) : undefined;
        const values = new Set(d.prices.filter((x) => x.source !== 'PURCHASE_LIST').map((x) => x.value));
        return {
          object: d.object ?? (d.kind === 'VEHICLE' ? 'Phương tiện' : 'Hàng hóa'),
          seller: cp?.name ?? 'Chưa rõ bên bán',
          related: !!cp?.person_id,
          prices: d.prices.map((x) => `${PRICE_SOURCE[x.source]} ${formatCurrencyVnd(x.value)}`).join(' · '),
          price: d.price === null ? '—' : formatCurrencyVnd(d.price),
          mismatch: values.size > 1,
        };
      }),
      disputed: [loanFields.requested_amount, loanFields.bank_proposed_amount, loanFields.loan_term_months, loanFields.interest_rate].some((f) => f.trust === 'DISPUTED'),
    },
    customers: p.customers.map((c) => customerCard(c, nameOf, docLabel, p.issues)),
    repayment: {
      monthlyTotal: monthly.length > 0 ? formatCurrencyVnd(monthly.reduce((n, x) => n + x, 0)) : null,
      // SME: lợi nhuận trước thuế + lãi vay của BCKQKD gần nhất (OQ-360-13); HKD: tổng lợi nhuận các HKD. Cùng số stage 2 dùng.
      dscrProfit: (() => { const b = p.application.segment === 'SME' ? basis.sme_profit_before_interest : basis.hkd_annual_profit; return b ? formatCurrencyVnd(b.value) : null; })(),
      dscrRevenue: (() => { const b = p.application.segment === 'SME' ? basis.sme_annual_revenue : basis.hkd_annual_revenue; return b ? formatCurrencyVnd(b.value) : null; })(),
      dscrLabel: p.application.segment === 'SME' ? 'lợi nhuận trước thuế + lãi vay' : 'lợi nhuận hộ kinh doanh',
      income: p.income_streams.map((s) => ({
        kind: INCOME_KIND[s.kind] ?? s.kind,
        owner: nameOf(s.person_id),
        business: s.business_id ? units.get(s.business_id) ?? null : null,
        monthly: s.monthly_amount === null ? '—' : formatCurrencyVnd(s.monthly_amount),
        evidenced: s.evidenced,
      })),
      businesses: p.business_units.map((u) => ({
        kind: u.kind === 'ENTERPRISE' ? 'Doanh nghiệp' : 'Hộ kinh doanh',
        name: show(u.name.value) ?? 'Chưa rõ tên',
        registration: show(u.registration_number.value) ?? (u.registration_number.trust === 'DISPUTED' ? 'Ghi khác nhau' : 'Chưa có'),
        line: show(u.business_line.value) ?? '—',
        owners: u.owner_person_ids.map((id) => nameOf(id)).join(', ') || 'Chưa xác định',
        verified: p.relations.some((r) => r.type === 'OPERATES' && r.to === u.business_id && r.verification === 'VERIFIED'),
        documents: u.mentioned_in.map((m) => `${docLabel(m.doc_type_key)}${m.count > 1 ? ` ×${m.count}` : ''}`),
      })),
    },
    obligations: p.obligations.map((o) => ({
      kind: OBLIGATION_KIND[o.kind] ?? o.kind,
      owner: nameOf(o.person_id),
      lender: o.lender ?? '—',
      amount: o.monthly_payment !== null ? `${formatCurrencyVnd(o.monthly_payment)}/tháng` : o.principal !== null ? formatCurrencyVnd(o.principal) : '—',
      note: [o.debt_group ? `nhóm nợ ${o.debt_group}` : null, o.maturity_date ? `đáo hạn ${o.maturity_date}` : null].filter(Boolean).join(' · '),
    })),
    collateral: p.collateral.map((a) => collateralCard(a, nameOf, docLabel, p.issues)),
    counts: { customers: p.customers.length, collateral: p.collateral.filter((a) => a.usage_contexts.includes('collateral')).length },
  };
}
