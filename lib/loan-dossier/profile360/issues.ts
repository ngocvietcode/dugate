// Mâu thuẫn và danh sách DUY NHẤT các điểm cần xử lý (D-114). Mâu thuẫn lấy từ LAC (đã bỏ bản bị thay thế, có LAC-R03 đơn vay trùng),
// không từ sổ Claim; cờ S3 trùng với một mâu thuẫn cùng chủ thể / cùng trường bị gộp. Hàm thuần, tất định, không log.
import type { LoanApplicationContext } from '../context/schema';
import type { BusinessResult } from './business';
import type { MergePolicies } from './policies';
import type { Collateral, Conflict, Customer, IncomeStream, Issue, IssueCode, Obligation } from './schema';

export const ASSET_TYPE_LABELS: Record<string, string> = {
  real_estate: 'Bất động sản', apartment: 'Căn hộ', vehicle: 'Xe', deposit: 'Tiền gửi', other: 'Tài sản',
};
export const INCOME_KIND_LABELS: Record<string, string> = {
  salary: 'Lương', rental: 'Cho thuê tài sản', household_business: 'Hộ kinh doanh', trip_trading: 'Kinh doanh vận tải', enterprise: 'Doanh nghiệp', other: 'Khác',
};
const SEVERITY_ORDER = { danger: 0, warning: 1, info: 2 } as const;

export interface IssueInput {
  lac: LoanApplicationContext;
  customers: readonly Customer[];
  business: BusinessResult;
  income: readonly IncomeStream[];
  obligations: readonly Obligation[];
  collateral: readonly Collateral[];
  policies: MergePolicies | null;
  declaredIncomeRows: number;
}

export function subjectLabeler(customers: readonly Customer[], collateral: readonly Collateral[], business: BusinessResult) {
  const names = new Map(customers.map((c) => [c.person_id, typeof c.full_name.value === 'string' ? c.full_name.value : c.person_id]));
  const assets = new Map(collateral.map((a) => [a.asset_id, `${ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}${a.key ? ` · ${a.key}` : ''}`]));
  const units = new Map(business.units.map((u) => [u.business_id, `Hộ kinh doanh ${typeof u.name.value === 'string' ? u.name.value : u.business_id}`]));
  return (id: string | null): string => {
    if (!id) return 'Hồ sơ';
    if (id === 'loan') return 'Khoản vay';
    if (id.startsWith('business')) return 'Hoạt động kinh doanh';
    if (id.startsWith('doc-')) return 'Chứng từ';
    return names.get(id) ?? assets.get(id) ?? units.get(id) ?? id;
  };
}

export function buildConflicts(lac: LoanApplicationContext, label: (id: string) => string): Conflict[] {
  const facts = new Map(lac.facts.map((f) => [f.fact_id, f]));
  return lac.conflicts.map((c) => ({
    conflict_id: c.conflict_id,
    subject_id: c.subject_id,
    subject_label: label(c.subject_id),
    field: c.field,
    field_label: facts.get(c.fact_ids[0])?.label ?? c.field,
    kind: c.kind,
    options: c.fact_ids.map((id) => {
      const f = facts.get(id)!;
      return { fact_id: id, value: f.value, doc_types: [...new Set(f.sources.map((s) => s.doc_type_key))] };
    }),
  }));
}

