// Hiển thị kết quả hồ sơ spec-v3 (T-V2-09; V2-R10). Hàm thuần — test bằng fixture.
//  - OCR theo evidence: lá của `parties[]`, `assets[]`, `asset_details[]`, `fields`… có nhãn và giá trị.
//  - Địa chỉ object hiện `full_text`; tiền số nguyên hiện định dạng VND.
import type { DossierChecklistItem, DossierCrossCheckResult, DossierEvidence, DossierOutputV3 } from '@/app/loan-appraisal/types';

export interface EvidenceFieldRow {
  path: string;
  label: string;
  value: string;
  /** Field cấp 1 (để tra confidence / trang nguồn). */
  top: string;
  confidence: number | null;
  pages: number[];
}

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Họ và tên', id_number: 'Số định danh', id_type: 'Loại giấy tờ', id_issue_date: 'Ngày cấp giấy tờ', id_issue_place: 'Nơi cấp giấy tờ',
  previous_id_numbers: 'Số định danh cũ', date_of_birth: 'Ngày sinh', gender: 'Giới tính', nationality: 'Quốc tịch',
  permanent_address: 'Địa chỉ thường trú', current_address: 'Địa chỉ hiện tại', phone_number: 'Số điện thoại', tax_id: 'Mã số thuế',
  party_role: 'Vai trò', party_role_raw: 'Vai trò (nguyên văn)', representative_name: 'Người đại diện', representative_position: 'Chức vụ người đại diện',
  certificate_number: 'Số GCN', certificate_book_number: 'Số vào sổ', land_parcel_number: 'Số thửa', map_sheet_number: 'Số tờ bản đồ',
  apartment_number: 'Số căn hộ', building_name: 'Tòa nhà', project_name: 'Dự án', license_plate: 'Biển số', chassis_number: 'Số khung',
  engine_number: 'Số máy', registration_number: 'Số đăng ký', address: 'Địa chỉ', description: 'Mô tả', asset_type: 'Loại tài sản',
  usage_context_hint: 'Mục đích sử dụng', issue_date: 'Ngày cấp', valid_until: 'Hiệu lực đến', document_number: 'Số văn bản',
  issuing_authority: 'Cơ quan cấp', issue_place: 'Nơi cấp', document_title: 'Tên văn bản', requested_amount: 'Số tiền đề nghị vay',
  bank_proposed_amount: 'Số tiền cho vay', loan_term_months: 'Thời hạn vay (tháng)', interest_rate: 'Lãi suất (%/năm)', interest_rate_code: 'Mã biểu lãi suất',
  business_name: 'Tên hộ/doanh nghiệp', business_line: 'Ngành nghề', business_address: 'Địa chỉ kinh doanh', valuation_value: 'Giá trị định giá',
  marital_status: 'Tình trạng hôn nhân', has_existing_debt: 'Có nợ hiện hữu', existing_monthly_debt_payment: 'Trả nợ hiện hữu hàng tháng',
  usage_contexts: 'Mục đích sử dụng',
};

const GROUP_LABELS: Record<string, string> = {
  parties: 'Người/tổ chức', assets: 'Tài sản', asset_details: 'Chi tiết tài sản', legal_info: 'Thông tin văn bản', fields: 'Thông tin',
  loan_info: 'Khoản vay', financial_info: 'Tài chính', business_info: 'Kinh doanh', income_sources: 'Nguồn thu', party_details: 'Chi tiết người',
};

const MONEY_KEY = /(amount|value|payment|income|revenue|profit|salary|price|total|_vnd)$/i;
const SKIP_KEY = /(^|\.)(party_index|asset_index|source_page|is_section_page_verified|form_section)$|_page$/;
const ADDRESS_KEYS = new Set(['full_text', 'street', 'ward', 'district', 'province']);

export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')} ₫`;
}

function isAddress(v: unknown): v is { full_text: string | null } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).every((k) => ADDRESS_KEYS.has(k)) && 'full_text' in (v as object);
}

/** Nhãn của đường dẫn: `parties[0].full_name` → "Người/tổ chức #1 · Họ và tên". */
export function labelOf(path: string): string {
  const parts = path.split('.');
  const out: string[] = [];
  for (const part of parts) {
    const m = part.match(/^([a-z0-9_]+)(?:\[(\d+)\])?$/i);
    if (!m) { out.push(part); continue; }
    const [, key, idx] = m;
    const base = GROUP_LABELS[key] ?? FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    out.push(idx !== undefined ? `${base} #${Number(idx) + 1}` : base);
  }
  return out.join(' · ');
}

