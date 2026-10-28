// Customer 360 cho người ra quyết định (D-113): một dải tóm tắt (khoản vay, người, thu nhập, HKD, TSBĐ) + danh sách "cần chú ý" xếp theo
// mức độ, gom từ mọi nguồn đã có (đối chiếu chứng từ, cảnh báo S3, hồ sơ 360). Thuần, không phụ thuộc React để test được.
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import type { ClaimsSummary } from './claims-view';
import type { Customer360Summary } from './customer360-view';

export type AttentionSeverity = 'danger' | 'warning' | 'info';

export interface AttentionItem {
  severity: AttentionSeverity;
  /** Ai / cái gì: tên người, "Hộ kinh doanh …", "Khoản vay", "Hồ sơ". */
  subject: string;
  title: string;
  detail?: string;
}

export interface IncomeLine {
  incomeId: string;
  kindLabel: string;
  personName: string | null;
  businessName: string | null;
  monthly: number | null;
  /** Có chứng từ chứng minh nguồn thu tồn tại (sao kê lương, GCN ĐKHKD…), không chỉ lời khai. */
  evidenced: boolean;
}

export interface BusinessLine {
  businessId: string;
  name: string | null;
  registrationNumber: string | null;
  businessLine: string | null;
  ownerNames: string[];
  /** Chủ hộ đã xác minh bằng số CCCD trên GCN ĐKHKD. */
  ownerVerified: boolean;
  /** Nhãn loại chứng từ nhắc tới đơn vị. */
  documents: string[];
}

export interface Decision360 {
  loan: { requested: number | null; proposed: number | null; termMonths: number | null; interestRate: number | null; disputed: string[] } | null;
  borrower: string | null;
  counts: { people: number; orgs: number; assets: number; collateral: number };
  income: { monthlyTotal: number | null; lines: IncomeLine[]; unevidenced: number };
  businesses: BusinessLine[];
  attention: AttentionItem[];
}

