// T-V2-14 — hiển thị kiểm tra sơ bộ ở giai đoạn 1: mapper, reducer, view (hàm thuần). Dữ liệu giả.
import { applyOperation } from '@/app/loan-appraisal-v2/lib/operation-mapper';
import { initialRunState, runReducer, type RunAction, type RunState } from '@/app/loan-appraisal-v2/lib/run-reducer';
import { byUrgency, lineViews, linesWithStatus, phase1Counts, phase1Verdict, pickPrecheck, precheckBanner, relationDocs, SHOWN_STATUSES } from '@/app/loan-appraisal-v2/lib/precheck-view';
import { Phase1Overview } from '@/components/loan-appraisal-v2/intake/Phase1Overview';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrecheckPanel } from '@/components/loan-appraisal-v2/intake/PrecheckPanel';
import { skippedPrecheck, summarizePrecheck, type DossierPrecheck, type PrecheckLine } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';
import type { DossierFile } from '@/app/loan-appraisal/types';

const now = () => '10:00:00';
const line = (over: Partial<PrecheckLine> = {}): PrecheckLine => ({
  item_key: 'legal_id_card', label: 'CCCD', group: 'legal', group_label: 'I. Hồ sơ pháp lý', requirement: 'REQUIRED', subject: 'NGUYEN VAN A',
  status: 'PROVIDED', evidence: [{ doc_ref: 'D02', file_id: 'file-1', doc_type_key: 'id_card', instance_index: 1 }], note: null, adjusted: false, ...over,
});

function precheck(over: Partial<DossierPrecheck> = {}, lines: PrecheckLine[] = [line()]): DossierPrecheck {
  const relations = over.relations ?? [];
  return {
    version: '1.0', draft: true, status: 'COMPLETED', source: 'LLM', warning: null, flow: 'FULL', program_key: 'hkd_secured',
    checklist: lines, relations, overview: 'Tổng quan.', next_actions: [], prompt_overridden: false,
    ...summarizePrecheck(lines, relations), ...over,
  };
}

const unavailable = (): DossierPrecheck => ({
  ...precheck({}, []), status: 'UNAVAILABLE', source: 'NONE', warning: 'LLM lỗi', overview: null, overall: null,
});

const FILES = [{ file_id: 'file-1', file_name: 'cccd-nguyen-van-a.pdf', status: 'CLASSIFIED' }] as unknown as DossierFile[];

const running = (): RunState => runReducer(runReducer(initialRunState(), { type: 'SUBMIT_START' }), { type: 'SUBMITTED', operationId: 'op-1' });
const apply = (s: RunState, a: RunAction) => runReducer(s, a);

describe('operation-mapper: PRECHECK', () => {
  const op = (extra: Record<string, unknown>) => ({
    done: false,
    metadata: { state: 'RUNNING', current_step: 1, pipeline_steps: [{ stage_key: 'classify', status: 'SUCCESS', extracted_data: { files: [], ...extra } }] },
  });

  it('classify reveal trước (chưa có precheck), lần poll sau mới có PRECHECK — phát đúng một lần', () => {
    const revealed = new Set<string>();
    const first = applyOperation(op({}), revealed, now);
    expect(first.actions.map((a) => a.type)).toEqual(['REVEAL', 'PROGRESS']);

    const p = precheck();
    const second = applyOperation(op({ precheck: p }), revealed, now);
    expect(second.actions.map((a) => a.type)).toEqual(['PRECHECK', 'PROGRESS']);
    expect(second.actions[0]).toEqual({ type: 'PRECHECK', precheck: p });

    const third = applyOperation(op({ precheck: p }), revealed, now);
    expect(third.actions.map((a) => a.type)).toEqual(['PROGRESS']);
  });

  it('precheck sai hình dạng bị bỏ qua', () => {
    const r = applyOperation(op({ precheck: 'x' }), new Set(), now);
    expect(r.actions.some((a) => a.type === 'PRECHECK')).toBe(false);
  });
});