function display(key: string, v: unknown): string {
  if (typeof v === 'number') return MONEY_KEY.test(key) && Number.isInteger(v) ? formatVnd(v) : v.toLocaleString('vi-VN');
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  return String(v);
}

/** Lá của `data` một evidence, bỏ trường null/rỗng và trường kỹ thuật (index, trang). */
export function evidenceFields(e: DossierEvidence): EvidenceFieldRow[] {
  const rows: EvidenceFieldRow[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined || v === '') return;
    if (path && SKIP_KEY.test(path)) return;
    const top = path.split(/[.[]/)[0];
    const row = (value: string) => rows.push({
      path, label: labelOf(path), value, top,
      confidence: e.field_confidences[top] ?? null, pages: e.source_pages[top] ?? [],
    });
    if (isAddress(v)) { if (v.full_text) row(v.full_text); return; }
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x !== 'object' || x === null)) { if (v.length) row(v.map((x) => display(path, x)).join(', ')); return; }
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k); return; }
    row(display(path.split('.').pop()!, v));
  };
  walk(e.data, '');
  return rows;
}

export const CHECKLIST_GROUP_LABELS: Record<string, string> = {
  legal: 'I. Hồ sơ pháp lý', loan_plan: 'II. Phương án vay', income_source: 'III. Nguồn thu nhập', collateral: 'IV. Tài sản bảo đảm', credit_relationship: 'V. Quan hệ tín dụng',
};

export const CHECKLIST_STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Đã có', SUBSTITUTED: 'Đã có (thay thế)', MISSING: 'Thiếu', NEEDS_RESCAN: 'Cần scan lại', NEEDS_REVIEW: 'Cần rà soát', NOT_APPLICABLE: 'Không áp dụng',
};

export type ToneName = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function checklistStatusTone(status: string): ToneName {
  if (status === 'PRESENT' || status === 'SUBSTITUTED') return 'success';
  if (status === 'MISSING') return 'warning';
  if (status === 'NEEDS_RESCAN' || status === 'NEEDS_REVIEW') return 'warning';
  return 'neutral';
}

export function matchTone(status: string): ToneName {
  return status === 'MATCH' ? 'success' : status === 'NEAR_MATCH' ? 'info' : status === 'MISMATCH' ? 'warning' : 'warning';
}

/** Khớp · Gần khớp (nghi lỗi đọc, D-41) · Không khớp · Chưa kết luận. */
export const MATCH_LABELS: Record<string, string> = { MATCH: 'Khớp', NEAR_MATCH: 'Gần khớp', MISMATCH: 'Không khớp', UNDETERMINED: 'Chưa kết luận' };

/**
 * Mục checklist không áp dụng cho hồ sơ này (`NOT_APPLICABLE`: ngoài luồng đã chọn, điều kiện không thỏa, được nhóm thay thế
 * bao phủ…) không hiển thị để đỡ rối (D-65). Mục không áp dụng mà vẫn có chứng từ được nộp là `PRESENT`, nên vẫn hiện.
 */
export const isHiddenChecklistItem = (i: { status: string }) => i.status === 'NOT_APPLICABLE';

/** Số mục không áp dụng đang ẩn (để ghi ở tiêu đề). view=compact đã bỏ chúng khỏi `items` và ghi số lượng ở `not_applicable_count`. */
export const hiddenChecklistCount = (checklist: DossierOutputV3['checklist']) =>
  checklist.items.filter(isHiddenChecklistItem).length + (checklist.not_applicable_count ?? 0);

/** Checklist theo nhóm (thứ tự nhóm I→V) kèm tóm tắt của nhóm; bỏ mục "Không áp dụng". */
export function checklistGroups(checklist: DossierOutputV3['checklist']): Array<{ group: string; label: string; items: DossierChecklistItem[]; summary: DossierOutputV3['checklist']['summary_by_group'][number] | null }> {
  return Object.keys(CHECKLIST_GROUP_LABELS).map((group) => ({
    group,
    label: CHECKLIST_GROUP_LABELS[group],
    items: checklist.items.filter((i) => i.checklist_group === group && !isHiddenChecklistItem(i)),
    summary: checklist.summary_by_group.find((s) => s.checklist_group === group) ?? null,
  }));
}

