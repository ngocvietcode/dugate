// Claim đáng chú ý → dữ liệu hiển thị. Thuần, không phụ thuộc React để test được.
// Nhìn từ NGƯỜI DÙNG: "thông tin nào do chứng từ nào khẳng định, và chỗ nào các chứng từ không khớp nhau". Nhãn field dùng lại `labelOf` của dossier-view.
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { StoredClaim, StoredClaims } from '@/lib/loan-dossier/graph/claims-store';
import { labelOf } from './dossier-view';
import { ASSET_LABELS } from './graph-view';

export type ClaimTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  CORROBORATED: 'Nhiều chứng từ khớp nhau',
  DISPUTED: 'Các chứng từ không khớp',
  PROBABLE_OCR_ERROR: 'Nghi lỗi đọc chữ',
  SPELLING_VARIANT: 'Khác cách viết',
  DECLARED: 'Khai trên đơn vay',
  SINGLE_SOURCE: 'Một chứng từ',
};

export const CLAIM_STATUS_TONE: Record<string, ClaimTone> = {
  CORROBORATED: 'success', DISPUTED: 'danger', PROBABLE_OCR_ERROR: 'warning', SPELLING_VARIANT: 'info', DECLARED: 'neutral', SINGLE_SOURCE: 'neutral',
};

export const UNRESOLVED_LABELS: Record<string, string> = {
  NO_SUBJECT_INDEX: 'Chứng từ không ghi rõ thông tin này của ai',
  PARTY_NOT_MAPPED: 'Người trên chứng từ chưa gắn được vào hồ sơ',
  ASSET_NOT_MAPPED: 'Tài sản trên chứng từ chưa gắn được vào hồ sơ',
  NO_SUBJECT_KIND: 'Chưa xác định đối tượng của thông tin',
};

/** Trường nào đáng hiện trong danh sách "các chứng từ đồng thuận" (định danh); phần còn lại chỉ hiện khi có tranh chấp. */
const CORROBORATION_FIELDS = /(^|\.)(id_number|date_of_birth|tax_id|certificate_number|certificate_book_number|land_parcel_number|map_sheet_number|license_plate|chassis_number|engine_number|registration_number|apartment_number)$/;

export interface ClaimSourceView {
  /** Loại chứng từ đã đổi sang nhãn tiếng Việt. */
  doc: string;
  /** Nguyên văn nguồn này ghi, chỉ có khi khác giá trị hiển thị. */
  raw: string | null;
  /** Độ tin cậy ĐỌC CHỮ của khóa cấp 1 chứa lá này (0–100), không phải độ tin cậy "đúng người". */
  readPercent: number | null;
  page: number | null;
  recordId: string;
}

export interface ClaimView {
  id: string;
  field: string;
  fieldLabel: string;
  value: string;
  status: string;
  statusLabel: string;
  tone: ClaimTone;
  sources: ClaimSourceView[];
  /** Mã claim đối lập (để dựng nhóm). */
  contradicts: string[];
}

export interface DiscrepancyGroup {
  /** `subjectId|field` — một nhóm là một câu hỏi: "thông tin X của chủ thể Y, các chứng từ ghi gì". */
  key: string;
  subjectId: string;
  subjectName: string;
  subjectKind: string;
  fieldLabel: string;
  tone: ClaimTone;
  /** Mô tả ngắn nhóm này nói gì. */
  summary: string;
  claims: ClaimView[];
}

export interface SubjectNotes {
  /** Cảnh báo cần người rà soát (mâu thuẫn, nghi lỗi đọc). */
  warnings: string[];
  /** Thông tin được nhiều chứng từ xác nhận (định danh). */
  confirmed: string[];
  /** Claim đang ghi nhận cách viết khác. */
  variants: string[];
}