export const INCOME_KIND_LABELS: Record<string, string> = {
  salary: 'Lương', rental: 'Cho thuê tài sản', household_business: 'Hộ kinh doanh', trip_trading: 'Kinh doanh vận tải', enterprise: 'Doanh nghiệp', other: 'Khác',
};
const LOAN_LABELS: Record<string, string> = {
  requested_amount: 'Số tiền đề nghị', bank_proposed_amount: 'Số tiền đề xuất', loan_term_months: 'Thời hạn', interest_rate: 'Lãi suất',
};
const ORDER: Record<AttentionSeverity, number> = { danger: 0, warning: 1, info: 2 };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function buildDecision360(
  result: AppraisalResult,
  summary: Customer360Summary | null,
  claims: ClaimsSummary | null,
  docLabel: (key: string) => string,
): Decision360 {
  const profile = result.profile_360 ?? null;
  const names = new Map((summary?.people ?? []).map((p) => [p.personId, p.name]));
  const nameOf = (id: string | null) => (id ? names.get(id) ?? id : null);
  const attention: AttentionItem[] = [];

  // Khoản vay: số từ hồ sơ 360 (đã chọn giá trị, biết trường nào tranh chấp).
  const loan = profile ? {
    requested: num(profile.loan.requested_amount.value),
    proposed: num(profile.loan.bank_proposed_amount.value),
    termMonths: num(profile.loan.loan_term_months.value),
    interestRate: num(profile.loan.interest_rate.value),
    disputed: Object.entries(profile.loan).filter(([, f]) => f.trust === 'DISPUTED').map(([k]) => LOAN_LABELS[k] ?? k),
  } : null;
  if (loan && loan.disputed.length > 0) {
    attention.push({ severity: 'danger', subject: 'Khoản vay', title: 'Các giấy đề nghị vay ghi khác nhau', detail: loan.disputed.join(', ') });
  }

  // Đối chiếu giữa chứng từ: mỗi nhóm mâu thuẫn là một câu hỏi cho người thẩm định.
  for (const g of claims?.groups ?? []) {
    if (g.tone !== 'danger' && g.tone !== 'warning') continue;
    attention.push({ severity: g.tone, subject: g.subjectName, title: `${g.fieldLabel}: chứng từ ghi khác nhau`, detail: g.summary });
  }

  // Cảnh báo của S3 trên người / tài sản.
  for (const p of summary?.people ?? []) for (const a of p.alerts) attention.push({ severity: 'warning', subject: p.name, title: a });
  for (const a of summary?.assets ?? []) for (const x of a.alerts) attention.push({ severity: 'warning', subject: `${a.typeLabel} · ${a.key}`, title: x });
  if (summary && summary.unmapped > 0) {
    attention.push({ severity: 'warning', subject: 'Hồ sơ', title: `${summary.unmapped} người trên chứng từ chưa gắn được vào hồ sơ`, detail: 'Có thể là người khác trùng tên, hoặc đọc sai số giấy tờ.' });
  }

  // Hộ kinh doanh.
  const businesses: BusinessLine[] = (profile?.business_units ?? []).map((u) => {
    const operates = (profile?.relations ?? []).filter((r) => r.type === 'OPERATES' && r.to === u.business_id);
    const line: BusinessLine = {
      businessId: u.business_id,
      name: str(u.name.value),
      registrationNumber: str(u.registration_number.value),
      businessLine: str(u.business_line.value),
      ownerNames: u.owner_person_ids.map((id) => nameOf(id)!),
      ownerVerified: operates.some((r) => r.verification === 'VERIFIED'),
      documents: u.mentioned_in.map((m) => docLabel(m.doc_type_key)),
    };
    const subject = `Hộ kinh doanh ${line.name ?? u.business_id}`;
    if (u.flags.includes('BUSINESS_NUMBER_MISMATCH')) attention.push({ severity: 'danger', subject, title: 'Cùng chủ, cùng tên nhưng số GCN ĐKHKD khác nhau' });
    if (u.flags.includes('BUSINESS_MATCH_REVIEW')) attention.push({ severity: 'warning', subject, title: 'Chứng từ kinh doanh chưa xác định thuộc hộ nào' });
    if (u.registration_number.trust === 'DISPUTED') attention.push({ severity: 'danger', subject, title: 'Mã số thuế / số GCN ghi khác nhau giữa các chứng từ' });
    if (!line.ownerVerified) attention.push({ severity: 'warning', subject, title: 'Chưa xác minh chủ hộ bằng GCN ĐKHKD', detail: 'Chủ hộ chỉ dựa trên lời khai (đơn vay / bảng kê) hoặc khớp theo tên.' });
    return line;
  });
  const businessName = new Map(businesses.map((b) => [b.businessId, b.name]));

  // Thu nhập: mỗi luồng một dòng, cộng một lần.
  const lines: IncomeLine[] = (profile?.income_streams ?? []).map((s) => ({
    incomeId: s.income_id,
    kindLabel: INCOME_KIND_LABELS[s.kind] ?? s.kind,
    personName: nameOf(s.person_id),
    businessName: s.business_id ? businessName.get(s.business_id) ?? null : null,
    monthly: s.monthly_amount,
    evidenced: s.evidenced,
  }));
  const amounts = lines.map((l) => l.monthly).filter((x): x is number => x !== null);
  const unevidenced = lines.filter((l) => !l.evidenced).length;
  for (const l of lines) {
    if (l.monthly === null) attention.push({ severity: 'warning', subject: l.personName ?? 'Hồ sơ', title: `Nguồn thu "${l.kindLabel}" không có số tiền` });
  }
  if (unevidenced > 0) {
    attention.push({ severity: 'info', subject: 'Thu nhập', title: `${unevidenced}/${lines.length} nguồn thu chỉ có lời khai, chưa có chứng từ chứng minh` });
  }
  for (const g of profile?.gaps ?? []) {
    if (g.code === 'INCOME_OWNER_NOT_MAPPED') attention.push({ severity: 'warning', subject: 'Thu nhập', title: `${g.count} nguồn thu chưa xác định của ai` });
    if (g.code === 'DECLARED_INCOME_NOT_LINKED') attention.push({ severity: 'info', subject: 'Thu nhập', title: `${g.count} dòng thu nhập khai trên đơn vay chưa đối chiếu được với chứng từ` });
    if (g.code === 'MERGE_POLICY_INVALID') attention.push({ severity: 'warning', subject: 'Hệ thống', title: 'Cấu hình chọn số tiền thu nhập lỗi: chưa tính tổng thu nhập' });
  }
  if (summary && summary.superseded > 0) attention.push({ severity: 'info', subject: 'Hồ sơ', title: `${summary.superseded} chứng từ đã bị bản mới hơn thay thế` });

  const assets = summary?.assets ?? [];
  return {
    loan,
    borrower: summary?.people.find((p) => p.roles.includes('borrower'))?.name ?? null,
    counts: {
      people: summary?.counts.people ?? 0,
      orgs: summary?.counts.orgs ?? 0,
      assets: assets.length,
      collateral: (profile?.assets ?? []).filter((a) => a.usage_contexts.includes('collateral')).length,
    },
    income: { monthlyTotal: amounts.length > 0 ? amounts.reduce((n, x) => n + x, 0) : null, lines, unevidenced },
    businesses,
    attention: attention.map((a, i) => ({ a, i })).sort((x, y) => ORDER[x.a.severity] - ORDER[y.a.severity] || x.i - y.i).map((x) => x.a),
  };
}