/** Thứ tự dòng cần xem: lệch thật trước, "Gần khớp" sau cùng (giữ thứ tự S5-R16 trong cùng mức). */
const REVIEW_RANK: Record<string, number> = { MISMATCH: 0, UNDETERMINED: 1, NEAR_MATCH: 2 };

/**
 * Lọc đối chiếu. `MISMATCH` = "Cần xem": mọi dòng chưa khớp (MISMATCH, UNDETERMINED, NEAR_MATCH — S5-R17), lệch thật
 * xếp trước; `NEAR_MATCH` = chỉ dòng gần khớp; `MATCH`; `ALL`.
 */
export function crossCheckFilter(results: DossierCrossCheckResult[], mode: 'MISMATCH' | 'NEAR_MATCH' | 'MATCH' | 'ALL'): DossierCrossCheckResult[] {
  if (mode === 'ALL') return results;
  if (mode === 'MATCH') return results.filter((r) => r.match_status === 'MATCH');
  if (mode === 'NEAR_MATCH') return results.filter((r) => r.match_status === 'NEAR_MATCH');
  return results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.match_status !== 'MATCH')
    .sort((a, b) => (REVIEW_RANK[a.r.match_status] ?? 1) - (REVIEW_RANK[b.r.match_status] ?? 1) || a.i - b.i)
    .map(({ r }) => r);
}

export interface CrossCheckValueGroup {
  /** Giá trị hiển thị: nguyên văn của nguồn đầu tiên trong nhóm. */
  value: unknown;
  /** Khóa gom: `normalized_value` của S5 (VD tên đã viết HOA), không có thì chính giá trị. */
  key: string;
  sources: Array<{ doc_type_label: string | null; file_name: string; page: number | null; id_status: string | null }>;
}

/**
 * Gom các nguồn ghi CÙNG giá trị (sau chuẩn hóa của S5) thành một dòng, theo thứ tự xuất hiện; mỗi nguồn ghi
 * mẫu biểu (tên loại chứng từ, tra theo evidence_id) + file + trang. Cùng mẫu, cùng file, cùng trang chỉ ghi một lần.
 * Chỉ là cách hiển thị, không đổi kết luận khớp/lệch.
 */