export interface ClaimsSummary {
  groups: DiscrepancyGroup[];
  /** Theo chủ thể (`person-n`, `asset-n`) để gắn lên thẻ người / tài sản. */
  bySubject: Map<string, SubjectNotes>;
  /** Claim chưa gắn được chủ thể: đếm và nhóm theo lý do. */
  unresolved: Array<{ reason: string; label: string; count: number }>;
  counts: { corroborated: number; disputed: number; ocrError: number; variants: number; unresolved: number };
  /** Bất biến lossless đã lưu — hiển thị để người dùng biết phần nào chưa nằm trong danh sách. */
  coverage: { leafCount: number; shownLeaves: number; omittedLeaves: number };
}

const asText = (v: string | number | boolean): string => (typeof v === 'boolean' ? (v ? 'Có' : 'Không') : String(v));

/** Nhãn đọc được của chủ thể: tên người, "Bất động sản · GCN …", "Khoản vay", "Chứng từ". */
function subjectNameResolver(map: MapDossierData | null, docLabel: (k: string) => string): (kind: string, id: string) => string {
  const names = new Map((map?.customer_360 ?? []).map((c) => [c.person_id, c.identity.full_name?.trim() || c.person_id]));
  const assets = new Map((map?.asset_registry ?? []).map((a) => {
    const ids = a.identifiers as Record<string, string | null>;
    const key = ids.certificate_number ?? ids.license_plate ?? ids.chassis_number ?? ids.registration_number ?? ids.apartment_number;
    return [a.asset_id, `${ASSET_LABELS[a.asset_type] ?? a.asset_type}${key ? ` · ${key}` : ''}`] as const;
  }));
  return (kind, id) => {
    if (kind === 'person') return names.get(id) ?? id;
    if (kind === 'asset') return assets.get(id) ?? id;
    if (kind === 'loan') return 'Khoản vay';
    if (kind === 'business') return 'Hộ kinh doanh / doanh nghiệp';
    void docLabel;
    return 'Chứng từ';
  };
}

/**
 * Nhãn của TRƯỜNG (không kèm đường dẫn cha): chủ thể đã được nêu riêng ("của NGUYỄN VĂN AN"), nên "Người/tổ chức · Ngày sinh" là thừa.
 * Tái dùng `labelOf` (bảng nhãn có sẵn); chỉ giữ đoạn cuối, bỏ chỉ số mảng.
 */
