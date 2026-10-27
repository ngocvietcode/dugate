// Giai đoạn 1 tinh gọn (D-81…D-84; V2-R21…R23): dựng kết quả tiếp nhận TỪ kết quả kiểm tra sơ bộ bằng LLM (`dossier_precheck`)
// thay cho S3–S5. Toàn hàm thuần, không gọi model, không I/O. Code S3–S5 và `buildIntakeAssessment` vẫn còn nguyên
// (dùng khi `intake_run_consolidate = true` hoặc operation cũ).
import type { ClassifyData } from '@/lib/loan-dossier/contracts/stage-result';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import type { ChecklistItemResult, LoanProduct } from '../prompts/loan-appraisal-prompts';
import type { DossierPrecheck, PrecheckLine, PrecheckRelation } from './dossier-precheck';
import type { Acknowledgement, IntakeAssessment, IntakeCriterion, IntakeFinding, IntakePassed } from './intake-assessment';
import { buildDossierFacts } from './intake-review';
import type { DossierOutputV3, DossierReadinessResult, IntakeResult } from './types';

/** `status_code` của checklist / cross_check ở giai đoạn 1 tinh gọn: S3–S5 chưa chạy, sẽ chạy ở giai đoạn 2. */
export const DEFERRED_TO_PHASE_2 = 'DEFERRED_TO_PHASE_2';
/**
 * Giai đoạn 2 tạm thời KHÔNG chạy các bước kiểm tra hồ sơ (checklist, Customer 360, đối chiếu chéo, master data, kiểm tra nháp): kết quả chỉ
 * có OCR (S2), chỉ số tài chính, bộ rule và khuyến nghị. Các khối kiểm tra mang mã này để giao diện và consumer phân biệt với "chạy nhưng rỗng".
 */
export const DOSSIER_CHECKS_DISABLED = 'DOSSIER_CHECKS_DISABLED';

export interface PrecheckIntakeInput {
  precheck: DossierPrecheck | null;
  classify: ClassifyData | null;
  evidences: ReadonlyArray<EvidenceEnvelope>;
  acknowledgements: ReadonlyArray<Acknowledgement>;
}

const completed = (p: DossierPrecheck | null): p is DossierPrecheck => p !== null && p.status === 'COMPLETED';

