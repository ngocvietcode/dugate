// D-59 — kiểm tra nháp cho Sale bằng LLM + tổng kết tóm tắt (intake-review.ts).
import { buildIntakeAssessment, type IntakeAssessment, type IntakeAssessmentInput } from '@/lib/pipelines/workflows/loan-appraisal/intake-assessment';
import {
  applyIntakeLlm, buildCriteriaFacts, DOSSIER_SUMMARY_STEP, INTAKE_REVIEW_PROMPT_TEMPLATE, INTAKE_REVIEW_STEP, mergeReview, runIntakeLlm,
  type AskModel, type IntakeLlmCache, type ReviewRaw,
} from '@/lib/pipelines/workflows/loan-appraisal/intake-review';

const row = (o: Record<string, unknown>) => ({
  item_key: 'credit_cic_report', item_label: 'Báo cáo CIC', checklist_group: 'credit_relationship', required: true,
  status: 'MISSING', reason_code: 'DOCUMENT_NOT_FOUND', message: 'Chưa có chứng từ trong hồ sơ.', person_id: null, asset_id: null, found_in: [], ...o,
});
const expiredCic = row({ reason_code: 'DOCUMENT_EXPIRED', message: 'Chứng từ cấp ngày 2026-07-14 đã quá thời hạn 30 ngày.' });
const missingId = row({ item_key: 'legal_id_card', item_label: 'Căn cước công dân', checklist_group: 'legal' });

function rule(items: unknown[], o: Partial<IntakeAssessmentInput> = {}): IntakeAssessment {
  return buildIntakeAssessment({
    classify: { files: [], repeated_doc_types: [] } as never, evidences: [], s3: null,
    checklist: { items, flow: 'FULL' } as never, crossCheck: { results: [] } as never, acknowledgements: [], ...o,
  });
}
const crit = (a: IntakeAssessment, no: number) => a.criteria[no - 1];
const facts = { product: 'Vay HKD', flow: 'FULL', file_count: 3, persons: [{ person_id: 'person-1', name: 'NGUYỄN VĂN AN', roles: ['borrower'] }], assets: [], loan: null };

const reviewOf = (c: Array<Record<string, unknown>>): ReviewRaw => ({ criteria: c as never });
const lc = (key: string, status: string, findings: Array<Record<string, unknown>> = [], summary = 'Nhận xét của LLM.') => ({ key, status, summary, findings });

describe('mergeReview', () => {
  it('lấy trạng thái, tóm tắt và câu chữ của LLM; điểm có ref giữ mã / quyền giải trình của quy tắc', () => {
    const r = rule([expiredCic]);
    const ref = crit(r, 1).findings[0].code;
    const m = mergeReview(r, reviewOf([lc('DOCUMENTS_COMPLETE', 'NEEDS_EXPLANATION', [{ ref, message: 'CIC đã quá hạn, nên xin bản mới.' }], 'Còn 1 chứng từ hết hạn.')]));
    expect(crit(m, 1)).toMatchObject({ status: 'NEEDS_EXPLANATION', summary: 'Còn 1 chứng từ hết hạn.' });
    expect(crit(m, 1).findings).toEqual([expect.objectContaining({ code: ref, message: 'CIC đã quá hạn, nên xin bản mới.', acknowledgeable: true, status: 'OPEN' })]);
    expect(crit(m, 3)).toEqual(crit(r, 3));
    expect(crit(m, 1).passed).toEqual(crit(r, 1).passed);
  });

  it('LLM không được bỏ điểm thiếu chứng từ bắt buộc; bỏ điểm chỉ cần kiểm tra thì được', () => {
    const r = rule([missingId, expiredCic]);
    const m = mergeReview(r, reviewOf([lc('DOCUMENTS_COMPLETE', 'PASS', [])]));
    expect(crit(m, 1).findings.map((f) => f.code)).toEqual(['DOC_MISSING:legal_id_card:dossier']);
    expect(crit(m, 1).status).toBe('FAIL');
  });

  it('LLM báo PASS nhưng còn điểm chưa xử lý → hạ xuống Cần kiểm tra', () => {
    const r = rule([expiredCic]);
    const m = mergeReview(r, reviewOf([lc('DOCUMENTS_COMPLETE', 'PASS', [{ ref: crit(r, 1).findings[0].code, message: 'CIC hết hạn.' }])]));
    expect(crit(m, 1).status).toBe('NEEDS_EXPLANATION');
  });

  it('điểm mới của LLM (không ref) có mã LLM:*, không giải trình được; ref lạ cũng coi là điểm mới', () => {
    const m = mergeReview(rule([]), reviewOf([lc('CONSISTENT_ACROSS_DOCUMENTS', 'NEEDS_EXPLANATION', [{ ref: 'KHONG_CO', message: 'Tên hai chứng từ hơi khác.' }, { message: 'Số điện thoại khác.', group: 'Khác' }])]));
    expect(crit(m, 2).findings.map((f) => [f.code, f.acknowledgeable, f.group])).toEqual([['LLM:CONSISTENT_ACROSS_DOCUMENTS:1', false, null], ['LLM:CONSISTENT_ACROSS_DOCUMENTS:2', false, 'Khác']]);
  });

  it('tiêu chí LLM không nhắc đến giữ nguyên kết quả quy tắc; ready_for_handover tính lại từ trạng thái cuối', () => {
    const r = rule([missingId]);
    const m = mergeReview(r, reviewOf([lc('READY_FOR_HANDOVER', 'PASS')]));
    expect(crit(m, 1)).toEqual(crit(r, 1));
    expect(m.ready_for_handover).toBe(false);
    const ok = mergeReview(rule([]), reviewOf([lc('DOCUMENTS_COMPLETE', 'PASS'), lc('CONSISTENT_ACROSS_DOCUMENTS', 'PASS'), lc('READY_FOR_HANDOVER', 'PASS')]));
    expect(ok.ready_for_handover).toBe(true);
  });
});