describe('run-reducer: PRECHECK', () => {
  it('lưu precheck khi đang chạy; chỉ đánh dấu bước kiểm tra sơ bộ xong, không đụng bước khác', () => {
    const before = running();
    const next = apply(before, { type: 'PRECHECK', precheck: precheck() });
    expect(next.precheck?.status).toBe('COMPLETED');
    expect(next.stages.dossier_precheck).toBe('done');
    expect({ ...next.stages, dossier_precheck: before.stages.dossier_precheck }).toEqual(before.stages);
  });

  it('bỏ qua khi không chạy; còn nguyên sau PAUSED; RESET xoá', () => {
    expect(apply(initialRunState(), { type: 'PRECHECK', precheck: precheck() }).precheck).toBeNull();
    const withPre = apply(running(), { type: 'PRECHECK', precheck: precheck() });
    const paused = apply(withPre, { type: 'PAUSED', result: null });
    expect(paused.phase).toBe('paused');
    expect(paused.precheck).not.toBeNull();
    expect(apply(paused, { type: 'RESET' }).precheck).toBeNull();
  });

  it('chạy lần mới (SUBMIT_START) không giữ precheck của lần trước', () => {
    const done = apply(apply(running(), { type: 'PRECHECK', precheck: precheck() }), { type: 'CANCELLED' });
    expect(apply(done, { type: 'SUBMIT_START' }).precheck).toBeNull();
  });
});

describe('precheck-view', () => {
  it('banner: UNAVAILABLE / SKIPPED nói rõ là chưa đánh giá, không bao giờ ra "không thiếu sót"', () => {
    const u = precheckBanner(unavailable());
    expect(u.tone).toBe('warning');
    expect(u.text).toContain('Chưa đánh giá');
    expect(u.text).not.toContain('chưa phát hiện');
    const s = precheckBanner(skippedPrecheck('tắt'));
    expect(s.text).toContain('không chạy');
    expect(s.text).not.toContain('chưa phát hiện');
  });

  it('banner COMPLETED: có thiếu → đếm đúng; không thiếu → nêu rõ chưa phải kết luận cuối', () => {
    const gaps = precheck({}, [line({ status: 'MISSING' }), line({ item_key: 'b', status: 'UNCERTAIN' })]);
    expect(precheckBanner(gaps)).toMatchObject({ tone: 'warning' });
    expect(precheckBanner(gaps).text).toContain('1 mục thiếu, 1 mục cần kiểm tra');
    const ok = precheck();
    expect(precheckBanner(ok)).toMatchObject({ tone: 'success' });
    expect(precheckBanner(ok).text).toContain('chưa phải kết luận cuối');
    const rel = precheck({ relations: [{ topic: 'Số tiền', status: 'INCONSISTENT', evidence: [], message: 'lệch' }] });
    expect(precheckBanner(rel).text).toContain('điểm lệch');
  });

  it('lineViews gom theo nhóm và đổi file_id thành tên file; file lạ giữ file_id', () => {
    const p = precheck({}, [line(), line({ item_key: 'x', group: 'collateral', group_label: 'IV. TSBĐ', evidence: [{ doc_ref: 'D09', file_id: 'file-lạ', doc_type_key: 'x', instance_index: 1 }] })]);
    const v = lineViews(p, FILES);
    expect(v.map((g) => g.group)).toEqual(['legal', 'collateral']);
    expect(v[0].lines[0].docs).toEqual(['cccd-nguyen-van-a.pdf']);
    expect(v[1].lines[0].docs).toEqual(['file-lạ']);
    expect(relationDocs(p.checklist[0].evidence, FILES)).toEqual(['cccd-nguyen-van-a.pdf']);
  });

  it('pickPrecheck: kết quả cuối ưu tiên hơn bản giữa chừng', () => {
    const mid = precheck({ overview: 'giữa chừng' });
    const fin = precheck({ overview: 'cuối' });
    expect(pickPrecheck(fin, mid)?.overview).toBe('cuối');
    expect(pickPrecheck(null, mid)?.overview).toBe('giữa chừng');
    expect(pickPrecheck(undefined, null)).toBeNull();
  });
});
describe('bước Kiểm tra sơ bộ (giai đoạn 1)', () => {
  const classifyStep = (extra: Record<string, unknown> = {}) => ({ stage_key: 'classify', processor: 'x', status: 'SUCCESS', extracted_data: { files: [], ...extra } });

  it('classify xong, chưa có precheck, current_step = 1 → đang chạy Kiểm tra sơ bộ (không phải OCR)', () => {
    const r = applyOperation({ done: false, metadata: { state: 'RUNNING', current_step: 1, progress_message: 'Đang kiểm tra sơ bộ', pipeline_steps: [classifyStep()] } }, new Set(), now);
    expect(r.actions.find((a) => a.type === 'PROGRESS')).toMatchObject({ stage: 'dossier_precheck' });
  });

  it('đã có precheck, current_step = 1 → bước đang chạy là OCR (giai đoạn 2)', () => {
    const r = applyOperation({ done: false, metadata: { state: 'RUNNING', current_step: 1, pipeline_steps: [classifyStep({ precheck: precheck() })] } }, new Set(), now);
    expect(r.actions.find((a) => a.type === 'PROGRESS')).toMatchObject({ stage: 'extract_evidence' });
  });

  it('reducer: PROGRESS dossier_precheck bật bước chạy; PRECHECK đánh dấu xong mà không bật OCR', () => {
    const s0 = apply(running(), { type: 'REVEAL', stageKey: 'classify', step: { status: 'SUCCESS', extracted_data: { files: [] } } });
    expect(s0.stages).toMatchObject({ classify: 'done', dossier_precheck: 'running', extract_evidence: 'pending' });
    const s1 = apply(s0, { type: 'PRECHECK', precheck: precheck() });
    expect(s1.stages).toMatchObject({ classify: 'done', dossier_precheck: 'done', extract_evidence: 'pending' });
  });
});

