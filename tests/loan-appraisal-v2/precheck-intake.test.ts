// T-V2-15 — intake_assessment / readiness / dữ kiện LLM dựng từ kết quả kiểm tra sơ bộ (V2-R22, V2-R23). Dữ liệu giả.
import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';
import { skippedPrecheck, summarizePrecheck, type DossierPrecheck, type PrecheckLine, type PrecheckRelation } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';
import {
  buildDeferredDossierOutput, buildPrecheckFacts, buildPrecheckIntake, buildPrecheckIntakeAssessment, buildPrecheckReadiness, DEFERRED_TO_PHASE_2,
} from '@/lib/pipelines/workflows/loan-appraisal/precheck-intake';
import { applyIntakeLlm, buildCriteriaFacts } from '@/lib/pipelines/workflows/loan-appraisal/intake-review';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const evidences = [loanApp([borrower]), ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })];
const classify = classifyOf(evidences);

const line = (over: Partial<PrecheckLine> = {}): PrecheckLine => ({
  item_key: 'legal_id_card', label: 'CCCD', group: 'legal', group_label: 'I. Hồ sơ pháp lý', requirement: 'REQUIRED', subject: 'NGUYỄN VĂN AN',
  status: 'PROVIDED', evidence: [{ doc_ref: 'D02', file_id: evidences[1].file_id, doc_type_key: 'id_card', instance_index: 1 }], note: null, adjusted: false, ...over,
});
const rel = (over: Partial<PrecheckRelation> = {}): PrecheckRelation => ({ topic: 'Người vay', status: 'CONSISTENT', evidence: [], message: 'Cùng người vay.', ...over });

function precheck(lines: PrecheckLine[], relations: PrecheckRelation[] = [rel()], over: Partial<DossierPrecheck> = {}): DossierPrecheck {
  return {
    version: '1.0', draft: true, status: 'COMPLETED', source: 'LLM', warning: null, flow: 'FULL', program_key: 'hkd_secured',
    checklist: lines, relations, overview: 'Hồ sơ vay của NGUYỄN VĂN AN.', next_actions: ['Bổ sung CCCD'], prompt_overridden: false,
    ...summarizePrecheck(lines, relations), ...over,
  };
}
const unavailable = (): DossierPrecheck => ({ ...precheck([], []), status: 'UNAVAILABLE', source: 'NONE', warning: 'LLM lỗi', overview: null, overall: null });

const build = (p: DossierPrecheck | null, acks: Array<{ finding_code: string; reason: string }> = []) =>
  buildPrecheckIntakeAssessment({ precheck: p, classify, evidences, acknowledgements: acks });
const crit = (a: ReturnType<typeof build>, key: string) => a.criteria.find((c) => c.key === key)!;