describe('runIntakeLlm', () => {
  const goodReview = { criteria: [lc('DOCUMENTS_COMPLETE', 'FAIL', [{ ref: 'DOC_MISSING:legal_id_card:dossier', message: 'Thiếu CCCD.' }])] };
  const goodSummary = { overview: 'Hồ sơ vay HKD của NGUYỄN VĂN AN.', highlights: ['Thiếu CCCD'], next_actions: ['Bổ sung CCCD'] };

  function askWith(map: Record<string, unknown>) {
    const prompts: Array<[string, string]> = [];
    const ask: AskModel = async (step, prompt) => {
      prompts.push([step, prompt]);
      const v = map[step];
      if (v instanceof Error) throw v;
      return v;
    };
    return { ask, prompts };
  }

  it('mặc định chỉ 1 lời gọi (tổng kết); dữ kiện bọc trong thẻ untrusted, có guard chống injection', async () => {
    const r = rule([missingId]);
    const { ask, prompts } = askWith({ [INTAKE_REVIEW_STEP]: goodReview, [DOSSIER_SUMMARY_STEP]: goodSummary });
    const cache = await runIntakeLlm(r, facts, ask, {});
    expect(prompts.map((p) => p[0])).toEqual([DOSSIER_SUMMARY_STEP]);
    expect(prompts[0][1]).toContain('[AN TOÀN DỮ LIỆU]');
    expect(prompts[0][1]).toContain('<untrusted_review>');
    expect(cache.review).toBeNull();
    expect(cache.summary?.overview).toContain('NGUYỄN VĂN AN');
    expect(cache.warnings).toEqual([]);
  });

  it('review:true (đường lùi): 2 lời gọi, chấm tiêu chí rồi tổng kết có đọc kết quả chấm', async () => {
    const r = rule([missingId]);
    const { ask, prompts } = askWith({ [INTAKE_REVIEW_STEP]: goodReview, [DOSSIER_SUMMARY_STEP]: goodSummary });
    const cache = await runIntakeLlm(r, facts, ask, {}, undefined, { review: true });
    expect(prompts.map((p) => p[0])).toEqual([INTAKE_REVIEW_STEP, DOSSIER_SUMMARY_STEP]);
    expect(prompts[0][1]).toContain('[AN TOÀN DỮ LIỆU]');
    expect(prompts[0][1]).toContain('<untrusted_criteria_facts>');
    expect(prompts[0][1]).toContain('DOC_MISSING:legal_id_card:dossier');
    expect(prompts[1][1]).toContain('<untrusted_review>');
    expect(prompts[1][1]).toContain('Thiếu CCCD.');
    expect(cache).toMatchObject({ warnings: [], prompt_overridden: { intake_review: false, dossier_summary: false } });
    expect(cache.review?.criteria[0].key).toBe('DOCUMENTS_COMPLETE');
    expect(cache.summary?.overview).toContain('NGUYỄN VĂN AN');
  });

  it('prompt ghi đè được dùng; thiếu placeholder bắt buộc thì tự nối vào cuối', async () => {
    const { ask, prompts } = askWith({ [INTAKE_REVIEW_STEP]: goodReview, [DOSSIER_SUMMARY_STEP]: goodSummary });
    const cache = await runIntakeLlm(rule([missingId]), facts, ask, { [INTAKE_REVIEW_STEP]: 'Chấm thật nhẹ tay thôi.' }, undefined, { review: true });
    expect(prompts[0][1]).toContain('Chấm thật nhẹ tay thôi.');
    expect(prompts[0][1]).not.toContain('Chấm 3 tiêu chí');
    expect(prompts[0][1]).toContain('DOC_MISSING:legal_id_card:dossier');
    expect(prompts[0][1]).toContain('"criteria"');
    expect(cache.prompt_overridden).toEqual({ intake_review: true, dossier_summary: false });
  });

  it('phản hồi sai định dạng / model lỗi → null kèm cảnh báo, không ném lỗi', async () => {
    const { ask } = askWith({ [INTAKE_REVIEW_STEP]: { criteria: [{ key: 'DOCUMENTS_COMPLETE', status: 'TUYỆT_VỜI', summary: 'x' }] }, [DOSSIER_SUMMARY_STEP]: new Error('timeout') });
    const cache = await runIntakeLlm(rule([missingId]), facts, ask, {}, undefined, { review: true });
    expect(cache.review).toBeNull();
    expect(cache.summary).toBeNull();
    expect(cache.warnings).toHaveLength(2);
    expect(cache.warnings[1]).toContain('timeout');
  });

  it('lỗi huỷ operation được ném lại, không bị nuốt thành cảnh báo', async () => {
    class Cancelled extends Error {}
    const { ask } = askWith({ [INTAKE_REVIEW_STEP]: new Cancelled('cancelled') });
    await expect(runIntakeLlm(rule([]), facts, ask, {}, (e) => e instanceof Cancelled, { review: true })).rejects.toBeInstanceOf(Cancelled);
  });

  it('chuỗi thô không phải JSON → coi là sai định dạng', async () => {
    const { ask } = askWith({ [INTAKE_REVIEW_STEP]: 'xin lỗi, tôi không thể', [DOSSIER_SUMMARY_STEP]: 'không biết' });
    const cache = await runIntakeLlm(rule([]), facts, ask, {}, undefined, { review: true });
    expect([cache.review, cache.summary]).toEqual([null, null]);
  });
});