export function buildIssues(input: IssueInput, conflicts: readonly Conflict[], label: (id: string | null) => string): Issue[] {
  const { lac, customers, business, income, obligations, collateral, policies } = input;
  const out: Issue[] = [];
  const push = (severity: Issue['severity'], code: IssueCode, subject_id: string | null, title: string, detail: string | null = null) =>
    out.push({ severity, code, subject_id, subject_label: label(subject_id), title, detail });

  // 1. Mâu thuẫn giữa chứng từ (đã bỏ bản bị thay thế).
  for (const c of conflicts) {
    const detail = c.options.map((o) => `${String(o.value)} (${o.doc_types.join(', ')})`).join(' ≠ ');
    if (c.kind === 'DISPUTED') push('danger', 'FIELD_CONFLICT', c.subject_id, `${c.field_label}: các chứng từ ghi khác nhau`, detail);
    else push('warning', 'PROBABLE_OCR_ERROR', c.subject_id, `${c.field_label}: nghi đọc sai một ký tự`, detail);
  }
  const conflictOn = (subjectId: string, suffix: string) => conflicts.some((c) => c.subject_id === subjectId && c.field.endsWith(suffix));

  // 2. Khách hàng: cờ của S3, quan hệ nhân thân chưa xác minh đủ.
  for (const c of customers) {
    if (c.flags.includes('ROLE_CONFLICT')) push('danger', 'ROLE_CONFLICT', c.person_id, 'Hai giấy tờ định danh khác người cho cùng một vai trò');
    // Gộp trùng: mâu thuẫn số định danh đã nêu ở mục 1 thì không nêu lại cờ S3.
    if (c.flags.includes('ID_NUMBER_REVIEW') && !conflictOn(c.person_id, 'id_number')) push('warning', 'ID_NUMBER_REVIEW', c.person_id, 'Số định danh cần rà soát');
    if (c.flags.includes('LOW_MATCH_CONFIDENCE')) push('warning', 'LOW_MATCH_CONFIDENCE', c.person_id, 'Có chứng từ được ghép vào người này với độ tin cậy thấp');
    for (const r of c.relations) {
      if (r.type === 'RELATIVE_OF' && (r.verification === 'UNVERIFIED' || r.verification === 'PARTIAL') && c.person_id < r.person_id) {
        push('warning', 'RELATIVE_NOT_VERIFIED', c.person_id, `Quan hệ nhân thân với ${label(r.person_id)} chưa xác minh đủ`, r.detail);
      }
    }
  }
  for (const g of lac.gaps) {
    if (g.code === 'PARTY_NOT_MAPPED') push('warning', 'PARTY_NOT_MAPPED', null, `${g.count} người trên chứng từ chưa gắn được vào hồ sơ`, 'Có thể là người khác trùng tên, hoặc đọc sai số giấy tờ.');
    if (g.code === 'EVIDENCE_READ_ERROR') push('warning', 'EVIDENCE_READ_ERROR', null, `${g.count} chứng từ không đọc được`);
    if (g.code === 'SUPERSEDED_EVIDENCE') push('info', 'SUPERSEDED_EVIDENCE', null, `${g.count} chứng từ đã bị bản mới hơn thay thế`);
  }

  // 3. Hộ kinh doanh.
  for (const u of business.units) {
    if (u.flags.includes('BUSINESS_NUMBER_MISMATCH')) push('danger', 'BUSINESS_NUMBER_MISMATCH', u.business_id, 'Cùng chủ, cùng tên nhưng số GCN ĐKHKD khác nhau');
    if (u.flags.includes('BUSINESS_MATCH_REVIEW')) push('warning', 'BUSINESS_MATCH_REVIEW', u.business_id, 'Chứng từ kinh doanh chưa xác định thuộc hộ nào');
    if (u.registration_number.trust === 'DISPUTED' || u.tax_id.trust === 'DISPUTED') push('danger', 'FIELD_CONFLICT', u.business_id, 'Số GCN / mã số thuế ghi khác nhau giữa các chứng từ');
    if (!business.relations.some((r) => r.to === u.business_id && r.verification === 'VERIFIED')) {
      push('warning', 'BUSINESS_OWNER_NOT_VERIFIED', u.business_id, 'Chưa xác minh chủ hộ bằng GCN ĐKHKD', 'Chủ hộ chỉ dựa trên lời khai (đơn vay / bảng kê) hoặc khớp theo tên.');
    }
  }

  // 4. Nguồn thu.
  for (const s of income) {
    const kind = INCOME_KIND_LABELS[s.kind] ?? s.kind;
    if (s.person_id === null) continue; // đếm chung ở gap dưới
    if (s.monthly_amount === null && s.annual_profit === null) push('warning', 'INCOME_AMOUNT_MISSING', s.person_id, `Nguồn thu "${kind}" không có số tiền`);
    else if (!s.evidenced) push('info', 'INCOME_NOT_EVIDENCED', s.person_id, `Nguồn thu "${kind}" chỉ có lời khai, chưa có chứng từ chứng minh`);
  }
  const unmapped = income.filter((s) => s.person_id === null).length;
  if (unmapped > 0) push('warning', 'INCOME_OWNER_NOT_MAPPED', null, `${unmapped} nguồn thu chưa xác định của ai`);
  if (input.declaredIncomeRows > 0) push('info', 'DECLARED_INCOME_NOT_LINKED', 'loan', `${input.declaredIncomeRows} dòng thu nhập khai trên đơn vay chưa đối chiếu được với chứng từ`);

  // 5. Nghĩa vụ nợ.
  for (const o of obligations) {
    if (o.kind === 'CIC' && o.debt_group !== null && Number(o.debt_group) >= 2) push('danger', 'ADVERSE_DEBT_GROUP', o.person_id, `CIC: nợ nhóm ${o.debt_group}`);
  }
  const declaredNone = obligations.every((o) => o.kind !== 'DECLARED');
  const contracts = obligations.filter((o) => o.kind === 'CREDIT_CONTRACT');
  if (declaredNone && contracts.length > 0) push('warning', 'UNDECLARED_DEBT', 'loan', `Có ${contracts.length} HĐ tín dụng tại TCTD khác nhưng đơn vay không khai nợ hiện hữu`);

  // 6. Tài sản bảo đảm.
  for (const a of collateral) {
    if (!a.usage_contexts.includes('collateral')) continue;
    if (a.context_status !== 'CONFIRMED') push('warning', 'COLLATERAL_CONTEXT_AMBIGUOUS', a.asset_id, 'Chưa xác định chắc tài sản này là TSBĐ của khoản vay');
    if (a.valuations.length === 0) push('warning', 'COLLATERAL_NOT_VALUED', a.asset_id, 'Chưa có chứng thư định giá');
    else if (policies) {
      const lo = Math.min(...a.valuations.map((v) => v.value)); const hi = Math.max(...a.valuations.map((v) => v.value));
      if (lo > 0 && (hi - lo) / lo > policies.valuation_gap_ratio) push('warning', 'VALUATION_GAP', a.asset_id, `Các chứng thư định giá chênh nhau ${Math.round(((hi - lo) / lo) * 100)}%`, 'LTV tính trên giá thấp nhất (D-112).');
    }
  }
  if (!policies) push('warning', 'MERGE_POLICY_INVALID', null, 'Cấu hình chọn giá trị (merge_policies.json) lỗi: chưa chọn số thu nhập và giá trị TSBĐ');

  // Gộp trùng tuyệt đối, xếp nặng trước, giữ thứ tự xuất hiện trong cùng mức.
  const seen = new Set<string>();
  return out
    .filter((i) => { const k = `${i.code}\u0000${i.subject_id}\u0000${i.title}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((i, n) => ({ i, n }))
    .sort((a, b) => SEVERITY_ORDER[a.i.severity] - SEVERITY_ORDER[b.i.severity] || a.n - b.n)
    .map((x) => x.i);
}