describe('buildPrecheckIntakeAssessment', () => {
  it('đủ chứng từ, quan hệ khớp → tiêu chí 1, 2 đạt; sẵn sàng bàn giao', () => {
    const a = build(precheck([line()]));
    expect(crit(a, 'DOCUMENTS_COMPLETE')).toMatchObject({ status: 'PASS', no: 1 });
    expect(crit(a, 'DOCUMENTS_COMPLETE').passed).toHaveLength(1);
    expect(crit(a, 'CONSISTENT_ACROSS_DOCUMENTS')).toMatchObject({ status: 'PASS' });
    expect(crit(a, 'CONSISTENT_ACROSS_DOCUMENTS').passed).toHaveLength(1);
    expect(a.criteria).toHaveLength(4);
    expect(crit(a, 'SYSTEM_DATA_ACCURATE').status).toBe('NOT_APPLICABLE');
    expect(a.ready_for_handover).toBe(true);
  });

  it('MISSING → điểm không giải trình được, tiêu chí 1 FAIL; giải trình gửi kèm bị bỏ qua', () => {
    const p = precheck([line({ status: 'MISSING', evidence: [], note: 'Chưa có CCCD.' })]);
    const a = build(p, [{ finding_code: 'DOC_MISSING:legal_id_card:nguyen_van_an', reason: 'sẽ bổ sung' }]);
    const c1 = crit(a, 'DOCUMENTS_COMPLETE');
    expect(c1.status).toBe('FAIL');
    expect(c1.findings[0]).toMatchObject({ code: 'DOC_MISSING:legal_id_card:nguyen_van_an', acknowledgeable: false, status: 'OPEN', group: 'I. Hồ sơ pháp lý' });
    expect(c1.findings[0].message).toContain('Thiếu: CCCD — NGUYỄN VĂN AN');
    expect(a.ignored_acknowledgements).toContain('DOC_MISSING:legal_id_card:nguyen_van_an');
    expect(a.ready_for_handover).toBe(false);
  });

  it('UNCERTAIN của mục bắt buộc → giải trình được: NEEDS_EXPLANATION, có giải trình thì ACCEPTED', () => {
    const p = precheck([line({ status: 'UNCERTAIN', note: 'Ảnh mờ.' })]);
    expect(crit(build(p), 'DOCUMENTS_COMPLETE')).toMatchObject({ status: 'NEEDS_EXPLANATION' });
    const acked = build(p, [{ finding_code: 'DOC_UNCERTAIN:legal_id_card:nguyen_van_an', reason: 'Đã kiểm tra bản gốc' }]);
    expect(crit(acked, 'DOCUMENTS_COMPLETE')).toMatchObject({ status: 'ACCEPTED' });
    expect(crit(acked, 'DOCUMENTS_COMPLETE').findings[0]).toMatchObject({ status: 'ACCEPTED', acknowledgement_reason: 'Đã kiểm tra bản gốc' });
    expect(acked.ignored_acknowledgements).toEqual([]);
  });

  it('UNCERTAIN / NOT_APPLICABLE của mục theo điều kiện không tạo điểm', () => {
    const a = build(precheck([line({ requirement: 'CONDITIONAL', status: 'UNCERTAIN' }), line({ item_key: 'legal_marriage_certificate', requirement: 'CONDITIONAL', status: 'NOT_APPLICABLE' })]));
    expect(crit(a, 'DOCUMENTS_COMPLETE').findings).toHaveLength(0);
    expect(crit(a, 'DOCUMENTS_COMPLETE').status).toBe('PASS');
  });

  it('quan hệ INCONSISTENT / UNCLEAR → điểm giải trình được ở tiêu chí 2; mã REL ổn định theo chủ đề', () => {
    const a = build(precheck([line()], [rel({ topic: 'Số tiền vay', status: 'INCONSISTENT', message: 'Hai giá trị khác nhau.' }), rel({ topic: 'Chủ TSBĐ', status: 'UNCLEAR', message: 'Chưa rõ.' })]));
    const c2 = crit(a, 'CONSISTENT_ACROSS_DOCUMENTS');
    expect(c2.status).toBe('NEEDS_EXPLANATION');
    expect(c2.findings.map((f) => f.code)).toEqual(['REL:so_tien_vay', 'REL:chu_tsbd']);
    expect(c2.findings.every((f) => f.acknowledgeable)).toBe(true);
    const acked = build(precheck([line()], [rel({ topic: 'Số tiền vay', status: 'INCONSISTENT' })]), [{ finding_code: 'REL:so_tien_vay', reason: 'Đã xác nhận với KH' }]);
    expect(crit(acked, 'CONSISTENT_ACROSS_DOCUMENTS').status).toBe('ACCEPTED');
  });

  it('precheck UNAVAILABLE / SKIPPED / null → tiêu chí 1, 2 FAIL không giải trình được; không bao giờ sẵn sàng', () => {
    for (const p of [unavailable(), skippedPrecheck('tắt'), null]) {
      const a = build(p);
      for (const key of ['DOCUMENTS_COMPLETE', 'CONSISTENT_ACROSS_DOCUMENTS']) {
        expect(crit(a, key).status).toBe('FAIL');
        expect(crit(a, key).findings[0]).toMatchObject({ acknowledgeable: false });
        expect(crit(a, key).findings[0].code).toMatch(/^PRECHECK_UNAVAILABLE:/);
        expect(crit(a, key).summary).toContain('Chưa đánh giá');
      }
      expect(a.ready_for_handover).toBe(false);
    }
  });

  it('tiêu chí 4: file chưa nhận diện và chứng từ lỗi đọc vẫn được nêu', () => {
    const bad = { ...classify, files: [...classify.files, { file_id: 'file-zzzzzzzz0001', file_name: 'mo.pdf', status: 'UNKNOWN' as const, reason_code: 'UNCLASSIFIED', next_action: null, message: null, page_count: 1, matches: [] }] };
    const failedEv = { ...ev('cic'), status: 'ERROR' as const, reason_code: 'OCR_FAILED' };
    const a = buildPrecheckIntakeAssessment({ precheck: precheck([line()]), classify: bad as never, evidences: [...evidences, failedEv as never], acknowledgements: [] });
    const c4 = crit(a, 'READY_FOR_HANDOVER');
    expect(c4.status).toBe('FAIL');
    expect(c4.findings.map((f) => f.code.split(':')[0])).toEqual(['FILE_UNCLASSIFIED', 'FILE_UNREADABLE']);
    expect(a.ready_for_handover).toBe(false);
  });

  it('kết quả dùng được với applyIntakeLlm / buildCriteriaFacts (cùng kiểu IntakeAssessment)', () => {
    const a = build(precheck([line({ status: 'MISSING', evidence: [] })]));
    const facts = buildCriteriaFacts(a) as Array<{ key: string; findings: Array<{ ref: string }> }>;
    expect(facts.map((f) => f.key)).toEqual(['DOCUMENTS_COMPLETE', 'CONSISTENT_ACROSS_DOCUMENTS', 'READY_FOR_HANDOVER']);
    expect(facts[0].findings[0].ref).toBe('DOC_MISSING:legal_id_card:nguyen_van_an');
    const dossierFacts = buildPrecheckFacts({ product_name: 'Vay HKD', flow: 'FULL', file_count: 2, evidences, precheck: precheck([line()]) });
    const final = applyIntakeLlm(a, null, dossierFacts);
    expect(final.dossier_summary?.source).toBe('RULES');
    expect(final.review?.source).toBe('RULES');
  });
});