describe('PrecheckPanel: bỏ Không áp dụng, liệt kê đủ mục thiếu', () => {
  const lines = [
    line({ item_key: 'a', label: 'Mục A', status: 'PROVIDED' }),
    ...Array.from({ length: 5 }, (_, i) => line({ item_key: `m${i}`, label: `Thiếu số ${i}`, status: 'MISSING', subject: null, evidence: [], note: `ghi chú ${i}` })),
    line({ item_key: 'u', label: 'Cần xem', status: 'UNCERTAIN' }),
    line({ item_key: 'n1', label: 'Không cần 1', status: 'NOT_APPLICABLE', requirement: 'CONDITIONAL' }),
    line({ item_key: 'n2', label: 'Không cần 2', status: 'NOT_APPLICABLE', requirement: 'CONDITIONAL' }),
  ];
  const p = precheck({}, lines);

  it('lineViews/linesWithStatus không có mục NOT_APPLICABLE; mục thiếu liệt kê đủ', () => {
    expect(lineViews(p, FILES).flatMap((g) => g.lines).some((l) => l.status === 'NOT_APPLICABLE')).toBe(false);
    expect(linesWithStatus(p, FILES, 'MISSING')).toHaveLength(5);
    expect(SHOWN_STATUSES).not.toContain('NOT_APPLICABLE');
  });

  it('thẻ hiển thị: không có nhãn/số "Không áp dụng", có khối "Mục còn thiếu (5)" với đủ 5 mục kèm ghi chú', () => {
    const html = renderToStaticMarkup(createElement(PrecheckPanel, { precheck: p, files: FILES }));
    expect(html).not.toContain('Không áp dụng');
    expect(html).not.toContain('Không cần 1');
    expect(html).toContain('Mục còn thiếu (5)');
    for (let i = 0; i < 5; i += 1) { expect(html).toContain(`Thiếu số ${i}`); expect(html).toContain(`ghi chú ${i}`); }
    expect(html).toContain('Mục cần kiểm tra (1)');
  });
});
describe('Giai đoạn 1 cho Sale: tổng quan nhìn qua là biết tình trạng', () => {
  const mix = precheck({}, [
    line({ item_key: 'a', status: 'PROVIDED' }), line({ item_key: 'b', status: 'PROVIDED' }),
    line({ item_key: 'c', status: 'MISSING', subject: null, evidence: [] }),
    line({ item_key: 'd', status: 'UNCERTAIN' }),
    line({ item_key: 'n', status: 'NOT_APPLICABLE', requirement: 'CONDITIONAL' }),
  ]);

  it('phase1Counts: không tính Không áp dụng; độ phủ = đã có / số mục hiển thị', () => {
    expect(phase1Counts(mix, FILES)).toMatchObject({ provided: 2, missing: 1, uncertain: 1, total: 4, coverage_percent: 50 });
    expect(phase1Counts(null, FILES)).toMatchObject({ provided: 0, total: 0, coverage_percent: null });
    expect(phase1Counts(unavailable(), FILES).total).toBe(0);
  });

  it('phase1Verdict: thiếu → vàng (gợi ý mềm, không đỏ); chỉ cần kiểm tra/lệch/file lỗi → vàng; sạch → xanh; chưa đánh giá không bao giờ xanh', () => {
    expect(phase1Verdict(mix, FILES)).toMatchObject({ tone: 'warning', label: 'Cần bổ sung' });
    expect(phase1Verdict(mix, FILES).headline).toContain('Thiếu 1 mục');
    const warn = precheck({}, [line({ status: 'UNCERTAIN' })]);
    expect(phase1Verdict(warn, FILES)).toMatchObject({ tone: 'warning', label: 'Cần kiểm tra' });
    const bad = [{ file_id: 'f2', file_name: 'x.pdf', status: 'UNKNOWN' }] as unknown as DossierFile[];
    expect(phase1Verdict(precheck(), bad).tone).toBe('warning');
    expect(phase1Verdict(precheck(), FILES)).toMatchObject({ tone: 'success', label: 'Đạt sơ bộ' });
    expect(phase1Verdict(unavailable(), FILES).tone).toBe('warning');
    expect(phase1Verdict(skippedPrecheck('tắt'), FILES).tone).toBe('neutral');
    expect(phase1Verdict(null, FILES, true).tone).toBe('info');
    expect(phase1Verdict(null, FILES, false).tone).toBe('neutral');
  });

  it('byUrgency: thiếu → cần kiểm tra → đã có, giữ thứ tự trong cùng trạng thái', () => {
    const out = byUrgency([{ status: 'PROVIDED', id: 1 }, { status: 'MISSING', id: 2 }, { status: 'PROVIDED', id: 3 }, { status: 'UNCERTAIN', id: 4 }, { status: 'MISSING', id: 5 }]);
    expect(out.map((x) => x.id)).toEqual([2, 5, 4, 1, 3]);
  });

  it('Phase1Overview: hiện kết luận, 4 con số, độ phủ và nút chuyển giai đoạn; đang chạy thì khoá nút', () => {
    const html = renderToStaticMarkup(createElement(Phase1Overview, { precheck: mix, files: FILES, onGoToAppraisal: () => undefined, appraisalPending: true }));
    expect(html).toContain('Cần bổ sung');
    for (const label of ['Đã có', 'Thiếu', 'Cần kiểm tra', 'Lệch giữa chứng từ', 'Độ phủ checklist']) expect(html).toContain(label);
    expect(html).toContain('2/4 mục · 50%');
    expect(html).toContain('Chuyển sang giai đoạn 2');
    const running = renderToStaticMarkup(createElement(Phase1Overview, { precheck: null, files: [], running: true, onGoToAppraisal: () => undefined, appraisalPending: true }));
    expect(running).toContain('Đang kiểm tra');
    expect(running).toContain('disabled');
    expect(running).not.toContain('Độ phủ checklist');
  });

  it('PrecheckPanel: mọi khối gập mở sẵn và mục thiếu đứng trước mục đã có trong nhóm', () => {
    const grouped = precheck({}, [
      line({ item_key: 'ok', label: 'Mục đã có', status: 'PROVIDED' }),
      line({ item_key: 'ms', label: 'Mục bị thiếu', status: 'MISSING', subject: null, evidence: [] }),
    ]);
    const html = renderToStaticMarkup(createElement(PrecheckPanel, { precheck: grouped, files: FILES }));
    expect(html).not.toMatch(/<details(?![^>]*\sopen)/);
    const list = html.slice(html.indexOf('Checklist theo nhóm'));
    expect(list.indexOf('Mục bị thiếu')).toBeGreaterThan(-1);
    expect(list.indexOf('Mục bị thiếu')).toBeLessThan(list.indexOf('Mục đã có'));
  });
});
