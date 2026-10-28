// T-V2-17 — giao diện giai đoạn 1 / giai đoạn 2 (D-90, D-91): stage, reducer, selector, thẻ hiển thị theo giai đoạn. Dữ liệu giả.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { classificationCounts, classifiedFileViews, docTypeLabelOf, keyFactGroups, subjectLabel } from '@/app/loan-appraisal-v2/lib/classification-view';
import { ClassificationResults } from '@/components/loan-appraisal-v2/intake/ClassificationResults';
import { INTAKE_STAGE_COUNT, initialRunState, runReducer, type RunAction, type RunState } from '@/app/loan-appraisal-v2/lib/run-reducer';
import { isDeferredToPhase2 } from '@/app/loan-appraisal-v2/lib/selectors';
import { PHASES, STAGES, phaseStatusOf } from '@/app/loan-appraisal-v2/lib/stages';
import { CustomerProfile } from '@/components/loan-appraisal-v2/appraisal/CustomerProfile';
import { IntakeWorkspace } from '@/components/loan-appraisal-v2/intake/IntakeWorkspace';
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { buildProfile360 } from '@/lib/loan-dossier/profile360/build';
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';

const classifiedFile = {
  file_id: 'F1', file_name: 'giay_de_nghi.pdf', status: 'CLASSIFIED', reason_code: null, next_action: null, message: null, page_count: 3,
  matches: [{
    doc_type_key: 'loan_application', confidence: 0.92, needs_manual_review: false, needs_extraction: true, instances_count: 1, hint_mismatch: false,
    instances: [{ instance_index: 1, page_range: [1, 3], confidence: 0.92, summary: 'Giấy đề nghị vay vốn của ông An', key_facts: [{ subject: 'borrower', key: 'full_name', value: 'NGUYEN VAN AN', page: 1 }, { subject: 'borrower', key: 'amount', value: '500000000', page: 2 }, { subject: 'borrower', key: 'loan_purpose', value: null, page: null }] }],
  }],
};

const deferredResult = (): AppraisalResult => ({
  product_code: 'hkd-loan', product_name: 'Vay HKD', output_version: '3.0', result_phase: 'DOSSIER_INTAKE',
  documents: { classify: { files: [classifiedFile], repeated_doc_types: [] }, evidences: [] },
  customer_360: null,
  checklist: { status: 'NOT_RUN', status_code: 'DEFERRED_TO_PHASE_2', flow: 'FULL', items: [], summary_by_group: [], completeness_percent: null },
  cross_check: { status: 'NOT_RUN', status_code: 'DEFERRED_TO_PHASE_2', results: [], logic_findings: [], skipped_evidences: [] },
  completeness_percent: 0,
} as unknown as AppraisalResult);

const legacyPausedResult = (): AppraisalResult => ({
  ...deferredResult(),
  customer_360: { role_registry: [], asset_registry: [], customer_360: [] },
  checklist: { status: 'SUCCESS', status_code: 'COMPLETED', flow: 'FULL', items: [], summary_by_group: [], completeness_percent: 50 },
} as unknown as AppraisalResult);

const assessment = { version: '1.0', ready_for_handover: false, criteria: [], ignored_acknowledgements: [] };

const apply = (s: RunState, ...a: RunAction[]): RunState => a.reduce(runReducer, s);
const running = (): RunState => apply(initialRunState(), { type: 'SUBMIT_START' }, { type: 'SUBMITTED', operationId: 'op-1' });

describe('stages', () => {
  it('giai đoạn 1 có classify và dossier_precheck; extract_evidence thuộc giai đoạn 2; consolidate_dossier đã gỡ khỏi danh sách stage', () => {
    expect(STAGES.find((s) => s.id === 'extract_evidence')?.phase).toBe('CREDIT_APPRAISAL');
    expect(STAGES.find((s) => s.id === 'consolidate_dossier')).toBeUndefined();
    expect(STAGES.filter((s) => s.phase === 'DOSSIER_INTAKE').map((s) => s.id)).toEqual(['classify', 'dossier_precheck']);
    expect(INTAKE_STAGE_COUNT).toBe(2);
    expect(PHASES).toHaveLength(2);
  });

  it('trạng thái phase 1 xong khi classify và kiểm tra sơ bộ xong; phase 2 chưa chạy', () => {
    const s = apply(running(), { type: 'PAUSED', result: deferredResult() });
    expect(phaseStatusOf(s.stages, 'DOSSIER_INTAKE')).toBe('done');
    expect(phaseStatusOf(s.stages, 'CREDIT_APPRAISAL')).toBe('pending');
  });
});