describe('buildPrecheckFacts', () => {
  it('có tổng quan + số đếm của kiểm tra sơ bộ; không có người / tài sản S3; không có tên file hay số giấy tờ', () => {
    const facts = buildPrecheckFacts({ product_name: 'Vay HKD', flow: 'FULL', file_count: 2, evidences, precheck: precheck([line(), line({ item_key: 'x', status: 'MISSING' })]) });
    expect(facts).toMatchObject({ product: 'Vay HKD', flow: 'FULL', file_count: 2, precheck_status: 'COMPLETED', precheck_overview: 'Hồ sơ vay của NGUYỄN VĂN AN.' });
    expect((facts.precheck_counts as Record<string, number>).MISSING).toBe(1);
    expect(facts.persons).toEqual([]);
    expect(facts.assets).toEqual([]);
    const text = JSON.stringify(facts);
    expect(text).not.toContain(ID_A12);
    expect(text).not.toContain('.pdf');
  });

  it('precheck không COMPLETED → trạng thái rõ, không có số đếm', () => {
    const facts = buildPrecheckFacts({ product_name: 'x', flow: null, file_count: 1, evidences, precheck: unavailable() });
    expect(facts).toMatchObject({ precheck_status: 'UNAVAILABLE', precheck_overview: null, precheck_counts: null });
    expect(buildPrecheckFacts({ product_name: 'x', flow: null, file_count: 1, evidences, precheck: null }).precheck_status).toBe('NONE');
  });
});