describe('applyIntakeLlm', () => {
  it('không có kết quả LLM: giữ kết quả quy tắc, tổng kết bằng quy tắc, review.source = RULES', () => {
    const r = rule([missingId]);
    const a = applyIntakeLlm(r, null, facts);
    expect(a.criteria).toEqual(r.criteria);
    expect(a.review).toMatchObject({ draft: true, source: 'RULES', prompt_overridden: false });
    expect(a.dossier_summary).toMatchObject({ source: 'RULES' });
    expect(a.dossier_summary!.overview).toContain('NGUYỄN VĂN AN');
    expect(a.dossier_summary!.next_actions).toEqual([expect.stringContaining('Căn cước công dân')]);
  });

  it('có kết quả LLM: tiêu chí và tổng kết lấy từ LLM, review.source = LLM, ghi nhận prompt ghi đè', () => {
    const cache: IntakeLlmCache = {
      review: reviewOf([lc('DOCUMENTS_COMPLETE', 'PASS')]),
      summary: { overview: 'Tổng kết của LLM.', highlights: ['a'], next_actions: [] },
      warnings: [], prompt_overridden: { intake_review: true, dossier_summary: false },
    };
    const a = applyIntakeLlm(rule([]), cache, facts);
    expect(crit(a, 1).summary).toBe('Nhận xét của LLM.');
    expect(a.review).toMatchObject({ source: 'LLM', warning: null, prompt_overridden: true });
    expect(a.dossier_summary).toEqual({ overview: 'Tổng kết của LLM.', highlights: ['a'], next_actions: [], source: 'LLM' });
  });

  it('LLM chấm hỏng nhưng tổng kết được: tiêu chí theo quy tắc, tổng kết của LLM, có cảnh báo', () => {
    const cache: IntakeLlmCache = {
      review: null, summary: { overview: 'Tổng kết.', highlights: [], next_actions: [] }, warnings: ['Phản hồi chấm tiêu chí không đúng định dạng.'],
      prompt_overridden: { intake_review: false, dossier_summary: false },
    };
    const r = rule([missingId]);
    const a = applyIntakeLlm(r, cache, facts);
    expect(a.criteria).toEqual(r.criteria);
    expect(a.review).toMatchObject({ source: 'RULES', warning: 'Phản hồi chấm tiêu chí không đúng định dạng.' });
    expect(a.dossier_summary?.source).toBe('LLM');
  });
});

describe('dữ kiện và prompt mặc định', () => {
  it('dữ kiện tiêu chí: mỗi điểm có ref; không đưa tiêu chí 3', () => {
    const f = buildCriteriaFacts(rule([missingId])) as Array<{ key: string; findings: Array<{ ref: string }> }>;
    expect(f.map((x) => x.key)).toEqual(['DOCUMENTS_COMPLETE', 'CONSISTENT_ACROSS_DOCUMENTS', 'READY_FOR_HANDOVER']);
    expect(f[0].findings[0].ref).toBe('DOC_MISSING:legal_id_card:dossier');
  });

  it('prompt mặc định có đủ placeholder bắt buộc', () => {
    for (const name of ['criteria', 'dossier', 'output_schema']) expect(INTAKE_REVIEW_PROMPT_TEMPLATE).toContain(`{{${name}}}`);
  });
});