describe('selectors.isDeferredToPhase2', () => {
  it('đúng với output giai đoạn 1 mới; sai với kết quả cuối, kết quả cũ, null', () => {
    expect(isDeferredToPhase2(deferredResult())).toBe(true);
    expect(isDeferredToPhase2(legacyPausedResult())).toBe(false);
    expect(isDeferredToPhase2({ product_code: 'x' } as AppraisalResult)).toBe(false);
    expect(isDeferredToPhase2(null)).toBe(false);
    expect(isDeferredToPhase2(undefined)).toBe(false);
  });
});

describe('run-reducer: PAUSED / RESUMED', () => {
  it('PAUSED với output mới → classify và kiểm tra sơ bộ xong, tiến độ 29%', () => {
    const s = apply(running(), { type: 'PAUSED', result: deferredResult() });
    expect(s.phase).toBe('paused');
    expect(s.stages).toMatchObject({ classify: 'done', dossier_precheck: 'done', extract_evidence: 'pending', calculate_financials: 'pending' });
    expect(s.progressPercent).toBe(Math.round((2 / STAGES.length) * 100));
  });

  it('RESUMED → extract_evidence chạy trước (S2 ở giai đoạn 2)', () => {
    const s = apply(running(), { type: 'PAUSED', result: deferredResult() }, { type: 'RESUME_START' }, { type: 'RESUMED' });
    expect(s.phase).toBe('running');
    expect(s.stages.extract_evidence).toBe('running');
    expect(s.stages.calculate_financials).toBe('pending');
  });

  it('PAUSED không kèm result (result null) → coi như giai đoạn 1 mới', () => {
    expect(apply(running(), { type: 'PAUSED', result: null }).stages.extract_evidence).toBe('pending');
  });
});

describe('classification-view', () => {
  it('nhãn loại chứng từ lấy từ catalog; key lạ giữ nguyên', () => {
    expect(docTypeLabelOf('loan_application')).not.toBe('loan_application');
    expect(docTypeLabelOf('khong_ton_tai')).toBe('khong_ton_tai');
  });

  it('mỗi instance một dòng, kèm trang và độ tin cậy; file lỗi bị loại khỏi danh sách nhận diện', () => {
    const bad = { ...classifiedFile, file_id: 'F2', status: 'UNKNOWN', matches: [] };
    const files = [classifiedFile, bad] as never;
    const views = classifiedFileViews(files);
    expect(views).toHaveLength(1);
    expect(views[0].docs[0]).toMatchObject({ pages: 'tr. 1–3', confidence_percent: 92, needs_review: false });
    expect(classificationCounts(files)).toEqual({ files: 2, classified: 1, docs: 1, unclassified: 1 });
  });
});

describe('IntakeWorkspace (giai đoạn 1)', () => {
  const html = (result: AppraisalResult) => renderToStaticMarkup(createElement(IntakeWorkspace, { classification: null, result, onGoToAppraisal: () => undefined, appraisalPending: true }));

  it('có tổng quan + kết quả phân loại + nút chuyển giai đoạn 2; không có OCR, tiêu chí tiếp nhận, người & tài sản, checklist, đối chiếu chéo', () => {
    const out = html(deferredResult());
    expect(out).toContain('la2-phase1-title');
    expect(out).toContain('la2-classify-title');
    expect(out).toContain('Chuyển sang giai đoạn 2');
    for (const id of ['la2-ocr-title', 'la2-criteria-title', 'la2-dossier-summary-title', 'la2-people-title', 'la2-checklist-title', 'la2-deferred-note']) {
      expect(out).not.toContain(id);
    }
  });

  it('kết quả cũ có intake_assessment vẫn không hiện thẻ giai đoạn 2 ở giai đoạn 1', () => {
    const out = html({ ...deferredResult(), intake_assessment: assessment } as unknown as AppraisalResult);
    expect(out).not.toContain('la2-criteria-title');
  });
});

