// Đánh giá tiếp nhận hồ sơ theo 4 tiêu chí của Sale (D-47) — hàm thuần, chỉ đọc S1/S2/S4/S5. Lớp master_dossier đã gỡ (D-115).
//   1. Hồ sơ đầy đủ theo quy định (S4)
//   2. Thông tin trọng yếu giữa các chứng từ nhất quán (S5)
//   3. Dữ liệu nhập trên hệ thống (LOS/Secure App) — CHƯA ÁP DỤNG, sẽ nhận kèm request
//   4. Hồ sơ đủ chất lượng để chuyển CBQL/CO (1, 2 đạt; file lỗi/chưa nhận diện đã xử lý hoặc có giải trình)
// Không lưu trạng thái: giải trình do hệ thống gọi gửi lại qua `acknowledgements` khi chạy lại (D-25).
import type { CheckChecklistData, CrossCheckData, MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { ClassifyData } from '@/lib/loan-dossier/contracts/stage-result';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

type AssetRegistryEntry = MapDossierData['asset_registry'][number];

export type CriterionKey = 'DOCUMENTS_COMPLETE' | 'CONSISTENT_ACROSS_DOCUMENTS' | 'SYSTEM_DATA_ACCURATE' | 'READY_FOR_HANDOVER';
export type CriterionStatus = 'PASS' | 'FAIL' | 'NEEDS_EXPLANATION' | 'ACCEPTED' | 'NOT_APPLICABLE';

export interface IntakeFinding {
  /** Mã ổn định giữa các lần chạy — hệ thống gọi dùng để gửi giải trình. */
  code: string;
  message: string;
  /** Nhóm hiển thị (VD "I. Hồ sơ pháp lý"); null khi không chia nhóm. */
  group: string | null;
  /** Có thể chấp nhận bằng giải trình không (thiếu chứng từ bắt buộc thì không). */
  acknowledgeable: boolean;
  status: 'OPEN' | 'ACCEPTED';
  acknowledgement_reason: string | null;
}

export interface IntakeCriterion {
  key: CriterionKey;
  no: 1 | 2 | 3 | 4;
  label: string;
  goal: string;
  status: CriterionStatus;
  summary: string;
  /** Điểm chưa đạt / cần giải trình — liệt kê đầy đủ, không cắt. */
  findings: IntakeFinding[];
  /** Điểm đã đạt (để Sale có cái nhìn tổng quan): chứng từ đã có, trường trọng yếu đã khớp. */
  passed: IntakePassed[];
}

export interface IntakePassed {
  code: string;
  message: string;
  /** Nhóm hiển thị (VD "I. Hồ sơ pháp lý"); null khi không chia nhóm. */
  group: string | null;
}

export interface IntakeReviewInfo {
  /** Bước kiểm tra nháp cho Sale: tham khảo, không có trách nhiệm giải trình (D-59). */
  draft: true;
  /** `LLM`: trạng thái / tóm tắt / điểm do LLM chấm; `RULES`: kết quả của quy tắc. */
  source: 'LLM' | 'RULES';
  warning: string | null;
  /** Có dùng prompt ghi đè từ Profile không. */
  prompt_overridden: boolean;
}

/** Tổng kết tóm tắt bộ hồ sơ (D-59). */
export interface DossierSummary {
  overview: string;
  highlights: string[];
  next_actions: string[];
  source: 'LLM' | 'RULES';
}

export interface IntakeAssessment {
  version: '1.0';
  ready_for_handover: boolean;
  criteria: IntakeCriterion[];
  /** Giải trình gửi kèm nhưng không khớp finding nào, hoặc gửi cho finding không chấp nhận giải trình. */
  ignored_acknowledgements: string[];
  review?: IntakeReviewInfo;
  dossier_summary?: DossierSummary;
}

export interface Acknowledgement { finding_code: string; reason: string }

const MAX_ACKS = 200;
const MAX_REASON = 500;

/** `acknowledgements` từ pipelineVars: mảng hoặc chuỗi JSON `[{ finding_code, reason }]`; mục sai bị bỏ. */
export function parseAcknowledgements(raw: unknown): Acknowledgement[] {
  let v = raw;
  if (typeof v === 'string' && v.trim()) { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  const out: Acknowledgement[] = [];
  for (const x of v.slice(0, MAX_ACKS)) {
    const o = x as Record<string, unknown> | null;
    const code = typeof o?.finding_code === 'string' ? o.finding_code.trim() : '';
    const reason = typeof o?.reason === 'string' ? o.reason.trim().slice(0, MAX_REASON) : '';
    if (code && reason) out.push({ finding_code: code, reason });
  }
  return out;
}

/**
 * Trường trọng yếu của tiêu chí 2 (theo `field_group` / `sub_field` của ma trận S5). Không gồm địa chỉ (D-49): địa chỉ so
 * nguyên văn (D-35) nên địa danh cũ/mới hay cách viết khác đều ra lệch — để CO xem ở bước thẩm định, không chặn Sale.
 */
const MATERIAL_GROUPS = new Set(['full_name', 'id_number', 'date_of_birth', 'marital_status', 'loan_amount', 'collateral_owner_identity']);
const MATERIAL_ASSET_SUBFIELDS = new Set(['certificate_number', 'certificate_book_number', 'license_plate', 'chassis_number']);
/** Lá trọng yếu khi các bản của cùng chứng từ xung đột (master_dossier CONFLICT). */
const MATERIAL_LEAF = /(^|\.)(full_name|id_number|date_of_birth|certificate_number|certificate_book_number|license_plate|chassis_number|bank_proposed_amount)$/;
/** D-61: thông tin phụ (người ký, cán bộ ký…) không chặn Sale — dù tên lá trùng `full_name`. */
const SECONDARY_PATH = /(^|[.\[])signator/i;
const isMaterialLeaf = (path: string) => MATERIAL_LEAF.test(path) && !SECONDARY_PATH.test(path);

const GROUP_LABELS: Record<string, string> = {
  legal: 'I. Hồ sơ pháp lý', loan_plan: 'II. Phương án vay', income_source: 'III. Nguồn thu nhập', collateral: 'IV. Tài sản bảo đảm', credit_relationship: 'V. Quan hệ tín dụng',
};

/** Tên hiển thị của từng định danh tài sản (D-55). */
const IDENTIFIER_LABELS: Record<string, string> = {
  certificate_number: 'Số Giấy chứng nhận', certificate_book_number: 'Số vào sổ', land_parcel_number: 'Số thửa', map_sheet_number: 'Số tờ bản đồ',
  apartment_number: 'Số căn hộ', building_name: 'Tên tòa nhà', project_name: 'Tên dự án', license_plate: 'Biển số', chassis_number: 'Số khung',
  engine_number: 'Số máy', registration_number: 'Số đăng ký',
};
/** Định danh dùng để gọi tên tài sản, theo thứ tự ưu tiên. */
const IDENTITY_ORDER = ['certificate_number', 'certificate_book_number', 'license_plate', 'chassis_number', 'engine_number', 'registration_number'] as const;

/** "Số Giấy chứng nhận 123456" / "Biển số 51A-123.45"; null khi tài sản chưa có định danh nào đọc được. */
export function assetIdentity(a: AssetRegistryEntry | undefined): string | null {
  if (!a) return null;
  for (const k of IDENTITY_ORDER) {
    const v = a.identifiers[k];
    if (v) return `${IDENTIFIER_LABELS[k]} ${v}`;
  }
  const { land_parcel_number: parcel, map_sheet_number: sheet, apartment_number: apt, building_name: building } = a.identifiers;
  if (parcel && sheet) return `Thửa ${parcel}, tờ bản đồ ${sheet}`;
  if (apt && building) return `Căn hộ ${apt}, ${building}`;
  return null;
}

/** Lý do cụ thể khi mục tài sản phải rà soát vì chưa chắc tài sản / mục đích sử dụng (D-55). */
function assetReviewReason(assetId: string, a: AssetRegistryEntry | undefined): string {
  const head = assetIdentity(a) ?? `Tài sản ${assetId}`;
  if (!a) return `${head}: chưa xác định được tài sản hoặc mục đích sử dụng tài sản.`;
  if (a.context_reason_code === 'ASSET_IDENTIFIER_CONFLICT') {
    const conflicts = (a.identifier_conflicts as Array<{ field?: string; values?: string[]; probable_ocr_error?: boolean }>)
      .filter((c) => c.probable_ocr_error !== true && c.field && Array.isArray(c.values));
    return conflicts.length > 0
      ? `${head}: ${conflicts.map((c) => `${IDENTIFIER_LABELS[c.field!] ?? c.field} ghi khác nhau giữa các chứng từ (${c.values!.join(' / ')})`).join('; ')}.`
      : `${head}: các chứng từ có thể thuộc nhiều tài sản khác nhau, chưa nối được chắc chắn.`;
  }
  if (a.usage_contexts.length === 0) return `${head}: chưa xác định được mục đích sử dụng tài sản (thế chấp / nguồn thu cho thuê).`;
  return `${head}: định danh tài sản chưa đủ chắc chắn để nối các chứng từ với nhau.`;
}

export interface IntakeAssessmentInput {
  classify: ClassifyData | null;
  evidences: ReadonlyArray<EvidenceEnvelope>;
  s3: MapDossierData | null;
  checklist: CheckChecklistData | null;
  checklistStatusCode?: string | null;
  crossCheck: CrossCheckData | null;
  acknowledgements: ReadonlyArray<Acknowledgement>;
}

export function buildIntakeAssessment(input: IntakeAssessmentInput): IntakeAssessment {
  const acks = new Map(input.acknowledgements.map((a) => [a.finding_code, a.reason]));
  const used = new Set<string>();
  const names = new Map<string, string>([
    ...(input.s3?.customer_360 ?? []).map((c) => [c.person_id, c.identity.full_name ?? c.person_id] as [string, string]),
    ...(input.s3?.asset_registry ?? []).map((a) => [a.asset_id, assetIdentity(a) ?? a.asset_id] as [string, string]),
  ]);
  const assetOf = new Map((input.s3?.asset_registry ?? []).map((a) => [a.asset_id, a] as [string, AssetRegistryEntry]));
  const scopeText = (person: string | null, asset: string | null) => (person ? ` — ${names.get(person) ?? person}` : asset ? ` — ${names.get(asset) ?? asset}` : '');
  const finding = (code: string, message: string, acknowledgeable: boolean, group: string | null = null): IntakeFinding => {
    const reason = acknowledgeable ? acks.get(code) ?? null : null;
    if (reason !== null) used.add(code);
    return { code, message, group, acknowledgeable, status: reason !== null ? 'ACCEPTED' : 'OPEN', acknowledgement_reason: reason };
  };

  // ── 1. Hồ sơ đầy đủ — chỉ xét có đủ LOẠI chứng từ cho từng người / tài sản (D-56) ─────────────────────
  // Nội dung các chứng từ có khớp nhau không (số GCN, tài sản, vai trò, quan hệ…) thuộc tiêu chí 2, không lặp ở đây.
  const items = input.checklist?.items ?? [];
  type Row = (typeof items)[number];
  const isExpired = (it: Row) => it.status === 'MISSING' && it.reason_code === 'DOCUMENT_EXPIRED';
  // Chưa có chứng từ dùng được cho mục: thiếu, chỉ có bản không đọc được, hoặc không xác định nổi chứng từ nào. Hết hạn giải trình được (D-55).
  const lacksDoc = (it: Row) => it.status === 'MISSING' || it.status === 'NEEDS_RESCAN' || (it.status === 'NEEDS_REVIEW' && it.found_in.length === 0);
  const hasDoc = (it: Row) => it.status === 'SUBSTITUTED' || (it.required && (it.status === 'PRESENT' || (it.status === 'NEEDS_REVIEW' && it.found_in.length > 0)));
  const gaps = items.filter((it) => it.required && lacksDoc(it));
  const gapMessage = (it: Row): string => {
    const head = `${it.item_label}${scopeText(it.person_id, it.asset_id)}`;
    if (isExpired(it)) return `Hết hạn: ${head} - ${it.message ?? 'Chứng từ đã hết hiệu lực.'}`;
    if (it.status === 'NEEDS_RESCAN') return `Cần scan lại: ${head}${it.message ? ` - Lý do: ${it.message}` : ''}`;
    return `Thiếu: ${head}${it.message && it.reason_code !== 'DOCUMENT_NOT_FOUND' ? ` - Lý do: ${it.message}` : ''}`;
  };
  const gapKind = (it: Row) => (isExpired(it) ? 'EXPIRED' : it.status === 'NEEDS_RESCAN' ? 'NEEDS_RESCAN' : 'MISSING');
  const c1Findings = gaps.map((it) => finding(
    `DOC_${gapKind(it)}:${it.item_key}:${it.person_id ?? it.asset_id ?? 'dossier'}`,
    gapMessage(it),
    isExpired(it),
    GROUP_LABELS[it.checklist_group] ?? it.checklist_group,
  ));
  // File không đọc được đã nêu ở tiêu chí 1 thì tiêu chí 4 không nêu lại.
  const rescanIds = new Set(gaps.filter((it) => it.status === 'NEEDS_RESCAN').flatMap((it) => it.found_in.map((f) => f.evidence_id)));
  // Đã đạt: đã có chứng từ của mục bắt buộc + mọi dòng đã được thay thế (D-48 để required = false). Bỏ dòng không áp dụng / đã gộp nhóm.
  const c1Passed: IntakePassed[] = items
    .filter(hasDoc)
    .map((it) => ({
      code: `DOC_OK:${it.item_key}:${it.person_id ?? it.asset_id ?? 'dossier'}`,
      message: it.status === 'SUBSTITUTED'
        ? `${it.item_label}${scopeText(it.person_id, it.asset_id)} — đã có chứng từ thay thế`
        : `${it.item_label}${scopeText(it.person_id, it.asset_id)}`,
      group: GROUP_LABELS[it.checklist_group] ?? it.checklist_group,
    }));
  const required = items.filter((it) => it.required);
  const c1Open = c1Findings.filter((f) => f.status === 'OPEN');
  const c1Hard = c1Open.filter((f) => !f.acknowledgeable).length;
  const c1: IntakeCriterion = {
    key: 'DOCUMENTS_COMPLETE', no: 1, label: 'Hồ sơ đầy đủ theo quy định',
    goal: 'Đủ loại chứng từ bắt buộc theo luồng hồ sơ cho từng người, từng tài sản: pháp lý, nguồn thu, TSBĐ… (nội dung các chứng từ có khớp nhau không xem tiêu chí 2).',
    // Còn thiếu / chỉ có bản không đọc được → Chưa đạt. Chỉ còn chứng từ hết hạn: Cần kiểm tra (giải trình được) → Đã giải trình.
    status: !input.checklist ? 'FAIL' : c1Findings.length === 0 ? 'PASS' : c1Hard > 0 ? 'FAIL' : c1Open.length > 0 ? 'NEEDS_EXPLANATION' : 'ACCEPTED',
    summary: !input.checklist
      ? `Chưa xác định được checklist${input.checklistStatusCode ? ` (${input.checklistStatusCode})` : ''}.`
      : c1Findings.length === 0
        ? `Đủ ${required.length}/${required.length} chứng từ bắt buộc của luồng ${input.checklist.flow}.`
        : c1Hard > 0
          ? `Còn ${c1Open.length}/${required.length} chứng từ bắt buộc chưa đạt (luồng ${input.checklist.flow}).`
          : c1Open.length > 0
            ? `${c1Open.length} chứng từ bắt buộc đã hết hiệu lực, cần kiểm tra (luồng ${input.checklist.flow}).`
            : `${c1Findings.length} chứng từ hết hiệu lực đã giải trình (luồng ${input.checklist.flow}).`,
    findings: c1Findings,
    passed: c1Passed,
  };
  // ── 2. Nhất quán giữa các chứng từ (chỉ trường trọng yếu) ────────────────
  const rows = (input.crossCheck?.results ?? []).filter((r) => (r.match_status === 'MISMATCH' || r.match_status === 'UNDETERMINED')
    && (MATERIAL_GROUPS.has(r.field_group) || (r.sub_field !== null && MATERIAL_ASSET_SUBFIELDS.has(r.sub_field))));
  const c2Findings = rows.map((r) => finding(
    `XCHECK:${r.field_group}${r.sub_field ? `.${r.sub_field}` : ''}:${r.person_id ?? r.asset_id ?? 'dossier'}`,
    `${r.field_label}${scopeText(r.person_id, r.asset_id)}: ${r.reason}`,
    true,
  ));
  // D-56: tài sản / vai trò / quan hệ chưa xác định chắc (S4 `NEEDS_REVIEW` dù đã có chứng từ) thuộc tiêu chí 2, không báo ở tiêu chí 1.
  // Tài sản đã có sai lệch trọng yếu ở trên (VD số GCN ghi khác nhau) thì không nêu lại.
  const xcheckAssets = new Set(rows.map((r) => r.asset_id).filter((a): a is string => a !== null));
  const addOnce = (code: string, message: string) => { if (!c2Findings.some((f) => f.code === code)) c2Findings.push(finding(code, message, true)); };
  for (const it of items) {
    if (!it.required || it.status !== 'NEEDS_REVIEW' || it.found_in.length === 0) continue;
    const who = it.person_id ? names.get(it.person_id) ?? it.person_id : null;
    if (it.reason_code === 'ASSET_CONTEXT_UNRESOLVED' && it.asset_id && !xcheckAssets.has(it.asset_id)) {
      addOnce(`ASSET_IDENTITY:${it.asset_id}`, assetReviewReason(it.asset_id, assetOf.get(it.asset_id)));
    } else if (it.reason_code === 'ROLE_CONFLICT_UNRESOLVED' && it.person_id) {
      addOnce(`ROLE_CONFLICT:${it.person_id}`, `${who}: một vai trò (người vay / đồng vay / chủ TSBĐ) khớp nhiều danh tính khác nhau giữa các chứng từ.`);
    } else if (it.reason_code === 'DOCUMENT_OWNER_UNCONFIRMED' && it.person_id) {
      // D-64: có chứng từ đúng loại nhưng chưa xác nhận thuộc người này (tên khác chính tả / khớp nhiều người / danh tính xung đột).
      addOnce(`DOC_OWNER:${it.item_key}:${it.person_id}`, `${it.item_label} — ${who}: ${it.message ?? 'có chứng từ nhưng chưa xác nhận thuộc người này.'}`);
    } else if (it.reason_code === 'RELATIONSHIP_UNVERIFIED' && it.person_id) {
      addOnce(`RELATIONSHIP_UNVERIFIED:${it.person_id}`, `${who}: chưa xác minh được quan hệ với chủ tài sản bảo đảm qua giấy khai sinh.`);
    }
  }  // Đã khớp: trường trọng yếu có dòng S5 MATCH / NEAR_MATCH (gần khớp do nghi lỗi đọc vẫn tính là khớp ở bước Sale).
  const c2Passed: IntakePassed[] = (input.crossCheck?.results ?? [])
    .filter((r) => (r.match_status === 'MATCH' || r.match_status === 'NEAR_MATCH')
      && (MATERIAL_GROUPS.has(r.field_group) || (r.sub_field !== null && MATERIAL_ASSET_SUBFIELDS.has(r.sub_field))))
    .map((r) => ({
      code: `XCHECK_OK:${r.field_group}${r.sub_field ? `.${r.sub_field}` : ''}:${r.person_id ?? r.asset_id ?? 'dossier'}`,
      message: `${r.field_label}${scopeText(r.person_id, r.asset_id)}: khớp giữa ${new Set(r.values.map((v) => v.source.evidence_id)).size} chứng từ${r.match_status === 'NEAR_MATCH' ? ' (có 1 bản nghi đọc sai)' : ''}`,
      group: null,
    }));
  const c2Open = c2Findings.filter((f) => f.status === 'OPEN').length;
  const c2: IntakeCriterion = {
    key: 'CONSISTENT_ACROSS_DOCUMENTS', no: 2, label: 'Thông tin giữa các chứng từ nhất quán',
    goal: 'Các thông tin quan trọng (họ tên, số định danh, ngày sinh, tình trạng hôn nhân, chủ sở hữu và định danh TSBĐ, số tiền vay) không mâu thuẫn; tài sản, vai trò và quan hệ xác định được chắc chắn.',
    status: !input.crossCheck ? 'FAIL' : c2Findings.length === 0 ? 'PASS' : c2Open === 0 ? 'ACCEPTED' : 'NEEDS_EXPLANATION',
    summary: !input.crossCheck ? 'Chưa đối chiếu được giữa các chứng từ.'
      : c2Findings.length === 0 ? 'Không có sai lệch trọng yếu.'
      : c2Open === 0 ? `${c2Findings.length} điểm đã có giải trình.`
      : `${c2Open} điểm cần kiểm tra (sai lệch trọng yếu hoặc chưa xác định chắc).`,
    findings: c2Findings,
    passed: c2Passed,
  };

  // ── 3. Dữ liệu nhập trên hệ thống — chưa áp dụng ──────────────────────────
  const c3: IntakeCriterion = {
    key: 'SYSTEM_DATA_ACCURATE', no: 3, label: 'Dữ liệu nhập trên hệ thống chính xác',
    goal: 'Dữ liệu Sale nhập lên LOS/Secure App phản ánh đúng hồ sơ.',
    status: 'NOT_APPLICABLE',
    summary: 'Chưa áp dụng: dữ liệu nhập trên hệ thống sẽ được gửi kèm request ở phiên bản sau.',
    findings: [],
    passed: [],
  };

  // ── 4. Đủ chất lượng để chuyển CBQL/CO ─────────────────────────────────────
  const c4Findings: IntakeFinding[] = [];
  for (const f of input.classify?.files ?? []) {
    if (f.status === 'CLASSIFIED') continue;
    c4Findings.push(finding(`FILE_UNCLASSIFIED:${f.file_id}`, `Chưa nhận diện được tài liệu: ${f.file_name}`, true));
  }
  for (const e of input.evidences) {
    if (e.status !== 'ERROR' || e.reason_code === 'FORM_NOT_FOUND' || rescanIds.has(e.evidence_id)) continue;
    c4Findings.push(finding(`FILE_UNREADABLE:${e.evidence_id}`, `Không đọc được: ${e.doc_type_label} (${e.file_name} · tr.${e.page_range[0]}-${e.page_range[1]})`, true));
  }
  const c4Open = c4Findings.filter((f) => f.status === 'OPEN').length;
  const fileCount = (input.classify?.files ?? []).filter((f) => f.status === 'CLASSIFIED').length;
  const readable = input.evidences.filter((e) => e.status === 'SUCCESS').length;
  const c4Passed: IntakePassed[] = [
    ...(fileCount > 0 ? [{ code: 'FILES_CLASSIFIED', message: `${fileCount} tài liệu đã nhận diện được loại`, group: null }] : []),
    ...(readable > 0 ? [{ code: 'EVIDENCES_READABLE', message: `${readable} chứng từ đọc được nội dung`, group: null }] : []),
  ];
  const c1Ok = c1.status === 'PASS' || c1.status === 'ACCEPTED';
  const prereq = c1Ok && (c2.status === 'PASS' || c2.status === 'ACCEPTED');
  const ready = prereq && c4Open === 0;
  const pending = [
    !c1Ok && (c1.status === 'NEEDS_EXPLANATION' ? 'còn chứng từ hết hạn chưa giải trình' : 'hồ sơ chưa đầy đủ'),
    !(c2.status === 'PASS' || c2.status === 'ACCEPTED') && 'còn sai lệch chưa giải trình',
    c4Open > 0 && `${c4Open} tài liệu lỗi/chưa nhận diện`,
  ].filter((x): x is string => typeof x === 'string');
  const c4: IntakeCriterion = {
    key: 'READY_FOR_HANDOVER', no: 4, label: 'Hồ sơ đủ chất lượng để chuyển CBQL/CO',
    goal: 'Hồ sơ dùng được cho bước thẩm định; cảnh báo đã bổ sung hoặc chấp nhận có lý do.',
    status: ready ? 'PASS' : 'FAIL',
    summary: ready ? 'Hồ sơ sẵn sàng chuyển sang bước thẩm định tín dụng.' : `Chưa sẵn sàng: ${pending.join('; ')}.`,
    findings: c4Findings,
    passed: c4Passed,
  };

  const all = new Set([...c1Findings, ...c2Findings, ...c4Findings].map((f) => f.code));
  return {
    version: '1.0',
    ready_for_handover: ready,
    criteria: [c1, c2, c3, c4],
    ignored_acknowledgements: input.acknowledgements.map((a) => a.finding_code).filter((c) => !used.has(c) || !all.has(c)),
  };
}