describe('buildPrecheckReadiness / buildPrecheckIntake', () => {
  it('đủ → READY_FOR_APPRAISAL, không điều kiện', () => {
    const r = buildPrecheckReadiness(precheck([line()]), classify, evidences);
    expect(r).toMatchObject({ status: 'READY_FOR_APPRAISAL', appraisal_conditional: false, required_present: 1, required_total: 1, completeness_percent: 100, blocking_reasons: [] });
  });

  it('thiếu mục bắt buộc → NEEDS_DOCUMENTS kèm yêu cầu bổ sung', () => {
    const r = buildPrecheckReadiness(precheck([line({ status: 'MISSING', evidence: [] })]), classify, evidences);
    expect(r.status).toBe('NEEDS_DOCUMENTS');
    expect(r.blocking_reasons).toContain('REQUIRED_DOCUMENTS_MISSING');
    expect(r.supplement_requests).toEqual(['Bổ sung chứng từ bắt buộc: CCCD — NGUYỄN VĂN AN']);
    expect(r.appraisal_conditional).toBe(true);
  });

  it('quan hệ lệch → NEEDS_VERIFICATION; tên file lấy theo file_id', () => {
    const e = [{ doc_ref: 'D01', file_id: evidences[0].file_id, doc_type_key: 'loan_application', instance_index: 1 }];
    const r = buildPrecheckReadiness(precheck([line()], [rel({ topic: 'Số tiền', status: 'INCONSISTENT', evidence: e, message: 'lệch' })]), classify, evidences);
    expect(r.status).toBe('NEEDS_VERIFICATION');
    expect(r.conflicts[0]).toMatchObject({ severity: 'error', title: 'Số tiền', documents: [evidences[0].file_name] });
    expect(r.blocking_reasons).toContain('CROSS_DOCUMENT_CONFLICT');
  });

  it('precheck không chạy được → NEEDS_VERIFICATION (không bao giờ READY), 0%', () => {
    const r = buildPrecheckReadiness(unavailable(), classify, evidences);
    expect(r.status).toBe('NEEDS_VERIFICATION');
    expect(r.blocking_reasons).toContain('PRECHECK_UNAVAILABLE');
    expect(r.completeness_percent).toBe(0);
    expect(r.appraisal_conditional).toBe(true);
  });

  it('không có chứng từ phân loại / bóc tách được → NOT_PROCESSABLE', () => {
    expect(buildPrecheckReadiness(precheck([line()]), { files: [], repeated_doc_types: [] }, []).status).toBe('NOT_PROCESSABLE');
  });

  it('IntakeResult: điền key/label theo chủ thể, found_in là file_id', () => {
    const i = buildPrecheckIntake(precheck([line(), line({ item_key: 'b', subject: null, status: 'UNCERTAIN' })]), classify, evidences);
    expect(i.checklist[0]).toMatchObject({ key: 'legal_id_card:nguyen_van_an', required: true, status: 'present', found_in: [evidences[1].file_id] });
    expect(i.review_required_keys).toEqual(['b']);
  });
});

describe('buildDeferredDossierOutput', () => {
  it('S3–S5 chưa chạy: customer_360 null, checklist / cross_check NOT_RUN + DEFERRED_TO_PHASE_2, rỗng', () => {
    const out = buildDeferredDossierOutput({ code: 'hkd-loan', name: 'Vay HKD', description: '' }, classify, evidences, 'FULL');
    expect(out.customer_360).toBeNull();
    expect(out.checklist).toMatchObject({ status: 'NOT_RUN', status_code: DEFERRED_TO_PHASE_2, flow: 'FULL', items: [], summary_by_group: [], completeness_percent: null });
    expect(out.cross_check).toMatchObject({ status: 'NOT_RUN', status_code: DEFERRED_TO_PHASE_2, results: [], logic_findings: [], skipped_evidences: [] });
    expect(out.documents.evidences).toHaveLength(2);
    expect(out.completeness_percent).toBe(0);
  });
});