export function groupCrossCheckValues(
  values: DossierCrossCheckResult['values'],
  evidences: ReadonlyArray<Pick<DossierEvidence, 'evidence_id' | 'doc_type_label'>> = [],
): CrossCheckValueGroup[] {
  const labelOfEvidence = new Map(evidences.map((e) => [e.evidence_id, e.doc_type_label]));
  const groups = new Map<string, CrossCheckValueGroup>();
  for (const v of values) {
    const raw = v.normalized_value ?? v.value;
    const key = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const g = groups.get(key) ?? { value: v.value, key, sources: [] };
    const src = {
      doc_type_label: labelOfEvidence.get(v.source.evidence_id) ?? null,
      file_name: v.source.file_name, page: v.source.page ?? null, id_status: v.id_status ?? null,
    };
    if (!g.sources.some((s) => s.doc_type_label === src.doc_type_label && s.file_name === src.file_name && s.page === src.page && s.id_status === src.id_status)) g.sources.push(src);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** "Mẫu biểu (file · tr.N)" — mẫu biểu trước để CO biết bản nào sai; không tra được mẫu thì chỉ file + trang. */
export function crossCheckSourceText(s: CrossCheckValueGroup['sources'][number]): string {
  const where = `${s.file_name}${s.page ? ` · tr.${s.page}` : ''}`;
  return `${s.doc_type_label ? `${s.doc_type_label} (${where})` : where}${s.id_status ? ` · ${s.id_status}` : ''}`;
}

type AssetEntry = NonNullable<DossierOutputV3['customer_360']>['asset_registry'][number];

const IDENTIFIER_LABELS: Record<string, string> = {
  certificate_number: 'Số GCN', certificate_book_number: 'Số vào sổ', land_parcel_number: 'Thửa đất số', map_sheet_number: 'Tờ bản đồ số',
  apartment_number: 'Căn hộ số', building_name: 'Tòa nhà', project_name: 'Dự án', license_plate: 'Biển số', chassis_number: 'Số khung',
  engine_number: 'Số máy', registration_number: 'Số đăng ký',
};

export interface AssetContextView {
  label: string;
  tone: ToneName;
  /** Vì sao chưa CONFIRMED (S3-R19); null khi đã xác nhận. */
  reason: string | null;
  /** "Số vào sổ: CN 6475 (de_nghi_vay_von.pdf) ≠ CS 06475 (ho_so_phap_ly.pdf)". */
  conflicts: string[];
  /** Chứng từ đã gom vào tài sản: "tên file (loại)". */
  sources: string[];
}

/**
 * Trạng thái mục đích của tài sản kèm lý do (S3-R18, R19). Tách 3 trường hợp mà trước đây cùng hiện "Chưa rõ mục đích":
 * không có chứng từ nêu mục đích (UNRESOLVED); đã biết mục đích nhưng định danh lệch / 1 chứng từ có nhiều tài sản cùng nhóm;
 * đã biết mục đích nhưng chỉ ghép yếu (thiếu khóa đầy đủ).
 */
export function assetContextView(a: AssetEntry, evidences: ReadonlyArray<DossierEvidence> = []): AssetContextView {
  const byId = new Map(evidences.map((e) => [e.evidence_id, e]));
  const fileOf = (id: string) => byId.get(id)?.file_name ?? id;
  const sources = (a.sources as Array<{ evidence_id: string; doc_type_key: string }>)
    .map((s) => `${fileOf(s.evidence_id)} (${byId.get(s.evidence_id)?.doc_type_label ?? s.doc_type_key})`);
  const conflicts = (a.identifier_conflicts as Array<{ field: string; values: string[]; evidence_ids: string[]; probable_ocr_error?: boolean; outlier_evidence_ids?: string[] }>).map((c) => {
    const files = [...new Set((c.probable_ocr_error && c.outlier_evidence_ids?.length ? c.outlier_evidence_ids : c.evidence_ids).map(fileOf))].join(', ');
    const tail = c.probable_ocr_error ? ` — gần khớp, nghi lỗi đọc ở ${files}` : files ? ` (${files})` : '';
    return `${IDENTIFIER_LABELS[c.field] ?? c.field}: ${c.values.join(' ≠ ')}${tail}`;
  });
  const purpose = a.usage_contexts.length === 0 ? null
    : a.usage_contexts.map((u) => (u === 'collateral' ? 'TSBĐ' : 'Cho thuê')).join(' + ');
  if (a.context_status === 'CONFIRMED') {
    const reason = conflicts.length > 0 ? 'Một chứng từ ghi định danh lệch 1 ký tự so với các chứng từ còn lại (nghi lỗi đọc); vẫn coi là cùng tài sản.' : null;
    return { label: purpose ?? 'Đã xác nhận', tone: 'success', reason, conflicts, sources };
  }
  if (a.context_status === 'UNRESOLVED' || !purpose) {
    return {
      label: 'Chưa rõ mục đích', tone: 'warning', conflicts, sources,
      reason: 'Không chứng từ nào nêu mục đích của tài sản này (mục TSBĐ trên giấy đề nghị vay hoặc mục tài sản cho thuê trên bảng kê thu nhập), hoặc tài sản ở các mục đó không ghép được vào tài sản này.',
    };
  }
  const label = `${purpose} · cần xác nhận`;
  if (conflicts.length > 0) return { label, tone: 'warning', conflicts, sources, reason: 'Đã ghép các chứng từ của tài sản nhưng định danh ghi khác nhau; cần xác nhận đúng là một tài sản.' };
  if (a.context_reason_code === 'ASSET_IDENTIFIER_CONFLICT') {
    return { label, tone: 'warning', conflicts, sources, reason: 'Một chứng từ ghi từ 2 tài sản trở lên cùng khớp vào tài sản này; cần xác nhận cách ghép.' };
  }
  return { label, tone: 'warning', conflicts, sources, reason: 'Chứng từ nêu mục đích chỉ được ghép gần đúng (thiếu số GCN/thửa-tờ hoặc số khung/biển số); cần xác nhận đúng tài sản.' };
}

/** Tên hiển thị của người theo person_id. */
export function personName(map: DossierOutputV3['customer_360'], personId: string | null): string {
  if (!personId) return '';
  const p = map?.role_registry.find((x) => x.person_id === personId);
  return p?.full_name ?? personId;
}

/** Tên người vay chính (Customer 360 của người có vai trò borrower). */
export function borrowerName(map: DossierOutputV3['customer_360']): string | null {
  const c = map?.customer_360.find((x) => x.roles.includes('borrower'));
  return c?.identity.full_name?.trim() || null;
}