describe('CustomerProfile (giai đoạn 2)', () => {
  const html = (result: AppraisalResult) => renderToStaticMarkup(createElement(CustomerProfile, { result }));

  it('có intake_assessment: hiện 4 tiêu chí tiếp nhận và không còn nút chuyển giai đoạn', () => {
    const out = html({ ...legacyPausedResult(), intake_assessment: assessment } as unknown as AppraisalResult);
    expect(out).toContain('la2-criteria-title');
    expect(out).not.toContain('Chuyển sang giai đoạn 2');
  });

  it('chưa có intake_assessment: dùng tóm tắt quy tắc và danh sách việc cần hoàn tất', () => {
    const out = html(legacyPausedResult());
    expect(out).toContain('la2-summary-title');
    expect(out).toContain('la2-todo-title');
    expect(out).not.toContain('la2-criteria-title');
  });

  it('output còn hoãn S3–S5: không hiện thẻ người & tài sản / checklist / đối chiếu chéo', () => {
    const out = html(deferredResult());
    expect(out).not.toContain('la2-people-title');
    expect(out).not.toContain('la2-checklist-title');
  });

  // Giai đoạn 2 hiện tại: S3 chạy (customer_360 có dữ liệu) nhưng checklist / đối chiếu chéo tạm tắt (DOSSIER_CHECKS_DISABLED).
  const phase2Result = (): AppraisalResult => ({
    ...deferredResult(), result_phase: undefined,
    customer_360: {
      role_registry: [{
        person_id: 'person-1', roles: ['borrower'], primary_role: 'borrower', other_role_detail: null, full_name: 'NGUYEN VAN AN', declared_id_number: '001090000001',
        current_id_number: '001090000001', historical_id_numbers: [], observed_id_numbers: ['001090000001'],
        id_number_check: { status: 'CONSISTENT', severity: 'INFO', requires_review: false, reason_code: null }, id_number_sources: [], role_conflict: false, role_conflict_details: [], mapped_evidences: [],
      }],
      asset_registry: [],
      customer_360: [{
        person_id: 'person-1', roles: ['borrower'], identity: { full_name: 'NGUYEN VAN AN', id_number: '001090000001', date_of_birth: '1985-02-02', gender: null, permanent_address: null, current_address: null },
        marital_status: 'MARRIED', spouse_person_id: null, business: null, owned_asset_ids: [],
      }],
      relationship_verifications: [], unmapped_evidences: [], superseded_evidences: [],
    },
    checklist: { status: 'NOT_RUN', status_code: 'DOSSIER_CHECKS_DISABLED', flow: 'FULL', items: [], summary_by_group: [], completeness_percent: null },
    cross_check: { status: 'NOT_RUN', status_code: 'DOSSIER_CHECKS_DISABLED', results: [], logic_findings: [], skipped_evidences: [] },
  } as unknown as AppraisalResult);
  /** D-114: giao diện Customer 360 chỉ đọc hồ sơ 360 — dựng như workflow, từ chính customer_360 của fixture. */
  const withProfile = (r: AppraisalResult): AppraisalResult => {
    const s3 = r.customer_360 as unknown as MapDossierData;
    const lac = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences: [], s3, s3_status: 'SUCCESS' });
    return { ...r, profile_360: buildProfile360({ evidences: [], s3, lac, segment: 'HKD' }) } as AppraisalResult;
  };

  it('S3 chạy, checklist / đối chiếu chéo tạm tắt: VẪN hiện Customer 360 (từ hồ sơ 360), không hiện checklist / đối chiếu chéo', () => {
    const out = html(withProfile(phase2Result()));
    expect(out).toContain('la2-c360-title');
    expect(out).toContain('Đề nghị vay vốn');
    expect(out).toContain('NGUYEN VAN AN');
    expect(out).toContain('001090000001');
    expect(out).not.toContain('la2-checklist-title');
  });

  it('S3 lỗi (customer_360 = null, không có hồ sơ 360) ở giai đoạn 2: Customer 360 báo chưa có, không hiện khách hàng', () => {
    const out = html({ ...phase2Result(), customer_360: null, profile_360: null } as unknown as AppraisalResult);
    expect(out).toContain('Chưa có hồ sơ 360');
    expect(out).not.toContain('NGUYEN VAN AN');
  });

  it('có dossier_graph: sơ đồ quan hệ được tải động (không render ở server); không dossier_graph: không có khối', () => {
    const withGraph = html({ ...phase2Result(), dossier_graph: { version: '1.0', nodes: [{ id: 'person-1', kind: 'person', type: 'borrower', roles: ['borrower'] }], edges: [] } } as unknown as AppraisalResult);
    expect(withGraph).not.toContain('la2-graph-title');
    expect(html(phase2Result())).not.toContain('la2-graph-title');
  });
});
describe('ClassificationResults: tên file → mẫu biểu → tóm tắt → thông tin chính', () => {
  const multi = {
    ...classifiedFile, file_id: 'F3', file_name: 'chung_thu.pdf', page_count: 25,
    matches: [
      { ...classifiedFile.matches[0], doc_type_key: 'id_card', instances: [{ instance_index: 1, page_range: [22, 23], confidence: 1, summary: 'CCCD của bà Kiều Anh', key_facts: [{ subject: 'person-1', key: 'id_number', value: '001090000001', page: 22 }] }] },
      { ...classifiedFile.matches[0], doc_type_key: 'land_use_certificate', instances: [{ instance_index: 1, page_range: [24, 25], confidence: 1, summary: 'GCN QSDĐ của bà Kiều Anh', key_facts: [] }] },
    ],
  };

  it('keyFactGroups: gom theo đối tượng, bỏ giá trị rỗng/null, đặt nhãn tiếng Việt, định dạng số tiền', () => {
    const groups = keyFactGroups(classifiedFile.matches[0].instances[0].key_facts);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ subject: 'borrower', label: 'Người vay' });
    expect(groups[0].rows.map((r) => r.key)).toEqual(['full_name', 'amount']);
    expect(groups[0].rows[0].label).toBe('Họ và tên');
    expect(groups[0].rows[1].value).toContain('500.000.000');
    expect(subjectLabel('person-2')).toBe('Người 2');
    expect(subjectLabel('asset-1')).toBe('Tài sản 1');
    expect(subjectLabel('khac')).toBe('khac');
  });

  it('file nhiều mẫu biểu: mỗi mẫu biểu có tóm tắt và thông tin chính riêng, đúng thứ tự', () => {
    const html = renderToStaticMarkup(createElement(ClassificationResults, { files: [multi] as never }));
    const iFile = html.indexOf('chung_thu.pdf');
    const iId = html.indexOf('CCCD của bà Kiều Anh');
    const iFact = html.indexOf('001090000001');
    const iGcn = html.indexOf('GCN QSDĐ của bà Kiều Anh');
    expect(iFile).toBeGreaterThan(-1);
    expect(iFile).toBeLessThan(iId);
    expect(iId).toBeLessThan(iFact);
    expect(iFact).toBeLessThan(iGcn);
    expect(html).toContain('2 mẫu biểu');
    expect(html).toContain('Số định danh');
    expect(html).toContain('tr. 22');
  });

  it('mẫu biểu không có key_facts (loại LIGHT) chỉ hiện tóm tắt, không có bảng', () => {
    const html = renderToStaticMarkup(createElement(ClassificationResults, { files: [multi] as never }));
    const tail = html.slice(html.indexOf('GCN QSDĐ của bà Kiều Anh'));
    expect(tail).not.toContain('Thông tin chính');
  });
});