/** Mã ổn định từ chữ có dấu: bỏ dấu, chữ thường, ký tự lạ thành `_`. */
function slug(text: string | null | undefined): string {
  const s = (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (s || 'dossier').slice(0, 60);
}

const head = (l: PrecheckLine) => `${l.label}${l.subject ? ` — ${l.subject}` : ''}`;
const REL_STATUS: Record<PrecheckRelation['status'], string> = { CONSISTENT: 'Khớp', INCONSISTENT: 'Có điểm lệch', UNCLEAR: 'Chưa rõ' };

/** Tiêu chí 1 và 2 chỉ được đạt khi đã đánh giá được; `UNAVAILABLE` / `SKIPPED` → Chưa đạt, không giải trình được. */
export function buildPrecheckIntakeAssessment(input: PrecheckIntakeInput): IntakeAssessment {
  const acks = new Map(input.acknowledgements.map((a) => [a.finding_code, a.reason]));
  const used = new Set<string>();
  const finding = (code: string, message: string, acknowledgeable: boolean, group: string | null = null): IntakeFinding => {
    const reason = acknowledgeable ? acks.get(code) ?? null : null;
    if (reason !== null) used.add(code);
    return { code, message, group, acknowledgeable, status: reason !== null ? 'ACCEPTED' : 'OPEN', acknowledgement_reason: reason };
  };
  const pre = completed(input.precheck) ? input.precheck : null;
  const unavailable = (what: string) => finding(`PRECHECK_UNAVAILABLE:${what}`, 'Chưa đánh giá được vì bước kiểm tra sơ bộ bằng AI không chạy được hoặc đã tắt.', false);

  // ── 1. Hồ sơ đầy đủ: dòng checklist do LLM đánh giá ──────────────────────
  // MISSING = chưa có chứng từ (không giải trình được). UNCERTAIN của mục bắt buộc = cần kiểm tra (giải trình được).
  // UNCERTAIN của mục theo điều kiện không tính (cùng cách tính `overall` của kiểm tra sơ bộ).
  const lines = pre?.checklist ?? [];
  const c1Findings: IntakeFinding[] = pre
    ? lines.flatMap((l) => {
      const code = (k: string) => `${k}:${l.item_key}:${slug(l.subject)}`;
      if (l.status === 'MISSING') return [finding(code('DOC_MISSING'), `Thiếu: ${head(l)}${l.note ? ` - ${l.note}` : ''}`, false, l.group_label)];
      if (l.status === 'UNCERTAIN' && l.requirement === 'REQUIRED') return [finding(code('DOC_UNCERTAIN'), `Cần kiểm tra: ${head(l)}${l.note ? ` - ${l.note}` : ''}`, true, l.group_label)];
      return [];
    })
    : [unavailable('documents')];
  const c1Passed: IntakePassed[] = lines.filter((l) => l.status === 'PROVIDED').map((l) => ({ code: `DOC_OK:${l.item_key}:${slug(l.subject)}`, message: head(l), group: l.group_label }));
  const requiredLines = lines.filter((l) => l.requirement === 'REQUIRED' && l.status !== 'NOT_APPLICABLE');
  const c1Open = c1Findings.filter((f) => f.status === 'OPEN');
  const c1Hard = c1Open.filter((f) => !f.acknowledgeable).length;
  const c1: IntakeCriterion = {
    key: 'DOCUMENTS_COMPLETE', no: 1, label: 'Hồ sơ đầy đủ theo quy định',
    goal: 'Đủ loại chứng từ bắt buộc theo luồng hồ sơ cho từng người, từng tài sản (AI đánh giá sơ bộ trên tóm tắt và dữ kiện chính của từng chứng từ).',
    status: !pre ? 'FAIL' : c1Findings.length === 0 ? 'PASS' : c1Hard > 0 ? 'FAIL' : c1Open.length > 0 ? 'NEEDS_EXPLANATION' : 'ACCEPTED',
    summary: !pre
      ? 'Chưa đánh giá được checklist (kiểm tra sơ bộ không chạy được).'
      : c1Findings.length === 0
        ? `Đủ ${requiredLines.filter((l) => l.status === 'PROVIDED').length}/${requiredLines.length} mục bắt buộc của luồng ${pre.flow ?? ''}.`.replace(/ \.$/, '.')
        : c1Hard > 0
          ? `Còn ${c1Open.length} mục bắt buộc chưa đạt (luồng ${pre.flow ?? '—'}).`
          : c1Open.length > 0 ? `${c1Open.length} mục cần kiểm tra (luồng ${pre.flow ?? '—'}).` : `${c1Findings.length} mục đã giải trình (luồng ${pre.flow ?? '—'}).`,
    findings: c1Findings,
    passed: c1Passed,
  };

  // ── 2. Nhất quán giữa các chứng từ: quan hệ do LLM đánh giá ──────────────
  const rels = pre?.relations ?? [];
  const c2Findings: IntakeFinding[] = pre
    ? rels.filter((r) => r.status !== 'CONSISTENT').map((r) => finding(`REL:${slug(r.topic)}`, `${r.topic} — ${REL_STATUS[r.status]}: ${r.message}`, true))
    : [unavailable('relations')];
  const c2Passed: IntakePassed[] = rels.filter((r) => r.status === 'CONSISTENT').map((r) => ({ code: `REL_OK:${slug(r.topic)}`, message: `${r.topic}: ${r.message}`, group: null }));
  const c2Open = c2Findings.filter((f) => f.status === 'OPEN');
  const c2Hard = c2Open.filter((f) => !f.acknowledgeable).length;
  const c2: IntakeCriterion = {
    key: 'CONSISTENT_ACROSS_DOCUMENTS', no: 2, label: 'Thông tin giữa các chứng từ nhất quán',
    goal: 'Các thông tin quan trọng (họ tên, số định danh, tình trạng hôn nhân, chủ sở hữu và định danh TSBĐ, số tiền vay) không mâu thuẫn giữa các chứng từ (AI đánh giá sơ bộ).',
    status: !pre ? 'FAIL' : c2Findings.length === 0 ? 'PASS' : c2Hard > 0 ? 'FAIL' : c2Open.length > 0 ? 'NEEDS_EXPLANATION' : 'ACCEPTED',
    summary: !pre ? 'Chưa đánh giá được quan hệ giữa các chứng từ (kiểm tra sơ bộ không chạy được).'
      : c2Findings.length === 0 ? 'AI chưa phát hiện điểm lệch giữa các chứng từ.'
      : c2Open.length === 0 ? `${c2Findings.length} điểm đã có giải trình.`
      : `${c2Open.length} điểm cần kiểm tra (lệch hoặc chưa xác định chắc).`,
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

  // ── 4. Đủ chất lượng để chuyển CBQL/CO — như cũ (file chưa nhận diện, chứng từ S2 lỗi đọc) ──
  const c4Findings: IntakeFinding[] = [];
  for (const f of input.classify?.files ?? []) {
    if (f.status === 'CLASSIFIED') continue;
    c4Findings.push(finding(`FILE_UNCLASSIFIED:${f.file_id}`, `Chưa nhận diện được tài liệu: ${f.file_name}`, true));
  }
  for (const e of input.evidences) {
    if (e.status !== 'ERROR' || e.reason_code === 'FORM_NOT_FOUND') continue;
    c4Findings.push(finding(`FILE_UNREADABLE:${e.evidence_id}`, `Không đọc được: ${e.doc_type_label} (${e.file_name} · tr.${e.page_range[0]}-${e.page_range[1]})`, true));
  }
  const c4Open = c4Findings.filter((f) => f.status === 'OPEN').length;
  const fileCount = (input.classify?.files ?? []).filter((f) => f.status === 'CLASSIFIED').length;
  const readable = input.evidences.filter((e) => e.status === 'SUCCESS').length;
  const c4Passed: IntakePassed[] = [
    ...(fileCount > 0 ? [{ code: 'FILES_CLASSIFIED', message: `${fileCount} tài liệu đã nhận diện được loại`, group: null }] : []),
    ...(readable > 0 ? [{ code: 'EVIDENCES_READABLE', message: `${readable} chứng từ đọc được nội dung`, group: null }] : []),
  ];
  const ok = (c: IntakeCriterion) => c.status === 'PASS' || c.status === 'ACCEPTED';
  const ready = ok(c1) && ok(c2) && c4Open === 0;
  const pending = [
    !ok(c1) && (c1.status === 'NEEDS_EXPLANATION' ? 'còn mục cần kiểm tra chưa giải trình' : 'hồ sơ chưa đầy đủ hoặc chưa đánh giá được'),
    !ok(c2) && 'còn điểm lệch chưa giải trình hoặc chưa đánh giá được',
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

/** Dữ kiện hồ sơ cho LLM `intake_review` / `dossier_summary`: khoản vay từ S2 + kết quả kiểm tra sơ bộ; không có người / tài sản của S3. */
export function buildPrecheckFacts(input: {
  product_name: string;
  flow: string | null;
  file_count: number;
  evidences: ReadonlyArray<EvidenceEnvelope>;
  precheck: DossierPrecheck | null;
}): Record<string, unknown> {
  const base = buildDossierFacts({ product_name: input.product_name, flow: input.flow, file_count: input.file_count, s3: null, evidences: input.evidences });
  const p = input.precheck;
  return {
    ...base,
    precheck_status: p?.status ?? 'NONE',
    precheck_overview: p?.overview ?? null,
    precheck_next_actions: p?.next_actions ?? [],
    precheck_counts: completed(p) ? p.by_status : null,
  };
}

const LEGACY_STATUS: Record<PrecheckLine['status'], ChecklistItemResult['status']> = { PROVIDED: 'present', NOT_APPLICABLE: 'present', MISSING: 'missing', UNCERTAIN: 'review' };

/** `IntakeResult` kiểu v2 từ kết quả kiểm tra sơ bộ (chỉ để điền output giai đoạn 1; giai đoạn 2 dựng lại từ S4). */
export function buildPrecheckIntake(precheck: DossierPrecheck | null, classify: ClassifyData | null, evidences: ReadonlyArray<EvidenceEnvelope>): IntakeResult {
  const lines = completed(precheck) ? precheck.checklist : [];
  const checklist: ChecklistItemResult[] = lines.map((l) => ({
    key: l.subject ? `${l.item_key}:${slug(l.subject)}` : l.item_key,
    label: head(l),
    required: l.requirement === 'REQUIRED',
    status: LEGACY_STATUS[l.status],
    found_in: [...new Set(l.evidence.map((e) => e.file_id))],
    ...(l.note ? { note: l.note } : {}),
  }));
  const required = checklist.filter((c) => c.required);
  return {
    required_present: required.filter((c) => c.status === 'present').length,
    required_total: required.length,
    completeness_percent: required.length ? Math.round((required.filter((c) => c.status === 'present').length / required.length) * 100) : 0,
    checklist,
    missing_required_keys: required.filter((c) => c.status === 'missing').map((c) => c.key),
    review_required_keys: required.filter((c) => c.status === 'review').map((c) => c.key),
    extraction_errors: evidences.filter((e) => e.status === 'ERROR').map((e) => ({ file_name: e.file_name, doc_type_key: e.doc_type_key, error: e.reason_code ?? 'ERROR' })),
    error_files: (classify?.files ?? []).filter((f) => f.status !== 'CLASSIFIED').map((f) => ({
      file_name: f.file_name, doc_type_key: 'unknown', reason: f.message ?? f.reason_code ?? f.status,
      suggested_action: f.next_action === 'CONVERT_AND_REUPLOAD' || f.next_action === 'RESCAN_AND_REUPLOAD' || f.next_action === 'REMOVE_PASSWORD_AND_REUPLOAD' ? 'REQUEST_SUPPLEMENT' as const : 'REVIEW' as const,
    })),
    blank_fields: [],
  };
}

/** Mức sẵn sàng (khuyến cáo) giai đoạn 1 từ kết quả kiểm tra sơ bộ. Chưa đánh giá được → NEEDS_VERIFICATION, không bao giờ READY. */
export function buildPrecheckReadiness(precheck: DossierPrecheck | null, classify: ClassifyData | null, evidences: ReadonlyArray<EvidenceEnvelope>): DossierReadinessResult {
  const intake = buildPrecheckIntake(precheck, classify, evidences);
  const pre = completed(precheck) ? precheck : null;
  const lines = pre?.checklist ?? [];
  const nameOf = new Map((classify?.files ?? []).map((f) => [f.file_id, f.file_name]));
  const unclassified = (classify?.files ?? []).filter((f) => f.status !== 'CLASSIFIED').map((f) => ({ file_name: f.file_name, reason: f.message ?? f.reason_code ?? 'Không nhận dạng được loại chứng từ' }));
  const conflicts = (pre?.relations ?? []).filter((r) => r.status !== 'CONSISTENT').map((r) => {
    const ids = [...new Set(r.evidence.map((e) => e.file_id))];
    return {
      severity: r.status === 'INCONSISTENT' ? 'error' as const : 'warning' as const,
      title: r.topic,
      message: r.message,
      documents: ids.map((id) => nameOf.get(id) ?? id),
      evidence_ids: evidences.filter((e) => ids.includes(e.file_id)).map((e) => e.evidence_id),
    };
  });
  const blockingConflicts = conflicts.filter((c) => c.severity === 'error');
  const requiredMissing = lines.filter((l) => l.requirement === 'REQUIRED' && l.status === 'MISSING');
  const requiredReview = lines.filter((l) => l.requirement === 'REQUIRED' && l.status === 'UNCERTAIN');
  const classifiedCount = (classify?.files ?? []).filter((f) => f.status === 'CLASSIFIED').length;
  const extractedCount = evidences.filter((e) => e.status === 'SUCCESS').length;

  const blocking_reasons = [
    ...(!pre ? ['PRECHECK_UNAVAILABLE'] : []),
    ...(requiredMissing.length > 0 ? ['REQUIRED_DOCUMENTS_MISSING'] : []),
    ...(requiredReview.length > 0 ? ['DOCUMENTS_NEED_REVIEW'] : []),
    ...(unclassified.length > 0 ? ['UNCLASSIFIED_DOCUMENTS'] : []),
    ...(intake.extraction_errors.length > 0 ? ['EXTRACTION_ERRORS'] : []),
    ...(blockingConflicts.length > 0 ? ['CROSS_DOCUMENT_CONFLICT'] : []),
  ];
  // `evidences` rỗng = S2 chưa chạy (giai đoạn 1 dừng ngay sau kiểm tra sơ bộ, D-90) → chỉ xét số file đã phân loại.
  const status: DossierReadinessResult['status'] = classifiedCount === 0 || (evidences.length > 0 && extractedCount === 0)
    ? 'NOT_PROCESSABLE'
    : requiredMissing.length > 0 ? 'NEEDS_DOCUMENTS' : blocking_reasons.length > 0 ? 'NEEDS_VERIFICATION' : 'READY_FOR_APPRAISAL';
  return {
    status,
    completeness_percent: pre ? intake.completeness_percent : 0,
    required_present: pre ? intake.required_present : 0,
    required_total: pre ? intake.required_total : 0,
    missing_required_keys: intake.missing_required_keys,
    review_required_keys: intake.review_required_keys,
    unclassified_files: unclassified,
    extraction_errors: intake.extraction_errors,
    conflicts,
    supplement_requests: [...new Set([
      ...requiredMissing.map((l) => `Bổ sung chứng từ bắt buộc: ${head(l)}`),
      ...requiredReview.map((l) => `Làm rõ/hoàn thiện chứng từ: ${head(l)}`),
      ...unclassified.map((f) => `Xác nhận loại chứng từ cho tài liệu: ${f.file_name}`),
      ...intake.extraction_errors.map((e) => `Cung cấp lại bản đọc được cho: ${e.file_name}`),
      ...blockingConflicts.map((c) => `Xử lý dữ liệu không khớp: ${c.title}`),
    ])],
    blocking_reasons: [...new Set(blocking_reasons)],
    appraisal_conditional: status !== 'READY_FOR_APPRAISAL',
  };
}

/** Phần kết quả hồ sơ ở giai đoạn 1 tinh gọn: chỉ S1 có dữ liệu (vidences rỗng vì S2 chưa chạy), S3–S5 chưa chạy (V2-R21, D-90). */
export function buildDeferredDossierOutput(
  product: LoanProduct,
  classify: { files: ClassifyData['files']; repeated_doc_types: ClassifyData['repeated_doc_types'] },
  evidences: DossierOutputV3['documents']['evidences'],
  flow: string | null,
  statusCode: string = DEFERRED_TO_PHASE_2,
): DossierOutputV3 {
  return {
    product_code: product.code,
    product_name: product.name,
    documents: { classify: { files: classify.files, repeated_doc_types: classify.repeated_doc_types }, evidences },
    customer_360: null,
    checklist: { status: 'NOT_RUN', status_code: statusCode, flow, items: [], summary_by_group: [], completeness_percent: null },
    cross_check: { status: 'NOT_RUN', status_code: statusCode, results: [], logic_findings: [], skipped_evidences: [] },
    completeness_percent: 0,
  };
}