export function claimFieldLabel(field: string): string {
  const full = labelOf(field.replace(/\[\]/g, '[0]'));
  const last = full.split(' · ').pop() ?? full;
  return last.replace(/ #\d+$/, '');
}

function toView(c: StoredClaim, docLabel: (k: string) => string): ClaimView {
  return {
    id: c.claim_id,
    field: c.field,
    fieldLabel: claimFieldLabel(c.field),
    value: asText(c.value),
    status: c.status,
    statusLabel: CLAIM_STATUS_LABELS[c.status] ?? c.status,
    tone: CLAIM_STATUS_TONE[c.status] ?? 'neutral',
    contradicts: c.contradicts,
    sources: c.sources.map((s) => ({
      doc: docLabel(s.doc_type_key),
      raw: s.raw !== undefined && asText(s.raw) !== asText(c.value) ? asText(s.raw) : null,
      readPercent: s.read_confidence === null ? null : Math.round(s.read_confidence * 100),
      page: s.page,
      recordId: s.record_id,
    })),
  };
}

const isWarning = (status: string) => status === 'DISPUTED' || status === 'PROBABLE_OCR_ERROR';

/**
 * Tổng hợp Claim đã lưu thành: các nhóm đối chiếu (mâu thuẫn trước), ghi chú theo chủ thể, và các Claim chưa gắn được chủ thể.
 * Không có `stored` (kết quả cũ, hoặc S3 lỗi) → trả null để UI không hiện khối rỗng.
 */
export function buildClaimsSummary(
  stored: StoredClaims | null | undefined,
  map: MapDossierData | null,
  docLabel: (key: string) => string,
): ClaimsSummary | null {
  if (!stored) return null;
  const nameOf = subjectNameResolver(map, docLabel);
  const claims = stored.claims;

  // Nhóm theo (chủ thể, trường). Mỗi nhóm mâu thuẫn là một câu hỏi cho người rà soát.
  const byGroup = new Map<string, StoredClaim[]>();
  for (const c of claims) {
    if (c.unresolved) continue;
    const key = `${c.subject.id}|${c.field}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), c]);
  }

  const groups: DiscrepancyGroup[] = [];
  const bySubject = new Map<string, SubjectNotes>();
  const notes = (id: string): SubjectNotes => {
    const n = bySubject.get(id) ?? { warnings: [], confirmed: [], variants: [] };
    bySubject.set(id, n);
    return n;
  };

  for (const [key, members] of byGroup) {
    const first = members[0];
    const views = members.map((m) => toView(m, docLabel));
    const subjectName = nameOf(first.subject.kind, first.subject.id);
    const fieldLabel = views[0].fieldLabel;
    const hasWarning = members.some((m) => isWarning(m.status));
    const hasVariant = members.some((m) => m.status === 'SPELLING_VARIANT');
    const corroborated = members.some((m) => m.status === 'CORROBORATED');

    if (hasWarning) {
      // Một cặp lệch 1 ký tự: bên đa số vẫn mang DISPUTED (đối lập với bên lệch) nhưng nhóm chỉ là "nghi lỗi đọc" — không nặng bằng khác số thật.
      // Chỉ báo "không khớp" (danger) khi KHÔNG có bên nào được xác định là lỗi đọc.
      const tone: ClaimTone = members.some((m) => m.status === 'PROBABLE_OCR_ERROR') ? 'warning' : 'danger';
      const values = views.map((v) => v.value).join(' ≠ ');
      groups.push({ key, subjectId: first.subject.id, subjectName, subjectKind: first.subject.kind, fieldLabel, tone, summary: `${fieldLabel}: ${values}`, claims: views });
      notes(first.subject.id).warnings.push(`${fieldLabel} không khớp giữa các chứng từ`);
    } else if (hasVariant) {
      groups.push({ key, subjectId: first.subject.id, subjectName, subjectKind: first.subject.kind, fieldLabel, tone: 'info', summary: `${fieldLabel}: cùng nội dung, khác cách viết`, claims: views });
      notes(first.subject.id).variants.push(`${fieldLabel} có cách viết khác nhau`);
    } else if (corroborated && CORROBORATION_FIELDS.test(first.field)) {
      const best = views.find((v) => v.status === 'CORROBORATED') ?? views[0];
      groups.push({ key, subjectId: first.subject.id, subjectName, subjectKind: first.subject.kind, fieldLabel, tone: 'success', summary: `${fieldLabel}: ${best.sources.length} chứng từ khớp nhau`, claims: [best] });
      notes(first.subject.id).confirmed.push(`${fieldLabel} (${best.sources.length} chứng từ)`);
    }
  }

  // Mâu thuẫn lên đầu; trong cùng mức giữ thứ tự ổn định.
  const rank = (t: ClaimTone) => (t === 'danger' ? 0 : t === 'warning' ? 1 : t === 'info' ? 2 : 3);
  const ordered = groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g.tone) - rank(b.g.tone) || a.i - b.i).map((x) => x.g);

  const unresolvedMap = new Map<string, number>();
  for (const c of claims) if (c.unresolved) unresolvedMap.set(c.unresolved, (unresolvedMap.get(c.unresolved) ?? 0) + c.sources.length);
  const unresolved = [...unresolvedMap].map(([reason, count]) => ({ reason, label: UNRESOLVED_LABELS[reason] ?? reason, count }));

  return {
    groups: ordered,
    bySubject,
    unresolved,
    counts: {
      corroborated: ordered.filter((g) => g.tone === 'success').length,
      disputed: ordered.filter((g) => g.tone === 'danger').length,
      ocrError: ordered.filter((g) => g.tone === 'warning').length,
      variants: ordered.filter((g) => g.tone === 'info').length,
      unresolved: unresolved.reduce((n, u) => n + u.count, 0),
    },
    coverage: { leafCount: stored.leaf_count, shownLeaves: stored.leaf_count - stored.omitted_leaves, omittedLeaves: stored.omitted_leaves },
  };
}
